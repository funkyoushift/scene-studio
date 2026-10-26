import { parseScene, twitchContent } from "./scene.mjs";
import { partyEvent } from "./party.mjs";
import { IMAGE_ORIGIN } from "./image-address.mjs";

// Compiled into each hosted extension package; old packages may omit the field.
const EXTENSION_VERSION = import.meta.env?.VITE_EXTENSION_VERSION || "0.1.0";

async function chatConnectionRequest(auth, suffix, method, fetcher) {
  if (!auth?.token || !/^[1-9][0-9]{0,19}$/.test(auth.channelId))
    throw new Error("Open your channel's Twitch configuration and connect your identity first.");
  let response;
  try {
    response = await fetcher(`${IMAGE_ORIGIN}/v1/chat/${auth.channelId}/${suffix}`, {
      method,
      headers: { Authorization: `Bearer ${auth.token}` },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error(method === "GET"
      ? "The chat connection service could not be reached. Your overlay is unchanged."
      : "The chat connection result could not be confirmed. Your overlay is unchanged; check the connection before trying again.");
  }
  if (method === "GET" && response.status === 404)
    return { available: false, connected: false, reconnectRequired: false };
  let result;
  try { result = await response.json(); }
  catch { throw new Error("The chat connection service is not ready. Your overlay is unchanged."); }
  if (!response.ok)
    throw new Error(typeof result?.error === "string" ? result.error.slice(0, 200) : "The chat connection could not be updated.");
  return result;
}

export async function getChatConnection(auth, fetcher = fetch) {
  const result = await chatConnectionRequest(auth, "connection", "GET", fetcher);
  if (typeof result?.available !== "boolean" || typeof result?.connected !== "boolean" || typeof result?.reconnectRequired !== "boolean")
    throw new Error("The chat connection status could not be confirmed.");
  return { available: result.available, connected: result.connected, reconnectRequired: result.reconnectRequired };
}

export async function startChatConnection(auth, fetcher = fetch) {
  const result = await chatConnectionRequest(auth, "connect", "POST", fetcher);
  let url;
  try { url = new URL(result.authorizeUrl); } catch { throw new Error("Twitch authorization could not be prepared."); }
  const required = ["response_type", "scope", "redirect_uri", "state", "client_id"];
  if (url.origin !== "https://id.twitch.tv" || url.pathname !== "/oauth2/authorize" || url.username || url.password || url.href.includes("#") ||
      required.some(key => url.searchParams.getAll(key).length !== 1) ||
      url.searchParams.get("response_type") !== "code" || url.searchParams.get("scope") !== "moderation:read" ||
      url.searchParams.get("redirect_uri") !== `${IMAGE_ORIGIN}/chat/callback` ||
      !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("state") ?? "") || !url.searchParams.get("client_id")?.trim() ||
      !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now())
    throw new Error("Twitch authorization could not be prepared safely. Check the connection again.");
  return { authorizeUrl: url.href, expiresAt: result.expiresAt };
}

export async function disconnectChatConnection(auth, fetcher = fetch) {
  const result = await chatConnectionRequest(auth, "connection", "DELETE", fetcher);
  if (result?.connected !== false || typeof result?.accessRevoked !== "boolean")
    throw new Error("Disconnection could not be confirmed. Check the connection before trying again.");
  return { connected: false, accessRevoked: result.accessRevoked };
}

// Embedded mobile browsers may provide getRandomValues without randomUUID.
export function partyRequestId(cryptoSource = globalThis.crypto) {
  if (typeof cryptoSource?.randomUUID === "function") return cryptoSource.randomUUID();
  if (typeof cryptoSource?.getRandomValues !== "function")
    throw new Error("This browser cannot safely send a shared celebration. Update Twitch and try again.");
  const values = cryptoSource.getRandomValues(new Uint8Array(16));
  values[6] = (values[6] & 15) | 64;
  values[8] = (values[8] & 63) | 128;
  const hex = Array.from(values, value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function sendParty(auth, object, fetcher=fetch) {
  if(!auth?.token || !/^[1-9][0-9]{0,19}$/.test(auth.channelId)) throw new Error("Reconnect to Twitch before celebrating.");
  const response=await fetcher(`${IMAGE_ORIGIN}/party/${auth.channelId}`,{
    method:"POST",headers:{Authorization:`Bearer ${auth.token}`,"Content-Type":"application/json"},
    credentials:"omit",redirect:"error",signal:AbortSignal.timeout(30000),
    body:JSON.stringify({eventId:partyRequestId(),objectId:object.id,preset:object.preset??"ducks",extensionVersion:EXTENSION_VERSION}),
  });
  const result=await response.json();
  if(!response.ok || result.status!=="sent") throw new Error(result.error||"Result not confirmed. Check chat before another click.");
  return partyEvent(JSON.stringify(result.event));
}

export async function channelProfile(auth, fetcher = fetch) {
  if (!/^[1-9][0-9]{0,19}$/.test(auth?.channelId) || !auth?.helixToken)
    throw new Error("Your Twitch channel identity is not ready.");
  const response = await fetcher(
    `https://api.twitch.tv/helix/users?id=${auth.channelId}`,
    {
      headers: {
        "Client-Id": auth.clientId,
        Authorization: `Extension ${auth.helixToken}`,
      },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error(
      "Could not confirm your channel with Twitch. Try again shortly.",
    );
  const user = (await response.json()).data?.[0];
  if (user?.id !== auth.channelId || !/^[a-z0-9_]{1,25}$/.test(user.login))
    throw new Error("Could not confirm your channel with Twitch.");
  return { id: user.id, login: user.login };
}

// Only validated scene data crosses the helper boundary. No generated code runs.
export function readTwitchScene(raw) {
  const scene = parseScene(raw);
  twitchContent(scene);
  return scene;
}

export function watchTwitchScene(helper, onScene, onStatus, onParty=()=>{}) {
  let active = true;
  let receivedBroadcast = false;
  const seen = new Set();
  function accept(raw, broadcast = false) {
    if (!active) return;
    try {
      const next = readTwitchScene(raw);
      if (broadcast) receivedBroadcast = true;
      onScene(next);
      onStatus("");
    } catch {
      // A bad update must not clear the last working overlay.
      if (!broadcast) onStatus("This scene could not be loaded.");
    }
  }
  function receive(target, type, message) {
    if (!active || target !== "broadcast") return;
    const event = partyEvent(message);
    if(event) {
      if(!seen.has(event.eventId)) {seen.add(event.eventId); if(seen.size>100) seen.delete(seen.values().next().value); onParty(event);}
      return;
    }
    if (type === "application/json") accept(message, true);
  }
  helper.listen("broadcast", receive);
  helper.configuration.onChanged(() => {
    if (!active || receivedBroadcast) return;
    const raw = helper.configuration.broadcaster?.content;
    if (raw) accept(raw);
    else onStatus("The streamer has not set up a scene yet.");
  });
  return () => {
    active = false;
    helper.unlisten("broadcast", receive);
  };
}

export function sendTwitchScene(helper, scene) {
  if (helper?.viewer?.role !== "broadcaster")
    throw new Error(
      "Open your channel’s configuration page to save your overlay.",
    );
  const content = twitchContent(scene);
  helper.configuration.set("broadcaster", "1", content);
  try {
    helper.send("broadcast", "application/json", content);
    return "Sent to Twitch and connected viewers. Reopen configuration to verify the saved design.";
  } catch {
    return "Sent to Twitch. Live update was unavailable; viewers may need to reload.";
  }
}

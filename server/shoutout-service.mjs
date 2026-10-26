import { validateAutomations } from "../src/automations.mjs";
import { safeShoutoutProfile } from "../src/shoutout-contract.mjs";

const LOGIN = /^[a-z0-9_]{1,25}$/;
const ID = /^[1-9][0-9]{0,19}$/;
const STREAM_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_FIRST_MESSAGES = 100_000;
const MAX_CHANNEL_FIRST_MESSAGES = 10_000;
const FIRST_MESSAGE_TTL = 30 * 86400_000;
const PROFILE_TTL = 30_000;
const PROFILE_CACHE_LIMIT = 256;
const caches = new WeakMap();
const tokens = new WeakMap();
const streams = new WeakMap();
const STREAM_CACHE_TTL = 5_000;
const LOOKUPS_PER_CHANNEL_PER_MINUTE = 30;
const stmt = (env, sql, ...args) => env.IMAGES.prepare(sql).bind(...args);

function rules(env, channel) {
  return stmt(env, "SELECT design FROM automation_configs WHERE channel=?1", channel).first()
    .then(row => { try { return row ? validateAutomations(JSON.parse(row.design)).rules : []; } catch { return []; } });
}
const supportsMode = (trigger, mode) => trigger.mode === "both" || trigger.mode === mode;

export function parseShoutoutCommand(text) {
  return typeof text === "string" ? text.match(/^!so\s+@([a-z0-9_]{1,25})\s*$/i)?.[1].toLowerCase() ?? null : null;
}

export function trustedShoutoutActor(event, channel) {
  if (!event || !ID.test(event.chatter_user_id)) return false;
  const badgeIds = Array.isArray(event.badges) ? event.badges
    .filter(item => item && typeof item === "object" && typeof item.set_id === "string")
    .map(item => item.set_id) : [];
  return (event.chatter_user_id === channel && badgeIds.includes("broadcaster")) || badgeIds.includes("moderator");
}

export async function hasShoutoutCandidate(env, channel, mode, login = null) {
  if (env.AUTOMATIONS_ENABLED !== "true" || !["automatic", "command"].includes(mode)) return false;
  const existing = await rules(env, channel);
  return existing.some(rule => {
    const trigger = rule.trigger;
    if (!rule.enabled || trigger.type !== "shoutout" || !supportsMode(trigger, mode)) return false;
    if (login && trigger.exclusions.includes(login)) return false;
    if (mode === "command") return true;
    return trigger.types.length > 0 || (login ? trigger.users.includes(login) : trigger.users.length > 0);
  });
}

async function providerJson(fetcher, url, options = {}) {
  const response = await fetcher(url, { ...options, redirect: "manual", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Twitch lookup unavailable.");
  const reader = response.body?.getReader(); if (!reader) throw new Error("Twitch lookup unavailable.");
  const chunks = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 64_000) { await reader.cancel(); throw new Error("Twitch lookup unavailable."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(data));
}

async function appToken(env, fetcher, now) {
  const cached = tokens.get(env);
  if (cached?.expires > now) return cached.value;
  const token = await providerJson(fetcher, "https://id.twitch.tv/oauth2/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.TWITCH_CHAT_CLIENT_ID,
      client_secret: env.TWITCH_CHAT_CLIENT_SECRET, grant_type: "client_credentials" }).toString(),
  });
  if (typeof token.access_token !== "string" || !token.access_token || token.access_token.length > 4096 ||
      /[\r\n]/.test(token.access_token) || token.token_type?.toLowerCase() !== "bearer")
    throw new Error("Twitch lookup unavailable.");
  tokens.set(env, { value: token.access_token, expires: now + Math.min(60_000,
    Number.isFinite(token.expires_in) ? Math.max(0, token.expires_in * 1000 - 10_000) : 30_000) });
  return token.access_token;
}
const headers = (env, token) => ({ Authorization: `Bearer ${token}`, "Client-Id": env.TWITCH_CHAT_CLIENT_ID });

function cacheFor(env) {
  let entries = caches.get(env);
  if (!entries) { entries = new Map(); caches.set(env, entries); }
  return entries;
}
async function profile(env, { userId, login }, token, fetcher, now) {
  const key = userId ? `id:${userId}` : `login:${login}`;
  const cache = cacheFor(env), hit = cache.get(key);
  if (hit && hit.expires > now) return hit.profile;
  if (hit) cache.delete(key);
  const url = new URL("https://api.twitch.tv/helix/users");
  url.searchParams.set(userId ? "id" : "login", userId || login);
  const result = await providerJson(fetcher, url.href, { headers: headers(env, token) });
  if (!Array.isArray(result.data) || result.data.length !== 1) return null;
  const user = result.data[0];
  if (!ID.test(user?.id) || !LOGIN.test(user.login) ||
      (userId && user.id !== userId) || (login && user.login !== login)) return null;
  const type = user.broadcaster_type === "partner" || user.broadcaster_type === "affiliate"
    ? user.broadcaster_type : user.broadcaster_type === "" ? "regular" : null;
  if (!type) return null; // Unknown provider status is never regular.
  const candidate = { id: user.id, login: user.login,
    displayName: typeof user.display_name === "string" && user.display_name.length <= 70 ? user.display_name : user.login,
    image: typeof user.profile_image_url === "string" ? user.profile_image_url : "", type };
  let clean = safeShoutoutProfile(candidate);
  if (!clean) clean = safeShoutoutProfile({ ...candidate, image: "" });
  if (!clean) return null;
  cache.set(key, { profile: clean, expires: now + PROFILE_TTL });
  if (cache.size > PROFILE_CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return clean;
}

function cachedStream(env, channel, now) {
  const item = streams.get(env)?.get(channel);
  return item?.expires > now ? item : null;
}
async function liveStreamId(env, channel, token, fetcher, now) {
  const cached = cachedStream(env, channel, now);
  if (cached) return cached.id;
  const result = await providerJson(fetcher, `https://api.twitch.tv/helix/streams?user_id=${channel}`, { headers: headers(env, token) });
  if (!Array.isArray(result.data) || result.data.length > 1) throw new Error("Twitch stream lookup unavailable.");
  if (!result.data.length) return null;
  const stream = result.data[0];
  const id = stream?.user_id === channel && stream.type === "live" && STREAM_ID.test(stream.id) ? stream.id : null;
  if (id) {
    let values = streams.get(env); if (!values) { values = new Map(); streams.set(env, values); }
    values.set(channel, { id, expires: now + STREAM_CACHE_TTL });
    if (values.size > 100) values.delete(values.keys().next().value);
  }
  return id;
}

// Cheap local duplicate check precedes moderation/provider calls. A new stream
// is resolved after the five-second cache window, so stale IDs are short-lived.
export async function mayAttemptShoutout(env, channel, mode, chatterId, now = Date.now()) {
  if (mode === "automatic" && ID.test(chatterId)) {
    const cached = cachedStream(env, channel, now);
    if (cached && await stmt(env, "SELECT user_id FROM shoutout_first_messages WHERE channel=?1 AND stream_id=?2 AND user_id=?3 AND expires>?4",
      channel, cached.id, chatterId, now).first()) return false;
  }
  const minute = Math.floor(now / 60_000);
  await stmt(env, "DELETE FROM shoutout_lookup_windows WHERE minute<?1", minute - 2).run();
  const admitted = await stmt(env, `INSERT INTO shoutout_lookup_windows(channel,minute,attempts)
    VALUES(?1,?2,1) ON CONFLICT(channel,minute) DO UPDATE SET attempts=attempts+1
    WHERE shoutout_lookup_windows.attempts<?3`, channel, minute, LOOKUPS_PER_CHANNEL_PER_MINUTE).run();
  return Boolean(admitted.meta.changes);
}

async function firstMessage(env, channel, streamId, userId, now) {
  await stmt(env, "DELETE FROM shoutout_first_messages WHERE expires<=?1", now).run();
  const inserted = await stmt(env, `INSERT OR IGNORE INTO shoutout_first_messages(channel,stream_id,user_id,created,expires)
    SELECT ?1,?2,?3,?4,?5
    WHERE (SELECT count(*) FROM shoutout_first_messages WHERE channel=?1)<?6
      AND (SELECT count(*) FROM shoutout_first_messages)<?7`,
    channel, streamId, userId, now, now + FIRST_MESSAGE_TTL,
    MAX_CHANNEL_FIRST_MESSAGES, MAX_FIRST_MESSAGES).run();
  return Boolean(inserted.meta.changes);
}

const matchesProfile = (trigger, mode, person) =>
  !trigger.exclusions.includes(person.login) && (mode === "command" ||
    trigger.users.includes(person.login) || trigger.types.includes(person.type));

/** Called only after EventSub signature, subscription, receipt, and moderation admission. */
export async function processShoutoutChat(env, channel, input, {
  now = Date.now(), fetcher = fetch, processInput, recheck = async () => true,
} = {}) {
  if (!ID.test(channel) || !/^[A-Za-z0-9_-]{1,128}$/.test(input?.messageId ?? "") ||
      !["automatic", "command"].includes(input?.mode) || typeof processInput !== "function")
    return { status: "no_match" };
  const mode = input.mode;
  if (mode === "automatic" && !ID.test(input.chatterId)) return { status: "no_match" };
  if (mode === "command" && !LOGIN.test(input.targetLogin ?? "")) return { status: "no_match" };
  const saved = await rules(env, channel);
  const candidates = saved.filter(rule => rule.enabled && rule.trigger.type === "shoutout" &&
    supportsMode(rule.trigger, mode));
  if (!candidates.length) return { status: "no_match" };
  const token = await appToken(env, fetcher, now);
  let streamId = null;
  if (mode === "automatic") {
    streamId = await liveStreamId(env, channel, token, fetcher, now);
    if (!streamId) return { status: "no_match" };
    if (!await firstMessage(env, channel, streamId, input.chatterId, now)) return { status: "duplicate" };
  }
  const person = await profile(env, mode === "automatic" ? { userId: input.chatterId } : { login: input.targetLogin }, token, fetcher, now);
  if (!person) return { status: "no_match" };
  const rule = candidates.find(item => matchesProfile(item.trigger, mode, person));
  if (!rule) return { status: "no_match" };
  if (!await recheck()) return { status: "denied" };
  return processInput(env, channel, { type: "shoutout", id: input.messageId, mode,
    ruleId: rule.id, profile: person, ...(streamId ? { streamId } : {}) }, { now, fetcher });
}

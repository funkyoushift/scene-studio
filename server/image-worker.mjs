// Dedicated Workers Free account. Bind IMAGES (D1),
// EXTENSION_SECRET (base64 secret), EXTENSION_ORIGIN,
// and TEST_CHANNELS (comma-separated numeric channel IDs). Empty allowlist denies writes.
import { partyRequest } from "./party-service.mjs";
import { startConnect, startTriggerConnect, completeConnect, getChatConnection, disconnectChat, validateIdleChatGrants, ChatAuthorizationError } from "./chat-authorization.mjs";
import { publicPage } from "./public-pages.mjs";
import { developerRequest } from "./developer-service.mjs";
import { automationRequest, tickAutomations, processAutomationInput, hasMatchingKeywordRule } from "./automation-service.mjs";
import { getTriggerConnection, ensureTriggerSubscription, disconnectTriggerSubscription, handleChatWebhook, cleanupChatTriggerReceipts } from "./chat-triggers.mjs";
const MAX_IMAGE = 200_000;
export const MAX_IMAGES = 48;
export const MAX_TOTAL_IMAGES = 1000;
const encoder = new TextEncoder();
class Rejected extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function reject(status, message) {
  throw new Rejected(status, message);
}
function decode(value) {
  return Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
}
export async function extensionClaims(request, secret, channel, now = Date.now(), broadcasterOnly = false) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
  if (!token || token.length > 8192 || !secret)
    reject(401, "Sign in through the extension to upload.");
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error();
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if (header.alg !== "HS256") throw new Error();
    const key = await crypto.subtle.importKey(
      "raw",
      decode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        key,
        decode(parts[2]),
        encoder.encode(parts.slice(0, 2).join(".")),
      ))
    )
      throw new Error();
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    if (
      !["broadcaster", "viewer", "moderator"].includes(claims.role) ||
      claims.channel_id !== channel ||
      (broadcasterOnly && (claims.role !== "broadcaster" || claims.user_id !== channel)) ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= Math.floor(now / 1000) ||
      (claims.nbf !== undefined &&
        (!Number.isFinite(claims.nbf) || claims.nbf > Math.floor(now / 1000)))
    )
      throw new Error();
    return claims;
  } catch {
    reject(401, "The broadcaster’s linked extension sign-in is required.");
  }
}

export async function broadcaster(request, secret, channel, now = Date.now()) {
  return extensionClaims(request, secret, channel, now, true);
}

async function boundedBody(request) {
  if (Number(request.headers.get("content-length")) > MAX_IMAGE)
    reject(413, "Use an image under 200 KB.");
  const reader = request.body?.getReader();
  if (!reader) reject(400, "Choose an image.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE) {
        await reader.cancel();
        reject(413, "Use an image under 200 KB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function validatePng(data) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    data.length < 45 ||
    data.length > MAX_IMAGE ||
    signature.some((byte, i) => data[i] !== byte)
  )
    reject(415, "Upload a PNG image.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const typeAt = (i) => String.fromCharCode(...data.slice(i, i + 4));
  if (view.getUint32(8) !== 13 || typeAt(12) !== "IHDR")
    reject(415, "Invalid PNG header.");
  const width = view.getUint32(16),
    height = view.getUint32(20);
  if (width < 1 || height < 1 || width > 1024 || height > 1024)
    reject(413, "Images must be at most 1024 by 1024 pixels.");
  let offset = 8,
    hasPixels = false,
    ended = false;
  while (offset + 12 <= data.length) {
    const length = view.getUint32(offset),
      type = typeAt(offset + 4);
    if (offset + length + 12 > data.length)
      reject(415, "The image is incomplete.");
    if (type === "acTL") reject(415, "Use a still image.");
    if (type === "IDAT") hasPixels = true;
    offset += length + 12;
    if (type === "IEND") {
      ended = length === 0 && offset === data.length;
      break;
    }
  }
  if (!hasPixels || !ended) reject(415, "The image is incomplete.");
  return { width, height };
}

export default {
  async scheduled(controller, env, ctx) {
    // No credentials, callback queries, or provider responses enter logs.
    ctx.waitUntil((async () => {
      await env.IMAGES.prepare("DELETE FROM party_attempts WHERE expires<=?1").bind(Date.now()).run();
      if (env.AUTOMATIONS_ENABLED === "true")
        await env.IMAGES.prepare("DELETE FROM automation_receipts WHERE expires<=?1").bind(Date.now()).run();
      if (env.CHAT_TRIGGERS_ENABLED === "true") await cleanupChatTriggerReceipts(env);
      if (!env.TWITCH_CHAT_CLIENT_ID || !env.TWITCH_CHAT_CLIENT_SECRET) return;
      const result = await validateIdleChatGrants(env,{limit:2});
      if (result.remainingDue > 25) console.warn("Chat validation has a pending batch.");
    })().catch(() => console.warn("Chat validation deferred; provider unavailable.")));
    if (env.AUTOMATIONS_ENABLED === "true")
      ctx.waitUntil(tickAutomations(env,{limit:2}).catch(() => console.warn("Scheduled overlay effects unavailable.")));
  },
  async fetch(request, env, ctx) {
    const origin = request.headers.get("origin");
    const headers = new Headers({
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    if (origin && origin === env.EXTENSION_ORIGIN) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
    }
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          ...Object.fromEntries(headers),
          "Content-Type": "application/json",
        },
      });
    try {
      const url = new URL(request.url);
      const webhook = url.pathname.match(/^\/eventsub\/chat\/([1-9][0-9]{0,19})$/);
      if (webhook) {
        if (env.CHAT_TRIGGERS_ENABLED !== "true") return json({error:"Chat triggers are not enabled."},404);
        return handleChatWebhook(request,env,webhook[1],{processInput:processAutomationInput,hasMatchingKeywordRule,waitUntil:ctx ? promise=>ctx.waitUntil(promise) : undefined});
      }
      const automation = url.pathname.match(/^\/v1\/automations\/([1-9][0-9]{0,19})\/(config|fire|active)$/);
      if (automation) {
        if (env.AUTOMATIONS_ENABLED !== "true") return json({error:"Live automations are not enabled."},404);
        if (!env.EXTENSION_ORIGIN || origin !== env.EXTENSION_ORIGIN) return json({error:"Open Scene Studio on Twitch."},403);
        if (request.method === "OPTIONS") return new Response(null,{status:204,headers:{...Object.fromEntries(headers),"Access-Control-Allow-Methods":"GET, PUT, POST, OPTIONS","Access-Control-Allow-Headers":"Authorization, Content-Type"}});
        const claims = request.method === "GET" && ["config", "active"].includes(automation[2])
          ? await extensionClaims(request,env.EXTENSION_SECRET,automation[1])
          : await broadcaster(request,env.EXTENSION_SECRET,automation[1]);
        const response = await automationRequest(request,env,automation[1],{claims});
        const resultHeaders = new Headers(response.headers);
        for (const [key,value] of headers) resultHeaders.set(key,value);
        return new Response(response.body,{status:response.status,headers:resultHeaders});
      }
      if (url.pathname.startsWith('/v2/channels/')) {
        // Next-version foundation: absent flag denies access before any DB work.
        // Do not enable until schema, key management and delivery are qualified.
        if (env.DEVELOPER_API_ENABLED !== 'true') return json({error:'Developer API is not enabled.'},404);
        const developer = url.pathname.match(/^\/v2\/channels\/([1-9][0-9]{0,19})\/(keys|events|state|actions)(?:\/([A-Za-z0-9_-]+))?$/);
        if (!developer) return json({error:'Not found.'},404);
        if (request.method === 'OPTIONS') {
          if (!env.EXTENSION_ORIGIN || origin !== env.EXTENSION_ORIGIN) return json({error:'Origin not allowed.'},403);
          return new Response(null,{status:204,headers:{...Object.fromEntries(headers),'Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'}});
        }
        const verifiedClaims = developer[2] === 'keys' ? await broadcaster(request, env.EXTENSION_SECRET, developer[1]) : undefined;
        return developerRequest(request, env, developer[1], {verifiedClaims});
      }
      if (env.PUBLIC_PAGES === "true" && request.method === "GET") {
        const page = publicPage(url.pathname);
        if (page) return page;
      }
      if (url.pathname === "/chat/callback") {
        if (request.method !== "GET") return json({error:"Method not allowed."},405);
        // Never echo OAuth query parameters or provider errors into HTML/logs.
        let message = "Chat is connected. Return to Scene Studio and choose Check connection.";
        let status = 200;
        try {
          const connected = await completeConnect(env, request.url);
          if (connected.triggerAccess) {
            const trigger = await ensureTriggerSubscription(env,connected.channel);
            message = trigger.connected ? "Chat triggers are connected. Return to Scene Studio and choose Check connection." : "Chat access is connected. Return to Scene Studio and choose Check connection to confirm Twitch has enabled the chat listener.";
          }
        }
        catch { message = "Chat could not be connected. Return to Scene Studio and start Connect chat again."; status = 400; }
        return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Scene Studio chat</title><h1>Scene Studio</h1><p>${message}</p></html>`, {status, headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'","X-Content-Type-Options":"nosniff"}});
      }
      const chat = url.pathname.match(/^\/v1\/chat\/([1-9][0-9]{0,19})\/(connection|connect|triggers|trigger-connect)$/);
      if (chat) {
        if (!env.EXTENSION_ORIGIN || origin !== env.EXTENSION_ORIGIN) return json({error:"Open this channel’s configuration on Twitch."},403);
        if (request.method === "OPTIONS") {
          headers.set("Access-Control-Allow-Methods","GET, POST, DELETE");
          headers.set("Access-Control-Allow-Headers","Authorization, Content-Type");
          return new Response(null,{status:204,headers});
        }
        const claims = await broadcaster(request, env.EXTENSION_SECRET, chat[1]);
        if (chat[2] === "trigger-connect" && request.method === "POST") return json(await startTriggerConnect(env,chat[1],origin,claims));
        if (chat[2] === "triggers" && request.method === "GET") return json(await getTriggerConnection(env,chat[1]));
        if (chat[2] === "triggers" && request.method === "POST") return json(await ensureTriggerSubscription(env,chat[1]));
        if (chat[2] === "triggers" && request.method === "DELETE") return json(await disconnectTriggerSubscription(env,chat[1]));
        if (chat[2] === "connect" && request.method === "POST") return json(await startConnect(env,chat[1],origin,claims));
        if (chat[2] === "connection" && request.method === "GET") return json(await getChatConnection(env,chat[1],origin,claims));
        if (chat[2] === "connection" && request.method === "DELETE") {
          if (env.CHAT_TRIGGERS_ENABLED === "true") await disconnectTriggerSubscription(env,chat[1]);
          return json(await disconnectChat(env,chat[1],origin,claims));
        }
        return json({error:"Method not allowed."},405);
      }
      const party = url.pathname.match(/^\/party\/([1-9][0-9]{0,19})$/);
      if (party) {
        if (request.method === "OPTIONS") {
          if (origin !== env.EXTENSION_ORIGIN) return json({error:"Origin not allowed."},403);
          headers.set("Access-Control-Allow-Methods","POST");
          headers.set("Access-Control-Allow-Headers","Authorization, Content-Type");
          return new Response(null,{status:204,headers});
        }
        return partyRequest(request,env,party[1],json);
      }
      const match = url.pathname.match(
        /^\/images\/([1-9][0-9]{0,19})(?:\/([a-f0-9]{64})\.png)?$/,
      );
      if (!match) return json({ error: "Not found." }, 404);
      const [, channel, hash] = match;
      if (request.method === "OPTIONS") {
        if (origin !== env.EXTENSION_ORIGIN)
          return json({ error: "Origin not allowed." }, 403);
        headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE");
        headers.set(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type",
        );
        return new Response(null, { status: 204, headers });
      }
      if (request.method === "GET" && hash) {
        const row = await env.IMAGES.prepare(
          "SELECT data FROM images WHERE channel = ?1 AND hash = ?2",
        )
          .bind(channel, hash)
          .first();
        if (!row) return json({ error: "Image not found." }, 404);
        headers.set("Content-Type", "image/png");
        return new Response(new Uint8Array(row.data), { headers });
      }
      if (!(
        (request.method === "GET" && !hash) ||
        (request.method === "POST" && !hash) ||
        (request.method === "DELETE" && hash)
      ))
        return json({ error: "Method not allowed." }, 405);
      if (!env.EXTENSION_ORIGIN || origin !== env.EXTENSION_ORIGIN)
        return json({ error: "Open the extension to upload." }, 403);
      await broadcaster(request, env.EXTENSION_SECRET, channel);
      if (
        env.PUBLIC_IMAGES !== "true" && !(env.TEST_CHANNELS || "")
          .split(",")
          .map((s) => s.trim())
          .includes(channel)
      )
        return json(
          { error: "Image uploads are not enabled for this test channel." },
          403,
        );
      if (request.method === "DELETE") {
        if (env.AUTOMATIONS_ENABLED === "true") {
          const saved = await env.IMAGES.prepare("SELECT design FROM automation_configs WHERE channel=?1").bind(channel).first();
          const address = `${env.PUBLIC_SERVICE_URL}/images/${channel}/${hash}.png`;
          if (saved && JSON.parse(saved.design).carousels.some(carousel=>carousel.slides.some(slide=>slide.image===address)))
            return json({error:"This image is used by your saved carousel. Remove it there and publish the change before deleting the image."},409);
        }
        await env.IMAGES.prepare(
          "DELETE FROM images WHERE channel = ?1 AND hash = ?2",
        )
          .bind(channel, hash)
          .run();
        return json({ removed: true });
      }
      if (request.method === "GET") {
        const result = await env.IMAGES.prepare(
          "SELECT hash, bytes, created FROM images WHERE channel = ?1 ORDER BY created DESC",
        )
          .bind(channel)
          .all();
        return json({ images: result.results, limit: MAX_IMAGES });
      }
      if (request.headers.get("content-type") !== "image/png")
        return json({ error: "Upload a PNG image." }, 415);
      const data = await boundedBody(request);
      validatePng(data);
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      // Immutable addresses preserve published scenes while editing replacements.
      // Admission and count run in one SQLite statement, including concurrent saves.
      const result = await env.IMAGES.prepare(
        `INSERT OR IGNORE INTO images (channel, hash, data, bytes, created)
         SELECT ?1, ?2, ?3, ?4, ?5
         WHERE (SELECT count(*) FROM images WHERE channel = ?1) < ?6
           AND (SELECT count(*) FROM images) < ?7`,
      )
        .bind(channel, digest, data.buffer, data.length, Date.now(), MAX_IMAGES, MAX_TOTAL_IMAGES)
        .run();
      if (!result.meta.changes) {
        const existing = await env.IMAGES.prepare(
          "SELECT hash FROM images WHERE channel = ?1 AND hash = ?2",
        )
          .bind(channel, digest)
          .first();
        if (!existing)
          return json(
            {
              error:
                "Image storage is full. Remove an unused image or contact Scene Studio support before uploading another.",
            },
            409,
          );
      }
      return json(
        { path: `/images/${channel}/${digest}.png`, bytes: data.length },
        201,
      );
    } catch (error) {
      // Never expose JWTs, secrets, or provider errors to clients or logs.
      return json(
        {
          error:
            error instanceof Rejected || error instanceof ChatAuthorizationError
              ? error.message
              : "Image service unavailable. Try again later.",
        },
        error instanceof Rejected || error instanceof ChatAuthorizationError ? error.status : 503,
      );
    }
  },
};

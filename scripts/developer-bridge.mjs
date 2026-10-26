// Local developer sandbox only. No Twitch, Cloudflare, or outbound requests.
// Sessions and secrets are memory-only and disappear when this process stops.
import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ORIGIN = "http://127.0.0.1:5186";
const MAX_BODY = 8192;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const eventName = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const hash = value => createHash("sha256").update(value).digest();
class Rejected extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new Rejected(status, message); };
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

function jsonValue(value, depth = 0) {
  if (depth > 20) fail(400, "JSON nesting must not exceed 20 levels.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) jsonValue(item, depth + 1); return; }
  if (isObject(value)) { for (const item of Object.values(value)) jsonValue(item, depth + 1); return; }
  fail(400, "Use finite JSON values only.");
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? ""))
    fail(415, "Use Content-Type: application/json.");
  if (request.headers["content-encoding"] && request.headers["content-encoding"] !== "identity")
    fail(415, "Compressed request bodies are not supported.");
  if (Number(request.headers["content-length"]) > MAX_BODY) fail(413, "Request bodies are limited to 8 KB.");
  const body = await new Promise((resolveBody, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];
    request.on("data", chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        settled = true;
        chunks.length = 0;
        reject(new Rejected(413, "Request bodies are limited to 8 KB."));
      } else chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      resolveBody(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", () => {
      if (!settled) { settled = true; reject(new Rejected(400, "Request body could not be read.")); }
    });
    request.on("aborted", () => {
      if (!settled) { settled = true; reject(new Rejected(400, "Request body was interrupted.")); }
    });
  });
  let value;
  try { value = JSON.parse(body); } catch { fail(400, "Send a valid JSON body."); }
  jsonValue(value);
  return value;
}

function boundedOption(value, maximum, label) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${label} must be from 1 to ${maximum}.`);
  return value;
}

// Call server.listen(0, '127.0.0.1') in tests, or use the script entry point.
// Optional lower limits and an injected millisecond clock keep tests deterministic.
export function createDeveloperServer({
  now = Date.now,
  maxSessions = 8,
  maxQueue = 100,
  sessionTtlMs = 3600000,
  eventTtlMs = 300000,
} = {}) {
  if (typeof now !== "function") throw new Error("now must be a clock function.");
  boundedOption(maxSessions, 8, "maxSessions");
  boundedOption(maxQueue, 100, "maxQueue");
  boundedOption(sessionTtlMs, 3600000, "sessionTtlMs");
  boundedOption(eventTtlMs, 300000, "eventTtlMs");
  const sessions = new Map();
  function currentTime() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - sessionTtlMs)
      fail(500, "Sandbox clock is unavailable.");
    return value;
  }
  function prune(at) {
    for (const [id, session] of sessions) if (session.expiresAt <= at) sessions.delete(id);
  }
  function trimQueue(queue, at) {
    queue.entries = queue.entries.filter(item => item.event.createdAt + eventTtlMs > at);
  }

  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Vary", "Origin");
    const send = (status, value) => {
      response.statusCode = status;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify(value));
    };
    try {
      const host = `127.0.0.1:${request.socket.localPort}`;
      const hostCount = request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === "host").length;
      if (hostCount !== 1 || request.headers.host !== host || !["127.0.0.1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress))
        fail(403, "This sandbox accepts only its loopback host.");
      const origin = request.headers.origin;
      if (origin !== undefined && origin !== ORIGIN) fail(403, "This browser origin is not allowed.");
      if (origin === ORIGIN) response.setHeader("Access-Control-Allow-Origin", ORIGIN);
      const base = `http://${host}`;
      let url;
      try { url = new URL(request.url, base); } catch { fail(400, "Invalid request URL."); }
      if (url.origin !== base) fail(400, "Use this sandbox's local URL.");
      if (request.method === "OPTIONS") {
        if (origin !== ORIGIN) fail(403, "Preflight requires the local builder origin.");
        if (!["GET", "POST", "PUT"].includes(request.headers["access-control-request-method"]))
          fail(403, "This preflight method is not supported.");
        const headers = (request.headers["access-control-request-headers"] ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
        if (headers.some(value => !["authorization", "content-type"].includes(value))) fail(403, "This preflight header is not supported.");
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        response.statusCode = 204;
        response.end();
        return;
      }
      const at = currentTime();
      prune(at);
      if (url.pathname === "/dev/session") {
        if (request.method !== "POST") fail(405, "Create sessions with POST.");
        if (origin !== ORIGIN) fail(403, "Create sessions from the local builder.");
        const body = await readJson(request);
        if (!isObject(body) || Object.keys(body).length) fail(400, "Create a session with an empty JSON object.");
        const issuedAt = currentTime();
        prune(issuedAt);
        if (sessions.size >= maxSessions) fail(429, "The local session limit is reached. Wait for a session to expire or restart the sandbox.");
        const channelId = randomUUID();
        const token = randomBytes(32).toString("base64url");
        const expiresAt = issuedAt + sessionTtlMs;
        sessions.set(channelId, {
          tokenHash: hash(token), expiresAt, state: {},
          events: { next: 1, entries: [] }, actions: { next: 1, entries: [] },
        });
        send(201, { channelId, token, baseUrl: `${base}/v1/channels/${channelId}`, expiresAt });
        return;
      }
      const match = url.pathname.match(/^\/v1\/channels\/([0-9a-f-]{36})\/(events|actions|state)$/);
      if (!match) fail(404, "Unknown local sandbox endpoint.");
      const session = sessions.get(match[1]);
      const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      const candidate = hash(token ?? "");
      const expected = session?.tokenHash ?? Buffer.alloc(32);
      const authorized = timingSafeEqual(candidate, expected);
      if (!session || !token || !authorized) fail(401, "Use the current token for this sandbox channel.");
      function verifyStillActive() {
        const completedAt = currentTime();
        if (session.expiresAt <= completedAt || sessions.get(match[1]) !== session)
          fail(401, "This sandbox session expired before the request completed.");
        return completedAt;
      }
      if (match[2] === "state") {
        if (request.method === "PUT") {
          const state = await readJson(request);
          if (!isObject(state)) fail(400, "State must be a JSON object.");
          verifyStillActive();
          session.state = state;
        } else if (request.method !== "GET") fail(405, "State supports GET and PUT.");
        send(200, { state: session.state });
        return;
      }
      const queue = session[match[2]];
      trimQueue(queue, at);
      if (request.method === "GET") {
        if (url.searchParams.getAll("after").length > 1) fail(400, "Use one after cursor.");
        const raw = url.searchParams.get("after") ?? "0";
        if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) fail(400, "after must be a nonnegative integer sequence.");
        send(200, { events: queue.entries.filter(item => item.event.sequence > Number(raw)).map(item => item.event), latestSequence: queue.next - 1 });
        return;
      }
      if (request.method !== "POST") fail(405, "Queues support GET and POST.");
      const body = await readJson(request);
      const completedAt = verifyStillActive();
      trimQueue(queue, completedAt);
      if (!isObject(body) || Object.keys(body).some(key => !["id", "name", "data"].includes(key)) ||
          typeof body.id !== "string" || !identifier.test(body.id) || typeof body.name !== "string" || !eventName.test(body.name))
        fail(400, "Events need a safe id and a name beginning with a letter, each at most 64 characters, plus optional JSON data.");
      const payload = { id: body.id, name: body.name, data: body.data ?? null };
      const fingerprint = hash(JSON.stringify(payload));
      // Recheck after reading the body: another request may have filled the queue.
      const duplicate = queue.entries.find(item => item.event.id === body.id);
      if (duplicate) {
        if (!timingSafeEqual(duplicate.fingerprint, fingerprint)) fail(409, "That id already belongs to a different payload.");
        send(200, { accepted: true, duplicate: true, event: duplicate.event });
        return;
      }
      if (queue.entries.length >= maxQueue) fail(429, "This queue is full. Events expire after five minutes; polling does not remove them.");
      const event = { ...payload, sequence: queue.next++, createdAt: completedAt };
      queue.entries.push({ fingerprint, event });
      send(201, { accepted: true, duplicate: false, event });
    } catch (error) {
      if (!request.complete) { response.setHeader("Connection", "close"); request.resume(); }
      send(error instanceof Rejected ? error.status : 500, { error: error instanceof Rejected ? error.message : "The local sandbox could not complete this request." });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 2000;
  server.setTimeout(10000, socket => socket.destroy());
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const server = createDeveloperServer();
  server.on("error", () => { console.error("The local developer sandbox could not start on 127.0.0.1:5190."); process.exitCode = 1; });
  server.listen(5190, "127.0.0.1", () => console.log("Scene Studio developer sandbox: http://127.0.0.1:5190 (local only; session keys are never logged)."));
}

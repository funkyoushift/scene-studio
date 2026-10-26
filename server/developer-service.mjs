// Foundation only: stores named events, but does not execute rules, send chat,
// broadcast to Twitch, fetch external URLs, or write viewer actions.
// The host router MUST cryptographically verify broadcaster JWTs before passing
// verifiedClaims for key management. Never pass claims decoded without verification.
export const DEVELOPER_LIMITS = Object.freeze({
  bodyBytes: 8192, keysPerChannel: 10, keysTotal: 1000,
  eventsPerChannel: 100, eventsTotal: 10000, stateChannels: 1000,
  retentionMs: 86400000, defaultKeySeconds: 30 * 86400, maxKeySeconds: 90 * 86400,
});
export const DEVELOPER_SCOPES = Object.freeze(["events:write", "state:read", "state:write", "actions:read"]);
const utf8 = new TextEncoder();
const channelPattern = /^[1-9][0-9]{0,19}$/;
const namePattern = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
const keyIdPattern = /^[a-f0-9]{32}$/;
const json = (value, status = 200, origin) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}) },
});
export class DeveloperError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new DeveloperError(status, code, message); };
const statement = (env, sql, ...values) => env.IMAGES.prepare(sql).bind(...values);
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8.encode(value))), b => b.toString(16).padStart(2, "0")).join("");
const randomHex = size => Array.from(crypto.getRandomValues(new Uint8Array(size)), b => b.toString(16).padStart(2, "0")).join("");
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "invalid_body", "Use a JSON object.");
  return value;
}
function fields(value, allowed) {
  object(value);
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(400, "unknown_field", "This request contains an unsupported field.");
}
// Stable data hashing gives identical JSON objects the same idempotency meaning.
// Depth is bounded before recursion; data is never treated as executable content.
function canonical(value, depth = 0) {
  if (depth > 16) fail(400, "data_too_deep", "JSON data must be at most 16 levels deep.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(",")}]`;
  if (typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(",")}}`;
  fail(400, "invalid_data", "Use finite JSON data.");
}
async function body(request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") fail(415, "json_required", "Use application/json.");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "invalid_body", "Missing JSON request.");
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > DEVELOPER_LIMITS.bodyBytes) { await reader.cancel(); fail(413, "body_too_large", "Requests must be at most 8 KB."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let parsed;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { fail(400, "invalid_body", "Use valid JSON."); }
  return object(parsed);
}
function ownBroadcaster(request, env, channel, claims, now) {
  if (!env.EXTENSION_ORIGIN || request.headers.get("origin") !== env.EXTENSION_ORIGIN ||
      claims?.role !== "broadcaster" || claims.user_id !== channel || claims.channel_id !== channel ||
      !Number.isFinite(claims.exp) || claims.exp <= Math.floor(now / 1000))
    fail(403, "broadcaster_required", "Open this channel’s Twitch configuration as its broadcaster.");
}
async function apiKey(request, env, channel, scope, now) {
  const token = request.headers.get("authorization")?.match(/^Bearer (ss_dev_([a-f0-9]{32})\.[a-f0-9]{64})$/);
  if (!token) fail(401, "invalid_key", "A valid developer API key is required.");
  // Lookup by the full random-token digest, not a plaintext secret comparison.
  const row = await statement(env, "SELECT id,channel,scopes,expires FROM developer_keys WHERE token_hash=?1 AND id=?2", await digest(token[1]), token[2]).first();
  if (!row || row.channel !== channel || row.expires <= now) fail(401, "invalid_key", "A valid developer API key is required.");
  const scopes = JSON.parse(row.scopes);
  if (!Array.isArray(scopes) || !scopes.includes(scope)) fail(403, "scope_required", `This key requires ${scope}.`);
  return row;
}
async function requireLiveKey(env, key, channel, now) {
  const live = await statement(env, "SELECT id FROM developer_keys WHERE id=?1 AND channel=?2 AND expires>?3", key.id, channel, now).first();
  if (!live) fail(401, "invalid_key", "A valid developer API key is required.");
}
async function keys(request, env, channel, keyId, claims, now, currentTime) {
  ownBroadcaster(request, env, channel, claims, now);
  if (keyId) {
    if (!keyIdPattern.test(keyId)) fail(404, "not_found", "Key not found.");
    if (request.method !== "DELETE") fail(405, "method_not_allowed", "Use DELETE for a key.");
    await statement(env, "DELETE FROM developer_keys WHERE channel=?1 AND id=?2", channel, keyId).run();
    return { value: { id: keyId, revoked: true } };
  }
  if (request.method === "GET") {
    const result = await statement(env, "SELECT id,name,scopes,created,expires FROM developer_keys WHERE channel=?1 AND expires>?2 ORDER BY created,id LIMIT 10", channel, now).all();
    return { value: { keys: result.results.map(row => ({ ...row, scopes: JSON.parse(row.scopes) })) } };
  }
  if (request.method !== "POST") fail(405, "method_not_allowed", "Use GET or POST for keys.");
  const input = await body(request); fields(input, ["name", "scopes", "ttlSeconds"]);
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 80 || /[\u0000-\u001f\u007f]/.test(input.name)) fail(400, "invalid_name", "Name this connection using 1 to 80 characters.");
  if (!Array.isArray(input.scopes) || !input.scopes.length || input.scopes.length > DEVELOPER_SCOPES.length ||
      input.scopes.some(scope => !DEVELOPER_SCOPES.includes(scope)) || new Set(input.scopes).size !== input.scopes.length)
    fail(400, "invalid_scopes", "Choose distinct supported API scopes.");
  const ttl = input.ttlSeconds ?? DEVELOPER_LIMITS.defaultKeySeconds;
  if (!Number.isInteger(ttl) || ttl < 3600 || ttl > DEVELOPER_LIMITS.maxKeySeconds) fail(400, "invalid_expiry", "Key lifetime must be 1 hour to 90 days.");
  const id = randomHex(16), token = `ss_dev_${id}.${randomHex(32)}`, expires = now + ttl * 1000;
  const scopes = [...input.scopes].sort();
  const tokenHash = await digest(token);
  await statement(env, "DELETE FROM developer_keys WHERE expires<=?1", now).run();
  ownBroadcaster(request, env, channel, claims, currentTime());
  const created = await statement(env, `INSERT INTO developer_keys(id,channel,name,token_hash,scopes,created,expires)
    SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE
    (SELECT count(*) FROM developer_keys WHERE channel=?2)<?8 AND (SELECT count(*) FROM developer_keys)<?9`,
    id, channel, input.name.trim(), tokenHash, JSON.stringify(scopes), now, expires, DEVELOPER_LIMITS.keysPerChannel, DEVELOPER_LIMITS.keysTotal).run();
  if (!created.meta.changes) fail(409, "key_capacity", "The channel or service has reached its key limit. Revoke an unused key.");
  return { status: 201, value: { id, name: input.name.trim(), channel, scopes, created: now, expires, token, warning: "Save this key now; it will not be shown again." } };
}
function eventReceipt(row, replayed) {
  return { id: row.event_id, name: row.name, created: row.created, expires: row.expires, status: "accepted-not-delivered", delivered: false, replayed };
}
async function events(request, env, channel, now, currentTime) {
  if (request.method !== "POST") fail(405, "method_not_allowed", "Use POST for events.");
  const key = await apiKey(request, env, channel, "events:write", now);
  const input = await body(request); fields(input, ["id", "name", "data", "occurredAt"]);
  if (typeof input.id !== "string" || !idPattern.test(input.id) || typeof input.name !== "string" || !namePattern.test(input.name)) fail(400, "invalid_event", "Use a bounded event ID and a literal event name starting with a letter.");
  const occurred = input.occurredAt ?? now;
  if (!Number.isSafeInteger(occurred) || occurred < now - DEVELOPER_LIMITS.retentionMs || occurred > now + 60000) fail(400, "invalid_time", "Event time must be within the past 24 hours, with at most one minute of clock skew.");
  const data = canonical(input.data ?? {});
  const hash = await digest(canonical({ name: input.name, data: input.data ?? {}, occurredAt: input.occurredAt ?? null }));
  await requireLiveKey(env, key, channel, currentTime());
  await statement(env, "DELETE FROM developer_events WHERE expires<=?1", now).run();
  const existing = () => statement(env, "SELECT event_id,name,request_hash,created,expires FROM developer_events WHERE channel=?1 AND event_id=?2", channel, input.id).first();
  let row = await existing();
  if (row) {
    if (row.request_hash !== hash) fail(409, "event_conflict", "This event ID was already used with different data.");
    return { value: eventReceipt(row, true) };
  }
  const expires = now + DEVELOPER_LIMITS.retentionMs;
  const inserted = await statement(env, `INSERT OR IGNORE INTO developer_events(channel,event_id,key_id,request_hash,name,data,occurred,created,expires)
    SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9 WHERE
    (SELECT count(*) FROM developer_events WHERE channel=?1)<?10 AND (SELECT count(*) FROM developer_events)<?11
    AND EXISTS(SELECT 1 FROM developer_keys WHERE id=?3 AND channel=?1 AND expires>?12)`,
    channel, input.id, key.id, hash, input.name, data, occurred, now, expires, DEVELOPER_LIMITS.eventsPerChannel, DEVELOPER_LIMITS.eventsTotal, currentTime()).run();
  if (!inserted.meta.changes) {
    await requireLiveKey(env, key, channel, currentTime());
    row = await existing();
    if (row) {
      if (row.request_hash !== hash) fail(409, "event_conflict", "This event ID was already used with different data.");
      return { value: eventReceipt(row, true) };
    }
    fail(429, "event_capacity", "Event storage is full. Existing receipts are retained for 24 hours.");
  }
  return { status: 202, value: eventReceipt({ event_id: input.id, name: input.name, created: now, expires }, false) };
}
async function state(request, env, channel, now, currentTime) {
  if (!["GET", "PUT"].includes(request.method)) fail(405, "method_not_allowed", "Use GET or PUT for state.");
  const key = await apiKey(request, env, channel, request.method === "GET" ? "state:read" : "state:write", now);
  if (request.method === "GET") {
    const row = await statement(env, "SELECT data,revision,updated FROM developer_state WHERE channel=?1", channel).first();
    return { value: { state: row ? JSON.parse(row.data) : {}, revision: row?.revision ?? 0, updatedAt: row?.updated ?? null, delivered: false } };
  }
  const input = await body(request); fields(input, ["state", "expectedRevision"]); object(input.state);
  const revision = input.expectedRevision;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) fail(400, "invalid_revision", "Supply the state revision returned by GET (0 for new state).");
  const data = canonical(input.state);
  const result = revision === 0
    ? await statement(env, `INSERT OR IGNORE INTO developer_state(channel,data,revision,updated)
      SELECT ?1,?2,1,?3 WHERE (SELECT count(*) FROM developer_state)<?4
      AND EXISTS(SELECT 1 FROM developer_keys WHERE id=?5 AND channel=?1 AND expires>?6)`, channel, data, now, DEVELOPER_LIMITS.stateChannels, key.id, currentTime()).run()
    : await statement(env, `UPDATE developer_state SET data=?2,revision=revision+1,updated=?3 WHERE channel=?1 AND revision=?4
      AND EXISTS(SELECT 1 FROM developer_keys WHERE id=?5 AND channel=?1 AND expires>?6)`, channel, data, now, revision, key.id, currentTime()).run();
  if (!result.meta.changes) {
    await requireLiveKey(env, key, channel, currentTime());
    fail(409, "state_conflict", "State changed or storage is full. Read current state before retrying.");
  }
  return { value: { revision: revision + 1, updatedAt: now, delivered: false } };
}
async function actions(request, env, channel, now) {
  if (request.method !== "GET") fail(405, "method_not_allowed", "Actions are read-only.");
  await apiKey(request, env, channel, "actions:read", now);
  const url = new URL(request.url), raw = url.searchParams.get("after") ?? "0";
  if (!/^(0|[1-9][0-9]{0,15})$/.test(raw) || !Number.isSafeInteger(Number(raw))) fail(400, "invalid_cursor", "Use a nonnegative action sequence cursor.");
  const after = Number(raw);
  const result = await statement(env, "SELECT sequence,action_id,name,data,created,expires FROM developer_actions WHERE channel=?1 AND sequence>?2 AND expires>?3 ORDER BY sequence LIMIT 51", channel, after, now).all();
  const rows = result.results.slice(0, 50);
  return { value: { actions: rows.map(row => ({ sequence: row.sequence, id: row.action_id, name: row.name, data: JSON.parse(row.data), created: row.created, expires: row.expires })), nextCursor: rows.at(-1)?.sequence ?? after, hasMore: result.results.length > 50, viewerActionDeliveryEnabled: false } };
}

export async function developerRequest(request, env, channel, { verifiedClaims, now = Date.now(), clock } = {}) {
  const started = Date.now();
  const currentTime = () => {
    const value = clock ? clock() : now + Math.max(0, Date.now() - started);
    if (!Number.isSafeInteger(value) || value < now) fail(400, "invalid_request", "Invalid request clock.");
    return value;
  };
  const origin = request.headers.get("origin") === env.EXTENSION_ORIGIN ? env.EXTENSION_ORIGIN : undefined;
  try {
    if (!channelPattern.test(channel) || !Number.isSafeInteger(now) || now < 0) fail(400, "invalid_request", "Invalid channel or clock.");
    if (request.headers.has("origin") && (!env.EXTENSION_ORIGIN || request.headers.get("origin") !== env.EXTENSION_ORIGIN))
      fail(403, "origin_not_allowed", "This browser origin is not allowed. Use the Twitch configuration or a server-side adapter.");
    const match = new URL(request.url).pathname.match(/^\/v2\/channels\/([1-9][0-9]{0,19})\/(keys|events|state|actions)(?:\/([A-Za-z0-9_-]+))?$/);
    if (!match || match[1] !== channel || (match[3] && match[2] !== "keys")) fail(404, "not_found", "Endpoint not found.");
    let result;
    if (match[2] === "keys") result = await keys(request, env, channel, match[3], verifiedClaims, now, currentTime);
    else if (match[2] === "events") result = await events(request, env, channel, now, currentTime);
    else if (match[2] === "state") result = await state(request, env, channel, now, currentTime);
    else result = await actions(request, env, channel, now);
    return json(result.value, result.status ?? 200, origin);
  } catch (error) {
    if (error instanceof DeveloperError) return json({ error: error.code, message: error.message }, error.status, origin);
    return json({ error: "service_unavailable", message: "Developer API is temporarily unavailable. No delivery has been attempted." }, 503, origin);
  }
}

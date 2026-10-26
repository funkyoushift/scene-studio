import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { developerRequest, DEVELOPER_LIMITS } from "../server/developer-service.mjs";

const now = 1800000000000, origin = "https://test.ext-twitch.tv";
const claims = channel => ({ role: "broadcaster", user_id: channel, channel_id: channel, exp: now / 1000 + 200 * 86400 });
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../server/developer-schema.sql", import.meta.url), "utf8"));
  t.after(() => db.close());
  const env = { EXTENSION_ORIGIN: origin, IMAGES: { prepare(sql) { return { bind(...args) {
    const query = db.prepare(sql), values = Object.fromEntries(args.map((value, index) => [String(index + 1), value]));
    return { first: async () => query.get(values) ?? null, run: async () => { env.beforeRun?.(sql); return { meta: query.run(values) }; }, all: async () => ({ results: query.all(values) }) };
  } }; } } };
  async function call(path, { method = "GET", channel = "123", token, input, from, verifiedClaims, at = now, raw } = {}) {
    const headers = { ...(from ? { Origin: from } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(input !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}) };
    const response = await developerRequest(new Request(`https://api.example/v2/channels/${channel}/${path}`, {
      method, headers, ...(input !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(input) } : {}),
    }), env, channel, { verifiedClaims, now: at });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  async function key(scopes = ["events:write", "state:read", "state:write", "actions:read"], channel = "123", extra = {}) {
    const result = await call("keys", { method: "POST", channel, from: origin, verifiedClaims: claims(channel), input: { name: "Test adapter", scopes, ...extra } });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  }
  return { db, env, call, key };
}

test("key management requires verified own broadcaster claims and exact origin; keys are hashed and shown once", async t => {
  const s = fixture(t);
  for (const options of [{}, { verifiedClaims: claims("123") }, { from: origin }, { from: "https://preview.example", verifiedClaims: claims("123") }, { from: origin, verifiedClaims: claims("456") }, { from: origin, verifiedClaims: { ...claims("123"), role: "moderator" } }, { from: origin, verifiedClaims: { ...claims("123"), exp: now / 1000 } }]) {
    assert.equal((await s.call("keys", { method: "POST", input: { name: "Denied", scopes: ["events:write"] }, ...options })).status, 403);
  }
  const key = await s.key();
  assert.match(key.token, /^ss_dev_[a-f0-9]{32}\.[a-f0-9]{64}$/);
  assert.equal(key.expires, now + 30 * 86400000);
  const row = s.db.prepare("SELECT * FROM developer_keys").get();
  assert.match(row.token_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(row).includes(key.token), false);
  const listed = await s.call("keys", { from: origin, verifiedClaims: claims("123") });
  assert.equal(listed.body.keys.length, 1);
  assert.equal(JSON.stringify(listed.body).includes(key.token), false);
  assert.equal(listed.body.keys[0].token_hash, undefined);
  assert.equal(listed.headers.get("cache-control"), "no-store");
  assert.equal(listed.headers.get("access-control-allow-origin"), origin);
});

test("API credentials enforce channel isolation, scopes, expiry, revocation, and machine callers need no Origin", async t => {
  const s = fixture(t), key = await s.key(["state:read"], "123", { ttlSeconds: 3600 });
  assert.equal((await s.call("state", { token: key.token })).status, 200);
  assert.equal((await s.call("state", { token: key.token, from: "https://preview.example" })).status, 403);
  assert.equal((await s.call("state", { token: key.token, channel: "456" })).status, 401);
  assert.equal((await s.call("state", { token: key.token + "x" })).status, 401);
  assert.equal((await s.call("state", {})).status, 401);
  assert.equal((await s.call("state", { token: key.token, at: now + 3600000 })).status, 401);
  for (const [path, method, input] of [["events", "POST", { id: "a", name: "boss" }], ["state", "PUT", { state: {}, expectedRevision: 0 }], ["actions", "GET", undefined]]) {
    assert.equal((await s.call(path, { token: key.token, method, input })).status, 403);
  }
  assert.equal((await s.call(`keys/${key.id}`, { method: "DELETE", channel: "456", from: origin, verifiedClaims: claims("456") })).status, 200);
  assert.equal((await s.call("state", { token: key.token })).status, 200, "other channel cannot revoke this key");
  assert.equal((await s.call(`keys/${key.id}`, { method: "DELETE", from: origin, verifiedClaims: claims("123") })).body.revoked, true);
  assert.equal((await s.call("state", { token: key.token })).status, 401);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM developer_keys").get().n, 0);
});

test("keys reject unsupported scopes or lifetime and enforce atomic channel/global capacity", async t => {
  const s = fixture(t);
  const create = input => s.call("keys", { method: "POST", from: origin, verifiedClaims: claims("123"), input: { name: "Adapter", scopes: ["state:read"], ...input } });
  for (const input of [{ scopes: [] }, { scopes: ["admin"] }, { scopes: ["state:read", "state:read"] }, { ttlSeconds: 3599 }, { ttlSeconds: DEVELOPER_LIMITS.maxKeySeconds + 1 }, { ttlSeconds: 1.5 }, { name: "\n" }]) assert.equal((await create(input)).status, 400);
  const results = await Promise.all(Array.from({ length: 12 }, () => create({})));
  assert.equal(results.filter(result => result.status === 201).length, 10);
  assert.equal(results.filter(result => result.body.error === "key_capacity").length, 2);
  s.db.prepare("UPDATE developer_keys SET expires=?").run(now);
  await s.key();
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM developer_keys").get().n, 1, "expired keys are reclaimed");
  const insert = s.db.prepare("INSERT INTO developer_keys VALUES(?,?,?,?,?,?,?)");
  for (let i = 0; i < 999; i++) insert.run(`seed${i}`, "456", "Seed", `hash${i}`, '["state:read"]', now, now + 86400000);
  assert.equal((await create({})).body.error, "key_capacity");
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM developer_keys").get().n, 1000);
});

test("events are immutable undelivered receipts; duplicate requests are replayed and changed payloads conflict", async t => {
  const s = fixture(t), key = await s.key(["events:write"]);
  const input = { id: "boss-1", name: "boss_defeated", data: { game: "custom", score: 12 } };
  const post = (body, options = {}) => s.call("events", { method: "POST", token: key.token, input: body, ...options });
  const first = await post(input);
  assert.equal(first.status, 202);
  assert.equal(first.body.status, "accepted-not-delivered");
  assert.equal(first.body.delivered, false);
  const replay = await post({ ...input, data: { score: 12, game: "custom" } }, { at: now + 500 });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.created, first.body.created);
  assert.equal((await post({ ...input, data: { score: 99 } })).body.error, "event_conflict");
  assert.equal((await post({ ...input, name: "another_event" })).status, 409);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM developer_events").get().n, 1);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM developer_actions").get().n, 0, "events do not invent viewer actions");
  const other = await s.key(["events:write"], "456");
  assert.equal((await post(input, { token: other.token, channel: "456" })).status, 202);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM developer_events").get().n, 2);
  const concurrent = await Promise.all([post({ ...input, id: "race" }), post({ ...input, id: "race" })]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 202]);
});

test("events reject oversized or invalid data and enforce retained per-channel/global caps without eviction", async t => {
  const s = fixture(t), key = await s.key(["events:write"]);
  const post = (input, at = now) => s.call("events", { method: "POST", token: key.token, input, at });
  for (const input of [{ id: "bad", name: "*" }, { id: "../bad", name: "boss" }, { id: "bad", name: "1boss" }, { id: "bad", name: "a".repeat(65) }, { id: "bad", name: "boss", execute: "anything" }, { id: "bad", name: "boss", occurredAt: now - 86400001 }]) assert.equal((await post(input)).status, 400);
  assert.equal((await post({ id: "large", name: "boss", data: "a".repeat(8192) })).status, 413);
  assert.equal((await s.call("events", { method: "POST", token: key.token, raw: '{"id":"deep","name":"boss","data":' + '['.repeat(20) + '1' + ']'.repeat(20) + '}' })).body.error, "data_too_deep");
  const insert = s.db.prepare("INSERT INTO developer_events VALUES(?,?,?,?,?,?,?,?,?)");
  for (let i = 0; i < 100; i++) insert.run("123", `e${i}`, key.id, `hash${i}`, "boss", "{}", now, now, now + 86400000);
  assert.equal((await post({ id: "full", name: "boss" })).status, 429);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM developer_events").get().n, 100);
  assert.equal((await post({ id: "after-expiry", name: "boss" }, now + 86400000)).status, 202);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM developer_events").get().n, 1);
  for (let i = 0; i < 9999; i++) insert.run("456", `g${i}`, "seed", `global${i}`, "boss", "{}", now, now, now + 2 * 86400000);
  assert.equal((await post({ id: "global-full", name: "boss" }, now + 86400000)).status, 429);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM developer_events").get().n, 10000);
});

test("state uses scoped reads/writes and optimistic revisions without changing another channel", async t => {
  const s = fixture(t), key = await s.key(["state:read", "state:write"]), other = await s.key(["state:read", "state:write"], "456");
  assert.equal((await s.call("state", { token: key.token })).body.revision, 0);
  const put = (state, revision, options = {}) => s.call("state", { method: "PUT", token: key.token, input: { state, expectedRevision: revision }, ...options });
  assert.equal((await put({ boss: "alive" }, 0)).body.revision, 1);
  assert.equal((await put({ boss: "stale" }, 0)).status, 409);
  const race = await Promise.all([put({ boss: "won" }, 1), put({ boss: "lost" }, 1)]);
  assert.deepEqual(race.map(result => result.status).sort(), [200, 409]);
  const current = await s.call("state", { token: key.token });
  assert.equal(current.body.revision, 2);
  assert.deepEqual(current.body.state, { boss: "won" });
  assert.equal(current.body.delivered, false);
  assert.deepEqual((await s.call("state", { token: other.token, channel: "456" })).body.state, {});
  assert.equal((await put({ huge: "x".repeat(8192) }, 2)).status, 413);
  const insert = s.db.prepare("INSERT INTO developer_state VALUES(?,?,?,?)");
  for (let i = 0; i < 999; i++) insert.run(String(1000 + i), "{}", 1, now);
  assert.equal((await put({}, 0, { channel: "456", token: other.token })).status, 409);
  assert.equal((await put({ boss: "updated" }, 2)).status, 200, "existing state can be updated at capacity");
});

test("actions are channel-scoped read-only cursor pages and exclude expired records", async t => {
  const s = fixture(t), key = await s.key(["actions:read"]);
  const insert = s.db.prepare("INSERT INTO developer_actions(channel,action_id,name,data,created,expires) VALUES(?,?,?,?,?,?)");
  insert.run("123", "old", "jump", "{}", now - 90000000, now);
  insert.run("456", "private", "jump", '{"secret":"other-channel"}', now, now + 86400000);
  for (let i = 0; i < 51; i++) insert.run("123", `a${i}`, "jump", '{"strength":1}', now, now + 86400000);
  const first = await s.call("actions", { token: key.token });
  assert.equal(first.body.actions.length, 50);
  assert.equal(first.body.hasMore, true);
  assert.equal(first.body.viewerActionDeliveryEnabled, false);
  assert.equal(JSON.stringify(first.body).includes("other-channel"), false);
  const second = await s.call(`actions?after=${first.body.nextCursor}`, { token: key.token });
  assert.equal(second.body.actions.length, 1);
  assert.equal(second.body.hasMore, false);
  assert.equal((await s.call("actions", { token: key.token })).body.actions.length, 50, "polling does not consume actions");
  assert.equal((await s.call("actions", { token: key.token, method: "POST", input: { name: "execute" } })).status, 405);
  assert.equal((await s.call("actions?after=-1", { token: key.token })).status, 400);
  assert.equal((await s.call("actions?after=9007199254740992", { token: key.token })).status, 400);
});

test("database failures return sanitized responses and URL channel cannot disagree with router channel", async t => {
  const s = fixture(t);
  const failed = await developerRequest(new Request("https://api.example/v2/channels/123/state", { headers: { Authorization: `Bearer ss_dev_${"a".repeat(32)}.${"b".repeat(64)}` } }), { ...s.env, IMAGES: { prepare() { throw new Error("database token super-secret"); } } }, "123", { now });
  assert.equal(failed.status, 503);
  assert.equal((await failed.text()).includes("super-secret"), false);
  const mismatch = await developerRequest(new Request("https://api.example/v2/channels/456/state"), s.env, "123", { now });
  assert.equal(mismatch.status, 404);
});

test("revocation during request-body reading prevents event and state writes", async t => {
  const s = fixture(t);
  for (const [path, method, input] of [["events", "POST", { id: "revoked", name: "boss" }], ["state", "PUT", { state: { boss: "won" }, expectedRevision: 0 }]]) {
    const key = await s.key();
    const request = new Request(`https://api.example/v2/channels/123/${path}`, { method, headers: { Authorization: `Bearer ${key.token}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const reader = request.body.getReader();
    Object.defineProperty(request, "body", { value: { getReader: () => ({
      read: async () => { const chunk = await reader.read(); s.db.prepare("DELETE FROM developer_keys WHERE id=?").run(key.id); return chunk; },
      cancel: () => reader.cancel(),
    }) } });
    const response = await developerRequest(request, s.env, "123", { now });
    assert.equal(response.status, 401);
    assert.equal(s.db.prepare("SELECT count(*) AS n FROM developer_events").get().n, 0);
    assert.equal(s.db.prepare("SELECT count(*) AS n FROM developer_state").get().n, 0);
  }
});

test("atomic key guards reject revocation immediately before SQL event admission and state insertion/update", async t => {
  const s = fixture(t);
  for (const [path, input, sqlPattern] of [
    ["events", { id: "race", name: "boss" }, /INSERT OR IGNORE INTO developer_events/],
    ["state", { state: { boss: "won" }, expectedRevision: 0 }, /INSERT OR IGNORE INTO developer_state/],
    ["state", { state: { boss: "won" }, expectedRevision: 1 }, /UPDATE developer_state SET/],
  ]) {
    if (input.expectedRevision === 1) s.db.prepare("INSERT INTO developer_state VALUES(?,?,?,?)").run("123", '{"boss":"alive"}', 1, now);
    const key = await s.key();
    s.env.beforeRun = sql => { if (sqlPattern.test(sql)) { s.db.prepare("DELETE FROM developer_keys WHERE id=?").run(key.id); } };
    const result = await s.call(path, { method: path === "events" ? "POST" : "PUT", token: key.token, input });
    assert.equal(result.status, 401);
    s.env.beforeRun = undefined;
    assert.equal(s.db.prepare("SELECT count(*) AS n FROM developer_events").get().n, 0);
    const state = s.db.prepare("SELECT data,revision FROM developer_state").get();
    if (input.expectedRevision === 1) { assert.equal(state.revision, 1); assert.equal(state.data, '{"boss":"alive"}'); }
    else assert.equal(state, undefined);
  }
});

test("expiry is rechecked after reading bodies, including broadcaster key creation", async t => {
  const s = fixture(t), key = await s.key(["state:write"], "123", { ttlSeconds: 3600 });
  const request = new Request("https://api.example/v2/channels/123/state", { method: "PUT", headers: { Authorization: `Bearer ${key.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ state: { accepted: false }, expectedRevision: 0 }) });
  const response = await developerRequest(request, s.env, "123", { now, clock: () => now + 3600000 });
  assert.equal(response.status, 401);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM developer_state").get().n, 0);
  const create = new Request("https://api.example/v2/channels/123/keys", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Expired broadcaster", scopes: ["state:read"] }) });
  const expired = await developerRequest(create, s.env, "123", { now, clock: () => now + 1000, verifiedClaims: { ...claims("123"), exp: now / 1000 + 1 } });
  assert.equal(expired.status, 403);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM developer_keys").get().n, 1);
});

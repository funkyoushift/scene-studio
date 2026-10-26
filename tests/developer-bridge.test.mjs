import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { createDeveloperServer } from "../scripts/developer-bridge.mjs";

const ORIGIN = "http://127.0.0.1:5186";
async function sandbox(t, options = {}) {
  const server = createDeveloperServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, { token, origin, method = "GET", body, headers = {} } = {}) {
    const response = await fetch(`${base}${path}`, {
      method, headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin !== undefined ? { Origin: origin } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
  }
  async function session() {
    const result = await call("/dev/session", { method: "POST", origin: ORIGIN, body: {} });
    assert.equal(result.status, 201);
    return { ...result.body, path: `/v1/channels/${result.body.channelId}` };
  }
  return { server, base, call, session };
}

test("local sessions require the exact origin, host and JSON; CORS preflight is narrow", async t => {
  const { base, call, session } = await sandbox(t);
  assert.equal((await call("/dev/session", { method: "POST", body: {} })).status, 403);
  assert.equal((await call("/dev/session", { method: "POST", origin: "http://localhost:5186", body: {} })).status, 403);
  assert.equal((await call("/dev/session", { method: "POST", origin: ORIGIN, body: {}, headers: { "Content-Type": "text/plain" } })).status, 415);
  const wrongHostStatus = await new Promise((resolveRequest, reject) => {
    const request = httpRequest(`${base}/dev/session`, { method: "POST", headers: { Host: "attacker.example", Origin: ORIGIN, "Content-Type": "application/json" } }, response => {
      response.resume(); response.on("end", () => resolveRequest(response.statusCode));
    });
    request.on("error", reject); request.end("{}");
  });
  assert.equal(wrongHostStatus, 403);
  assert.equal((await call("/dev/session", { method: "POST", origin: ORIGIN, body: { unexpected: true } })).status, 400);
  const preflight = await call("/dev/session", { method: "OPTIONS", origin: ORIGIN, headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(preflight.headers.get("Access-Control-Allow-Credentials"), null);
  assert.equal((await call("/dev/session", { method: "OPTIONS", origin: ORIGIN, headers: { "Access-Control-Request-Method": "DELETE" } })).status, 403);
  const grant = await session();
  assert.match(grant.channelId, /^[0-9a-f-]{36}$/);
  assert.match(grant.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(grant.baseUrl, `${base}${grant.path}`);
  assert.ok(grant.expiresAt > Date.now());
  const state = await call(`${grant.path}/state`, { token: grant.token, origin: ORIGIN });
  assert.equal(state.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(state.headers.get("Cache-Control"), "no-store");
});

test("tokens are scoped to one ephemeral channel and never returned by reads", async t => {
  const { call, session } = await sandbox(t);
  const one = await session();
  const two = await session();
  assert.notEqual(one.token, two.token);
  assert.equal((await call(`${one.path}/events`)).status, 401);
  assert.equal((await call(`${one.path}/events`, { token: two.token })).status, 401);
  assert.equal((await call(`${two.path}/state`, { token: one.token })).status, 401);
  assert.equal((await call(`${one.path}/events`, { token: one.token, origin: "https://example.com" })).status, 403);
  const own = await call(`${one.path}/events`, { token: one.token });
  assert.equal(own.status, 200, "authenticated no-Origin CLI access works");
  assert.deepEqual(own.body, { events: [], latestSequence: 0 });
  assert.ok(!JSON.stringify(own.body).includes(one.token));
});

test("events and actions deduplicate independently and cursor reads are nondestructive", async t => {
  const { call, session } = await sandbox(t);
  const grant = await session();
  const post = (queue, body) => call(`${grant.path}/${queue}`, { token: grant.token, method: "POST", body });
  const event = { id: "evt-1", name: "viewer.cheer", data: { message: "hello" } };
  const first = await post("events", event);
  assert.equal(first.status, 201);
  assert.equal(first.body.duplicate, false);
  assert.equal(first.body.event.sequence, 1);
  const duplicate = await post("events", event);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.deepEqual(duplicate.body.event, first.body.event);
  assert.equal((await post("events", { ...event, data: "different" })).status, 409);
  assert.equal((await post("events", { id: "evt-2", name: "scene.changed" })).status, 201);
  assert.equal((await post("actions", event)).body.event.sequence, 1);
  for (let i = 0; i < 2; i++) {
    const read = await call(`${grant.path}/events?after=1`, { token: grant.token });
    assert.equal(read.body.latestSequence, 2);
    assert.deepEqual(read.body.events.map(item => item.id), ["evt-2"]);
  }
  assert.equal((await call(`${grant.path}/events?after=0`, { token: grant.token })).body.events.length, 2);
  assert.equal((await call(`${grant.path}/actions`, { token: grant.token })).body.events.length, 1);
  for (const cursor of ["-1", "1.5", "nope", "9007199254740992", "1&after=2"]) {
    assert.equal((await call(`${grant.path}/events?after=${cursor}`, { token: grant.token })).status, 400);
  }
});

test("state PUT accepts bounded JSON objects and preserves the previous state on failure", async t => {
  const { call, session } = await sandbox(t);
  const grant = await session();
  const target = `${grant.path}/state`;
  const state = { score: 12, nested: { ready: true }, values: [null, "a"] };
  assert.deepEqual((await call(target, { token: grant.token, method: "PUT", body: state })).body, { state });
  for (const value of [null, [], "text"]) assert.equal((await call(target, { token: grant.token, method: "PUT", body: value })).status, 400);
  assert.equal((await call(target, { token: grant.token, method: "PUT", body: { long: "x".repeat(8192) } })).status, 413);
  assert.deepEqual((await call(target, { token: grant.token })).body, { state });
  const another = await session();
  assert.deepEqual((await call(`${another.path}/state`, { token: another.token })).body, { state: {} });
});

test("queue admission refuses overflow, preserves existing events, and expires only by TTL", async t => {
  let clock = 1000;
  const { call, session } = await sandbox(t, { now: () => clock, maxQueue: 2, eventTtlMs: 100 });
  const grant = await session();
  const post = id => call(`${grant.path}/events`, { token: grant.token, method: "POST", body: { id, name: "test" } });
  await post("first"); await post("second");
  assert.equal((await post("third")).status, 429);
  assert.equal((await post("first")).body.duplicate, true, "duplicates remain readable at capacity");
  assert.equal((await call(`${grant.path}/events`, { token: grant.token })).body.events.length, 2);
  clock = 1099;
  assert.equal((await post("third")).status, 429);
  clock = 1100;
  const expired = await call(`${grant.path}/events`, { token: grant.token });
  assert.deepEqual(expired.body, { events: [], latestSequence: 2 });
  assert.equal((await post("third")).body.event.sequence, 3);
});

test("sessions have bounded admission and expire without persistent storage", async t => {
  let clock = 5000;
  const { call, session } = await sandbox(t, { now: () => clock, maxSessions: 2, sessionTtlMs: 100 });
  const first = await session(); await session();
  assert.equal((await call("/dev/session", { method: "POST", origin: ORIGIN, body: {} })).status, 429);
  clock = 5100;
  assert.equal((await call(`${first.path}/state`, { token: first.token })).status, 401);
  const replacement = await session();
  assert.notEqual(replacement.channelId, first.channelId);
  assert.notEqual(replacement.token, first.token);
});

test("invalid event data and streamed oversized bodies are rejected before admission", async t => {
  const { server, base, call, session } = await sandbox(t);
  const grant = await session();
  const path = `${grant.path}/events`;
  for (const body of [null, [], {}, { id: "a", name: "1wrong" }, { id: "bad/id", name: "okay" }, { id: "x".repeat(65), name: "okay" }, { id: "a", name: "okay", execute: "code" }]) {
    assert.equal((await call(path, { token: grant.token, method: "POST", body })).status, 400);
  }
  let nested = {};
  for (let i = 0; i < 22; i++) nested = { child: nested };
  assert.equal((await call(path, { token: grant.token, method: "POST", body: { id: "deep", name: "test", data: nested } })).status, 400);
  const malformed = await fetch(`${base}${path}`, { method: "POST", headers: { Authorization: `Bearer ${grant.token}`, "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
  const infinite = await fetch(`${base}${path}`, { method: "POST", headers: { Authorization: `Bearer ${grant.token}`, "Content-Type": "application/json" }, body: '{"id":"infinite","name":"test","data":1e999}' });
  assert.equal(infinite.status, 400);
  const oversized = await new Promise((resolveRequest, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port: server.address().port, path, method: "POST", headers: {
      Authorization: `Bearer ${grant.token}`, "Content-Type": "application/json", "Transfer-Encoding": "chunked",
    } }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolveRequest({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    request.on("error", reject);
    request.write('{"id":"huge","name":"test","data":"');
    request.write("x".repeat(9000));
    request.end('"}');
  });
  assert.equal(oversized.status, 413);
  assert.ok(!oversized.body.includes(grant.token));
  assert.deepEqual((await call(path, { token: grant.token })).body, { events: [], latestSequence: 0 });
});

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { pollArrivalChannel, readChatMembers } from "../server/presence-service.mjs";
import { createAutomationState, validateAutomations } from "../src/automations.mjs";
import { processShoutoutChat } from "../server/shoutout-service.mjs";
import { processAutomationInput } from "../server/automation-service.mjs";

const now = 1800000000000;
function fixture(t, { arrival = "presence", cooldownSeconds = 0 } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../server/automation-schema.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../server/shoutout-schema.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../server/presence-schema.sql", import.meta.url), "utf8"));
  t.after(() => db.close());
  const design = validateAutomations({ version: 1, carousels: [], rules: [{ id: "creator", name: "Creator", enabled: true,
    trigger: { type: "shoutout", mode: "automatic", arrival, users: [], types: ["partner"], exclusions: [] },
    effect: { type: "shoutout", message: "Visit {name}", color: "#11AAFF", durationSeconds: 12 }, cooldownSeconds }] });
  db.prepare("INSERT INTO automation_configs(channel,design,revision,owned_merch,updated,engine_state,next_tick,last_event_at) VALUES(?,?,?,?,?,?,?,?)")
    .run("123", JSON.stringify(design), 1, 0, now, JSON.stringify(createAutomationState(now)), now + 60000, now - 60000);
  const env = { AUTOMATIONS_ENABLED: "true", TWITCH_PRESENCE_ENABLED: "true", TWITCH_CHAT_CLIENT_ID: "testclient",
    IMAGES: { prepare(sql) { return { bind(...args) {
      const stmt = db.prepare(sql), values = Object.fromEntries(args.map((value, index) => [String(index + 1), value]));
      return { first: async () => stmt.get(values) ?? null, run: async () => ({ meta: stmt.run(values) }), all: async () => ({ results: stmt.all(values) }) };
    } }; } } };
  const state = { current: ["100", "123"], streamId: "stream-1", grantId: "grant-1", calls: [], sent: [],
    authFails: false, moderationFails: false, allowed: true, attempt: true, outcome: "sent" };
  const authorize = async () => { if (state.authFails) throw Error("authorization unavailable"); return { accessToken: "secret-token", grantId: state.grantId }; };
  const moderate = async (_env, _channel, id) => { if (state.moderationFails) throw Error("moderation unavailable"); state.calls.push(["moderate", id]); return { allowed: state.allowed }; };
  const stream = async () => state.streamId;
  const members = async () => [...state.current];
  const attempt = async (_env, _channel, _mode, id) => { state.calls.push(["attempt", id]); return state.attempt; };
  const shoutout = async (_env, _channel, input) => { state.sent.push(input); return { status: state.outcome }; };
  const poll = (at = now, extra = {}) => pollArrivalChannel(env, "123", { now: at, authorize, moderate, stream, members, attempt, shoutout, ...extra });
  const presence = () => db.prepare("SELECT * FROM shoutout_presence WHERE channel='123'").get();
  return { db, env, state, poll, presence };
}

test("first snapshot is silent; later chat arrivals can trigger once", async t => {
  const s = fixture(t);
  assert.equal((await s.poll()).status, "baseline");
  assert.equal(s.state.sent.length, 0);
  s.state.current.push("456");
  assert.equal((await s.poll(now + 60000)).status, "sent");
  assert.equal(s.state.sent.length, 1);
  assert.deepEqual(s.state.sent[0], { mode: "automatic", source: "presence", chatterId: "456", messageId: s.state.sent[0].messageId });
  assert.match(s.state.sent[0].messageId, /^arrival-[0-9a-f-]{36}$/);
  assert.equal((await s.poll(now + 120000)).status, "watching");
  assert.equal(s.state.sent.length, 1);
});

test("concurrent polls observe the lease and do not read or send twice", async t => {
  const s = fixture(t); await s.poll();
  s.state.current.push("456");
  let entered; const started = new Promise(resolve => { entered = resolve; });
  let unblock; const gate = new Promise(resolve => { unblock = resolve; });
  const members = async () => { entered(); await gate; return [...s.state.current]; };
  const first = pollArrivalChannel(s.env, "123", { now: now + 60000, authorize: async () => ({ accessToken: "x", grantId: "grant-1" }),
    moderate: async () => ({ allowed: true }), stream: async () => "stream-1", members, attempt: async () => true,
    shoutout: async (_env, _channel, input) => { s.state.sent.push(input); return { status: "sent" }; } });
  await started;
  assert.equal((await s.poll(now + 60000)).status, "busy");
  unblock();
  assert.equal((await first).status, "sent");
  assert.equal(s.state.sent.length, 1);
});

test("new stream, refreshed grant, and stale snapshots each reset silently", async t => {
  const s = fixture(t); await s.poll();
  s.state.current.push("456");
  assert.equal((await s.poll(now + 60000)).status, "sent");
  s.state.current.push("789"); s.state.streamId = "stream-2";
  assert.equal((await s.poll(now + 120000)).status, "baseline");
  assert.equal(s.state.sent.length, 1);
  s.state.current.push("790"); s.state.grantId = "grant-2";
  assert.equal((await s.poll(now + 180000)).status, "baseline");
  assert.equal(s.state.sent.length, 1);
  s.state.current.push("791");
  assert.equal((await s.poll(now + 600000)).status, "baseline");
  assert.equal(s.state.sent.length, 1);
});

test("offline clears state and failures to verify authorization fail closed", async t => {
  const s = fixture(t); await s.poll();
  s.state.current.push("456"); s.state.streamId = "";
  assert.equal((await s.poll(now + 60000)).status, "offline");
  assert.equal(s.presence().members, "[]");
  s.state.streamId = "stream-1"; s.state.authFails = true;
  assert.equal((await s.poll(now + 120000)).status, "unavailable");
  assert.equal(s.state.sent.length, 0);
  assert.equal(s.presence().status, "unavailable");
});

test("moderation failure and denial never send; failed checks consume their claimed arrival", async t => {
  const s = fixture(t); await s.poll(); s.state.current.push("456");
  s.state.moderationFails = true;
  assert.equal((await s.poll(now + 60000)).status, "unavailable");
  assert.equal(s.state.sent.length, 0);
  assert.deepEqual(JSON.parse(s.presence().pending), []);
  const denied = fixture(t); await denied.poll(); denied.state.current.push("456"); denied.state.allowed = false;
  assert.equal((await denied.poll(now + 60000)).status, "watching");
  assert.equal(denied.state.sent.length, 0);
});

test("cooldown retains a bounded deduplicated queue; channel and duplicate IDs are skipped", async t => {
  const s = fixture(t, { cooldownSeconds: 120 }); await s.poll();
  s.state.current.push("456", "456", "123", ...Array.from({ length: 10 }, (_, i) => String(500 + i)));
  s.db.prepare("UPDATE automation_configs SET last_event_at=? WHERE channel='123'").run(now + 60000);
  assert.equal((await s.poll(now + 60000)).status, "cooldown");
  const pending = JSON.parse(s.presence().pending);
  assert.equal(pending.length, 11);
  assert.equal(new Set(pending.map(item => item.id)).size, pending.length);
  assert.equal(s.state.sent.length, 0);
  s.db.prepare("UPDATE automation_configs SET last_event_at=? WHERE channel='123'").run(now - 60000);
  const result = await s.poll(now + 120000);
  assert.equal(result.status, "sent");
  assert.equal(s.state.sent.length, 1);
  assert.equal(s.state.sent[0].chatterId, "456");
});

test("only explicit presence rules are polled; disabled or malformed channel values are inert", async t => {
  const noPresence = fixture(t, { arrival: "chat" });
  assert.equal((await noPresence.poll()).status, "disabled");
  assert.equal(noPresence.presence().status, "disabled");
  const disabled = fixture(t); disabled.env.TWITCH_PRESENCE_ENABLED = "false";
  assert.equal((await disabled.poll()).status, "disabled");
  assert.equal((await pollArrivalChannel(disabled.env, "bad/id")).status, "disabled");
});

test("a timer winning the send race defers an arrival, then sends it exactly once", async t => {
  const s = fixture(t);
  Object.assign(s.env, { EXTENSION_SECRET: Buffer.alloc(32, 5).toString("base64"),
    EXTENSION_CLIENT_ID: "testclient", EXTENSION_OWNER: "999", TWITCH_CHAT_CLIENT_SECRET: "testsecret" });
  const design = JSON.parse(s.db.prepare("SELECT design FROM automation_configs").get().design);
  design.carousels.push({ id: "merch", title: "Merch", displaySeconds: 20,
    slides: [{ id: "mug", title: "Mug", caption: "", image: "", url: "" }] });
  design.rules.push({ id: "timer", name: "Merch timer", enabled: true,
    trigger: { type: "interval", everySeconds: 60 }, effect: { type: "carousel", carouselId: "merch" }, cooldownSeconds: 60 });
  s.db.prepare("UPDATE automation_configs SET design=?").run(JSON.stringify(validateAutomations(design)));
  const broadcasts = [];
  let raceTimer = true;
  const fetcher = async (address, options) => {
    const url = new URL(address);
    if (url.pathname === "/oauth2/token") return Response.json({ access_token: "test", token_type: "bearer" });
    if (url.pathname === "/helix/streams") return Response.json({ data: [{ id: "stream-1", user_id: "123", type: "live" }] });
    if (url.pathname === "/helix/users") {
      if (raceTimer) {
        raceTimer = false;
        assert.equal((await processAutomationInput(s.env, "123", { type: "tick" }, { now: now + 60000, fetcher })).status, "sent");
      }
      return Response.json({ data: [{ id: "456", login: "arriving", display_name: "Arriving",
        broadcaster_type: "partner", profile_image_url: "" }] });
    }
    assert.equal(url.pathname, "/helix/extensions/pubsub");
    broadcasts.push(JSON.parse(JSON.parse(options.body).message));
    return new Response(null, { status: 204 });
  };
  const actual = { fetcher, shoutout: processShoutoutChat, processInput: processAutomationInput };
  await s.poll(now, actual);
  s.state.current.push("456");
  assert.equal((await s.poll(now + 60000, actual)).status, "cooldown");
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].effect.type, "carousel");
  assert.deepEqual(JSON.parse(s.presence().pending).map(x => x.id), ["456"]);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM shoutout_first_messages").get().n, 0);
  assert.equal((await s.poll(now + 120000, actual)).status, "sent");
  assert.equal(broadcasts.length, 2);
  assert.equal(broadcasts[1].shoutout.login, "arriving");
  assert.equal((await s.poll(now + 180000, actual)).status, "watching");
  assert.equal(broadcasts.length, 2);
});

test("uncertain outbound arrival is consumed and never requeued", async t => {
  const s = fixture(t); await s.poll(); s.state.current.push("456");
  s.state.outcome = "uncertain";
  assert.equal((await s.poll(now + 60000)).status, "uncertain");
  assert.deepEqual(JSON.parse(s.presence().pending), []);
  await s.poll(now + 120000);
  assert.equal(s.state.sent.length, 1);
});

test("readChatMembers merges two bounded pages and rejects malformed or oversized responses", async () => {
  const requests = [];
  const fetcher = async url => {
    requests.push(new URL(url));
    return requests.length === 1
      ? Response.json({ data: [{ user_id: "101" }], pagination: { cursor: "next" } })
      : Response.json({ data: [{ user_id: "102" }], pagination: {} });
  };
  assert.deepEqual(await readChatMembers({ TWITCH_CHAT_CLIENT_ID: "client" }, "123", "token", fetcher), ["101", "102"]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.get("first"), "1000");
  assert.equal(requests[1].searchParams.get("after"), "next");
  const bad = body => async () => new Response(body, { status: 200 });
  await assert.rejects(readChatMembers({ TWITCH_CHAT_CLIENT_ID: "client" }, "123", "token", bad("{")), /JSON|Unexpected|position/i);
  await assert.rejects(readChatMembers({ TWITCH_CHAT_CLIENT_ID: "client" }, "123", "token", async () => Response.json({ data: [{ user_id: "0" }] })), /Invalid chat list/);
  await assert.rejects(readChatMembers({ TWITCH_CHAT_CLIENT_ID: "client" }, "123", "token", async () => Response.json({ data: [{ user_id: "101" }], pagination: { cursor: "x".repeat(2049) } })), /cursor/);
  await assert.rejects(readChatMembers({ TWITCH_CHAT_CLIENT_ID: "client" }, "123", "token", async () => new Response("x".repeat(256001))), /too large/);
});

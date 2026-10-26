import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { automationRequest, processAutomationInput, hasMatchingKeywordRule, tickAutomations, HOSTED_AUTOMATION_LIMITS } from "../server/automation-service.mjs";
import { IMAGE_ORIGIN } from "../src/image-address.mjs";

const now = 1800000000000, origin = "https://test.ext-twitch.tv";
const claims = (channel = "123") => ({ role: "broadcaster", user_id: channel, channel_id: channel, exp: now / 1000 + 3 * 86400 });
function design() {
  return { version: 1, carousels: [{ id: "merch", title: "My collection", displaySeconds: 20, slides: [{ id: "shirt", title: "My shirt", caption: "", image: "", url: "" }] }], rules: [
    { id: "chat", name: "Chat celebration", enabled: true, trigger: { type: "keyword", phrase: "party", match: "word" }, effect: { type: "celebrate", message: "The party is here" }, cooldownSeconds: 20 },
    { id: "timer", name: "Show collection", enabled: true, trigger: { type: "interval", everySeconds: 60 }, effect: { type: "carousel", carouselId: "merch" }, cooldownSeconds: 60 },
    { id: "external", name: "Game event", enabled: true, trigger: { type: "external", event: "boss_defeated" }, effect: { type: "celebrate", message: "You won" }, cooldownSeconds: 20 },
  ] };
}
function fixture(t) {
  t.mock.method(Date, "now", () => now);
  const db = new DatabaseSync(":memory:"); db.exec(readFileSync(new URL("../server/automation-schema.sql", import.meta.url), "utf8")); t.after(() => db.close());
  let queries = 0;
  const env = { AUTOMATIONS_ENABLED: "true", EXTENSION_ORIGIN: origin, EXTENSION_SECRET: Buffer.alloc(32, 5).toString("base64"), EXTENSION_CLIENT_ID: "testclient", EXTENSION_OWNER: "999", MERCH_TEST_STORES: '{"123":"https://streamlabs.com/FunkYouSHiFT/merch"}',
    IMAGES: { prepare(sql) { return { bind(...args) { const query = db.prepare(sql), values = Object.fromEntries(args.map((value, index) => [String(index + 1), value]));
      return { first: async () => { queries++; const row = query.get(values) ?? null; env.afterFirst?.(sql); return row; }, run: async () => { queries++; env.beforeRun?.(sql); return { meta: query.run(values) }; }, all: async () => { queries++; return { results: query.all(values) }; } };
    } }; } },
  };
  const sent = [];
  const fetcher = async (url, options) => {
    assert.equal(url, "https://api.twitch.tv/helix/extensions/pubsub"); assert.equal(options.redirect, "manual"); assert.ok(options.signal);
    const body = JSON.parse(options.body), jwt = JSON.parse(Buffer.from(options.headers.Authorization.split(".")[1], "base64url"));
    assert.equal(jwt.channel_id, body.broadcaster_id); assert.deepEqual(jwt.pubsub_perms.send, ["broadcast"]); assert.deepEqual(body.target, ["broadcast"]);
    sent.push({ channel: body.broadcaster_id, event: JSON.parse(body.message) });
    return new Response(null, { status: 204 });
  };
  async function call(path = "config", { method = "GET", channel = "123", input, auth = claims(channel), from = origin, at = now, sender = fetcher } = {}) {
    const request = new Request(`https://api.example/v1/automations/${channel}/${path}`, { method, headers: { Origin: from, ...(input !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(input !== undefined ? { body: JSON.stringify(input) } : {}) });
    const response = await automationRequest(request, env, channel, { claims: auth, now: at, fetcher: sender });
    return { status: response.status, body: await response.json() };
  }
  const save = (value = design(), options = {}) => call("config", { method: "PUT", input: { design: value, expectedRevision: 0 }, ...options });
  return { db, env, sent, fetcher, call, save, queryCount: () => queries };
}

test("config read accepts channel viewer proof; mutations require own broadcaster and exact origin", async t => {
  const s = fixture(t);
  const viewer = { role: "viewer", channel_id: "123", exp: claims().exp };
  assert.deepEqual((await s.call("config", { auth: viewer })).body, { channelId: "123", revision: 0, design: { version: 1, carousels: [], rules: [] }, ownedMerch: false, updatedAt: null });
  for (const options of [{ auth: undefined, from: "https://wrong.example" }, { auth: claims("456") }, { auth: { ...claims(), exp: now / 1000 } }]) assert.ok((await s.call("config", options)).status >= 400);
  assert.equal((await s.save(design(), { auth: viewer })).status, 403);
  assert.equal((await s.save()).status, 200);
  assert.equal((await s.call("config", { channel: "456" })).body.revision, 0);
  s.env.AUTOMATIONS_ENABLED = "false";
  assert.equal((await s.call()).status, 404);
  assert.deepEqual(await tickAutomations(s.env), { checked: 0, sent: 0 });
});

test("active catch-up returns the latest sent moment without writes, receipt data, or new broadcasts", async t => {
  const s = fixture(t), viewer = { role: "viewer", channel_id: "123", exp: claims().exp };
  assert.deepEqual((await s.call("active", { auth: viewer })).body, { channelId: "123", revision: 0, event: null });
  await s.save();
  const fire = at => s.call("fire", { method: "POST", at, input: { eventId: crypto.randomUUID(), type: "carousel", carouselId: "merch" } });
  await fire(now);
  const latest = await fire(now + 8000);
  const before = s.db.prepare("SELECT * FROM automation_receipts ORDER BY created").all(), sent = s.sent.length;
  const active = await s.call("active", { auth: viewer, at: now + 9000 });
  assert.equal(active.status, 200);
  assert.deepEqual(active.body, { channelId: "123", revision: 1, event: latest.body.event });
  assert.deepEqual(s.db.prepare("SELECT * FROM automation_receipts ORDER BY created").all(), before);
  assert.equal(s.sent.length, sent);
  assert.deepEqual((await s.call("active", { channel: "456" })).body, { channelId: "456", revision: 0, event: null });
  // The 24-hour receipt remains, but the visual must disappear at its exact expiry.
  assert.equal((await s.call("active", { at: latest.body.event.expires })).body.event, null);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM automation_receipts").get().n, 2);
});

test("active catch-up excludes uncertain, pending, old-revision and misbound envelopes", async t => {
  const s = fixture(t); await s.save();
  const input = { eventId: crypto.randomUUID(), type: "carousel", carouselId: "merch" };
  const failed = await s.call("fire", { method: "POST", input, sender: async () => { throw Error("not confirmed"); } });
  assert.equal(failed.body.status, "uncertain");
  assert.equal((await s.call("active")).body.event, null);
  s.db.exec("UPDATE automation_receipts SET status='pending'");
  assert.equal((await s.call("active")).body.event, null);
  s.db.exec("UPDATE automation_receipts SET status='sent'");
  const valid = failed.body.event;
  for (const event of [{ ...valid, channelId: "456" }, { ...valid, revision: 2 }, { ...valid, eventId: crypto.randomUUID() }]) {
    s.db.prepare("UPDATE automation_receipts SET event=?").run(JSON.stringify(event));
    assert.equal((await s.call("active")).body.event, null);
  }
  for (const event of ["not json", JSON.stringify({ ...valid, padding: "a".repeat(4096) })]) {
    s.db.prepare("UPDATE automation_receipts SET event=?").run(event);
    assert.equal((await s.call("active")).body.event, null);
  }
  s.db.prepare("UPDATE automation_receipts SET event=?").run(JSON.stringify({ ...valid, privateReceipt: "must not escape", effect: { ...valid.effect, rawChat: "never expose" } }));
  assert.deepEqual((await s.call("active")).body.event, valid);
  await s.save(design(), { input: { design: design(), expectedRevision: 1 } });
  assert.deepEqual((await s.call("active")).body, { channelId: "123", revision: 2, event: null });
});

test("active catch-up authorizes before storage and supports GET only", async t => {
  const s = fixture(t);
  for (const options of [{ auth: null }, { auth: claims("456") }, { auth: { ...claims(), exp: now / 1000 } }, { from: "null" }, { from: "https://other.example" }])
    assert.ok((await s.call("active", options)).status >= 400);
  assert.equal((await s.call("active", { method: "POST" })).status, 405);
  assert.equal(s.queryCount(), 0);
});

test("active catch-up rechecks visual and authorization expiry after a slow read", async t => {
  const s = fixture(t); await s.save();
  await s.call("fire", { method: "POST", input: { eventId: crypto.randomUUID(), type: "carousel", carouselId: "merch" } });
  let wall = now;
  t.mock.method(Date, "now", () => wall);
  s.env.afterFirst = () => { wall += 20000; };
  assert.equal((await s.call("active")).body.event, null);
  wall = now;
  const expired = await s.call("active", { auth: { role: "viewer", channel_id: "123", exp: now / 1000 + 10 } });
  assert.equal(expired.status, 401);
});

test("config CAS preserves concurrent edits and saves even when change notification is uncertain", async t => {
  const s = fixture(t);
  const first = await s.save(); assert.equal(first.body.revision, 1); assert.equal(first.body.notification, "sent");
  assert.deepEqual(s.sent[0].event, { type: "scene-studio-automation-config", channelId: "123", revision: 1 });
  const race = await Promise.all([s.save(design(), { input: { design: design(), expectedRevision: 1 } }), s.save(design(), { input: { design: design(), expectedRevision: 1 } })]);
  assert.deepEqual(race.map(result => result.status).sort(), [200, 409]);
  const final = await s.save(design(), { input: { design: design(), expectedRevision: 2 }, sender: async () => { throw Error("private provider details"); } });
  assert.equal(final.status, 200); assert.equal(final.body.revision, 3); assert.equal(final.body.notification, "uncertain");
  assert.equal((await s.call()).body.revision, 3);
});

test("hosted designs require same-channel hosted images, minute timers, and explicit mapped-store ownership declaration", async t => {
  const s = fixture(t);
  for (const image of ["data:image/png;base64,aGk=", "https://untrusted.example/photo.png", `${IMAGE_ORIGIN}/images/456/${"a".repeat(64)}.png`]) {
    const candidate = design(); candidate.carousels[0].slides[0].image = image;
    assert.equal((await s.save(candidate)).status, 400);
  }
  const short = design(); short.rules[1].trigger.everySeconds = 59; assert.equal((await s.save(short)).body.error, "interval_too_short");
  for (const url of ["https://streamlabs.com/Another/merch/123", "https://streamlabs.com/FunkYouSHiFT/merch/123?ref=affiliate", "https://streamlabs.com/FunkYouSHiFT/merch/123#buy", "https://streamlabs.com/FunkYouSHiFT/merch/redirect", "https://streamlabs.com/FunkYouSHiFT/Merch/123", "https://streamlabs.com.evil.example/FunkYouSHiFT/merch/123"]) {
    const candidate = design(); candidate.carousels[0].slides[0].url = url;
    assert.equal((await s.save(candidate, { input: { design: candidate, expectedRevision: 0, ownedMerch: true } })).status, 400);
  }
  const valid = design(); valid.carousels[0].slides[0].url = "https://streamlabs.com/funkyoushift/merch/5469633";
  valid.carousels[0].slides[0].image = `${IMAGE_ORIGIN}/images/123/${"b".repeat(64)}.png`;
  assert.equal((await s.save(valid)).body.error, "store_not_allowed");
  assert.equal((await s.save(valid, { input: { design: valid, expectedRevision: 0, ownedMerch: true } })).status, 200);
  const other = design(); other.carousels[0].slides[0].url = valid.carousels[0].slides[0].url;
  assert.equal((await s.save(other, { channel: "456", input: { design: other, expectedRevision: 0, ownedMerch: true } })).status, 400);
});

test("manual actions only broadcast saved effects and duplicates never resend", async t => {
  const s = fixture(t); await s.save(); s.sent.length = 0;
  const input = { eventId: crypto.randomUUID(), type: "carousel", carouselId: "merch" };
  const first = await s.call("fire", { method: "POST", input });
  assert.equal(first.body.status, "sent"); assert.equal(first.body.event.revision, 1); assert.equal(first.body.event.expires, now + 20000);
  assert.equal(first.body.event.type, "scene-studio-automation"); assert.equal(first.body.event.channelId, "123");
  const replay = await s.call("fire", { method: "POST", input, at: now + 30000 });
  assert.equal(replay.body.replayed, true); assert.equal(s.sent.length, 1);
  assert.equal((await s.call("fire", { method: "POST", input: { ...input, type: "celebrate", message: "The party is here" }, at: now + 30000 })).status, 409);
  assert.equal((await s.call("fire", { method: "POST", input: { eventId: crypto.randomUUID(), type: "celebrate", message: "untrusted injected words" }, at: now + 30000 })).status, 409);
  assert.equal((await s.call("fire", { method: "POST", input: { ...input, eventId: crypto.randomUUID() }, at: now + 7999 })).status, 429);
  assert.equal((await s.call("fire", { method: "POST", input: { ...input, eventId: crypto.randomUUID() }, at: now + 8000 })).body.status, "sent");
});

test("keyword and external triggers use saved messages, per-rule cooldowns, no raw chat persistence", async t => {
  const s = fixture(t); await s.save(); s.sent.length = 0;
  assert.equal(await hasMatchingKeywordRule(s.env, "123", "NO PARTY YET"), true);
  assert.equal(await hasMatchingKeywordRule(s.env, "123", "departyard"), false);
  const input = { type: "message", id: "chat-1", text: "party and secret-chat-content" };
  const first = await processAutomationInput(s.env, "123", input, { now, fetcher: s.fetcher });
  assert.equal(first.status, "sent"); assert.equal(first.event.effect.message, "The party is here");
  assert.equal((await processAutomationInput(s.env, "123", input, { now: now + 30000, fetcher: s.fetcher })).replayed, true);
  assert.equal((await processAutomationInput(s.env, "123", { ...input, id: "chat-2" }, { now: now + 10000, fetcher: s.fetcher })).status, "no_match");
  assert.equal((await processAutomationInput(s.env, "123", { type: "external", id: "game-1", name: "boss_defeated" }, { now: now + 10000, fetcher: s.fetcher })).status, "sent");
  assert.equal(JSON.stringify(s.db.prepare("SELECT * FROM automation_receipts").all()).includes("secret-chat-content"), false);
  assert.equal(JSON.stringify(s.sent).includes("secret-chat-content"), false);
  await assert.rejects(() => processAutomationInput(s.env, "123", { ...input, text: "different" }, { now: now + 40000, fetcher: s.fetcher }), error => error.code === "input_conflict");
});

test("atomic admission permits only one concurrent effect and does not burn other matching rule cooldowns", async t => {
  const s = fixture(t), d = design();
  d.rules.push({ ...structuredClone(d.rules[0]), id: "second", effect: { type: "celebrate", message: "Second saved effect" } });
  await s.save(d); s.sent.length = 0;
  const results = await Promise.all(["one", "two"].map(id => processAutomationInput(s.env, "123", { type: "message", id, text: "party" }, { now, fetcher: s.fetcher })));
  assert.equal(results.filter(result => result.status === "sent").length, 1); assert.equal(s.sent.length, 1);
  const state = JSON.parse(s.db.prepare("SELECT engine_state FROM automation_configs").get().engine_state);
  assert.deepEqual(state.lastFired, { chat: now });
  const next = await processAutomationInput(s.env, "123", { type: "message", id: "three", text: "party" }, { now: now + 8000, fetcher: s.fetcher });
  assert.equal(next.event.effect.message, "Second saved effect");
});

test("uncertain sends and receipt-update failures never trigger an automatic replay", async t => {
  const s = fixture(t); await s.save(); let attempts = 0;
  const input = { type: "external", id: "unknown-result", name: "boss_defeated" };
  const sender = async () => { attempts++; throw Error("provider secret"); };
  const first = await processAutomationInput(s.env, "123", input, { now, fetcher: sender });
  assert.equal(first.status, "uncertain");
  const retry = await processAutomationInput(s.env, "123", input, { now: now + 30000, fetcher: sender });
  assert.equal(retry.status, "uncertain"); assert.equal(attempts, 1);
  s.env.beforeRun = sql => { if (sql.startsWith("UPDATE automation_receipts SET status")) throw Error("database private failure"); };
  const second = await processAutomationInput(s.env, "123", { ...input, id: "update-fails" }, { now: now + 30000, fetcher: s.fetcher });
  assert.equal(second.status, "uncertain");
  const count = s.sent.length;
  assert.equal((await processAutomationInput(s.env, "123", { ...input, id: "update-fails" }, { now: now + 60000, fetcher: s.fetcher })).status, "uncertain");
  assert.equal(s.sent.length, count);
});

test("config changed during admission prevents an obsolete saved effect from being sent", async t => {
  const s = fixture(t); await s.save(); s.sent.length = 0;
  s.env.beforeRun = sql => { if (sql.startsWith("INSERT OR IGNORE INTO automation_receipts")) s.db.prepare("UPDATE automation_configs SET revision=revision+1 WHERE channel='123'").run(); };
  const result = await processAutomationInput(s.env, "123", { type: "external", id: "obsolete", name: "boss_defeated" }, { now, fetcher: s.fetcher });
  assert.equal(result.status, "cooldown"); assert.equal(s.sent.length, 0);
});

test("cron evaluates bounded batches fairly, never catches up missed intervals, and retains independent channels", async t => {
  const s = fixture(t);
  for (const channel of ["123", "124", "125", "126", "127"]) assert.equal((await s.save(design(), { channel })).status, 200);
  s.sent.length = 0;
  assert.deepEqual(await tickAutomations(s.env, { now: now + 59999, fetcher: s.fetcher, limit: 2 }), { checked: 0, sent: 0 });
  const before = s.queryCount();
  assert.deepEqual(await tickAutomations(s.env, { now: now + 60000, fetcher: s.fetcher, limit: 2 }), { checked: 2, sent: 2 });
  assert.ok(s.queryCount() - before + 2 <= 17, "batch2 stays within its documented subrequest budget");
  await tickAutomations(s.env, { now: now + 120000, fetcher: s.fetcher, limit: 2 });
  await tickAutomations(s.env, { now: now + 180000, fetcher: s.fetcher, limit: 2 });
  assert.equal(new Set(s.sent.map(item => item.channel)).size, 5);
  const late = await tickAutomations(s.env, { now: now + 1000000, fetcher: s.fetcher, limit: 1 });
  assert.equal(late.sent, 1, "late scheduler emits one current moment rather than a backlog");
});

test("storage caps preserve retained receipts, expired dedup records are reclaimed", async t => {
  const s = fixture(t); await s.save();
  const row = s.db.prepare("SELECT * FROM automation_configs").get();
  const insert = s.db.prepare("INSERT INTO automation_receipts VALUES(?,?,?,?,?,?,?,?,?,?)");
  for (let i = 0; i < HOSTED_AUTOMATION_LIMITS.channelReceipts; i++) insert.run("123", `seed${i}`, "hash", `event${i}`, 1, row.engine_state, "{}", now, now + 86400000, "sent");
  s.db.prepare("UPDATE automation_configs SET last_event_at=-1").run();
  const event = { type: "external", id: "capacity", name: "boss_defeated" };
  assert.equal((await processAutomationInput(s.env, "123", event, { now, fetcher: s.fetcher })).status, "cooldown");
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM automation_receipts").get().n, 1000);
  assert.equal((await processAutomationInput(s.env, "123", event, { now: now + 86400000, fetcher: s.fetcher })).status, "sent");
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM automation_receipts").get().n, 1);
});

test("hosted design count is capped and existing channels can still update", async t => {
  const s = fixture(t); await s.save();
  const base = s.db.prepare("SELECT * FROM automation_configs WHERE channel='123'").get();
  const insert = s.db.prepare("INSERT INTO automation_configs(channel,design,revision,owned_merch,updated,engine_state,engine_revision,last_event_at,has_timers,next_tick) VALUES(?,?,?,?,?,?,?,?,?,?)");
  for (let i = 0; i < 99; i++) insert.run(String(1000 + i), base.design, 1, 0, now, base.engine_state, 0, -1, 0, now + 60000);
  assert.equal((await s.save(design(), { channel: "456" })).status, 409);
  assert.equal((await s.save(design(), { input: { design: design(), expectedRevision: 1 } })).body.revision, 2);
});

test("slow request bodies start saved timers and manual celebrations at completion, not arrival", async t => {
  const s = fixture(t);
  let wall = now;
  t.mock.method(Date, "now", () => wall);
  async function delayed(path, input, delay) {
    const arrived = wall;
    const body = new ReadableStream({ pull(controller) {
      wall += delay;
      controller.enqueue(new TextEncoder().encode(JSON.stringify(input)));
      controller.close();
    } });
    const request = new Request(`https://api.example/v1/automations/123/${path}`, {
      method: path === "config" ? "PUT" : "POST", duplex: "half", body,
      headers: { Origin: origin, "Content-Type": "application/json" },
    });
    const response = await automationRequest(request, s.env, "123", { claims: claims(), now: arrived, fetcher: s.fetcher });
    assert.equal(response.status, 200);
    return response.json();
  }
  const saved = await delayed("config", { design: design(), expectedRevision: 0 }, 9000);
  const row = s.db.prepare("SELECT * FROM automation_configs").get();
  assert.equal(saved.updatedAt, now + 9000);
  assert.equal(JSON.parse(row.engine_state).startedAt, saved.updatedAt);
  assert.equal(row.next_tick, saved.updatedAt + 60000);
  const fired = await delayed("fire", { eventId: crypto.randomUUID(), type: "celebrate", message: "The party is here" }, 12000);
  assert.equal(fired.event.created, now + 21000);
  assert.equal(fired.event.expires, wall + 8000);
  assert.equal(s.db.prepare("SELECT last_event_at FROM automation_configs").get().last_event_at, wall);
});

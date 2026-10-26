import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { automationRequest, processAutomationInput, hasMatchingKeywordRule, tickAutomations, HOSTED_AUTOMATION_LIMITS } from "../server/automation-service.mjs";
import { IMAGE_ORIGIN } from "../src/image-address.mjs";
import { addExperiencePresets } from "../src/experience-presets.mjs";
import { AUTOMATION_DESIGN_BYTES, validateAutomations } from "../src/automations.mjs";

const now = 1800000000000, origin = "https://test.ext-twitch.tv";
const utf8Length = value => new TextEncoder().encode(JSON.stringify(value)).length;
function maximumCountDesign() {
  return {
    version: 1,
    carousels: Array.from({ length: 32 }, (_, i) => ({ id: `c${i}`, title: "C", displaySeconds: 20, slides: Array.from({ length: 6 }, (_, j) => ({ id: `s${i}_${j}`, title: "T", caption: "D", image: "", url: "" })) })),
    rules: Array.from({ length: 64 }, (_, i) => ({ id: `r${i}`, name: "R", enabled: true, trigger: { type: "keyword", phrase: "K", match: "contains" }, effect: { type: "celebrate", message: "M" }, cooldownSeconds: 0 })),
    pages: Array.from({ length: 48 }, (_, i) => ({ id: `p${i}`, name: "P", ruleIds: [`r${i}`], carouselIds: [] })),
  };
}
function designAtBytes(target) {
  const input = validateAutomations(maximumCountDesign());
  let remaining = target - utf8Length(input);
  if (remaining < 0) throw Error("Base design exceeds target byte count.");
  const slots = [];
  for (const carousel of input.carousels) {
    slots.push([carousel, "title", 80]);
    for (const slide of carousel.slides) slots.push([slide, "title", 70], [slide, "caption", 100]);
  }
  for (const rule of input.rules) slots.push([rule, "name", 70], [rule.trigger, "phrase", 80], [rule.effect, "message", 160]);
  for (const page of input.pages.slice(0, -1)) slots.push([page, "name", 60]);
  for (const [record, key, limit] of slots) {
    const extra = Math.min(remaining, limit - record[key].length);
    if (extra > 0) { record[key] += "X".repeat(extra); remaining -= extra; }
    if (remaining === 0) break;
  }
  if (remaining !== 0) throw Error("Not enough bounded text fields to reach requested byte count.");
  const clean = validateAutomations(input);
  if (utf8Length(clean) !== target) throw Error("Generated automation design did not reach the requested byte count.");
  return clean;
}
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
  const db = new DatabaseSync(":memory:"); db.exec(readFileSync(new URL("../server/automation-schema.sql", import.meta.url), "utf8")); db.exec(readFileSync(new URL("../server/hype-schema.sql", import.meta.url), "utf8")); t.after(() => db.close());
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

test("Hype lifecycle persists signed snapshots through cooldown and closes with a bounded thank-you", async t => {
  const s = fixture(t);
  const appearance = { style: "hype-train", color: "#FF33AA", durationSeconds: 8, hypeLifecycle: true };
  const candidate = { version: 1, carousels: [], rules: [
    { id: "begin", name: "Train", enabled: true, trigger: { type: "twitch", event: "hype_begin" }, effect: { type: "celebrate", message: "Train rolling", appearance }, cooldownSeconds: 60 },
    { id: "progress", name: "Progress", enabled: true, trigger: { type: "twitch", event: "hype_progress" }, effect: { type: "choose", mode: "rotate", options: [{ type: "celebrate", message: "Keep going", appearance }] }, cooldownSeconds: 60 },
  ] };
  assert.equal((await s.save(candidate)).status, 200);
  s.sent.length = 0;
  const input = (phase, id, at, changes = {}) => ({ type: "twitch", event: `hype_${phase}`, id,
    hype: { id: "train_1", level: 1, total: 10, progress: 10, goal: 100, startedAt: new Date(now).toISOString(),
      expiresAt: new Date(at + 300000).toISOString(), sentAt: at, ...changes } });
  const begin = await processAutomationInput(s.env, "123", input("begin", "begin_1", now), { now, fetcher: s.fetcher });
  assert.equal(begin.status, "sent");
  assert.equal(begin.event.hype.phase, "active");
  assert.equal((await s.call("hype", { at: now + 1 })).body.event.hype.progress, 10);
  const progress = await processAutomationInput(s.env, "123", input("progress", "progress_1", now + 1000, { level: 2, total: 155, progress: 55 }), { now: now + 1000, fetcher: s.fetcher });
  assert.equal(progress.status, "cooldown");
  assert.equal((await s.call("hype", { at: now + 1001 })).body.event.hype.progress, 55);
  assert.equal((await s.call("hype", { at: now + 1001 })).body.event.effect.message, "Keep going");
  assert.equal(s.sent.length, 1, "cooldown bounds broadcasts, not persisted progress");
  const retainedExpiry = (await s.call("hype", { at: now + 1001 })).body.event.expires;
  assert.equal((await processAutomationInput(s.env, "123", input("progress", "missing_expiry", now + 1200, { expiresAt: undefined, total: 160 }), { now: now + 1200, fetcher: s.fetcher })).status, "no_match");
  assert.equal((await processAutomationInput(s.env, "123", input("progress", "past_expiry", now + 1300, { expiresAt: new Date(now).toISOString(), total: 160 }), { now: now + 1300, fetcher: s.fetcher })).status, "no_match");
  assert.equal((await processAutomationInput(s.env, "123", input("progress", "lower_level", now + 1400, { level: 1, total: 160, expiresAt: new Date(now + 10000).toISOString() }), { now: now + 1400, fetcher: s.fetcher })).status, "no_match");
  assert.equal((await s.call("hype", { at: now + 1401 })).body.event.expires, retainedExpiry);
  assert.equal((await processAutomationInput(s.env, "123", input("progress", "late_1", now + 500, { total: 5, progress: 5 }), { now: now + 1100, fetcher: s.fetcher })).status, "no_match");
  const ended = await processAutomationInput(s.env, "123", input("end", "end_1", now + 2000, { total: 200, progress: undefined, goal: undefined }), { now: now + 2000, fetcher: s.fetcher });
  assert.equal(ended.status, "cooldown");
  assert.equal(ended.event.hype.phase, "ended");
  assert.equal(ended.event.effect.message, "Train rolling", "missing end rule falls back to saved begin effect");
  assert.equal((await s.call("hype", { at: now + 2001 })).body.event.hype.phase, "ended");
  assert.equal((await s.call("hype", { at: now + 14000 })).body.event, null);
  assert.equal((await processAutomationInput(s.env, "123", input("begin", "reopen_1", now + 3000), { now: now + 3000, fetcher: s.fetcher })).status, "no_match");
  assert.equal(s.db.prepare("SELECT phase FROM hype_sessions WHERE channel='123'").get().phase, "ended");
  assert.equal((await s.call("hype", { at: now + 1, auth: null })).status, 401);
  assert.equal((await s.call("hype", { at: now + 1, method: "POST" })).status, 405);
  assert.equal((await s.call("hype", { at: now + 1, from: "https://other.example" })).status, 403);
});

test("Hype progress may precede begin and an edited design invalidates catch-up", async t => {
  const s = fixture(t);
  const candidate = { version: 1, carousels: [], rules: [{ id: "begin", name: "Train", enabled: true,
    trigger: { type: "twitch", event: "hype_begin" }, effect: { type: "celebrate", message: "Train",
      appearance: { style: "hype-train", color: "#33AAFF", durationSeconds: 8, hypeLifecycle: true } }, cooldownSeconds: 0 }] };
  assert.equal((await s.save(candidate)).status, 200);
  const source = (event, id, sentAt) => ({ type: "twitch", event, id, hype: { id: "train_early", level: 1,
    total: 30, progress: 30, goal: 100, startedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 300000).toISOString(), sentAt } });
  const first = await processAutomationInput(s.env, "123", source("hype_progress", "progress_first", now + 1000), { now: now + 1000, fetcher: s.fetcher });
  assert.equal(first.event?.hype.progress, 30);
  assert.equal((await processAutomationInput(s.env, "123", source("hype_begin", "late_begin", now), { now: now + 1100, fetcher: s.fetcher })).status, "no_match");
  assert.equal((await s.call("hype", { at: now + 1100 })).body.event.hype.progress, 30);
  candidate.rules[0].enabled = false;
  assert.equal((await s.save(candidate, { input: { design: candidate, expectedRevision: 1 } })).status, 200);
  assert.equal((await s.call("hype", { at: now + 1100 })).body.event, null);
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

test("active catch-up preserves only valid saved celebration appearance metadata", async t => {
  const s = fixture(t), candidate = design();
  candidate.rules[0].effect.appearance = { style: "spotlight", color: "#abcdef", durationSeconds: 14, sound: { preset: "space", volume: 37 } };
  await s.save(candidate);
  const input = { type: "message", id: "appearance-chat", text: "party" };
  const fired = await processAutomationInput(s.env, "123", input, { now, fetcher: s.fetcher });
  assert.deepEqual(fired.event.effect, { type: "celebrate", message: "The party is here", appearance: candidate.rules[0].effect.appearance });
  assert.equal(fired.event.expires, now + 14000);
  const active = await s.call("active", { at: now + 1000 });
  assert.deepEqual(active.body.event.effect, fired.event.effect);
  assert.equal((await s.call("active", { at: now + 14000 })).body.event, null);
  for (const appearance of [
    { ...candidate.rules[0].effect.appearance, style: "unknown" },
    { ...candidate.rules[0].effect.appearance, durationSeconds: 21 },
    { ...candidate.rules[0].effect.appearance, sound: { preset: "space", volume: 101 } },
    { ...candidate.rules[0].effect.appearance, sound: { preset: "space", volume: 37, extra: true } },
  ]) {
    s.db.prepare("UPDATE automation_receipts SET event=?").run(JSON.stringify({ ...fired.event, effect: { ...fired.event.effect, appearance } }));
    assert.equal((await s.call("active", { at: now + 1000 })).body.event, null);
  }
  s.db.prepare("UPDATE automation_receipts SET event=?").run(JSON.stringify({ ...fired.event, effect: { ...fired.event.effect, appearance: { ...fired.event.effect.appearance, untrusted: "drop" } } }));
  assert.deepEqual((await s.call("active", { at: now + 1000 })).body.event.effect, fired.event.effect);
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

test("hosted config reader admits the 15-rule plus four-layout selection within expanded quotas", async t => {
  const s = fixture(t), base = design();
  base.carousels = Array.from({ length: 26 }, (_, carouselIndex) => ({
    id: `existing-carousel-${carouselIndex}`, title: `Existing carousel ${carouselIndex}`,
    displaySeconds: 20,
    slides: Array.from({ length: 6 }, (_, slideIndex) => ({
      id: `slide-${carouselIndex}-${slideIndex}`, title: "S".repeat(70), caption: "C".repeat(100), image: "", url: "",
    })),
  }));
  base.rules = Array.from({ length: 15 }, (_, index) => ({
    id: `existing-rule-${index}`, name: `Existing rule ${index}`,
    enabled: true, trigger: { type: "keyword", phrase: `k${String(index).padStart(78, "x")}`, match: "word" },
    effect: { type: "celebrate", message: "M".repeat(160) }, cooldownSeconds: 0,
  }));
  base.pages = base.rules.map((rule, index) => ({ id: `existing-page-${index}`, name: `Existing page ${index}`, ruleIds: [rule.id], carouselIds: [] }));
  const keys = ["subscriber-thanks", "hype-train", "hype-progress", "hype-finish", "discord-invite", "stream-rules", "stream-schedule", "game-goals", "merch-carousel", "featured-item"];
  const expanded = addExperiencePresets(base, keys).design;
  assert.equal(expanded.rules.length, 25);
  assert.equal(expanded.pages.length, 25);
  assert.equal(expanded.carousels.length, 32);
  const requestBytes = new TextEncoder().encode(JSON.stringify({ design: expanded, expectedRevision: 0 })).length;
  assert.ok(requestBytes > 20_000 && requestBytes < HOSTED_AUTOMATION_LIMITS.designBytes + 1024);
  assert.equal((await s.save(expanded)).status, 200);
});

test("config reader allows design plus bounded metadata, while action body cap stays 1 KiB", async t => {
  const s = fixture(t);
  const oversizedConfigEnvelope = { design: design(), expectedRevision: 0, padding: "x".repeat(HOSTED_AUTOMATION_LIMITS.designBytes + 1024) };
  assert.equal((await s.save(oversizedConfigEnvelope.design, { input: oversizedConfigEnvelope })).body.error, "body_too_large");
  assert.equal((await s.call("fire", { method: "POST", input: { eventId: crypto.randomUUID(), type: "celebrate", message: "x".repeat(1100) } })).body.error, "body_too_large");
  assert.equal(HOSTED_AUTOMATION_LIMITS.designBytes, 65_536);
  assert.equal(HOSTED_AUTOMATION_LIMITS.channels, 100);
  assert.equal(HOSTED_AUTOMATION_LIMITS.receipts, 10_000);
});

test("hosted design cap accepts exactly 64 KiB and rejects one byte more", async t => {
  const s = fixture(t), exact = designAtBytes(AUTOMATION_DESIGN_BYTES);
  assert.equal(HOSTED_AUTOMATION_LIMITS.designBytes, AUTOMATION_DESIGN_BYTES);
  assert.equal((await s.save(exact)).status, 200);
  const over = structuredClone(exact);
  over.pages.at(-1).name += "X";
  assert.equal(utf8Length(over), AUTOMATION_DESIGN_BYTES + 1);
  const rejected = await s.save(over, { input: { design: over, expectedRevision: 1 } });
  assert.equal(rejected.status, 413);
  assert.equal(rejected.body.error, "design_too_large");
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

test("popup destinations require an exact channel mapping and ownership", async t => {
  const s=fixture(t), candidate=design();
  candidate.carousels[0].slides[0].url='https://discord.gg/funksbth';
  s.env.POPUP_TEST_LINKS=JSON.stringify({'123':['https://discord.gg/funksbth']});
  assert.equal((await s.save(candidate)).status,400);
  for(const url of ['https://discord.gg/another','https://discord.gg/funksbth?ref=other','https://discord.gg/funksbth#other']) {
    const wrong=structuredClone(candidate);wrong.carousels[0].slides[0].url=url;
    assert.equal((await s.save(wrong,{input:{design:wrong,expectedRevision:0,ownedMerch:true}})).status,400);
  }
  assert.equal((await s.save(candidate,{channel:'456',input:{design:candidate,expectedRevision:0,ownedMerch:true}})).status,400);
  assert.equal((await s.save(candidate,{input:{design:candidate,expectedRevision:0,ownedMerch:true}})).status,200);
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

test("manual celebration resolves and fires the saved appearance, including chosen effects", async t => {
  const s = fixture(t), candidate = design();
  const appearance = { style: "confetti", color: "#00aBcD", durationSeconds: 11, sound: { preset: "arcade", volume: 62 } };
  candidate.rules[0].effect = { type: "choose", mode: "rotate", options: [{ type: "celebrate", message: "The party is here", appearance }] };
  candidate.rules[2].effect = { type: "celebrate", message: "The party is here", appearance: { style: "spotlight", color: "#ABCDEF", durationSeconds: 16, sound: { preset: "chime", volume: 10 } } };
  await s.save(candidate); s.sent.length = 0;
  const request = { eventId: crypto.randomUUID(), type: "celebrate", message: "The party is here", appearance };
  const first = await s.call("fire", { method: "POST", input: request });
  assert.equal(first.body.status, "sent");
  assert.deepEqual(first.body.event.effect, { type: "celebrate", message: request.message, appearance });
  assert.equal(first.body.event.expires, now + 11000);
  assert.equal((await s.call("fire", { method: "POST", input: { eventId: crypto.randomUUID(), type: "celebrate", message: request.message } })).body.error, "effect_ambiguous");
  assert.equal((await s.call("fire", { method: "POST", input: { eventId: crypto.randomUUID(), type: "celebrate", message: request.message, appearance: { ...appearance, color: "#ffffff" } } })).status, 409);
  assert.equal((await s.call("fire", { method: "POST", input: { eventId: crypto.randomUUID(), type: "celebrate", message: request.message, appearance: { ...appearance, sound: { ...appearance.sound, volume: 61 } } } })).status, 409);
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

test('authenticated Twitch event inputs select saved effects and deduplicate across event types', async t => {
  const s=fixture(t), value=design();
  value.rules=[{id:'sub',name:'Subscriber welcome',enabled:true,trigger:{type:'twitch',event:'subscribe'},effect:{type:'carousel',carouselId:'merch'},cooldownSeconds:30}];
  assert.equal((await s.save(value)).status,200);
  const input={type:'twitch',event:'subscribe',id:'twitch-notification-1'};
  const first=await processAutomationInput(s.env,'123',input,{now,fetcher:s.fetcher});
  assert.equal(first.status,'sent');assert.equal(first.event.effect.carouselId,'merch');
  const count=s.sent.length;
  const again=await processAutomationInput(s.env,'123',input,{now:now+40000,fetcher:s.fetcher});
  assert.equal(again.status,'sent');assert.equal(s.sent.length,count);
  await assert.rejects(processAutomationInput(s.env,'123',{...input,event:'hype_begin'},{now:now+40000,fetcher:s.fetcher}),e=>e.status===409);
  await assert.rejects(processAutomationInput(s.env,'123',{...input,event:'invented'},{now,fetcher:s.fetcher}),e=>e.status===400);
});

test('Twitch subscriber context is broadcast transiently and never retained in receipts',async t=>{
 const s=fixture(t),value=design();value.rules=[{id:'welcome',name:'Welcome',enabled:true,trigger:{type:'twitch',event:'subscribe'},effect:{type:'celebrate',message:'Thanks, {subscriber}!'},cooldownSeconds:0}];
 assert.equal((await s.save(value)).status,200);s.sent.length=0;
 const result=await processAutomationInput(s.env,'123',{type:'twitch',event:'subscribe',id:'sub-context',context:{subscriber:'PrivacyTestSubscriber',other:'private'}},{now,fetcher:s.fetcher});
 assert.equal(result.status,'sent');assert.deepEqual(s.sent[0].event.context,{subscriber:'PrivacyTestSubscriber'});
 assert.equal(result.event.context,undefined);
 const receipt=JSON.stringify(s.db.prepare('SELECT * FROM automation_receipts').all());assert.ok(!receipt.includes('PrivacyTestSubscriber'));assert.ok(!receipt.includes('private'));
});

test('choice effects advance only the admitted rule and persist across different source events',async t=>{
 const s=fixture(t),value=design();value.rules=[{id:'rotating',name:'Rotating',enabled:true,trigger:{type:'keyword',phrase:'merch',match:'word'},effect:{type:'choose',mode:'rotate',options:[{type:'celebrate',message:'One'},{type:'carousel',carouselId:'merch'}]},cooldownSeconds:0}];
 assert.equal((await s.save(value)).status,200);
 const first=await processAutomationInput(s.env,'123',{type:'message',text:'merch',id:'rotation1'},{now,fetcher:s.fetcher});assert.equal(first.event.effect.message,'One');
 const denied=await processAutomationInput(s.env,'123',{type:'message',text:'merch',id:'rotation2'},{now:now+1000,fetcher:s.fetcher});assert.equal(denied.status,'cooldown');
 assert.equal(JSON.parse(s.db.prepare('SELECT engine_state FROM automation_configs').get().engine_state).choiceIndexes.rotating,1);
 const second=await processAutomationInput(s.env,'123',{type:'message',text:'merch',id:'rotation3'},{now:now+10000,fetcher:s.fetcher});assert.equal(second.event.effect.carouselId,'merch');
 assert.equal(JSON.parse(s.db.prepare('SELECT engine_state FROM automation_configs').get().engine_state).choiceIndexes.rotating,0);
});

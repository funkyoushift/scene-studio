import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postcss from "postcss";
import { automationPreflight, getAutomationConfig, saveAutomationConfig, publishAutomationImages, fireAutomation, watchAutomationEvents, currentAutomationPublisher, connectAutomationSession } from "../src/automation-twitch.mjs";
import { IMAGE_ORIGIN } from "../src/image-address.mjs";

const auth = { channelId: "123", token: "test-only-extension-jwt" };
const design = () => ({ version: 1, carousels: [{ id: "merch", title: "My images", displaySeconds: 20, slides: [{ id: "one", title: "One", caption: "", image: "", url: "" }] }], rules: [{ id: "cheer", name: "Cheer", enabled: true, trigger: { type: "keyword", phrase: "party", match: "word" }, effect: { type: "celebrate", message: "Hooray" }, cooldownSeconds: 10 }] });
const config = (revision = 1) => ({ channelId: "123", revision, design: design(), ownedMerch: false, updatedAt: 1000 });
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const flush = () => new Promise(resolve => setImmediate(resolve));
function helper() { return { listen(topic, receive) { this.receive = receive; }, unlisten(topic, receive) { assert.equal(receive, this.receive); this.stopped = true; } }; }
const event = (patch = {}) => ({ type: "scene-studio-automation", eventId: "event-1", channelId: "123", revision: 1, created: 1000, expires: 21000, effect: { type: "carousel", carouselId: "merch" }, ...patch });
const send = (h, data) => h.receive("broadcast", "application/json", JSON.stringify(data));

test("embedded automation consumes parent sessions without replacing Twitch's single authorization callback", () => {
  const parentEvents = [], childEvents = [];
  let callback = value => parentEvents.push(value), registrations = 0;
  const h = { onAuthorized(next) { registrations++; callback = next; } };
  const initial = { auth, viewer: { role: "broadcaster", isLinked: true } };
  const stop = connectAutomationSession(h, initial, value => childEvents.push(value));
  const refreshed = { ...initial, auth: { ...auth, token: "refreshed-test-token" } };
  const stopRefresh = connectAutomationSession(h, refreshed, value => childEvents.push(value));
  callback(refreshed.auth);
  assert.equal(registrations, 0);
  assert.deepEqual(parentEvents, [refreshed.auth]);
  assert.deepEqual(childEvents, [initial, refreshed]);
  stop(); stopRefresh();
  connectAutomationSession(h, null, value => assert.equal(value, null));
  assert.equal(registrations, 0, "an unauthenticated parent is not a standalone subscription");
});

test("standalone automation subscription ignores late callbacks after cleanup", () => {
  let callback;
  const events = [], h = { viewer: { role: "broadcaster", isLinked: true }, onAuthorized(next) { callback = next; } };
  const stop = connectAutomationSession(h, undefined, value => events.push(value));
  callback(auth); stop(); callback({ ...auth, channelId: "999" });
  assert.equal(events.length, 1); assert.equal(events[0].viewer.role, "broadcaster");
});

test("automation CSS cannot alter the Twitch viewer or sibling object editor", async () => {
  const sheet = postcss.parse(await readFile(new URL("../src/automations.css", import.meta.url), "utf8"));
  let count = 0;
  sheet.walkRules(rule => {
    for (let parent = rule.parent; parent; parent = parent.parent) if (parent.type === "atrule" && /keyframes$/i.test(parent.name)) return;
    for (const selector of rule.selectors) {
      assert.match(selector, /^\.director(?=[\s.:[#>+~]|$)/, `unscoped automation selector: ${selector}`);
      count++;
    }
  });
  assert.ok(count > 100, "the complete stylesheet was checked, including responsive rules");
});

test("publication rechecks channel and broadcaster permissions after upload, using a refreshed same-channel token", () => {
  const broadcaster = { role: "broadcaster", isLinked: true }, refreshed = { ...auth, token: "new-test-token" };
  assert.equal(currentAutomationPublisher(auth, refreshed, broadcaster), refreshed);
  assert.throws(() => currentAutomationPublisher(auth, { ...auth, channelId: "999" }, broadcaster), /not published/);
  assert.throws(() => currentAutomationPublisher(auth, auth, { role: "viewer", isLinked: true }), /not published/);
  assert.throws(() => currentAutomationPublisher(auth, auth, { role: "broadcaster", isLinked: false }), /not published/);
  assert.throws(() => currentAutomationPublisher(auth, null, broadcaster), /not published/);
});

test("automation settings are channel authenticated and revision-checked; save never uses local Twitch configuration", async () => {
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, options }); return reply(config(options.method === "PUT" ? 2 : 1)); };
  assert.equal((await getAutomationConfig(auth, fetcher)).revision, 1);
  const saved = await saveAutomationConfig(auth, design(), 1, false, fetcher);
  assert.equal(saved.revision, 2);
  assert.equal(calls[0].url, `${IMAGE_ORIGIN}/v1/automations/123/config`);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${auth.token}`);
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(JSON.parse(calls[1].options.body).expectedRevision, 1);
  await assert.rejects(getAutomationConfig(auth, async () => reply({ ...config(), channelId: "999" })), /verified/);
  await assert.rejects(saveAutomationConfig(auth, design(), undefined, false, fetcher), /revision/);
  await assert.rejects(getAutomationConfig({ channelId: "../123", token: "x" }, fetcher), /configuration/);
});

test("live preflight rejects other-channel images, undeclared links and short timers before any upload", async () => {
  const other = design(); other.carousels[0].slides[0].image = `${IMAGE_ORIGIN}/images/999/${"a".repeat(64)}.png`;
  assert.throws(() => automationPreflight(other, "123", true), /another channel/);
  const linked = design(); linked.carousels[0].slides[0].url = "https://streamlabs.com/funkyoushift/merch";
  assert.throws(() => automationPreflight(linked, "123", false), /own branded/);
  const timed = design(); timed.rules[0].trigger = { type: "interval", everySeconds: 5 };
  assert.throws(() => automationPreflight(timed, "123", false), /60 seconds/);
  timed.rules[0].enabled = false;
  assert.throws(() => automationPreflight(timed, "123", false), /60 seconds/);
  let uploads = 0;
  await assert.rejects(publishAutomationImages(other, auth, true, async () => { uploads++; }), /another channel/);
  assert.equal(uploads, 0);
});

test("automation image publication uses bounded PNG upload once per unique image, preserving links", async () => {
  const source = design(), image = "data:image/png;base64,AQID";
  source.carousels[0].slides = [{ ...source.carousels[0].slides[0], image, url: "https://streamlabs.com/funkyoushift/merch" }, { ...source.carousels[0].slides[0], id: "two", image }];
  const calls = [];
  const published = await publishAutomationImages(source, auth, true, async (url, options) => { calls.push({ url, options }); return reply({ path: `/images/123/${"a".repeat(64)}.png` }); }, async () => image);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${IMAGE_ORIGIN}/images/123`);
  assert.equal(calls[0].options.body.length, 3);
  assert.equal(calls[0].options.headers["Content-Type"], "image/png");
  assert.equal(published.carousels[0].slides[0].image, published.carousels[0].slides[1].image);
  assert.equal(published.carousels[0].slides[0].url, source.carousels[0].slides[0].url);
  assert.equal(source.carousels[0].slides[0].image, image, "original draft remains unchanged");
  await assert.rejects(publishAutomationImages(source, auth, true, async () => reply({ path: `/images/999/${"b".repeat(64)}.png` }), async () => image), /confirmed/);
});

test("fire uses a fresh event ID and preserves uncertain outcomes without automatic retry", async () => {
  const calls = [];
  const result = await fireAutomation(auth, { type: "celebrate", message: "Hooray" }, async (url, options) => { calls.push(JSON.parse(options.body)); return reply({ status: "uncertain" }); });
  assert.equal(result.status, "uncertain");
  assert.equal(calls.length, 1);
  assert.match(calls[0].eventId, /^[a-f0-9-]{36}$/);
  await assert.rejects(fireAutomation(auth, { type: "carousel", carouselId: "merch" }, async () => reply({ status: "cooldown" }, 429)), /cooldown/);
  await assert.rejects(fireAutomation(auth, { type: "carousel", carouselId: "merch" }, async () => reply({ error: "bad_effect", message: "Choose an action from your saved design." }, 409)), /Choose an action/);
});

test("viewer rejects cross-channel, stale revision, expired and unknown effects; deduplicates valid events", async () => {
  const h = helper(), shown = [], loaded = [];
  const stop = watchAutomationEvents(h, auth, value => loaded.push(value), value => shown.push(value), () => {}, async () => reply(config()), () => 2000);
  await flush();
  await send(h, event({ channelId: "999" }));
  await send(h, event({ revision: 0 }));
  await send(h, event({ expires: 1500 }));
  await send(h, event({ effect: { type: "carousel", carouselId: "unknown" }, eventId: "bad-target" }));
  await send(h, event({ effect: { type: "celebrate", message: "arbitrary" }, eventId: "bad-message" }));
  await send(h, event()); await send(h, event());
  assert.equal(loaded.length, 1); assert.equal(shown.length, 1);
  stop(); await send(h, event({ eventId: "after-stop" }));
  assert.equal(shown.length, 1); assert.equal(h.stopped, true);
});

test("configuration notifications fetch once per new revision and only matching-revision effects display", async () => {
  const h = helper(), shown = []; let revision = 1, reads = 0;
  const stop = watchAutomationEvents(h, auth, () => {}, value => shown.push(value), () => {}, async () => { reads++; return reply(config(revision)); }, () => 2000);
  await flush(); revision = 2;
  const notification = { type: "scene-studio-automation-config", channelId: "123", revision: 2 };
  await send(h, notification); await send(h, notification);
  assert.equal(reads, 2);
  await send(h, event()); await send(h, event({ revision: 2, eventId: "new-revision" }));
  assert.equal(shown.length, 1); assert.equal(shown[0].revision, 2);
  stop();
});

test("failed configuration reads recover on a later notification or repeated undelivered event without polling", async () => {
  const h = helper(), shown = [], errors = []; let fail = true, reads = 0;
  const stop = watchAutomationEvents(h, auth, () => {}, value => shown.push(value), value => errors.push(value), async () => { reads++; if (fail) throw Error("offline"); return reply(config()); }, () => 2000);
  await flush(); await send(h, event());
  const failedReads = reads; await flush(); assert.equal(reads, failedReads, "no retry loop");
  fail = false; await send(h, event());
  assert.equal(shown.length, 1); assert.ok(errors.length > 0);
  await send(h, event()); assert.equal(shown.length, 1);
  stop();
});

test("an event waits for newer config and cannot display after teardown or expiration", async () => {
  const h = helper(), shown = []; let resolve, now = 2000;
  const stop = watchAutomationEvents(h, auth, () => {}, value => shown.push(value), () => {}, () => new Promise(done => { resolve = done; }), () => now);
  await flush(); const pending = send(h, event()); now = 22000;
  resolve(reply(config())); await pending;
  assert.equal(shown.length, 0); stop();
});

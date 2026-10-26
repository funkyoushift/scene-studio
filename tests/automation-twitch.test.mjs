import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postcss from "postcss";
import { AUTOMATION_CONFIG_BYTES, automationPreflight, getAutomationConfig, saveAutomationConfig, publishAutomationImages, fireAutomation, watchAutomationEvents, currentAutomationPublisher, connectAutomationSession } from "../src/automation-twitch.mjs";
import { AUTOMATION_DESIGN_BYTES, AUTOMATION_LIMITS, validateAutomations } from "../src/automations.mjs";
import { IMAGE_ORIGIN } from "../src/image-address.mjs";

const auth = { channelId: "123", token: "test-only-extension-jwt" };
const design = () => ({ version: 1, carousels: [{ id: "merch", title: "My images", displaySeconds: 20, slides: [{ id: "one", title: "One", caption: "", image: "", url: "" }] }], rules: [{ id: "cheer", name: "Cheer", enabled: true, trigger: { type: "keyword", phrase: "party", match: "word" }, effect: { type: "celebrate", message: "Hooray" }, cooldownSeconds: 10 }] });
const config = (revision = 1) => ({ channelId: "123", revision, design: design(), ownedMerch: false, updatedAt: 1000 });
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const flush = () => new Promise(resolve => setImmediate(resolve));
function helper() { return { listen(topic, receive) { this.receive = receive; }, unlisten(topic, receive) { assert.equal(receive, this.receive); this.stopped = true; } }; }
const event = (patch = {}) => ({ type: "scene-studio-automation", eventId: "event-1", channelId: "123", revision: 1, created: 1000, expires: 21000, effect: { type: "carousel", carouselId: "merch" }, ...patch });
const send = (h, data) => h.receive("broadcast", "application/json", JSON.stringify(data));
function uploadSound() {
  const bytes = new Uint8Array(46), view = new DataView(bytes.buffer);
  const tag = (at, word) => { for (let i = 0; i < word.length; i++) bytes[at + i] = word.charCodeAt(i); };
  tag(0, "RIFF"); view.setUint32(4, 38, true); tag(8, "WAVE"); tag(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, "data"); view.setUint32(40, 2, true);
  return { bytes, url: `data:audio/wav;base64,${Buffer.from(bytes).toString("base64")}` };
}

function maximumCountDesign() {
  const source = design();
  return validateAutomations({
    version: 1,
    carousels: Array.from({ length: AUTOMATION_LIMITS.carousels }, (_, index) => ({ ...structuredClone(source.carousels[0]), id: `c${index}`, slides: [{ ...structuredClone(source.carousels[0].slides[0]), id: `s${index}` }] })),
    rules: Array.from({ length: AUTOMATION_LIMITS.rules }, (_, index) => ({ ...structuredClone(source.rules[0]), id: `r${index}` })),
    pages: Array.from({ length: AUTOMATION_LIMITS.pages }, (_, index) => ({ id: `p${index}`, name: `Page ${index}`, ruleIds: [`r${index}`], carouselIds: [] })),
  });
}

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

test("live preflight estimates uploaded images against the shared 64 KiB hosted cap", () => {
  assert.equal(AUTOMATION_CONFIG_BYTES, AUTOMATION_DESIGN_BYTES);
  const exact = maximumCountDesign(), currentBytes = new TextEncoder().encode(JSON.stringify(exact)).length;
  const difference = AUTOMATION_CONFIG_BYTES - currentBytes, prefix = "data:image/png;base64,";
  assert.ok(difference > prefix.length && difference < 700_000);
  exact.carousels[0].slides[0].image = `${prefix}${"A".repeat(difference - prefix.length)}`;
  assert.equal(new TextEncoder().encode(JSON.stringify(exact)).length, AUTOMATION_CONFIG_BYTES);
  assert.doesNotThrow(() => automationPreflight(exact, "123", false));
  exact.carousels[0].slides[0].image += "A";
  assert.doesNotThrow(() => automationPreflight(exact, "123", false), "large local image data is replaced by the hosted image URL estimate");
  const oversizedHosted = maximumCountDesign();
  oversizedHosted.carousels = Array.from({ length: 32 }, (_, carouselIndex) => ({
    id: `text-carousel-${carouselIndex}`, title: "C".repeat(80), displaySeconds: 20,
    slides: Array.from({ length: 6 }, (_, slideIndex) => ({ id: `text-slide-${carouselIndex}-${slideIndex}`, title: "T".repeat(70), caption: "D".repeat(100), image: "", url: "" })),
  }));
  oversizedHosted.rules = oversizedHosted.rules.map((rule, index) => ({ ...rule, name: "R".repeat(70), trigger: { ...rule.trigger, phrase: "K".repeat(80) }, effect: { type: "celebrate", message: "M".repeat(160) }, id: `text-rule-${index}` }));
  oversizedHosted.pages = oversizedHosted.pages.map((page, index) => ({ ...page, name: "P".repeat(60), ruleIds: [`text-rule-${index}`] }));
  assert.throws(() => automationPreflight(oversizedHosted, "123", false), /64 KiB/);
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

test("uploaded sounds are deduplicated across direct and chosen celebrations and kept out of the draft", async () => {
  const source = design(), { bytes, url } = uploadSound();
  const sound = { preset: "upload", url, name: "Cheer", volume: 60 };
  source.rules[0].effect.appearance = { style: "confetti", color: "#123456", durationSeconds: 8, sound };
  source.rules.push({ ...structuredClone(source.rules[0]), id: "chosen", effect: { type: "choose", mode: "rotate", options: [{ type: "celebrate", message: "Hooray", appearance: { style: "hearts", color: "#123456", durationSeconds: 8, sound: { ...sound, volume: 30 } } }] } });
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  const calls = [];
  const output = await publishAutomationImages(source, auth, false, async (endpoint, options) => { calls.push({ endpoint, options }); return reply({ path: `/sounds/123/${hash}.wav` }); });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, `${IMAGE_ORIGIN}/sounds/123`);
  assert.equal(calls[0].options.headers["Content-Type"], "audio/wav");
  assert.deepEqual(calls[0].options.body, bytes);
  assert.equal(output.rules[0].effect.appearance.sound.url, `${IMAGE_ORIGIN}/sounds/123/${hash}.wav`);
  assert.equal(output.rules[1].effect.options[0].appearance.sound.volume, 30);
  assert.equal(source.rules[0].effect.appearance.sound.url, url);
  assert.throws(() => automationPreflight({ ...source, rules: [{ ...source.rules[0], effect: { ...source.rules[0].effect, appearance: { ...source.rules[0].effect.appearance, sound: { ...sound, url: `${IMAGE_ORIGIN}/sounds/999/${hash}.wav` } } } }] }, "123", false), /another channel/);
  await assert.rejects(saveAutomationConfig(auth, source, 1, false, async () => { throw Error("must not save"); }), /not been uploaded/);
});

test("viewer requires the saved uploaded sound URL and name", async () => {
  const hash = "a".repeat(64), sound = { preset: "upload", url: `${IMAGE_ORIGIN}/sounds/123/${hash}.wav`, name: "Cheers", volume: 70 };
  const saved = config(); saved.design.rules[0].effect.appearance = { style: "confetti", color: "#123456", durationSeconds: 8, sound };
  const shown = [], h = helper();
  const stop = watchAutomationEvents(h, auth, () => {}, value => shown.push(value), () => {}, async () => reply(saved), () => 2000);
  await flush();
  const appearance = saved.design.rules[0].effect.appearance;
  await send(h, event({ eventId: "valid-upload", effect: { type: "celebrate", message: "Hooray", appearance } }));
  await send(h, event({ eventId: "changed-url", effect: { type: "celebrate", message: "Hooray", appearance: { ...appearance, sound: { ...sound, url: `${IMAGE_ORIGIN}/sounds/123/${"b".repeat(64)}.wav` } } } }));
  await send(h, event({ eventId: "changed-name", effect: { type: "celebrate", message: "Hooray", appearance: { ...appearance, sound: { ...sound, name: "Other" } } } }));
  assert.deepEqual(shown.map(value => value.eventId), ["valid-upload"]);
  stop();
});

test("viewer requires saved Hype music playback mode as well as MP3 address", async () => {
  const sound = { preset: "upload", url: `${IMAGE_ORIGIN}/sounds/123/${"c".repeat(64)}.mp3`, name: "Train music", volume: 70, playback: "hype-loop" };
  const saved = config(); saved.design.rules[0].effect.appearance = { style: "hype-train", color: "#123456", durationSeconds: 8, sound };
  const shown = [], h = helper();
  const stop = watchAutomationEvents(h, auth, () => {}, value => shown.push(value), () => {}, async () => reply(saved), () => 2000);
  await flush();
  const appearance = saved.design.rules[0].effect.appearance;
  await send(h, event({ eventId: "music-ok", effect: { type: "celebrate", message: "Hooray", appearance } }));
  await send(h, event({ eventId: "music-mode-removed", effect: { type: "celebrate", message: "Hooray", appearance: { ...appearance, sound: { preset: "upload", url: sound.url, name: sound.name, volume: sound.volume } } } }));
  assert.deepEqual(shown.map(value => value.eventId), ["music-ok"]);
  stop();
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

test("viewer admits only the saved celebration appearance and keeps it intact", async () => {
  const h = helper(), shown = [], saved = design();
  const appearance = { style: "spotlight", color: "#aBc123", durationSeconds: 13, sound: { preset: "fanfare", volume: 85 } };
  saved.rules[0].effect.appearance = appearance;
  const stop = watchAutomationEvents(h, auth, () => {}, value => shown.push(value), () => {}, async () => reply({ ...config(), design: saved }), () => 2000);
  await flush();
  await send(h, event({ eventId: "good-look", effect: { type: "celebrate", message: "Hooray", appearance } }));
  for (const [eventId, candidateAppearance] of [
    ["wrong-style", { ...appearance, style: "confetti" }],
    ["wrong-color", { ...appearance, color: "#ffffff" }],
    ["wrong-duration", { ...appearance, durationSeconds: 20 }],
    ["unknown-style", { ...appearance, style: "laser" }],
    ["bad-color", { ...appearance, color: "red" }],
    ["bad-duration", { ...appearance, durationSeconds: 21 }],
    ["extra-field", { ...appearance, metadata: "untrusted" }],
    ["bad-sound", { ...appearance, sound: { preset: "siren", volume: 85 } }],
    ["bad-volume", { ...appearance, sound: { preset: "fanfare", volume: 101 } }],
    ["extra-sound-field", { ...appearance, sound: { ...appearance.sound, audioUrl: "https://example.invalid/tone" } }],
  ]) await send(h, event({ eventId, effect: { type: "celebrate", message: "Hooray", appearance: candidateAppearance } }));
  await send(h, event({ eventId: "missing-appearance", effect: { type: "celebrate", message: "Hooray" } }));
  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0].effect.appearance, appearance);
  stop();
});

test("viewer admits an appearance saved inside an enabled choose effect", async () => {
  const h = helper(), shown = [], saved = design();
  const appearance = { style: "hype-train", color: "#123ABC", durationSeconds: 8 };
  saved.rules[0].effect = { type: "choose", mode: "rotate", options: [{ type: "celebrate", message: "Hooray", appearance }] };
  const stop = watchAutomationEvents(h, auth, () => {}, value => shown.push(value), () => {}, async () => reply({ ...config(), design: saved }), () => 2000);
  await flush();
  await send(h, event({ effect: { type: "celebrate", message: "Hooray", appearance } }));
  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0].effect.appearance, appearance);
  stop();
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

test("mobile catch-up reads once and shares broadcast validation and deduplication", async () => {
  const h = helper(), shown = [], reads = [], errors = [];
  const stop = watchAutomationEvents(h, auth, () => {}, value => shown.push(value), value => errors.push(value), async url => {
    reads.push(url);
    return reply(url.endsWith('/active') ? { channelId: '123', revision: 1, event: event() } : config());
  }, () => 2000, { catchUp: true });
  await flush();
  assert.equal(shown.length, 1);
  await send(h, event());
  assert.equal(shown.length, 1);
  assert.equal(reads.length, 2);
  await flush(); assert.equal(reads.length, 2, 'no polling');
  assert.deepEqual(errors, []); stop();
});

test("mobile catch-up cannot replace a newer live event or finish after teardown", async () => {
  for (const teardown of [false, true]) {
    const h = helper(), shown = []; let resolve;
    const stop = watchAutomationEvents(h, auth, () => {}, value => shown.push(value), () => {}, async url => {
      if (url.endsWith('/active')) return new Promise(done => { resolve = done; });
      return reply(config());
    }, () => 2000, { catchUp: true });
    await flush();
    if (teardown) stop(); else await send(h, event({ eventId: 'newer', created: 1900 }));
    resolve(reply({ channelId: '123', revision: 1, event: event() })); await flush();
    assert.deepEqual(shown.map(item => item.eventId), teardown ? [] : ['newer']);
    if (!teardown) stop();
  }
});

test("mobile catch-up rejects wrong-channel, expired and old-revision responses", async () => {
  for (const payload of [
    { channelId: '999', revision: 1, event: event() },
    { channelId: '123', revision: 1, event: event({ expires: 1500 }) },
    { channelId: '123', revision: 1, event: event() },
  ]) {
    const h = helper(), shown = [];
    const stop = watchAutomationEvents(h, auth, () => {}, value => shown.push(value), () => {}, async url => reply(url.endsWith('/active') ? payload : config(2)), () => 2000, { catchUp: true });
    await flush(); assert.equal(shown.length, 0); stop();
  }
});

test('Hype lifecycle watcher admits saved snapshots, keeps end terminal, and rejects foreign or altered effects', async t => {
  const h = helper(), received=[];
  const effect={type:'celebrate',message:'Level {hypeLevel} train',appearance:{style:'hype-train',color:'#f97316',durationSeconds:12,hypeLifecycle:true,sound:{preset:'train',volume:70}}};
  const saved=config(); saved.design.rules=[{id:'train',name:'Train',enabled:true,trigger:{type:'twitch',event:'hype_begin'},effect,cooldownSeconds:0}];
  const snapshot=(patch={})=>({type:'scene-studio-hype',eventId:crypto.randomUUID(),channelId:'123',revision:1,created:1000,expires:101000,effect,hype:{id:'train-1',phase:'active',level:1,progress:25,goal:100,expiresAt:101000,updatedAt:1000},...patch});
  const stop=watchAutomationEvents(h,auth,()=>{},()=>assert.fail('Train entered ordinary effect queue'),()=>{},async url=>url.endsWith('/hype')?reply({channelId:'123',revision:1,event:null}):reply(saved),()=>2000,{onHype:event=>received.push(event)});
  t.after(stop); await flush(); await flush();
  const begin=snapshot(); await send(h,begin); await send(h,begin);
  assert.equal(received.filter(Boolean).length,1);
  await send(h,snapshot({channelId:'456'}));
  await send(h,snapshot({effect:{...effect,message:'Unsaved content'}}));
  assert.equal(received.filter(Boolean).length,1);
  const end=snapshot({created:2000,expires:14000,hype:{...begin.hype,phase:'ended',level:2,expiresAt:14000,updatedAt:2000}});
  await send(h,end);
  await send(h,snapshot({created:2500,hype:{...begin.hype,updatedAt:2500}}));
  assert.equal(received.filter(Boolean).length,2,'late active snapshot cannot reopen an ended train');
  assert.equal(received.at(-1).hype.phase,'ended');
});

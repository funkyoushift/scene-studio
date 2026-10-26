import test from "node:test";
import assert from "node:assert/strict";
import { AUTOMATION_LIMITS, validateAutomations, parseAutomations, keywordMatches, createAutomationState, evaluateAutomations } from "../src/automations.mjs";
import { IMAGE_ORIGIN } from "../src/image-address.mjs";

function fixture() {
  return {
    version: 1,
    carousels: [{ id: "features", title: "Featured moments", displaySeconds: 5, slides: [
      { id: "first", title: "First moment", caption: "Your story", image: "", url: "https://example.com" },
      { id: "second", title: "Another moment", caption: "Keep exploring", image: `${IMAGE_ORIGIN}/images/123/${"a".repeat(64)}.png`, url: "" },
    ] }],
    rules: [
      { id: "cheer", name: "Say hello", enabled: true, trigger: { type: "keyword", phrase: "hello", match: "word" }, effect: { type: "celebrate", message: "Welcome in!" }, cooldownSeconds: 10 },
      { id: "rotate", name: "Show the carousel", enabled: true, trigger: { type: "interval", everySeconds: 30 }, effect: { type: "carousel", carouselId: "features" }, cooldownSeconds: 45 },
    ],
  };
}

test("automation imports normalize portable data while reusing the scene image and link boundary", () => {
  const input = fixture();
  input.script = "untrusted extra";
  input.carousels[0].slides[0].onclick = "untrusted extra";
  input.rules[0].effect.execute = "untrusted extra";
  const snapshot = JSON.stringify(input);
  const result = parseAutomations(snapshot);
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal(result.script, undefined);
  assert.equal(result.carousels[0].slides[0].onclick, undefined);
  assert.equal(result.rules[0].effect.execute, undefined);
  assert.equal(result.carousels[0].slides[0].url, "https://example.com/");
  assert.deepEqual(parseAutomations(JSON.stringify(result)), result);
  assert.throws(() => parseAutomations("not JSON"), /valid JSON/);
  assert.throws(() => parseAutomations(" ".repeat(2_000_001)), /under 2 MB/);
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "http://example.com", "https://user:password@example.com", "bad address"]) {
    const candidate = fixture(); candidate.carousels[0].slides[0].url = url;
    assert.throws(() => validateAutomations(candidate));
  }
  for (const image of ["https://example.com/tracker.png", "data:image/svg+xml;base64,PHN2Zz4=", "data:text/html;base64,aGk=", `${IMAGE_ORIGIN}/images/123/${"a".repeat(64)}.png?track=1`, "a".repeat(700_001)]) {
    const candidate = fixture(); candidate.carousels[0].slides[0].image = image;
    assert.throws(() => validateAutomations(candidate));
  }
  const raster = fixture(); raster.carousels[0].slides[0].image = "data:image/png;base64,aGk=";
  assert.equal(validateAutomations(raster).carousels[0].slides[0].image, raster.carousels[0].slides[0].image);
});

test("automation validation enforces counts, IDs, references, supported actions and duration bounds", () => {
  const bad = [
    value => { value.version = 2; },
    value => { value.carousels = Array.from({ length: AUTOMATION_LIMITS.carousels + 1 }, (_, i) => ({ ...value.carousels[0], id: `c${i}` })); },
    value => { value.carousels[0].slides = []; },
    value => { value.carousels[0].slides = Array.from({ length: AUTOMATION_LIMITS.slides + 1 }, (_, i) => ({ ...value.carousels[0].slides[0], id: `s${i}` })); },
    value => { value.rules = Array.from({ length: AUTOMATION_LIMITS.rules + 1 }, (_, i) => ({ ...value.rules[0], id: `r${i}` })); },
    value => { value.carousels.push(structuredClone(value.carousels[0])); },
    value => { value.carousels[0].slides[1].id = "first"; },
    value => { value.rules[1].id = "cheer"; },
    value => { value.rules[0].id = "contains spaces"; },
    value => { value.rules[1].effect.carouselId = "missing"; },
    value => { value.rules[0].enabled = "true"; },
    value => { value.rules[0].trigger.phrase = "   "; },
    value => { value.rules[0].trigger.match = "regex"; },
    value => { value.rules[0].trigger.type = "code"; },
    value => { value.rules[0].effect.type = "sendChat"; },
    value => { value.rules[0].effect.message = " "; },
    value => { value.rules[0].effect.message = "x".repeat(161); },
    value => { value.carousels[0].displaySeconds = 1; },
    value => { value.carousels[0].displaySeconds = 301; },
    value => { value.rules[1].trigger.everySeconds = 4; },
    value => { value.rules[1].trigger.everySeconds = 3601; },
    value => { value.rules[0].cooldownSeconds = -1; },
    value => { value.rules[0].cooldownSeconds = Infinity; },
    value => { value.rules[0].cooldownSeconds = 1.5; },
  ];
  for (const mutate of bad) {
    const candidate = fixture(); mutate(candidate);
    assert.throws(() => validateAutomations(candidate));
  }
  const tooLarge = fixture();
  tooLarge.carousels[0].slides = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, title: "Image", caption: "", url: "", image: `data:image/png;base64,${"a".repeat(600_000)}` }));
  assert.throws(() => validateAutomations(tooLarge), /large|2 MB/i);
  assert.deepEqual(validateAutomations({ version: 1, carousels: [], rules: [] }), { version: 1, carousels: [], rules: [] });
});

test("keyword matching is case-insensitive and literal with Unicode-aware word boundaries", () => {
  assert.equal(keywordMatches("Well, HELLO there!", "hello", "word"), true);
  assert.equal(keywordMatches("shelloworld", "hello", "word"), false);
  assert.equal(keywordMatches("shelloworld", "hello", "contains"), true);
  assert.equal(keywordMatches("hello_world", "hello", "word"), false);
  assert.equal(keywordMatches("Bonjour, CAFÉ!", "cafe\u0301", "word"), true);
  assert.equal(keywordMatches("un caféine", "café", "word"), false);
  assert.equal(keywordMatches("猫!", "猫", "word"), true);
  assert.equal(keywordMatches("猫耳", "猫", "word"), false);
  assert.equal(keywordMatches("Learn C++ today", "c++", "word"), true);
  assert.equal(keywordMatches("The literal [wow].", "[wow]", "word"), true);
  assert.equal(keywordMatches("anything", ".*", "contains"), false);
  assert.equal(keywordMatches("say GOOD GAME!", "good game", "word"), true);
  assert.throws(() => keywordMatches("hello", "   "), /nonempty/);
  assert.throws(() => keywordMatches("hello", "hello", "regex"), /word or contains/);
  assert.throws(() => keywordMatches("x".repeat(2001), "x"), /2000/);
});

test("keyword evaluation applies independent cooldowns without mutating data or state", () => {
  const design = fixture();
  design.rules.push({ ...structuredClone(design.rules[0]), id: "another", cooldownSeconds: 20 });
  const initial = createAutomationState(1000);
  const original = JSON.stringify({ design, initial });
  let result = evaluateAutomations(design, initial, { type: "message", text: "hello!" }, 1000);
  assert.deepEqual(result.events.map(event => event.ruleId), ["cheer", "another"]);
  assert.equal(JSON.stringify({ design, initial }), original);
  assert.equal(evaluateAutomations(design, result.state, { type: "message", text: "hello" }, 10999).events.length, 0);
  result = evaluateAutomations(design, result.state, { type: "message", text: "hello" }, 11000);
  assert.deepEqual(result.events.map(event => event.ruleId), ["cheer"]);
  result.events[0].effect.message = "changed outside the engine";
  assert.equal(design.rules[0].effect.message, "Welcome in!");
  design.rules[0].enabled = false;
  result = evaluateAutomations(design, result.state, { type: "message", text: "hello" }, 21000);
  assert.deepEqual(result.events.map(event => event.ruleId), ["another"]);
  assert.equal(evaluateAutomations(design, initial, { type: "tick" }, 1000).events.length, 0);
});

test("interval evaluation waits a period, respects cooldowns, and never replays missed ticks", () => {
  const design = fixture();
  let state = createAutomationState(5000);
  assert.equal(evaluateAutomations(design, state, { type: "tick" }, 34999).events.length, 0);
  assert.equal(evaluateAutomations(design, state, { type: "message", text: "something else" }, 35000).events.length, 0);
  let result = evaluateAutomations(design, state, { type: "tick" }, 35000);
  assert.deepEqual(result.events, [{ ruleId: "rotate", name: "Show the carousel", effect: { type: "carousel", carouselId: "features" }, at: 35000 }]);
  state = result.state;
  assert.equal(evaluateAutomations(design, state, { type: "tick" }, 65000).events.length, 0);
  result = evaluateAutomations(design, state, { type: "tick" }, 80000);
  assert.equal(result.events.length, 1);
  result = evaluateAutomations(design, result.state, { type: "tick" }, 1000000);
  assert.equal(result.events.length, 1);
  assert.equal(evaluateAutomations(design, result.state, { type: "tick" }, 1000000).events.length, 0);
  design.rules[1].enabled = false;
  assert.equal(evaluateAutomations(design, state, { type: "tick" }, 1000000).events.length, 0);
});

test("runtime validation rejects impossible clocks and handles property-like rule IDs safely", () => {
  const design = fixture();
  const state = createAutomationState(1000);
  assert.throws(() => createAutomationState(NaN), /timestamp/);
  assert.throws(() => evaluateAutomations(design, state, { type: "tick" }, Infinity), /timestamp/);
  assert.throws(() => evaluateAutomations(design, state, { type: "tick" }, 999), /earlier/);
  assert.throws(() => evaluateAutomations(design, { ...state, lastFired: { cheer: 3000 } }, { type: "tick" }, 2000), /timestamps/);
  assert.throws(() => evaluateAutomations(design, state, { type: "network" }, 2000), /message, tick, or external/);
  design.rules[0].id = "__proto__";
  const result = evaluateAutomations(design, state, { type: "message", text: "hello" }, 1000);
  assert.equal(Object.hasOwn(result.state.lastFired, "__proto__"), true);
  assert.equal(result.state.lastFired.__proto__, 1000);
  assert.equal(Object.getPrototypeOf(result.state.lastFired), Object.prototype);
  assert.equal(evaluateAutomations(design, result.state, { type: "message", text: "hello" }, 1001).events.length, 0);
});

test("external event names are bounded literal identifiers in both designs and runtime input", () => {
  const design = fixture();
  design.rules[0].trigger = { type: "external", event: "boss_defeated", payload: "discarded" };
  assert.deepEqual(parseAutomations(JSON.stringify(design)).rules[0].trigger, { type: "external", event: "boss_defeated" });
  for (const name of ["a", "Game.boss-2_defeated", "a".repeat(64)]) {
    design.rules[0].trigger.event = name;
    assert.equal(evaluateAutomations(design, createAutomationState(), { type: "external", name }, 0).events.length, 1);
  }
  for (const name of [undefined, null, 123, "", "a".repeat(65), "1boss", "_boss", ".boss", "boss defeated", " boss", "boss ", "boss\n", "boss/defeated", "boss.*", "${boss}", "évent"]) {
    design.rules[0].trigger.event = name;
    assert.throws(() => validateAutomations(design), /External event names/);
    design.rules[0].trigger.event = "boss_defeated";
    assert.throws(() => evaluateAutomations(design, createAutomationState(), { type: "external", name }, 0), /External event names/);
  }
});

test("external events match exactly, ignore payloads, and render only the saved effect", () => {
  const design = fixture();
  design.rules[0].trigger = { type: "external", event: "boss_defeated" };
  design.rules[0].effect.message = "Boss down! ${payload.name}";
  const state = createAutomationState();
  for (const event of [{ type: "external", name: "Boss_defeated" }, { type: "external", name: "boss_defeated_again" }, { type: "message", text: "boss_defeated" }, { type: "tick" }]) {
    const result = evaluateAutomations(design, state, event, 0);
    assert.deepEqual(result.events, []);
    assert.deepEqual(result.state, state);
  }
  const input = { type: "external", name: "boss_defeated", get payload() { throw new Error("External payload must not be read"); } };
  const result = evaluateAutomations(design, state, input, 0);
  assert.deepEqual(result.events, [{ ruleId: "cheer", name: "Say hello", effect: { type: "celebrate", message: "Boss down! ${payload.name}" }, at: 0 }]);
  assert.deepEqual(state, createAutomationState());
  design.rules[0].enabled = false;
  assert.deepEqual(evaluateAutomations(design, state, input, 10000).events, []);
});

test("external rules have independent cooldowns and do not consume keyword or interval rules", () => {
  const design = fixture();
  design.rules.push({ ...structuredClone(design.rules[0]), id: "boss", trigger: { type: "external", event: "boss_defeated" } });
  design.rules.push({ ...structuredClone(design.rules[2]), id: "boss_slow", cooldownSeconds: 20 });
  let result = evaluateAutomations(design, createAutomationState(), { type: "external", name: "boss_defeated" }, 0);
  assert.deepEqual(result.events.map(event => event.ruleId), ["boss", "boss_slow"]);
  result = evaluateAutomations(design, result.state, { type: "message", text: "hello" }, 0);
  assert.deepEqual(result.events.map(event => event.ruleId), ["cheer"]);
  assert.deepEqual(evaluateAutomations(design, result.state, { type: "external", name: "boss_defeated" }, 9999).events, []);
  result = evaluateAutomations(design, result.state, { type: "external", name: "boss_defeated" }, 10000);
  assert.deepEqual(result.events.map(event => event.ruleId), ["boss"]);
  result = evaluateAutomations(design, result.state, { type: "external", name: "boss_defeated" }, 20000);
  assert.deepEqual(result.events.map(event => event.ruleId), ["boss", "boss_slow"]);
  result = evaluateAutomations(design, result.state, { type: "tick" }, 30000);
  assert.deepEqual(result.events.map(event => event.ruleId), ["rotate"]);
});

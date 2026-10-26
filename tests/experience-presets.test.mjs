import test from "node:test";
import assert from "node:assert/strict";
import { AUTOMATION_LIMITS, validateAutomations } from "../src/automations.mjs";
import { addExperiencePreset, EXPERIENCE_PRESETS, removeExperience } from "../src/experience-presets.mjs";

const empty = () => ({ version: 1, carousels: [], rules: [] });

test("all experience presets add valid, page-linked designs with the intended trigger", () => {
  assert.ok(EXPERIENCE_PRESETS.length >= 24, "the experience library should offer dozens of starters");
  assert.equal(new Set(EXPERIENCE_PRESETS.map(preset => preset.key)).size, EXPERIENCE_PRESETS.length);
  assert.ok(["Community", "Stream info", "Gaming", "Promotion", "Engagement"].every(category => EXPERIENCE_PRESETS.some(preset => preset.category === category)));
  assert.deepEqual(EXPERIENCE_PRESETS.filter(preset => ["subscriber-thanks", "hype-train", "chat-celebration"].includes(preset.key)).map(({ key, title, description }) => ({ key, title, description })), [
    { key: "subscriber-thanks", title: "Subscriber thanks", description: "Thank {subscriber} with a purple spotlight when they subscribe." },
    { key: "hype-train", title: "Hype Train", description: "Call out Hype Train level {hypeLevel} in an orange Hype express celebration." },
    { key: "chat-celebration", title: "Chat celebration", description: "Start a lime confetti celebration when chat says party." },
  ]);
  for (const preset of EXPERIENCE_PRESETS) {
    const { design, pageId } = addExperiencePreset(empty(), preset.key);
    assert.deepEqual(validateAutomations(design), design);
    assert.equal(design.rules.length, 1);
    assert.equal(design.pages.find(page => page.id === pageId).ruleIds[0], design.rules[0].id);
    const rule = design.rules[0];
    if (preset.key === "subscriber-thanks") {
      assert.deepEqual(rule.trigger, { type: "twitch", event: "subscribe" });
      assert.deepEqual(rule.effect, { type: "celebrate", message: "Thanks, {subscriber}!", appearance: { style: "spotlight", color: "#a855f7", durationSeconds: 8 } });
    } else if (preset.key === "hype-train") {
      assert.deepEqual(rule.trigger, { type: "twitch", event: "hype_begin" });
      assert.deepEqual(rule.effect, { type: "celebrate", message: "Level {hypeLevel} Hype Train! Join the celebration!", appearance: { style: "hype-train", color: "#f97316", durationSeconds: 12 } });
    } else if (preset.key === "chat-celebration") {
      assert.deepEqual(rule.trigger, { type: "keyword", phrase: "party", match: "word" });
      assert.deepEqual(rule.effect, { type: "celebrate", message: "Chat celebration!", appearance: { style: "confetti", color: "#a3e635", durationSeconds: 8 } });
    }
    if (rule.effect.type === "carousel") {
      const carousel = design.carousels[0];
      assert.equal(rule.effect.carouselId, carousel.id);
      assert.deepEqual(design.pages[0].carouselIds, [carousel.id]);
      assert.ok(carousel.slides.length >= 1 && carousel.slides.length <= AUTOMATION_LIMITS.slides);
      assert.ok(carousel.displaySeconds >= AUTOMATION_LIMITS.displaySeconds[0] && carousel.displaySeconds <= AUTOMATION_LIMITS.displaySeconds[1]);
      for (const slide of carousel.slides) {
        assert.equal(slide.image, "");
        assert.equal(slide.url, "");
      }
    }
    if (rule.effect.type === "choose") {
      assert.equal(rule.effect.mode, "random");
      assert.ok(rule.effect.options.length >= 2);
      assert.ok(rule.effect.options.every(option => option.type === "celebrate"));
    }
    assert.ok(Number.isInteger(rule.cooldownSeconds) && rule.cooldownSeconds >= AUTOMATION_LIMITS.cooldownSeconds[0] && rule.cooldownSeconds <= AUTOMATION_LIMITS.cooldownSeconds[1]);
  }
});

test("requested community, gaming, promotion, event, and randomized starters use only supported primitives", () => {
  const triggers = {
    "stream-rules": { type: "keyword", phrase: "rules", match: "word" },
    "faq-answers": { type: "keyword", phrase: "faq", match: "word" },
    "stream-schedule": { type: "keyword", phrase: "schedule", match: "word" },
    "welcome-chat": { type: "keyword", phrase: "welcome", match: "word" },
    "lurk-note": { type: "keyword", phrase: "lurk", match: "word" },
    "spoiler-reminder": { type: "keyword", phrase: "spoiler", match: "contains" },
    "game-goals": { type: "keyword", phrase: "goal", match: "word" },
    "build-notes": { type: "keyword", phrase: "build", match: "word" },
    "loadout-notes": { type: "keyword", phrase: "loadout", match: "word" },
    "modding-notes": { type: "keyword", phrase: "mods", match: "word" },
    "product-drop": { type: "keyword", phrase: "drop", match: "word" },
    "featured-item": { type: "keyword", phrase: "featured", match: "word" },
    "resub-thanks": { type: "twitch", event: "resubscribe" },
    "gift-thanks": { type: "twitch", event: "gift" },
    "hype-progress": { type: "twitch", event: "hype_progress" },
    "hype-finish": { type: "twitch", event: "hype_end" },
    "random-party": { type: "keyword", phrase: "party", match: "word" },
    "random-cheer": { type: "keyword", phrase: "cheer", match: "word" },
    "stream-checkin": { type: "interval", everySeconds: 1800 },
    "stretch-break": { type: "interval", everySeconds: 3600 },
  };
  for (const [key, trigger] of Object.entries(triggers)) {
    const { design } = addExperiencePreset(empty(), key);
    assert.deepEqual(design.rules[0].trigger, trigger, key);
    assert.deepEqual(validateAutomations(design), design, key);
  }
  assert.equal(addExperiencePreset(empty(), "random-party").design.rules[0].effect.type, "choose");
  assert.equal(addExperiencePreset(empty(), "random-cheer").design.rules[0].effect.type, "choose");
});

test("an empty design receives only the requested preset page", () => {
  const { design } = addExperiencePreset(empty(), "custom-popup");
  assert.equal(design.pages.length, 1);
  assert.equal(design.pages[0].name, "Custom popup");
});

test("adding a preset preserves existing content and derives legacy pages", () => {
  const source = { version: 1, carousels: [{ id: "old-carousel", title: "Old", displaySeconds: 10, slides: [{ id: "old-slide", title: "Old slide", caption: "kept", image: "", url: "" }] }], rules: [{ id: "old-rule", name: "Old rule", enabled: false, trigger: { type: "keyword", phrase: "old", match: "word" }, effect: { type: "carousel", carouselId: "old-carousel" }, cooldownSeconds: 5 }] };
  const before = structuredClone(source);
  const { design } = addExperiencePreset(source, "subscriber-thanks");
  assert.deepEqual(source, before);
  assert.deepEqual(design.carousels[0], before.carousels[0]);
  assert.deepEqual(design.rules[0], before.rules[0]);
  assert.equal(design.pages[0].ruleIds[0], "old-rule");
  assert.equal(design.pages.length, 2);
  const withSecondPreset = addExperiencePreset(design, "random-party").design;
  assert.equal(withSecondPreset.rules.length, 3);
  assert.equal(withSecondPreset.carousels.length, 1);
  assert.deepEqual(withSecondPreset.rules.slice(0, 2), design.rules);
});

test("generated identifiers avoid collisions, including repeated additions", () => {
  let design = empty();
  const first = addExperiencePreset(design, "merch-carousel");
  const second = addExperiencePreset(first.design, "merch-carousel");
  design = second.design;
  const ids = [...design.carousels.map(x => x.id), ...design.carousels.flatMap(x => x.slides.map(s => s.id)), ...design.rules.map(x => x.id), ...design.pages.map(x => x.id)];
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(first.pageId, second.pageId);
  assert.deepEqual(validateAutomations(design), design);
});

test("preset addition respects carousel, rule, and page limits", () => {
  const carouselFull = empty();
  carouselFull.carousels = Array.from({ length: AUTOMATION_LIMITS.carousels }, (_, i) => ({ id: `c${i}`, title: `C${i}`, displaySeconds: 10, slides: [{ id: `s${i}`, title: "Slide", caption: "", image: "", url: "" }] }));
  assert.throws(() => addExperiencePreset(carouselFull, "merch-carousel"), /carousels/);
  const rulesFull = empty();
  rulesFull.rules = Array.from({ length: AUTOMATION_LIMITS.rules }, (_, i) => ({ id: `r${i}`, name: "Rule", enabled: true, trigger: { type: "keyword", phrase: "x", match: "word" }, effect: { type: "celebrate", message: "Hi" }, cooldownSeconds: 0 }));
  assert.throws(() => addExperiencePreset(rulesFull, "chat-celebration"), /rules/);
  const pagesFull = empty();
  pagesFull.pages = Array.from({ length: AUTOMATION_LIMITS.pages }, (_, i) => ({ id: `p${i}`, name: "Page", ruleIds: [], carouselIds: [] }));
  assert.throws(() => addExperiencePreset(pagesFull, "custom-popup"), /pages/);
});

test("unknown preset keys are rejected", () => {
  assert.throws(() => addExperiencePreset(empty(), "unknown"), /supported/);
});

test("removing an experience preserves shared references and unrelated content without mutating input", () => {
  const source = {
    version: 1,
    carousels: [
      { id: "shared-carousel", title: "Shared", displaySeconds: 10, slides: [{ id: "shared-slide", title: "Shared", caption: "", image: "", url: "" }] },
      { id: "private-carousel", title: "Private", displaySeconds: 10, slides: [{ id: "private-slide", title: "Private", caption: "", image: "", url: "" }] },
      { id: "unassigned-carousel", title: "Unassigned", displaySeconds: 10, slides: [{ id: "unassigned-slide", title: "Unassigned", caption: "", image: "", url: "" }] },
    ],
    rules: [
      { id: "shared-rule", name: "Shared", enabled: true, trigger: { type: "keyword", phrase: "shared", match: "word" }, effect: { type: "carousel", carouselId: "shared-carousel" }, cooldownSeconds: 0 },
      { id: "private-rule", name: "Private", enabled: true, trigger: { type: "keyword", phrase: "private", match: "word" }, effect: { type: "carousel", carouselId: "private-carousel" }, cooldownSeconds: 0 },
      { id: "unassigned-rule", name: "Unassigned", enabled: true, trigger: { type: "keyword", phrase: "other", match: "word" }, effect: { type: "celebrate", message: "Unassigned" }, cooldownSeconds: 0 },
    ],
    pages: [
      { id: "remove-me", name: "Remove", ruleIds: ["shared-rule", "private-rule"], carouselIds: ["shared-carousel", "private-carousel"] },
      { id: "keep-me", name: "Keep", ruleIds: ["shared-rule"], carouselIds: ["shared-carousel"] },
    ],
  };
  const before = structuredClone(source);
  const result = removeExperience(source, "remove-me");
  assert.deepEqual(source, before);
  assert.deepEqual(result.pages.map(page => page.id), ["keep-me"]);
  assert.deepEqual(result.rules.map(rule => rule.id), ["shared-rule", "unassigned-rule"]);
  assert.deepEqual(result.carousels.map(carousel => carousel.id), ["shared-carousel", "unassigned-carousel"]);
  assert.deepEqual(validateAutomations(result), result);
});

test("removing a missing experience fails clearly", () => {
  assert.throws(() => removeExperience(empty(), "missing"), /exists/);
});
import { addExperiencePresets } from '../src/experience-presets.mjs';

test('layout selection adds deduplicated moments and rejects overflow without changing the draft', () => {
  const original = { version: 1, carousels: [], rules: [] };
  const snapshot = structuredClone(original);
  const result = addExperiencePresets(original, ['subscriber-thanks', 'hype-train', 'subscriber-thanks']);
  assert.equal(result.design.pages.length, 2);
  assert.equal(result.pageIds.length, 2);
  assert.deepEqual(original, snapshot);
  assert.throws(() => addExperiencePresets(result.design, ['no-such-preset']), /supported/);
  assert.equal(result.design.pages.length, 2);
  const full = { ...original, rules: Array.from({ length: AUTOMATION_LIMITS.rules }, (_, i) => ({ id: `full-${i}`, name: 'Existing', enabled: true, trigger: { type: 'keyword', phrase: 'hello', match: 'word' }, effect: { type: 'celebrate', message: 'Welcome!' }, cooldownSeconds: 20 })), pages: [] };
  assert.throws(() => addExperiencePresets(full, ['subscriber-thanks']), /up to/);
  assert.deepEqual(original, snapshot);
});

test('existing fifteen-rule setup can add all four curated layouts without replacing any rule', () => {
  const source = { version: 1, carousels: [], rules: Array.from({ length: 15 }, (_, i) => ({ id: `kept-${i}`, name: `Existing ${i}`, enabled: true, trigger: { type: 'keyword', phrase: `kept${i}`, match: 'word' }, effect: { type: 'celebrate', message: 'Existing message' }, cooldownSeconds: 20 })), pages: [] };
  source.pages = Array.from({ length: 6 }, (_, i) => ({ id: `page-${i}`, name: `Page ${i}`, ruleIds: source.rules.filter((_, n) => n % 6 === i).map(r => r.id), carouselIds: [] }));
  const before = structuredClone(source);
  const keys = ['subscriber-thanks','hype-train','hype-progress','hype-finish','discord-invite','stream-rules','stream-schedule','game-goals','merch-carousel','featured-item'];
  const { design } = addExperiencePresets(source, keys);
  assert.equal(design.rules.length, 25);
  assert.equal(design.pages.length, 16);
  assert.equal(design.carousels.length, 6);
  assert.deepEqual(design.rules.slice(0,15), source.rules);
  assert.deepEqual(source, before);
});

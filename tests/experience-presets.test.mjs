import test from "node:test";
import assert from "node:assert/strict";
import { AUTOMATION_LIMITS, validateAutomations } from "../src/automations.mjs";
import { addExperiencePreset, EXPERIENCE_PRESETS, removeExperience } from "../src/experience-presets.mjs";

const empty = () => ({ version: 1, carousels: [], rules: [] });

test("all experience presets add valid, page-linked designs with the intended trigger", () => {
  assert.equal(EXPERIENCE_PRESETS.length, 6);
  for (const preset of EXPERIENCE_PRESETS) {
    const { design, pageId } = addExperiencePreset(empty(), preset.key);
    assert.deepEqual(validateAutomations(design), design);
    assert.equal(design.rules.length, 1);
    assert.equal(design.pages.find(page => page.id === pageId).ruleIds[0], design.rules[0].id);
    const rule = design.rules[0];
    if (preset.key === "subscriber-thanks") {
      assert.deepEqual(rule.trigger, { type: "twitch", event: "subscribe" });
      assert.deepEqual(rule.effect, { type: "celebrate", message: "Thanks, {subscriber}!" });
    } else if (preset.key === "hype-train") {
      assert.deepEqual(rule.trigger, { type: "twitch", event: "hype_begin" });
      assert.deepEqual(rule.effect, { type: "celebrate", message: "Level {hypeLevel} Hype Train! Join the celebration!" });
    }
    if (["merch-carousel", "discord-invite", "custom-popup"].includes(preset.key)) {
      const carousel = design.carousels[0];
      assert.equal(rule.effect.type, "carousel");
      assert.equal(rule.effect.carouselId, carousel.id);
      assert.deepEqual(design.pages[0].carouselIds, [carousel.id]);
      assert.equal(carousel.slides.length, preset.key === "merch-carousel" ? 3 : 1);
      for (const slide of carousel.slides) {
        assert.equal(slide.image, "");
        assert.equal(slide.url, "");
      }
    }
    assert.ok(rule.cooldownSeconds >= 20);
  }
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

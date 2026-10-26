import test from "node:test";
import assert from "node:assert/strict";
import { STORAGE_KEY } from "../src/scene.mjs";
import {
  AUTOMATION_STORAGE_KEY,
  automationDraftStorageKey,
  blankDraftScene,
  draftSlugFromSearch,
  sceneDraftStorageKey,
  validDraftSlug,
} from "../src/draft-workspace.mjs";

test("draft slugs accept only one bounded alphanumeric-hyphen value", () => {
  assert.equal(validDraftSlug("martin-first-run-20261026"), "martin-first-run-20261026");
  assert.equal(validDraftSlug("a".repeat(64)), "a".repeat(64));
  for (const slug of ["", "a".repeat(65), "has space", "one_two", "x/y", "é"]) {
    assert.equal(validDraftSlug(slug), null);
  }
  assert.equal(draftSlugFromSearch("?draft=first&draft=second"), null);
  assert.equal(draftSlugFromSearch("?draft=has%20space"), null);
});

test("only standalone editor URLs activate draft isolation", () => {
  assert.equal(draftSlugFromSearch("?draft=trial", { isViewer: true }), null);
  assert.equal(draftSlugFromSearch("?draft=trial", { isConfig: true }), null);
  assert.equal(draftSlugFromSearch("?draft=trial"), "trial");
});

test("scene and automation keys are separately namespaced per draft", () => {
  assert.equal(sceneDraftStorageKey(null), STORAGE_KEY);
  assert.equal(automationDraftStorageKey(null), AUTOMATION_STORAGE_KEY);
  assert.equal(sceneDraftStorageKey("trial"), `${STORAGE_KEY}:draft:trial`);
  assert.equal(automationDraftStorageKey("trial"), `${AUTOMATION_STORAGE_KEY}:draft:trial`);
  assert.notEqual(sceneDraftStorageKey("trial"), automationDraftStorageKey("trial"));
});

test("new draft scene starts without seeded objects", () => {
  assert.deepEqual(blankDraftScene(), { version: 1, name: "Untitled scene", objects: [] });
});

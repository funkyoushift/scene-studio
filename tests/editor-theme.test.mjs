import test from "node:test";
import assert from "node:assert/strict";
import {
  EDITOR_THEME_KEY,
  normalizeEditorTheme,
  readEditorTheme,
  writeEditorTheme,
} from "../src/editor-theme.mjs";

test("editor theme defaults to dark and normalizes invalid values", () => {
  assert.equal(readEditorTheme({ getItem: () => null }), "dark");
  assert.equal(normalizeEditorTheme("sepia"), "dark");
  assert.equal(normalizeEditorTheme("light"), "light");
});

test("editor theme persists choices and keeps working when storage is denied", () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(writeEditorTheme("light", storage), "light");
  assert.equal(values.get(EDITOR_THEME_KEY), "light");
  assert.equal(readEditorTheme(storage), "light");
  assert.equal(writeEditorTheme("dark", { setItem() { throw new Error("denied"); } }), "dark");
  assert.equal(readEditorTheme({ getItem() { throw new Error("denied"); } }), "dark");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  starterScene,
  parseScene,
  validateScene,
  safeLink,
  moveObject,
  twitchContent,
} from "../src/scene.mjs";

test("portable exports round-trip without retaining executable extra properties", () => {
  const input = starterScene();
  input.code = "alert(1)";
  input.objects[0].onclick = "alert(2)";
  const clean = parseScene(JSON.stringify(input));
  assert.equal(clean.objects.length, 2);
  assert.equal(clean.code, undefined);
  assert.equal(clean.objects[0].onclick, undefined);
  assert.deepEqual(parseScene(JSON.stringify(clean)), clean);
});
test("links reject executable schemes, credentials, and malformed addresses", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "http://example.com",
    "https://user:secret@example.com",
    "not a link",
  ])
    assert.throws(() => safeLink(value));
  assert.equal(
    safeLink("https://example.com/store"),
    "https://example.com/store",
  );
});
test("imports reject invalid identities, actions, coordinates, and active images", () => {
  for (const mutate of [
    (s) => s.objects.push({ ...s.objects[0] }),
    (s) => (s.objects[0].action = "run-script"),
    (s) => (s.objects[0].x = 99),
    (s) => (s.objects[0].width = Infinity),
    (s) => (s.objects[0].image = "data:image/svg+xml;base64,PHN2Zz4="),
    (s) => (s.objects[0].image = "https://example.com/tracker.png"),
  ]) {
    const s = starterScene();
    mutate(s);
    assert.throws(() => validateScene(s));
  }
  assert.throws(() => parseScene("{bad JSON"));
  assert.throws(() => parseScene(" ".repeat(2000001)));
});
test("dragging stays within bounds including fractional imported sizes", () => {
  const o = { ...starterScene().objects[0], width: 26.66, height: 24.66 };
  const moved = moveObject(o, 500, 500);
  assert.equal(moved.x, 100 - o.width);
  assert.equal(moved.y, 100 - o.height);
  assert.equal(moveObject(o, -50, -50).x, 0);
  assert.doesNotThrow(() =>
    validateScene({ version: 1, name: "dragged", objects: [moved] }),
  );
});
test("Twitch packaging enforces byte size and unsupported feature gates", () => {
  const clean = starterScene();
  assert.ok(twitchContent(clean).length > 0);
  clean.objects[0].action = "link";
  assert.throws(() => twitchContent(clean), /preview-only/);
  clean.objects[0].action = "reveal";
  clean.objects[0].image = "data:image/png;base64,AAAA";
  assert.throws(() => twitchContent(clean), /hosting/);
  clean.objects[0].image = "";
  for (const o of clean.objects) o.detail = "💚".repeat(600);
  assert.throws(() => twitchContent(clean), /5 KB/);
});

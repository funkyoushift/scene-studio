import test from "node:test";
import assert from "node:assert/strict";
import { TEMPLATE_OPTIONS, createTemplate } from "../src/templates.mjs";
import { bytes, parseScene, twitchContent, validateScene } from "../src/scene.mjs";

test("every starter template is portable, bounded and ready for Twitch without external assets", () => {
  assert.equal(new Set(TEMPLATE_OPTIONS.map(option => option.key)).size, TEMPLATE_OPTIONS.length);
  for (const option of TEMPLATE_OPTIONS) {
    const scene = createTemplate(option.key);
    assert.deepEqual(validateScene(scene), scene, option.key);
    const content = twitchContent(scene);
    assert.ok(bytes(content) < 5000, `${option.key} must leave room for Twitch configuration`);
    assert.deepEqual(parseScene(content), scene, option.key);
    for (const object of scene.objects) {
      assert.equal(object.image, "", `${option.key} must not require an image host`);
      assert.equal(object.url, "", `${option.key} must not require an external link`);
      assert.ok(object.x >= 0 && object.y >= 0);
      assert.ok(object.x + object.width <= 100 && object.y + object.height <= 100);
    }
  }
});

test("starter instances have fresh IDs and edits cannot alter another instance or template metadata", () => {
  const metadata = JSON.stringify(TEMPLATE_OPTIONS);
  const ids = new Set();
  for (const option of TEMPLATE_OPTIONS) {
    const first = createTemplate(option.key);
    const second = createTemplate(option.key);
    for (const scene of [first, second]) {
      for (const object of scene.objects) {
        assert.ok(!ids.has(object.id), `${option.key} reused an object ID`);
        ids.add(object.id);
      }
    }
    const secondBefore = JSON.stringify(second);
    first.name = "My edited scene";
    first.objects[0].detail = "My own words";
    first.objects.splice(1);
    assert.equal(JSON.stringify(second), secondBefore);
  }
  assert.equal(JSON.stringify(TEMPLATE_OPTIONS), metadata);
  assert.throws(() => createTemplate("unknown-template"), /supported starter template/);
});

test("information and mystery starters work entirely through local reveal interactions", () => {
  for (const key of ["streamer-info", "clue-hunt"]) {
    const scene = createTemplate(key);
    assert.ok(scene.objects.length >= 3);
    assert.ok(scene.objects.every(object => object.action === "reveal" && object.detail.trim().length > 0));
  }
});

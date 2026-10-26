import test from "node:test";
import assert from "node:assert/strict";
import {
  starterScene,
  parseScene,
  validateScene,
  safeLink,
  moveObject,
  twitchContent,
  objectAppearance,
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
test("motion presets survive portable and Twitch saves while legacy scenes stay still", () => {
  for (const motion of ["none", "float", "pulse", "sway"]) {
    const scene = starterScene();
    scene.objects[0].motion = motion;
    assert.equal(parseScene(twitchContent(scene)).objects[0].motion, motion);
  }
  const legacy = starterScene();
  delete legacy.objects[0].motion;
  assert.equal(validateScene(legacy).objects[0].motion, "none");
  for (const value of ["spin", "url(https://example.com)", {}, 1]) {
    legacy.objects[0].motion = value;
    assert.throws(() => validateScene(legacy), /supported motion/);
  }
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
  assert.throws(() => twitchContent(clean), /Add a full HTTPS website address/);
  clean.objects[0].action = "reveal";
  clean.objects[0].image = "data:image/png;base64,AAAA";
  assert.throws(() => twitchContent(clean), /hosting/);
  clean.objects[0].image = "";
  for (const o of clean.objects) o.detail = "💚".repeat(600);
  assert.throws(() => twitchContent(clean), /5 KB/);
});

test("Hosted Test link designs publish HTTPS destinations and identify missing object addresses", () => {
  const scene = starterScene();
  scene.objects[0].action = "link";
  scene.objects[0].title = "Visit my store";
  scene.objects[0].url = "https://streamlabs.com/FunkYouSHiFT/merch";
  assert.equal(parseScene(twitchContent(scene)).objects[0].url, scene.objects[0].url);
  scene.objects[0].url = "";
  assert.throws(() => twitchContent(scene), /HTTPS website address to "Visit my store"/);
  for (const address of ["http://example.com", "javascript:alert(1)", "data:text/html,hello", "https://user:secret@example.com", "not a link"]) {
    scene.objects[0].url = address;
    assert.throws(() => twitchContent(scene));
  }
  scene.objects[0].url = "https://example.com";
  for (const object of scene.objects) object.detail = "💚".repeat(600);
  assert.throws(() => twitchContent(scene), /5 KB/);
});

test("optional appearance round-trips through Twitch and produces only bounded inline styles", () => {
  const scene = starterScene();
  Object.assign(scene.objects[0], { background: "#123AbC", textColor: "#FFFFFF", opacity: 30, fontScale: 160, radius: 0, style: "position:fixed", css: "url(https://example.com)" });
  const saved = parseScene(twitchContent(scene)).objects[0];
  assert.deepEqual(objectAppearance(saved), { backgroundColor: "#123AbC", color: "#FFFFFF", opacity: 0.3, borderRadius: "0px", "--object-font-scale": 1.6 });
  assert.equal(saved.background, "#123AbC"); assert.equal(saved.opacity, 30); assert.equal(saved.radius, 0);
  assert.equal(saved.style, undefined); assert.equal(saved.css, undefined);
  assert.deepEqual(objectAppearance({ opacity: 100, fontScale: 70, radius: 48, position: "fixed" }), { opacity: 1, borderRadius: "48px", "--object-font-scale": 0.7 });
});

test("legacy objects add no appearance defaults or extra serialized bytes", () => {
  const scene = validateScene(starterScene()), before = JSON.stringify(scene);
  assert.deepEqual(objectAppearance(scene.objects[0]), {});
  for (const object of scene.objects) for (const field of ["background", "textColor", "opacity", "fontScale", "radius", "customIcon", "imageFit"]) assert.equal(Object.hasOwn(object, field), false);
  assert.equal(twitchContent(scene), before);
  scene.objects[0].opacity = undefined;
  scene.objects[0].customIcon = undefined;
  scene.objects[0].imageFit = undefined;
  assert.equal(twitchContent(scene), before);
});

test("custom icons count Unicode codepoints and image fit survives Twitch saves", () => {
  for (const customIcon of ["", "🦆".repeat(8), "👩‍🚀", "<3"]) for (const imageFit of ["cover", "contain", "icon"]) {
    const scene = starterScene();
    Object.assign(scene.objects[0], { customIcon, imageFit });
    const object = parseScene(twitchContent(scene)).objects[0];
    assert.equal(object.customIcon, customIcon); assert.equal(object.imageFit, imageFit);
    assert.equal(object.icon, scene.objects[0].icon, "custom text does not replace the preset icon");
  }
  const invalidPreset = starterScene();
  invalidPreset.objects[0].customIcon = "🦆"; invalidPreset.objects[0].icon = "custom";
  assert.throws(() => validateScene(invalidPreset), /Unknown interaction or icon/);
});

test("custom icon and image fit reject invalid types, controls and bidi formatting", () => {
  for (const customIcon of [null, {}, 5, ["x"], "🦆".repeat(9), "a\nb", "\u0000", "\u007f", "\u0085", "\u202eabc", "\u202d", "\u2066x\u2069", "\u061c"]) {
    const scene = starterScene(); scene.objects[0].customIcon = customIcon;
    assert.throws(() => validateScene(scene), /Custom icon/);
  }
  for (const imageFit of [null, {}, 3, "fill", "COVER", "url(https://example.com)"]) {
    const scene = starterScene(); scene.objects[0].imageFit = imageFit;
    assert.throws(() => validateScene(scene), /image fit/);
  }
});

test("appearance validation rejects CSS injection, coercion, nonfinite and out-of-range values", () => {
  for (const [field, values] of [
    ["background", ["red", "#fff", "#000000;background:url(x)", {}, null]],
    ["textColor", ["var(--text)", "#12345678", 123]],
    ["opacity", [29, 101, "50", null, NaN, Infinity]],
    ["fontScale", [69, 161, "100", -Infinity]],
    ["radius", [-1, 49, "10px", NaN]],
  ]) for (const value of values) {
    const scene = starterScene(); scene.objects[0][field] = value;
    assert.throws(() => validateScene(scene));
    assert.throws(() => objectAppearance({ [field]: value }));
  }
});

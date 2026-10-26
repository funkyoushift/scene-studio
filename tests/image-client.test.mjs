import test from "node:test";
import assert from "node:assert/strict";
import { IMAGE_ORIGIN, hostedImage } from "../src/image-address.mjs";
import { preflightPublish, publishImages } from "../src/images.mjs";
import { newObject, starterScene, twitchContent, validateScene } from "../src/scene.mjs";
import { channelProfile } from "../src/twitch.mjs";

const address = `${IMAGE_ORIGIN}/images/123/${"a".repeat(64)}.png`;

test("shared preflight measures final hosted-image configuration, not inline image bytes", () => {
  const scene = starterScene();
  scene.objects[0].image = `data:image/png;base64,${"AAAA".repeat(8000)}`;
  const before = JSON.stringify(scene);
  const result = preflightPublish(scene, "123");
  assert.equal(result.estimated, false);
  assert.ok(result.bytes < 5000);
  assert.equal(result.bytes, Buffer.byteLength(result.content, "utf8"));
  assert.equal(JSON.parse(result.content).objects[0].image, `${IMAGE_ORIGIN}/images/123/${"0".repeat(64)}.png`);
  assert.equal(result.scene.objects[0].image, scene.objects[0].image, "upload source must remain intact");
  assert.equal(JSON.stringify(scene), before, "preflight must not edit the draft");
  const publicEstimate = preflightPublish(scene);
  assert.equal(publicEstimate.estimated, true);
  assert.equal(publicEstimate.bytes, result.bytes + 17, "unknown channel uses the bounded 20-digit ID estimate");
});

test("shared preflight accepts exactly 5000 UTF-8 bytes and rejects overflow before uploads", async () => {
  const scene = { version: 1, name: "Boundary", objects: Array.from({ length: 4 }, (_, i) => ({ ...newObject("reveal"), id: `object-${i}`, detail: "" })) };
  scene.objects[0].image = "data:image/png;base64,AAAA";
  let remaining = 5000 - preflightPublish(scene, "123").bytes;
  for (const object of scene.objects) {
    const count = Math.min(1200, remaining);
    object.detail = "A".repeat(count); remaining -= count;
  }
  assert.equal(remaining, 0);
  assert.equal(preflightPublish(scene, "123").bytes, 5000);
  const spare = scene.objects.find(object => object.detail.length < 1200);
  spare.detail += "💚";
  assert.doesNotThrow(() => validateScene(scene), "draft format permits more than Twitch's delivery limit");
  assert.throws(() => preflightPublish(scene, "123"), /5 KB/);
  let requests = 0;
  await assert.rejects(publishImages(scene, { channelId: "123", token: "test" }, async () => { requests++; }), /5 KB/);
  assert.equal(requests, 0);
});

test("shared preflight rejects wrong-channel hosted images and incomplete links", () => {
  const scene = starterScene();
  scene.objects[0].image = address;
  assert.equal(preflightPublish(scene, "123").estimated, false);
  assert.throws(() => preflightPublish(scene, "456"), /own channel/);
  assert.equal(preflightPublish(scene).estimated, true, "public previews cannot claim ownership before identity is known");
  assert.throws(() => preflightPublish(scene, "123/other"), /identity/);
  scene.objects[0].action = "link";
  assert.throws(() => preflightPublish(scene, "123"), /full HTTPS/);
  scene.objects[0].url = 'https://www.twitch.tv/funkyoushift';
  assert.doesNotThrow(() => preflightPublish(scene, '123'));
  const textOnly = { version: 1, name: "Long guide", objects: Array.from({ length: 8 }, () => ({ ...newObject("reveal"), detail: "A".repeat(600) })) };
  assert.doesNotThrow(() => validateScene(textOnly));
  assert.throws(() => preflightPublish(textOnly), /5 KB/);
});
test("hosted images are restricted to this service, with no credentials, redirects, or tracking parameters", () => {
  assert.ok(hostedImage(address, "123"));
  for (const url of [
    address + "?tracking=1",
    address + "#x",
    address.replace(".png", ".svg"),
    address.replace("https:", "http:"),
    address.replace("/images/123/", "/images/456/"),
    address.replace(".workers.dev", ".workers.dev.attacker.example"),
  ])
    assert.equal(hostedImage(url, "123"), false);
  const scene = starterScene();
  scene.objects[0].image = address;
  assert.doesNotThrow(() => twitchContent(scene));
  scene.objects[0].image = address + "?x=1";
  assert.throws(() => validateScene(scene));
});
test("publish preflight rejects cross-channel images and oversized or incomplete scenes before uploading", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw new Error("Must not reach network");
  };
  const auth = { channelId: "123", token: "synthetic-test-token" };
  const scene = starterScene();
  scene.objects[0].image = address;
  assert.deepEqual(await publishImages(scene, auth, fetcher), scene);
  await assert.rejects(
    publishImages(scene, { ...auth, channelId: "456" }, fetcher),
    /own channel/,
  );
  scene.objects[0].image = "data:image/png;base64,AAAA";
  scene.objects[0].action = "link";
  await assert.rejects(publishImages(scene, auth, fetcher), /full HTTPS/);
  scene.objects[0].action = "reveal";
  for (const o of scene.objects) o.detail = "💚".repeat(600);
  await assert.rejects(publishImages(scene, auth, fetcher), /5 KB/);
  assert.equal(calls, 0);
});
test("creator attribution uses Twitch's extension authorization and exact channel result", async () => {
  const auth = {
    channelId: "123",
    helixToken: "test-helix-token",
    clientId: "extension-client",
  };
  const profile = await channelProfile(auth, async (url, options) => {
    assert.equal(url, "https://api.twitch.tv/helix/users?id=123");
    assert.equal(options.headers.Authorization, "Extension test-helix-token");
    return Response.json({ data: [{ id: "123", login: "example_streamer" }] });
  });
  assert.deepEqual(profile, { id: "123", login: "example_streamer" });
  await assert.rejects(
    channelProfile(auth, async () =>
      Response.json({ data: [{ id: "456", login: "someone_else" }] }),
    ),
    /confirm/,
  );
});

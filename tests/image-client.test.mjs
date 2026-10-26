import test from "node:test";
import assert from "node:assert/strict";
import { IMAGE_ORIGIN, hostedImage } from "../src/image-address.mjs";
import { publishImages } from "../src/images.mjs";
import { starterScene, twitchContent, validateScene } from "../src/scene.mjs";
import { channelProfile } from "../src/twitch.mjs";

const address = `${IMAGE_ORIGIN}/images/123/${"a".repeat(64)}.png`;
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
test("publish preflight rejects cross-channel images and oversized or unsupported scenes before uploading", async () => {
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
  await assert.rejects(publishImages(scene, auth, fetcher), /preview-only/);
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

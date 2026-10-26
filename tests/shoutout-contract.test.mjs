import test from "node:test";
import assert from "node:assert/strict";
import { normalizeShoutoutTrigger, normalizeShoutoutEffect, safeShoutoutProfile, shoutoutChannelUrl } from "../src/shoutout-contract.mjs";

const trigger = () => ({ type: "shoutout", mode: "both", users: ["Guest_1"], types: ["partner"], exclusions: ["spam_bot"] });
const profile = () => ({ id: "123", login: "guest_1", displayName: "Guest One", image: "https://static-cdn.jtvnw.net/jtv_user_pictures/guest-profile_image-300x300.png", type: "partner" });

test("shoutout trigger normalizes logins and rejects duplicates and invalid modes", () => {
  assert.deepEqual(normalizeShoutoutTrigger(trigger()), { ...trigger(), users: ["guest_1"] });
  assert.throws(() => normalizeShoutoutTrigger({ ...trigger(), users: ["Guest_1", "guest_1"] }), /repeat/);
  assert.throws(() => normalizeShoutoutTrigger({ ...trigger(), mode: "viewer" }), /mode/);
  assert.throws(() => normalizeShoutoutTrigger({ ...trigger(), types: ["moderator"] }), /types/);
  assert.throws(() => normalizeShoutoutTrigger({ ...trigger(), users: Array(51).fill("guest") }), /50/);
});

test("shoutout effect and profile admit only bounded display data", () => {
  const effect = { type: "shoutout", message: "Go say hi to {name}!", color: "#aBc123", durationSeconds: 12 };
  assert.deepEqual(normalizeShoutoutEffect(effect), effect);
  assert.throws(() => normalizeShoutoutEffect({ ...effect, durationSeconds: 31 }), /valid shoutout/);
  assert.deepEqual(safeShoutoutProfile({ ...profile(), accessToken: "private" }), profile());
  assert.equal(shoutoutChannelUrl(profile()), "https://www.twitch.tv/guest_1");
  for (const image of ["http://static-cdn.jtvnw.net/jtv_user_pictures/x.png", "https://evil.invalid/jtv_user_pictures/x.png", "https://static-cdn.jtvnw.net.evil.invalid/jtv_user_pictures/x.png", "https://static-cdn.jtvnw.net/jtv_user_pictures/x.png?redirect=1"]) {
    assert.equal(safeShoutoutProfile({ ...profile(), image }), null);
  }
  assert.equal(safeShoutoutProfile({ ...profile(), type: "unknown" }), null);
  assert.equal(safeShoutoutProfile({ ...profile(), image: "" })?.image, "");
});

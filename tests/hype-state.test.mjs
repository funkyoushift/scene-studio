import test from "node:test";
import assert from "node:assert/strict";
import { safeHypeState, HYPE_ACTIVE_MAX_MS, HYPE_END_MS } from "../src/hype-state.mjs";

const created = 1800000000000;
const event = () => ({
  type: "scene-studio-hype", eventId: "01234567-89ab-4cde-8f01-23456789abcd", channelId: "123", revision: 2,
  created, expires: created + 300000,
  effect: { type: "celebrate", message: "Thank you!", appearance: { style: "hype-train", color: "#112233", durationSeconds: 8, hypeLifecycle: true } },
  hype: { id: "train_123", phase: "active", level: 2, progress: 50, goal: 100, expiresAt: created + 300000, updatedAt: created },
});

test("safe hype state retains only public visual fields and validates both phases", () => {
  const candidate = event();
  candidate.hype.user_name = "private name";
  candidate.effect.appearance.extra = "drop";
  const clean = safeHypeState(candidate);
  assert.ok(clean);
  assert.equal(JSON.stringify(clean).includes("private name"), false);
  assert.equal(JSON.stringify(clean).includes("extra"), false);
  const ended = event(); ended.hype.phase = "ended"; ended.expires = created + HYPE_END_MS; ended.hype.expiresAt = ended.expires;
  assert.equal(safeHypeState(ended)?.hype.phase, "ended");
});

test("safe hype state rejects malformed, unbounded, and wrong-type snapshots", () => {
  for (const change of [
    value => { value.type = "scene-studio-automation"; },
    value => { value.eventId = "bad"; },
    value => { value.expires = created + HYPE_ACTIVE_MAX_MS + 1; value.hype.expiresAt = value.expires; },
    value => { value.hype.phase = "ended"; },
    value => { value.hype.level = -1; },
    value => { value.hype.progress = Infinity; },
    value => { value.effect.appearance.hypeLifecycle = false; },
    value => { value.effect.appearance.style = "confetti"; },
  ]) { const candidate = event(); change(candidate); assert.equal(safeHypeState(candidate), null); }
});

import test from "node:test";
import assert from "node:assert/strict";
import { safeLiveContext, liveText } from "../src/live-context.mjs";

test("only bounded public Twitch display fields enter live context", () => {
  assert.deepEqual(safeLiveContext({ subscriber: "  FunkCrew  ", hypeLevel: 3, token: "secret", message: "private" }), { subscriber: "FunkCrew", hypeLevel: 3 });
  for (const subscriber of ["", "a".repeat(81), "bad\nname", "bad\u202ename"]) assert.deepEqual(safeLiveContext({ subscriber }), {});
  for (const hypeLevel of [0, Infinity, "3", 1.5, 10001]) assert.deepEqual(safeLiveContext({ hypeLevel }), {});
});

test("personalization uses fixed text tokens and safe generic fallbacks", () => {
  assert.equal(liveText("Thanks, {subscriber}! Level {hypeLevel}", { subscriber: "FunkCrew", hypeLevel: 2 }), "Thanks, FunkCrew! Level 2");
  assert.equal(liveText("Thanks, {subscriber}!", undefined), "Thanks, a supporter!");
  assert.equal(liveText("{arbitrary} {subscriber}", { subscriber: "${script}" }), "{arbitrary} ${script}");
});

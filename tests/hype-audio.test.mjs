import test from "node:test";
import assert from "node:assert/strict";
import { hypeAudio } from "../src/hype-audio.mjs";
test("Hype music keeps one identity through progress and levels, stops at end", () => {
  const event = { expires: 90000, hype: { id: "train-a", phase: "active", level: 1 }, effect: { appearance: { sound: { preset: "upload", playback: "hype-loop" } } } };
  const first = hypeAudio(event);
  event.hype.level = 2; event.expires = 180000;
  assert.equal(hypeAudio(event).eventId, first.eventId);
  assert.equal(hypeAudio(event).loop, true);
  assert.equal(hypeAudio(event).expires, 180000);
  event.hype.phase = "ended";
  assert.equal(hypeAudio(event).sound, undefined);
  assert.equal(hypeAudio(event).loop, false);
  event.hype.phase = "active"; event.hype.id = "train-b";
  assert.notEqual(hypeAudio(event).eventId, first.eventId);
  assert.equal(hypeAudio(null).sound, undefined);
});

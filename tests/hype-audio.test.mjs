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

test("uploaded once/count/until-end sounds retain one train identity; built-in sounds remain per-level", () => {
  const event = { expires: 90000, hype: { id: "train-a", phase: "active", level: 1 }, effect: { appearance: { sound: { preset: "upload", playback: "loop-count", loops: 3 } } } };
  const first = hypeAudio(event);
  event.hype.level = 2; event.expires = 180000;
  const progress = hypeAudio(event);
  assert.equal(progress.eventId, first.eventId);
  assert.equal(progress.sound.playback, "loop-count");
  assert.equal(progress.loop, false, "a counted sound does not turn into an unbounded train loop");
  event.effect.appearance.sound.playback = "until-end";
  assert.equal(hypeAudio(event).eventId, first.eventId);
  assert.equal(hypeAudio(event).loop, true);
  event.hype.phase = "ended";
  assert.equal(hypeAudio(event).sound, undefined, "no new outro playback starts after the train ends");
  event.hype.phase = "active";
  event.effect.appearance.sound = { preset: "chime" };
  assert.notEqual(hypeAudio(event).eventId, first.eventId);
});

test("level sound selection handles joins, replacements, jumps and one cue per observed attained level", () => {
  const base = { preset: "upload", url: "base.mp3", volume: 70, playback: "hype-loop" };
  const replacement = { preset: "upload", url: "level-song.mp3", volume: 80, playback: "until-end", durationSeconds: 90, playSeconds: 55 };
  const event = { created: 10000, expires: 90000, hype: { id: "train-a", phase: "active", level: 1, updatedAt: 10000 }, effect: { appearance: { sound: base, hypeLevelAudio: [
    { level: 3, mode: "replace", sound: replacement },
    { level: 5, mode: "overlay", sound: { preset: "train", volume: 60 } },
  ] } } };
  const joined = { ...event, hype: { ...event.hype, level: 5 } };
  const joinAudio = hypeAudio(joined);
  assert.equal(joinAudio.sound.url, "level-song.mp3", "join-in-progress selects the highest replacement already reached");
  assert.equal(joinAudio.overlaySound, undefined, "joining never plays a missed level-up accent");
  event.hype.level = 1;
  const jumped = { ...event, created: 12000, hype: { ...event.hype, level: 5, updatedAt: 12000 } };
  const levelAudio = hypeAudio(jumped, 1);
  assert.equal(levelAudio.sound.url, "level-song.mp3");
  assert.equal(levelAudio.overlaySound.preset, "train", "a jump plays only the attained level's additional sound");
  const deadline = levelAudio.overlayExpires;
  const progress = { ...jumped, created: 20000, expires: 100000, hype: { ...jumped.hype, updatedAt: 20000 } };
  const sameLevel = hypeAudio(progress, 5, true, deadline);
  assert.equal(sameLevel.overlayEventId, levelAudio.overlayEventId);
  assert.equal(sameLevel.overlayExpires, deadline, "ordinary progress does not extend the cue or replay it");
  const ended = { ...progress, hype: { ...progress.hype, phase: "ended" } };
  assert.equal(hypeAudio(ended, 5).sound, undefined);
  assert.equal(hypeAudio(ended, 5).overlaySound, undefined);
});

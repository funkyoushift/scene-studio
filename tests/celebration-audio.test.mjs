import test from "node:test";
import assert from "node:assert/strict";
import { createCelebrationPlayer } from "../src/celebration-audio.mjs";

function mockContext(state = "suspended") {
  const made = { oscillators: [], gains: [], resumeCalls: 0, closeCalls: 0 };
  class Context {
    constructor() { this.state = state; this.currentTime = 0; this.destination = {}; made.context = this; }
    async resume() { made.resumeCalls++; this.state = "running"; }
    async close() { made.closeCalls++; this.state = "closed"; }
    createOscillator() {
      const node = { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {}, disconnect() {} };
      made.oscillators.push(node); return node;
    }
    createGain() {
      const node = { gain: { values: [], setValueAtTime(value) { this.values.push(value); }, linearRampToValueAtTime(value) { this.values.push(value); } }, connect() {}, disconnect() {} };
      made.gains.push(node); return node;
    }
  }
  return { Context, made };
}

test("does not construct or resume audio until explicit unlock", async () => {
  const { Context, made } = mockContext();
  const player = createCelebrationPlayer(Context);
  assert.equal(made.context, undefined);
  assert.equal(player.play("chime", 60), false);
  assert.equal(made.resumeCalls, 0);
  await player.unlock();
  assert.equal(made.resumeCalls, 1);
  await player.dispose();
});

test("plays only a known sequence and refuses overlap", async () => {
  const { Context, made } = mockContext("running");
  const player = createCelebrationPlayer(Context);
  await player.unlock();
  assert.equal(player.play("chime", 50), true);
  const nodeCount = made.oscillators.length;
  assert.ok(nodeCount > 0);
  assert.equal(player.play("arcade", 50), false);
  assert.equal(made.oscillators.length, nodeCount);
  assert.equal(player.play("https://example.invalid/sound.mp3", 50), false);
  player.stop();
  assert.ok(made.oscillators.every(node => node.disconnect));
  await player.dispose();
});

test("clamps output gain and volume, including out-of-range values", async () => {
  const { Context, made } = mockContext("running");
  const player = createCelebrationPlayer(Context);
  await player.unlock();
  assert.equal(player.play("bell", 1000), true);
  assert.ok(made.gains.flatMap(node => node.gain.values).every(value => value >= 0 && value <= 0.12));
  player.stop();
  assert.equal(player.play("bell", -10), false);
  assert.equal(player.play("bell", "not-a-number"), false);
  await player.dispose();
});

test("dispose stops nodes and closes the owned context", async () => {
  const { Context, made } = mockContext("running");
  const player = createCelebrationPlayer(Context);
  await player.unlock();
  assert.equal(player.play("fanfare", 70), true);
  await player.dispose();
  assert.equal(made.closeCalls, 1);
  assert.equal(player.play("fanfare", 70), false);
  await assert.rejects(player.unlock(), /stopped/);
});

test("unsupported or failed resume is reported by unlock", async () => {
  const unsupported = createCelebrationPlayer(undefined);
  await assert.rejects(unsupported.unlock(), /does not support/);
  class FailedContext { constructor() { this.state = "suspended"; } async resume() { throw new Error("blocked"); } }
  const failed = createCelebrationPlayer(FailedContext);
  await assert.rejects(failed.unlock(), /blocked/);
  await failed.dispose();
});

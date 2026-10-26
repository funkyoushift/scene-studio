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
      const node = { frequency: { values: [], setValueAtTime(value) { this.values.push(value); }, linearRampToValueAtTime(value) { this.values.push(value); } }, connect() {}, start(time) { this.startTime = time; }, stop(time) { this.stopTime = time; }, disconnect() {} };
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

test("train preset layers a swept whistle over bounded rhythmic chug for under three seconds", async () => {
  const { Context, made } = mockContext("running");
  const player = createCelebrationPlayer(Context);
  await player.unlock();
  assert.equal(player.play("train", 100), true);
  assert.equal(made.oscillators.length, 3);
  assert.deepEqual(made.oscillators.slice(0, 2).map(node => node.frequency.values[0]), [660, 880]);
  assert.ok(made.oscillators[0].frequency.values.some(value => value !== 660));
  assert.equal(made.oscillators[2].frequency.values[0], 92);
  assert.ok(made.oscillators.every(node => node.stopTime - node.startTime <= 3));
  const peakByGain = made.gains.map(node => Math.max(...node.gain.values));
  assert.ok(peakByGain.reduce((sum, peak) => sum + peak, 0) <= 0.12);
  assert.ok(made.gains[2].gain.values.filter(value => value > 0).length >= 11);
  player.stop();
  assert.ok(made.oscillators.every(node => node.disconnect));
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

test("uploaded sound only decodes after unlock and clamps playback gain and duration", async () => {
  const { Context, made } = mockContext("running");
  let decoded = 0;
  Context.prototype.decodeAudioData = async () => { decoded++; return { duration: 14 }; };
  Context.prototype.createBufferSource = () => {
    const source = { connect() {}, disconnect() {}, start(...args) { this.started = args; }, stop() {} };
    made.source = source;
    return source;
  };
  const player = createCelebrationPlayer(Context);
  const sound = { preset: "upload", url: `https://scene-studio-images.scene-studio-free-prototype.workers.dev/sounds/123/${"a".repeat(64)}.wav`, name: "sample", volume: 100 };
  assert.equal(await player.playSound(sound, 100), false);
  assert.equal(decoded, 0);
  await player.unlock();
  const fetcher = async () => ({ ok: true, headers: { get: () => "4" }, async arrayBuffer() { return new Uint8Array([1, 2, 3, 4]).buffer; } });
  // Recreate with an injected fetcher to ensure no network is touched.
  await player.dispose();
  const played = createCelebrationPlayer(Context, fetcher);
  await played.unlock();
  assert.equal(await played.playSound(sound, 200), true);
  assert.equal(decoded, 1);
  assert.deepEqual(made.source.started, [0, 0, 14]);
  assert.equal(made.gains.at(-1).gain.values[0], 0.12);
  played.stop();
  await played.dispose();
});

test("stop during pending decode prevents late uploaded playback", async () => {
  const { Context, made } = mockContext("running");
  let resolveDecode;
  Context.prototype.decodeAudioData = () => new Promise(resolve => { resolveDecode = resolve; });
  Context.prototype.createBufferSource = () => { throw Error("stale decode created a source"); };
  const player = createCelebrationPlayer(Context, async () => ({ ok: true, headers: { get: () => "4" }, async arrayBuffer() { return new Uint8Array([1, 2, 3, 4]).buffer; } }));
  await player.unlock();
  const sound = { preset: "upload", url: `https://scene-studio-images.scene-studio-free-prototype.workers.dev/sounds/123/${"a".repeat(64)}.wav`, volume: 80 };
  const pending = player.playSound(sound, 70);
  for (let i = 0; i < 10 && !resolveDecode; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof resolveDecode, "function");
  player.stop();
  resolveDecode({ duration: 2 });
  assert.equal(await pending, false);
  assert.equal(made.gains.length, 0);
  await player.dispose();
});

test("oversized hosted sound is refused before decoding", async () => {
  const { Context } = mockContext("running");
  Context.prototype.decodeAudioData = () => { throw Error("must not decode"); };
  const player = createCelebrationPlayer(Context, async () => ({ ok: true, headers: { get: () => "500001" } }));
  await player.unlock();
  assert.equal(await player.playSound({ preset: "upload", url: `https://scene-studio-images.scene-studio-free-prototype.workers.dev/sounds/123/${"a".repeat(64)}.wav`, volume: 100 }), false);
  await player.dispose();
});

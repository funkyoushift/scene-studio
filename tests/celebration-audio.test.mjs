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
  assert.ok(made.gains.slice(1).flatMap(node => node.gain.values).every(value => value >= 0 && value <= 0.12));
  assert.ok(made.gains[0].gain.values.every(value => value >= 0 && value <= 3));
  player.stop();
  assert.equal(player.play("bell", -10), false);
  assert.equal(player.play("bell", "not-a-number"), false);
  await player.dispose();
});

test("event volume changes a playing tone through its gain bus", async () => {
  const { Context, made } = mockContext("running");
  const player = createCelebrationPlayer(Context);
  await player.unlock();
  assert.equal(await player.playSound({ preset: "chime", volume: 80 }, 50), true);
  const bus = made.gains[0];
  assert.equal(bus.gain.values[0], 0.4);
  assert.equal(player.setEventVolume(0), true);
  assert.equal(bus.gain.values.at(-1), 0);
  assert.equal(player.setEventVolume(50), true);
  assert.equal(bus.gain.values.at(-1), 0.25);
  assert.equal(player.setEventVolume(300), true);
  assert.equal(bus.gain.values.at(-1), 1.5, "event boost is capped at 300 percent and retains viewer attenuation");
  assert.ok(made.oscillators.every(node => node.stopTime > node.startTime), "volume changes do not restart notes");
  player.stop();
  await player.dispose();
});

test("viewer volume changes a playing builtin tone without changing its event level", async () => {
  const { Context, made } = mockContext("running");
  const player = createCelebrationPlayer(Context);
  await player.unlock();
  assert.equal(await player.playSound({ preset: "chime", volume: 200 }, 50), true);
  const bus = made.gains[0];
  assert.equal(bus.gain.values[0], 1);
  assert.equal(player.setVolume(0), true);
  assert.equal(bus.gain.values.at(-1), 0);
  assert.equal(player.setVolume(25), true);
  assert.equal(bus.gain.values.at(-1), 0.5);
  assert.equal(player.setEventVolume(300), true);
  assert.equal(bus.gain.values.at(-1), 0.75);
  assert.equal(player.setVolume(100), true);
  assert.equal(bus.gain.values.at(-1), 3);
  player.stop();
  assert.equal(player.play("bell", 50), true);
  assert.equal(made.gains[0].gain.values[0], 1, "direct play resets the previous event boost and preserves its requested amplitude");
  player.stop();
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
  const peakByGain = made.gains.slice(1).map(node => Math.max(...node.gain.values));
  assert.ok(peakByGain.reduce((sum, peak) => sum + peak, 0) <= 0.12);
  assert.ok(made.gains.at(-1).gain.values.filter(value => value > 0).length >= 11);
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
  assert.equal(made.gains.at(-1).gain.values[0], 1, "100% uploaded sound uses the file's original level");
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

test("Hype music loops only with explicit permission and stops at lifecycle end", async () => {
  const { Context, made } = mockContext("running");
  Context.prototype.decodeAudioData = async () => ({ duration: 168 });
  const sources = [];
  Context.prototype.createBufferSource = () => {
    const source = { loop: false, connect() {}, disconnect() {}, start(...args) { this.started = args; }, stop() { this.stopped = true; } };
    sources.push(source); return source;
  };
  const file = { preset: "upload", url: `https://scene-studio-images.scene-studio-free-prototype.workers.dev/sounds/123/${"a".repeat(64)}.mp3`, name: "Full song", volume: 80, playback: "hype-loop" };
  const fetcher = async () => ({ ok: true, headers: { get: () => "4" }, async arrayBuffer() { return new Uint8Array([1, 2, 3, 4]).buffer; } });
  const player = createCelebrationPlayer(Context, fetcher);
  await player.unlock();
  assert.equal(await player.playSound(file, 100), true);
  assert.equal(sources[0].loop, false);
  assert.deepEqual(sources[0].started, [0, 0, 15]);
  player.stop();
  assert.equal(await player.playSound(file, 100, { loop: true }), true);
  assert.equal(sources[1].loop, true);
  assert.deepEqual(sources[1].started, [0]);
  assert.equal(made.gains.at(-1).gain.values[0], 0.8);
  assert.equal(player.setVolume(25), true);
  assert.equal(made.gains.at(-1).gain.values.at(-1), 0.2);
  assert.equal(sources[1].stopped, undefined, "changing viewer volume leaves the loop running");
  assert.equal(player.setVolume(1000), true);
  assert.equal(made.gains.at(-1).gain.values.at(-1), 0.8, "viewer volume cannot boost beyond the original file level");
  assert.equal(player.setVolume(0), true);
  assert.equal(made.gains.at(-1).gain.values.at(-1), 0);
  assert.equal(player.setVolume(70), true);
  assert.equal(player.setEventVolume(0), true);
  assert.equal(made.gains.at(-1).gain.values.at(-1), 0);
  assert.equal(player.setEventVolume(40), true);
  assert.equal(made.gains.at(-1).gain.values.at(-1), 0.28, "event level combines with the independently retained viewer level");
  assert.equal(player.setVolume(100), true);
  assert.equal(made.gains.at(-1).gain.values.at(-1), 0.4, "restoring viewer volume keeps event level");
  assert.equal(player.setEventVolume(300), true);
  assert.equal(made.gains.at(-1).gain.values.at(-1), 3, "event boost cannot change viewer attenuation");
  assert.equal(player.setEventVolume(1000), true);
  assert.equal(made.gains.at(-1).gain.values.at(-1), 3, "event level clamps to 300 percent");
  player.stop();
  assert.equal(sources[1].stopped, true);
  assert.equal(await player.playSound(file, 70, { loop: true }), true, "re-enabling after mute may play the same Hype sound again");
  assert.equal(sources[2].loop, true);
  await player.dispose();
});

test("event volume changes while decode is pending apply to the eventual playback", async () => {
  const { Context, made } = mockContext("running");
  let resolveDecode;
  Context.prototype.decodeAudioData = () => new Promise(resolve => { resolveDecode = resolve; });
  Context.prototype.createBufferSource = () => ({ connect() {}, disconnect() {}, start() {}, stop() {} });
  const player = createCelebrationPlayer(Context, async () => ({ ok: true, headers: { get: () => "4" }, async arrayBuffer() { return new Uint8Array([1, 2, 3, 4]).buffer; } }));
  await player.unlock();
  const sound = { preset: "upload", url: `https://scene-studio-images.scene-studio-free-prototype.workers.dev/sounds/123/${"a".repeat(64)}.wav`, volume: 80 };
  const pending = player.playSound(sound, 50);
  for (let i = 0; i < 10 && !resolveDecode; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(player.setEventVolume(25), false, "no active node exists while decode is pending");
  resolveDecode({ duration: 2 });
  assert.equal(await pending, true);
  assert.equal(made.gains.at(-1).gain.values[0], 0.125);
  player.stop();
  await player.dispose();
});

import test from "node:test";
import assert from "node:assert/strict";
import { prepareSound, publishSound, localSoundBytes } from "../src/sounds.mjs";
import { IMAGE_ORIGIN } from "../src/image-address.mjs";

function sampleFile(type = "audio/wav", content = "RIFFxxxxWAVE", name = "Sample.wav") {
  const bytes = new TextEncoder().encode(content);
  return { type, size: bytes.length, name, async arrayBuffer() { return bytes.buffer; } };
}

test("preparation decodes, downmixes and trims to a canonical 15 second WAV", async () => {
  let closed = 0, decoded = 0;
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = class {
    async decodeAudioData() { decoded++; return { sampleRate: 8000, length: 160000, numberOfChannels: 2, getChannelData(index) { return new Float32Array(160000).fill(index ? -0.5 : 0.5); } }; }
    async close() { closed++; }
  };
  try {
    const result = await prepareSound(sampleFile());
    const bytes = localSoundBytes(result.url);
    assert.equal(result.durationSeconds, 15);
    assert.equal(result.trimmed, true);
    assert.equal(bytes.length, 480044);
    assert.deepEqual([...bytes.slice(44, 48)], [0, 0, 0, 0]);
    assert.equal(decoded, 1);
    assert.equal(closed, 1);
  } finally { globalThis.AudioContext = previous; }
});

test("preparation rejects renamed non-audio before decode and closes context after decoder failure", async () => {
  const previous = globalThis.AudioContext;
  let closed = 0;
  globalThis.AudioContext = class { async decodeAudioData() { throw Error("bad"); } async close() { closed++; } };
  try {
    await assert.rejects(prepareSound(sampleFile("audio/wav", "not audio")), /not a playable/);
    await assert.rejects(prepareSound(sampleFile()), /could not be decoded/);
    assert.equal(closed, 1);
    await assert.rejects(prepareSound({ ...sampleFile(), size: 10_000_001 }), /under 10 MB/);
  } finally { globalThis.AudioContext = previous; }
});

test("publishing sends only canonical WAV to own channel and verifies content hash", async () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = class {
    async decodeAudioData() { return { sampleRate: 16000, length: 160, numberOfChannels: 1, getChannelData() { return new Float32Array(160); } }; }
    async close() {}
  };
  try {
    const prepared = await prepareSound(sampleFile());
    const bytes = localSoundBytes(prepared.url);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hash = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
    const input = { preset: "upload", url: prepared.url, name: prepared.name, volume: 70 };
    let calls = 0;
    const output = await publishSound(input, { token: "jwt", channelId: "123" }, async (url, options) => {
      calls++;
      assert.equal(url, `${IMAGE_ORIGIN}/sounds/123`);
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer jwt");
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      assert.deepEqual(options.body, bytes);
      return { ok: true, async json() { return { path: `/sounds/123/${hash}.wav` }; } };
    });
    assert.equal(calls, 1);
    assert.deepEqual(output, { ...input, url: `${IMAGE_ORIGIN}/sounds/123/${hash}.wav` });
    await assert.rejects(publishSound(input, { token: "jwt", channelId: "123" }, async () => ({ ok: true, async json() { return { path: `/sounds/456/${hash}.wav` }; } })), /invalid sound address/);
  } finally { globalThis.AudioContext = previous; }
});

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { soundRequest, validateSoundWav, MAX_SOUNDS_PER_CHANNEL, MAX_TOTAL_SOUNDS } from "../server/sound-service.mjs";
import worker from "../server/image-worker.mjs";
import { SOUND_ORIGIN, hostedSound } from "../src/sound-address.mjs";
import { validateCelebrationSound, isUploadedSound } from "../src/sound-contract.mjs";

const origin = "https://test-extension.ext-twitch.tv";
const channel = "123";
const claims = () => ({ role: "broadcaster", user_id: channel, channel_id: channel,
  exp: Math.floor(Date.now() / 1000) + 3600 });

function wav(samples = 160) {
  const data = new Uint8Array(44 + samples * 2);
  const view = new DataView(data.buffer);
  const tag = (offset, value) => value.split("").forEach((letter, i) => { data[offset + i] = letter.charCodeAt(0); });
  tag(0, "RIFF"); view.setUint32(4, data.length - 8, true); tag(8, "WAVE");
  tag(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); tag(36, "data"); view.setUint32(40, samples * 2, true);
  return data;
}
function env() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../server/sound-schema.sql", import.meta.url), "utf8"));
  return { db, EXTENSION_ORIGIN: origin, TEST_CHANNELS: channel, IMAGES: {
    prepare(sql) { return { bind(...values) {
      const bound = Object.fromEntries(values.map((value, i) => [String(i + 1),
        value instanceof ArrayBuffer ? new Uint8Array(value) : value]));
      const stmt = db.prepare(sql);
      return {
        async first() { return stmt.get(bound) ?? null; },
        async run() { return { meta: stmt.run(bound) }; },
      };
    } }; },
  } };
}
function request({ method = "POST", body = wav(), hash, from = origin, pathChannel = channel, type = "audio/wav" } = {}) {
  return new Request(`https://service.example/sounds/${pathChannel}${hash ? `/${hash}.wav` : ""}`, {
    method, headers: { origin: from, "content-type": type }, ...(method === "POST" ? { body } : {}),
  });
}
const count = e => e.db.prepare("SELECT count(*) AS n FROM sounds").get().n;

async function jwt(overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ ...claims(), ...overrides })).toString("base64url");
  const key = await crypto.subtle.importKey("raw", Buffer.from("sound-route-test-secret"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
}

test("canonical mono PCM WAV header, sample count, and duration are enforced", () => {
  assert.equal(validateSoundWav(wav(240000)).durationSeconds, 15);
  for (const [offset, size, value] of [
    [0, 8, 0], [4, 32, 0], [8, 8, 0], [12, 8, 0], [16, 32, 18],
    [20, 16, 3], [22, 16, 2], [24, 32, 44100], [28, 32, 44100],
    [32, 16, 4], [34, 16, 8], [36, 8, 0], [40, 32, 1],
  ]) {
    const bad = wav();
    const view = new DataView(bad.buffer);
    if (size === 8) bad[offset] = value;
    else if (size === 16) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
    assert.throws(() => validateSoundWav(bad), `offset ${offset}`);
  }
  assert.throws(() => validateSoundWav(wav(240001)));
  assert.throws(() => validateSoundWav(wav().slice(0, -1)));
  assert.throws(() => validateSoundWav(new Uint8Array([...wav(), 0])));
  assert.throws(() => validateSoundWav(new Uint8Array(500001)));
});

test("uploads require trusted broadcaster claims, exact origin, and channel gate", async () => {
  const e = env();
  for (const badClaims of [undefined, { ...claims(), role: "viewer" },
    { ...claims(), user_id: "456" }, { ...claims(), channel_id: "456" },
    { ...claims(), exp: 1 }, { ...claims(), nbf: Date.now() }]) {
    assert.equal((await soundRequest(request(), e, channel, { claims: badClaims })).status, 401);
  }
  assert.equal((await soundRequest(request({ from: "https://other.example" }), e, channel, { claims: claims() })).status, 403);
  e.TEST_CHANNELS = "";
  assert.equal((await soundRequest(request(), e, channel, { claims: claims() })).status, 403);
  e.PUBLIC_IMAGES = "true";
  assert.equal((await soundRequest(request(), e, channel, { claims: claims() })).status, 201);
  assert.equal(count(e), 1);
  e.db.close();
});

test("Worker sound route verifies the JWT before passing claims and serves a public asset", async () => {
  const e = env();
  e.EXTENSION_SECRET = Buffer.from("sound-route-test-secret").toString("base64");
  const send = token => new Request("https://service.example/sounds/123", {
    method: "POST", headers: { origin, authorization: `Bearer ${token}`, "content-type": "audio/wav" }, body: wav(),
  });
  assert.equal((await worker.fetch(send(await jwt({ role: "viewer" })), e)).status, 401);
  assert.equal((await worker.fetch(send(await jwt({ user_id: "456" })), e)).status, 401);
  const forged = (await jwt()).slice(0, -2) + "AA";
  assert.equal((await worker.fetch(send(forged), e)).status, 401);
  assert.equal(count(e), 0);
  const preflight = await worker.fetch(new Request("https://service.example/sounds/123", {
    method: "OPTIONS", headers: { origin, "access-control-request-method": "POST" },
  }), e);
  assert.equal(preflight.status, 204);
  const uploaded = await worker.fetch(send(await jwt()), e);
  assert.equal(uploaded.status, 201);
  const path = (await uploaded.json()).path;
  const played = await worker.fetch(new Request(`https://service.example${path}`, {
    headers: { origin: "https://viewer.example" },
  }), e);
  assert.equal(played.status, 200);
  assert.equal(played.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(new Uint8Array(await played.arrayBuffer()), wav());
  e.db.close();
});

test("strict uploads deduplicate, read publicly, and reject malformed and oversized bodies", async () => {
  const e = env();
  for (const body of [new Uint8Array([1, 2, 3]), new Uint8Array(500001),
    new Uint8Array([...wav(), 1])]) {
    const response = await soundRequest(request({ body }), e, channel, { claims: claims() });
    assert.equal(response.status, body.length > 500000 ? 413 : 415);
  }
  assert.equal((await soundRequest(request({ type: "audio/mpeg" }), e, channel, { claims: claims() })).status, 415);
  assert.equal(count(e), 0);
  const first = await soundRequest(request(), e, channel, { claims: claims() });
  assert.equal(first.status, 201);
  const uploaded = await first.json();
  assert.match(uploaded.path, /^\/sounds\/123\/[a-f0-9]{64}\.wav$/);
  assert.equal(uploaded.bytes, wav().length);
  assert.deepEqual(await (await soundRequest(request(), e, channel, { claims: claims() })).json(), uploaded);
  assert.equal(count(e), 1);
  const hash = uploaded.path.split("/").pop().slice(0, -4);
  const audio = await soundRequest(request({ method: "GET", hash, from: "https://viewer.example" }), e, channel, { hash });
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get("content-type"), "audio/wav");
  assert.equal(audio.headers.get("access-control-allow-origin"), "*");
  assert.equal(audio.headers.get("x-content-type-options"), "nosniff");
  assert.match(audio.headers.get("cache-control"), /immutable/);
  assert.deepEqual(new Uint8Array(await audio.arrayBuffer()), wav());
  assert.equal((await soundRequest(request({ method: "GET", hash: "a".repeat(64) }), e, channel, { hash: "a".repeat(64) })).status, 404);
  e.db.close();
});

test("channel and total admission are atomic while an existing sound can still retry", async () => {
  const e = env();
  const initial = await soundRequest(request(), e, channel, { claims: claims() });
  assert.equal(initial.status, 201);
  const insert = e.db.prepare("INSERT INTO sounds VALUES (?, ?, ?, ?, ?)");
  for (let i = 0; i < MAX_SOUNDS_PER_CHANNEL - 1; i++)
    insert.run(channel, String(i).padStart(64, "0"), wav(), wav().length, i);
  assert.equal((await soundRequest(request(), e, channel, { claims: claims() })).status, 201);
  const changed = wav(); changed[44] = 1;
  assert.equal((await soundRequest(request({ body: changed }), e, channel, { claims: claims() })).status, 409);
  e.db.close();
  const total = env();
  for (let i = 0; i < MAX_TOTAL_SOUNDS; i++)
    total.db.prepare("INSERT INTO sounds VALUES (?, ?, ?, ?, ?)").run(String(i + 1), String(i).padStart(64, "0"), wav(), wav().length, i);
  assert.equal((await soundRequest(request(), total, channel, { claims: claims() })).status, 409);
  total.db.close();
});

test("shared sound contract accepts own hosted or bounded inline URLs only", () => {
  const address = `${SOUND_ORIGIN}/sounds/123/${"a".repeat(64)}.wav`;
  const own = { preset: "upload", url: address, name: "My clip", volume: 80 };
  assert.equal(hostedSound(address, channel), true);
  assert.equal(hostedSound(address, "456"), false);
  assert.equal(isUploadedSound(own), true);
  assert.deepEqual(validateCelebrationSound(own, { channel }), own);
  assert.deepEqual(validateCelebrationSound({ preset: "train", volume: 0 }), { preset: "train", volume: 0 });
  const inline = { ...own, url: `data:audio/wav;base64,${Buffer.from(wav()).toString("base64")}` };
  assert.deepEqual(validateCelebrationSound(inline), inline);
  assert.throws(() => validateCelebrationSound(inline, { allowInline: false }));
  assert.throws(() => validateCelebrationSound({ ...own, url: `data:audio/wav;base64,${Buffer.from("not wav").toString("base64")}` }));
  for (const bad of [{ ...own, url: address.replace("/123/", "/456/") },
    { ...own, url: "https://other.example/sounds/123/" + "a".repeat(64) + ".wav" },
    { ...own, extra: true }, { ...own, name: " ".repeat(81) },
    { ...own, volume: 101 }, { ...own, url: "data:audio/wav;base64," + "A".repeat(666672) }])
    assert.throws(() => validateCelebrationSound(bad, { channel }));
});

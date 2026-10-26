import { MAX_SOUND_BYTES, isCanonicalSoundWav } from "../src/sound-contract.mjs";

export const MAX_SOUNDS_PER_CHANNEL = 24;
export const MAX_TOTAL_SOUNDS = 256;
const CHANNEL = /^[1-9][0-9]{0,19}$/;
const HASH = /^[a-f0-9]{64}$/;

class SoundError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new SoundError(status, message); };

// The browser produces this precise 44-byte PCM form. Reject other RIFF chunks,
// extra bytes, and encoded formats; structural checks cannot prove PCM content.
export function validateSoundWav(bytes) {
  if (!isCanonicalSoundWav(bytes))
    fail(415, "Use a mono, 16 kHz, 16-bit PCM WAV recording of at most 15 seconds.");
  return { durationSeconds: (bytes.length - 44) / 32_000, pcmBytes: bytes.length - 44 };
}

async function boundedBody(request) {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_SOUND_BYTES)
    fail(413, "Upload a WAV recording under 500 KB.");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "Choose a sound recording.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SOUND_BYTES) {
        await reader.cancel();
        fail(413, "Upload a WAV recording under 500 KB.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", ...headers,
  } });
}

/**
 * Router calls this only after parsing the exact /sounds/:channel/:hash.wav
 * route. It must pass claims returned by cryptographic JWT verification for POST.
 */
export async function soundRequest(request, env, channel, { hash, claims } = {}) {
  const origin = request.headers.get("origin");
  const allowedOrigin = Boolean(env.EXTENSION_ORIGIN && origin === env.EXTENSION_ORIGIN);
  const writeCors = allowedOrigin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {};
  try {
    if (!CHANNEL.test(channel) || (hash !== undefined && !HASH.test(hash)))
      return json({ error: "Not found." }, 404);
    if (request.method === "GET" && hash) {
      const row = await env.IMAGES.prepare("SELECT data FROM sounds WHERE channel=?1 AND hash=?2")
        .bind(channel, hash).first();
      if (!row) return json({ error: "Sound not found." }, 404, { "Access-Control-Allow-Origin": "*" });
      return new Response(new Uint8Array(row.data), { headers: {
        "Content-Type": "audio/wav", "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*",
      } });
    }
    if (request.method === "OPTIONS" && !hash) {
      if (!allowedOrigin) return json({ error: "Origin not allowed." }, 403);
      return new Response(null, { status: 204, headers: {
        ...writeCors, "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      } });
    }
    if (request.method !== "POST" || hash) return json({ error: "Method not allowed." }, 405);
    if (!allowedOrigin) return json({ error: "Open the extension to upload." }, 403);
    // claims must come from the router's verified JWT, never request JSON.
    if (!claims || claims.role !== "broadcaster" || claims.user_id !== channel ||
        claims.channel_id !== channel || !Number.isFinite(claims.exp) ||
        claims.exp <= Math.floor(Date.now() / 1000) ||
        (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > Math.floor(Date.now() / 1000))))
      return json({ error: "The broadcaster’s linked extension sign-in is required." }, 401, writeCors);
    if (env.PUBLIC_IMAGES !== "true" && !(env.TEST_CHANNELS || "").split(",").map(s => s.trim()).includes(channel))
      return json({ error: "Sound uploads are not enabled for this channel." }, 403, writeCors);
    if (request.headers.get("content-type") !== "audio/wav")
      return json({ error: "Upload a WAV recording." }, 415, writeCors);
    const bytes = await boundedBody(request);
    validateSoundWav(bytes);
    const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const digest = Array.from(hashBytes, byte => byte.toString(16).padStart(2, "0")).join("");
    // One SQLite statement keeps both limits atomic with concurrent uploads.
    const result = await env.IMAGES.prepare(
      `INSERT OR IGNORE INTO sounds (channel, hash, data, bytes, created)
       SELECT ?1, ?2, ?3, ?4, ?5
       WHERE (SELECT count(*) FROM sounds WHERE channel=?1) < ?6
         AND (SELECT count(*) FROM sounds) < ?7`,
    ).bind(channel, digest, bytes.buffer, bytes.length, Date.now(), MAX_SOUNDS_PER_CHANNEL, MAX_TOTAL_SOUNDS).run();
    if (!result.meta.changes) {
      const existing = await env.IMAGES.prepare("SELECT hash FROM sounds WHERE channel=?1 AND hash=?2")
        .bind(channel, digest).first();
      if (!existing) return json({ error: "Sound storage is full for this channel or service." }, 409, writeCors);
    }
    return json({ path: `/sounds/${channel}/${digest}.wav`, bytes: bytes.length }, 201, writeCors);
  } catch (error) {
    return json({ error: error instanceof SoundError ? error.message : "Sound service unavailable. Try again later." },
      error instanceof SoundError ? error.status : 503, writeCors);
  }
}

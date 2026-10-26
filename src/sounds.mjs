import { IMAGE_ORIGIN } from "./image-address.mjs";
import { hostedSound } from "./sound-address.mjs";

const MAX_INPUT = 10_000_000;
const MAX_OUTPUT = 500_000;
const RATE = 16_000;
const SECONDS = 15;
const ERROR = "Choose a playable MP3 or WAV under 10 MB.";

export function localSoundBytes(url) {
  if (typeof url !== "string" || !url.startsWith("data:audio/wav;base64,")) throw Error("Choose a prepared WAV sound.");
  const encoded = url.slice("data:audio/wav;base64,".length);
  if (!encoded || encoded.length > Math.ceil(MAX_OUTPUT / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw Error("This sound is too large or invalid.");
  let bytes;
  try { bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); } catch { throw Error("This sound could not be read."); }
  if (bytes.length > MAX_OUTPUT || bytes.length < 46) throw Error("This sound is too large or invalid.");
  const view = new DataView(bytes.buffer);
  const tag = (at, value) => value.split("").every((c, i) => bytes[at + i] === c.charCodeAt(0));
  if (!tag(0, "RIFF") || !tag(8, "WAVE") || !tag(12, "fmt ") || !tag(36, "data") || view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== RATE || view.getUint32(28, true) !== RATE * 2 || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 || view.getUint32(40, true) !== bytes.length - 44 || (bytes.length - 44) % 2 || bytes.length - 44 > RATE * SECONDS * 2) throw Error("This sound is not a prepared WAV.");
  return bytes;
}

function wav(samples) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset, tag) => { for (let i = 0; i < tag.length; i++) bytes[offset + i] = tag.charCodeAt(i); };
  write(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(value < 0 ? value * 32768 : value * 32767), true);
  }
  return bytes;
}

/** Decode locally, downmix and convert the first fifteen seconds to canonical mono PCM. */
export async function prepareSound(file) {
  if (!file || typeof file.arrayBuffer !== "function" || !Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_INPUT || !["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav"].includes(file.type)) throw Error(ERROR);
  const input = new Uint8Array(await file.arrayBuffer());
  const isWave = input.length >= 12 && String.fromCharCode(...input.slice(0, 4)) === "RIFF" && String.fromCharCode(...input.slice(8, 12)) === "WAVE";
  const isMp3 = input.length >= 4 && (String.fromCharCode(...input.slice(0, 3)) === "ID3" || (input[0] === 0xff && (input[1] & 0xe0) === 0xe0));
  if (!(isWave || isMp3)) throw Error("This file is not a playable MP3 or WAV.");
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) throw Error("This browser cannot prepare sound uploads.");
  const context = new Ctor();
  let decoded;
  try {
    decoded = await context.decodeAudioData(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
  } catch { throw Error("This sound could not be decoded. Try another MP3 or WAV."); }
  finally { try { await context.close(); } catch { /* Release best effort. */ } }
  if (!decoded || !Number.isFinite(decoded.sampleRate) || decoded.sampleRate <= 0 || !Number.isInteger(decoded.numberOfChannels) || decoded.numberOfChannels < 1 || decoded.numberOfChannels > 32 || !Number.isInteger(decoded.length) || decoded.length < 1) throw Error("This sound has no playable audio.");
  const sampleCount = Math.min(RATE * SECONDS, Math.ceil(decoded.length * RATE / decoded.sampleRate));
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const position = Math.min(decoded.length - 1, i * decoded.sampleRate / RATE);
    const a = Math.floor(position), b = Math.min(decoded.length - 1, a + 1), mix = position - a;
    let sum = 0;
    for (const channel of channels) sum += channel[a] * (1 - mix) + channel[b] * mix;
    samples[i] = sum / channels.length;
  }
  const output = wav(samples);
  if (output.length > MAX_OUTPUT) throw Error("This sound could not be prepared within the upload limit.");
  let binary = "";
  for (let i = 0; i < output.length; i += 8192) binary += String.fromCharCode(...output.subarray(i, i + 8192));
  const name = (typeof file.name === "string" ? file.name : "Sound").replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 80) || "Sound";
  return { url: `data:audio/wav;base64,${btoa(binary)}`, name, durationSeconds: sampleCount / RATE, trimmed: decoded.length / decoded.sampleRate > SECONDS };
}

export async function publishSound(sound, auth, fetcher = fetch) {
  if (!sound || sound.preset !== "upload") throw Error("Choose an uploaded sound.");
  const channel = auth?.channelId;
  if (!auth?.token || typeof channel !== "string" || !/^[1-9][0-9]{0,19}$/.test(channel)) throw Error("Connect your Twitch identity to upload sounds.");
  const clean = url => ({ preset: "upload", url, name: sound.name, volume: sound.volume });
  if (hostedSound(sound.url, channel)) return clean(sound.url);
  const bytes = localSoundBytes(sound.url);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  let response;
  try {
    response = await fetcher(`${IMAGE_ORIGIN}/sounds/${channel}`, { method: "POST", headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "audio/wav" }, body: bytes, signal: AbortSignal.timeout(20000), credentials: "omit", redirect: "error" });
  } catch { throw Error("Sound hosting could not be reached. Your draft is safe; try again."); }
  let result;
  try { result = await response.json(); } catch { throw Error("Sound hosting returned an invalid response."); }
  if (!response.ok) throw Error(typeof result?.error === "string" ? result.error.slice(0, 200) : "Sound hosting is unavailable.");
  const url = `${IMAGE_ORIGIN}${result?.path || ""}`;
  if (!hostedSound(url, channel) || url !== `${IMAGE_ORIGIN}/sounds/${channel}/${hash}.wav`) throw Error("Sound hosting returned an invalid sound address.");
  return clean(url);
}

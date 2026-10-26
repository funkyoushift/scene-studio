import { IMAGE_ORIGIN } from "./image-address.mjs";
import { hostedSound } from "./sound-address.mjs";
import { isCanonicalSoundWav, inspectSoundMp3, MAX_MP3_BYTES, validateCelebrationSound } from "./sound-contract.mjs";

const MAX_INPUT = 10_000_000;
const MAX_OUTPUT = 500_000;
const RATE = 16_000;
const SECONDS = 15;
const ERROR = "Choose a playable MP3 or WAV under 10 MB.";

export function localSoundBytes(url) {
  const mp3 = typeof url === "string" && url.startsWith("data:audio/mpeg;base64,");
  const prefix = mp3 ? "data:audio/mpeg;base64," : "data:audio/wav;base64,";
  if (typeof url !== "string" || !url.startsWith(prefix)) throw Error("Choose a prepared WAV or MP3 sound.");
  const encoded = url.slice(prefix.length), max = mp3 ? MAX_MP3_BYTES : MAX_OUTPUT;
  if (!encoded || encoded.length > Math.ceil(max / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw Error("This sound is too large or invalid.");
  let bytes;
  try { bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); } catch { throw Error("This sound could not be read."); }
  if (bytes.length > max || !(mp3 ? inspectSoundMp3(bytes) : isCanonicalSoundWav(bytes))) throw Error("This sound is not a prepared WAV or MP3.");
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
export async function prepareSound(file, { fullTrack = false } = {}) {
  if (!file || typeof file.arrayBuffer !== "function" || !Number.isFinite(file.size) || file.size <= 0 || file.size > (fullTrack ? MAX_MP3_BYTES : MAX_INPUT)) throw Error(fullTrack ? "Choose an MP3 under 1.5 MB for the full Hype Train track." : ERROR);
  // File.type is advisory and may be empty or OS-specific. Validate bytes and decode instead.
  const input = new Uint8Array(await file.arrayBuffer());
  if (input.length > (fullTrack ? MAX_MP3_BYTES : MAX_INPUT)) throw Error(fullTrack ? "Choose an MP3 under 1.5 MB for the full Hype Train track." : ERROR);
  const isWave = input.length >= 12 && String.fromCharCode(...input.slice(0, 4)) === "RIFF" && String.fromCharCode(...input.slice(8, 12)) === "WAVE";
  const isMp3 = input.length >= 4 && (String.fromCharCode(...input.slice(0, 3)) === "ID3" || (input[0] === 0xff && (input[1] & 0xe0) === 0xe0));
  if (fullTrack && !isMp3) throw Error("Choose an MP3 for the full Hype Train track. Convert a WAV to MP3 first.");
  if (!(isWave || isMp3)) throw Error("This file is not a playable MP3 or WAV.");
  const mp3Details = fullTrack ? inspectSoundMp3(input) : null;
  if (fullTrack && !mp3Details) throw Error("This MP3 has invalid or incomplete audio frames.");
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) throw Error("This browser cannot prepare sound uploads.");
  const context = new Ctor();
  let decoded;
  try {
    decoded = await context.decodeAudioData(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
  } catch { throw Error("This sound could not be decoded. Try another MP3 or WAV."); }
  finally { try { await context.close(); } catch { /* Release best effort. */ } }
  if (!decoded || !Number.isFinite(decoded.sampleRate) || decoded.sampleRate <= 0 || !Number.isInteger(decoded.numberOfChannels) || decoded.numberOfChannels < 1 || decoded.numberOfChannels > 32 || !Number.isInteger(decoded.length) || decoded.length < 1) throw Error("This sound has no playable audio.");
  const name = (typeof file.name === "string" ? file.name : "Sound").replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 80) || "Sound";
  if (fullTrack) {
    const durationSeconds = decoded.length / decoded.sampleRate;
    if (durationSeconds > 300 || mp3Details.durationSeconds > 300) throw Error("Choose an MP3 no longer than 5 minutes.");
    let binary = "";
    for (let i = 0; i < input.length; i += 8192) binary += String.fromCharCode(...input.subarray(i, i + 8192));
    return { url: `data:audio/mpeg;base64,${btoa(binary)}`, name, durationSeconds, trimmed: false };
  }
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
  return { url: `data:audio/wav;base64,${btoa(binary)}`, name, durationSeconds: sampleCount / RATE, trimmed: decoded.length / decoded.sampleRate > SECONDS };
}

export async function publishSound(sound, auth, fetcher = fetch) {
  if (!sound || sound.preset !== "upload") throw Error("Choose an uploaded sound.");
  const channel = auth?.channelId;
  if (!auth?.token || typeof channel !== "string" || !/^[1-9][0-9]{0,19}$/.test(channel)) throw Error("Connect your Twitch identity to upload sounds.");
  const clean = url => validateCelebrationSound({ preset: "upload", url, name: sound.name, volume: sound.volume, ...(sound.playback === "hype-loop" ? { playback: "hype-loop" } : {}) }, { channel });
  if (hostedSound(sound.url, channel)) return clean(sound.url);
  if (sound.playback !== undefined && sound.playback !== "hype-loop") throw Error("Choose a valid Hype Train playback mode.");
  const bytes = localSoundBytes(sound.url);
  const mp3 = sound.url.startsWith("data:audio/mpeg;base64,");
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  let response;
  try {
    response = await fetcher(`${IMAGE_ORIGIN}/sounds/${channel}`, { method: "POST", headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": mp3 ? "audio/mpeg" : "audio/wav" }, body: bytes, signal: AbortSignal.timeout(20000), credentials: "omit", redirect: "error" });
  } catch { throw Error("Sound hosting could not be reached. Your draft is safe; try again."); }
  let result;
  try { result = await response.json(); } catch { throw Error("Sound hosting returned an invalid response."); }
  if (!response.ok) throw Error(typeof result?.error === "string" ? result.error.slice(0, 200) : "Sound hosting is unavailable.");
  const url = `${IMAGE_ORIGIN}${result?.path || ""}`;
  if (!hostedSound(url, channel) || url !== `${IMAGE_ORIGIN}/sounds/${channel}/${hash}.${mp3 ? "mp3" : "wav"}`) throw Error("Sound hosting returned an invalid sound address.");
  return clean(url);
}

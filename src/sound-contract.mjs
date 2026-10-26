import { hostedSound } from "./sound-address.mjs";

const PRESETS = Object.freeze(["chime", "arcade", "fanfare", "bell", "space", "train"]);
export const MAX_SOUND_BYTES = 500_000;
export const MAX_MP3_BYTES = 1_500_000;
const MAX_PCM_BYTES = 15 * 16_000 * 2;
const MAX_MP3_SECONDS = 300;
const MAX_ID3V2_BYTES = 128 * 1024;
const MPEG1_BITRATE = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_BITRATE = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

// Parse every MPEG Layer III frame. This is structural validation, not audio decoding.
// A bounded leading ID3v2 tag and a trailing ID3v1 tag are the only non-frame bytes.
export function inspectSoundMp3(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes.length > MAX_MP3_BYTES) return null;
  let offset = 0, end = bytes.length;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    if (end < 10 || ![2, 3, 4].includes(bytes[3]) ||
        bytes[6] > 127 || bytes[7] > 127 || bytes[8] > 127 || bytes[9] > 127) return null;
    const tagBytes = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
    if (tagBytes > MAX_ID3V2_BYTES) return null;
    offset = 10 + tagBytes;
    if (bytes[3] === 4 && (bytes[5] & 0x10)) {
      if (offset + 10 > end || bytes[offset] !== 0x33 || bytes[offset + 1] !== 0x44 || bytes[offset + 2] !== 0x49)
        return null;
      offset += 10;
    }
    if (offset >= end) return null;
  }
  if (end - offset >= 128 && bytes[end - 128] === 0x54 && bytes[end - 127] === 0x41 && bytes[end - 126] === 0x47)
    end -= 128;
  let frameCount = 0, durationSamples = 0, sampleRate = 0, version = -1;
  while (offset < end) {
    if (end - offset < 4 || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return null;
    const frameVersion = (bytes[offset + 1] >> 3) & 3;
    const layer = (bytes[offset + 1] >> 1) & 3;
    const bitrateIndex = bytes[offset + 2] >> 4;
    const rateIndex = (bytes[offset + 2] >> 2) & 3;
    if (!SAMPLE_RATES[frameVersion] || layer !== 1 || bitrateIndex < 1 || bitrateIndex > 14 || rateIndex > 2)
      return null;
    const frameRate = SAMPLE_RATES[frameVersion][rateIndex];
    if (frameCount && (frameVersion !== version || frameRate !== sampleRate)) return null;
    const bitrate = (frameVersion === 3 ? MPEG1_BITRATE : MPEG2_BITRATE)[bitrateIndex];
    const padding = (bytes[offset + 2] >> 1) & 1;
    const frameBytes = Math.floor((frameVersion === 3 ? 144000 : 72000) * bitrate / frameRate) + padding;
    if (frameBytes < 6 || offset + frameBytes > end) return null;
    frameCount++;
    durationSamples += frameVersion === 3 ? 1152 : 576;
    if (durationSamples > MAX_MP3_SECONDS * frameRate) return null;
    version = frameVersion; sampleRate = frameRate;
    offset += frameBytes;
  }
  return frameCount && offset === end ? { durationSeconds: durationSamples / sampleRate, frameCount, sampleRate } : null;
}

export function isCanonicalSoundWav(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 46 || bytes.length > MAX_SOUND_BYTES) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const four = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const dataLength = view.getUint32(40, true);
  return four(0) === "RIFF" && view.getUint32(4, true) === bytes.length - 8 &&
    four(8) === "WAVE" && four(12) === "fmt " && view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 && view.getUint16(22, true) === 1 &&
    view.getUint32(24, true) === 16_000 && view.getUint32(28, true) === 32_000 &&
    view.getUint16(32, true) === 2 && view.getUint16(34, true) === 16 &&
    four(36) === "data" && dataLength === bytes.length - 44 &&
    dataLength >= 2 && dataLength <= MAX_PCM_BYTES && dataLength % 2 === 0;
}

export function isUploadedSound(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && value.preset === "upload");
}

function inlineSound(value) {
  if (typeof value !== "string") return false;
  const wav = value.startsWith("data:audio/wav;base64,");
  const mp3 = value.startsWith("data:audio/mpeg;base64,");
  if (!wav && !mp3) return false;
  const encoded = value.slice(wav ? "data:audio/wav;base64,".length : "data:audio/mpeg;base64,".length);
  const limit = wav ? MAX_SOUND_BYTES : MAX_MP3_BYTES;
  if (!encoded || encoded.length > Math.ceil(limit / 3) * 4 ||
      encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return false;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if (encoded.length / 4 * 3 - padding > limit) return false;
  try {
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    return wav ? isCanonicalSoundWav(bytes) : Boolean(inspectSoundMp3(bytes));
  } catch { return false; }
}

export function validateCelebrationSound(value, { allowInline = true, channel } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Celebration sound must be an object.");
  if (!Number.isInteger(value.volume) || value.volume < 0 || value.volume > 300)
    throw new Error("Celebration sound volume must be a whole number from 0 to 300.");
  if (isUploadedSound(value)) {
    const hasPlayback = Object.hasOwn(value, "playback");
    if (Object.keys(value).length !== (hasPlayback ? 5 : 4) ||
        !["preset", "url", "name", "volume"].every(key => Object.hasOwn(value, key)) ||
        (hasPlayback && value.playback !== "hype-loop") ||
        typeof value.name !== "string" || !value.name.trim() || value.name.length > 80 ||
        !(hostedSound(value.url, channel) || (allowInline && inlineSound(value.url))))
      throw new Error("Choose a valid uploaded celebration sound for this channel.");
    return { preset: "upload", url: value.url, name: value.name, volume: value.volume,
      ...(hasPlayback ? { playback: "hype-loop" } : {}) };
  }
  if (Object.keys(value).length !== 2 || !Object.hasOwn(value, "preset") || !Object.hasOwn(value, "volume") ||
      !PRESETS.includes(value.preset))
    throw new Error("Celebration sound must use a supported preset.");
  return { preset: value.preset, volume: value.volume };
}

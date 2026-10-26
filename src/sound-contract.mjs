import { hostedSound } from "./sound-address.mjs";

const PRESETS = Object.freeze(["chime", "arcade", "fanfare", "bell", "space", "train"]);
const INLINE_PREFIX = "data:audio/wav;base64,";
export const MAX_SOUND_BYTES = 500_000;
const MAX_PCM_BYTES = 15 * 16_000 * 2;

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
  if (typeof value !== "string" || !value.startsWith(INLINE_PREFIX)) return false;
  const encoded = value.slice(INLINE_PREFIX.length);
  if (!encoded || encoded.length > Math.ceil(MAX_SOUND_BYTES / 3) * 4 ||
      encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return false;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if (encoded.length / 4 * 3 - padding > MAX_SOUND_BYTES) return false;
  try {
    return isCanonicalSoundWav(Uint8Array.from(atob(encoded), char => char.charCodeAt(0)));
  } catch { return false; }
}

export function validateCelebrationSound(value, { allowInline = true, channel } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Celebration sound must be an object.");
  if (!Number.isInteger(value.volume) || value.volume < 0 || value.volume > 100)
    throw new Error("Celebration sound volume must be a whole number from 0 to 100.");
  if (isUploadedSound(value)) {
    if (Object.keys(value).length !== 4 ||
        !["preset", "url", "name", "volume"].every(key => Object.hasOwn(value, key)) ||
        typeof value.name !== "string" || !value.name.trim() || value.name.length > 80 ||
        !(hostedSound(value.url, channel) || (allowInline && inlineSound(value.url))))
      throw new Error("Choose a valid uploaded celebration sound for this channel.");
    return { preset: "upload", url: value.url, name: value.name, volume: value.volume };
  }
  if (Object.keys(value).length !== 2 || !Object.hasOwn(value, "preset") || !Object.hasOwn(value, "volume") ||
      !PRESETS.includes(value.preset))
    throw new Error("Celebration sound must use a supported preset.");
  return { preset: value.preset, volume: value.volume };
}

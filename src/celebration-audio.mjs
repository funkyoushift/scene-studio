const TONES = Object.freeze({
  chime: Object.freeze({ wave: "sine", notes: [[659.25, 0.18], [783.99, 0.2], [987.77, 0.34]] }),
  arcade: Object.freeze({ wave: "square", notes: [[523.25, 0.12], [783.99, 0.12], [1046.5, 0.16], [1567.98, 0.28]] }),
  fanfare: Object.freeze({ wave: "triangle", notes: [[392, 0.2], [523.25, 0.2], [659.25, 0.2], [783.99, 0.42]] }),
  bell: Object.freeze({ wave: "sine", notes: [[880, 0.42], [1174.66, 0.5]] }),
  space: Object.freeze({ wave: "triangle", notes: [[293.66, 0.24], [440, 0.28], [587.33, 0.3], [880, 0.32]] }),
  train: Object.freeze({ train: true }),
});
const MAX_GAIN = 0.12;
const MAX_UPLOAD_GAIN = 1;
const MAX_PLAY_MS = 3000;
import { hostedSound } from "./sound-address.mjs";
import { localSoundBytes } from "./sounds.mjs";
import { MAX_MP3_BYTES } from "./sound-contract.mjs";

function clampVolume(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(100, Math.max(0, numeric)) : 0;
}

function clampEventVolume(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(300, Math.max(0, numeric)) : 0;
}

/** A short local oscillator player. AudioContext construction and resume occur only in unlock(). */
export function createCelebrationPlayer(AudioContextCtor, fetcher = globalThis.fetch) {
  let context = null;
  let activeNodes = [];
  let cleanupTimer = null;
  let disposed = false;
  let generation = 0;
  let pending = false;
  let fetchController = null;
  let activeUploadGain = null;
  let activeToneEventGain = null;
  let activeToneViewerDynamic = false;
  let eventVolumeNow = 100;
  let viewerVolumeNow = 100;

  async function unlock() {
    if (disposed) throw new Error("Celebration audio has been stopped.");
    if (!context) {
      const Ctor = AudioContextCtor || globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctor) throw new Error("This browser does not support celebration sound.");
      context = new Ctor();
    }
    if (context.state !== "running" && typeof context.resume === "function") await context.resume();
    if (context.state && context.state !== "running") throw new Error("The browser could not enable celebration sound.");
    return true;
  }

  function releaseNodes() {
    if (cleanupTimer !== null) clearTimeout(cleanupTimer);
    cleanupTimer = null;
    const nodes = activeNodes;
    activeNodes = [];
    activeUploadGain = null;
    activeToneEventGain = null;
    activeToneViewerDynamic = false;
    for (const node of nodes) {
      try { node.stop?.(); } catch { /* It may already have ended. */ }
      try { node.disconnect?.(); } catch { /* Release best-effort. */ }
    }
  }

  function toneEventGain(start, viewerDynamic = false) {
    if (!activeToneEventGain) {
      activeToneEventGain = context.createGain();
      activeToneViewerDynamic = viewerDynamic;
      activeToneEventGain.gain.setValueAtTime((eventVolumeNow / 100) * (viewerDynamic ? viewerVolumeNow / 100 : 1), start);
      activeToneEventGain.connect(context.destination);
      activeNodes.push(activeToneEventGain);
    }
    return activeToneEventGain;
  }

  function playTone(preset, volume = 100, viewerDynamic = false) {
    if (disposed || !context || context.state !== "running" || pending) return false;
    const tone = TONES[preset];
    const level = clampVolume(volume);
    if (!tone || level <= 0 || activeNodes.length) return false;
    const gainScale = MAX_GAIN * (viewerDynamic ? 1 : level / 100);
    if (tone.train) return playTrain(gainScale, viewerDynamic);
    let start = context.currentTime || 0;
    let totalSeconds = 0;
    try {
      const eventGain = toneEventGain(start, viewerDynamic);
      for (const [frequency, noteSeconds] of tone.notes) {
        const duration = Math.min(noteSeconds, 0.48);
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = tone.wave;
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(gainScale, start + 0.018);
        gain.gain.setValueAtTime(gainScale, start + Math.max(0.025, duration - 0.04));
        gain.gain.linearRampToValueAtTime(0, start + duration);
        oscillator.connect(gain);
        gain.connect(eventGain);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.01);
        activeNodes.push(oscillator, gain);
        start += duration + 0.035;
        totalSeconds += duration + 0.035;
      }
      cleanupTimer = setTimeout(releaseNodes, Math.min(MAX_PLAY_MS, Math.ceil(totalSeconds * 1000) + 80));
      return true;
    } catch {
      releaseNodes();
      return false;
    }
  }

  function play(preset, volume = 100) {
    eventVolumeNow = 100;
    return playTone(preset, volume, false);
  }

  function playTrain(gainScale, viewerDynamic = false) {
    const start = context.currentTime || 0;
    const duration = 2.75;
    try {
      const eventGain = toneEventGain(start, viewerDynamic);
      // Two lightly detuned whistle tones share 0.07 of the 0.12 total budget;
      // the rhythmic low chug uses at most 0.045, leaving headroom throughout.
      for (const [frequency, gainAmount] of [[660, 0.035], [880, 0.035]]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        oscillator.frequency.linearRampToValueAtTime(frequency * 0.91, start + 0.82);
        oscillator.frequency.setValueAtTime(frequency * 1.02, start + 1.02);
        oscillator.frequency.linearRampToValueAtTime(frequency * 0.84, start + 1.86);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(gainScale * gainAmount / MAX_GAIN, start + 0.04);
        gain.gain.setValueAtTime(gainScale * gainAmount / MAX_GAIN, start + 2.58);
        gain.gain.linearRampToValueAtTime(0, start + duration);
        oscillator.connect(gain);
        gain.connect(eventGain);
        oscillator.start(start); oscillator.stop(start + duration + 0.01);
        activeNodes.push(oscillator, gain);
      }

      const chug = context.createOscillator();
      const chugGain = context.createGain();
      chug.type = "triangle";
      chug.frequency.setValueAtTime(92, start);
      chugGain.gain.setValueAtTime(0, start);
      // Repeated soft pulses make a rolling chug under the whistle.
      for (let pulse = 0; pulse < 11; pulse++) {
        const pulseStart = start + 0.12 + pulse * 0.23;
        const peak = gainScale * 0.045 / MAX_GAIN;
        chugGain.gain.setValueAtTime(0, pulseStart);
        chugGain.gain.linearRampToValueAtTime(peak, pulseStart + 0.045);
        chugGain.gain.linearRampToValueAtTime(0, pulseStart + 0.15);
      }
      chug.connect(chugGain); chugGain.connect(eventGain);
      chug.start(start); chug.stop(start + duration + 0.01);
      activeNodes.push(chug, chugGain);
      cleanupTimer = setTimeout(releaseNodes, Math.min(MAX_PLAY_MS, Math.ceil(duration * 1000) + 80));
      return true;
    } catch {
      releaseNodes();
      return false;
    }
  }

  function stop() {
    generation++;
    pending = false;
    fetchController?.abort();
    fetchController = null;
    releaseNodes();
  }

  function setVolume(value) {
    viewerVolumeNow = clampVolume(value);
    if (disposed || !context || context.state !== "running") return false;
    const now = context.currentTime || 0;
    if (activeUploadGain) {
      activeUploadGain.gain.setValueAtTime(MAX_UPLOAD_GAIN * viewerVolumeNow * eventVolumeNow / 10_000, now);
      return true;
    }
    if (activeToneEventGain && activeToneViewerDynamic) {
      activeToneEventGain.gain.setValueAtTime(viewerVolumeNow * eventVolumeNow / 10_000, now);
      return true;
    }
    return false;
  }

  function setEventVolume(value) {
    eventVolumeNow = clampEventVolume(value);
    if (disposed || !context || context.state !== "running") return false;
    const now = context.currentTime || 0;
    if (activeUploadGain) {
      activeUploadGain.gain.setValueAtTime(MAX_UPLOAD_GAIN * viewerVolumeNow * eventVolumeNow / 10_000, now);
      return true;
    }
    if (activeToneEventGain) {
      activeToneEventGain.gain.setValueAtTime((eventVolumeNow / 100) * (activeToneViewerDynamic ? viewerVolumeNow / 100 : 1), now);
      return true;
    }
    return false;
  }

  async function playSound(sound, viewerVolume = 100, { loop = false } = {}) {
    if (disposed || !context || context.state !== "running" || pending || activeNodes.length || !sound || typeof sound !== "object") return false;
    viewerVolumeNow = clampVolume(viewerVolume);
    eventVolumeNow = clampEventVolume(sound.volume ?? 100);
    const volume = viewerVolumeNow;
    if (sound.preset !== "upload") return playTone(sound.preset, volume, true);
    const fullTrack = sound.playback === "hype-loop";
    const shouldLoop = fullTrack && loop === true;
    if (volume <= 0 && !shouldLoop) return false;
    const mp3 = typeof sound.url === "string" && (sound.url.endsWith(".mp3") || sound.url.startsWith("data:audio/mpeg;base64,"));
    const byteLimit = mp3 ? MAX_MP3_BYTES : 500_000;
    let bytes;
    const hosted = hostedSound(sound.url);
    if (!hosted) {
      try { bytes = localSoundBytes(sound.url); } catch { return false; }
    }
    const mine = ++generation;
    pending = true;
    try {
      if (hosted) {
        const controller = new AbortController();
        fetchController = controller;
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
          const response = await fetcher(sound.url, { credentials: "omit", redirect: "error", signal: controller.signal });
          if (!response.ok || mine !== generation || disposed) return false;
          const size = Number(response.headers?.get?.("content-length"));
          if (Number.isFinite(size) && size > byteLimit) return false;
          if (response.body?.getReader) {
            const reader = response.body.getReader();
            const chunks = [];
            let total = 0;
            try {
              while (true) {
                const next = await reader.read();
                if (next.done) break;
                if (mine !== generation || disposed) return false;
                total += next.value.byteLength;
                if (total > byteLimit) return false;
                chunks.push(next.value);
              }
            } finally { try { await reader.cancel(); } catch { /* Already closed. */ } }
            bytes = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          } else {
            bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.length > byteLimit) return false;
          }
        } finally { clearTimeout(timeout); if (fetchController === controller) fetchController = null; }
      }
      if (mine !== generation || disposed || !bytes?.length || bytes.length > byteLimit) return false;
      const buffer = await context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      if (mine !== generation || disposed || context.state !== "running" || !Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > (mp3 ? 300.05 : 15.05)) return false;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = shouldLoop;
      gain.gain.setValueAtTime(MAX_UPLOAD_GAIN * viewerVolumeNow * eventVolumeNow / 10_000, context.currentTime || 0);
      source.connect(gain); gain.connect(context.destination);
      activeNodes.push(source, gain);
      activeUploadGain = gain;
      const playSeconds = Math.min(15, buffer.duration);
      if (shouldLoop) source.start(0);
      else source.start(0, 0, playSeconds);
      if (!shouldLoop) cleanupTimer = setTimeout(releaseNodes, Math.ceil(playSeconds * 1000) + 80);
      return true;
    } catch { if (mine === generation) releaseNodes(); return false; }
    finally { if (mine === generation) pending = false; }
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    const ownedContext = context;
    context = null;
    if (ownedContext && ownedContext.state !== "closed" && typeof ownedContext.close === "function") {
      try { await ownedContext.close(); } catch { /* Context release is best-effort. */ }
    }
  }

  return Object.freeze({ unlock, play, playSound, setVolume, setEventVolume, stop, dispose });
}

export const CELEBRATION_SOUND_PRESETS = Object.freeze(Object.keys(TONES));

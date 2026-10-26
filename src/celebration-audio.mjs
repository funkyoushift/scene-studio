const TONES = Object.freeze({
  chime: Object.freeze({ wave: "sine", notes: [[659.25, 0.18], [783.99, 0.2], [987.77, 0.34]] }),
  arcade: Object.freeze({ wave: "square", notes: [[523.25, 0.12], [783.99, 0.12], [1046.5, 0.16], [1567.98, 0.28]] }),
  fanfare: Object.freeze({ wave: "triangle", notes: [[392, 0.2], [523.25, 0.2], [659.25, 0.2], [783.99, 0.42]] }),
  bell: Object.freeze({ wave: "sine", notes: [[880, 0.42], [1174.66, 0.5]] }),
  space: Object.freeze({ wave: "triangle", notes: [[293.66, 0.24], [440, 0.28], [587.33, 0.3], [880, 0.32]] }),
});
const MAX_GAIN = 0.12;
const MAX_PLAY_MS = 1800;

function clampVolume(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(100, Math.max(0, numeric)) : 0;
}

/** A short local oscillator player. AudioContext construction and resume occur only in unlock(). */
export function createCelebrationPlayer(AudioContextCtor) {
  let context = null;
  let activeNodes = [];
  let cleanupTimer = null;
  let disposed = false;

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
    for (const node of nodes) {
      try { node.stop?.(); } catch { /* It may already have ended. */ }
      try { node.disconnect?.(); } catch { /* Release best-effort. */ }
    }
  }

  function play(preset, volume = 100) {
    if (disposed || !context || context.state !== "running") return false;
    const tone = TONES[preset];
    const level = clampVolume(volume);
    if (!tone || level <= 0 || activeNodes.length) return false;
    const gainScale = MAX_GAIN * level / 100;
    let start = context.currentTime || 0;
    let totalSeconds = 0;
    try {
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
        gain.connect(context.destination);
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

  function stop() {
    releaseNodes();
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    releaseNodes();
    const ownedContext = context;
    context = null;
    if (ownedContext && ownedContext.state !== "closed" && typeof ownedContext.close === "function") {
      try { await ownedContext.close(); } catch { /* Context release is best-effort. */ }
    }
  }

  return Object.freeze({ unlock, play, stop, dispose });
}

export const CELEBRATION_SOUND_PRESETS = Object.freeze(Object.keys(TONES));

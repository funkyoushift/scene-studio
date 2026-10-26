// Public, nonpersonal Hype Train visual snapshot. Used at both the server
// boundary and the client boundary; it grants no authentication authority.
export const HYPE_ACTIVE_MAX_MS = 20 * 60 * 1000;
export const HYPE_END_MS = 12 * 1000;

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const id = /^[A-Za-z0-9_-]{1,128}$/;
const channel = /^[1-9][0-9]{0,19}$/;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

export function safeHypeState(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.type !== "scene-studio-hype" ||
      !uuid.test(input.eventId ?? "") || !channel.test(input.channelId ?? "") ||
      !integer(input.revision, 1, Number.MAX_SAFE_INTEGER) ||
      !integer(input.created, 0, Number.MAX_SAFE_INTEGER) ||
      !integer(input.expires, input.created + 1, input.created + HYPE_ACTIVE_MAX_MS)) return null;
  const hype = input.hype, effect = input.effect, appearance = effect?.appearance;
  if (!hype || typeof hype !== "object" || Array.isArray(hype) || !id.test(hype.id ?? "") ||
      !["active", "ended"].includes(hype.phase) || !integer(hype.level, 1, 10000) ||
      !integer(hype.progress, 0, 1_000_000_000_000) || !integer(hype.goal, 1, 1_000_000_000_000) ||
      !integer(hype.updatedAt, 0, input.created) || !integer(hype.expiresAt, input.created + 1, input.expires) ||
      hype.expiresAt !== input.expires || (hype.phase === "ended" && input.expires - input.created > HYPE_END_MS)) return null;
  if (effect?.type !== "celebrate" || typeof effect.message !== "string" || !effect.message.trim() || effect.message.length > 160 ||
      !appearance || typeof appearance !== "object" || Array.isArray(appearance) || appearance.style !== "hype-train" ||
      !/^#[0-9A-Fa-f]{6}$/.test(appearance.color ?? "") || !integer(appearance.durationSeconds, 4, 20) ||
      appearance.hypeLifecycle !== true) return null;
  const cleanAppearance = { style: "hype-train", color: appearance.color, durationSeconds: appearance.durationSeconds, hypeLifecycle: true };
  if (appearance.sound !== undefined) {
    const sound = appearance.sound;
    if (!sound || typeof sound !== "object" || Array.isArray(sound) ||
        !["chime", "arcade", "fanfare", "bell", "space", "train"].includes(sound.preset) || !integer(sound.volume, 0, 100)) return null;
    cleanAppearance.sound = { preset: sound.preset, volume: sound.volume };
  }
  return {
    type: "scene-studio-hype", eventId: input.eventId, channelId: input.channelId,
    revision: input.revision, created: input.created, expires: input.expires,
    effect: { type: "celebrate", message: effect.message, appearance: cleanAppearance },
    hype: { id: hype.id, phase: hype.phase, level: hype.level, progress: hype.progress,
      goal: hype.goal, expiresAt: hype.expiresAt, updatedAt: hype.updatedAt },
  };
}

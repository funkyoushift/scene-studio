// A music session follows the train identity, not its changing level.
export function hypeAudio(event, previousLevel, keepCurrentOverlay = false, keepOverlayExpires = 0) {
  const appearance = event?.effect?.appearance;
  const baseSound = appearance?.sound;
  const train = event?.hype;
  if (!train) return { eventId: null, sound: undefined, overlaySound: undefined, overlayEventId: null, loop: false, expires: 0 };
  const entries = Array.isArray(appearance?.hypeLevelAudio) ? appearance.hypeLevelAudio : [];
  const replacement = entries.filter(entry => entry.mode === "replace" && entry.level <= train.level).sort((a, b) => b.level - a.level)[0];
  const sound = replacement?.sound || baseSound;
  const uploadedSessionSound = sound?.preset === "upload";
  const sessionLoop = uploadedSessionSound && ["hype-loop", "until-end"].includes(sound.playback);
  const loop = sessionLoop && train.phase === "active";
  const stableBackground = uploadedSessionSound || Boolean(replacement);
  const overlay = train.phase === "active" && ((Number.isInteger(previousLevel) && train.level > previousLevel) || keepCurrentOverlay)
    ? entries.find(entry => entry.level === train.level && entry.mode === "overlay") : null;
  let overlaySound = overlay?.sound;
  if (overlaySound) { overlaySound = { ...overlaySound }; delete overlaySound.playback; delete overlaySound.loops; }
  const cueStartedAt = train.updatedAt ?? event.created ?? Date.now();
  const cueSeconds = overlaySound?.preset === "upload" ? (overlaySound.playSeconds ?? overlaySound.durationSeconds ?? 15) : 3;
  const overlayExpires = overlaySound ? keepCurrentOverlay && Number.isFinite(keepOverlayExpires) && keepOverlayExpires > 0
    ? keepOverlayExpires : Math.min(event.expires ?? cueStartedAt + cueSeconds * 1000, cueStartedAt + Math.max(0.1, cueSeconds) * 1000 + 250) : 0;
  return {
    eventId: stableBackground ? `${train.id}:background:${replacement?.level ?? "base"}` : `${train.id}:${train.level}:${train.phase}`,
    sound: train.phase !== "active" ? undefined : sound,
    overlaySound,
    overlayEventId: overlaySound ? `${train.id}:level:${train.level}` : null,
    overlayExpires,
    loop,
    expires: event.expires,
  };
}

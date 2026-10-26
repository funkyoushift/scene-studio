// A music session follows the train identity, not its changing level.
export function hypeAudio(event) {
  const sound = event?.effect?.appearance?.sound;
  const train = event?.hype;
  if (!train) return { eventId: null, sound: undefined, loop: false, expires: 0 };
  const music = sound?.preset === "upload" && sound.playback === "hype-loop";
  const loop = music && train.phase === "active";
  return {
    eventId: music ? `${train.id}:music` : `${train.id}:${train.level}:${train.phase}`,
    sound: music && !loop ? undefined : sound,
    loop,
    expires: event.expires,
  };
}

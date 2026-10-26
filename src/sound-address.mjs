// Sound assets are served only from Scene Studio's existing media Worker.
export const SOUND_ORIGIN =
  "https://scene-studio-images.scene-studio-free-prototype.workers.dev";

export function hostedSound(value, channel) {
  if (typeof value !== "string" || !value.startsWith(`${SOUND_ORIGIN}/sounds/`))
    return false;
  const match = value.slice(SOUND_ORIGIN.length)
    .match(/^\/sounds\/([1-9][0-9]{0,19})\/[a-f0-9]{64}\.(?:wav|mp3)$/);
  return Boolean(match && (channel === undefined || match[1] === channel));
}

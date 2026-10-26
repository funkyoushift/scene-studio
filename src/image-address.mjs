// Only this project's host may supply viewer images. No arbitrary URLs.
export const IMAGE_ORIGIN =
  "https://scene-studio-images.scene-studio-free-prototype.workers.dev";
export function hostedImage(value, channel) {
  if (typeof value !== "string" || !value.startsWith(`${IMAGE_ORIGIN}/images/`))
    return false;
  const match = value
    .slice(IMAGE_ORIGIN.length)
    .match(/^\/images\/([1-9][0-9]{0,19})\/[a-f0-9]{64}\.png$/);
  return Boolean(match && (!channel || match[1] === channel));
}

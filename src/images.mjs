import { IMAGE_ORIGIN, hostedImage } from "./image-address.mjs";
import { twitchContent, validateScene } from "./scene.mjs";

export async function prepareImage(file) {
  if (
    !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
      file.type,
    ) ||
    file.size > 10_000_000
  )
    throw new Error(
      "Choose a PNG, JPEG, WebP, or GIF under 10 MB. Animated images become still images.",
    );
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This image could not be opened. Try another PNG or JPEG.");
  }
  try {
    const canvas = document.createElement("canvas");
    for (let edge = 1024; edge >= 128; edge = Math.floor(edge * 0.75)) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas
        .getContext("2d")
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (blob && blob.size <= 200_000)
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () =>
            reject(new Error("Image could not be prepared."));
          reader.readAsDataURL(blob);
        });
    }
    throw new Error(
      "This image is too detailed. Try a smaller or simpler image.",
    );
  } finally {
    bitmap.close();
  }
}
function identity(auth) {
  if (!auth?.token || !/^[1-9][0-9]{0,19}$/.test(auth.channelId))
    throw new Error("Connect your Twitch identity to enable image uploads.");
  return auth.channelId;
}
async function service(path, auth, options = {}, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`${IMAGE_ORIGIN}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${auth.token}`, ...options.headers },
      signal: AbortSignal.timeout(20000),
      credentials: "omit",
      redirect: "error",
    });
  } catch {
    throw new Error(
      "Image hosting could not be reached. Your draft is safe; try again shortly.",
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Image hosting is not ready. Your draft is safe.");
  }
  if (!response.ok)
    throw new Error(
      typeof result.error === "string"
        ? result.error.slice(0, 200)
        : "Image hosting is temporarily unavailable.",
    );
  return result;
}
export async function publishImages(scene, auth, fetcher = fetch) {
  const clean = validateScene(scene);
  if (!clean.objects.some((o) => o.image)) {
    twitchContent(clean);
    return clean;
  }
  const channel = identity(auth);
  if (
    clean.objects.some(
      (o) =>
        o.image &&
        !o.image.startsWith("data:") &&
        !hostedImage(o.image, channel),
    )
  )
    throw new Error(
      "Use images uploaded to your own channel. Replace images copied from another channel.",
    );
  // Validate final configuration size/actions before any public uploads.
  twitchContent({
    ...clean,
    objects: clean.objects.map((o) => ({
      ...o,
      image: o.image
        ? `${IMAGE_ORIGIN}/images/${channel}/${"0".repeat(64)}.png`
        : "",
    })),
  });
  const uploaded = new Map(),
    objects = [];
  for (const object of clean.objects) {
    let image = object.image;
    if (image.startsWith("data:")) {
      if (!uploaded.has(image)) {
        const raw = Uint8Array.from(atob(image.split(",")[1]), (c) =>
          c.charCodeAt(0),
        );
        const type = image.slice(5, image.indexOf(";"));
        const prepared = await prepareImage(new Blob([raw], { type }));
        const body = Uint8Array.from(atob(prepared.split(",")[1]), (c) =>
          c.charCodeAt(0),
        );
        const result = await service(
          `/images/${channel}`,
          auth,
          { method: "POST", headers: { "Content-Type": "image/png" }, body },
          fetcher,
        );
        const address = `${IMAGE_ORIGIN}${result.path}`;
        if (!hostedImage(address, channel))
          throw new Error("Image hosting returned an invalid image address.");
        uploaded.set(image, address);
      }
      image = uploaded.get(image);
    }
    objects.push({ ...object, image });
  }
  const next = { ...clean, objects };
  twitchContent(next);
  return next;
}
export async function imageLibrary(auth) {
  const channel = identity(auth),
    result = await service(`/images/${channel}`, auth);
  if (!Array.isArray(result.images) || result.images.length > 48)
    throw new Error("Could not load your image library.");
  return result.images.map((row) => {
    const url = `${IMAGE_ORIGIN}/images/${channel}/${row.hash}.png`;
    if (!hostedImage(url, channel))
      throw new Error("Could not load your image library.");
    return { url };
  });
}
export async function deleteImage(url, auth) {
  const channel = identity(auth);
  if (!hostedImage(url, channel))
    throw new Error("Choose an image from your channel.");
  await service(url.slice(IMAGE_ORIGIN.length), auth, { method: "DELETE" });
}

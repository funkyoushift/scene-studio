import { IMAGE_ORIGIN } from "./image-address.mjs";
import { prepareImage } from "./images.mjs";
import {
  EXPERIENCE_LIMITS,
  hostedExperience,
  hostedExperienceMedia,
  validateExperience,
} from "./experience.mjs";

function database() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("scene-studio-experience-media", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(new Error("Media storage is unavailable in this browser."));
  });
}
async function storage(mode, operation) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("files", mode),
        req = operation(tx.objectStore("files"));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () =>
        reject(
          new Error(
            "Media could not be saved. Check available device storage.",
          ),
        );
    });
  } finally {
    db.close();
  }
}
export const readLocalMedia = (source) =>
  storage("readonly", (store) => store.get(source));
export async function storeMedia(blob) {
  const source = `local-media:${crypto.randomUUID()}`;
  await storage("readwrite", (store) => store.put(blob, source));
  return source;
}
function playableVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file),
      video = document.createElement("video");
    const finish = (error) => {
      clearTimeout(timeout);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      error ? reject(new Error(error)) : resolve();
    };
    const timeout = setTimeout(
      () =>
        finish("This video could not be opened. Try MP4 with H.264 or WebM."),
      15000,
    );
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () =>
      finish(
        !Number.isFinite(video.duration) ||
          video.duration <= 0 ||
          !video.videoWidth
          ? "Use a video with a finite duration and a video track."
          : null,
      );
    video.onerror = () =>
      finish(
        "This browser cannot play that video. Try MP4 with H.264 or WebM.",
      );
    video.src = url;
  });
}
export async function importMedia(file) {
  if (["video/mp4", "video/webm"].includes(file.type)) {
    if (file.size > EXPERIENCE_LIMITS.videoBytes || !file.size)
      throw new Error("Choose an MP4 or WebM video up to 25 MB.");
    await playableVideo(file);
    return {
      id: `media-${crypto.randomUUID()}`,
      name: file.name.slice(0, 100),
      kind: "video",
      source: await storeMedia(file),
    };
  }
  const prepared = await prepareImage(file);
  const blob = decodeBackupMedia(prepared);
  return {
    id: `media-${crypto.randomUUID()}`,
    name: file.name.slice(0, 100),
    kind: "image",
    source: await storeMedia(blob),
  };
}
export async function resolveMedia(source) {
  if (!source?.startsWith("local-media:"))
    return { url: source || "", release() {} };
  const blob = await readLocalMedia(source);
  if (!blob)
    throw new Error(
      "This media file is missing on this device. Upload it again or import an experience backup.",
    );
  const url = URL.createObjectURL(blob);
  return { url, release: () => URL.revokeObjectURL(url) };
}
async function boundedResponse(response, limit) {
  const reader = response.body.getReader();
  let total = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new Error("The downloaded file exceeds its size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks);
}
export async function loadExperience(slot, { signal, fetcher = fetch } = {}) {
  if (slot.kind !== "experience-ref") return validateExperience(slot);
  if (!hostedExperience(slot.url))
    throw new Error("Invalid experience address.");
  const response = await fetcher(slot.url, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
    credentials: "omit",
    redirect: "error",
  });
  if (!response.ok)
    throw new Error("This experience could not be loaded. Try again.");
  const content = await boundedResponse(response, EXPERIENCE_LIMITS.bytes);
  const channel = new URL(slot.url).pathname.split("/")[2];
  const design = validateExperience(JSON.parse(await content.text()), {
    published: true,
    channel,
  });
  return { ...design, enabled: slot.enabled !== false };
}
async function upload(path, body, type, auth, fetcher) {
  const response = await fetcher(`${IMAGE_ORIGIN}${path}`, {
    method: "POST",
    body,
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": type },
    signal: AbortSignal.timeout(120000),
    credentials: "omit",
    redirect: "error",
  });
  const result = JSON.parse(
    await (await boundedResponse(response, 4000)).text(),
  );
  if (!response.ok)
    throw new Error(
      result.error || "Experience upload failed. Your draft is safe.",
    );
  return `${IMAGE_ORIGIN}${result.path}`;
}
export async function publishExperience(slot, auth, fetcher = fetch) {
  if (!auth?.token || !/^[1-9][0-9]{0,19}$/.test(auth.channelId))
    throw new Error(
      "Connect your Twitch identity before uploading an experience.",
    );
  const channel = auth.channelId;
  if (slot.kind === "experience-ref") {
    if (!hostedExperience(slot.url, channel))
      throw new Error("Use an experience saved to your own channel.");
    return slot;
  }
  const design = validateExperience(slot),
    assets = [],
    uploaded = new Map();
  for (const asset of design.assets) {
    if (hostedExperienceMedia(asset.source, channel)) {
      assets.push(asset);
      continue;
    }
    if (!asset.source.startsWith("local-media:"))
      throw new Error(
        "Re-upload media from another channel before publishing.",
      );
    if (!uploaded.has(asset.source)) {
      const blob = await readLocalMedia(asset.source);
      if (!blob)
        throw new Error(
          `Upload “${asset.name}” again; its file is missing on this device.`,
        );
      const url = await upload(
        `/media/${channel}`,
        blob,
        blob.type,
        auth,
        fetcher,
      );
      if (!hostedExperienceMedia(url, channel))
        throw new Error("The service returned an invalid media address.");
      uploaded.set(asset.source, url);
    }
    assets.push({ ...asset, source: uploaded.get(asset.source) });
  }
  const clean = validateExperience(
    { ...design, assets },
    { published: true, channel },
  );
  const url = await upload(
    `/experiences/${channel}`,
    JSON.stringify(clean),
    "application/json",
    auth,
    fetcher,
  );
  if (!hostedExperience(url, channel))
    throw new Error("The service returned an invalid experience address.");
  return {
    kind: "experience-ref",
    name: clean.name,
    url,
    enabled: clean.enabled,
  };
}
const dataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
export async function exportExperience(design) {
  const clean = validateExperience(design),
    files = {};
  let total = 0;
  for (const a of clean.assets) {
    if (files[a.source]) continue;
    const blob = a.source.startsWith("local-media:")
      ? await readLocalMedia(a.source)
      : await (async () => {
          const response = await fetch(a.source, {
            credentials: "omit",
            redirect: "error",
            signal: AbortSignal.timeout(30000),
          });
          if (!response.ok) throw new Error(`Could not download ${a.name}.`);
          const body = await boundedResponse(
            response,
            EXPERIENCE_LIMITS.videoBytes,
          );
          return new Blob([body], {
            type:
              a.kind === "image"
                ? "image/png"
                : a.source.endsWith(".mp4")
                  ? "video/mp4"
                  : "video/webm",
          });
        })();
    if (!blob) throw new Error(`Missing file: ${a.name}.`);
    total += blob.size;
    if (total > 100_000_000)
      throw new Error(
        "Keep portable backups under 100 MB of media; split larger experiences into chapters.",
      );
    files[a.source] = await dataUrl(blob);
  }
  return JSON.stringify({
    format: "scene-studio-experience-backup",
    design: clean,
    files,
  });
}
export function decodeBackupMedia(data) {
  const match = typeof data === "string" && /^data:(image\/png|video\/mp4|video\/webm);base64,([A-Za-z0-9+/]+=*)$/.exec(data);
  if (!match || match[2].length > Math.ceil(EXPERIENCE_LIMITS.videoBytes / 3) * 4)
    throw new Error("Invalid media type or backup size.");
  let decoded;
  try { decoded = atob(match[2]); }
  catch { throw new Error("Invalid backup media encoding."); }
  if (!decoded.length || decoded.length > EXPERIENCE_LIMITS.videoBytes)
    throw new Error("Invalid media type or backup size.");
  return new Blob([Uint8Array.from(decoded, character => character.charCodeAt(0))], { type: match[1] });
}
export async function importExperience(text) {
  if (text.length > 140_000_000) throw new Error("This backup is too large.");
  const input = JSON.parse(text);
  if (input.format !== "scene-studio-experience-backup")
    return validateExperience(input);
  const design = validateExperience(input.design),
    assets = [],
    imported = new Map();
  let total = 0;
  for (const a of design.assets) {
    if (!imported.has(a.source)) {
      const data = input.files?.[a.source];
      if (
        typeof data !== "string" ||
        !/^data:(image\/png|video\/mp4|video\/webm);base64,[A-Za-z0-9+/]+=*$/.test(
          data,
        )
      )
        throw new Error(`Missing or invalid file: ${a.name}.`);
      // Twitch permits blob media but not data: network requests. Backup bytes
      // are already present, so decode them without a network request.
      const blob = decodeBackupMedia(data);
      total += blob.size;
      if (
        blob.size > EXPERIENCE_LIMITS.videoBytes ||
        total > 100_000_000 ||
        (a.kind === "image") !== (blob.type === "image/png")
      )
        throw new Error("Invalid media type or backup size.");
      const file = new File([blob], a.name, { type: blob.type });
      imported.set(a.source, (await importMedia(file)).source);
    }
    assets.push({ ...a, source: imported.get(a.source) });
  }
  return validateExperience({ ...design, assets });
}

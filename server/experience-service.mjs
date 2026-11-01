import { EXPERIENCE_LIMITS, validateExperience } from "../src/experience.mjs";
import { IMAGE_ORIGIN } from "../src/image-address.mjs";

class ExperienceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new ExperienceError(status, message);
};
export async function readExperienceBody(request, limit) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
    fail(413, "This file exceeds its upload limit.");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "Choose a file to upload.");
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        fail(413, "This file exceeds its upload limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
// Container checks reject mislabeled HTML/scripts and truncated MP4 boxes. Browser
// playback remains the codec check; this service does not transcode video.
export function validateVideoBytes(bytes, type) {
  if (!bytes.length || bytes.length > EXPERIENCE_LIMITS.videoBytes)
    fail(413, "Videos must be between 1 byte and 25 MB.");
  if (type === "video/mp4") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    const boxes = new Set();
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) fail(415, "This MP4 is truncated.");
      let size = view.getUint32(offset),
        header = 8;
      const name = String.fromCharCode(
        ...bytes.subarray(offset + 4, offset + 8),
      );
      if (size === 1) {
        if (offset + 16 > bytes.length) fail(415, "This MP4 is truncated.");
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      }
      if (size === 0) size = bytes.length - offset;
      if (
        !Number.isSafeInteger(size) ||
        size < header ||
        offset + size > bytes.length
      )
        fail(415, "This MP4 has an invalid box size.");
      boxes.add(name);
      offset += size;
    }
    if (!boxes.has("ftyp") || !boxes.has("moov") || !boxes.has("mdat"))
      fail(415, "Use a complete MP4 file with video data and metadata.");
  } else if (type === "video/webm") {
    if (
      bytes.length < 32 ||
      bytes[0] !== 0x1a ||
      bytes[1] !== 0x45 ||
      bytes[2] !== 0xdf ||
      bytes[3] !== 0xa3 ||
      !new TextDecoder("latin1").decode(bytes.subarray(0, 128)).includes("webm")
    )
      fail(415, "Use a WebM video file.");
  } else fail(415, "Upload MP4 or WebM video.");
}
export function mediaRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) fail(416, "Unsupported byte range.");
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end = match[1]
    ? match[2]
      ? Math.min(size - 1, Number(match[2]))
      : size - 1
    : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    fail(416, "Byte range is outside this file.");
  return { offset: start, length: end - start + 1 };
}
export async function experienceRequest(
  request,
  env,
  { channel, collection, hash, extension, claims, validatePng },
) {
  const origin = request.headers.get("origin"),
    allowed = !!env.EXTENSION_ORIGIN && origin === env.EXTENSION_ORIGIN;
  const publicRead = ["GET", "HEAD"].includes(request.method) && !!hash;
  const cors = publicRead
    ? {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers":
          "Content-Range, Accept-Ranges, Content-Length, ETag",
      }
    : allowed
      ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
      : {};
  const json = (data, status = 200, more = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        ...cors,
        ...more,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  try {
    if (
      !/^[1-9][0-9]{0,19}$/.test(channel) ||
      !["media", "experiences"].includes(collection) ||
      (hash && !/^[a-f0-9]{64}$/.test(hash))
    )
      return json({ error: "Not found." }, 404);
    if (request.method === "OPTIONS") {
      if (!allowed && !hash) return json({ error: "Origin not allowed." }, 403);
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          ...(hash ? { "Access-Control-Allow-Origin": "*" } : {}),
          "Access-Control-Allow-Methods": hash
            ? "GET, HEAD, OPTIONS"
            : "POST, OPTIONS",
          "Access-Control-Allow-Headers": hash
            ? "Range"
            : "Authorization, Content-Type",
        },
      });
    }
    if (!env.EXPERIENCE_MEDIA || env.EXPERIENCES_ENABLED !== "true")
      return json(
        {
          error:
            "Experience hosting is not enabled yet. Your local draft and preview are still available.",
        },
        503,
      );
    if (publicRead) {
      const key = `${collection}/${channel}/${hash}.${extension}`;
      const head = await env.EXPERIENCE_MEDIA.head(key);
      if (!head) return json({ error: "File not found." }, 404);
      let range;
      try {
        range = mediaRange(request.headers.get("range"), head.size);
      } catch (e) {
        if (e.status === 416)
          return json({ error: e.message }, 416, {
            "Content-Range": `bytes */${head.size}`,
          });
        throw e;
      }
      const headers = {
        ...cors,
        "Content-Type":
          extension === "json"
            ? "application/json"
            : extension === "png"
              ? "image/png"
              : `video/${extension}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Accept-Ranges": "bytes",
        "Content-Length": String(range?.length ?? head.size),
        ETag: head.httpEtag,
        ...(range
          ? {
              "Content-Range": `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`,
            }
          : {}),
      };
      if (request.method === "HEAD")
        return new Response(null, { status: range ? 206 : 200, headers });
      const object = await env.EXPERIENCE_MEDIA.get(
        key,
        range ? { range } : undefined,
      );
      if (!object) return json({ error: "File not found." }, 404);
      return new Response(object.body, { status: range ? 206 : 200, headers });
    }
    if (request.method !== "POST" || hash)
      return json({ error: "Method not allowed." }, 405);
    if (!allowed)
      return json(
        { error: "Open your Twitch extension configuration to upload." },
        403,
      );
    if (
      !claims ||
      claims.role !== "broadcaster" ||
      claims.user_id !== channel ||
      claims.channel_id !== channel ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= Date.now() / 1000 ||
      (claims.nbf != null &&
        (!Number.isFinite(claims.nbf) || claims.nbf > Date.now() / 1000))
    )
      return json(
        { error: "The broadcaster’s linked sign-in is required." },
        401,
      );
    if (
      env.PUBLIC_EXPERIENCES !== "true" &&
      !(env.TEST_CHANNELS || "")
        .split(",")
        .map((s) => s.trim())
        .includes(channel)
    )
      return json({ error: "Uploads are not enabled for this channel." }, 403);
    const type = request.headers.get("content-type");
    let data, suffix;
    if (collection === "experiences") {
      if (type !== "application/json")
        fail(415, "Upload an experience JSON file.");
      data = await readExperienceBody(request, EXPERIENCE_LIMITS.bytes);
      let design;
      try {
        design = validateExperience(
          JSON.parse(new TextDecoder().decode(data)),
          { published: true, channel },
        );
      } catch (e) {
        fail(400, e.message.slice(0, 200));
      }
      const mediaKeys = [
        ...new Set(
          design.assets.map((asset) =>
            asset.source.slice(IMAGE_ORIGIN.length + 1),
          ),
        ),
      ];
      for (let offset = 0; offset < mediaKeys.length; offset += 40) {
        const group = mediaKeys.slice(offset, offset + 40);
        const existing = await env.IMAGES.prepare(
          `SELECT COUNT(*) AS count FROM experience_files WHERE channel=?1 AND ready=1 AND key IN (${group.map((_, i) => `?${i + 2}`).join(",")})`,
        )
          .bind(channel, ...group)
          .first();
        if (existing?.count !== group.length)
          fail(
            400,
            "Upload all experience media before saving the experience.",
          );
      }
      data = new TextEncoder().encode(JSON.stringify(design));
      suffix = "json";
    } else {
      if (!["image/png", "video/mp4", "video/webm"].includes(type))
        fail(415, "Upload a prepared PNG, MP4 or WebM.");
      data = await readExperienceBody(
        request,
        type === "image/png" ? 200_000 : EXPERIENCE_LIMITS.videoBytes,
      );
      if (type === "image/png") {
        if (!validatePng) fail(503, "Image validation is unavailable.");
        try {
          validatePng(data);
        } catch {
          fail(415, "Upload a valid prepared PNG image.");
        }
        suffix = "png";
      } else {
        validateVideoBytes(data, type);
        suffix = type.split("/")[1];
      }
    }
    const digest = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
    ]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    const key = `${collection}/${channel}/${digest}.${suffix}`;
    // Reserve bytes atomically before writing R2. Failed reservations stay charged
    // and are retryable at the same hash, avoiding quota races and orphan growth.
    await env.IMAGES.prepare(
      `INSERT OR IGNORE INTO experience_files (key, channel, bytes, ready, created)
      SELECT ?1, ?2, ?3, 0, ?4 WHERE
      (SELECT COALESCE(SUM(bytes),0) FROM experience_files WHERE channel=?2)+?3 <= 500000000 AND
      (SELECT COALESCE(SUM(bytes),0) FROM experience_files)+?3 <= 2000000000 AND
      (SELECT COUNT(*) FROM experience_files WHERE channel=?2) < 2000`,
    )
      .bind(key, channel, data.length, Date.now())
      .run();
    const reserved = await env.IMAGES.prepare(
      "SELECT ready FROM experience_files WHERE key=?1 AND channel=?2",
    )
      .bind(key, channel)
      .first();
    if (!reserved)
      fail(
        409,
        "Experience storage is full. Contact Scene Studio support to arrange more capacity.",
      );
    if (!reserved.ready) {
      await env.EXPERIENCE_MEDIA.put(key, data, {
        httpMetadata: { contentType: type },
        customMetadata: { channel },
      });
      await env.IMAGES.prepare(
        "UPDATE experience_files SET ready=1 WHERE key=?1 AND channel=?2",
      )
        .bind(key, channel)
        .run();
    }
    return json({ path: `/${key}`, bytes: data.length }, 201);
  } catch (e) {
    return json(
      {
        error:
          e instanceof ExperienceError
            ? e.message
            : "Experience storage is unavailable. Your draft is safe; try again later.",
      },
      e instanceof ExperienceError ? e.status : 503,
    );
  }
}

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  experienceRequest,
  mediaRange,
  readExperienceBody,
  validateVideoBytes,
} from "../server/experience-service.mjs";
import worker from "../server/image-worker.mjs";
import { experienceExample } from "../src/experience-examples.mjs";
import { IMAGE_ORIGIN } from "../src/image-address.mjs";
const origin = "https://test.ext-twitch.tv",
  channel = "123";
const claims = {
  role: "broadcaster",
  user_id: channel,
  channel_id: channel,
  exp: Math.floor(Date.now() / 1000) + 3600,
};
function mp4() {
  return new Uint8Array(
    Buffer.concat(
      ["ftyp", "moov", "mdat"].map((name) => {
        const box = Buffer.alloc(16);
        box.writeUInt32BE(16);
        box.write(name, 4);
        return box;
      }),
    ),
  );
}
function environment() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../server/experience-schema.sql", import.meta.url),
      "utf8",
    ),
  );
  const files = new Map();
  return {
    db,
    files,
    EXTENSION_ORIGIN: origin,
    TEST_CHANNELS: channel,
    EXPERIENCES_ENABLED: "true",
    IMAGES: {
      prepare(sql) {
        return {
          bind(...values) {
            const stmt = db.prepare(sql),
              bound = Object.fromEntries(
                values.map((v, i) => [String(i + 1), v]),
              );
            return {
              async first() {
                return stmt.get(bound);
              },
              async run() {
                return { meta: stmt.run(bound) };
              },
            };
          },
        };
      },
    },
    EXPERIENCE_MEDIA: {
      async head(key) {
        const data = files.get(key);
        return data ? { size: data.length, httpEtag: '"test"' } : null;
      },
      async put(key, data) {
        files.set(key, data);
      },
      async get(key, options) {
        const data = files.get(key);
        return data
          ? {
              body: options?.range
                ? data.slice(
                    options.range.offset,
                    options.range.offset + options.range.length,
                  )
                : data,
            }
          : null;
      },
    },
  };
}
const request = (
  method = "POST",
  body = mp4(),
  type = "video/mp4",
  from = origin,
  extra = {},
) =>
  new Request(`${IMAGE_ORIGIN}/media/${channel}`, {
    method,
    headers: { origin: from, "content-type": type, ...extra },
    ...(["GET", "HEAD", "OPTIONS"].includes(method) ? {} : { body }),
  });
const args = { channel, collection: "media", claims };
test("uploads require exact origin, same-channel broadcaster proof, enabled hosting, and valid media before writing", async () => {
  const env = environment();
  for (const [req, options, status] of [
    [request("POST", mp4(), "video/mp4", "https://bad.example"), args, 403],
    [request(), { ...args, claims: undefined }, 401],
    [request(), { ...args, claims: { ...claims, role: "viewer" } }, 401],
    [request(), { ...args, claims: { ...claims, user_id: "999" } }, 401],
    [request("POST", "<html>", "video/mp4"), args, 415],
  ])
    assert.equal((await experienceRequest(req, env, options)).status, status);
  assert.equal(env.files.size, 0);
  assert.equal(
    (await experienceRequest(request(), { ...env, TEST_CHANNELS: "999", PUBLIC_IMAGES: "true" }, args)).status,
    403,
    "public image hosting does not enable experience uploads outside test channels",
  );
  assert.equal(
    (
      await experienceRequest(
        request(),
        { ...env, EXPERIENCES_ENABLED: "false" },
        args,
      )
    ).status,
    503,
  );
  const response = await worker.fetch(request(), {
    ...env,
    EXTENSION_SECRET: "bad",
  });
  assert.equal(
    response.status,
    401,
    "router verifies signature instead of trusting caller claims",
  );
});
test("content-addressed video uploads deduplicate, stream full/partial bodies, and support seeking and HEAD", async () => {
  const env = environment();
  const uploaded = await experienceRequest(request(), env, args);
  assert.equal(uploaded.status, 201);
  const path = (await uploaded.json()).path,
    hash = path.split("/").at(-1).split(".")[0];
  assert.equal((await experienceRequest(request(), env, args)).status, 201);
  assert.equal(env.files.size, 1);
  const options = { ...args, hash, extension: "mp4" };
  const full = await experienceRequest(request("GET"), env, options);
  assert.equal(full.status, 200);
  assert.equal((await full.arrayBuffer()).byteLength, 48);
  const partial = await experienceRequest(
    request("GET", null, "", "https://viewer.example", { Range: "bytes=8-15" }),
    env,
    options,
  );
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 8-15/48");
  assert.equal((await partial.arrayBuffer()).byteLength, 8);
  const head = await experienceRequest(request("HEAD"), env, options);
  assert.equal(head.headers.get("content-length"), "48");
  assert.equal(await head.text(), "");
  const badRange = await experienceRequest(
    request("GET", null, "", origin, { Range: "bytes=99-" }),
    env,
    options,
  );
  assert.equal(badRange.status, 416);
  assert.equal(badRange.headers.get("content-range"), "bytes */48");
});
test("quota reservations are atomic and retryable after failed storage; a manifest requires uploaded own-channel media", async () => {
  const env = environment(),
    put = env.EXPERIENCE_MEDIA.put;
  env.EXPERIENCE_MEDIA.put = async () => {
    throw new Error("offline");
  };
  assert.equal((await experienceRequest(request(), env, args)).status, 503);
  assert.equal(
    env.db.prepare("SELECT ready FROM experience_files").get().ready,
    0,
  );
  env.EXPERIENCE_MEDIA.put = put;
  const upload = await experienceRequest(request(), env, args);
  const media = `${IMAGE_ORIGIN}${(await upload.json()).path}`;
  const design = experienceExample("story", "story");
  design.assets = [{ id: "clip", kind: "video", name: "Clip", source: media }];
  design.scenes[0].media = "clip";
  const saved = await experienceRequest(
    request("POST", JSON.stringify(design), "application/json"),
    env,
    { ...args, collection: "experiences" },
  );
  assert.equal(saved.status, 201);
  design.assets[0].source = `${IMAGE_ORIGIN}/media/123/${"f".repeat(64)}.mp4`;
  assert.equal(
    (
      await experienceRequest(
        request("POST", JSON.stringify(design), "application/json"),
        env,
        { ...args, collection: "experiences" },
      )
    ).status,
    400,
  );
  env.db.exec(
    "INSERT INTO experience_files VALUES ('quota','123',500000000,1,0)",
  );
  const bytes = mp4();
  bytes[15] = 1;
  assert.equal(
    (await experienceRequest(request("POST", bytes), env, args)).status,
    409,
  );
});
test("oversized streams, mislabeled files, truncated containers and invalid ranges are rejected", async () => {
  await assert.rejects(
    () => readExperienceBody(request("POST", "123456"), 5),
    /upload limit/,
  );
  for (const bytes of [
    new Uint8Array(),
    new TextEncoder().encode("<script>alert(1)</script>"),
    mp4().slice(0, 40),
  ])
    assert.throws(() => validateVideoBytes(bytes, "video/mp4"));
  assert.throws(() => validateVideoBytes(mp4(), "video/webm"));
  assert.deepEqual(mediaRange("bytes=-8", 48), { offset: 40, length: 8 });
  assert.deepEqual(mediaRange("bytes=8-", 48), { offset: 8, length: 40 });
  for (const value of ["bytes=-0", "bytes=3-2", "bytes=0-1,4-5", "bytes=a-b"])
    assert.throws(() => mediaRange(value, 48));
});

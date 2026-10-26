import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, { broadcaster, validatePng, MAX_TOTAL_IMAGES } from "../server/image-worker.mjs";

const secret = Buffer.from(
  "unit-test-key-only-not-a-deployment-secret",
).toString("base64");
const origin = "https://test-extension.ext-twitch.tv";

test("chat connection routes require the broadcaster and exact origin even when unconfigured",async()=>{
 const env={EXTENSION_SECRET:secret,EXTENSION_ORIGIN:origin};
 const endpoint="https://service.example/v1/chat/123/connection";
 const req=async(claims={},from=origin)=>new Request(endpoint,{headers:{Origin:from,Authorization:`Bearer ${await token(claims)}`}});
 let response=await worker.fetch(await req(),env);
 assert.equal(response.status,200);assert.equal((await response.json()).available,false);
 for(const claims of [{role:"viewer"},{user_id:"456"},{channel_id:"456"}])assert.equal((await worker.fetch(await req(claims),env)).status,401);
 assert.equal((await worker.fetch(await req({},"https://other.example"),env)).status,403);
 response=await worker.fetch(new Request("https://service.example/chat/callback?code=do-not-echo&state=bad"),env);
 assert.equal(response.status,400);assert.ok(!(await response.text()).includes("do-not-echo"));
 assert.equal(response.headers.get("Referrer-Policy"),"no-referrer");
});

test("scheduled maintenance removes expired attempt slots even before optional OAuth is configured",async()=>{
 const db=new DatabaseSync(":memory:");
 db.exec(readFileSync(new URL("../server/schema.sql",import.meta.url),"utf8"));
 db.prepare("INSERT INTO party_attempts VALUES(?,?,?)").run("123","456",Date.now()-1000);
 db.prepare("INSERT INTO party_attempts VALUES(?,?,?)").run("123","789",Date.now()+60000);
 const waits=[];
 await worker.scheduled({}, {IMAGES:{prepare(sql){return{bind(value){return{run:async()=>({meta:db.prepare(sql).run({1:value})})};}};}}}, {waitUntil(value){waits.push(value);}});
 await Promise.all(waits);
 assert.deepEqual(db.prepare("SELECT user_id FROM party_attempts").all().map(row=>row.user_id),["789"]);
 db.close();
});
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  ),
);
async function token(overrides = {}, algorithm = "HS256") {
  const header = Buffer.from(
    JSON.stringify({ alg: algorithm, typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      role: "broadcaster",
      channel_id: "123",
      user_id: "123",
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    }),
  ).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(secret, "base64"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${header}.${body}`),
  );
  return `${header}.${body}.${Buffer.from(signature).toString("base64url")}`;
}
function request(
  jwt,
  {
    channel = "123",
    hash = "",
    body = png,
    method = "POST",
    from = origin,
  } = {},
) {
  return new Request(
    `https://images.example/images/${channel}${hash ? `/${hash}.png` : ""}`,
    {
      method,
      headers: {
        authorization: `Bearer ${jwt}`,
        origin: from,
        "content-type": "image/png",
      },
      ...(method === "POST" ? { body } : {}),
    },
  );
}
function environment() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(new URL("../server/schema.sql", import.meta.url), "utf8"),
  );
  return {
    EXTENSION_SECRET: secret,
    EXTENSION_ORIGIN: origin,
    TEST_CHANNELS: "123",
    db,
    IMAGES: {
      prepare(sql) {
        return {
          bind(...args) {
            const params = Object.fromEntries(
              args.map((v, i) => [
                String(i + 1),
                v instanceof ArrayBuffer ? new Uint8Array(v) : v,
              ]),
            );
            const stmt = db.prepare(sql);
            return {
              async first() {
                return stmt.get(params) ?? null;
              },
              async all() {
                return { results: stmt.all(params) };
              },
              async run() {
                return { meta: stmt.run(params) };
              },
            };
          },
        };
      },
    },
  };
}

test("public image mode preserves broadcaster isolation and total storage admission", async()=>{
  const env=environment();
  env.TEST_CHANNELS="";
  const jwt=await token({channel_id:"456",user_id:"456"});
  assert.equal((await worker.fetch(request(jwt,{channel:"456"}),env)).status,403);
  env.PUBLIC_IMAGES="true";
  assert.equal((await worker.fetch(request(jwt,{channel:"456"}),env)).status,201);
  assert.equal((await worker.fetch(request(jwt,{channel:"123"}),env)).status,401);
  assert.equal((await worker.fetch(request(await token({role:"viewer"}),{channel:"123"}),env)).status,401);
  const insert=env.db.prepare("INSERT INTO images(channel,hash,data,bytes,created) VALUES(?,?,?,?,?)");
  for(let i=1;i<MAX_TOTAL_IMAGES;i++) insert.run(String(10000+i),String(i).padStart(64,"0"),png,png.length,0);
  assert.equal((await worker.fetch(request(await token()),env)).status,409);
  assert.equal(env.db.prepare("SELECT count(*) AS n FROM images").get().n,MAX_TOTAL_IMAGES);
  // Identical existing content still succeeds when total admission is full.
  assert.ok((await worker.fetch(request(jwt,{channel:"456"}),env)).ok);
  env.db.close();
});
test("image writes require a signed, unexpired, linked broadcaster token for the exact channel", async () => {
  for (const overrides of [
    { role: "viewer" },
    { channel_id: "999" },
    { user_id: "999" },
    { exp: 1 },
    { nbf: Date.now() },
    { user_id: undefined },
  ]) {
    const env = environment(),
      result = await worker.fetch(request(await token(overrides)), env);
    assert.equal(result.status, 401);
    assert.equal(env.db.prepare("SELECT count(*) AS n FROM images").get().n, 0);
  }
  const jwt = await token();
  await assert.rejects(() =>
    broadcaster(request(jwt.slice(0, -4) + "AAAA"), secret, "123"),
  );
  await assert.rejects(() =>
    broadcaster(request("not.a.valid-token"), secret, "123"),
  );
});
test("uploads are bounded to test channels with strict raster content", async () => {
  const jwt = await token(),
    env = environment();
  assert.equal(
    (await worker.fetch(request(jwt, { hash: "invalid" }), env)).status,
    404,
  );
  assert.equal(
    (await worker.fetch(request(jwt, { from: "https://other.example" }), env))
      .status,
    403,
  );
  assert.equal(
    (
      await worker.fetch(
        request(jwt, { body: "<svg onload='alert(1)'/>" }),
        env,
      )
    ).status,
    415,
  );
  assert.equal(
    (await worker.fetch(request(jwt, { body: new Uint8Array(200001) }), env))
      .status,
    413,
  );
  assert.equal(env.db.prepare("SELECT count(*) AS n FROM images").get().n, 0);
  env.TEST_CHANNELS = "";
  assert.equal((await worker.fetch(request(jwt), env)).status, 403);
  env.TEST_CHANNELS = "123";
  assert.equal(
    (await worker.fetch(request(await token({}, "none")), env)).status,
    401,
  );
  const uploaded = await worker.fetch(request(jwt), env);
  assert.equal(uploaded.status, 201);
  const hash = (await uploaded.json()).path
    .split("/")
    .pop()
    .replace(".png", "");
  assert.equal(env.db.prepare("SELECT count(*) AS n FROM images").get().n, 1);
  const image = await worker.fetch(request(jwt, { method: "GET", hash }), env);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), png);
  assert.equal(
    (await worker.fetch(request(jwt, { method: "DELETE", hash }), env)).status,
    200,
  );
  assert.equal(
    (await worker.fetch(request(jwt, { method: "GET", hash }), env)).status,
    404,
  );
});
test("immutable uploads deduplicate and capacity cannot overwrite published images", async () => {
  const jwt = await token(),
    env = environment();
  const first = await worker.fetch(request(jwt), env);
  const path = (await first.json()).path;
  assert.equal((await worker.fetch(request(jwt), env)).status, 201);
  assert.equal(env.db.prepare("SELECT count(*) AS n FROM images").get().n, 1);
  const insert = env.db.prepare("INSERT INTO images VALUES (?, ?, ?, ?, ?)");
  for (let i = 1; i < 48; i++)
    insert.run("123", String(i).padStart(64, "0"), png, png.length, Date.now());
  const changed = png.slice();
  changed[28] ^= 1;
  assert.equal(
    (await worker.fetch(request(jwt, { body: changed }), env)).status,
    409,
  );
  // A retry of an existing image still succeeds at capacity.
  assert.equal((await worker.fetch(request(jwt), env)).status, 201);
  const original = await worker.fetch(
    new Request(`https://images.example${path}`),
    env,
  );
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()), png);
  const library = await worker.fetch(request(jwt, { method: "GET" }), env);
  assert.equal((await library.json()).images.length, 48);
});
test("PNG parsing rejects oversized dimensions, truncated chunks and appended content", () => {
  assert.deepEqual(validatePng(png), { width: 1, height: 1 });
  const huge = png.slice();
  new DataView(huge.buffer).setUint32(16, 100000);
  assert.throws(() => validatePng(huge));
  assert.throws(() => validatePng(png.slice(0, -1)));
  assert.throws(() => validatePng(new Uint8Array([...png, 1])));
});

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { cardGameRequest } from "../server/card-game-service.mjs";
import { prepareCardDeck, validateMatchDeck } from "../src/card-decks.mjs";
import worker from "../server/image-worker.mjs";
const channel = "123",
  origin = "https://test.ext-twitch.tv",
  now = 10000;
const catalog = {
  version: "0123456789abcdef",
  shards: 1,
  packs: [{ id: "cah:0", name: "Fixture" }],
};
const deck = {
  catalogVersion: catalog.version,
  packs: catalog.packs,
  available: { white: 150, black: 12 },
  white: Array.from({ length: 150 }, (_, i) => ({
    text: `Fixture answer ${i}`,
  })),
  black: Array.from({ length: 12 }, (_, i) => ({
    text: `Fixture prompt ${i}`,
    pick: 1,
    draw: 0,
  })),
};
function environment() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../server/card-game-schema.sql", import.meta.url),
      "utf8",
    ),
  );
  return {
    db,
    CARD_GAMES_ENABLED: "true",
    TEST_CHANNELS: channel,
    EXTENSION_ORIGIN: origin,
    EXTENSION_SECRET: Buffer.from("unit-test-secret-not-real").toString(
      "base64",
    ),
    IMAGES: {
      prepare(sql) {
        return {
          bind(...args) {
            const stmt = db.prepare(sql),
              bound = Object.fromEntries(args.map((v, i) => [`${i + 1}`, v]));
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
      async get(key) {
        return key.endsWith("catalog.json")
          ? { json: async () => catalog }
          : null;
      },
    },
  };
}
async function call(
  env,
  user,
  action,
  role = user === channel ? "broadcaster" : "viewer",
  route = "game",
) {
  const request = new Request(
    `https://service.test/v1/cards/${channel}/${route}`,
    {
      method: action ? "POST" : "GET",
      body: action ? JSON.stringify(action) : undefined,
    },
  );
  const response = await cardGameRequest(
    request,
    env,
    { channel, route, claims: { user_id: user, channel_id: channel, role } },
    (body, status = 200) => Response.json(body, { status }),
    now,
  );
  return { status: response.status, ...(await response.json()) };
}
const actionFor = (game, type, extra = {}) => ({
  type,
  gameId: game.id,
  revision: game.revision,
  ...extra,
});
async function table(env) {
  let r = await call(env, channel, {
    type: "create",
    rules: {},
    catalogVersion: catalog.version,
    deck,
  });
  assert.equal(r.status, 200);
  r = await call(env, "200", actionFor(r.game, "join"));
  r = await call(env, "300", actionFor(r.game, "join"));
  return call(env, channel, actionFor(r.game, "start"));
}
test("service creates a shared game, keeps hands private, refuses stale actions and conflicting writes", async () => {
  const env = environment();
  let r = await table(env);
  assert.equal(r.game.players.length, 3);
  const a = (await call(env, "200")).game,
    b = (await call(env, "300")).game;
  assert.equal(a.hand.length, 10);
  assert.deepEqual((await call(env, null)).game.hand, []);
  const actions = [
    actionFor(a, "submit", { cards: [a.hand[0].id] }),
    actionFor(b, "submit", { cards: [b.hand[0].id] }),
  ];
  const results = await Promise.all([
    call(env, "200", actions[0]),
    call(env, "300", actions[1]),
  ]);
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
  const lost = results[0].status === 409 ? "200" : "300",
    fresh = (await call(env, lost)).game;
  r = await call(
    env,
    lost,
    actionFor(fresh, "submit", { cards: [fresh.hand[0].id] }),
  );
  assert.equal(r.game.phase, "judging");
  assert.equal(r.game.submissions.length, 2);
  assert.equal((await call(env, "200", actions[0])).status, 409);
  assert.equal(
    (await call(env, "200", actionFor(r.game, "close"))).status,
    403,
  );
  env.db.close();
});
test("deck validation bounds content; selected metadata is restored from the catalog", () => {
  const result = validateMatchDeck(
    { ...deck, packs: [{ id: "cah:0", name: "forged" }] },
    catalog,
  );
  assert.equal(result.packs[0].name, "Fixture");
  for (const change of [
    { white: [] },
    { white: [...deck.white, deck.white[0]] },
    { packs: [{ id: "other" }] },
    { black: [{ text: "bad", pick: 8, draw: 0 }] },
    { white: [{ text: "<script>x</script>" }, ...deck.white.slice(1)] },
  ])
    assert.throws(() => validateMatchDeck({ ...deck, ...change }, catalog));
});
test("catalog preparation includes only selected packs and keeps ordered prompt metadata", async () => {
  const cards = [
    ...deck.white.map((c) => ({
      ...c,
      kind: "white",
      pick: 0,
      draw: 0,
      packs: ["cah:0"],
    })),
    ...deck.black.map((c) => ({ ...c, kind: "black", packs: ["cah:0"] })),
    { text: "Other expansion", kind: "white", packs: ["other"] },
  ];
  const prepared = await prepareCardDeck(catalog, ["cah:0"], async () => cards);
  assert.equal(prepared.white.length, 150);
  assert.equal(prepared.black.length, 12);
  assert.equal(
    prepared.white.some((c) => c.text === "Other expansion"),
    false,
  );
  assert.equal(validateMatchDeck(prepared, catalog).white.length, 150);
});
test("only broadcaster can create games or browse deck catalog; unlinked can watch but cannot join", async () => {
  const env = environment();
  assert.equal((await call(env, "200", { type: "create" })).status, 403);
  assert.equal((await call(env, "200", null, "viewer", "catalog")).status, 403);
  assert.equal((await call(env, null, { type: "join" })).status, 401);
  env.db.close();
});
async function jwt(env, claims) {
  const data =
    Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url") +
    "." +
    Buffer.from(JSON.stringify(claims)).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(env.EXTENSION_SECRET, "base64"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return (
    data +
    "." +
    Buffer.from(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)),
    ).toString("base64url")
  );
}
test("HTTP route enforces origin, signature, expiry and channel scope", async () => {
  const env = environment();
  const claims = {
    channel_id: channel,
    user_id: "200",
    role: "viewer",
    exp: Math.floor(Date.now() / 1000) + 100,
  };
  const url = `https://service.test/v1/cards/${channel}/game`;
  const req = (token, from = origin) =>
    new Request(url, {
      headers: { origin: from, Authorization: `Bearer ${token}` },
    });
  assert.equal(
    (await worker.fetch(req(await jwt(env, claims)), env, {})).status,
    200,
  );
  for (const c of [
    { ...claims, channel_id: "999" },
    { ...claims, exp: 1 },
  ])
    assert.equal(
      (await worker.fetch(req(await jwt(env, c)), env, {})).status,
      401,
    );
  assert.equal((await worker.fetch(req("invalid"), env, {})).status, 401);
  assert.equal(
    (
      await worker.fetch(
        req(await jwt(env, claims), "https://evil.example"),
        env,
        {},
      )
    ).status,
    403,
  );
  const options = await worker.fetch(
    new Request(url, { method: "OPTIONS", headers: { origin } }),
    env,
    {},
  );
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("Access-Control-Allow-Origin"), origin);
  env.db.close();
});

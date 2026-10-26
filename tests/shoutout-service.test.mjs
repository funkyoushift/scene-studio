import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { hasShoutoutCandidate, parseShoutoutCommand, trustedShoutoutActor, mayAttemptShoutout, processShoutoutChat } from "../server/shoutout-service.mjs";
import { validateAutomations, createAutomationState } from "../src/automations.mjs";

const now = 1800000000000;
function fixture(t, trigger = { type: "shoutout", mode: "both", users: ["selected"], types: ["affiliate"], exclusions: ["excluded"] }) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../server/automation-schema.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../server/shoutout-schema.sql", import.meta.url), "utf8"));
  t.after(() => db.close());
  const design = validateAutomations({ version: 1, carousels: [], rules: [{ id: "creator", name: "Creator",
    enabled: true, trigger, effect: { type: "shoutout", message: "Visit {name}", color: "#11AAFF", durationSeconds: 12 }, cooldownSeconds: 0 }] });
  db.prepare("INSERT INTO automation_configs(channel,design,revision,owned_merch,updated,engine_state,next_tick) VALUES(?,?,?,?,?,?,?)")
    .run("123", JSON.stringify(design), 1, 0, now, JSON.stringify(createAutomationState(now)), now + 60000);
  const env = { AUTOMATIONS_ENABLED: "true", TWITCH_CHAT_CLIENT_ID: "testclient", TWITCH_CHAT_CLIENT_SECRET: "testsecret",
    IMAGES: { prepare(sql) { return { bind(...args) {
      const stmt = db.prepare(sql), values = Object.fromEntries(args.map((value, index) => [String(index + 1), value]));
      return { first: async () => stmt.get(values) ?? null, run: async () => ({ meta: stmt.run(values) }) };
    } }; } } };
  const state = { streamId: "stream-1", type: "affiliate", image: "https://static-cdn.jtvnw.net/jtv_user_pictures/a-profile_image-300x300.png",
    unknown: false, calls: [], sent: [] };
  const fetcher = async (address, options) => {
    assert.equal(options.redirect, "manual");
    state.calls.push(address);
    const url = new URL(address);
    if (url.pathname === "/oauth2/token") return Response.json({ access_token: "app-token", token_type: "bearer" });
    if (url.pathname === "/helix/streams") return Response.json({ data: state.streamId ? [{ id: state.streamId, user_id: "123", type: "live" }] : [] });
    if (url.pathname === "/helix/users") {
      const id = url.searchParams.get("id"), login = url.searchParams.get("login");
      const name = login || ({ "456": "selected", "789": "other", "900": "excluded" })[id] || "other";
      const userId = id || ({ selected: "456", other: "789", excluded: "900" })[name] || "789";
      return Response.json({ data: state.unknown ? [] : [{ id: userId, login: name, display_name: name,
        broadcaster_type: state.type, profile_image_url: state.image }] });
    }
    throw Error("Unexpected provider call");
  };
  const processInput = async (_env, _channel, event) => { state.sent.push(event); return { status: "sent" }; };
  const run = (input, extra = {}) => processShoutoutChat(env, "123", input,
    { now, fetcher, processInput, ...extra });
  return { db, env, state, run };
}

test("only exact !so @login from a signed broadcaster or moderator badge is a command", () => {
  assert.equal(parseShoutoutCommand("!so @Selected"), "selected");
  for (const text of ["!so selected", "!so @a extra", "hello !so @a", "!so @bad.name"])
    assert.equal(parseShoutoutCommand(text), null);
  assert.equal(trustedShoutoutActor({ chatter_user_id: "456", badges: [] }, "123"), false);
  assert.equal(trustedShoutoutActor({ chatter_user_id: "123", badges: [{ set_id: "broadcaster" }] }, "123"), true);
  assert.equal(trustedShoutoutActor({ chatter_user_id: "456", badges: [{ set_id: "moderator" }] }, "123"), true);
  assert.equal(trustedShoutoutActor({ chatter_user_id: "456", badges: [{ set_id: "broadcaster" }] }, "123"), false);
});

test("automatic selection is users OR types, first message per stream, with exclusions", async t => {
  const s = fixture(t);
  assert.equal(await hasShoutoutCandidate(s.env, "123", "automatic", "selected"), true);
  assert.equal(await hasShoutoutCandidate(s.env, "123", "automatic", "other"), true, "affiliate type can match");
  assert.equal(await hasShoutoutCandidate(s.env, "123", "automatic", "excluded"), false);
  const input = { mode: "automatic", messageId: "message-1", chatterId: "456" };
  assert.equal((await s.run(input)).status, "sent");
  assert.equal(s.state.sent[0].ruleId, "creator");
  assert.equal(s.state.sent[0].profile.login, "selected");
  assert.equal(await mayAttemptShoutout(s.env, "123", "automatic", "456", now + 1), false,
    "repeat messages avoid moderation and provider calls while the stream cache is fresh");
  assert.equal((await s.run({ ...input, messageId: "message-2" })).status, "duplicate");
  assert.equal(s.state.sent.length, 1);
  s.state.streamId = "stream-2";
  assert.equal((await s.run({ ...input, messageId: "message-3" }, { now: now + 6000 })).status, "sent");
  assert.equal(s.state.sent.length, 2);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM shoutout_first_messages").get().n, 2);
  assert.ok(!JSON.stringify(s.db.prepare("SELECT * FROM shoutout_first_messages").all()).includes("message-"));
  assert.equal((await s.run({ mode: "automatic", messageId: "message-4", chatterId: "900" })).status, "no_match");
  assert.equal(s.state.sent.length, 2);
});

test("provider attempts have an atomic per-channel minute budget", async t => {
  const s = fixture(t);
  for (let i = 0; i < 30; i++) assert.equal(await mayAttemptShoutout(s.env, "123", "command", "456", now), true);
  assert.equal(await mayAttemptShoutout(s.env, "123", "command", "456", now), false);
  assert.equal(s.db.prepare("SELECT attempts FROM shoutout_lookup_windows WHERE channel='123'").get().attempts, 30);
  assert.equal(await mayAttemptShoutout(s.env, "123", "command", "456", now + 60000), true);
});

test("unknown account status never becomes regular; invalid profile image is blanked", async t => {
  const s = fixture(t, { type: "shoutout", mode: "both", users: [], types: ["regular"], exclusions: [] });
  s.state.type = undefined;
  assert.equal((await s.run({ mode: "automatic", messageId: "unknown-1", chatterId: "789" })).status, "no_match");
  assert.equal(s.state.sent.length, 0);
  s.state.unknown = true;
  assert.equal((await s.run({ mode: "command", messageId: "deleted-1", targetLogin: "selected" })).status, "no_match",
    "a deleted or unresolved user is never presented as a regular creator");
  s.state.unknown = false;
  s.state.type = "";
  s.state.image = "https://evil.example/profile.png";
  assert.equal((await s.run({ mode: "automatic", messageId: "regular-1", chatterId: "456" })).status, "sent");
  assert.equal(s.state.sent[0].profile.type, "regular");
  assert.equal(s.state.sent[0].profile.image, "");
});

test("command bypasses automatic filters but honors exclusions and final grant recheck", async t => {
  const s = fixture(t);
  assert.equal((await s.run({ mode: "command", messageId: "cmd-1", targetLogin: "other" })).status, "sent");
  assert.equal(s.state.sent[0].profile.login, "other");
  assert.equal((await s.run({ mode: "command", messageId: "cmd-2", targetLogin: "excluded" })).status, "no_match");
  assert.equal((await s.run({ mode: "command", messageId: "cmd-3", targetLogin: "selected" }, { recheck: async () => false })).status, "denied");
  assert.equal(s.state.sent.length, 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { getChatConnection, startChatConnection, disconnectChatConnection, sendParty } from "../src/twitch.mjs";
import { IMAGE_ORIGIN } from "../src/image-address.mjs";

const auth = { token: "test-extension-jwt", channelId: "123" };
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});
function authorization(overrides = {}) {
  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: "test-client", response_type: "code", scope: "moderation:read",
    redirect_uri: `${IMAGE_ORIGIN}/chat/callback`, state: "a".repeat(43),
  }).toString();
  return { authorizeUrl: url.href, expiresAt: Date.now() + 600000, ...overrides };
}

test("party requests identify the default extension package without changing channel or preset", async () => {
  let posted;
  const event = await sendParty(auth, { id: "my-button", preset: "disco" }, async (url, options) => {
    assert.equal(url, `${IMAGE_ORIGIN}/party/123`);
    assert.equal(options.method, "POST");
    posted = JSON.parse(options.body);
    assert.equal(posted.extensionVersion, "0.1.0");
    assert.equal(posted.objectId, "my-button");
    assert.equal(posted.preset, "disco");
    return json({ status: "sent", event: { type: "scene-studio-party", eventId: posted.eventId, preset: "disco", actor: "tester", created: Date.now() } });
  });
  assert.equal(event.eventId, posted.eventId);
  assert.equal(event.preset, "disco");
});

test("chat UI helpers scope requests to the current channel without cookies or redirect following", async () => {
  const replies = [
    { available: true, connected: false, reconnectRequired: false },
    authorization(),
    { connected: false, accessRevoked: true },
  ];
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, method: options.method });
    assert.equal(options.headers.Authorization, `Bearer ${auth.token}`);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return json(replies[requests.length - 1]);
  };
  assert.deepEqual(await getChatConnection(auth, fetcher), replies[0]);
  assert.deepEqual(await startChatConnection(auth, fetcher), replies[1]);
  assert.deepEqual(await disconnectChatConnection(auth, fetcher), replies[2]);
  assert.deepEqual(requests, [
    { url: `${IMAGE_ORIGIN}/v1/chat/123/connection`, method: "GET" },
    { url: `${IMAGE_ORIGIN}/v1/chat/123/connect`, method: "POST" },
    { url: `${IMAGE_ORIGIN}/v1/chat/123/connection`, method: "DELETE" },
  ]);
  await assert.rejects(getChatConnection({ ...auth, channelId: "123/other" }, () => assert.fail("must not send")), /identity/);
  await assert.rejects(startChatConnection(null, () => assert.fail("must not send")), /identity/);
});

test("authorization links reject substituted hosts, callbacks, scopes, ambiguous parameters and invalid state", async () => {
  const mutations = [
    url => { url.protocol = "http:"; },
    url => { url.hostname = "example.com"; },
    url => { url.pathname = "/other"; },
    url => { url.username = "user"; },
    url => { url.hash = "unexpected"; },
    url => { url.searchParams.set("redirect_uri", "https://example.com/chat/callback"); },
    url => { url.searchParams.set("redirect_uri", `${IMAGE_ORIGIN}/chat/callback?extra=1`); },
    url => { url.searchParams.set("scope", "moderation:read chat:edit"); },
    url => { url.searchParams.set("response_type", "token"); },
    url => { url.searchParams.set("state", "a".repeat(42)); },
    url => { url.searchParams.set("state", "a".repeat(42) + "+"); },
    url => { url.searchParams.set("client_id", " "); },
    url => { url.searchParams.delete("client_id"); },
    url => { url.searchParams.append("redirect_uri", "https://example.com/chat/callback"); },
    url => { url.searchParams.append("scope", "chat:edit"); },
  ];
  for (const mutate of mutations) {
    const value = authorization();
    const url = new URL(value.authorizeUrl);
    mutate(url);
    value.authorizeUrl = url.href;
    await assert.rejects(startChatConnection(auth, async () => json(value)), /safely/);
  }
  await assert.rejects(startChatConnection(auth, async () => json(authorization({ authorizeUrl: "not a URL" }))), /could not be prepared/);
  await assert.rejects(startChatConnection(auth, async () => json(authorization({ authorizeUrl: authorization().authorizeUrl + "#" }))), /safely/);
});

test("authorization links require a future numeric expiry", async () => {
  for (const expiresAt of [Date.now() - 1, 0, null, "9999999999999", Infinity]) {
    await assert.rejects(startChatConnection(auth, async () => json(authorization({ expiresAt }))), /safely/);
  }
});

test("status errors and unavailable service cannot be mistaken for a connection", async () => {
  for (const value of [null, {}, { available: true, connected: "true", reconnectRequired: false }, { available: true, connected: true }]) {
    await assert.rejects(getChatConnection(auth, async () => json(value)), /could not be confirmed/);
  }
  assert.deepEqual(await getChatConnection(auth, async () => new Response("Not found", { status: 404 })), {
    available: false, connected: false, reconnectRequired: false,
  });
  await assert.rejects(getChatConnection(auth, async () => { throw new TypeError("network detail"); }), /could not be reached/);
  await assert.rejects(getChatConnection(auth, async () => new Response("not JSON")), /not ready/);
  await assert.rejects(getChatConnection(auth, async () => json({ error: "Sign in again." }, 401)), /Sign in again/);
});

test("disconnect preserves the distinction between local removal, token revocation and uncertain delivery", async () => {
  assert.deepEqual(await disconnectChatConnection(auth, async () => json({ connected: false, accessRevoked: false })), {
    connected: false, accessRevoked: false,
  });
  for (const value of [null, { connected: true, accessRevoked: true }, { connected: false }, { connected: false, accessRevoked: "true" }]) {
    await assert.rejects(disconnectChatConnection(auth, async () => json(value)), /Disconnection could not be confirmed/);
  }
  let calls = 0;
  await assert.rejects(disconnectChatConnection(auth, async () => { calls++; throw new TypeError("lost reply"); }), /result could not be confirmed/);
  assert.equal(calls, 1, "an uncertain mutation must not be retried automatically");
  await assert.rejects(disconnectChatConnection(auth, async () => new Response("Not found", { status: 404 })), /not ready/);
});

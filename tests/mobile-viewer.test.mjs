import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { newObject } from "../src/scene.mjs";

// Load the actual JSX through Vite without opening a port or starting a browser.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: "custom", logLevel: "silent", optimizeDeps: { noDiscovery: true } });
after(() => vite.close());
const { default: MobileViewer, MobileObjectCards, createMobileActions } = await vite.ssrLoadModule("/src/MobileViewer.jsx");
const at = 1800000000000;
const party = (id = crypto.randomUUID()) => ({ type: "scene-studio-party", eventId: id, preset: "ducks", actor: "viewer", created: at });
function setup() {
  const objects = [newObject("reveal"), newObject("counter"), newObject("celebrate"), newObject("party")];
  const scene = { version: 1, name: "Test scene", objects };
  const state = { session: { auth: { token: "signed", channelId: "123" }, creator: { id: "123", login: "streamer" }, linked: true, chatEnabled: true }, now: at, visible: true, sends: 0, shares: 0, notices: [], bursts: [], details: [], counts: [] };
  const controller = createMobileActions({ getSession: () => state.session, getScene: () => scene, clock: () => state.now, isVisible: () => state.visible,
    notify: value => state.notices.push(value), showBurst: value => state.bursts.push(value), showDetail: value => state.details.push(value), showCount: (id, value) => state.counts.push({ id, value }), shareIdentity: () => { state.shares++; },
    send: async (...args) => { state.sends++; return state.send ? state.send(...args) : party(); },
  });
  return { objects, scene, state, controller };
}

test("mobile initial state explains Twitch entry and cards load no image media before an explicit tap", () => {
  const initial = renderToStaticMarkup(React.createElement(MobileViewer, { helper: null }));
  assert.match(initial, /Extensions menu in the Twitch app/);
  const s = setup();
  s.objects[0].image = "https://scene-studio-images.scene-studio-free-prototype.workers.dev/images/123/" + "a".repeat(64) + ".png";
  s.objects[0].title = '<script>alert("unsafe")</script>';
  const cards = renderToStaticMarkup(React.createElement(MobileObjectCards, { scene: s.scene, onActivate() {} }));
  assert.ok(!cards.includes("<img"), "initial cards must not fetch up to12 custom images");
  assert.match(cards, /Show image/); assert.match(cards, /aria-expanded="false"/);
  assert.ok(!cards.includes("<script>")); assert.ok(cards.includes("&lt;script&gt;"));
  assert.match(cards, /0 from you this visit/); assert.match(cards, /Celebrate together/);
});

test("mobile personal actions use saved objects and never post chat", async () => {
  const s = setup();
  await s.controller.activate(s.objects[0].id);
  assert.equal(s.state.details[0].text, s.objects[0].detail);
  await s.controller.activate(s.objects[1].id); await s.controller.activate(s.objects[1].id);
  assert.deepEqual(s.state.counts.map(item => item.value), [1, 2]);
  await s.controller.activate(s.objects[2].id);
  assert.equal(s.state.bursts[0].shared, false); assert.equal(s.state.sends, 0);
  await s.controller.activate("not-a-saved-object"); assert.equal(s.state.sends, 0);
});

test("mobile identity and disabled-chat preflight do not consume shared cooldown", async () => {
  const s = setup(), id = s.objects[3].id;
  s.state.session.linked = false; await s.controller.activate(id);
  assert.equal(s.state.shares, 1); assert.equal(s.state.sends, 0);
  s.state.session.linked = true; s.state.session.chatEnabled = false; await s.controller.activate(id);
  assert.equal(s.state.sends, 0);
  s.state.session.chatEnabled = true; await s.controller.activate(id);
  assert.equal(s.state.sends, 1); assert.equal(s.state.bursts[0].shared, true);
  await s.controller.activate(id); assert.equal(s.state.sends, 1);
  s.state.now += 20000; await s.controller.activate(id); assert.equal(s.state.sends, 2);
});

test("mobile HTTP acknowledgments and shared broadcasts deduplicate in either order", async () => {
  const s = setup(), first = party(), second = party();
  s.state.send = async () => first;
  assert.equal(s.controller.acceptParty(first), true);
  await s.controller.activate(s.objects[3].id);
  assert.equal(s.state.bursts.length, 1);
  s.state.now += 20000; s.state.send = async () => second;
  await s.controller.activate(s.objects[3].id);
  assert.equal(s.controller.acceptParty(second), false); assert.equal(s.state.bursts.length, 2);
  assert.equal(s.controller.acceptParty({ ...party(), created: at - 60001 }), false);
  s.state.visible = false; assert.equal(s.controller.acceptParty(party()), false);
});

test("mobile ignores a pending previous-channel response and preserves a fresh channel cooldown", async () => {
  const s = setup(); let finish;
  s.state.send = () => new Promise(resolve => { finish = resolve; });
  const old = s.controller.activate(s.objects[3].id);
  assert.equal(s.state.sends, 1);
  s.controller.reset(); s.state.session = { ...s.state.session, auth: { token: "new", channelId: "456" }, creator: { id: "456", login: "another" } };
  const before = s.state.notices.length;
  finish(party()); await old;
  assert.equal(s.state.notices.length, before); assert.equal(s.state.bursts.length, 0);
  s.state.send = async () => party(); await s.controller.activate(s.objects[3].id);
  assert.equal(s.state.sends, 2); assert.equal(s.state.bursts.length, 1);
});

test("mobile uncertain shared requests never retry automatically and channel attribution is required", async () => {
  const s = setup(); s.state.send = async () => { throw Error("Result not confirmed. Check chat."); };
  await s.controller.activate(s.objects[3].id); await s.controller.activate(s.objects[3].id);
  assert.equal(s.state.sends, 1); assert.equal(s.state.bursts.length, 0);
  assert.ok(s.state.notices.some(value => value.includes("Result not confirmed")));
  s.controller.reset(); s.state.session.creator = { id: "999", login: "wrong" };
  await s.controller.activate(s.objects[3].id); assert.equal(s.state.sends, 1);
});

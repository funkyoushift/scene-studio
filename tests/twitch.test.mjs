import test from "node:test";
import assert from "node:assert/strict";
import { starterScene } from "../src/scene.mjs";
import { watchTwitchScene, sendTwitchScene, partyRequestId } from "../src/twitch.mjs";

test("shared celebrations use secure UUIDs on embedded browsers without randomUUID", () => {
  assert.equal(partyRequestId({ randomUUID: () => "native-id" }), "native-id");
  let generatedBytes = 0;
  const fallback = partyRequestId({ getRandomValues(values) { generatedBytes = values.length; values.fill(7); return values; } });
  assert.equal(generatedBytes, 16);
  assert.match(fallback, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.throws(() => partyRequestId({}), /cannot safely send/);
});

function fakeHelper() {
  const h = {
    viewer: { role: "broadcaster" },
    configuration: {
      broadcaster: { content: JSON.stringify(starterScene()) },
      onChanged(fn) {
        h.changed = fn;
      },
      set(...args) {
        h.write = args;
      },
    },
    listen(topic, fn) {
      h.receive = fn;
    },
    unlisten(topic, fn) {
      assert.equal(fn, h.receive);
      h.removed = true;
    },
    send(...args) {
      h.sent = args;
    },
  };
  return h;
}

test("viewer loads channel config, keeps valid state on bad updates, and ignores late initial config", () => {
  const h = fakeHelper(),
    scenes = [];
  const stop = watchTwitchScene(
    h,
    (s) => scenes.push(s),
    () => {},
  );
  h.changed();
  assert.equal(scenes.length, 1);
  const next = { ...starterScene(), name: "Updated live" };
  h.receive("broadcast", "application/json", JSON.stringify(next));
  h.receive("broadcast", "application/json", "{broken");
  h.receive("global", "application/json", JSON.stringify(starterScene()));
  h.changed();
  assert.equal(scenes.length, 2);
  assert.equal(scenes.at(-1).name, "Updated live");
  stop();
  h.changed();
  h.receive("broadcast", "application/json", JSON.stringify(next));
  assert.equal(scenes.length, 2);
  assert.equal(h.removed, true);
});

test("saving enforces broadcaster and valid content before any write or broadcast", () => {
  const h = fakeHelper();
  h.viewer.role = "viewer";
  assert.throws(() => sendTwitchScene(h, starterScene()));
  assert.equal(h.write, undefined);
  h.viewer.role = "broadcaster";
  const bad = starterScene();
  bad.objects[0].action = "execute";
  assert.throws(() => sendTwitchScene(h, bad));
  assert.equal(h.write, undefined);
  sendTwitchScene(h, starterScene());
  assert.deepEqual(h.write.slice(0, 2), ["broadcaster", "1"]);
  assert.equal(h.write[2], h.sent[2]);
  h.send = () => {
    throw new Error("unavailable");
  };
  assert.match(sendTwitchScene(h, starterScene()), /may need to reload/);
});

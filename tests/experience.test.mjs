import test from "node:test";
import assert from "node:assert/strict";
import { experienceExample } from "../src/experience-examples.mjs";
import {
  advanceExperience,
  initialExperienceState,
  conditionsMet,
  validateExperience,
  experienceWarnings,
  restoreExperienceState,
  experienceText,
  hostedExperienceMedia,
} from "../src/experience.mjs";
import { parseScene, twitchContent } from "../src/scene.mjs";
import { preflightPublish, publishImages } from "../src/images.mjs";
import { loadExperience, decodeBackupMedia } from "../src/experience-media.mjs";
import { IMAGE_ORIGIN } from "../src/image-address.mjs";
const next = (d, state, button) =>
  advanceExperience(
    d,
    state,
    d.scenes
      .find((s) => s.id === state.scene)
      .elements.find((e) => e.id === button).actions,
  );
test("one data-driven player runs branching dialogue, remembered choices, and reset independently per viewer", () => {
  const d = experienceExample("story", "story"),
    first = initialExperienceState(d),
    second = initialExperienceState(d);
  const trusted = next(d, first, "trust"),
    alone = next(d, second, "alone");
  const branch = d.scenes.find((s) => s.id === "signal").elements[0];
  assert.equal(conditionsMet(branch.when, trusted.values), true);
  assert.equal(conditionsMet(branch.when, alone.values), false);
  const ending = next(d, trusted, "together");
  assert.equal(ending.scene, "together");
  const restart = next(d, ending, "restart");
  assert.equal(restart.scene, "start");
  assert.equal(restart.values.trusted_visitor, false);
  assert.equal(first.values.trusted_visitor, false);
  assert.deepEqual(experienceWarnings(d), []);
});
test("same schema runs a sequence puzzle, scoring, wrong choices and timer consequences", () => {
  const d = experienceExample("sequence", "puzzle");
  let s = next(d, initialExperienceState(d), "begin");
  const timed = advanceExperience(
    d,
    s,
    d.scenes.find((p) => p.id === s.scene).timer.actions,
  );
  assert.equal(timed.scene, "retry");
  assert.equal(next(d, s, "choice-1").scene, "retry");
  for (const id of ["choice-0", "choice-1", "choice-2"]) s = next(d, s, id);
  assert.equal(s.scene, "win");
  assert.equal(s.values.score, 3);
  assert.equal(experienceText("Score: {score}", s.values), "Score: 3");
});
test("malformed imports cannot add code, remote media, broken links, invalid rules or unsafe identifiers", () => {
  const source = experienceExample("story", "story");
  source.code = "alert(1)";
  source.scenes[0].onclick = "alert(1)";
  assert.throws(() => validateExperience(source), /unsupported setting/);
  delete source.code;
  delete source.scenes[0].onclick;
  for (const mutate of [
    (d) => {
      d.scenes[0].elements[0].actions = [{ type: "eval", code: "alert(1)" }];
    },
    (d) => {
      d.scenes[0].elements[0].actions = [{ type: "goto", scene: "missing" }];
    },
    (d) => {
      d.scenes[0].elements[0].actions.push({
        type: "set",
        variable: "trusted_visitor",
        value: true,
      });
    },
    (d) => {
      d.variables[0].id = "constructor";
    },
    (d) => {
      delete d.scenes[0].id;
    },
    (d) => {
      d.scenes[0].elements[0].x = 101;
    },
    (d) => {
      d.scenes[1].elements[0].when[0].value = 1;
    },
    (d) => {
      d.assets.push({
        id: "file",
        kind: "video",
        name: "x",
        source: "https://evil.example/movie.mp4",
      });
    },
    (d) => {
      d.scenes[0].timer = { seconds: 0, actions: [] };
    },
  ]) {
    const d = structuredClone(source);
    mutate(d);
    assert.throws(() => validateExperience(d));
  }
});
test("random destinations, bounded numbers, conditional inventory and save restoration stay local and deterministic", () => {
  const d = experienceExample("sequence", "puzzle"),
    s = initialExperienceState(d);
  assert.equal(
    advanceExperience(
      d,
      s,
      [{ type: "random", scenes: ["first", "second"] }],
      () => 0.9,
    ).scene,
    "second",
  );
  s.values.score = 1e9;
  assert.equal(
    advanceExperience(d, s, [{ type: "add", variable: "score", value: 1e6 }])
      .values.score,
    1e9,
  );
  assert.equal(
    restoreExperienceState(d, { scene: "win", values: { score: "cheat" } })
      .scene,
    "start",
  );
  assert.equal(
    restoreExperienceState(d, { scene: "removed", values: { score: 3 } }).scene,
    "start",
  );
  assert.equal(
    restoreExperienceState(d, { scene: "win", values: { score: 3 } }).values
      .score,
    3,
  );
  d.scenes.push({
    ...d.scenes.at(-1),
    id: "unreachable",
    title: "Unreachable",
  });
  assert.match(experienceWarnings(d)[0], /Unreachable/);
});
test("large experiences round-trip in drafts and use a small channel-bound reference in Twitch configuration", async () => {
  const experience = experienceExample("story", "story");
  experience.scenes[0].description = "A".repeat(3000);
  experience.scenes[1].description = "B".repeat(3000);
  const scene = { version: 1, name: "Test", objects: [], experience };
  assert.deepEqual(parseScene(JSON.stringify(scene)).experience, experience);
  assert.throws(() => twitchContent(scene), /upload the experience/);
  assert.ok(preflightPublish(scene, "123").bytes < 5000);
  const path = `/experiences/123/${"a".repeat(64)}.json`;
  let calls = 0;
  const published = await publishImages(
    scene,
    { token: "test", channelId: "123" },
    async (url, options) => {
      calls++;
      assert.equal(url, `${IMAGE_ORIGIN}/experiences/123`);
      assert.equal(JSON.parse(options.body).scenes.length, 4);
      return Response.json({ path });
    },
  );
  assert.equal(calls, 1);
  assert.ok(twitchContent(published).length < 5000);
  assert.throws(() => preflightPublish(published, "456"), /own channel/);
  assert.equal(
    hostedExperienceMedia(
      `${IMAGE_ORIGIN}/media/123/${"a".repeat(64)}.mp4`,
      "456",
    ),
    false,
  );
});
test("hosted loading enforces response limits and rejects foreign-channel and local media in manifests", async () => {
  const slot = {
    kind: "experience-ref",
    url: `${IMAGE_ORIGIN}/experiences/123/${"a".repeat(64)}.json`,
    name: "Story",
  };
  const d = experienceExample("story", "story");
  assert.equal(
    (await loadExperience(slot, { fetcher: async () => Response.json(d) })).id,
    "story",
  );
  d.assets.push({
    id: "foreign",
    name: "Foreign",
    kind: "video",
    source: `${IMAGE_ORIGIN}/media/456/${"a".repeat(64)}.mp4`,
  });
  await assert.rejects(
    () => loadExperience(slot, { fetcher: async () => Response.json(d) }),
    /Upload media/,
  );
  await assert.rejects(
    () =>
      loadExperience(slot, {
        fetcher: async () => new Response("x".repeat(750001)),
      }),
    /size limit/,
  );
});

test("portable media decodes locally with exact bytes and rejects invalid types and encoding", async () => {
  const original = new Uint8Array([0, 255, 128, 64, 1]);
  for (const type of ["video/mp4", "video/webm", "image/png"]) {
    const blob = decodeBackupMedia(`data:${type};base64,${Buffer.from(original).toString("base64")}`);
    assert.equal(blob.type, type);
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), original);
  }
  assert.throws(() => decodeBackupMedia("data:text/html;base64,AAAA"), /Invalid/);
  assert.throws(() => decodeBackupMedia("data:video/mp4;base64,A"), /encoding/);
  assert.throws(() => decodeBackupMedia("https://example.com/movie.mp4"), /Invalid/);
});

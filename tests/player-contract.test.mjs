import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAYER_CONTRACT, checkPlayerRequirements} from '../src/player-contract.mjs';
import {validateExperience} from '../src/experience.mjs';
import {experienceExample} from '../src/experience-examples.mjs';
import {pollPublishedScene} from '../src/player-channel.mjs';
import {starterScene} from '../src/scene.mjs';

test('legacy content upgrades to an explicit contract and remains idempotent', () => {
  const original = experienceExample('story', 'compat-story');
  delete original.requires;
  const validated = validateExperience(original);
  assert.equal(validated.requires.protocol, 1);
  assert.ok(validated.requires.capabilities.includes('conditions'));
  assert.deepEqual(validateExperience(validated), validated);
  checkPlayerRequirements(PLAYER_CONTRACT);
});

test('new behavior cannot silently disappear through import or publication validation', () => {
  for (const mutate of [
    d => d.requires = {protocol: 2, capabilities: []},
    d => d.requires = {protocol: 1, capabilities: ['shared-world']},
    d => d.multiplayer = true,
    d => d.scenes[0].physics = true,
    d => d.scenes[0].elements[0].onHover = [],
    d => d.scenes[0].elements[0].actions[0].script = 'fetch("/secret")',
    d => d.variables[0].shared = true,
  ]) {
    const d = experienceExample('story','compat-story'); mutate(d);
    assert.throws(() => validateExperience(d), /unsupported setting|not available yet/);
    assert.throws(() => validateExperience(d, {published: true, channel: '123'}), /unsupported setting|not available yet/);
  }
});

test('a newer server contract cannot replace the last working scene or consume its revision', async () => {
  let next, answer = {schema: 1, revision: 1, scene: {...starterScene(), name:'Working'}};
  const seen = [];
  const stop = pollPublishedScene(() => ({token:'test',channelId:'123'}), s => seen.push(s.name), {
    fetcher: async () => Response.json(answer), schedule: fn => {next=fn;}, cancel() {},
  });
  await new Promise(resolve => setImmediate(resolve));
  answer = {...answer, revision: 2, requires: {protocol: 99,capabilities:[]}, scene:{...answer.scene,name:'Unsupported'}};
  await next();
  assert.deepEqual(seen,['Working']);
  answer = {...answer, requires: PLAYER_CONTRACT, scene:{...answer.scene,name:'Compatible'}};
  await next(); stop();
  assert.deepEqual(seen,['Working','Compatible']);
});

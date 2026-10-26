import test from 'node:test';
import assert from 'node:assert/strict';
import { addExperiencePreset } from '../src/experience-presets.mjs';
import { previewExperienceRule } from '../src/experience-preview.mjs';

test('testing one experience does not enqueue other matching channel rules', () => {
  const first = addExperiencePreset({ version: 1, rules: [], carousels: [] }, 'merch-carousel');
  const second = addExperiencePreset(first.design, 'merch-carousel');
  const id = second.design.pages.find(page => page.id === second.pageId).ruleIds[0];
  const before = JSON.stringify(second.design);
  const result = previewExperienceRule(second.design, id, { type: 'message', text: 'merch' }, 1000000);
  assert.deepEqual(result.events.map(item => item.ruleId), [id]);
  assert.equal(JSON.stringify(second.design), before);
});

test('timer preview is due immediately; a disabled experience remains disabled', () => {
  const { design } = addExperiencePreset({ version: 1, rules: [], carousels: [] }, 'custom-popup');
  const rule = design.rules[0];
  rule.trigger = { type: 'interval', everySeconds: 300 };
  assert.equal(previewExperienceRule(design, rule.id, { type: 'tick' }, 1000000).events.length, 1);
  rule.enabled = false;
  assert.equal(previewExperienceRule(design, rule.id, { type: 'tick' }, 1000000).events.length, 0);
});

test('shoutout preview requires its selected rule and a safe sample profile', () => {
  const design = { version: 1, carousels: [], rules: [{ id: 'creator', name: 'Creator shoutout', enabled: true,
    trigger: { type: 'shoutout', mode: 'both', users: [], types: ['partner'], exclusions: [] },
    effect: { type: 'shoutout', message: 'Visit {name}!', color: '#38bdf8', durationSeconds: 12 }, cooldownSeconds: 20 }] };
  const event = { type: 'shoutout', id: 'preview-one', mode: 'automatic', ruleId: 'creator', profile: { id: '456', login: 'guest', displayName: 'Guest', image: '', type: 'partner' } };
  assert.equal(previewExperienceRule(design, 'creator', event, 1000).events[0].shoutout.login, 'guest');
  assert.equal(previewExperienceRule(design, 'creator', { ...event, ruleId: 'other' }, 1000).events.length, 0);
  assert.throws(() => previewExperienceRule(design, 'creator', { ...event, profile: { ...event.profile, image: 'https://example.invalid/x.png' } }, 1000), /verified rule and Twitch profile/);
});

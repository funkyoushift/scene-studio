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

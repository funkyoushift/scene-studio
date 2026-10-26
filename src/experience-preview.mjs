import { validateAutomations, createAutomationState, evaluateAutomations } from './automations.mjs';

// A draft preview isolates the selected rule without changing its saved enabled
// state, trigger or cooldown. The full stream simulator remains separate.
export function previewExperienceRule(input, ruleId, event, now, choiceIndexes = {}) {
  const design = validateAutomations(input);
  const rule = design.rules.find(item => item.id === ruleId);
  if (!rule) throw new Error('Choose a rule to preview.');
  const startedAt = rule.trigger.type === 'interval' ? Math.max(0, now - rule.trigger.everySeconds * 1000) : now;
  const state = { ...createAutomationState(startedAt), choiceIndexes };
  const isolated = { ...design, rules: design.rules.map(item => ({ ...item, enabled: item.id === ruleId && item.enabled })) };
  return evaluateAutomations(isolated, state, event, now);
}

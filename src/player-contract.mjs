// Protocol 1 is an immutable content contract, independent of website releases.
// Add capabilities only alongside a reviewed player release; never reinterpret v1.
export const PLAYER_CONTRACT = Object.freeze({
  protocol: 1,
  capabilities: Object.freeze([
    'scenes', 'click-actions', 'variables', 'conditions', 'timers',
    'images', 'video', 'saved-progress',
  ]),
});

export function checkPlayerRequirements(value) {
  if (value === undefined) return; // Existing v1 content remains compatible.
  if (!value || value.protocol !== PLAYER_CONTRACT.protocol ||
      !Array.isArray(value.capabilities) || value.capabilities.length > 32 ||
      value.capabilities.some(c => !PLAYER_CONTRACT.capabilities.includes(c)) ||
      Object.keys(value).some(k => !['protocol', 'capabilities'].includes(k))) {
    throw new Error('This experience needs player features that are not available yet. Use supported controls or wait for a compatible Twitch player.');
  }
}

export function knownFields(value, names, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  const unknown = Object.keys(value).find(k => !names.includes(k));
  if (unknown) throw new Error(`${label} contains an unsupported setting: ${unknown.slice(0, 60)}. Remove it before publishing.`);
}

export function experienceRequirements(design) {
  const capabilities = new Set(['scenes', 'click-actions']);
  if (design.variables.length) capabilities.add('variables');
  if (design.saveProgress) capabilities.add('saved-progress');
  for (const asset of design.assets) capabilities.add(asset.kind === 'video' ? 'video' : 'images');
  for (const scene of design.scenes) {
    if (scene.timer) capabilities.add('timers');
    if (scene.elements.some(e => e.when?.length)) capabilities.add('conditions');
  }
  return {protocol: 1, capabilities: [...capabilities].sort()};
}

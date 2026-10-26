// Only display fields from authenticated Twitch events. Never executable data.
export function safeLiveContext(input) {
  const result = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;
  if (typeof input.subscriber === "string" && input.subscriber.trim() && input.subscriber.length <= 80 && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(input.subscriber)) result.subscriber = input.subscriber.trim();
  if (Number.isSafeInteger(input.hypeLevel) && input.hypeLevel > 0 && input.hypeLevel <= 10000) result.hypeLevel = input.hypeLevel;
  return result;
}

export function liveText(template, input) {
  const context = safeLiveContext(input);
  return String(template ?? "").replace(/\{(subscriber|hypeLevel)\}/g, (_, key) => key === "subscriber" ? context.subscriber || "a supporter" : String(context.hypeLevel || "—"));
}

export function ruleEffects(rule) {
  return rule.effect.type === "choose" ? rule.effect.options : [rule.effect];
}

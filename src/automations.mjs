// Local-preview data and evaluation only. No chat subscription, timers, storage,
// network requests, publishing, or effect rendering happen in this module.
import { MAX_IMPORT_BYTES, bytes, validateScene } from "./scene.mjs";

export const AUTOMATION_LIMITS = Object.freeze({
  carousels: 3, slides: 6, rules: 8, messageCharacters: 2000,
  displaySeconds: Object.freeze([2, 300]),
  everySeconds: Object.freeze([5, 3600]),
  cooldownSeconds: Object.freeze([0, 3600]),
});

const record = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
};
function text(value, max, label, required = false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim()))
    throw new Error(`${label} must be ${required ? "nonempty " : ""}text of at most ${max} characters.`);
  return required ? value.trim() : value;
}
function duration(value, bounds, label) {
  if (!Number.isInteger(value) || value < bounds[0] || value > bounds[1])
    throw new Error(`${label} must be a whole number from ${bounds[0]} to ${bounds[1]} seconds.`);
  return value;
}
function items(value, max, label, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new Error(`${label} must contain ${min} to ${max} items.`);
  return value;
}
function uniqueId(value, seen, label) {
  const result = text(value, 64, label, true);
  if (!/^[A-Za-z0-9_-]+$/.test(result) || seen.has(result))
    throw new Error(`${label} must be unique and use letters, numbers, underscores, or hyphens.`);
  seen.add(result);
  return result;
}
function time(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
    throw new Error(`${label} must be a finite, nonnegative millisecond timestamp.`);
  return value;
}
function externalEventName(value) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(value))
    throw new Error("External event names must start with a letter and contain 1 to 64 letters, numbers, dots, underscores, or hyphens.");
  return value;
}

// Normalizes {version:1, carousels, rules}; unsupported fields are discarded.
// Image and HTTPS URL admission reuse the existing scene validator exactly.
export function validateAutomations(input) {
  record(input, "Automation design");
  if (input.version !== 1) throw new Error("This is not a version 1 automation design.");
  const carouselIds = new Set();
  const carousels = items(input.carousels, AUTOMATION_LIMITS.carousels, "Carousels").map(raw => {
    record(raw, "Carousel");
    const id = uniqueId(raw.id, carouselIds, "Carousel ID");
    const title = text(raw.title, 80, "Carousel title", true);
    const displaySeconds = duration(raw.displaySeconds, AUTOMATION_LIMITS.displaySeconds, "Carousel display time");
    const slideIds = new Set();
    const objects = items(raw.slides, AUTOMATION_LIMITS.slides, "Slides", 1).map(slide => {
      record(slide, "Slide");
      return {
        id: uniqueId(slide.id, slideIds, "Slide ID"),
        title: text(slide.title, 70, "Slide title", true),
        caption: text(slide.caption, 100, "Slide caption"),
        image: slide.image, url: slide.url,
        action: "reveal", icon: "info", shape: "showcase", color: "#38bdf8",
        x: 0, y: 0, width: 30, height: 40, detail: "",
      };
    });
    const checked = validateScene({ version: 1, name: title, objects });
    return { id, title, displaySeconds, slides: checked.objects.map(({ id, title, caption, image, url }) => ({ id, title, caption, image, url })) };
  });
  const ruleIds = new Set();
  const rules = items(input.rules, AUTOMATION_LIMITS.rules, "Rules").map(raw => {
    record(raw, "Rule");
    const id = uniqueId(raw.id, ruleIds, "Rule ID");
    const name = text(raw.name, 70, "Rule name", true);
    if (typeof raw.enabled !== "boolean") throw new Error("Rule enabled must be true or false.");
    const source = record(raw.trigger, "Trigger");
    let trigger;
    if (source.type === "keyword") {
      const phrase = text(source.phrase, 80, "Keyword phrase", true).normalize("NFC");
      if (!["word", "contains"].includes(source.match)) throw new Error("Choose word or contains matching.");
      trigger = { type: "keyword", phrase, match: source.match };
    } else if (source.type === "interval") {
      trigger = { type: "interval", everySeconds: duration(source.everySeconds, AUTOMATION_LIMITS.everySeconds, "Rule interval") };
    } else if (source.type === "external") {
      trigger = { type: "external", event: externalEventName(source.event) };
    } else throw new Error("Choose a keyword, interval, or external trigger.");
    const target = record(raw.effect, "Effect");
    let effect;
    if (target.type === "celebrate") {
      effect = { type: "celebrate", message: text(target.message, 160, "Celebration message", true) };
    } else if (target.type === "carousel") {
      const carouselId = text(target.carouselId, 64, "Target carousel ID", true);
      if (!carouselIds.has(carouselId)) throw new Error("Choose a carousel that exists in this design.");
      effect = { type: "carousel", carouselId };
    } else throw new Error("Choose a celebration or carousel effect.");
    return { id, name, enabled: raw.enabled, trigger, effect, cooldownSeconds: duration(raw.cooldownSeconds, AUTOMATION_LIMITS.cooldownSeconds, "Rule cooldown") };
  });
  const result = { version: 1, carousels, rules };
  if (bytes(JSON.stringify(result)) > MAX_IMPORT_BYTES) throw new Error("Automation designs must stay under 2 MB. Use smaller images.");
  return result;
}

export function parseAutomations(source) {
  if (typeof source !== "string" || bytes(source) > MAX_IMPORT_BYTES) throw new Error("Import an automation JSON file under 2 MB.");
  let value;
  try { value = JSON.parse(source); } catch { throw new Error("The automation design is not valid JSON."); }
  return validateAutomations(value);
}

// Literal, case-insensitive matching. Word boundaries include Unicode letters,
// numbers, combining marks, and underscores; phrases are never treated as regex.
export function keywordMatches(message, phrase, match = "word") {
  const haystack = text(message, AUTOMATION_LIMITS.messageCharacters, "Preview message").normalize("NFC").toLowerCase();
  const needle = text(phrase, 80, "Keyword phrase", true).normalize("NFC").toLowerCase();
  if (match === "contains") return haystack.includes(needle);
  if (match !== "word") throw new Error("Choose word or contains matching.");
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])${escaped}(?![\\p{L}\\p{N}\\p{M}_])`, "u").test(haystack);
}

// Pass an explicit clock value (usually Date.now()) from the UI. No clock is read.
export function createAutomationState(now = 0) {
  return { startedAt: time(now, "Start time"), lastFired: {} };
}

// Input: {type:'message',text}, {type:'tick'}, or {type:'external',name}, and an
// injected millisecond time. External names match exactly; payloads are ignored.
// Output: a new state and {ruleId,name,effect,at} events; the caller renders them.
// Intervals start after one full period and fire at most once per evaluation.
// Late ticks do not replay missed events. Cooldowns apply independently per rule.
export function evaluateAutomations(input, previous, event, now) {
  const design = validateAutomations(input);
  record(previous, "Automation state");
  const startedAt = time(previous.startedAt, "Start time");
  time(now, "Evaluation time");
  if (now < startedAt) throw new Error("Evaluation time cannot be earlier than the start time.");
  const stored = record(previous.lastFired, "Rule cooldown state");
  record(event, "Preview event");
  if (!["message", "tick", "external"].includes(event.type)) throw new Error("Choose a message, tick, or external event.");
  const message = event.type === "message" ? text(event.text, AUTOMATION_LIMITS.messageCharacters, "Preview message") : "";
  const externalName = event.type === "external" ? externalEventName(event.name) : "";
  const lastFired = Object.fromEntries(design.rules.flatMap(rule => {
    if (!Object.hasOwn(stored, rule.id)) return [];
    const at = time(stored[rule.id], "Last fired time");
    if (at < startedAt || at > now) throw new Error("Rule cooldown timestamps must be within the current preview session.");
    return [[rule.id, at]];
  }));
  const events = [];
  for (const rule of design.rules) {
    if (!rule.enabled) continue;
    const hasFired = Object.hasOwn(lastFired, rule.id);
    const last = hasFired ? lastFired[rule.id] : startedAt;
    if (hasFired && now - last < rule.cooldownSeconds * 1000) continue;
    const matches = rule.trigger.type === "keyword"
      ? event.type === "message" && keywordMatches(message, rule.trigger.phrase, rule.trigger.match)
      : rule.trigger.type === "external"
        ? event.type === "external" && externalName === rule.trigger.event
        : event.type === "tick" && now - last >= rule.trigger.everySeconds * 1000;
    if (!matches) continue;
    Object.defineProperty(lastFired, rule.id, { value: now, writable: true, enumerable: true, configurable: true });
    events.push({ ruleId: rule.id, name: rule.name, effect: { ...rule.effect }, at: now });
  }
  return { state: { startedAt, lastFired }, events };
}

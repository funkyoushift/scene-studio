// Local-preview data and evaluation only. No chat subscription, timers, storage,
// network requests, publishing, or effect rendering happen in this module.
import { MAX_IMPORT_BYTES, bytes, validateScene } from "./scene.mjs";

export const AUTOMATION_LIMITS = Object.freeze({
  carousels: 32, slides: 6, rules: 64, pages: 48, chooseOptions: 6, messageCharacters: 2000,
  displaySeconds: Object.freeze([2, 300]),
  everySeconds: Object.freeze([5, 3600]),
  cooldownSeconds: Object.freeze([0, 3600]),
});
export const AUTOMATION_DESIGN_BYTES = 65_536;
export const CELEBRATION_STYLES = Object.freeze([
  "confetti", "spotlight", "hype-train", "hearts", "starfall", "fireworks",
  "bubbles", "meteor", "aurora", "arcade", "petals", "orbit",
]);
export const CELEBRATION_SOUNDS = Object.freeze(["chime", "arcade", "fanfare", "bell", "space"]);
export const TWITCH_AUTOMATION_EVENTS = Object.freeze([
  "subscribe", "resubscribe", "gift", "hype_begin", "hype_progress", "hype_end",
]);

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
function celebrationEffect(value, label = "Celebration") {
  const effect = { type: "celebrate", message: text(value.message, 160, "Celebration message", true) };
  if (Object.hasOwn(value, "appearance") && value.appearance !== undefined) {
    const appearance = record(value.appearance, `${label} appearance`);
    if (!CELEBRATION_STYLES.includes(appearance.style)) throw new Error("Choose a supported celebration style.");
    if (typeof appearance.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(appearance.color)) throw new Error("Celebration color must be a six-digit #RRGGBB color.");
    const cleanAppearance = { style: appearance.style, color: appearance.color, durationSeconds: duration(appearance.durationSeconds, [4, 20], "Celebration duration") };
    if (Object.hasOwn(appearance, "sound")) {
      const sound = record(appearance.sound, `${label} sound`);
      if (Object.keys(sound).length !== 2 || !Object.hasOwn(sound, "preset") || !Object.hasOwn(sound, "volume") ||
          !CELEBRATION_SOUNDS.includes(sound.preset) || !Number.isInteger(sound.volume) || sound.volume < 0 || sound.volume > 100)
        throw new Error("Celebration sound must use a supported preset and an integer volume from 0 to 100.");
      cleanAppearance.sound = { preset: sound.preset, volume: sound.volume };
    }
    effect.appearance = cleanAppearance;
  }
  return effect;
}
function range(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
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

function effectCarouselIds(effect) {
  if (effect.type === "carousel") return [effect.carouselId];
  if (effect.type === "choose") return effect.options.filter(option => option.type === "carousel").map(option => option.carouselId);
  return [];
}

// A view-only grouping for v1 designs authored before page metadata existed.
// Rules that refer to multiple carousels are grouped under their first option.
export function deriveLegacyAutomationPages(input) {
  const design = validateAutomations({ ...input, pages: undefined });
  const used = new Set();
  const pages = design.carousels.map(carousel => {
    const base = `page-${carousel.id}`.slice(0, 64);
    let id = base, suffix = 2;
    while (used.has(id)) {
      const tail = `-${suffix++}`;
      id = `${base.slice(0, 64 - tail.length)}${tail}`;
    }
    used.add(id);
    const ruleIds = design.rules.filter(rule => effectCarouselIds(rule.effect)[0] === carousel.id).map(rule => rule.id);
    return { id, name: carousel.title.slice(0, 60), ruleIds, carouselIds: [carousel.id] };
  });
  const assigned = new Set(pages.flatMap(page => page.ruleIds));
  const unlinked = design.rules.filter(rule => !assigned.has(rule.id)).map(rule => rule.id);
  if (unlinked.length) {
    let id = "page-other", suffix = 2;
    while (used.has(id)) id = `page-other-${suffix++}`;
    pages.push({ id, name: "Other", ruleIds: unlinked, carouselIds: [] });
  }
  return pages;
}

function pageList(design) {
  return design.pages ?? deriveLegacyAutomationPages(design);
}

export function createAutomationPage(design, { id, name, ruleIds = [], carouselIds = [] }) {
  const clean = validateAutomations(design), pages = pageList(clean);
  if (pages.length >= AUTOMATION_LIMITS.pages) throw new Error(`A design can contain up to ${AUTOMATION_LIMITS.pages} pages.`);
  return validateAutomations({ ...clean, pages: [...pages, { id, name, ruleIds, carouselIds }] });
}

export function addRuleToAutomationPage(design, pageId, ruleId) {
  const clean = validateAutomations(design), pages = pageList(clean);
  if (!clean.rules.some(rule => rule.id === ruleId)) throw new Error("Choose a rule that exists in this design.");
  if (!pages.some(page => page.id === pageId)) throw new Error("Choose a page that exists in this design.");
  return validateAutomations({ ...clean, pages: pages.map(page => ({
    ...page,
    ruleIds: page.id === pageId ? [...page.ruleIds.filter(id => id !== ruleId), ruleId] : page.ruleIds.filter(id => id !== ruleId),
  })) });
}

export function addCarouselToAutomationPage(design, pageId, carouselId) {
  const clean = validateAutomations(design), pages = pageList(clean);
  if (!pages.some(page => page.id === pageId)) throw new Error("Choose a page that exists in this design.");
  return validateAutomations({ ...clean, pages: pages.map(page => page.id === pageId
    ? { ...page, carouselIds: [...page.carouselIds.filter(id => id !== carouselId), carouselId] }
    : page) });
}

// Removing a page only removes its grouping metadata, never its rules or carousels.
export function removeAutomationPage(design, pageId) {
  const clean = validateAutomations(design), pages = pageList(clean);
  if (!pages.some(page => page.id === pageId)) throw new Error("Choose a page that exists in this design.");
  return validateAutomations({ ...clean, pages: pages.filter(page => page.id !== pageId) });
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
    let layout;
    if (Object.hasOwn(raw, "layout") && raw.layout !== undefined) {
      const value = record(raw.layout, "Carousel layout");
      const x = range(value.x, 0, 90, "Carousel horizontal position");
      const y = range(value.y, 0, 90, "Carousel vertical position");
      const width = range(value.width, 10, 80, "Carousel width");
      const height = range(value.height, 10, 80, "Carousel height");
      const layer = value.layer;
      if (!Number.isInteger(layer) || layer < 0 || layer > 100) throw new Error("Carousel layer must be a whole number from 0 to 100.");
      if (x + width > 100 || y + height > 100) throw new Error("Carousel layout must stay within the 100 percent canvas.");
      layout = { x, y, width, height, layer };
    }
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
    return { id, title, displaySeconds, ...(layout ? { layout } : {}), slides: checked.objects.map(({ id, title, caption, image, url }) => ({ id, title, caption, image, url })) };
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
    } else if (source.type === "twitch") {
      if (!TWITCH_AUTOMATION_EVENTS.includes(source.event)) throw new Error("Choose a supported Twitch event.");
      trigger = { type: "twitch", event: source.event };
    } else throw new Error("Choose a keyword, interval, or external trigger.");
    const target = record(raw.effect, "Effect");
    let effect;
    if (target.type === "celebrate") {
      effect = celebrationEffect(target);
    } else if (target.type === "carousel") {
      const carouselId = text(target.carouselId, 64, "Target carousel ID", true);
      if (!carouselIds.has(carouselId)) throw new Error("Choose a carousel that exists in this design.");
      effect = { type: "carousel", carouselId };
    } else if (target.type === "choose") {
      if (!["rotate", "random"].includes(target.mode)) throw new Error("Choose rotate or random selection.");
      const options = items(target.options, AUTOMATION_LIMITS.chooseOptions, "Choice options", 1).map(rawOption => {
        const option = record(rawOption, "Choice option");
        if (option.type === "carousel") {
          const carouselId = text(option.carouselId, 64, "Choice carousel ID", true);
          if (!carouselIds.has(carouselId)) throw new Error("Choose a carousel that exists in this design.");
          return { type: "carousel", carouselId };
        }
        if (option.type === "celebrate") return celebrationEffect(option, "Choice celebration");
        throw new Error("Choose a carousel or celebration for each option.");
      });
      effect = { type: "choose", mode: target.mode, options };
    } else throw new Error("Choose a celebration or carousel effect.");
    return { id, name, enabled: raw.enabled, trigger, effect, cooldownSeconds: duration(raw.cooldownSeconds, AUTOMATION_LIMITS.cooldownSeconds, "Rule cooldown") };
  });
  const result = { version: 1, carousels, rules };
  if (Object.hasOwn(input, "pages") && input.pages !== undefined) {
    const pageIds = new Set(), assignedRuleIds = new Set(), ruleIdSet = new Set(rules.map(rule => rule.id)), carouselIdSet = new Set(carousels.map(carousel => carousel.id));
    result.pages = items(input.pages, AUTOMATION_LIMITS.pages, "Pages").map(raw => {
      record(raw, "Page");
      const id = uniqueId(raw.id, pageIds, "Page ID");
      const name = text(raw.name, 60, "Page name", true);
      const ruleIds = items(raw.ruleIds, AUTOMATION_LIMITS.rules, "Page rules").map(ruleId => {
        const ref = text(ruleId, 64, "Page rule ID", true);
        if (!ruleIdSet.has(ref)) throw new Error("Choose rules that exist in this design.");
        if (assignedRuleIds.has(ref)) throw new Error("A rule can belong to only one page.");
        assignedRuleIds.add(ref);
        return ref;
      });
      const carouselRefs = new Set();
      const carouselIds = items(raw.carouselIds, AUTOMATION_LIMITS.carousels, "Page carousels").map(carouselId => {
        const ref = text(carouselId, 64, "Page carousel ID", true);
        if (!carouselIdSet.has(ref)) throw new Error("Choose carousels that exist in this design.");
        if (carouselRefs.has(ref)) throw new Error("A page cannot list a carousel more than once.");
        carouselRefs.add(ref);
        return ref;
      });
      return { id, name, ruleIds, carouselIds };
    });
  }
  if (bytes(JSON.stringify(result)) > MAX_IMPORT_BYTES) throw new Error("Automation designs must stay under 2 MB. Use smaller images.");
  return result;
}

export function parseAutomations(source) {
  if (typeof source !== "string" || bytes(source) > MAX_IMPORT_BYTES) throw new Error("Import an automation JSON file under 2 MB.");
  let value;
  try { value = JSON.parse(source); } catch { throw new Error("The automation design is not valid JSON."); }
  return validateAutomations(value);
}

// Opt-in starter for new drafts only. Parsing existing designs never adds rules.
export function createExternalStarterRule() {
  return {
    id: "game-victory",
    name: "Celebrate a game victory",
    enabled: true,
    trigger: { type: "external", event: "boss_defeated" },
    effect: { type: "celebrate", message: "BOSS DEFEATED. YOU DID THAT." },
    cooldownSeconds: 20,
  };
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

// Input: {type:'message',text}, {type:'tick'}, {type:'external',name}, or a
// validated Twitch event {type:'twitch',event,id}, and an
// injected millisecond time. External names match exactly; payloads are ignored.
// Output: a new state and {ruleId,name,effect,at} events; the caller renders them.
// Intervals start after one full period and fire at most once per evaluation.
// Late ticks do not replay missed events. Cooldowns apply independently per rule.
export function evaluateAutomations(input, previous, event, now, { random = Math.random } = {}) {
  const design = validateAutomations(input);
  record(previous, "Automation state");
  const startedAt = time(previous.startedAt, "Start time");
  time(now, "Evaluation time");
  if (now < startedAt) throw new Error("Evaluation time cannot be earlier than the start time.");
  const choiceIndexes = Object.hasOwn(previous, "choiceIndexes")
    ? { ...record(previous.choiceIndexes, "Choice rotation state") }
    : {};
  const stored = record(previous.lastFired, "Rule cooldown state");
  record(event, "Preview event");
  if (!["message", "tick", "external", "twitch"].includes(event.type)) throw new Error("Choose a message, tick, or external/Twitch event.");
  const message = event.type === "message" ? text(event.text, AUTOMATION_LIMITS.messageCharacters, "Preview message") : "";
  const externalName = event.type === "external" ? externalEventName(event.name) : "";
  let twitchEvent = "";
  if (event.type === "twitch") {
    if (!TWITCH_AUTOMATION_EVENTS.includes(event.event)) throw new Error("Choose a supported Twitch event.");
    if (typeof event.id !== "string" || event.id.length < 1 || event.id.length > 256 || /\p{Cc}/u.test(event.id))
      throw new Error("Twitch event ID must be 1 to 256 characters without controls.");
    twitchEvent = event.event;
  }
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
        : rule.trigger.type === "twitch"
          ? event.type === "twitch" && twitchEvent === rule.trigger.event
          : event.type === "tick" && now - last >= rule.trigger.everySeconds * 1000;
    if (!matches) continue;
    Object.defineProperty(lastFired, rule.id, { value: now, writable: true, enumerable: true, configurable: true });
    let effect = rule.effect;
    if (effect.type === "choose") {
      let index;
      if (effect.mode === "rotate") {
        const current = Object.hasOwn(choiceIndexes, rule.id) ? choiceIndexes[rule.id] : 0;
        if (!Number.isSafeInteger(current) || current < 0) throw new Error("Choice rotation index must be a nonnegative whole number.");
        index = current % effect.options.length;
        Object.defineProperty(choiceIndexes, rule.id, {value:(index + 1) % effect.options.length,writable:true,enumerable:true,configurable:true});
      } else {
        if (typeof random !== "function") throw new Error("Random choice needs a random number source.");
        const sample = random();
        if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error("Random choice source must return a number from 0 up to 1.");
        index = Math.floor(sample * effect.options.length);
      }
      effect = effect.options[index];
    }
    events.push({ ruleId: rule.id, name: rule.name, effect: { ...effect }, at: now });
  }
  const state = { startedAt, lastFired };
  if (Object.hasOwn(previous, "choiceIndexes") || Object.keys(choiceIndexes).length) state.choiceIndexes = choiceIndexes;
  return { state, events };
}

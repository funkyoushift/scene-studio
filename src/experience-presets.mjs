import { AUTOMATION_LIMITS, deriveLegacyAutomationPages, validateAutomations } from "./automations.mjs";

export const EXPERIENCE_PRESETS = Object.freeze([
  { key: "merch-carousel", title: "Merch carousel", description: "Show a rotating set of featured products when chat asks.", category: "Promotion", icon: "▣" },
  { key: "discord-invite", title: "Discord invite", description: "Share a community invite card when chat asks how to join.", category: "Community", icon: "◉" },
  { key: "subscriber-thanks", title: "Subscriber thanks", description: "Thank viewers when they subscribe.", category: "Engagement", icon: "♡" },
  { key: "hype-train", title: "Hype Train", description: "Celebrate when a Hype Train begins.", category: "Engagement", icon: "↗" },
  { key: "chat-celebration", title: "Chat celebration", description: "Start a celebration when chat says a chosen word.", category: "Engagement", icon: "✦" },
  { key: "custom-popup", title: "Custom popup", description: "Add a customizable popup triggered by a chosen word.", category: "Custom", icon: "▱" },
].map(Object.freeze));

const definitions = {
  "merch-carousel": { carousel: { title: "Featured products", slides: [
    ["Featured item 1", "Add a product description."],
    ["Featured item 2", "Add a product description."],
    ["Featured item 3", "Add a product description."],
  ] }, trigger: { type: "keyword", phrase: "merch", match: "word" }, name: "Show featured products", cooldownSeconds: 30 },
  "discord-invite": { carousel: { title: "Community", slides: [["Join the community", "Add your community details."]] }, trigger: { type: "keyword", phrase: "discord", match: "word" }, name: "Share community invite", cooldownSeconds: 30 },
  "subscriber-thanks": { trigger: { type: "twitch", event: "subscribe" }, name: "Thank a subscriber", message: "Thanks, {subscriber}!", cooldownSeconds: 20 },
  "hype-train": { trigger: { type: "twitch", event: "hype_begin" }, name: "Celebrate the Hype Train", message: "Level {hypeLevel} Hype Train! Join the celebration!", cooldownSeconds: 30 },
  "chat-celebration": { trigger: { type: "keyword", phrase: "party", match: "word" }, name: "Celebrate with chat", message: "Chat celebration!", cooldownSeconds: 20 },
  "custom-popup": { carousel: { title: "Custom popup", slides: [["Your popup title", "Add your popup text."]] }, trigger: { type: "keyword", phrase: "hello", match: "word" }, name: "Show a custom popup", cooldownSeconds: 20 },
};

function nextId(base, used) {
  let id = base.slice(0, 64), suffix = 2;
  while (used.has(id)) {
    const tail = `-${suffix++}`;
    id = `${base.slice(0, 64 - tail.length)}${tail}`;
  }
  used.add(id);
  return id;
}

export function addExperiencePreset(input, key) {
  const definition = definitions[key];
  if (!definition) throw new Error("Choose a supported experience preset.");
  const clean = validateAutomations(input);
  const pages = clean.pages ?? deriveLegacyAutomationPages(clean);
  if (pages.length >= AUTOMATION_LIMITS.pages) throw new Error(`A design can contain up to ${AUTOMATION_LIMITS.pages} pages.`);
  if (definition.carousel && clean.carousels.length >= AUTOMATION_LIMITS.carousels) throw new Error(`A design can contain up to ${AUTOMATION_LIMITS.carousels} carousels.`);
  if (clean.rules.length >= AUTOMATION_LIMITS.rules) throw new Error(`A design can contain up to ${AUTOMATION_LIMITS.rules} rules.`);

  const used = new Set([...clean.carousels.map(x => x.id), ...clean.carousels.flatMap(x => x.slides.map(s => s.id)), ...clean.rules.map(x => x.id), ...pages.map(x => x.id)]);
  const design = { ...clean, pages: structuredClone(pages), carousels: [...clean.carousels], rules: [...clean.rules] };
  let carouselId;
  if (definition.carousel) {
    carouselId = nextId(`${key}-carousel`, used);
    design.carousels.push({ id: carouselId, title: definition.carousel.title, displaySeconds: 10, layout: { x: 65, y: 5, width: 30, height: 60, layer: 0 }, slides: definition.carousel.slides.map(([title, caption], index) => ({
      id: nextId(`${key}-slide-${index + 1}`, used), title, caption, image: "", url: "",
    })) });
  }
  const ruleId = nextId(`${key}-rule`, used), pageId = nextId(`${key}-page`, used);
  const rule = { id: ruleId, name: definition.name, enabled: true, trigger: { ...definition.trigger }, effect: definition.carousel
    ? { type: "carousel", carouselId }
    : { type: "celebrate", message: definition.message }, cooldownSeconds: definition.cooldownSeconds };
  design.rules.push(rule);
  design.pages.push({ id: pageId, name: EXPERIENCE_PRESETS.find(preset => preset.key === key).title, ruleIds: [ruleId], carouselIds: carouselId ? [carouselId] : [] });
  return { design: validateAutomations(design), pageId };
}

function effectCarouselIds(effect) {
  if (effect.type === "carousel") return [effect.carouselId];
  if (effect.type === "choose") return effect.options.filter(option => option.type === "carousel").map(option => option.carouselId);
  return [];
}

export function removeExperience(input, pageId) {
  const clean = validateAutomations({ ...input, pages: undefined });
  const pages = input.pages === undefined ? deriveLegacyAutomationPages(clean) : structuredClone(input.pages);
  const selected = pages.find(page => page.id === pageId);
  if (!selected) throw new Error("Choose an experience that exists in this design.");
  const remainingPages = pages.filter(page => page.id !== pageId);
  const remainingPageRuleIds = new Set(remainingPages.flatMap(page => page.ruleIds));
  const removedRuleIds = new Set(selected.ruleIds.filter(id => !remainingPageRuleIds.has(id)));
  const rules = clean.rules.filter(rule => !removedRuleIds.has(rule.id));
  const carouselCandidates = new Set(selected.carouselIds);
  const referencedCarousels = new Set([
    ...remainingPages.flatMap(page => page.carouselIds),
    ...rules.flatMap(rule => effectCarouselIds(rule.effect)),
  ]);
  const removedCarouselIds = new Set([...carouselCandidates].filter(id => !referencedCarousels.has(id)));
  return validateAutomations({
    ...clean,
    rules,
    carousels: clean.carousels.filter(carousel => !removedCarouselIds.has(carousel.id)),
    pages: remainingPages,
  });
}

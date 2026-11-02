import {
  EXPERIENCE_PRESETS,
  addExperiencePreset,
  addExperiencePresets,
} from "../src/experience-presets.mjs";
import {
  INTERACTIVE_PRESET_OPTIONS,
  TEMPLATE_OPTIONS,
  createInteractivePreset,
  createTemplate,
} from "../src/templates.mjs";
import {
  EXPERIENCE_EXAMPLES,
  experienceExample,
} from "../src/experience-examples.mjs";
import { validateScene } from "../src/scene.mjs";
export const emptyAutomation = () => ({
  version: 1,
  carousels: [],
  rules: [],
  pages: [],
});
export const emptyScene = () => ({
  version: 1,
  name: "New scene",
  objects: [],
});
export const bundles = [
  {
    key: "celebration-essentials",
    title: "Celebration essentials",
    description: "Subscriber thanks and the complete Hype Train.",
    flows: ["subscriber-thanks", "hype-train"],
    widgets: [],
  },
  {
    key: "community-corner",
    title: "Community corner",
    description: "Discord, stream rules, and your schedule.",
    flows: ["discord-invite", "stream-rules", "stream-schedule"],
    widgets: [],
  },
  {
    key: "game-night",
    title: "Game night",
    description: "Trivia, a tap challenge, and game goals.",
    flows: ["game-goals"],
    widgets: ["trivia", "tap-challenge"],
  },
  {
    key: "creator-showcase",
    title: "Creator showcase",
    description: "A merch carousel and a featured item.",
    flows: ["merch-carousel", "featured-item"],
    widgets: [],
  },
];
function category(p, type) {
  if (p.category === "Custom") return "Custom";
  if (type === "layout" || type === "bundle") return "Layouts & bundles";
  if (
    type === "experience" ||
    type === "maze" ||
    ["trivia", "tap-challenge", "clue-hunt"].includes(p.key)
  )
    return "Games & stories";
  if (
    p.category === "Engagement" ||
    ["celebration", "shared-party"].includes(p.key)
  )
    return "Celebrations";
  if (
    p.category === "Promotion" ||
    ["clickable-link", "custom-popup"].includes(p.key)
  )
    return "Popups & links";
  if (p.category === "Custom") return "Custom";
  return "Community & info";
}
const list = (items, type) =>
  items.map((p) => ({
    ...p,
    key: p.key || p.id,
    title: p.title || p.name,
    id: `${type}:${p.key || p.id}`,
    type,
    category: category(p, type),
  }));
export const catalog = [
  ...list(EXPERIENCE_PRESETS, "flow"),
  ...list(INTERACTIVE_PRESET_OPTIONS, "widget"),
  ...list(TEMPLATE_OPTIONS, "layout"),
  ...list(EXPERIENCE_EXAMPLES, "experience"),
  ...list(bundles, "bundle"),
  ...list(
    [
      {
        key: "quiet-vault",
        title: "The Quiet Vault · BRB maze",
        description:
          "Three click-controlled mazes with corridor images and saved progress.",
      },
    ],
    "maze",
  ),
];
export const categories = [
  "All templates",
  "Popups & links",
  "Community & info",
  "Celebrations",
  "Games & stories",
  "Layouts & bundles",
  "Custom",
];
export function findTemplates(query = "", group = "All templates") {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return catalog.filter(
    (p) =>
      (group === "All templates" || p.category === group) &&
      terms.every((t) =>
        `${p.title} ${p.description} ${p.category} ${p.key}`
          .toLowerCase()
          .includes(t),
      ),
  );
}
export function makeTemplate(item, mazeSlot) {
  let scene = emptyScene(),
    automation = emptyAutomation();
  if (item.type === "flow")
    automation = addExperiencePreset(automation, item.key).design;
  if (item.type === "widget") scene.objects = createInteractivePreset(item.key);
  if (item.type === "layout") scene = createTemplate(item.key);
  if (item.type === "experience")
    scene.experience = experienceExample(item.key);
  if (item.type === "maze") scene.experience = structuredClone(mazeSlot);
  if (item.type === "bundle") {
    const b = bundles.find((b) => b.key === item.key);
    automation = addExperiencePresets(automation, b.flows).design;
    scene.objects = b.widgets.flatMap(createInteractivePreset);
  }
  scene.name = item.title;
  return { scene: validateScene(scene), automation };
}
export function simpleContent(payload) {
  const carousel = payload.automation.carousels[0],
    object = payload.scene.objects[0],
    rule = payload.automation.rules[0];
  return {
    title:
      carousel?.slides[0]?.title ||
      object?.title ||
      rule?.effect?.message ||
      rule?.effect?.options?.[0]?.message ||
      payload.scene.experience?.name ||
      payload.scene.name,
    caption: carousel?.slides[0]?.caption || object?.caption || "",
    image: carousel?.slides[0]?.image || object?.image || "",
    url: carousel?.slides[0]?.url || object?.url || "",
  };
}
export function changeContent(payload, field, value) {
  const next = structuredClone(payload),
    carousel = next.automation.carousels[0],
    object = next.scene.objects[0],
    rule = next.automation.rules[0];
  if (carousel) carousel.slides[0][field] = value;
  else if (object) object[field] = value;
  else if (rule && field === "title") {
    if (["celebrate", "shoutout"].includes(rule.effect.type))
      rule.effect.message = value;
    else if (rule.effect.type === "choose")
      rule.effect.options[0].message = value;
  }
  return next;
}
export function eventFor(rule) {
  const t = rule.trigger,
    id = crypto.randomUUID();
  if (t.type === "keyword") return { type: "message", text: t.phrase, id };
  if (t.type === "twitch") return { type: "twitch", event: t.event, id };
  if (t.type === "interval") return { type: "tick", id };
  if (t.type === "shoutout")
    return {
      type: "shoutout",
      id,
      mode: "automatic",
      ruleId: rule.id,
      profile: {
        id: "456",
        login: "examplecreator",
        displayName: "Example Creator",
        image: "",
        type: "affiliate",
      },
    };
  return { type: "external", name: t.event, id };
}

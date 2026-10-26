import { AUTOMATION_LIMITS, deriveLegacyAutomationPages, validateAutomations } from "./automations.mjs";

export const EXPERIENCE_PRESETS = Object.freeze([
  { key: "creator-shoutout", title: "Creator shoutout", description: "Welcome selected creators with their Twitch picture and a clickable channel card.", category: "Community", icon: "📣" },
  { key: "merch-carousel", title: "Merch carousel", description: "Show a rotating set of featured products when chat asks.", category: "Promotion", icon: "▣" },
  { key: "discord-invite", title: "Discord invite", description: "Share a community invite card when chat asks how to join.", category: "Community", icon: "◉" },
  { key: "subscriber-thanks", title: "Subscriber thanks", description: "Thank {subscriber} with a purple spotlight when they subscribe.", category: "Engagement", icon: "♡" },
  { key: "hype-train", title: "Hype Train", description: "Follow the whole train with live levels, progress, countdown and a steam-train celebration.", category: "Engagement", icon: "↗" },
  { key: "chat-celebration", title: "Chat celebration", description: "Start a lime confetti celebration when chat says party.", category: "Engagement", icon: "✦" },
  { key: "custom-popup", title: "Custom popup", description: "Add a customizable popup triggered by a chosen word.", category: "Custom", icon: "▱" },
  { key: "stream-rules", title: "Stream rules", description: "Show your chat rules when someone asks for the rules.", category: "Community", icon: "✓" },
  { key: "faq-answers", title: "Quick answers", description: "Show your prepared answer cards when chat types faq.", category: "Stream info", icon: "?" },
  { key: "stream-schedule", title: "Stream schedule", description: "Show your stream days and plans when chat asks about the schedule.", category: "Stream info", icon: "▦" },
  { key: "welcome-chat", title: "Welcome chat", description: "Send a friendly welcome when someone says welcome.", category: "Community", icon: "☀" },
  { key: "lurk-note", title: "Lurk note", description: "Let chat know lurkers are welcome when someone says lurk.", category: "Community", icon: "◌" },
  { key: "community-guide", title: "Community guide", description: "Share your community details and where viewers can find them.", category: "Community", icon: "◎" },
  { key: "spoiler-reminder", title: "Spoiler reminder", description: "Remind chat to follow your spoiler rules when someone mentions spoilers.", category: "Gaming", icon: "◈" },
  { key: "spoiler-free-chat", title: "Spoiler-free chat", description: "Post a spoiler-free reminder when chat asks to keep the story unspoiled.", category: "Gaming", icon: "◇" },
  { key: "game-goals", title: "Game goals", description: "Show the current game goals when chat asks what you are working toward.", category: "Gaming", icon: "◎" },
  { key: "build-notes", title: "Build notes", description: "Collect your character build details in a card set viewers can request.", category: "Gaming", icon: "⌘" },
  { key: "loadout-notes", title: "Loadout notes", description: "Show your current loadout details when chat asks about your setup.", category: "Gaming", icon: "▤" },
  { key: "modding-notes", title: "Modding notes", description: "Share your mod list and setup notes when chat asks about mods.", category: "Gaming", icon: "⚙" },
  { key: "product-drop", title: "Product drop", description: "Show the details you add for a new product when chat asks about the drop.", category: "Promotion", icon: "✧" },
  { key: "featured-item", title: "Featured item", description: "Highlight the item details you choose when chat asks what is featured.", category: "Promotion", icon: "▣" },
  { key: "resub-thanks", title: "Resubscription thanks", description: "Thank a returning subscriber when their resubscription event arrives.", category: "Engagement", icon: "♡" },
  { key: "gift-thanks", title: "Gift subscription thanks", description: "Celebrate a gift subscription when its Twitch event arrives.", category: "Engagement", icon: "♧" },
  { key: "hype-progress", title: "Hype Train progress", description: "Share the current Hype Train level {hypeLevel} as it progresses.", category: "Engagement", icon: "↗" },
  { key: "hype-finish", title: "Hype Train finish", description: "Thank chat when the Hype Train ends.", category: "Engagement", icon: "★" },
  { key: "random-party", title: "Random party moment", description: "Pick a different celebration at random when chat says surprise.", category: "Engagement", icon: "✦" },
  { key: "random-cheer", title: "Random cheer", description: "Choose a random celebration when chat says cheer.", category: "Engagement", icon: "✧" },
  { key: "stream-checkin", title: "Stream check-in", description: "Ask chat for a quick check-in every 30 minutes.", category: "Community", icon: "◷" },
  { key: "stretch-break", title: "Stretch break", description: "Post a gentle stretch reminder every hour.", category: "Community", icon: "↔" },
].map(Object.freeze));

const definitions = {
  "creator-shoutout": { trigger: { type: "shoutout", mode: "both", users: [], types: ["affiliate", "partner"], exclusions: [] }, name: "Welcome a creator", effect: { type: "shoutout", message: "Go say hello to {name}!", color: "#a3e635", durationSeconds: 15 }, cooldownSeconds: 60 },
  "merch-carousel": { carousel: { title: "Featured products", slides: [
    ["Featured item 1", "Add a product description."],
    ["Featured item 2", "Add a product description."],
    ["Featured item 3", "Add a product description."],
  ] }, trigger: { type: "keyword", phrase: "merch", match: "word" }, name: "Show featured products", cooldownSeconds: 30 },
  "discord-invite": { carousel: { title: "Community", slides: [["Join the community", "Add your community details."]] }, trigger: { type: "keyword", phrase: "discord", match: "word" }, name: "Share community invite", cooldownSeconds: 30 },
  "subscriber-thanks": { trigger: { type: "twitch", event: "subscribe" }, name: "Thank a subscriber", message: "Thanks, {subscriber}!", appearance: { style: "spotlight", color: "#a855f7", durationSeconds: 8 }, cooldownSeconds: 20 },
  "hype-train": { trigger: { type: "twitch", event: "hype_begin" }, name: "Celebrate the Hype Train", message: "Level {hypeLevel} Hype Train! Join the celebration!", appearance: { style: "hype-train", color: "#f97316", durationSeconds: 12, hypeLifecycle: true }, cooldownSeconds: 30 },
  "chat-celebration": { trigger: { type: "keyword", phrase: "party", match: "word" }, name: "Celebrate with chat", message: "Chat celebration!", appearance: { style: "confetti", color: "#a3e635", durationSeconds: 8 }, cooldownSeconds: 20 },
  "custom-popup": { carousel: { title: "Custom popup", slides: [["Your popup title", "Add your popup text."]] }, trigger: { type: "keyword", phrase: "hello", match: "word" }, name: "Show a custom popup", cooldownSeconds: 20 },
  "stream-rules": { carousel: { title: "Stream rules", displaySeconds: 16, slides: [["Be kind", "Add the tone you want chat to set."], ["Keep it safe", "Add your safety and conduct rules."], ["Respect spoilers", "Add your spoiler policy or replace this card."]] }, trigger: { type: "keyword", phrase: "rules", match: "word" }, name: "Share stream rules", cooldownSeconds: 30 },
  "faq-answers": { carousel: { title: "Quick answers", displaySeconds: 18, slides: [["What are you playing?", "Add the current game or activity."], ["Where can I find links?", "Add the channel-approved destination or remove this card."], ["When do you stream?", "Add your current schedule."]] }, trigger: { type: "keyword", phrase: "faq", match: "word" }, name: "Answer common questions", cooldownSeconds: 30 },
  "stream-schedule": { carousel: { title: "Stream schedule", displaySeconds: 16, slides: [["Stream days", "Add your usual days and time zone."], ["Coming up", "Add your next planned stream."], ["Schedule changes", "Add where viewers can check for updates."]] }, trigger: { type: "keyword", phrase: "schedule", match: "word" }, name: "Share stream schedule", cooldownSeconds: 30 },
  "welcome-chat": { trigger: { type: "keyword", phrase: "welcome", match: "word" }, name: "Welcome chat", message: "Welcome in! Make yourself at home, and enjoy the stream.", appearance: { style: "hearts", color: "#fb7185", durationSeconds: 8 }, cooldownSeconds: 10 },
  "lurk-note": { trigger: { type: "keyword", phrase: "lurk", match: "word" }, name: "Welcome a lurker", message: "Enjoy your lurk! We are glad you are here, whether you are chatting or relaxing.", appearance: { style: "aurora", color: "#38bdf8", durationSeconds: 8 }, cooldownSeconds: 10 },
  "community-guide": { carousel: { title: "Community guide", displaySeconds: 16, slides: [["Community space", "Add your community details and approved invite destination."], ["Community events", "Add the activities your community can join."], ["How to get involved", "Add the steps viewers should follow."]] }, trigger: { type: "keyword", phrase: "community", match: "word" }, name: "Share community guide", cooldownSeconds: 30 },
  "spoiler-reminder": { trigger: { type: "keyword", phrase: "spoiler", match: "contains" }, name: "Remind chat about spoilers", message: "Please follow the stream's spoiler rules and avoid revealing story surprises for other viewers.", cooldownSeconds: 30 },
  "spoiler-free-chat": { trigger: { type: "keyword", phrase: "spoiler free", match: "contains" }, name: "Keep chat spoiler-free", message: "Spoiler-free chat, please. Keep story reveals out of the conversation so everyone can discover them together.", cooldownSeconds: 30 },
  "game-goals": { carousel: { title: "Game goals", displaySeconds: 14, slides: [["Current objective", "Add the goal you are working toward."], ["Next milestone", "Add the next milestone viewers can watch for."], ["How to help", "Add the kind of chat help you welcome."]] }, trigger: { type: "keyword", phrase: "goal", match: "word" }, name: "Share game goals", cooldownSeconds: 25 },
  "build-notes": { carousel: { title: "Build notes", displaySeconds: 16, slides: [["Build overview", "Add the character or build name."], ["Key choices", "Add the skills, gear, or decisions that matter."], ["Build source", "Add attribution or a source if one applies."]] }, trigger: { type: "keyword", phrase: "build", match: "word" }, name: "Share build notes", cooldownSeconds: 25 },
  "loadout-notes": { carousel: { title: "Loadout notes", displaySeconds: 16, slides: [["Current setup", "Add the equipment or loadout you are using."], ["Why this setup", "Add what you are testing or aiming for."], ["Alternatives", "Add another setup viewers can ask about."]] }, trigger: { type: "keyword", phrase: "loadout", match: "word" }, name: "Share loadout notes", cooldownSeconds: 25 },
  "modding-notes": { carousel: { title: "Modding notes", displaySeconds: 16, slides: [["Mod list", "Add the mods and versions you use."], ["Setup notes", "Add manual setup steps or compatibility notes."], ["Credits", "Add creator credits and source details where applicable."]] }, trigger: { type: "keyword", phrase: "mods", match: "word" }, name: "Share modding notes", cooldownSeconds: 30 },
  "product-drop": { carousel: { title: "Product drop", displaySeconds: 14, slides: [["New item", "Add the product name and details."], ["What is included", "Add the features or options viewers should know."], ["Where to learn more", "Add a destination only if you have an approved link."]] }, trigger: { type: "keyword", phrase: "drop", match: "word" }, name: "Share product drop details", cooldownSeconds: 45 },
  "featured-item": { carousel: { title: "Featured item", displaySeconds: 14, slides: [["Featured today", "Add the item you want to highlight."], ["A closer look", "Add the details viewers often ask about."], ["More information", "Add an approved destination if one is available."]] }, trigger: { type: "keyword", phrase: "featured", match: "word" }, name: "Highlight a featured item", cooldownSeconds: 45 },
  "resub-thanks": { trigger: { type: "twitch", event: "resubscribe" }, name: "Thank a returning subscriber", message: "Welcome back, {subscriber}! Thank you for supporting our community again.", appearance: { style: "orbit", color: "#c084fc", durationSeconds: 8 }, cooldownSeconds: 20 },
  "gift-thanks": { trigger: { type: "twitch", event: "gift" }, name: "Thank a gift subscriber", message: "Thanks, {subscriber}, for sharing gift subscriptions with the community!", appearance: { style: "hearts", color: "#fb7185", durationSeconds: 9 }, cooldownSeconds: 20 },
  "hype-progress": { trigger: { type: "twitch", event: "hype_progress" }, name: "Celebrate Hype Train progress", message: "Hype Train level {hypeLevel}! Keep the good energy rolling, chat!", appearance: { style: "hype-train", color: "#f97316", durationSeconds: 10, hypeLifecycle: true }, cooldownSeconds: 20 },
  "hype-finish": { trigger: { type: "twitch", event: "hype_end" }, name: "Thank chat for the Hype Train", message: "Thanks for riding the Hype Train together, chat!", appearance: { style: "hype-train", color: "#38bdf8", durationSeconds: 9, hypeLifecycle: true }, cooldownSeconds: 20 },
  "random-party": { trigger: { type: "keyword", phrase: "surprise", match: "word" }, name: "Choose a random party moment", choice: [
    { type: "celebrate", message: "The party is officially underway!", appearance: { style: "confetti", color: "#a3e635", durationSeconds: 8 } },
    { type: "celebrate", message: "Chat brought the sparkle. Let the good times roll!", appearance: { style: "spotlight", color: "#c084fc", durationSeconds: 9 } },
    { type: "celebrate", message: "Hype express, all aboard!", appearance: { style: "hype-train", color: "#fb923c", durationSeconds: 10, sound: { preset: "train", volume: 60 } } },
  ], cooldownSeconds: 20 },
  "random-cheer": { trigger: { type: "keyword", phrase: "cheer", match: "word" }, name: "Choose a random cheer", choice: [
    { type: "celebrate", message: "A little cheer for everyone watching!", appearance: { style: "arcade", color: "#38bdf8", durationSeconds: 8 } },
    { type: "celebrate", message: "Sending a spotlight moment to chat!", appearance: { style: "starfall", color: "#f472b6", durationSeconds: 8 } },
    { type: "celebrate", message: "Chat energy is moving full steam ahead!", appearance: { style: "hype-train", color: "#f97316", durationSeconds: 10, sound: { preset: "train", volume: 60 } } },
  ], cooldownSeconds: 20 },
  "stream-checkin": { trigger: { type: "interval", everySeconds: 1800 }, name: "Check in with chat", message: "Quick stream check-in: how is everyone doing, and what has been your favorite moment so far?", cooldownSeconds: 1800 },
  "stretch-break": { trigger: { type: "interval", everySeconds: 3600 }, name: "Offer a stretch break", message: "Gentle stretch break! Take a moment to move, get some water, and settle back in when you are ready.", appearance: { style: "bubbles", color: "#67e8f9", durationSeconds: 10 }, cooldownSeconds: 3600 },
};

export function hypeTrainEffect(event) {
  const key = { hype_begin: "hype-train", hype_progress: "hype-progress", hype_end: "hype-finish" }[event];
  if (!key) throw Error("Choose a Hype Train event.");
  const definition = definitions[key];
  return { type: "celebrate", message: definition.message, appearance: structuredClone(definition.appearance) };
}

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
  const ruleKeys = key === "hype-train" ? ["hype-train", "hype-progress", "hype-finish"] : [key];
  if (clean.rules.length + ruleKeys.length > AUTOMATION_LIMITS.rules) throw new Error(`A design can contain up to ${AUTOMATION_LIMITS.rules} rules.`);

  const used = new Set([...clean.carousels.map(x => x.id), ...clean.carousels.flatMap(x => x.slides.map(s => s.id)), ...clean.rules.map(x => x.id), ...pages.map(x => x.id)]);
  const design = { ...clean, pages: structuredClone(pages), carousels: [...clean.carousels], rules: [...clean.rules] };
  let carouselId;
  if (definition.carousel) {
    carouselId = nextId(`${key}-carousel`, used);
    design.carousels.push({ id: carouselId, title: definition.carousel.title, displaySeconds: definition.carousel.displaySeconds ?? 10, layout: definition.carousel.layout ?? { x: 65, y: 5, width: 30, height: 60, layer: 0 }, slides: definition.carousel.slides.map(([title, caption], index) => ({
      id: nextId(`${key}-slide-${index + 1}`, used), title, caption, image: "", url: "",
    })) });
  }
  const pageId = nextId(`${key}-page`, used), ruleIds = [];
  for (const ruleKey of ruleKeys) {
    const ruleDefinition = definitions[ruleKey];
    const ruleId = nextId(`${ruleKey}-rule`, used);
    const effect = ruleDefinition.effect ? structuredClone(ruleDefinition.effect) : ruleDefinition.carousel
      ? { type: "carousel", carouselId }
      : ruleDefinition.choice
        ? { type: "choose", mode: "random", options: structuredClone(ruleDefinition.choice) }
        : { type: "celebrate", message: ruleDefinition.message, ...(ruleDefinition.appearance ? { appearance: structuredClone(ruleDefinition.appearance) } : {}) };
    design.rules.push({ id: ruleId, name: ruleDefinition.name, enabled: true, trigger: structuredClone(ruleDefinition.trigger), effect, cooldownSeconds: ruleDefinition.cooldownSeconds });
    ruleIds.push(ruleId);
  }
  design.pages.push({ id: pageId, name: EXPERIENCE_PRESETS.find(preset => preset.key === key).title, ruleIds, carouselIds: carouselId ? [carouselId] : [] });
  return { design: validateAutomations(design), pageId };
}

function effectCarouselIds(effect) {
  if (effect.type === "carousel") return [effect.carouselId];
  if (effect.type === "choose") return effect.options.filter(option => option.type === "carousel").map(option => option.carouselId);
  return [];
}

// Prepare the whole selection before the editor commits any of it. A capacity
// failure leaves both the original design and the selected layouts intact.
export function addExperiencePresets(input, keys) {
  let design = validateAutomations(input);
  const pageIds = [];
  for (const key of new Set(keys)) {
    const result = addExperiencePreset(design, key);
    design = result.design;
    pageIds.push(result.pageId);
  }
  return { design, pageIds };
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

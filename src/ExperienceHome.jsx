import React, { useEffect, useState, useRef } from "react";
import { INTERACTIVE_PRESET_OPTIONS } from "./templates.mjs";
import { EXPERIENCE_PRESETS } from "./experience-presets.mjs";
import ThemeToggle from "./ThemeToggle.jsx";
import "./experience-home.css";

const viewerNotes = {
  "tap-challenge": "A personal goal for each viewer",
  celebration: "A personal celebration for each viewer",
  "clickable-link": "Website links depend on Twitch availability",
  "shared-party": "Shared effects; chat connection required",
};

const layoutBundles = [
  { key: "celebration-essentials", title: "Celebration essentials", description: "Thank subscribers and celebrate each Hype Train moment.", flowKeys: ["subscriber-thanks", "hype-train"], widgetKeys: [], icon: "✦" },
  { key: "community-corner", title: "Community corner", description: "Help viewers find your community, rules, and schedule.", flowKeys: ["discord-invite", "stream-rules", "stream-schedule"], widgetKeys: [], icon: "◎" },
  { key: "game-night", title: "Game night", description: "Add viewer trivia and a tap challenge, plus a game goals flow.", flowKeys: ["game-goals"], widgetKeys: ["trivia", "tap-challenge"], icon: "⌘" },
  { key: "creator-showcase", title: "Creator showcase", description: "Feature a product carousel and a single highlighted item.", flowKeys: ["merch-carousel", "featured-item"], widgetKeys: [], icon: "▣" },
];

const guidedGoals = [
  { id: "subscriber-thanks", label: "Thank subscribers", key: "subscriber-thanks", kind: "flow", what: "Show a thank-you moment when someone subscribes.", need: "A Twitch connection is needed for live subscriber events." },
  { id: "hype-train", label: "Celebrate a Hype Train", key: "hype-train", kind: "flow", what: "Show live train progress and a celebration.", need: "A Twitch connection is needed for Hype Train events." },
  { id: "discord-invite", label: "Share my Discord invite", key: "discord-invite", kind: "flow", what: "Give viewers a community invite card when they ask.", need: "Your Discord invite link. Live link availability depends on your channel’s Twitch configuration." },
  { id: "merch-carousel", label: "Show my merch", key: "merch-carousel", kind: "flow", what: "Show a carousel of products when chat asks.", need: "Your product images, names and own-merch store links. Live destinations must be allowed for your channel." },
  { id: "creator-shoutout", label: "Shout out a creator", key: "creator-shoutout", kind: "flow", what: "Welcome selected creators with a channel card.", need: "The creator’s Twitch name." },
  { id: "trivia", label: "Play random trivia", key: "trivia", kind: "widget", what: "Give viewers ready-to-play random questions and a personal score.", need: "Nothing to write. Use the included question bank or choose a category." },
  { id: "tap-challenge", label: "Add a tap game", key: "tap-challenge", kind: "widget", what: "Give each viewer a personal tapping goal.", need: "A goal number; you can change the starter later." },
];

export default function ExperienceHome({ objects = [], flows = [], onChooseWidget, onChooseFlow, onChooseBundle, onCheckBundle, onEditObject, onEditFlows, onOpenAdvanced, onOpenCanvas, onOpenAI, channelName, live = false, notice, onDismissNotice }) {
  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false);
  const [selectedBundles, setSelectedBundles] = useState([]);
  const [bundleError, setBundleError] = useState("");
  const [addingBundles, setAddingBundles] = useState(false);
  const [guidedGoal, setGuidedGoal] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryCategory, setLibraryCategory] = useState("All ideas");
  const [librarySearch, setLibrarySearch] = useState("");
  const guidedActionRef = useRef(null);
  const guidedHeadingRef = useRef(null);
  const libraryHeadingRef = useRef(null);
  const wasLibraryOpen = useRef(false);
  const selectedGoal = guidedGoals.find(goal => goal.id === guidedGoal);
  const matchingDraftExists = goal => {
    const normalize = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const goalWords = normalize(goal.label);
    const aliases = { "subscriber-thanks": ["subscriber thanks", "thank subscribers"], "hype-train": ["hype train"], "discord-invite": ["discord invite", "community invite"], "merch-carousel": ["merch carousel", "show my merch"], "creator-shoutout": ["creator shoutout"], trivia: ["trivia"], "tap-challenge": ["tap challenge", "tap game"] }[goal.id] || [goalWords];
    const list = goal.kind === "flow" ? flows : objects;
    return list.some(item => (goal.id === "trivia" && Boolean(item.quiz)) || (goal.id === "tap-challenge" && item.action === "counter") || aliases.some(alias => normalize(`${item.key || ""} ${item.preset || ""} ${item.presetKey || ""} ${item.name || ""} ${item.title || ""}`).includes(alias)));
  };
  const startGuidedSetup = () => {
    if (!selectedGoal) return;
    if (matchingDraftExists(selectedGoal)) {
      const item = (selectedGoal.kind === "flow" ? flows : objects).find(entry => {
        const normalize = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const aliases = { "subscriber-thanks": ["subscriber thanks", "thank subscribers"], "hype-train": ["hype train"], "discord-invite": ["discord invite", "community invite"], "merch-carousel": ["merch carousel", "show my merch"], "creator-shoutout": ["creator shoutout"], trivia: ["trivia"], "tap-challenge": ["tap challenge", "tap game"] }[selectedGoal.id];
        return (selectedGoal.id === "trivia" && Boolean(entry.quiz)) || (selectedGoal.id === "tap-challenge" && entry.action === "counter") || aliases.some(alias => normalize(`${entry.key || ""} ${entry.preset || ""} ${entry.presetKey || ""} ${entry.name || ""} ${entry.title || ""}`).includes(alias));
      });
      if (selectedGoal.kind === "flow") onEditFlows?.(item?.id);
      else onEditObject?.(item?.id);
      return;
    }
    if (selectedGoal.kind === "flow") onChooseFlow?.(selectedGoal.key);
    else onChooseWidget?.(selectedGoal.key);
  };
  const groups = [
    { title: "Viewer interactions", description: "Things viewers can open, answer, or tap.", items: INTERACTIVE_PRESET_OPTIONS.map(item => ({ ...item, kind: "widget", category: item.category || "Viewer interaction", note: viewerNotes[item.key] })) },
    { title: "Live moments", description: "Show a response when something happens in chat or on stream.", items: EXPERIENCE_PRESETS.map(item => ({ ...item, kind: "flow", note: "Starter; connection may be required" })) },
  ];
  const libraryCategories = ["All ideas", "Celebrations", "Games", "Community", "Showcases", "Custom"];
  const categoryForItem = item => {
    const key = item.key || "";
    const sourceCategory = item.category || "";
    if (sourceCategory === "Engagement" || ["celebration", "shared-party", "community-party", "chat-celebration", "subscriber-thanks", "resub-thanks", "gift-thanks", "hype-train", "hype-progress", "hype-finish", "random-party", "random-cheer"].includes(key)) return "Celebrations";
    if (sourceCategory === "Gaming" || ["trivia", "tap-challenge", "game-goals", "build-notes", "loadout-notes", "modding-notes", "clue-hunt"].includes(key)) return "Games";
    if (sourceCategory === "Community" || sourceCategory === "Stream info" || ["discord-invite", "welcome-chat", "lurk-note", "stream-rules", "community-guide", "streamer-info", "welcome", "info-card"].includes(key)) return "Community";
    if (sourceCategory === "Promotion" || ["clickable-link", "photo-showcase", "featured-item", "merch-carousel"].includes(key)) return "Showcases";
    return "Custom";
  };
  const libraryItems = groups.flatMap(group => group.items.map(item => ({ ...item, ideaCategory: categoryForItem(item) })));
  const normalizedLibrarySearch = librarySearch.trim().toLocaleLowerCase();
  const libraryResults = libraryItems.filter(item => {
    const categoryMatch = libraryCategory === "All ideas" || item.ideaCategory === libraryCategory;
    const searchMatch = !normalizedLibrarySearch || `${item.title} ${item.description} ${item.ideaCategory}`.toLocaleLowerCase().includes(normalizedLibrarySearch);
    return categoryMatch && searchMatch;
  });
  const resetLibraryFilters = () => { setLibrarySearch(""); setLibraryCategory("All ideas"); };
  const revealLibrary = () => setLibraryOpen(true);
  useEffect(() => {
    if (libraryOpen) {
      const frame = requestAnimationFrame(() => {
        libraryHeadingRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
        libraryHeadingRef.current?.focus();
      });
      wasLibraryOpen.current = true;
      return () => cancelAnimationFrame(frame);
    }
    if (wasLibraryOpen.current) {
      const frame = requestAnimationFrame(() => {
        guidedHeadingRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
        guidedHeadingRef.current?.focus();
      });
      wasLibraryOpen.current = false;
      return () => cancelAnimationFrame(frame);
    }
  }, [libraryOpen]);
  const toggleBundle = key => {
    setBundleError("");
    setSelectedBundles(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  };
  const selection = layoutBundles.filter(bundle => selectedBundles.includes(bundle.key));
  const selectionPayload = { flowKeys: [...new Set(selection.flatMap(bundle => bundle.flowKeys))], widgetKeys: [...new Set(selection.flatMap(bundle => bundle.widgetKeys))] };
  const assessment = selectedBundles.length ? onCheckBundle?.(selectionPayload) : null;
  const addSelectedBundles = async () => {
    if (!selectedBundles.length || addingBundles) return;
    const selected = layoutBundles.filter(bundle => selectedBundles.includes(bundle.key));
    const payload = {
      flowKeys: [...new Set(selected.flatMap(bundle => bundle.flowKeys))],
      widgetKeys: [...new Set(selected.flatMap(bundle => bundle.widgetKeys))],
    };
    setAddingBundles(true); setBundleError("");
    try {
      if (typeof onChooseBundle !== "function") throw Error("Layout bundles are unavailable right now.");
      await onChooseBundle(payload);
      setSelectedBundles([]);
    } catch (error) {
      setBundleError(typeof error?.message === "string" ? error.message : "Could not add these layouts. Your selections are still here.");
    } finally { setAddingBundles(false); }
  };

  return <main className="experience-home">
    <header className="eh-topbar">
      <div className="eh-brand"><span className="eh-brand-mark">✦</span><span>Scene Studio</span><span className="eh-brand-label">HOME</span></div>
      <div className="eh-top-actions">
        {channelName && <span className="eh-channel">{channelName}</span>}
        <span className={`eh-live ${live ? "is-live" : ""}`}><i />{live ? "Twitch configuration" : "Local draft"}</span>
        <ThemeToggle />
      </div>
    </header>

    {notice && <div className="eh-notice" role="status"><span>{notice}</span><button type="button" onClick={onDismissNotice} aria-label="Dismiss notice">×</button></div>}
    <section className="eh-hero">
      <div className="eh-hero-copy">
        <span className="eh-kicker">YOUR STREAM, YOUR WAY</span>
        <h1>What will you add to your stream?</h1>
        <p>Pick a starting point, make it yours, try it out, then publish when it feels ready.</p>
        <div className="eh-steps" aria-label="A simple path to publishing">
          {["Choose", "Customize", "Test", "Publish"].map((step, i) => <span key={step}><b>{String(i + 1).padStart(2, "0")}</b>{step}</span>)}
        </div>
      </div>
      <div className="eh-hero-art" aria-hidden="true">
        <div className="eh-orbit eh-orbit-one" /><div className="eh-orbit eh-orbit-two" />
        <div className="eh-art-card eh-art-card-back">✦</div><div className="eh-art-card eh-art-card-front"><span>YOUR SCENE</span><b>Make a little<br />moment.</b><i>↗</i></div>
        <span className="eh-spark eh-spark-a">✧</span><span className="eh-spark eh-spark-b">✦</span>
      </div>
    </section>

    <section className="eh-guided" aria-labelledby="eh-guided-title">
      <span className="eh-kicker">A SIMPLE PLACE TO START</span>
      <h2 ref={guidedHeadingRef} tabIndex={-1} id="eh-guided-title">Let’s set up one thing</h2>
      <p className="eh-guided-intro">Choose what you want viewers to do. We’ll open the matching starter so you can customize it.</p>
      <fieldset className="eh-goal-list">
        <legend className="eh-visually-hidden">What would you like to set up?</legend>
        {guidedGoals.map(goal => <label key={goal.id} className={`eh-goal-option${guidedGoal === goal.id ? " selected" : ""}`}>
          <input type="radio" name="guided-goal" value={goal.id} checked={guidedGoal === goal.id} onChange={() => { setGuidedGoal(goal.id); requestAnimationFrame(() => guidedActionRef.current?.focus()); }} />
          <span><b>{goal.label}</b><small>{goal.what}</small></span>
        </label>)}
      </fieldset>
      {selectedGoal && <div className="eh-guided-next" aria-live="polite">
        <p><b>What happens:</b> {selectedGoal.what}</p><p><b>What you need:</b> {selectedGoal.need}</p>
        <div><button ref={guidedActionRef} type="button" className="eh-guided-action" onClick={startGuidedSetup}>{matchingDraftExists(selectedGoal) ? `Set up ${selectedGoal.label.toLowerCase()}` : "Set this up"}</button><button type="button" className="eh-guided-cancel" onClick={() => setGuidedGoal("")}>Cancel</button></div>
      </div>}
      <p className="eh-draft-note">Setup changes stay in your draft until you publish. Your existing live setup stays in place while you edit.</p>
    </section>

    <nav className="eh-discovery-paths" aria-label="Other ways to start">
      <button type="button" className="eh-discovery-card" onClick={revealLibrary}><span aria-hidden="true">⌕</span><b>Browse all ideas</b><small>Find a starter by category or search by name.</small></button>
      <button type="button" className="eh-discovery-card" onClick={() => onOpenCanvas?.()}><span aria-hidden="true">＋</span><b>Create my own</b><small>Add and arrange your own interactive elements.</small></button>
      <button type="button" className="eh-discovery-card" onClick={() => onOpenAI?.()}><span aria-hidden="true">✧</span><b>Build with AI</b><small>Use your AI account to create and review a design.</small></button>
    </nav>

    <details className="eh-browse-all" open={browseOpen} onToggle={event => setBrowseOpen(event.currentTarget.open)}>
      <summary>Browse all tools and layouts</summary>
      <p>Explore the full library, curated layouts, canvas, and AI options.</p>
    <section className="eh-setup" aria-label="Choose how to start">
      <button type="button" className={`eh-setup-card eh-setup-layout${layoutPickerOpen ? " active" : ""}`} aria-expanded={layoutPickerOpen} onClick={() => setLayoutPickerOpen(open => !open)}>
        <span className="eh-setup-icon" aria-hidden="true">▦</span><span className="eh-setup-copy"><b>Start with a layout</b><span>Choose one or more curated starter bundles, then customize each piece.</span></span><span className="eh-setup-arrow" aria-hidden="true">{layoutPickerOpen ? "−" : "+"}</span>
      </button>
      <button type="button" className="eh-setup-card" onClick={() => onOpenCanvas?.()}>
        <span className="eh-setup-icon" aria-hidden="true">＋</span><span className="eh-setup-copy"><b>Build from scratch</b><span>Place and customize your own elements on the canvas.</span></span><span className="eh-setup-arrow" aria-hidden="true">↗</span>
      </button>
      <button type="button" className="eh-setup-card" onClick={() => onOpenAI?.()}>
        <span className="eh-setup-icon" aria-hidden="true">✧</span><span className="eh-setup-copy"><b>Build with AI</b><span>Use your own AI account; paste and review a design.</span></span><span className="eh-setup-arrow" aria-hidden="true">↗</span>
      </button>
    </section>

    {layoutPickerOpen && <section className="eh-layout-picker" aria-label="Curated layout bundles">
      <div className="eh-layout-heading"><div><span className="eh-kicker">CURATED STARTING POINTS</span><h2>Choose layouts to add</h2><p>Pick multiple bundles. Each starter is added to your current work for individual editing.</p></div></div>
      <div className="eh-layout-cards">
        {layoutBundles.map(bundle => {
          const selected = selectedBundles.includes(bundle.key);
          return <button type="button" key={bundle.key} className={`eh-layout-card${selected ? " selected" : ""}`} aria-pressed={selected} onClick={() => toggleBundle(bundle.key)}>
            <span className="eh-layout-card-icon" aria-hidden="true">{bundle.icon}</span><span className="eh-layout-card-copy"><b>{bundle.title}</b><span>{bundle.description}</span><small>{bundle.flowKeys.length + bundle.widgetKeys.length} starters</small></span><span className="eh-layout-check" aria-hidden="true">{selected ? "✓" : "+"}</span>
          </button>;
        })}
      </div>
      <div className="eh-layout-actions">
        <span className="eh-layout-count" role="status" aria-live="polite">{selectedBundles.length} {selectedBundles.length === 1 ? "layout" : "layouts"} selected</span>
        {selectedBundles.length > 0 && <button type="button" className="eh-layout-clear" onClick={() => { setSelectedBundles([]); setBundleError(""); }}>Clear selection</button>}
        <button type="button" className="eh-layout-add" disabled={!selectedBundles.length || addingBundles || Boolean(assessment?.error)} onClick={addSelectedBundles}>{addingBundles ? "Adding…" : "Add selected layouts"}</button>
      </div>
      {assessment?.summary && <p className="eh-capacity" role="status">{assessment.summary}</p>}
      {assessment?.error && <p className="eh-layout-error" role="status">{assessment.error}</p>}
      {bundleError && <p className="eh-layout-error" role="alert">{bundleError}</p>}
      <p className="eh-layout-library-hint">Want a single starter instead? Browse the individual starter library below.</p>
    </section>}

    </details>
    <section className="eh-section eh-your-work">
      <div className="eh-section-heading"><div><span className="eh-kicker">PICK UP WHERE YOU LEFT OFF</span><h2>Your experiences</h2></div><button className="eh-text-button" type="button" onClick={() => onOpenAdvanced?.()}>Advanced tools <span>↗</span></button></div>
      {objects.length || flows.length ? <div className="eh-work-list">
        {objects.map((object, i) => <article className="eh-work-item" key={object.id || `object-${i}`}><span className="eh-work-icon">{{heart:"♡",spark:"✦",star:"☆",gift:"◇",info:"i",bolt:"ϟ",message:"☏",link:"↗"}[object.icon] || "✦"}</span><div className="eh-work-copy"><b>{object.title || object.name || "Untitled experience"}</b><span>Saved draft · Viewer interaction</span></div><button type="button" onClick={() => onEditObject?.(object.id)}>Set up {object.title || object.name || "this draft"} <span>↗</span></button></article>)}
        {flows.map((flow, i) => <article className="eh-work-item" key={flow.id || `flow-${i}`}><span className="eh-work-icon eh-work-flow">✧</span><div className="eh-work-copy"><b>{flow.name || flow.title || "Live moment"}</b><span>Saved draft · Live moment{Array.isArray(flow.ruleIds) ? ` · ${flow.ruleIds.length} ${flow.ruleIds.length === 1 ? "rule" : "rules"}` : ""}</span></div><button type="button" onClick={() => onEditFlows?.(flow.id)}>Set up {flow.name || flow.title || "this draft"} <span>↗</span></button></article>)}
      </div> : <div className="eh-empty"><span className="eh-empty-icon">✧</span><div><b>Your experiences will show up here</b><p>Choose an idea above and press Set this up to begin.</p></div><button type="button" onClick={() => onOpenCanvas?.()}>Open scene canvas <span>↗</span></button></div>}
    </section>
    <details className="eh-browse-library" open={libraryOpen} onToggle={event => setLibraryOpen(event.currentTarget.open)}>
      <summary>Browse all ideas</summary>
      <section className="eh-section eh-gallery" aria-labelledby="eh-library-title">
        <div className="eh-section-heading"><div><span className="eh-kicker">START WITH AN IDEA</span><h2 ref={libraryHeadingRef} tabIndex={-1} id="eh-library-title">Explore the full starter library</h2></div><p>Choose a category or search. Select a starter to open its existing setup flow.</p></div>
        <div className="eh-library-tools">
          <label className="eh-search-wrap"><span className="eh-search-icon" aria-hidden="true">⌕</span><span className="eh-visually-hidden">Search all starter ideas</span>
            <input type="search" value={librarySearch} onChange={event => setLibrarySearch(event.target.value)} placeholder="Search all ideas" aria-label="Search all starter ideas" />
          </label>
          <span className="eh-result-count" role="status" aria-live="polite">{libraryResults.length} {libraryResults.length === 1 ? "idea" : "ideas"}</span>
          <div className="eh-category-chips" role="group" aria-label="Filter starter ideas by category">
            {libraryCategories.map(category => <button type="button" key={category} aria-pressed={libraryCategory === category} className={libraryCategory === category ? "active" : ""} onClick={() => setLibraryCategory(category)}>{category}{category !== "All ideas" && <span>{libraryItems.filter(item => item.ideaCategory === category).length}</span>}</button>)}
          </div>
          {(librarySearch || libraryCategory !== "All ideas") && <button type="button" className="eh-reset-filters" onClick={resetLibraryFilters}>Clear filters</button>}
        </div>
        {libraryResults.length === 0 ? <div className="eh-no-results" role="status"><b>No ideas found</b><p>Try another search or category.</p><button type="button" onClick={resetLibraryFilters}>Show all ideas</button></div> : <div className="eh-cards">
          {libraryResults.map((item, index) => <button type="button" className={`eh-card eh-card-${index % 5}`} key={`${item.kind}-${item.key}`} onClick={() => item.kind === "widget" ? onChooseWidget?.(item.key) : onChooseFlow?.(item.key)}>
            <span className={`eh-card-illustration eh-visual eh-visual-${item.key}`} aria-hidden="true"><span className="eh-visual-icon">{item.icon}</span>{item.key === "trivia" && <span className="eh-answer-chips"><i>A</i><i>B</i><i>C</i></span>}{item.key === "tap-challenge" && <span className="eh-goal-meter"><i /></span>}{["merch-carousel", "photo-showcase", "discord-invite"].includes(item.key) && <span className="eh-card-stack"><i /><i /><i /></span>}{["shared-party", "hype-train", "chat-celebration", "subscriber-thanks", "custom-popup", "celebration"].includes(item.key) && <span className="eh-confetti"><i>✦</i><i>•</i><i>✧</i><i>•</i></span>}{["info-card", "clickable-link"].includes(item.key) && <span className="eh-info-lines"><i /><i /><i /></span>}</span>
            <span className="eh-card-content"><span className="eh-card-category">{item.ideaCategory}</span><span className="eh-card-title">{item.title}</span><span className="eh-card-description">{item.description}</span><span className="eh-card-note">{item.note || (item.kind === "flow" ? "Starter" : "Ready to personalize")}</span></span>
            <span className="eh-card-arrow" aria-hidden="true">↗</span>
          </button>)}
        </div>}
      </section>
      <button type="button" className="eh-return-guided" onClick={() => { setLibraryOpen(false); setGuidedGoal(""); }}>Back to guided setup</button>
    </details>

    <footer className="eh-footer"><span>Build at your own pace. You can preview changes before you publish.</span><button type="button" onClick={() => onOpenAdvanced?.()}>More tools <span>↗</span></button></footer>
  </main>;
}

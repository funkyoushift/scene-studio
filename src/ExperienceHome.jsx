import React, { useState } from "react";
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
  { key: "celebration-essentials", title: "Celebration essentials", description: "Thank subscribers and celebrate each Hype Train moment.", flowKeys: ["subscriber-thanks", "hype-train", "hype-progress", "hype-finish"], widgetKeys: [], icon: "✦" },
  { key: "community-corner", title: "Community corner", description: "Help viewers find your community, rules, and schedule.", flowKeys: ["discord-invite", "stream-rules", "stream-schedule"], widgetKeys: [], icon: "◎" },
  { key: "game-night", title: "Game night", description: "Add viewer trivia and a tap challenge, plus a game goals flow.", flowKeys: ["game-goals"], widgetKeys: ["trivia", "tap-challenge"], icon: "⌘" },
  { key: "creator-showcase", title: "Creator showcase", description: "Feature a product carousel and a single highlighted item.", flowKeys: ["merch-carousel", "featured-item"], widgetKeys: [], icon: "▣" },
];

export default function ExperienceHome({ objects = [], flows = [], onChooseWidget, onChooseFlow, onChooseBundle, onEditObject, onEditFlows, onOpenAdvanced, onOpenCanvas, onOpenAI, channelName, live = false, notice, onDismissNotice }) {
  const [activeGroup, setActiveGroup] = useState("Viewer interactions");
  const [liveSearch, setLiveSearch] = useState("");
  const [liveCategory, setLiveCategory] = useState("All categories");
  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false);
  const [selectedBundles, setSelectedBundles] = useState([]);
  const [bundleError, setBundleError] = useState("");
  const [addingBundles, setAddingBundles] = useState(false);
  const groups = [
    { title: "Viewer interactions", description: "Things viewers can open, answer, or tap.", items: INTERACTIVE_PRESET_OPTIONS.map(item => ({ ...item, kind: "widget", category: item.category || "Viewer interaction", note: viewerNotes[item.key] })) },
    { title: "Live moments", description: "Show a response when something happens in chat or on stream.", items: EXPERIENCE_PRESETS.map(item => ({ ...item, kind: "flow", note: "Starter; connection may be required" })) },
  ];
  const liveGroup = groups.find(group => group.title === "Live moments");
  const liveCategories = ["All categories", ...new Set(liveGroup.items.map(item => item.category || "Other"))];
  const normalizedSearch = liveSearch.trim().toLocaleLowerCase();
  const liveResults = liveGroup.items.filter(item => {
    const category = item.category || "Other";
    const matchesCategory = liveCategory === "All categories" || category === liveCategory;
    const searchable = `${item.title} ${item.description} ${category}`.toLocaleLowerCase();
    return matchesCategory && (!normalizedSearch || searchable.includes(normalizedSearch));
  });
  const resetLiveFilters = () => { setLiveSearch(""); setLiveCategory("All categories"); };
  const toggleBundle = key => {
    setBundleError("");
    setSelectedBundles(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  };
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
        <button type="button" className="eh-layout-add" disabled={!selectedBundles.length || addingBundles} onClick={addSelectedBundles}>{addingBundles ? "Adding…" : "Add selected layouts"}</button>
      </div>
      {bundleError && <p className="eh-layout-error" role="alert">{bundleError}</p>}
      <p className="eh-layout-library-hint">Want a single starter instead? Browse the individual starter library below.</p>
    </section>}

    <section className="eh-section eh-your-work">
      <div className="eh-section-heading"><div><span className="eh-kicker">PICK UP WHERE YOU LEFT OFF</span><h2>Your experiences</h2></div><button className="eh-text-button" type="button" onClick={() => onOpenAdvanced?.()}>Advanced tools <span>↗</span></button></div>
      {objects.length || flows.length ? <div className="eh-work-list">
        {objects.map((object, i) => <article className="eh-work-item" key={object.id || `object-${i}`}><span className="eh-work-icon">{{heart:"♡",spark:"✦",star:"☆",gift:"◇",info:"i",bolt:"ϟ",message:"☏",link:"↗"}[object.icon] || "✦"}</span><div className="eh-work-copy"><b>{object.title || object.name || "Untitled experience"}</b><span>Viewer interaction</span></div><button type="button" onClick={() => onEditObject?.(object.id)}>Edit <span>↗</span></button></article>)}
        {flows.map((flow, i) => <article className="eh-work-item" key={flow.id || `flow-${i}`}><span className="eh-work-icon eh-work-flow">✧</span><div className="eh-work-copy"><b>{flow.name || flow.title || "Live moment"}</b><span>Live moment{Array.isArray(flow.ruleIds) ? ` · ${flow.ruleIds.length} ${flow.ruleIds.length === 1 ? "rule" : "rules"}` : ""}</span></div><button type="button" onClick={() => onEditFlows?.(flow.id)}>Edit <span>↗</span></button></article>)}
      </div> : <div className="eh-empty"><span className="eh-empty-icon">✧</span><div><b>Your experiences will show up here</b><p>Choose a starter below to make your first viewer interaction or live moment.</p></div><button type="button" onClick={() => onOpenCanvas?.()}>Open scene canvas <span>↗</span></button></div>}
    </section>

    <section className="eh-section eh-gallery">
      <div className="eh-section-heading"><div><span className="eh-kicker">START WITH AN IDEA</span><h2>Choose something to add</h2></div><p>Every starter is editable. You can change the words and details later.</p></div>
      <div className="eh-tabs" role="tablist" aria-label="Starter categories">
        {groups.map(group => <button type="button" role="tab" aria-selected={activeGroup === group.title} className={activeGroup === group.title ? "active" : ""} key={group.title} onClick={() => setActiveGroup(group.title)}>{group.title}<span>{group.items.length}</span></button>)}
      </div>
      {groups.filter(group => group.title === activeGroup).map(group => <div className="eh-group" key={group.title}>
        <div className="eh-group-heading"><p>{group.description}</p></div>
        {group.title === "Live moments" && <div className="eh-library-tools">
          <label className="eh-search-wrap"><span className="eh-search-icon" aria-hidden="true">⌕</span><span className="eh-visually-hidden">Search live moment starters</span>
            <input type="search" value={liveSearch} onChange={event => setLiveSearch(event.target.value)} placeholder="Search title, description, or category" aria-label="Search live moment starters" />
          </label>
          <span className="eh-result-count" role="status" aria-live="polite">{liveResults.length} {liveResults.length === 1 ? "starter" : "starters"}</span>
          <div className="eh-category-chips" role="group" aria-label="Filter live moments by category">
            {liveCategories.map(category => <button type="button" key={category} aria-pressed={liveCategory === category} className={liveCategory === category ? "active" : ""} onClick={() => setLiveCategory(category)}>{category}{category !== "All categories" && <span>{liveGroup.items.filter(item => (item.category || "Other") === category).length}</span>}</button>)}
          </div>
          {(liveSearch || liveCategory !== "All categories") && <button type="button" className="eh-reset-filters" onClick={resetLiveFilters}>Reset filters</button>}
        </div>}
        {group.title === "Live moments" && liveResults.length === 0 ? <div className="eh-no-results" role="status"><b>No live moment starters found</b><p>Try a different word or category, or reset the filters to browse every starter.</p><button type="button" onClick={resetLiveFilters}>Reset search and category</button></div> : <div className="eh-cards">
          {(group.title === "Live moments" ? liveResults : group.items).map((item, index) => <button type="button" className={`eh-card eh-card-${index % 5}`} key={`${item.kind}-${item.key}`} onClick={() => item.kind === "widget" ? onChooseWidget?.(item.key) : onChooseFlow?.(item.key)}>
            <span className={`eh-card-illustration eh-visual eh-visual-${item.key}`} aria-hidden="true"><span className="eh-visual-icon">{item.icon}</span>{item.key === "trivia" && <span className="eh-answer-chips"><i>A</i><i>B</i><i>C</i></span>}{item.key === "tap-challenge" && <span className="eh-goal-meter"><i /></span>}{["merch-carousel", "photo-showcase", "discord-invite"].includes(item.key) && <span className="eh-card-stack"><i /><i /><i /></span>}{["shared-party", "hype-train", "chat-celebration", "subscriber-thanks", "custom-popup", "celebration"].includes(item.key) && <span className="eh-confetti"><i>✦</i><i>•</i><i>✧</i><i>•</i></span>}{["info-card", "clickable-link"].includes(item.key) && <span className="eh-info-lines"><i /><i /><i /></span>}</span>
            <span className="eh-card-content"><span className="eh-card-category">{item.category || "Viewer interaction"}</span><span className="eh-card-title">{item.title}</span><span className="eh-card-description">{item.description}</span><span className="eh-card-note">{item.note || (item.kind === "flow" ? "Starter" : "Ready to personalize")}</span></span>
            <span className="eh-card-arrow" aria-hidden="true">↗</span>
          </button>)}
        </div>}
      </div>)}
    </section>

    <footer className="eh-footer"><span>Build at your own pace. You can preview changes before you publish.</span><button type="button" onClick={() => onOpenAdvanced?.()}>More tools <span>↗</span></button></footer>
  </main>;
}

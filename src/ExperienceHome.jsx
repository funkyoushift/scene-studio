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

export default function ExperienceHome({ objects = [], flows = [], onChooseWidget, onChooseFlow, onEditObject, onEditFlows, onOpenAdvanced, onOpenCanvas, channelName, live = false }) {
  const [activeGroup, setActiveGroup] = useState("Viewer interactions");
  const groups = [
    { title: "Viewer interactions", description: "Things viewers can open, answer, or tap.", items: INTERACTIVE_PRESET_OPTIONS.map(item => ({ ...item, kind: "widget", note: viewerNotes[item.key] })) },
    { title: "Live moments", description: "Show a response when something happens in chat or on stream.", items: EXPERIENCE_PRESETS.map(item => ({ ...item, kind: "flow", note: "Starter; connection may be required" })) },
  ];

  return <main className="experience-home">
    <header className="eh-topbar">
      <div className="eh-brand"><span className="eh-brand-mark">✦</span><span>Scene Studio</span><span className="eh-brand-label">HOME</span></div>
      <div className="eh-top-actions">
        {channelName && <span className="eh-channel">{channelName}</span>}
        <span className={`eh-live ${live ? "is-live" : ""}`}><i />{live ? "Twitch configuration" : "Local draft"}</span>
        <ThemeToggle />
      </div>
    </header>

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
        <div className="eh-cards">
          {group.items.map((item, index) => <button type="button" className={`eh-card eh-card-${index % 5}`} key={`${item.kind}-${item.key}`} onClick={() => item.kind === "widget" ? onChooseWidget?.(item.key) : onChooseFlow?.(item.key)}>
            <span className={`eh-card-illustration eh-visual eh-visual-${item.key}`} aria-hidden="true"><span className="eh-visual-icon">{item.icon}</span>{item.key === "trivia" && <span className="eh-answer-chips"><i>A</i><i>B</i><i>C</i></span>}{item.key === "tap-challenge" && <span className="eh-goal-meter"><i /></span>}{["merch-carousel", "photo-showcase", "discord-invite"].includes(item.key) && <span className="eh-card-stack"><i /><i /><i /></span>}{["shared-party", "hype-train", "chat-celebration", "subscriber-thanks", "custom-popup", "celebration"].includes(item.key) && <span className="eh-confetti"><i>✦</i><i>•</i><i>✧</i><i>•</i></span>}{["info-card", "clickable-link"].includes(item.key) && <span className="eh-info-lines"><i /><i /><i /></span>}</span>
            <span className="eh-card-content"><span className="eh-card-title">{item.title}</span><span className="eh-card-description">{item.description}</span><span className="eh-card-note">{item.note || (item.kind === "flow" ? "Starter" : "Ready to personalize")}</span></span>
            <span className="eh-card-arrow" aria-hidden="true">↗</span>
          </button>)}
        </div>
      </div>)}
    </section>

    <footer className="eh-footer"><span>Build at your own pace. You can preview changes before you publish.</span><button type="button" onClick={() => onOpenAdvanced?.()}>More tools <span>↗</span></button></footer>
  </main>;
}

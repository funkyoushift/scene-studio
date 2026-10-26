import React, { useMemo, useState } from "react";
import ThemeToggle from "./ThemeToggle.jsx";
import { AUTOMATION_LIMITS, createAutomationPage, addRuleToAutomationPage, addCarouselToAutomationPage, deriveLegacyAutomationPages } from "./live-flows.mjs";
import "./flows.css";

const PAGES = [
  { id: "merch", name: "Merch", icon: "✦", description: "Showcase your collection" },
  { id: "discord", name: "Discord", icon: "◉", description: "Invite your community" },
  { id: "modding", name: "Modding / Borderlands", icon: "⌁", description: "Game moments and mods" },
  { id: "subscribers", name: "Subscribers", icon: "♡", description: "Celebrate your supporters" },
  { id: "hypetrain", name: "Hype Train", icon: "↗", description: "Ride the shared excitement" },
  { id: "gamehud", name: "Persistent Game HUD", icon: "▣", description: "A persistent in-game layout" },
];
const eventLabels = { subscribe: "New subscription", resubscribe: "Resubscription", gift: "Gift subscriptions", hype_begin: "Hype Train starts", hype_progress: "Hype Train progresses", hype_end: "Hype Train ends" };
const triggerTitle = (rule) => rule.trigger.type === "keyword" ? `Chat says “${rule.trigger.phrase}”` : rule.trigger.type === "interval" ? `Every ${rule.trigger.everySeconds} seconds` : rule.trigger.type === "twitch" ? eventLabels[rule.trigger.event] || "Twitch event" : `Event: ${rule.trigger.event}`;

function belongs(rule, page, carousels) {
  if (rule.effect.type === "carousel") {
    const title = carousels.find((c) => c.id === rule.effect.carouselId)?.title.toLowerCase() || "";
    if (/merch|collection|store/.test(title)) return "merch";
    if (/discord|community/.test(title)) return "discord";
    if (/borderlands|mod|game/.test(title)) return "modding";
  }
  if (rule.trigger.type === "twitch" && rule.trigger.event.startsWith("hype_")) return "hypetrain";
  if (rule.trigger.type === "twitch" && ["subscribe", "resubscribe", "gift"].includes(rule.trigger.event)) return "subscribers";
  if (/merch/i.test(rule.name) || (rule.trigger.type === "keyword" && /merch|shirt|store/i.test(rule.trigger.phrase))) return "merch";
  if (/discord/i.test(rule.name) || (rule.trigger.type === "keyword" && /discord/i.test(rule.trigger.phrase))) return "discord";
  if (/borderlands|modding|game/i.test(rule.name)) return "modding";
  return "other-workflows";
}

function withFlowPages(design) {
  let next = design;
  if (!next.pages) {
    const legacy = deriveLegacyAutomationPages(design);
    next = { ...design, pages: [] };
    if (!design.rules.length && !design.carousels.length) {
      for (const page of PAGES) next = createAutomationPage(next, { id: page.id, name: page.name });
      return next;
    }
    const assignedRules = new Set();
    for (const legacyPage of legacy) {
      const firstRule = design.rules.find(rule => legacyPage.ruleIds.includes(rule.id));
      const firstCarousel = design.carousels.find(carousel => legacyPage.carouselIds.includes(carousel.id));
      const target = firstRule ? belongs(firstRule, "", design.carousels) : firstCarousel ? belongs({ name: firstCarousel.title, trigger: {}, effect: { type: "carousel", carouselId: firstCarousel.id } }, "", design.carousels) : "other-workflows";
      const isOtherGroup = target === "other-workflows" && (!firstRule && !firstCarousel || /^other( workflows)?$/i.test(legacyPage.name));
      const canUseStarterId = PAGES.some(page => page.id === target) && !next.pages.some(page => page.id === target);
      const pageId = canUseStarterId ? target : isOtherGroup && !next.pages.some(page => page.id === "other-workflows") ? "other-workflows" : legacyPage.id;
      const pageName = pageId === "other-workflows" ? "Other workflows" : legacyPage.name;
      if (!next.pages.some(page => page.id === pageId)) next = createAutomationPage(next, { id: pageId, name: pageName });
      for (const ruleId of legacyPage.ruleIds) { next = addRuleToAutomationPage(next, pageId, ruleId); assignedRules.add(ruleId); }
      for (const carouselId of legacyPage.carouselIds) next = addCarouselToAutomationPage(next, pageId, carouselId);
    }
    for (const rule of design.rules) if (!assignedRules.has(rule.id)) {
      if (!next.pages.some(page => page.id === "other-workflows")) next = createAutomationPage(next, { id: "other-workflows", name: "Other workflows" });
      next = addRuleToAutomationPage(next, "other-workflows", rule.id);
    }
    // Keep uncategorized carousels available on Other workflows without changing their content.
    const linkedCarousels = new Set(next.pages.flatMap(page => page.carouselIds));
    for (const carousel of design.carousels) if (!linkedCarousels.has(carousel.id)) {
      if (!next.pages.some(page => page.id === "other-workflows")) next = createAutomationPage(next, { id: "other-workflows", name: "Other workflows" });
      next = addCarouselToAutomationPage(next, "other-workflows", carousel.id);
    }
  }
  return next;
}

function CarouselLook({ carousel, onUpdateCarousel, onOpenDetails }) {
  const first = carousel.slides[0];
  const layout = carousel.layout || { x: 5, y: 5, width: 30, height: 30, layer: 0 };
  const update = patch => onUpdateCarousel(carousel.id, patch);
  const setLayout = patch => update({ layout: { ...layout, ...patch } });
  const setSlide = patch => update({ slides: carousel.slides.map(s => s.id === first?.id ? { ...s, ...patch } : s) });
  return <section className="flow-carousel-look" aria-label={`${carousel.title} content and layout`}>
    <header><b>{carousel.title}</b><button className="flow-secondary" onClick={() => onOpenDetails?.("carousels", carousel.id)}>Edit popup images &amp; links ↗</button></header>
    <div className="flow-carousel-fields">
      <label>CAROUSEL TITLE<input aria-label="Carousel title" maxLength={80} value={carousel.title} onChange={e => update({ title: e.target.value })}/></label>
      {first && <><label>FIRST ITEM TITLE<input aria-label="First popup item title" maxLength={70} value={first.title} onChange={e => setSlide({ title: e.target.value })}/></label><label className="flow-caption-field">FIRST ITEM CAPTION<input aria-label="First popup item caption" maxLength={100} value={first.caption} onChange={e => setSlide({ caption: e.target.value })}/></label><label className="flow-caption-field">POPUP LINK (OPTIONAL)<input aria-label="Popup website link" type="url" maxLength={1000} placeholder="https://…" value={first.url || ""} onChange={e => setSlide({ url: e.target.value })}/><small>Use the same store link requirements shown in the advanced editor.</small></label></>}
    </div>
    <div className="flow-layout-controls"><b>Layout &amp; layer</b><p>Position and size use a 100% canvas; layer controls drawing order.</p><div>{[["X", "x", 0, Math.min(90, 100 - layout.width)], ["Y", "y", 0, Math.min(90, 100 - layout.height)], ["Width", "width", 10, Math.min(80, 100 - layout.x)], ["Height", "height", 10, Math.min(80, 100 - layout.y)], ["Layer", "layer", 0, 100]].map(([label, key, min, max]) => <label key={key}>{label}<input aria-label={`${carousel.title} ${label}`} type="number" min={min} max={max} value={layout[key]} onChange={e => setLayout({ [key]: Math.max(min, Math.min(max, Number(e.target.value) || 0)) })}/></label>)}</div></div>
  </section>;
}

export default function FlowBuilder({ design, setDesign, onUpdateCarousel, evaluate, onOpenDetails }) {
  const [selected, setSelected] = useState("merch");
  const [step, setStep] = useState(0);
  const [newPageName, setNewPageName] = useState("");
  const [pageNotice, setPageNotice] = useState("");
  const pagesDesign = useMemo(() => withFlowPages(design), [design]);
  const customPages = (pagesDesign.pages || []).filter(page => !PAGES.some(starter => starter.id === page.id)).map(page => ({ ...page, icon: "◇", description: "Custom viewer flow" }));
  const allPages = [...PAGES, ...customPages];
  const groups = useMemo(() => Object.fromEntries(allPages.map((p) => {
    const meta = pagesDesign.pages?.find(page => page.id === p.id);
    return [p.id, (meta?.ruleIds || []).flatMap(id => pagesDesign.rules.filter(rule => rule.id === id))];
  })), [pagesDesign]);
  const pageMeta = pagesDesign.pages?.find(p => p.id === selected);
  const page = allPages.find((p) => p.id === selected) || PAGES[0];
  const pageAvailable = Boolean(pageMeta) || (pagesDesign.pages?.length || 0) < AUTOMATION_LIMITS.pages;
  const rules = groups[selected] || [];
  const carouselIds = [...new Set([...(pageMeta?.carouselIds || []), ...rules.flatMap(r => r.effect.type === "carousel" ? [r.effect.carouselId] : r.effect.type === "choose" ? r.effect.options.filter(o => o.type === "carousel").map(o => o.carouselId) : [])])];
  const associated = design.carousels.filter(c => carouselIds.includes(c.id));
  const ensureCurrentPage = d => { let ready = withFlowPages(d); if (!ready.pages?.some(p => p.id === selected)) ready = createAutomationPage(ready, { id: selected, name: page.name }); return ready; };
  const changeRule = (id, patch) => setDesign(d => { let ready = ensureCurrentPage(d); ready = { ...ready, rules: ready.rules.map(r => r.id === id ? { ...r, ...patch } : r) }; const effect = patch.effect; const carouselIds = effect?.type === "carousel" ? [effect.carouselId] : effect?.type === "choose" ? effect.options.filter(o => o.type === "carousel").map(o => o.carouselId) : []; for (const carouselId of carouselIds) ready = addCarouselToAutomationPage(ready, selected, carouselId); return ready; });
  const createRule = () => {
    if (design.rules.length >= AUTOMATION_LIMITS.rules) { setPageNotice(`This design has reached its ${AUTOMATION_LIMITS.rules}-flow limit.`); return; }
    const makePopup = ["discord", "modding"].includes(selected) && associated.length === 0;
    if (makePopup && design.carousels.length >= AUTOMATION_LIMITS.carousels) { setPageNotice(`This design has reached its ${AUTOMATION_LIMITS.carousels}-carousel limit. Link an existing carousel to this page first.`); return; }
    try {
      const id = `flow-${selected}-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
      const phrase = selected === "discord" ? "discord" : selected === "modding" ? "borderlands" : selected === "merch" ? "merch" : selected === "gamehud" ? "game" : page.name.toLowerCase();
      const trigger = selected === "hypetrain" ? { type: "twitch", event: "hype_begin" } : selected === "subscribers" ? { type: "twitch", event: "subscribe" } : { type: "keyword", phrase, match: "word" };
      let next = ensureCurrentPage(design);
      let carouselId = associated[0]?.id;
      if (makePopup) {
        carouselId = `content-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
        const isDiscord = selected === "discord";
        const title = isDiscord ? "Join our Discord" : "Borderlands & modding";
        next = { ...next, carousels: [...next.carousels, { id: carouselId, title, displaySeconds: 10, slides: [{ id: `item-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`, title, caption: isDiscord ? "Join the community. Add your invite link below." : "Borderlands mods and game moments. Add a link below if useful.", image: "", url: "" }] }] };
      }
      let effect = carouselId ? { type: "carousel", carouselId } : { type: "celebrate", message: `A moment for ${page.name}!` };
      if (selected === "subscribers") effect = { type: "celebrate", message: "Thanks, {subscriber}!" };
      if (selected === "hypetrain") effect = { type: "celebrate", message: "Level {hypeLevel} Hype Train! Join the celebration!" };
      next = { ...next, rules: [...next.rules, { id, name: `${pageMeta?.name || page.name} moment`, enabled: true, trigger, effect, cooldownSeconds: 20 }] };
      next = addRuleToAutomationPage(next, selected, id);
      if (carouselId) next = addCarouselToAutomationPage(next, selected, carouselId);
      setDesign(next);
      setPageNotice("");
      if (makePopup) setStep(2);
    } catch (error) { setPageNotice(error.message); }
  };
  const addCustomPage = () => {
    const name = newPageName.trim();
    if (!name) { setPageNotice("Enter a name for the new page."); return; }
    const id = `custom-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    try {
      const next = createAutomationPage(withFlowPages(design), { id, name });
      setDesign(next);
      setSelected(id); setStep(0); setNewPageName(""); setPageNotice("");
    } catch (error) { setPageNotice(error.message); }
  };
  const renamePage = value => {
    if (pageMeta) setDesign(d => { const ready = withFlowPages(d); return { ...ready, pages: ready.pages.map(p => p.id === selected ? { ...p, name: value } : p) }; });
    else if (pageAvailable) setDesign(createAutomationPage(withFlowPages(design), { id: selected, name: value.trim() || page.name }));
  };
  const selectTrigger = (rule, value) => {
    const trigger = value === "keyword" ? { type: "keyword", phrase: "hello", match: "word" } : value === "interval" ? { type: "interval", everySeconds: 300 } : value === "hype" ? { type: "twitch", event: "hype_begin" } : value === "subscribe" || value === "twitch" ? { type: "twitch", event: "subscribe" } : value === "external" ? { type: "external", event: "boss_defeated" } : { type: "interval", everySeconds: 300 };
    changeRule(rule.id, { trigger });
  };
  return <div className="flow-builder">
    <header className="flow-head"><div><span className="flow-kicker">AUTOMATION STUDIO</span><h1>Live action builder</h1><p>Shape a stream moment, one simple flow at a time.</p></div><div className="flow-head-actions"><span className="flow-live-pill"><i /> Your draft</span><ThemeToggle /></div></header>
    <div className="flow-layout">
      <aside className="flow-sidebar"><div className="flow-sidebar-title"><span>YOUR FLOWS</span><span>{pagesDesign.pages?.length || 0}</span></div>{allPages.map(p => <button key={p.id} className={`flow-page ${selected === p.id ? "selected" : ""}`} onClick={() => { setSelected(p.id); setStep(0); setPageNotice(""); }}><span className="flow-page-icon">{p.icon}</span><span className="flow-page-label"><b>{pageMeta?.id === p.id ? pageMeta.name : p.name}</b><small>{groups[p.id]?.length || 0} flows{pageMeta?.id === p.id && !PAGES.some(starter => starter.id === p.id) ? " · custom" : ""}</small></span><span className="flow-chevron">›</span></button>)}
        <form className="flow-add-page" onSubmit={e => { e.preventDefault(); addCustomPage(); }}><label htmlFor="flow-new-page">ADD A CUSTOM PAGE</label><div><input id="flow-new-page" value={newPageName} maxLength={60} disabled={(pagesDesign.pages?.length || 0) >= AUTOMATION_LIMITS.pages} onChange={e => setNewPageName(e.target.value)} placeholder="Page name"/><button type="submit" disabled={(pagesDesign.pages?.length || 0) >= AUTOMATION_LIMITS.pages} aria-label="Add custom page">＋</button></div>{pageNotice && <p role="status">{pageNotice}</p>}{(pagesDesign.pages?.length || 0) >= AUTOMATION_LIMITS.pages && <p role="status">This design has reached its 12-page limit.</p>}</form>
        <div className="flow-sidebar-note"><b>Persistent Game HUD</b><p>Connector not connected. Layout references and data feed setup are available in advanced settings.</p></div></aside>
      <section className="flow-workspace"><div className="flow-title-row"><div><div className="flow-breadcrumb">MY FLOWS <span>/</span> {(pageMeta?.name || page.name).toUpperCase()}</div><label className="flow-page-name-label">PAGE NAME<input className="flow-page-name" aria-label="Selected page name" maxLength={60} value={pageMeta?.name || page.name} disabled={!pageMeta && !pageAvailable} onChange={e => { try { renamePage(e.target.value); setPageNotice(""); } catch (error) { setPageNotice(error.message); } }}/></label><p>{page.description}. Build the trigger, choose what happens, then preview.</p></div><button className="flow-secondary" onClick={() => onOpenDetails?.("carousels")}>Open popup images &amp; links ↗</button></div>
        <nav className="flow-steps" aria-label="Flow builder steps">{["When", "Do", "Look", "Try"].map((label, i) => <button key={label} className={step === i ? "active" : ""} onClick={() => setStep(i)}><span>{String(i + 1).padStart(2, "0")}</span>{label}</button>)}</nav>
        {selected === "gamehud" && <div className="flow-callout"><span>▣</span><div><b>Game HUD connector not connected</b><p>This flow does not read game memory or load data from a local or internet source. Connect a supported feed in advanced setup before enabling a live HUD.</p></div><button onClick={() => onOpenDetails?.("rules")}>Advanced setup</button></div>}
        {(selected === "subscribers" || selected === "hypetrain") && <p className="flow-hint">Personalized fields {selected === "subscribers" ? <code>{"{subscriber}"}</code> : <code>{"{hypeLevel}"}</code>} use sample values in preview. Live values depend on the event context being available.</p>}
        <div className="flow-cards">
          {rules.length === 0 && <div className="flow-empty"><div className="flow-empty-icon">{page.icon}</div><h3>Start with a simple flow</h3><p>Add a trigger and decide what your viewers will see. Existing content can be chosen in the next step.</p><button className="flow-primary" disabled={!pageAvailable} onClick={createRule}>＋ Create a flow</button>{!pageAvailable && <p role="status">This design has reached its 12-page limit. Select an existing page to add a flow.</p>}</div>}
          {rules.map((r, index) => <article className={`flow-card ${r.enabled ? "" : "muted"}`} key={r.id}><header><span className="flow-card-number">{String(index + 1).padStart(2, "0")}</span><div className="flow-card-heading"><h3>{r.name}</h3><p>{triggerTitle(r)} <span>→</span> {r.effect.type === "carousel" ? design.carousels.find(c => c.id === r.effect.carouselId)?.title || "Show content" : r.effect.type === "choose" ? `${r.effect.mode} choice` : "Celebrate"}</p></div><label className="flow-switch"><input type="checkbox" checked={r.enabled} onChange={e => changeRule(r.id, { enabled: e.target.checked })}/><span/><em>{r.enabled ? "On" : "Off"}</em></label></header>
            {step === 0 && <div className="flow-card-content"><label>WHEN DOES IT HAPPEN?<select value={r.trigger.type === "twitch" ? (r.trigger.event.startsWith("hype_") ? "hype" : "subscribe") : r.trigger.type} onChange={e => selectTrigger(r, e.target.value)}><option value="keyword">A viewer says a word in chat</option><option value="twitch">Twitch event (advanced)</option><option value="subscribe">A viewer subscribes</option><option value="hype">A Hype Train event</option><option value="interval">On a timer</option><option value="external">A game or service event</option></select></label>{r.trigger.type === "keyword" && <div className="flow-inline"><label>WORD OR PHRASE<input value={r.trigger.phrase} maxLength={80} onChange={e => changeRule(r.id, { trigger: { ...r.trigger, phrase: e.target.value } })}/></label><label>MATCH<select value={r.trigger.match} onChange={e => changeRule(r.id, { trigger: { ...r.trigger, match: e.target.value } })}><option value="word">Whole word</option><option value="contains">Contains</option></select></label></div>}{r.trigger.type === "twitch" && <label>TWITCH EVENT<select value={r.trigger.event} onChange={e => changeRule(r.id, { trigger: { ...r.trigger, event: e.target.value } })}>{Object.entries(eventLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}{r.trigger.type === "interval" && <label>SECONDS BETWEEN MOMENTS<input type="number" min="5" max="3600" value={r.trigger.everySeconds} onChange={e => changeRule(r.id, { trigger: { ...r.trigger, everySeconds: Math.max(5, Math.min(3600, Number(e.target.value) || 5)) } })}/></label>}</div>}
            {step === 1 && <div className="flow-card-content"><label>WHAT SHOULD HAPPEN?<select value={r.effect.type} onChange={e => { const type = e.target.value; const effect = type === "carousel" && design.carousels[0] ? { type, carouselId: design.carousels[0].id } : type === "choose" ? { type, mode: "rotate", options: [...design.carousels.slice(0, 1).map(c => ({ type: "carousel", carouselId: c.id })), { type: "celebrate", message: "A moment for the stream!" }] } : { type: "celebrate", message: "A moment for the stream!" }; changeRule(r.id, { effect }); }}><option value="celebrate">Show a celebration message</option><option value="carousel" disabled={!design.carousels.length}>Show a content carousel</option><option value="choose">Choose between carousel and celebration</option></select></label>{r.effect.type === "celebrate" ? <label>MESSAGE<input maxLength={160} value={r.effect.message} onChange={e => changeRule(r.id, { effect: { ...r.effect, message: e.target.value } })}/></label> : r.effect.type === "carousel" ? <label>CHOOSE CONTENT<select value={r.effect.carouselId} onChange={e => changeRule(r.id, { effect: { ...r.effect, carouselId: e.target.value } })}>{design.carousels.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label> : <div className="flow-choice"><label>HOW TO CHOOSE<select value={r.effect.mode} onChange={e => changeRule(r.id, { effect: { ...r.effect, mode: e.target.value } })}><option value="rotate">Rotate through choices</option><option value="random">Pick a random choice</option></select></label><div className="flow-options-label">INCLUDE EXISTING CONTENT</div>{design.carousels.map(c => { const has = r.effect.options.some(o => o.type === "carousel" && o.carouselId === c.id); return <label className="flow-option-check" key={c.id}><input type="checkbox" checked={has} disabled={!has && r.effect.options.length >= 6} onChange={e => { const options = e.target.checked ? [...r.effect.options, { type: "carousel", carouselId: c.id }] : r.effect.options.filter(o => !(o.type === "carousel" && o.carouselId === c.id)); changeRule(r.id, { effect: { ...r.effect, options } }); }}/>{c.title}</label>; })}{(() => { const messageOption = r.effect.options.find(o => o.type === "celebrate"); return <><label className="flow-option-check"><input type="checkbox" checked={!!messageOption} disabled={!messageOption && r.effect.options.length >= 6} onChange={e => { const options = e.target.checked ? [...r.effect.options, { type: "celebrate", message: "A moment for the stream!" }] : r.effect.options.filter(o => o.type !== "celebrate"); changeRule(r.id, { effect: { ...r.effect, options } }); }}/>Celebration message</label>{messageOption && <label>CELEBRATION TEXT<input maxLength={160} value={messageOption.message} onChange={e => changeRule(r.id, { effect: { ...r.effect, options: r.effect.options.map(o => o.type === "celebrate" ? { ...o, message: e.target.value } : o) } })}/></label>}</>; })()}</div>}<label>COOLDOWN IN SECONDS<input type="number" min="0" max="3600" value={r.cooldownSeconds} onChange={e => changeRule(r.id, { cooldownSeconds: Math.max(0, Math.min(3600, Number(e.target.value) || 0)) })}/></label></div>}
            {step === 2 && <>
              <div className="flow-look"><div><span className="flow-look-icon">{r.effect.type === "carousel" || r.effect.type === "choose" ? "▧" : "✦"}</span><div><b>{r.effect.type === "carousel" ? design.carousels.find(c => c.id === r.effect.carouselId)?.title || "Content carousel" : r.effect.type === "choose" ? `${r.effect.mode === "random" ? "Random" : "Rotating"} choice` : r.effect.message}</b><p>{r.effect.type === "carousel" || r.effect.type === "choose" ? "Uses existing carousel content and its current display settings." : "Celebration popup using the existing viewer effect."}</p></div></div><button className="flow-secondary" onClick={() => onOpenDetails?.(r.effect.type === "carousel" || r.effect.type === "choose" ? "carousels" : "rules")}>Edit appearance &amp; content ↗</button></div>
              {carouselIds.map(id => design.carousels.find(c => c.id === id)).filter(Boolean).map(carousel => <CarouselLook key={carousel.id} carousel={carousel} onUpdateCarousel={onUpdateCarousel} onOpenDetails={onOpenDetails}/>) }
            </>}
            {step === 3 && <div className="flow-test"><div><b>Try this flow safely</b><p>Tests the saved design in this preview. It will not send a chat message or create a real Twitch event. Timer flows test when the preview timer is due.</p></div><button className="flow-primary" onClick={() => r.trigger.type === "keyword" ? evaluate?.({ type: "message", text: r.trigger.phrase }) : r.trigger.type === "twitch" ? evaluate?.({ type: "twitch", event: r.trigger.event, id: `flow-preview-${Date.now()}`, context: r.trigger.event.startsWith("hype_") ? { hypeLevel: 3 } : { subscriber: "Sample viewer" } }) : r.trigger.type === "external" ? evaluate?.({ type: "external", name: r.trigger.event }) : evaluate?.({ type: "tick" })}>▶ Preview this flow</button></div>}
          </article>)}
          {rules.length > 0 && <button className="flow-add" disabled={design.rules.length >= AUTOMATION_LIMITS.rules} title={design.rules.length >= AUTOMATION_LIMITS.rules ? `Maximum ${AUTOMATION_LIMITS.rules} flows` : "Add a flow"} onClick={createRule}>＋ Add another flow</button>}
        </div>
        <footer className="flow-footer"><span>Changes stay in your draft until you save or publish.</span><button className="flow-advanced" onClick={() => onOpenDetails?.("rules")}>Advanced editor <span>↗</span></button></footer>
      </section>
    </div>
  </div>;
}

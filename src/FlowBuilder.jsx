import React, { useEffect, useMemo, useRef, useState } from "react";
import ThemeToggle from "./ThemeToggle.jsx";
import PopupPlacement from "./PopupPlacement.jsx";
import { AUTOMATION_LIMITS, deriveLegacyAutomationPages } from "./live-flows.mjs";
import { EXPERIENCE_PRESETS, addExperiencePreset, removeExperience } from "./experience-presets.mjs";
import { prepareImage } from "./images.mjs";
import "./flows.css";

const eventLabels = { subscribe: "New subscription", resubscribe: "Resubscription", gift: "Gift subscriptions", hype_begin: "Hype Train starts", hype_progress: "Hype Train progresses", hype_end: "Hype Train ends" };
const uid = prefix => `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
const actualPages = design => design.pages ?? deriveLegacyAutomationPages(design);
const triggerTitle = trigger => trigger.type === "keyword" ? `Chat says “${trigger.phrase}”` : trigger.type === "interval" ? `Every ${trigger.everySeconds} seconds` : trigger.type === "twitch" ? eventLabels[trigger.event] || "Twitch event" : `External event: ${trigger.event}`;

export default function FlowBuilder({ design, setDesign, onUpdateCarousel, evaluate, onOpenDetails, requestedPageId, onBack, merchDeclarations = {}, onDeclareMerch }) {
  const lastValidPages = useRef([]);
  const pageState = useMemo(() => {
    try {
      const valid = actualPages(design);
      lastValidPages.current = valid;
      return { pages: valid, error: "" };
    } catch (error) {
      return { pages: lastValidPages.current, error: error.message };
    }
  }, [design]);
  const pages = pageState.pages;
  const [selectedId, setSelectedId] = useState(() => requestedPageId || pages[0]?.id || "");
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [expandedSlide, setExpandedSlide] = useState({ carouselId: "", slideId: "" });
  const [removed, setRemoved] = useState(null);
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState("");
  const [presetKey, setPresetKey] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [pageNameDraft, setPageNameDraft] = useState("");
  const lastRequestedPageId = useRef(null);
  useEffect(() => {
    if (requestedPageId !== lastRequestedPageId.current) {
      lastRequestedPageId.current = requestedPageId;
      if (requestedPageId && pages.some(page => page.id === requestedPageId)) setSelectedId(requestedPageId);
    }
    if (!pages.some(page => page.id === selectedId)) setSelectedId(pages[0]?.id || "");
  }, [requestedPageId, pages, selectedId]);

  const page = pages.find(item => item.id === selectedId);
  useEffect(() => setPageNameDraft(page?.name || ""), [page?.id, page?.name]);
  const rules = page ? (page.ruleIds || []).map(id => design.rules.find(rule => rule.id === id)).filter(Boolean) : [];
  const carousels = page ? [...new Set([...(page.carouselIds || []), ...rules.flatMap(rule => rule.effect.type === "carousel" ? [rule.effect.carouselId] : rule.effect.type === "choose" ? rule.effect.options.filter(option => option.type === "carousel").map(option => option.carouselId) : [])])].map(id => design.carousels.find(item => item.id === id)).filter(Boolean) : [];
  const primaryRule = rules.find(rule => rule.id === selectedRuleId) || rules[0];
  const carousel = primaryRule?.effect.type === "carousel" ? design.carousels.find(item => item.id === primaryRule.effect.carouselId) : primaryRule?.effect.type === "choose" ? carousels[0] : carousels[0];
  const carouselLayout = carousel?.layout || { x: 58, y: 5, width: 39, height: 80, layer: 0 };
  useEffect(() => {
    if (!carousel) { setExpandedSlide({ carouselId: "", slideId: "" }); return; }
    setExpandedSlide(current => current.carouselId === carousel.id && carousel.slides.some(slide => slide.id === current.slideId)
      ? current : { carouselId: carousel.id, slideId: carousel.slides[0]?.id || "" });
  }, [carousel?.id, carousel?.slides]);

  const patchRule = (ruleId, patch) => setDesign(current => ({ ...current, rules: current.rules.map(rule => rule.id === ruleId ? { ...rule, ...patch } : rule) }));
  const patchTrigger = patch => primaryRule && patchRule(primaryRule.id, { trigger: { ...primaryRule.trigger, ...patch } });
  const patchEffect = patch => primaryRule && patchRule(primaryRule.id, { effect: { ...primaryRule.effect, ...patch } });
  const replaceEffect = effect => primaryRule && patchRule(primaryRule.id, { effect });
  const patchCarousel = (id, patch) => onUpdateCarousel?.(id, patch);
  const addPreset = key => {
    try {
      const result = addExperiencePreset(design, key);
      setDesign(result.design); setSelectedId(result.pageId); setPresetKey(""); setNotice("");
    } catch (error) { setNotice(error.message); }
  };
  const removeCurrent = () => {
    try {
      const next = removeExperience(design, page.id);
      setRemoved({ before: design, after: JSON.stringify(next), pageId: page.id });
      setDesign(next); setNotice("Experience removed from this draft. Undo is available until your next edit.");
    } catch (error) { setNotice(error.message); }
  };
  const changeTriggerType = type => {
    if (!primaryRule) return;
    const trigger = type === "keyword" ? { type, phrase: "hello", match: "word" } : type === "interval" ? { type, everySeconds: 300 } : type === "twitch" ? { type, event: "subscribe" } : { type: "external", event: "event_name" };
    patchRule(primaryRule.id, { trigger });
  };
  const addSlide = () => {
    if (!carousel || carousel.slides.length >= AUTOMATION_LIMITS.slides) return;
    const slide = { id: uid("slide"), title: "New item", caption: "Add a short description.", image: "", url: "" };
    patchCarousel(carousel.id, { slides: [...carousel.slides, slide] });
    setExpandedSlide({ carouselId: carousel.id, slideId: slide.id });
  };
  const updateSlide = (slideId, patch) => carousel && patchCarousel(carousel.id, { slides: carousel.slides.map(slide => slide.id === slideId ? { ...slide, ...patch } : slide) });
  const removeSlide = slideId => {
    if (!carousel || carousel.slides.length <= 1) return;
    patchCarousel(carousel.id, { slides: carousel.slides.filter(slide => slide.id !== slideId) });
  };
  const upload = async (slideId, file) => {
    if (!file) return;
    const carouselId = carousel?.id;
    if (!carouselId) return;
    setUploading(slideId); setNotice("");
    try {
      const image = await prepareImage(file);
      setDesign(current => ({ ...current, carousels: current.carousels.map(item => item.id === carouselId
        ? { ...item, slides: item.slides.map(slide => slide.id === slideId ? { ...slide, image } : slide) } : item) }));
    }
    catch (error) { setNotice(error.message); }
    finally { setUploading(""); }
  };
  const test = () => {
    if (!primaryRule) return;
    const trigger = primaryRule.trigger;
    evaluate?.(trigger.type === "keyword" ? { type: "message", text: trigger.phrase } : trigger.type === "twitch" ? { type: "twitch", event: trigger.event, id: `experience-preview-${Date.now()}`, context: trigger.event.startsWith("hype_") ? { hypeLevel: 3 } : { subscriber: "Sample viewer" } } : trigger.type === "external" ? { type: "external", name: trigger.event } : { type: "tick" }, primaryRule.id);
  };

  return <main className="flow-builder">
    <header className="flow-head"><div><span className="flow-kicker">AUTOMATION STUDIO</span><h1>Experiences</h1><p>Build a complete viewer interaction, then try it in the preview.</p></div><div className="flow-head-actions">{onBack && <button className="flow-secondary" onClick={onBack}>← Experience library</button>}<ThemeToggle /></div></header>
    {!pages.length ? <section className="flow-starter"><div><span className="flow-kicker">START WITH AN EXPERIENCE</span><h2>What do you want viewers to experience?</h2><p>Choose a starting point. You can edit its trigger, content, appearance, and cooldown together.</p></div><div className="flow-preset-grid">{EXPERIENCE_PRESETS.map(preset => <button className="flow-preset" key={preset.key} onClick={() => addPreset(preset.key)}><span className="flow-page-icon">{preset.icon}</span><span><b>{preset.title}</b><small>{preset.description}</small><em>{preset.category}</em></span><strong>＋</strong></button>)}</div>{(notice || pageState.error) && <p className="flow-notice" role="status">{notice || `This draft is temporarily incomplete: ${pageState.error}`}</p>}</section> : <div className="flow-layout">
      <aside className="flow-sidebar"><div className="flow-sidebar-title"><span>YOUR EXPERIENCES</span><span>{pages.length}</span></div>{pages.map(item => <button key={item.id} className={`flow-page ${selectedId === item.id ? "selected" : ""}`} onClick={() => { setSelectedId(item.id); setNotice(""); }}><span className="flow-page-icon">◇</span><span className="flow-page-label"><b>{item.name}</b><small>{item.ruleIds.length} {item.ruleIds.length === 1 ? "rule" : "rules"}</small></span><span className="flow-chevron">›</span></button>)}
        <div className="flow-add-experience"><label htmlFor="flow-preset">ADD AN EXPERIENCE</label><select id="flow-preset" value={presetKey} onChange={event => { setPresetKey(event.target.value); if (event.target.value) addPreset(event.target.value); }}><option value="">Choose a starting point…</option>{EXPERIENCE_PRESETS.map(preset => <option key={preset.key} value={preset.key}>{preset.title}</option>)}</select><small>{pages.length}/{AUTOMATION_LIMITS.pages} experiences · {design.rules.length}/{AUTOMATION_LIMITS.rules} rules</small></div>
        <div className="flow-sidebar-note"><button className="flow-secondary" onClick={() => setAdvanced(value => !value)}>{advanced ? "Hide advanced options" : "Advanced effects"}</button>{advanced && <p>Choose and rotate between existing carousels or celebration messages using the effect controls below.</p>}</div>
      </aside>
      {page && <section className="flow-workspace"><div className="flow-title-row"><div><div className="flow-breadcrumb">EXPERIENCES <span>/</span> {page.name.toUpperCase()}</div><label className="flow-experience-name">EXPERIENCE NAME<input maxLength={60} value={pageNameDraft} onChange={event => { const value = event.target.value; setPageNameDraft(value); if (value.trim()) setDesign(current => ({ ...current, pages: pages.map(item => item.id === page.id ? { ...item, name: value } : item) })); }} onBlur={() => { if (!pageNameDraft.trim()) setPageNameDraft(page.name); }}/></label><p>{primaryRule ? `${triggerTitle(primaryRule.trigger)} → ${primaryRule.effect.type === "celebrate" ? "Celebration" : primaryRule.effect.type === "choose" ? "Choose an effect" : design.carousels.find(item => item.id === primaryRule.effect.carouselId)?.title || "Content"}` : "This experience has no assigned rules yet."}</p></div><div className="flow-title-actions">{primaryRule && <button className="flow-primary" onClick={test}>▶ Test</button>}<button className="flow-secondary" onClick={() => onOpenDetails?.("rules")}>Advanced rules ↗</button><button className="flow-secondary" onClick={removeCurrent}>Remove experience</button></div></div>
        {(notice || pageState.error) && <p className="flow-notice" role="status">{notice || `This draft is temporarily incomplete: ${pageState.error}`}</p>}
        {primaryRule ? <>
          {rules.length > 1 && <label className="flow-rule-select">RULE IN THIS EXPERIENCE<select value={primaryRule.id} onChange={event => setSelectedRuleId(event.target.value)}>{rules.map(rule => <option key={rule.id} value={rule.id}>{rule.name}</option>)}</select><small>All rules in this experience can be edited here.</small></label>}
          <div className="flow-editor-grid">
            <section className="flow-panel"><header><span>01</span><div><h3>When</h3><p>Choose what starts this experience.</p></div><label className="flow-switch"><input type="checkbox" checked={primaryRule.enabled} onChange={event => patchRule(primaryRule.id, { enabled: event.target.checked })}/><span/><em>{primaryRule.enabled ? "On" : "Off"}</em></label></header>
              <div className="flow-fields"><label>TRIGGER<select value={primaryRule.trigger.type} onChange={event => changeTriggerType(event.target.value)}><option value="keyword">Chat keyword</option><option value="twitch">Twitch event</option><option value="interval">Timer</option><option value="external">External event</option></select></label>
                {primaryRule.trigger.type === "keyword" && <><label>WORD OR PHRASE<input maxLength={80} value={primaryRule.trigger.phrase} onChange={event => patchTrigger({ phrase: event.target.value })}/></label><label>MATCH<select value={primaryRule.trigger.match} onChange={event => patchTrigger({ match: event.target.value })}><option value="word">Whole word</option><option value="contains">Contains</option></select></label></>}
                {primaryRule.trigger.type === "twitch" && <label>TWITCH EVENT<select value={primaryRule.trigger.event} onChange={event => patchTrigger({ event: event.target.value })}>{Object.entries(eventLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
                {primaryRule.trigger.type === "interval" && <label>SECONDS BETWEEN MOMENTS<input type="number" min={AUTOMATION_LIMITS.everySeconds[0]} max={AUTOMATION_LIMITS.everySeconds[1]} value={primaryRule.trigger.everySeconds} onChange={event => patchTrigger({ everySeconds: Math.min(AUTOMATION_LIMITS.everySeconds[1], Math.max(AUTOMATION_LIMITS.everySeconds[0], Number(event.target.value) || AUTOMATION_LIMITS.everySeconds[0])) })}/></label>}
                {primaryRule.trigger.type === "external" && <label>EVENT NAME<input maxLength={64} pattern="[A-Za-z][A-Za-z0-9._-]*" value={primaryRule.trigger.event} onChange={event => patchTrigger({ event: event.target.value })}/></label>}
                <label>COOLDOWN IN SECONDS<input type="number" min={AUTOMATION_LIMITS.cooldownSeconds[0]} max={AUTOMATION_LIMITS.cooldownSeconds[1]} value={primaryRule.cooldownSeconds} onChange={event => patchRule(primaryRule.id, { cooldownSeconds: Math.min(AUTOMATION_LIMITS.cooldownSeconds[1], Math.max(0, Number(event.target.value) || 0)) })}/><small>Wait this long before the same rule can trigger again.</small></label>
              </div>
            </section>
            <section className="flow-panel"><header><span>02</span><div><h3>Content</h3><p>Edit what viewers see.</p></div></header>
              <div className="flow-fields"><label>WHAT VIEWERS SEE<select value={primaryRule.effect.type} onChange={event => { const type = event.target.value; if (type === "carousel") replaceEffect({ type, carouselId: design.carousels[0].id }); else if (type === "choose") replaceEffect({ type, mode: "rotate", options: [{ type: "celebrate", message: "A moment for the stream!" }] }); else replaceEffect({ type: "celebrate", message: "A moment for the stream!" }); }}><option value="carousel" disabled={!design.carousels.length}>Content carousel</option><option value="celebrate">Celebration message</option><option value="choose">Choose between effects (advanced)</option></select></label>
                {primaryRule.effect.type === "carousel" && <><label>CONTENT SET<select value={primaryRule.effect.carouselId} onChange={event => patchEffect({ carouselId: event.target.value })}>{design.carousels.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>{carousel && <><label>CAROUSEL TITLE<input maxLength={80} value={carousel.title} onChange={event => patchCarousel(carousel.id, { title: event.target.value })}/></label><label>DISPLAY DURATION (SECONDS)<input type="number" min={AUTOMATION_LIMITS.displaySeconds[0]} max={AUTOMATION_LIMITS.displaySeconds[1]} value={carousel.displaySeconds} onChange={event => patchCarousel(carousel.id, { displaySeconds: Math.max(AUTOMATION_LIMITS.displaySeconds[0], Math.min(AUTOMATION_LIMITS.displaySeconds[1], Number(event.target.value) || AUTOMATION_LIMITS.displaySeconds[0])) })}/></label>
                    {carousel.slides.some(slide => slide.url) && <div className="flow-link-requirements"><p>Links work in preview. Live destinations must be permitted for your channel; entering a link does not grant Twitch approval.</p><label><input type="checkbox" checked={merchDeclarations[carousel.id] === true} onChange={event => onDeclareMerch?.(carousel.id, event.target.checked)}/>Any merchandise here is my own branded merch, with no sponsor sales or affiliate links.</label></div>}
                    <div className="flow-slides"><div className="flow-slides-head"><b>SLIDES</b><span>{carousel.slides.length}/{AUTOMATION_LIMITS.slides}</span></div>{carousel.slides.map((slide, index) => { const isOpen = expandedSlide.carouselId === carousel.id && expandedSlide.slideId === slide.id; return <article className={`flow-slide ${isOpen ? "open" : ""}`} key={slide.id}><div className="flow-slide-title"><b>Slide {index + 1} · {slide.title || "Untitled"}</b><div><button className="flow-remove" type="button" onClick={() => setExpandedSlide({ carouselId: carousel.id, slideId: isOpen ? "" : slide.id })}>{isOpen ? "Done" : "Edit"}</button><button className="flow-remove" type="button" disabled={carousel.slides.length <= 1} onClick={() => removeSlide(slide.id)}>Remove</button></div></div>{isOpen && <><label>TITLE<input maxLength={70} value={slide.title} onChange={event => updateSlide(slide.id, { title: event.target.value })}/></label><label>CAPTION<input maxLength={100} value={slide.caption} onChange={event => updateSlide(slide.id, { caption: event.target.value })}/></label><label>LINK (OPTIONAL)<input type="url" maxLength={1000} placeholder="https://…" value={slide.url || ""} onChange={event => updateSlide(slide.id, { url: event.target.value })}/></label><label>IMAGE<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading === slide.id} onChange={event => upload(slide.id, event.target.files?.[0])}/><small>{uploading === slide.id ? "Preparing image…" : slide.image ? "Image added · choose a file to replace it" : "Optional · PNG, JPEG, WebP, or GIF up to 10 MB. Animated GIFs become still images."}</small></label>{slide.image && <img className="flow-slide-image" src={slide.image} alt="Slide preview"/>}</>}</article>; })}<button className="flow-add-slide" type="button" disabled={carousel.slides.length >= AUTOMATION_LIMITS.slides} onClick={addSlide}>＋ Add slide</button></div></>}</>}
                {primaryRule.effect.type === "celebrate" && <label>MESSAGE<input maxLength={160} value={primaryRule.effect.message} onChange={event => patchEffect({ message: event.target.value })}/></label>}
                {primaryRule.effect.type === "choose" && <div className="flow-choice"><label>HOW TO CHOOSE<select value={primaryRule.effect.mode} onChange={event => patchEffect({ mode: event.target.value })}><option value="rotate">Rotate</option><option value="random">Random</option></select></label><span className="flow-options-label">INCLUDE EXISTING CONTENT</span>{design.carousels.map(item => { const checked = primaryRule.effect.options.some(option => option.type === "carousel" && option.carouselId === item.id); return <label className="flow-option-check" key={item.id}><input type="checkbox" checked={checked} disabled={!checked && primaryRule.effect.options.length >= AUTOMATION_LIMITS.chooseOptions} onChange={event => patchEffect({ options: event.target.checked ? [...primaryRule.effect.options, { type: "carousel", carouselId: item.id }] : primaryRule.effect.options.filter(option => !(option.type === "carousel" && option.carouselId === item.id)) })}/>{item.title}</label>; })}{(() => { const celebration = primaryRule.effect.options.find(option => option.type === "celebrate"); return <><label className="flow-option-check"><input type="checkbox" checked={!!celebration} disabled={!celebration && primaryRule.effect.options.length >= AUTOMATION_LIMITS.chooseOptions} onChange={event => patchEffect({ options: event.target.checked ? [...primaryRule.effect.options, { type: "celebrate", message: "A moment for the stream!" }] : primaryRule.effect.options.filter(option => option.type !== "celebrate") })}/>Celebration message</label>{celebration && <label>CELEBRATION TEXT<input maxLength={160} value={celebration.message} onChange={event => patchEffect({ options: primaryRule.effect.options.map(option => option.type === "celebrate" ? { ...option, message: event.target.value } : option) })}/></label>}</>; })()}</div>}
              </div>
            </section>
            <section className="flow-panel flow-appearance"><header><span>03</span><div><h3>Appearance</h3><p>Choose how the experience is placed on the stream.</p></div></header><div className="flow-fields">{carousel && <PopupPlacement carousel={carousel} onChange={layout => patchCarousel(carousel.id, { layout })}/>}
{carousel && <div className="flow-layout-controls"><b>Layout &amp; layer</b><p>Position and size use a 100% canvas.</p><div>{[["X", "x", 0, Math.min(90, 100 - carouselLayout.width)], ["Y", "y", 0, Math.min(90, 100 - carouselLayout.height)], ["Width", "width", 10, Math.min(80, 100 - carouselLayout.x)], ["Height", "height", 10, Math.min(80, 100 - carouselLayout.y)], ["Layer", "layer", 0, 100]].map(([label, key, min, max]) => <label key={key}>{label}<input type="number" min={min} max={max} value={carouselLayout[key]} onChange={event => patchCarousel(carousel.id, { layout: { ...carouselLayout, [key]: Math.max(min, Math.min(max, Number(event.target.value) || 0)) } })}/></label>)}</div></div>}<p className="flow-preview-note">Testing evaluates a sample event and opens the local preview. Results appear there after rendering.</p><button className="flow-secondary" onClick={() => onOpenDetails?.("carousels", carousel?.id)}>More appearance settings ↗</button></div></section>
          </div>
          <section className="flow-test-panel"><div><span className="flow-kicker">04 · TEST</span><h3>Try this experience</h3><p>This sends a sample event to the existing local preview only. Cooldown is {primaryRule.cooldownSeconds} seconds.</p></div><button className="flow-primary" onClick={test}>▶ Test in preview</button></section>
          {rules.length > 1 && <button className="flow-secondary flow-advanced-link" onClick={() => onOpenDetails?.("rules")}>Edit all {rules.length} rules in the advanced editor ↗</button>}
        </> : <div className="flow-empty"><h3>No rule in this experience</h3><p>Add a starter experience from the sidebar, or manage this page’s rules in the advanced editor.</p><button className="flow-secondary" onClick={() => onOpenDetails?.("rules")}>Open advanced rules ↗</button></div>}
      </section>}
    </div>}
    {removed && <p className="flow-notice">Experience removed. <button className="flow-secondary" disabled={JSON.stringify(design) !== removed.after} onClick={() => { setDesign(removed.before); setSelectedId(removed.pageId); setRemoved(null); setNotice("Experience restored."); }}>Undo removal</button></p>}
    <footer className="flow-footer"><span>Changes stay in your draft until you save or publish.</span><button className="flow-advanced" onClick={() => onOpenDetails?.("rules")}>Advanced editor <span>↗</span></button></footer>
  </main>;
}

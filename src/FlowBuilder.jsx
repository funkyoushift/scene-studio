import React, { useEffect, useMemo, useRef, useState } from "react";
import ThemeToggle from "./ThemeToggle.jsx";
import { ShoutoutTriggerControls, ShoutoutCardControls } from "./ShoutoutControls.jsx";
import PopupPlacement from "./PopupPlacement.jsx";
import { AUTOMATION_LIMITS, deriveLegacyAutomationPages } from "./live-flows.mjs";
import { CELEBRATION_SOUNDS } from "./automations.mjs";
import { EXPERIENCE_PRESETS, addExperiencePreset, removeExperience, hypeTrainEffect } from "./experience-presets.mjs";
import { createCelebrationPlayer } from "./celebration-audio.mjs";
import { prepareImage } from "./images.mjs";
import { prepareSound } from "./sounds.mjs";
import "./flows.css";

const eventLabels = { subscribe: "New subscription", resubscribe: "Resubscription", gift: "Gift subscriptions", hype_begin: "Hype Train starts", hype_progress: "Hype Train progresses", hype_end: "Hype Train ends" };
const uid = prefix => `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
const actualPages = design => design.pages ?? deriveLegacyAutomationPages(design);
const triggerTitle = trigger => trigger.type === "shoutout" ? trigger.mode === "command" ? "Moderator !so command" : trigger.mode === "automatic" ? "First chat message" : "First chat message or !so" : trigger.type === "keyword" ? `Chat says “${trigger.phrase}”` : trigger.type === "interval" ? `Every ${trigger.everySeconds} seconds` : trigger.type === "twitch" ? eventLabels[trigger.event] || "Twitch event" : `External event: ${trigger.event}`;
const celebrationDefaults = { style: "confetti", color: "#a3e635", durationSeconds: 8 };
const celebrationSoundLabels = { chime: "Chime", arcade: "Arcade", fanfare: "Fanfare", bell: "Bell", space: "Space", train: "Train whistle & wheels" };
const celebrationStyles = [
  { value: "confetti", title: "Confetti cannon", detail: "A bright burst of celebration", icon: "✦" },
  { value: "spotlight", title: "Subscriber spotlight", detail: "A focused moment in the spotlight", icon: "◉" },
  { value: "hype-train", title: "Steam train", detail: "Locomotive, carriages, steam & turning wheels", icon: "🚂" },
  { value: "hearts", title: "Hearts", detail: "A warm note of appreciation", icon: "♥" },
  { value: "starfall", title: "Starfall", detail: "A wishful shower of stars", icon: "✧" },
  { value: "fireworks", title: "Fireworks", detail: "A vivid, sky-wide burst", icon: "✺" },
  { value: "bubbles", title: "Bubbles", detail: "A light, playful moment", icon: "◌" },
  { value: "meteor", title: "Meteor", detail: "A fast, bright entrance", icon: "☄" },
  { value: "aurora", title: "Aurora", detail: "A calm wave of color", icon: "≋" },
  { value: "arcade", title: "Arcade bonus", detail: "A playful bonus-round feel", icon: "▣" },
  { value: "petals", title: "Falling petals", detail: "A gentle moment in bloom", icon: "❀" },
  { value: "orbit", title: "Orbit", detail: "A cosmic moment around the message", icon: "◎" },
];

function suggestedMessages(trigger) {
  if (trigger.type !== "twitch") return [
    { label: "Warm welcome", text: "Thanks for being here, chat!" },
    { label: "Opt-in support note", text: "If you’re enjoying the stream, you’re welcome to subscribe whenever you like." },
  ];
  if (trigger.event === "subscribe") return [
    { label: "Thank them", text: "Thanks, {subscriber}! We’re glad you’re here." },
    { label: "Welcome them", text: "Welcome in, {subscriber}! Make yourself at home." },
  ];
  if (trigger.event === "resubscribe") return [
    { label: "Thank them again", text: "Welcome back, {subscriber}! Thanks for continuing to support the stream." },
    { label: "Appreciate their support", text: "Thanks for another month, {subscriber}! It means a lot to have you here." },
  ];
  if (trigger.event === "gift") return [
    { label: "Thank the gifter", text: "Thank you for sharing a gift subscription with the community!" },
    { label: "Celebrate the gift", text: "A gift subscription just made someone’s day—thank you!" },
  ];
  if (trigger.event === "hype_begin") return [
    { label: "Welcome the train", text: "Level {hypeLevel} — the Hype Train is here! All aboard!" },
    { label: "Invite the moment", text: "The Hype Train has arrived at level {hypeLevel}. Enjoy the ride, chat!" },
  ];
  if (trigger.event === "hype_progress") return [
    { label: "Hype Train update", text: "Level {hypeLevel} — keep the Hype Train rolling!" },
    { label: "Celebrate progress", text: "We’ve reached Hype Train level {hypeLevel}. What a ride!" },
  ];
  if (trigger.event === "hype_end") return [
    { label: "Thank chat", text: "The Hype Train reached level {hypeLevel}. Thanks for riding together!" },
    { label: "Close the moment", text: "Thanks for bringing the energy to Hype Train level {hypeLevel}, chat!" },
  ];
  return [{ label: "Warm welcome", text: "Thanks for being here, chat!" }];
}

function MessageSuggestions({ trigger, onSelect }) {
  const suggestions = suggestedMessages(trigger);
  const tokens = [...new Set(suggestions.flatMap(item => [...item.text.matchAll(/\{(subscriber|hypeLevel)\}/g)].map(match => match[0])))];
  return <div className="flow-message-suggestions"><span>MESSAGE STARTERS</span><div>{suggestions.map(item => <button type="button" key={item.label} onClick={() => onSelect(item.text)}>{item.label}</button>)}</div><small>Select a starter to replace the current message.{tokens.length > 0 && <> Twitch fills in these placeholders for you: {tokens.map((token, index) => <React.Fragment key={token}>{index > 0 ? ", " : ""}<code>{token}</code></React.Fragment>)}.</>}</small></div>;
}

function CelebrationAppearance({ effect, onChange, idPrefix, onApplySound }) {
  const samplePlayer = useRef(null);
  const fileInput = useRef(null);
  const [preparing, setPreparing] = useState(false);
  const [fullTrack, setFullTrack] = useState(effect.appearance?.sound?.playback === "hype-loop");
  const [sampleStatus, setSampleStatus] = useState("");
  useEffect(() => () => { void samplePlayer.current?.dispose(); samplePlayer.current = null; }, []);
  const appearance = { ...celebrationDefaults, ...(effect.appearance || {}) };
  const update = patch => {
    const next = { ...appearance, ...patch };
    if (next.style !== "hype-train") delete next.hypeLifecycle;
    onChange({ ...effect, appearance: next });
  };
  const sound = effect.appearance?.sound;
  const chooseSound = preset => {
    if (preset === "none") {
      if (!sound) return;
      const nextAppearance = { ...effect.appearance };
      delete nextAppearance.sound;
      onChange({ ...effect, appearance: nextAppearance });
      return;
    }
    update({ sound: { preset, volume: sound?.volume ?? 70 } });
  };
  return <div className="flow-celebration-appearance">
    <details className="flow-animation-picker"><summary>{celebrationStyles.find(style => style.value === appearance.style)?.icon} {celebrationStyles.find(style => style.value === appearance.style)?.title} · Change animation</summary>
    <div className="flow-celebration-styles" role="radiogroup" aria-label="Celebration style">
      {celebrationStyles.map(style => <label className={`flow-celebration-style ${appearance.style === style.value ? "selected" : ""}`} style={{ "--flow-celebration-color": appearance.color }} key={style.value}>
        <input type="radio" name={`${idPrefix}-style`} value={style.value} checked={appearance.style === style.value} onChange={() => update({ style: style.value })}/>
        <span className={`flow-celebration-icon flow-celebration-icon-${style.value}`} aria-hidden="true"><i>{style.icon}</i></span>
        <span className="flow-celebration-style-copy"><b>{style.title}</b><small>{style.detail}</small></span>
      </label>)}
    </div></details>
    <div className="flow-celebration-tuning">
      <label>ACCENT COLOR<input type="color" value={appearance.color} onChange={event => update({ color: event.target.value })}/><small>Choose the celebration’s highlight color.</small></label>
      {appearance.hypeLifecycle ? <p>Follows the whole Hype Train: live level, progress, countdown, then a 12-second thank-you. Twitch controls the timer.</p> : <label>DURATION · {appearance.durationSeconds} SECONDS<input type="range" min="4" max="20" step="1" value={appearance.durationSeconds} onChange={event => update({ durationSeconds: Number(event.target.value) })}/><small>How long the celebration stays on screen.</small></label>}
    </div>
    <div className="flow-celebration-sound">
      {appearance.hypeLifecycle && <label>PLAYBACK<select value={fullTrack ? "music" : "short"} onChange={event => {
        const music = event.target.value === "music"; setFullTrack(music);
        if (sound?.preset === "upload") { const next = { ...sound }; if (music) next.playback = "hype-loop"; else delete next.playback; update({ sound: next }); }
      }}><option value="short">Short event sound</option><option value="music">Background music · loop for the whole train</option></select><small>Music keeps playing through level changes and stops when the train ends. Viewers must enable sound.</small></label>}
      <label>SOUND<select value={sound?.preset || "none"} onChange={event => chooseSound(event.target.value)}><option value="none">None · silent</option>{sound?.preset === "upload" && <option value="upload">My uploaded sound</option>}{CELEBRATION_SOUNDS.map(preset => <option key={preset} value={preset}>{celebrationSoundLabels[preset] || preset}</option>)}</select></label>
      <div className="flow-upload-sound"><strong>{sound?.preset === "upload" ? sound.name : "Use your own sound"}</strong><p>{fullTrack ? "Choose a full MP3, up to 1.5 MB and 5 minutes. It loops while the train is active. Upload once, then apply it to all train events below." : "Choose an MP3 or WAV, up to 10 MB. We use its first 15 seconds. It uploads when you publish."}</p><button type="button" className="flow-secondary" disabled={preparing} onClick={() => fileInput.current?.click()}>{preparing ? "Preparing sound…" : sound?.preset === "upload" ? "Replace sound file" : "Choose sound file"}</button><input hidden ref={fileInput} type="file" accept={fullTrack ? ".mp3,audio/mpeg" : ".mp3,.wav,audio/mpeg,audio/wav"} aria-label="Upload celebration sound" disabled={preparing} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        setPreparing(true); setSampleStatus(""); samplePlayer.current?.stop();
        try { const prepared = await prepareSound(file, { fullTrack }); update({ sound: { preset: "upload", url: prepared.url, name: prepared.name, volume: sound?.volume ?? 70, ...(fullTrack ? { playback: "hype-loop" } : {}) } }); setSampleStatus(`${prepared.name} ready${prepared.trimmed ? " · trimmed to 15 seconds" : ""}. Press Hear sound to check it.`); }
        catch (error) { setSampleStatus(error.message); }
        finally { setPreparing(false); }
      }}/></div>
      {sound && <label>EVENT VOLUME · {sound.volume}%<input type="range" min="0" max="300" step="1" value={sound.volume} onChange={event => { const volume = Number(event.target.value); samplePlayer.current?.setEventVolume(volume); update({ sound: { ...sound, volume } }); }}/><small>100% is the original level; up to 300% boosts quiet sounds. Adjust while the preview plays. Lower it if the sound distorts.</small></label>}
      {sound && <button type="button" className="flow-secondary" onClick={async () => {
        try {
          samplePlayer.current ??= createCelebrationPlayer();
          await samplePlayer.current.unlock(); samplePlayer.current.stop();
          const played = await samplePlayer.current.playSound(sound, 100);
          setSampleStatus(played ? `Playing ${sound.name || celebrationSoundLabels[sound.preset]}.` : "Sound could not play. Check the file and choose a volume above zero.");
        } catch (error) { setSampleStatus(error.message); }
      }}>▶ Hear sound</button>}
      {sound && <button type="button" className="flow-secondary" onClick={() => { samplePlayer.current?.stop(); chooseSound("none"); setSampleStatus("Sound removed. This event is silent."); }}>Remove sound</button>}
      {sound && onApplySound && <button type="button" className="flow-secondary" onClick={() => onApplySound(sound)}>Use this sound for all events in this experience</button>}
      {sampleStatus && <small role="status">{sampleStatus}</small>}
      <small className="flow-celebration-sound-note">Viewers start muted. Enable celebration sound in the preview to listen.</small>
    </div>
  </div>;
}

export default function FlowBuilder({ design, setDesign, onUpdateCarousel, evaluate, onOpenDetails, requestedPageId, onBack, merchDeclarations = {}, onDeclareMerch, onPreviewHype, onSave, onExport, liveEditor = false, saveDisabled = false }) {
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
  const [setupStep, setSetupStep] = useState("when");
  const guideHeading = useRef(null);
  useEffect(() => { const frame = requestAnimationFrame(() => { guideHeading.current?.focus({ preventScroll: true }); guideHeading.current?.scrollIntoView({ block: "start" }); }); return () => cancelAnimationFrame(frame); }, [setupStep, selectedId]);
  useEffect(() => setSetupStep("when"), [selectedId]);
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
  const useTrainTheme = () => {
    const ids = new Set(rules.filter(rule => rule.trigger.type === "twitch" && ["hype_begin", "hype_progress", "hype_end"].includes(rule.trigger.event)).map(rule => rule.id));
    setDesign(current => ({ ...current, rules: current.rules.map(rule => ids.has(rule.id) ? { ...rule, effect: { ...hypeTrainEffect(rule.trigger.event), ...(rule.effect.type === "celebrate" ? { message: rule.effect.message } : {}) } } : rule) }));
    setNotice("Train animation applied to this experience’s Hype Train events. Your carousel content is still saved. Test the draft, then publish when ready.");
  };
  const applySound = sound => {
    const ids = new Set(rules.map(rule => rule.id));
    const apply = effect => effect.type === "celebrate" ? { ...effect, appearance: { ...celebrationDefaults, ...effect.appearance, sound: { ...sound } } } : effect;
    setDesign(current => ({ ...current, rules: current.rules.map(rule => ids.has(rule.id) ? { ...rule, effect: rule.effect.type === "choose" ? { ...rule.effect, options: rule.effect.options.map(apply) } : apply(rule.effect) } : rule) }));
    setNotice("Sound applied to every celebration in this experience. Preview it, then publish when ready.");
  };
  const setupSteps = [{ id: "when", label: "Choose when" }, { id: "content", label: "Make it yours" }, ...(carousel && primaryRule?.effect.type !== "celebrate" ? [{ id: "place", label: "Screen position" }] : []), { id: "finish", label: "Try it & finish" }];
  const activeStep = setupSteps.some(item => item.id === setupStep) ? setupStep : "content";
  const stepIndex = setupSteps.findIndex(item => item.id === activeStep);
  const trigger = primaryRule?.trigger;
  const isTrain = trigger?.type === "twitch" && trigger.event.startsWith("hype_");
  const whenCopy = trigger?.type === "keyword" ? `When someone writes “${trigger.phrase || "your word"}” in chat, this popup will appear. Choose the word below; we have filled in a starting suggestion.` : trigger?.type === "twitch" ? isTrain ? "Twitch starts this automatically when a Hype Train begins. The preset follows its levels, progress and countdown, then thanks chat when it ends. Keep this default to celebrate the whole train." : `Twitch starts this automatically for a ${eventLabels[trigger.event]?.toLowerCase()}. Keep this event to use the preset. You do not need to type a command.` : trigger?.type === "interval" ? "This appears regularly while your channel is live. Choose how many seconds to wait between appearances." : trigger?.type === "shoutout" ? "Choose who gets a shoutout. Automatic welcomes happen when a person first chats during a live stream; moderators can also use !so @username." : "Your game or service will start this by sending the event name below. This option requires a developer connection.";
  const contentCopy = primaryRule?.effect.type === "carousel" ? "Open the first card below. Replace its sample title and description, add an image if you want, and enter its destination link. Add more cards only if you want them to rotate." : primaryRule?.effect.type === "shoutout" ? "Write your greeting. Their name, profile picture and channel link are filled in automatically when a real shoutout happens." : isTrain ? "Start with the train animation already chosen. Edit the message, then optionally choose a sound or upload your own. You can keep the default colors." : "Write the message viewers should see. Then choose an animation and, if you want, a sound. You can keep the preset and go straight to the preview.";
  const guideCopy = activeStep === "when" ? { title: "What should start this?", text: whenCopy, next: "Happy with when it starts? Continue to make the popup yours." } : activeStep === "content" ? { title: "What should viewers see?", text: contentCopy, next: carousel ? "Once the content is yours, choose where it appears." : "Ready to see it? Continue to try a sample event." } : activeStep === "place" ? { title: "Where should it appear?", text: "Drag the popup to a clear part of the sample screen. Resize it using its handles. Avoid covering your face camera or important gameplay.", next: "The position is saved in your draft. Next, try it as a viewer." } : { title: "Try it before it goes live", text: "Press Preview this event. Check the words, image, size and sound. Close the preview to come back here and change anything that feels wrong.", next: "Previewing is a rehearsal; it does not send anything to your channel." };

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
    if (primaryRule.effect.appearance?.hypeLifecycle) { onPreviewHype?.(primaryRule.effect); return; }
    const trigger = primaryRule.trigger;
    if (trigger.type === "shoutout") { evaluate?.({ type: "shoutout", mode: trigger.mode === "command" ? "command" : "automatic", id: crypto.randomUUID(), ruleId: primaryRule.id, profile: { id: "123456", login: "sample_creator", displayName: "Sample Creator", image: "", type: "affiliate" } }, primaryRule.id); return; }
    evaluate?.(trigger.type === "keyword" ? { type: "message", text: trigger.phrase } : trigger.type === "twitch" ? { type: "twitch", event: trigger.event, id: `experience-preview-${Date.now()}`, context: trigger.event.startsWith("hype_") ? { hypeLevel: 3 } : { subscriber: "Sample viewer" } } : trigger.type === "external" ? { type: "external", name: trigger.event } : { type: "tick" }, primaryRule.id);
  };

  return <main className={`flow-builder${advanced ? "" : " flow-simple"}`}>
    <header className="flow-head"><div><span className="flow-kicker">AUTOMATION STUDIO</span><h1>Let’s set this up</h1><p>One step at a time. The preset gives you a starting point; change only what you need.</p></div><div className="flow-head-actions">{onBack && <button className="flow-secondary" onClick={onBack}>← Experience library</button>}<button type="button" className="flow-secondary" onClick={() => setAdvanced(value => !value)}>{advanced ? "Return to guided setup" : "Show all settings"}</button><ThemeToggle /></div></header>
    {!pages.length ? <section className="flow-starter"><div><span className="flow-kicker">START WITH AN EXPERIENCE</span><h2>What do you want viewers to experience?</h2><p>Choose a starting point. You can edit its trigger, content, appearance, and cooldown together.</p></div><div className="flow-preset-grid">{EXPERIENCE_PRESETS.map(preset => <button className="flow-preset" key={preset.key} onClick={() => addPreset(preset.key)}><span className="flow-page-icon">{preset.icon}</span><span><b>{preset.title}</b><small>{preset.description}</small><em>{preset.category}</em></span><strong>＋</strong></button>)}</div>{(notice || pageState.error) && <p className="flow-notice" role="status">{notice || `This draft is temporarily incomplete: ${pageState.error}`}</p>}</section> : <div className="flow-layout">
      <aside className="flow-sidebar"><div className="flow-sidebar-title"><span>YOUR EXPERIENCES</span><span>{pages.length}</span></div>{pages.map(item => <button key={item.id} className={`flow-page ${selectedId === item.id ? "selected" : ""}`} onClick={() => { setSelectedId(item.id); setNotice(""); }}><span className="flow-page-icon">◇</span><span className="flow-page-label"><b>{item.name}</b><small>{item.ruleIds.length} {item.ruleIds.length === 1 ? "rule" : "rules"}</small></span><span className="flow-chevron">›</span></button>)}
        <div className="flow-add-experience"><label htmlFor="flow-preset">ADD AN EXPERIENCE</label><select id="flow-preset" value={presetKey} onChange={event => { setPresetKey(event.target.value); if (event.target.value) addPreset(event.target.value); }}><option value="">Choose a starting point…</option>{EXPERIENCE_PRESETS.map(preset => <option key={preset.key} value={preset.key}>{preset.title}</option>)}</select><small>{pages.length}/{AUTOMATION_LIMITS.pages} experiences · {design.rules.length}/{AUTOMATION_LIMITS.rules} rules</small></div>
        <div className="flow-sidebar-note"><button className="flow-secondary" onClick={() => setAdvanced(value => !value)}>{advanced ? "Hide advanced options" : "Advanced effects"}</button>{advanced && <p>Choose and rotate between existing carousels or celebration messages using the effect controls below.</p>}</div>
      </aside>
      {page && <section className="flow-workspace"><div className="flow-title-row"><div><div className="flow-breadcrumb">EXPERIENCES <span>/</span> {page.name.toUpperCase()}</div><label hidden={!advanced} className="flow-experience-name">EXPERIENCE NAME<input maxLength={60} value={pageNameDraft} onChange={event => { const value = event.target.value; setPageNameDraft(value); if (value.trim()) setDesign(current => ({ ...current, pages: pages.map(item => item.id === page.id ? { ...item, name: value } : item) })); }} onBlur={() => { if (!pageNameDraft.trim()) setPageNameDraft(page.name); }}/></label><p>{primaryRule ? `${triggerTitle(primaryRule.trigger)} → ${primaryRule.effect.type === "shoutout" ? "Creator shoutout card" : primaryRule.effect.type === "celebrate" ? "Celebration" : primaryRule.effect.type === "choose" ? "Choose an effect" : design.carousels.find(item => item.id === primaryRule.effect.carouselId)?.title || "Content"}` : "This experience has no assigned rules yet."}</p></div><div hidden={!advanced} className="flow-title-actions">{primaryRule && <button className="flow-primary" onClick={test}>▶ Test</button>}<button className="flow-secondary" onClick={() => onOpenDetails?.("rules")}>Advanced rules ↗</button><button className="flow-secondary" onClick={removeCurrent}>Remove experience</button></div></div>
        {(notice || pageState.error) && <p className="flow-notice" role="status">{notice || `This draft is temporarily incomplete: ${pageState.error}`}</p>}
        {primaryRule ? <>
          <section className="flow-coach" aria-label="Your next step"><span>STEP {stepIndex + 1} OF {setupSteps.length} · {page.name}</span><h2 ref={guideHeading} tabIndex={-1}>{guideCopy.title}</h2><p>{guideCopy.text}</p>{activeStep === "when" && <small>{trigger.type === "keyword" || trigger.type === "shoutout" ? "Live use needs your channel’s chat connection. You can design and preview first." : trigger.type === "twitch" ? "Live use needs the matching Twitch event connection. You can preview without a real subscription or Hype Train." : "This stays a draft until you publish it."}</small>}</section>
          {rules.length > 1 && (advanced || activeStep === "content") && <div className="flow-event-picker"><b>{isTrain ? "Customize the start, progress or finish" : "Choose the moment to customize"}</b><p>{isTrain ? "Start with the train’s arrival below. The progress and finish already have defaults; select them only if you want to change their messages or sound." : "Each moment has its own defaults. Select one to change it."}</p><div>{rules.map(rule => <button type="button" key={rule.id} aria-pressed={primaryRule.id === rule.id} onClick={() => setSelectedRuleId(rule.id)}>{triggerTitle(rule.trigger)}<small>{rule.enabled ? "On" : "Off"}</small></button>)}</div></div>}
          <nav className="flow-setup-steps" aria-label="Experience setup steps">{setupSteps.map((step, index) => <button type="button" key={step.id} aria-current={activeStep === step.id ? "step" : undefined} onClick={() => setSetupStep(step.id)}><span>{index + 1}</span>{step.label}</button>)}</nav>
          <div className="flow-editor-grid flow-guided-grid">
            <section hidden={activeStep !== "when"} className="flow-panel"><header><span>01</span><div><h3>{advanced ? "When" : "Recommended start"}</h3><p>{advanced ? "Choose what starts this experience." : triggerTitle(primaryRule.trigger)}</p></div><label hidden={!advanced} className="flow-switch"><input type="checkbox" checked={primaryRule.enabled} onChange={event => patchRule(primaryRule.id, { enabled: event.target.checked })}/><span/><em>{primaryRule.enabled ? "On" : "Off"}</em></label></header>
              {primaryRule.trigger.type === "shoutout" && <ShoutoutTriggerControls key={primaryRule.id} trigger={primaryRule.trigger} onChange={patchTrigger}/>}
              <div className="flow-fields"><label hidden={!advanced || primaryRule.trigger.type === "shoutout"}>TRIGGER<select value={primaryRule.trigger.type} onChange={event => changeTriggerType(event.target.value)}><option value="keyword">Chat keyword</option><option value="twitch">Twitch event</option><option value="interval">Timer</option><option value="external">External event</option></select></label>
                {primaryRule.trigger.type === "keyword" && <><label>What word should chat type?<input maxLength={80} value={primaryRule.trigger.phrase} onChange={event => patchTrigger({ phrase: event.target.value })}/></label><label hidden={!advanced}>MATCH<select value={primaryRule.trigger.match} onChange={event => patchTrigger({ match: event.target.value })}><option value="word">Whole word</option><option value="contains">Contains</option></select></label></>}
                {primaryRule.trigger.type === "twitch" && <label hidden={!advanced}>TWITCH EVENT<select value={primaryRule.trigger.event} onChange={event => patchTrigger({ event: event.target.value })}>{Object.entries(eventLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
                {primaryRule.trigger.type === "interval" && <label>SECONDS BETWEEN MOMENTS<input type="number" min={AUTOMATION_LIMITS.everySeconds[0]} max={AUTOMATION_LIMITS.everySeconds[1]} value={primaryRule.trigger.everySeconds} onChange={event => patchTrigger({ everySeconds: Math.min(AUTOMATION_LIMITS.everySeconds[1], Math.max(AUTOMATION_LIMITS.everySeconds[0], Number(event.target.value) || AUTOMATION_LIMITS.everySeconds[0])) })}/></label>}
                {primaryRule.trigger.type === "external" && <label>EVENT NAME<input maxLength={64} pattern="[A-Za-z][A-Za-z0-9._-]*" value={primaryRule.trigger.event} onChange={event => patchTrigger({ event: event.target.value })}/></label>}
                <label hidden={!advanced}>COOLDOWN IN SECONDS<input type="number" min={AUTOMATION_LIMITS.cooldownSeconds[0]} max={AUTOMATION_LIMITS.cooldownSeconds[1]} value={primaryRule.cooldownSeconds} onChange={event => patchRule(primaryRule.id, { cooldownSeconds: Math.min(AUTOMATION_LIMITS.cooldownSeconds[1], Math.max(0, Number(event.target.value) || 0)) })}/><small>Wait this long before the same rule can trigger again.</small></label>
              </div>
            </section>
            <section hidden={activeStep !== "content"} className="flow-panel"><header><span>02</span><div><h3>Your popup</h3><p>Keep the parts you like and change the rest.</p></div></header>
              {primaryRule.trigger.type === "twitch" && primaryRule.trigger.event.startsWith("hype_") && !primaryRule.effect.appearance?.hypeLifecycle && <div className="flow-fields"><button type="button" className="flow-primary" onClick={useTrainTheme}>🚂 Use full Hype Train animation</button><small>Apply a steam train, progress bar and countdown to this experience’s Hype Train events. Choose your own sound below. This replaces their displayed effect; saved carousel content stays available.</small></div>}
              <div className="flow-fields"><label hidden={!advanced || primaryRule.effect.type === "shoutout"}>WHAT VIEWERS SEE<select value={primaryRule.effect.type} onChange={event => { const type = event.target.value; if (type === "carousel") replaceEffect({ type, carouselId: design.carousels[0].id }); else if (type === "choose") replaceEffect({ type, mode: "rotate", options: [{ type: "celebrate", message: "A moment for the stream!" }] }); else replaceEffect({ type: "celebrate", message: "A moment for the stream!" }); }}><option value="carousel" disabled={!design.carousels.length}>Content carousel</option><option value="celebrate">Celebration message</option><option value="choose">Choose between effects (advanced)</option></select></label>
                {primaryRule.effect.type === "carousel" && <><label hidden={!advanced}>CONTENT SET<select value={primaryRule.effect.carouselId} onChange={event => patchEffect({ carouselId: event.target.value })}>{design.carousels.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>{carousel && <><label>What is this popup called?<input maxLength={80} value={carousel.title} onChange={event => patchCarousel(carousel.id, { title: event.target.value })}/></label><label>How many seconds should it stay on screen?<input type="number" min={AUTOMATION_LIMITS.displaySeconds[0]} max={AUTOMATION_LIMITS.displaySeconds[1]} value={carousel.displaySeconds} onChange={event => patchCarousel(carousel.id, { displaySeconds: Math.max(AUTOMATION_LIMITS.displaySeconds[0], Math.min(AUTOMATION_LIMITS.displaySeconds[1], Number(event.target.value) || AUTOMATION_LIMITS.displaySeconds[0])) })}/></label>
                    {carousel.slides.some(slide => slide.url) && <div className="flow-link-requirements"><p>Links work in preview. Live destinations must be permitted for your channel; entering a link does not grant Twitch approval.</p><label><input type="checkbox" checked={merchDeclarations[carousel.id] === true} onChange={event => onDeclareMerch?.(carousel.id, event.target.checked)}/>Any merchandise here is my own branded merch, with no sponsor sales or affiliate links.</label></div>}
                    <div className="flow-slides"><div className="flow-slides-head"><b>SLIDES</b><span>{carousel.slides.length}/{AUTOMATION_LIMITS.slides}</span></div>{carousel.slides.map((slide, index) => { const isOpen = expandedSlide.carouselId === carousel.id && expandedSlide.slideId === slide.id; return <article className={`flow-slide ${isOpen ? "open" : ""}`} key={slide.id}><div className="flow-slide-title"><b>Slide {index + 1} · {slide.title || "Untitled"}</b><div><button className="flow-remove" type="button" onClick={() => setExpandedSlide({ carouselId: carousel.id, slideId: isOpen ? "" : slide.id })}>{isOpen ? "Done" : "Edit"}</button><button className="flow-remove" type="button" disabled={carousel.slides.length <= 1} onClick={() => removeSlide(slide.id)}>Remove</button></div></div>{isOpen && <><label>TITLE<input maxLength={70} value={slide.title} onChange={event => updateSlide(slide.id, { title: event.target.value })}/></label><label>CAPTION<input maxLength={100} value={slide.caption} onChange={event => updateSlide(slide.id, { caption: event.target.value })}/></label><label>LINK (OPTIONAL)<input type="url" maxLength={1000} placeholder="https://…" value={slide.url || ""} onChange={event => updateSlide(slide.id, { url: event.target.value })}/></label><label>IMAGE<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading === slide.id} onChange={event => upload(slide.id, event.target.files?.[0])}/><small>{uploading === slide.id ? "Preparing image…" : slide.image ? "Image added · choose a file to replace it" : "Optional · PNG, JPEG, WebP, or GIF up to 10 MB. Animated GIFs become still images."}</small></label>{slide.image && <img className="flow-slide-image" src={slide.image} alt="Slide preview"/>}</>}</article>; })}<button className="flow-add-slide" type="button" disabled={carousel.slides.length >= AUTOMATION_LIMITS.slides} onClick={addSlide}>＋ Add slide</button></div></>}</>}
                {primaryRule.effect.type === "shoutout" && <ShoutoutCardControls effect={primaryRule.effect} onChange={patchEffect}/>}
                {primaryRule.effect.type === "celebrate" && <><label>Your on-screen message<input maxLength={160} value={primaryRule.effect.message} onChange={event => patchEffect({ message: event.target.value })}/></label><MessageSuggestions trigger={primaryRule.trigger} onSelect={text => patchEffect({ message: text })}/><CelebrationAppearance effect={primaryRule.effect} key={primaryRule.id} onApplySound={rules.length > 1 ? applySound : undefined} idPrefix={`rule-${primaryRule.id}`} onChange={next => replaceEffect(next)}/></>}
                {primaryRule.effect.type === "choose" && <div className="flow-choice"><label>HOW TO CHOOSE<select value={primaryRule.effect.mode} onChange={event => patchEffect({ mode: event.target.value })}><option value="rotate">Rotate</option><option value="random">Random</option></select></label><span className="flow-options-label">INCLUDE EXISTING CONTENT</span>{design.carousels.map(item => { const checked = primaryRule.effect.options.some(option => option.type === "carousel" && option.carouselId === item.id); return <label className="flow-option-check" key={item.id}><input type="checkbox" checked={checked} disabled={!checked && primaryRule.effect.options.length >= AUTOMATION_LIMITS.chooseOptions} onChange={event => patchEffect({ options: event.target.checked ? [...primaryRule.effect.options, { type: "carousel", carouselId: item.id }] : primaryRule.effect.options.filter(option => !(option.type === "carousel" && option.carouselId === item.id)) })}/>{item.title}</label>; })}{(() => { const celebration = primaryRule.effect.options.find(option => option.type === "celebrate"); return <><label className="flow-option-check"><input type="checkbox" checked={!!celebration} disabled={!celebration && primaryRule.effect.options.length >= AUTOMATION_LIMITS.chooseOptions} onChange={event => patchEffect({ options: event.target.checked ? [...primaryRule.effect.options, { type: "celebrate", message: "A moment for the stream!" }] : primaryRule.effect.options.filter(option => option.type !== "celebrate") })}/>Celebration message</label>{celebration && <><label>CELEBRATION TEXT<input maxLength={160} value={celebration.message} onChange={event => patchEffect({ options: primaryRule.effect.options.map(option => option.type === "celebrate" ? { ...option, message: event.target.value } : option) })}/></label><MessageSuggestions trigger={primaryRule.trigger} onSelect={text => patchEffect({ options: primaryRule.effect.options.map(option => option.type === "celebrate" ? { ...option, message: text } : option) })}/><CelebrationAppearance effect={celebration} key={`${primaryRule.id}-option`} onApplySound={rules.length > 1 ? applySound : undefined} idPrefix={`rule-${primaryRule.id}-option`} onChange={next => patchEffect({ options: primaryRule.effect.options.map(option => option.type === "celebrate" ? next : option) })}/></>}</>; })()}</div>}
              </div>
            </section>
            <section hidden={activeStep !== "place"} className="flow-panel flow-appearance"><header><span>03</span><div><h3>Appearance</h3><p>Choose how the experience is placed on the stream.</p></div></header><div className="flow-fields">{carousel && <PopupPlacement carousel={carousel} onChange={layout => patchCarousel(carousel.id, { layout })}/>}
{carousel && <div hidden={!advanced} className="flow-layout-controls"><b>Layout &amp; layer</b><p>Position and size use a 100% canvas.</p><div>{[["X", "x", 0, Math.min(90, 100 - carouselLayout.width)], ["Y", "y", 0, Math.min(90, 100 - carouselLayout.height)], ["Width", "width", 10, Math.min(80, 100 - carouselLayout.x)], ["Height", "height", 10, Math.min(80, 100 - carouselLayout.y)], ["Layer", "layer", 0, 100]].map(([label, key, min, max]) => <label key={key}>{label}<input type="number" min={min} max={max} value={carouselLayout[key]} onChange={event => patchCarousel(carousel.id, { layout: { ...carouselLayout, [key]: Math.max(min, Math.min(max, Number(event.target.value) || 0)) } })}/></label>)}</div></div>}<p className="flow-preview-note">Testing evaluates a sample event and opens the local preview. Results appear there after rendering.</p><button className="flow-secondary" onClick={() => onOpenDetails?.("carousels", carousel?.id)}>More appearance settings ↗</button></div></section>
          </div>
          <section hidden={activeStep !== "finish"} className="flow-test-panel"><div><span className="flow-kicker">FINAL STEP</span><h3>Try this experience</h3><p>Your next step: {liveEditor ? "publish your draft to this Twitch channel" : "save your draft here. To go live, export it and import it in Scene Studio’s Twitch configuration"}. Previewing does not send an event to viewers.</p></div><button className="flow-primary" onClick={test}>▶ Preview this event</button><button className="flow-primary" disabled={saveDisabled} onClick={onSave}>{liveEditor ? "Publish to Twitch" : "Save this draft"}</button>{!liveEditor && <div className="flow-transfer-guide"><h4>How to put this on your channel</h4><ol><li>Save the draft, then <button className="flow-secondary" onClick={onExport}>Download this setup</button>.</li><li>In Twitch’s Creator Dashboard, open Extensions, find Scene Studio, and choose Configure.</li><li>Open the live-moment editor and import the downloaded file. Import replaces that editor’s draft, so export its current setup first if you want to keep it.</li><li>Connect the events requested there, preview the imported setup, then choose Publish to Twitch.</li></ol><p>Downloading does not publish. This standalone builder cannot publish directly to your Twitch account.</p></div>}</section>
          <div className="flow-step-actions"><button type="button" className="flow-secondary" disabled={stepIndex === 0} onClick={() => setSetupStep(setupSteps[stepIndex - 1].id)}>← Back</button><span>{guideCopy.next}</span>{stepIndex < setupSteps.length - 1 && <button type="button" className="flow-primary" onClick={() => setSetupStep(setupSteps[stepIndex + 1].id)}>Next: {setupSteps[stepIndex + 1].label} →</button>}</div>
          {advanced && rules.length > 1 && <button className="flow-secondary flow-advanced-link" onClick={() => onOpenDetails?.("rules")}>Edit all {rules.length} rules in the advanced editor ↗</button>}
        </> : <div className="flow-empty"><h3>No rule in this experience</h3><p>Add a starter experience from the sidebar, or manage this page’s rules in the advanced editor.</p><button className="flow-secondary" onClick={() => onOpenDetails?.("rules")}>Open advanced rules ↗</button></div>}
      </section>}
    </div>}
    {removed && <p className="flow-notice">Experience removed. <button className="flow-secondary" disabled={JSON.stringify(design) !== removed.after} onClick={() => { setDesign(removed.before); setSelectedId(removed.pageId); setRemoved(null); setNotice("Experience restored."); }}>Undo removal</button></p>}
    <footer hidden={!advanced} className="flow-footer"><span>Changes stay in your draft until you save or publish.</span><button className="flow-advanced" onClick={() => onOpenDetails?.("rules")}>Advanced editor <span>↗</span></button></footer>
  </main>;
}

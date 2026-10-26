import React, { useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import {
  AUTOMATION_LIMITS,
  validateAutomations,
  parseAutomations,
  createAutomationState,
  evaluateAutomations,
  createExternalStarterRule,
  TWITCH_AUTOMATION_EVENTS,
} from "./automations.mjs";
import { prepareImage } from "./images.mjs";
import { addExperiencePreset, addExperiencePresets } from "./experience-presets.mjs";
import { previewExperienceRule } from "./experience-preview.mjs";
import { deriveLegacyAutomationPages } from "./automations.mjs";
import "./automations.css";
import DeveloperPanel from "./DeveloperPanel.jsx";
import { getAutomationConfig, saveAutomationConfig, publishAutomationImages, fireAutomation, currentAutomationPublisher, connectAutomationSession } from "./automation-twitch.mjs";
import { channelProfile } from "./twitch.mjs";
import { IMAGE_ORIGIN } from "./image-address.mjs";
import { liveText, safeLiveContext } from "./live-context.mjs";
import FlowBuilder from "./FlowBuilder.jsx";
import Celebration from "./Celebration.jsx";
import CelebrationAudio from "./CelebrationAudio.jsx";

const KEY = "scene-studio-automation-preview-v1";
const uid = () => crypto.randomUUID();
const emptyDesign = () => ({ version: 1, carousels: [], rules: [] });
const twitchEditor = () => Boolean(window.Twitch?.ext && ["config", "dashboard"].includes(new URLSearchParams(location.search).get("mode")));
function initialDesign() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return parseAutomations(saved);
  } catch {}
  return emptyDesign();
}

export default function AutomationStudio({ session, onBack, visible = true, experienceRequest, onPagesChange, onRequestHandled, bundleApi }) {
  const [requestedPageId, setRequestedPageId] = useState(null);
  const consumedRequest = useRef(null);
  const managed = session !== undefined;
  const liveEditor = managed || twitchEditor();
  const [design, setDesign] = useState(() => liveEditor ? emptyDesign() : initialDesign()),
    [tab, setTab] = useState("builder"),
    [carouselId, setCarouselId] = useState(() => design.carousels[0]?.id),
    [slideIndex, setSlideIndex] = useState(0);
  const [message, setMessage] = useState("merch"),
    [previewTwitchEvent, setPreviewTwitchEvent] = useState("subscribe"),
    [externalName, setExternalName] = useState("boss_defeated"),
    [notice, setNotice] = useState(
      "Customize an experience, then test it before publishing.",
    ),
    [running, setRunning] = useState(false),
    [now, setNow] = useState(Date.now());
  const [active, setActive] = useState(null),
    [queue, setQueue] = useState([]),
    [log, setLog] = useState([]),
    [manualSlide, setManualSlide] = useState(null);
  // Streamer declarations belong to this editing session, not the runtime design.
  // They are not evidence of ownership and never grant Twitch link permission.
  const [merchDeclarations, setMerchDeclarations] = useState({});
  const [pastedDesign, setPastedDesign] = useState(""), [importStatus, setImportStatus] = useState("");
  const pasteId = useId();
  const [auth, setAuth] = useState(null), [linked, setLinked] = useState(false), [channelName, setChannelName] = useState(""),
    [savedConfig, setSavedConfig] = useState(null), [liveStatus, setLiveStatus] = useState("Waiting for Twitch channel authorization…"),
    [busy, setBusy] = useState(false), [chatStatus, setChatStatus] = useState(null), [authorizeUrl, setAuthorizeUrl] = useState("");
  const [activityStatus, setActivityStatus] = useState(null), [activityAuthorize, setActivityAuthorize] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [previewFullMotion, setPreviewFullMotion] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  const authRef = useRef(null), loadGeneration = useRef(0), viewerRef = useRef(null);
  viewerRef.current = managed ? session?.viewer : window.Twitch?.ext?.viewer;
  const dirty = liveEditor && savedConfig && JSON.stringify(design) !== JSON.stringify(savedConfig.design);
  const backUrl = liveEditor ? `./config.html${location.search}` : "./";
  useImperativeHandle(bundleApi, () => ({
    add(keys) {
      if (busy || (liveEditor && !savedConfig)) throw new Error("Wait for this channel's saved experiences to load before adding a layout.");
      const result = addExperiencePresets(design, keys);
      setDesign(result.design);
      setRequestedPageId(result.pageIds[0] || null);
      setTab("builder");
      setNotice(`Added ${result.pageIds.length} live moments to your draft. Each has its own settings and preview.`);
      return result;
    },
  }), [design, busy, liveEditor, savedConfig]);
  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    try { onPagesChange?.(design.pages ?? deriveLegacyAutomationPages(design)); } catch {}
    if (!liveEditor) {
      try { localStorage.setItem(KEY, JSON.stringify(validateAutomations(design))); } catch {}
    }
  }, [design, liveEditor, onPagesChange]);
  useEffect(() => {
    if (!experienceRequest || consumedRequest.current === experienceRequest.requestId || busy || (liveEditor && !savedConfig)) return;
    consumedRequest.current = experienceRequest.requestId;
    onRequestHandled?.(null);
    setTab("builder");
    try {
      if (experienceRequest.key) {
        const result = addExperiencePreset(design, experienceRequest.key);
        setDesign(result.design); setRequestedPageId(result.pageId);
        setNotice("Experience added to your draft. Customize it and try the preview before publishing.");
      } else setRequestedPageId(experienceRequest.pageId || null);
    } catch (error) { setNotice(error.message); }
  }, [experienceRequest, busy, liveEditor, savedConfig, design]);
  function installConfig(next) {
    setSavedConfig(next); setDesign(next.design); setCarouselId(next.design.carousels[0]?.id); setSlideIndex(0);
    setMerchDeclarations(Object.fromEntries(next.design.carousels.map(c => [c.id, next.ownedMerch])));
    setActive(null); setQueue([]); setRunning(false);
  }
  async function loadChannel(current) {
    const generation = ++loadGeneration.current;
    setBusy(true);
    try {
      const next = await getAutomationConfig(current);
      if (generation !== loadGeneration.current || authRef.current?.channelId !== current.channelId) return;
      installConfig(next);
      setLiveStatus(`Loaded this channel's saved automation revision ${next.revision}.`);
    } catch (error) { if (generation === loadGeneration.current) setLiveStatus(error.message); }
    finally { if (generation === loadGeneration.current) setBusy(false); }
  }
  useEffect(() => {
    if (!liveEditor) return;
    let active = true;
    const helper = window.Twitch.ext;
    const disconnect = connectAutomationSession(helper, session, current => {
      if (!active) return;
      const next = current?.auth, viewer = current?.viewer;
      if (!next) {
        loadGeneration.current++; authRef.current = null; setAuth(null); setLinked(false);
        setSavedConfig(null); setDesign(emptyDesign()); setMerchDeclarations({}); setChannelName("");
        setChatStatus(null); setActivityStatus(null); setAuthorizeUrl(""); setBusy(false);
        setActive(null); setQueue([]); setRunning(false);
        setLiveStatus("Waiting for Twitch channel authorization…"); return;
      }
      if (viewer?.role !== "broadcaster") { authRef.current = null; setAuth(null); setLinked(false); setSavedConfig(null); setDesign(emptyDesign()); setLiveStatus("Only this channel's broadcaster can configure live automations."); return; }
      const changed = authRef.current?.channelId !== next.channelId;
      authRef.current = next; setAuth(next); setLinked(viewer?.isLinked === true);
      if (changed) {
        setDesign(emptyDesign()); setSavedConfig(null); setMerchDeclarations({}); setChannelName(""); setChatStatus(null); setAuthorizeUrl("");
        void loadChannel(next);
        if (!managed) channelProfile(next).then(profile => { if (active && authRef.current?.channelId === next.channelId) setChannelName(profile.login); }).catch(() => {});
      }
      if (current.profile?.id === next.channelId) setChannelName(current.profile.login);
    });
    return () => { active = false; disconnect(); };
  }, [liveEditor, managed, session?.auth, session?.viewer?.role, session?.viewer?.isLinked, session?.profile]);
  useEffect(() => () => { loadGeneration.current++; }, []);
  useEffect(() => { if (!visible) { setRunning(false); setActive(null); setQueue([]); } }, [visible]);
  async function saveLive() {
    if (!auth || !linked || !savedConfig || busy) return;
    const current = auth, revision = savedConfig.revision;
    const ownedMerch = design.carousels.filter(c => c.slides.some(s => s.url)).every(c => merchDeclarations[c.id] === true);
    setBusy(true);
    try {
      const ready = await publishAutomationImages(design, current, ownedMerch);
      const publisher = currentAutomationPublisher(current, authRef.current, viewerRef.current);
      const result = await saveAutomationConfig(publisher, ready, revision, ownedMerch);
      if (authRef.current?.channelId !== current.channelId) return;
      installConfig(result);
      setLiveStatus(result.notification === "uncertain" ? `Saved revision ${result.revision}. Viewer notification is uncertain; reload the viewer to verify.` : `Saved revision ${result.revision} for this channel. Connected viewers were notified.`);
    } catch (error) { setLiveStatus(error.message); }
    finally { setBusy(false); }
  }
  async function fireLive(effect) {
    if (!auth || !linked || busy) return;
    setBusy(true);
    try {
      const result = await fireAutomation(auth, effect);
      setLiveStatus(result.status === "sent" ? "Sent to Twitch. Check a viewer session to confirm the result." : result.status === "uncertain" ? "Delivery is uncertain. Check viewers before another click." : result.status === "cooldown" ? "The channel is cooling down. Try later." : "No saved action matched. Reload the channel settings.");
    } catch (error) { setLiveStatus(error.message); }
    finally { setBusy(false); }
  }
  async function chatConnection(connect = false, retry = false, activity = false, disconnect = false) {
    if (!auth || !linked || busy) return;
    setBusy(true); setAuthorizeUrl(""); setActivityAuthorize(activity);
    try {
      const response = await fetch(`${IMAGE_ORIGIN}/v1/chat/${auth.channelId}/${activity ? (connect ? "activity-connect" : "activity") : (connect ? "trigger-connect" : "triggers")}`, { method: disconnect ? "DELETE" : connect || retry ? "POST" : "GET", headers: { Authorization: `Bearer ${auth.token}` }, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(30000) });
      const result = await response.json();
      if (!response.ok) throw Error(result.message || result.error || "Chat triggers could not be connected.");
      if (connect) {
        const url = new URL(result.authorizeUrl);
        const fields = ["response_type", "client_id", "redirect_uri", "scope", "state"];
        const scopeList = url.searchParams.get("scope")?.split(" ") || [];
        const chatScopes = ["moderation:read", "user:read:chat", "user:bot", "channel:bot"];
        const activityScopes = ["channel:read:subscriptions", "channel:read:hype_train"];
        const requiredScopes = activity ? activityScopes : chatScopes;
        const scopesValid = requiredScopes.every(s => scopeList.includes(s)) && new Set(scopeList).size === scopeList.length && scopeList.every(s => [...chatScopes, ...activityScopes].includes(s));
        if (url.origin !== "https://id.twitch.tv" || url.pathname !== "/oauth2/authorize" || url.username || url.password || url.hash || fields.some(key => url.searchParams.getAll(key).length !== 1) || url.searchParams.get("response_type") !== "code" || !/^[a-zA-Z0-9]{10,80}$/.test(url.searchParams.get("client_id") || "") || url.searchParams.get("redirect_uri") !== `${IMAGE_ORIGIN}/chat/callback` || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("state") || "") || !scopesValid || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) throw Error("The Twitch authorization link could not be verified.");
        setAuthorizeUrl(url.href); setLiveStatus("Open Twitch authorization below, then refresh connection status.");
      } else { if (activity) setActivityStatus(result); else setChatStatus(result); setLiveStatus(activity ? "Subscription and Hype Train event status refreshed." : "Chat trigger status refreshed."); }
    } catch (error) { setLiveStatus(error.message); }
    finally { setBusy(false); }
  }
  const offset = useRef(0),
    engine = useRef(createAutomationState(Date.now())),
    designRef = useRef(design),
    runningRef = useRef(running);
  designRef.current = design;
  runningRef.current = running;
  const carousel =
    design.carousels.find((c) => c.id === carouselId) || design.carousels[0];
  const slide = carousel?.slides[slideIndex] || carousel?.slides[0];
  function record(text) {
    setLog((old) => [{ id: uid(), text }, ...old].slice(0, 8));
  }
  function enqueue(events, clean) {
    const next = events.map((e) => ({
      ...e,
      id: uid(),
      carousel:
        e.effect.type === "carousel"
          ? clean.carousels.find((c) => c.id === e.effect.carouselId)
          : null,
    }));
    setQueue((old) => [...old, ...next].slice(0, 8));
    for (const e of next)
      record(
        `${e.name} → ${e.effect.type === "carousel" ? "show carousel" : "celebrate"}`,
      );
  }
  function evaluate(event, time = Date.now() + offset.current) {
    try {
      const clean = validateAutomations(designRef.current);
      const result = evaluateAutomations(clean, engine.current, event, time);
      engine.current = result.state;
      enqueue(result.events.map(item => ({ ...item, context: safeLiveContext(event.context) })), clean);
      if (event.type !== "tick")
        setNotice(
          result.events.length
            ? `${result.events.length} rule${result.events.length === 1 ? "" : "s"} matched.`
            : "No action: no matching enabled rule, or its cooldown is still active.",
        );
    } catch (error) {
      setNotice(error.message);
      setRunning(false);
    }
  }
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      const time = Date.now() + offset.current;
      setNow(time);
      if (runningRef.current) evaluate({ type: "tick" }, time);
    }, 250);
    return () => clearInterval(timer);
  }, [visible]);
  useEffect(() => {
    if (!active && queue.length) {
      setActive({ ...queue[0], startedAt: now });
      setQueue((q) => q.slice(1));
      setManualSlide(null);
    }
  }, [active, queue, now]);
  useEffect(() => {
    if (
      active &&
      now - active.startedAt >= (active.carousel?.displaySeconds ?? active.effect.appearance?.durationSeconds ?? 8) * 1000
    )
      setActive(null);
  }, [active, now]);
  function save() {
    if (liveEditor) { void saveLive(); return; }
    try {
      const clean = validateAutomations(design);
      localStorage.setItem(KEY, JSON.stringify(clean));
      setDesign(clean);
      setNotice(
        "Draft saved in this browser. Publish from your Twitch channel configuration to reach viewers.",
      );
    } catch (e) {
      setNotice(e.message);
    }
  }
  function updateRule(id, patch) {
    setDesign((d) => ({
      ...d,
      rules: d.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  }
  function updateCarousel(patch) {
    setMerchDeclarations((old) => ({ ...old, [carousel.id]: false }));
    setDesign((d) => ({
      ...d,
      carousels: d.carousels.map((c) =>
        c.id === carousel.id ? { ...c, ...patch } : c,
      ),
    }));
  }
  function updateCarouselById(id, patch) {
    setMerchDeclarations(old => ({ ...old, [id]: false }));
    setDesign(d => ({ ...d, carousels: d.carousels.map(c => c.id === id ? { ...c, ...patch } : c) }));
  }
  function updateSlide(patch) {
    updateCarousel({
      slides: carousel.slides.map((s) =>
        s.id === slide.id ? { ...s, ...patch } : s,
      ),
    });
  }
  function previewCarousel() {
    try {
      const clean = validateAutomations(design);
      enqueue(
        [
          {
            name: "Manual preview",
            effect: { type: "carousel", carouselId: carousel.id },
          },
        ],
        clean,
      );
    } catch (e) {
      setNotice(e.message);
    }
  }
  async function upload(file) {
    if (!file) return;
    const owner = carousel.id,
      target = slide.id;
    try {
      const image = await prepareImage(file);
      setMerchDeclarations((old) => ({ ...old, [owner]: false }));
      setDesign((d) => ({
        ...d,
        carousels: d.carousels.map((c) =>
          c.id === owner
            ? {
                ...c,
                slides: c.slides.map((s) =>
                  s.id === target ? { ...s, image } : s,
                ),
              }
            : c,
        ),
      }));
      setNotice("Image ready for the preview. Save to keep your changes.");
    } catch (e) {
      setNotice(e.message);
    }
  }
  function exportDesign() {
    try {
      const clean = validateAutomations(design);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(clean, null, 2)], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "scene-studio-triggers.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setNotice(e.message);
    }
  }
  function applyDesignText(text) {
      const clean = parseAutomations(text);
      setMerchDeclarations({});
      setDesign(clean);
      setCarouselId(clean.carousels[0]?.id);
      setSlideIndex(0);
      setQueue([]);
      setActive(null);
      setRunning(false);
      engine.current = createAutomationState(Date.now() + offset.current);
      const message = liveEditor ? "Imported. Publish to Twitch to save this channel's design." : "Imported for preview. Save to keep this design.";
      setNotice(message); setImportStatus(message);
  }
  async function importDesign(file) {
    if (!file) return;
    try {
      if (file.size > 2000000) throw Error("Keep the design under 2 MB.");
      applyDesignText(await file.text());
    } catch (e) {
      setNotice(e.message); setImportStatus(e.message);
    }
  }
  const shown = active?.carousel;
  const currentSlide =
    shown?.slides[
      (manualSlide ?? Math.floor((now - active.startedAt) / 5000)) %
        shown.slides.length
    ];
  return (
    <div className={`director experience-director${liveEditor ? " live-flow-editor" : ""}${tab === "builder" ? " flow-first" : ""}`}>
      <header className={`director-top${liveEditor ? " live-director-top" : ""}`}>
        <a href={backUrl} onClick={event => { if (onBack) { event.preventDefault(); onBack(); } else if (dirty && !window.confirm("Leave without saving this channel's automation edits?")) event.preventDefault(); }}>← Your experiences</a>
        <span className="draft-badge">{liveEditor ? "TWITCH CHANNEL AUTOMATIONS" : "LOCAL DRAFT · NOT PUBLISHED"}</span>
        <div>
          <button onClick={exportDesign}>Export</button>
          <label className="import-control">
            Import
            <input
              type="file"
              disabled={busy}
              accept="application/json,.json"
              aria-label="Import trigger design"
              onChange={(e) => {
                importDesign(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </label>
          <button className="lime" title={liveEditor ? "Save this channel's design and notify its viewers" : "Save in this browser"} onClick={save} disabled={busy || (liveEditor && (!savedConfig || !linked))}>
            {liveEditor ? "Publish to Twitch" : "Save this draft"}
          </button>
        </div>
      </header>
      <p className="experience-save-note" role="status">{notice}</p>
      <p className="experience-save-note">{liveEditor ? "Publishing updates this channel’s live moments. Website links require an allowed destination for this channel." : "Drafts are saved in this browser. Open Scene Studio in Twitch’s extension configuration to publish to your channel."}</p>
      <section className={`director-intro${tab === "builder" ? " flow-intro" : ""}`}>
        <p className="eyebrow">YOUR STREAM, ON CUE</p>
        <h1>Make the moment happen.</h1>
        <p>
          A word from chat. A little time. Your images, your message, your
          moment.
        </p>
        <p className="prototype-note">
          {liveEditor ? "Save and fire controls below affect this channel's new extension version. The preview messages and timers remain simulations. Live timers require at least 60 seconds and are checked about once a minute. Store links are admitted only for the channel's configured own-merch store." : "This is an interactive preview. Test messages are simulated; timers run only on this page. Store links open real sites in preview. To save or fire a real action, open your Twitch extension configuration. The submitted 0.1 version is unchanged."}
        </p>
      </section>
      <details className="paste-design">
        <summary>Paste a design · no file picker needed</summary>
        <p id={`${pasteId}-help`}>Paste an exported automation design or the JSON from your AI tool. Applying it replaces the editable draft; it does not publish or fire anything on Twitch. Export your current draft first if you want to keep it.</p>
        <label htmlFor={pasteId}>Design JSON</label>
        <textarea id={pasteId} aria-describedby={`${pasteId}-help`} value={pastedDesign} maxLength={2000000} rows={8} spellCheck={false} autoComplete="off" disabled={busy} onChange={event => { setPastedDesign(event.target.value); setImportStatus(""); }} placeholder='{"version":1,"carousels":[],"rules":[]}' />
        <button disabled={busy || !pastedDesign.trim() || (liveEditor && !savedConfig)} onClick={() => { try { applyDesignText(pastedDesign); } catch (error) { setNotice(error.message); setImportStatus(error.message); } }}>Apply pasted design</button>
        <p role="status" aria-live="polite">{importStatus}</p>
      </details>
      {liveEditor && <p className="live-save-status" role="status">{liveStatus}</p>}
      {liveEditor && <details className="live-automation-panel" aria-label="Live channel controls" open={!linked}>
        <summary>{linked ? "Channel connections & live test controls" : "Connect Twitch to publish"}</summary>
        <h2>{channelName ? `@${channelName}` : auth ? `Twitch channel ${auth.channelId}` : "Your Twitch channel"}</h2>
        <p>This editor loads only this channel's saved design. Your separate browser preview draft is not imported automatically.</p>
        {!linked && <div><p>Connect your Twitch identity to save designs, fire viewer effects or authorize chat triggers. You can inspect the channel's settings first.</p><button disabled={!auth || busy} onClick={() => { try { window.Twitch.ext.actions.requestIdShare(); } catch { setLiveStatus("Twitch could not open identity sharing. Try reopening the extension configuration."); } }}>Connect Twitch identity</button></div>}
        <p role="status">{liveStatus}</p>
        <div className="live-automation-actions"><button disabled={!auth || busy} onClick={() => { if (!dirty || window.confirm("Replace unsaved edits with this channel's saved automation design?")) void loadChannel(auth); }}>Reload saved channel design</button><button disabled={!auth || !linked || busy} onClick={() => chatConnection(false)}>Refresh chat trigger status</button><button disabled={!auth || !linked || busy} onClick={() => chatConnection(true)}>Connect Twitch chat triggers</button></div>
        {authorizeUrl && <a href={authorizeUrl} target="_blank" rel="noopener noreferrer">{activityAuthorize ? "Authorize subscription & Hype Train events on Twitch ↗" : "Authorize chat triggers on Twitch ↗"}</a>}
        {chatStatus && <p>Chat triggers: {chatStatus.connected === true ? "connected" : "not connected"}. {chatStatus.reconnectRequired ? "Reconnect required." : ""} {typeof chatStatus.status === "string" ? chatStatus.status : "Refresh status after authorizing."}</p>}
        {chatStatus?.retryRequired && <button disabled={!auth || !linked || busy} onClick={() => chatConnection(false, true)}>Retry chat connection</button>}
        <h3>Subscription & Hype Train popups</h3><p>Connect once, then choose a Twitch event in your rules. Requires read-only subscription and Hype Train access. Events display your saved popup or celebration; they do not send chat messages.</p>
        <div className="live-automation-actions"><button disabled={!auth || !linked || busy} onClick={() => chatConnection(true, false, true)}>Connect subscriptions & Hype Trains</button><button disabled={!auth || !linked || busy} onClick={() => chatConnection(false, false, true)}>Refresh event status</button>{activityStatus?.authorized && !activityStatus?.connected && <button disabled={!auth || !linked || busy} onClick={() => chatConnection(false, true, true)}>Retry event listeners</button>}{activityStatus?.authorized && <button disabled={!auth || !linked || busy} onClick={() => chatConnection(false, false, true, true)}>Disconnect event listeners</button>}</div>
        {activityStatus && <p role="status">Twitch events: {activityStatus.connected ? "connected" : "not connected"}. {Array.isArray(activityStatus.events) ? `${activityStatus.events.filter(e => e.connected).length} of 6 listeners ready.` : ""} {activityStatus.reconnectRequired ? "Authorization required." : ""} {typeof activityStatus.status === "string" ? activityStatus.status : ""}</p>}
        {savedConfig?.revision > 0 && <><h3>Fire a saved action on Twitch</h3><p>These buttons use saved revision {savedConfig.revision}, not unsaved edits. They send a real viewer effect; they do not post a chat message.</p><div className="live-automation-actions">{savedConfig.design.carousels.map(c => <button disabled={busy || !linked} key={c.id} onClick={() => fireLive({ type: "carousel", carouselId: c.id })}>Fire on Twitch · {c.title}</button>)}{savedConfig.design.rules.filter(r => r.enabled).flatMap(r => (r.effect.type === "choose" ? r.effect.options : [r.effect]).filter(effect => effect.type === "celebrate").map((effect, index) => <button disabled={busy || !linked} key={`${r.id}-${index}`} onClick={() => fireLive(effect)}>Fire on Twitch · {r.name}{r.effect.type === "choose" ? ` · ${index + 1}` : ""}</button>))}</div></>}
      </details>}
      <main className={`director-grid${tab === "builder" ? " flow-director-grid" : ""}`} inert={busy ? true : undefined}>
        <section className="control-panel">
          <nav aria-label="Edit automation" className="automation-editor-tabs">
            <button
              aria-pressed={tab === "builder"}
              onClick={() => setTab("builder")}
            >
              Experiences
            </button>
            <button
              aria-pressed={tab === "rules"}
              onClick={() => setTab("rules")}
            >
              Advanced rules
            </button>
            <button
              aria-pressed={tab === "carousels"}
              onClick={() => setTab("carousels")}
            >
              All popup content
            </button>
          </nav>
          {tab === "builder" ? (
            <FlowBuilder
              design={design}
              requestedPageId={requestedPageId}
              merchDeclarations={merchDeclarations}
              onDeclareMerch={(id, value) => setMerchDeclarations(old => ({ ...old, [id]: value }))}
              onBack={onBack}
              setDesign={setDesign}
              onUpdateCarousel={updateCarouselById}
              evaluate={(event, ruleId) => {
                try {
                  const clean = validateAutomations(designRef.current);
                  const result = previewExperienceRule(clean, ruleId, event, Date.now() + offset.current, engine.current.choiceIndexes);
                  engine.current = result.state;
                  setActive(null); setQueue([]); setRunning(false);
                  enqueue(result.events.map(item => ({ ...item, context: safeLiveContext(event.context) })), clean);
                  setNotice(result.events.length ? 'Previewing this experience only. Nothing was sent to Twitch.' : 'This experience is off or the sample did not match.');
                  setPreviewExpanded(true);
                } catch (error) { setNotice(error.message); }
              }}
              onOpenDetails={(nextTab, targetId) => { if (targetId) setCarouselId(targetId); setTab(nextTab); }}
            />
          ) : tab === "rules" ? (
            <div className="rule-list">
              <div className="section-heading">
                <h2>If this, then that.</h2>
                <button
                  disabled={design.rules.length >= AUTOMATION_LIMITS.rules}
                  onClick={() =>
                    setDesign((d) => ({
                      ...d,
                      rules: [
                        ...d.rules,
                        {
                          id: uid(),
                          name: "Welcome a new subscriber",
                          enabled: true,
                          trigger: {
                            type: "twitch",
                            event: "subscribe",
                          },
                          effect: {
                            type: "celebrate",
                            message: "WELCOME TO THE STREAM!",
                          },
                          cooldownSeconds: 20,
                        },
                      ],
                    }))
                  }
                >
                  + Add rule
                </button>
              </div>
              {design.rules.map((r, index) => (
                <article className="rule" key={r.id}>
                  <div className="rule-head">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <input
                      aria-label={`Rule ${index + 1} name`}
                      value={r.name}
                      maxLength={70}
                      onChange={(e) =>
                        updateRule(r.id, { name: e.target.value })
                      }
                    />
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) =>
                          updateRule(r.id, { enabled: e.target.checked })
                        }
                      />
                      On
                    </label>
                  </div>
                  <label>
                    When
                    <select
                      aria-label={`Rule ${index + 1} trigger`}
                      value={r.trigger.type}
                      onChange={(e) =>
                        updateRule(r.id, {
                          trigger:
                            e.target.value === "keyword"
                              ? {
                                  type: "keyword",
                                  phrase: "hello",
                                  match: "word",
                                }
                              : e.target.value === "external"
                                ? { type: "external", event: "boss_defeated" }
                                : e.target.value === "twitch"
                                  ? { type: "twitch", event: "subscribe" }
                                  : { type: "interval", everySeconds: 300 },
                        })
                      }
                    >
                      <option value="keyword">
                        Chat says a word or phrase
                      </option>
                      <option value="interval">A timer comes around</option>
                      <option value="external">
                        A game or service sends an event
                      </option>
                      <option value="twitch">Twitch subscription or Hype Train event</option>
                    </select>
                  </label>
                  {r.trigger.type === "external" && (
                    <label>
                      Event name
                      <input
                        aria-label={`Rule ${index + 1} event name`}
                        value={r.trigger.event}
                        maxLength={64}
                        onChange={(e) =>
                          updateRule(r.id, {
                            trigger: { ...r.trigger, event: e.target.value },
                          })
                        }
                      />
                      <small>
                        Choose your own name, like boss_defeated or
                        goal.reached. Local simulation only.
                      </small>
                    </label>
                  )}
                  {r.trigger.type === "twitch" && (
                    <label>
                      Twitch event
                      <select
                        aria-label={`Rule ${index + 1} Twitch event`}
                        value={r.trigger.event}
                        onChange={(e) => updateRule(r.id, { trigger: { ...r.trigger, event: e.target.value } })}
                      >
                        {TWITCH_AUTOMATION_EVENTS.map((event) => <option key={event} value={event}>{({ subscribe: "A viewer subscribes", resubscribe: "A viewer renews a subscription", gift: "A viewer gifts a subscription", hype_begin: "A Hype Train begins", hype_progress: "A Hype Train level advances", hype_end: "A Hype Train ends" })[event]}</option>)}
                      </select>
                      <small>Matches authenticated Twitch subscription and Hype Train events.</small>
                    </label>
                  )}
                  {r.trigger.type === "keyword" ? (
                    <div className="field-pair">
                      <label>
                        Word or phrase
                        <input
                          aria-label={`Rule ${index + 1} phrase`}
                          value={r.trigger.phrase}
                          maxLength={80}
                          onChange={(e) =>
                            updateRule(r.id, {
                              trigger: { ...r.trigger, phrase: e.target.value },
                            })
                          }
                        />
                      </label>
                      <label>
                        Match
                        <select
                          value={r.trigger.match}
                          onChange={(e) =>
                            updateRule(r.id, {
                              trigger: { ...r.trigger, match: e.target.value },
                            })
                          }
                        >
                          <option value="word">Whole word / phrase</option>
                          <option value="contains">
                            Anywhere in a message
                          </option>
                        </select>
                      </label>
                    </div>
                  ) : r.trigger.type === "interval" ? (
                    <label>
                      Every (seconds)
                      <input
                        aria-label={`Rule ${index + 1} interval`}
                        type="number"
                        min="5"
                        max="3600"
                        value={r.trigger.everySeconds}
                        onChange={(e) =>
                          updateRule(r.id, {
                            trigger: {
                              ...r.trigger,
                              everySeconds: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  ) : null}
                  <label>
                    Then
                    <select
                      aria-label={`Rule ${index + 1} effect`}
                      value={r.effect.type}
                      onChange={(e) =>
                        updateRule(r.id, {
                          effect:
                            e.target.value === "celebrate"
                              ? {
                                  type: "celebrate",
                                  message: "YOU MADE THIS MOMENT",
                                }
                              : {
                                  type: "carousel",
                                  carouselId: design.carousels[0].id,
                                },
                        })
                      }
                    >
                      <option
                        value="carousel"
                        disabled={!design.carousels.length}
                      >
                        Show an image carousel
                      </option>
                      <option value="celebrate">Celebrate on screen</option>
                    </select>
                  </label>
                  {r.effect.type === "carousel" ? (
                    <label>
                      Which carousel
                      <select
                        value={r.effect.carouselId}
                        onChange={(e) =>
                          updateRule(r.id, {
                            effect: { ...r.effect, carouselId: e.target.value },
                          })
                        }
                      >
                        {design.carousels.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label>
                      Celebration message
                      <input
                        aria-label={`Rule ${index + 1} celebration message`}
                        value={r.effect.message}
                        maxLength={160}
                        onChange={(e) =>
                          updateRule(r.id, {
                            effect: { ...r.effect, message: e.target.value },
                          })
                        }
                      />
                    </label>
                  )}
                  <div className="rule-bottom">
                    <label>
                      Cooldown (seconds)
                      <input
                        aria-label={`Rule ${index + 1} cooldown`}
                        type="number"
                        min="0"
                        max="3600"
                        value={r.cooldownSeconds}
                        onChange={(e) =>
                          updateRule(r.id, {
                            cooldownSeconds: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <button
                      className="quiet"
                      onClick={() =>
                        setDesign((d) => ({
                          ...d,
                          rules: d.rules.filter((x) => x.id !== r.id),
                        }))
                      }
                    >
                      Remove rule
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="carousel-editor">
              <div className="section-heading">
                <h2>Images with somewhere to go.</h2>
                <button
                  disabled={design.carousels.length >= AUTOMATION_LIMITS.carousels}
                  onClick={() => {
                    const id = uid();
                    setDesign((d) => ({
                      ...d,
                      carousels: [
                        ...d.carousels,
                        {
                          id,
                          title: "My carousel",
                          displaySeconds: 20,
                          slides: [
                            {
                              id: uid(),
                              title: "Your first slide",
                              caption: "Make it yours",
                              image: "",
                              url: "",
                            },
                          ],
                        },
                      ],
                    }));
                    setCarouselId(id);
                    setSlideIndex(0);
                  }}
                >
                  + New
                </button>
              </div>
              {carousel ? (
                <>
                  <label>
                    Carousel
                    <select
                      value={carousel.id}
                      onChange={(e) => {
                        setCarouselId(e.target.value);
                        setSlideIndex(0);
                      }}
                    >
                      {design.carousels.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="merch-declaration">
                    <legend>Your own branded merch</legend>
                    <p>
                      Any merchandise in this carousel must be your own brand.
                      Sponsor products, sales for other brands, and affiliate or
                      referral links are excluded.
                    </p>
                    <label className="merch-declaration-check">
                      <input
                        type="checkbox"
                        checked={merchDeclarations[carousel.id] === true}
                        onChange={(e) =>
                          setMerchDeclarations((old) => ({
                            ...old,
                            [carousel.id]: e.target.checked,
                          }))
                        }
                      />
                      <span>
                        I confirm that any merch shown here is my own branded
                        merchandise, with direct store links and no sponsor sales
                        or affiliate links.
                      </span>
                    </label>
                    <small>
                      This is your declaration, not ownership verification or
                      Twitch approval. It lasts for this editing session and
                      resets when you change this carousel. Existing drafts and
                      previews remain available.
                    </small>
                    {merchDeclarations[carousel.id] === true && (
                      <p className="merch-declaration-status" role="status">
                        Your declaration is noted for this carousel.
                      </p>
                    )}
                  </fieldset>
                  <label>
                    Name
                    <input
                      value={carousel.title}
                      maxLength={80}
                      onChange={(e) =>
                        updateCarousel({ title: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Stay on screen (seconds)
                    <input
                      aria-label="Carousel visible seconds"
                      type="number"
                      min="2"
                      max="300"
                      value={carousel.displaySeconds}
                      onChange={(e) =>
                        updateCarousel({
                          displaySeconds: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <div className="slide-tabs" aria-label="Slides">
                    {carousel.slides.map((s, i) => (
                      <button
                        key={s.id}
                        aria-pressed={slide?.id === s.id}
                        onClick={() => setSlideIndex(i)}
                      >
                        {i + 1}
                      </button>
                    ))}
                    <button
                      disabled={carousel.slides.length >= 6}
                      onClick={() => {
                        updateCarousel({
                          slides: [
                            ...carousel.slides,
                            {
                              id: uid(),
                              title: "New slide",
                              caption: "",
                              image: "",
                              url: "",
                            },
                          ],
                        });
                        setSlideIndex(carousel.slides.length);
                      }}
                    >
                      +
                    </button>
                  </div>
                  {slide && (
                    <>
                      <div className="slide-image">
                        {slide.image ? (
                          <img src={slide.image} alt={slide.title} />
                        ) : (
                          <span>Your image goes here</span>
                        )}
                      </div>
                      <label>
                        Choose an image
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={(e) => {
                            upload(e.target.files[0]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <label>
                        Slide title
                        <input
                          value={slide.title}
                          maxLength={70}
                          onChange={(e) =>
                            updateSlide({ title: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Caption
                        <input
                          value={slide.caption}
                          maxLength={100}
                          onChange={(e) =>
                            updateSlide({ caption: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Your store link (optional)
                        <input
                          aria-label="Slide website link"
                          aria-describedby="merch-link-guidance"
                          type="url"
                          placeholder="https://…"
                          value={slide.url}
                          maxLength={1000}
                          onChange={(e) => updateSlide({ url: e.target.value })}
                        />
                        <small id="merch-link-guidance" className="merch-link-guidance">
                          For merchandise, link directly to your own branded item
                          or store. No sponsor, affiliate, or referral links.
                          {liveEditor ? "Only direct links to this channel's configured own-merch store may be saved." : "Links open real websites in this preview only."}
                        </small>
                      </label>
                      <div className="field-pair">
                        <button
                          disabled={carousel.slides.length < 2}
                          onClick={() => {
                            updateCarousel({
                              slides: carousel.slides.filter(
                                (s) => s.id !== slide.id,
                              ),
                            });
                            setSlideIndex(0);
                          }}
                        >
                          Remove slide
                        </button>
                        <button className="lime" onClick={previewCarousel}>
                          Preview carousel here
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p>Add a carousel to begin.</p>
              )}
            </div>
          )}
        </section>
        <section className={`preview-panel${previewExpanded ? " expanded-preview" : ""}`} role={previewExpanded ? "dialog" : undefined} aria-modal={previewExpanded ? true : undefined} aria-label={previewExpanded ? "Large interactive preview" : undefined}>
          <div className="preview-heading">
            <span>INTERACTIVE PREVIEW</span>
            <button onClick={() => setPreviewExpanded(value => !value)}>{previewExpanded ? "Close large preview" : "Expand preview"}</button>
          </div>
          {reducedMotion && <p className="preview-motion-note">Your device requests reduced motion. {previewFullMotion ? "Full animation is enabled in this preview only." : "Celebrations use a still version."} <button onClick={() => setPreviewFullMotion(value => !value)}>{previewFullMotion ? "Respect reduced motion" : "Preview full motion"}</button></p>}
          <CelebrationAudio key={auth?.channelId || "preview"} preview eventId={active?.startedAt} sound={active?.effect.appearance?.sound} expires={active ? active.startedAt - offset.current + (active.effect.appearance?.durationSeconds ?? 8) * 1000 : undefined} />
          <div className="director-stage">
            <div className="stage-scenery">
              <span className="stream-tag">YOUR STREAM</span>
              <div className="orbit one" />
              <div className="orbit two" />
              <h2>
                Keep the stream.
                <br />
                <em>Add the unexpected.</em>
              </h2>
              <p>Your moments appear when you decide.</p>
            </div>
            {active?.effect.type === "celebrate" && (
              <Celebration key={`${active.startedAt}-${previewFullMotion}`} eventId={String(active.startedAt)} message={liveText(active.effect.message, active.context)} appearance={active.effect.appearance} previewFullMotion={previewFullMotion} remainingSeconds={Math.max(.1, (active.effect.appearance?.durationSeconds ?? 8) - (now - active.startedAt) / 1000)} onDismiss={() => setActive(null)} />
            )}
            {shown && currentSlide && (
              <aside className="popup-carousel" aria-label="Carousel preview" style={shown.layout ? { left: `${shown.layout.x}%`, top: `${shown.layout.y}%`, right: "auto", bottom: "auto", width: `${shown.layout.width}%`, maxHeight: `${shown.layout.height}%`, zIndex: shown.layout.layer } : undefined}>
                <div className="popup-top">
                  <span>{liveText(shown.title, active?.context)}</span>
                  <button
                    aria-label="Dismiss carousel"
                    onClick={() => setActive(null)}
                  >
                    ×
                  </button>
                </div>
                {currentSlide.image && (
                  <img src={currentSlide.image} alt={currentSlide.title} />
                )}
                <div className="popup-copy">
                  <strong>{liveText(currentSlide.title, active?.context)}</strong>
                  <p>{liveText(currentSlide.caption, active?.context)}</p>
                  {currentSlide.url ? (
                    <a
                      href={currentSlide.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View item ↗
                    </a>
                  ) : (
                    <small>Image showcase</small>
                  )}
                </div>
                {shown.slides.length > 1 && <div className="popup-controls">
                  <button
                    aria-label="Previous slide"
                    onClick={() =>
                      setManualSlide(
                        ((manualSlide ??
                          Math.floor((now - active.startedAt) / 5000)) +
                          shown.slides.length -
                          1) %
                          shown.slides.length,
                      )
                    }
                  >
                    ←
                  </button>
                  <span>
                    {((manualSlide ??
                      Math.floor((now - active.startedAt) / 5000)) %
                      shown.slides.length) +
                      1}{" "}
                    / {shown.slides.length}
                  </span>
                  <button
                    aria-label="Next slide"
                    onClick={() =>
                      setManualSlide(
                        ((manualSlide ??
                          Math.floor((now - active.startedAt) / 5000)) +
                          1) %
                          shown.slides.length,
                      )
                    }
                  >
                    →
                  </button>
                </div>}
                <div
                  className="popup-progress"
                  style={{
                    width: `${Math.max(0, 100 - (now - active.startedAt) / (shown.displaySeconds * 10))}%`,
                  }}
                />
              </aside>
            )}
            <div className="stage-status">
              {active
                ? "A moment is on screen"
                : running
                  ? "Waiting for the next cue"
                  : "Ready when you are"}
              {queue.length > 0 ? ` · ${queue.length} queued` : ""}
            </div>
          </div>
          <div className="preview-actions">
            <button onClick={previewCarousel} disabled={!carousel}>
              Show carousel now
            </button>
            <button
              onClick={() => {
                try {
                  enqueue(
                    [
                      {
                        name: "Manual celebration",
                        effect: {
                          type: "celebrate",
                          message: "THIS IS YOUR MOMENT",
                        },
                      },
                    ],
                    validateAutomations(design),
                  );
                } catch (e) {
                  setNotice(e.message);
                }
              }}
            >
              Try celebration
            </button>
            <button
              onClick={() => {
                setActive(null);
                setQueue([]);
                setNotice("Preview cleared.");
              }}
            >
              Clear preview
            </button>
          </div>
          <div className="try-chat">
            <label htmlFor="preview-chat">Try a chat message</label>
            <p>
              Start with{" "}
              <button onClick={() => setMessage("merch")}>merch</button> or{" "}
              <button onClick={() => setMessage("party")}>party</button>. Change
              those words in your rules.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                evaluate({ type: "message", text: message });
              }}
            >
              <input
                id="preview-chat"
                maxLength={2000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type a message to test your rules…"
              />
              <button className="lime" type="submit">
                Test message →
              </button>
            </form>
          </div>
          <div className="try-chat">
            <label htmlFor="preview-event">Try an outside event</label>
            <p>
              Choose “A game or service sends an event” in a rule, then use the
              same event name here. This tests the response; no external service
              is connected yet.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                evaluate({ type: "external", name: externalName });
              }}
            >
              <input
                id="preview-event"
                maxLength={64}
                value={externalName}
                onChange={(e) => setExternalName(e.target.value)}
              />
              <button type="submit">Simulate event →</button>
            </form>
          </div>
          <div className="try-chat"><label htmlFor="preview-twitch-event">Preview a subscription or Hype Train</label><p>Tests your saved rule design here only. It does not create a real subscription, start a Hype Train, or send to Twitch.</p><form onSubmit={e => {e.preventDefault(); evaluate({type:"twitch",event:previewTwitchEvent,id:uid()});}}><select id="preview-twitch-event" value={previewTwitchEvent} onChange={e => setPreviewTwitchEvent(e.target.value)}>{TWITCH_AUTOMATION_EVENTS.map(event => <option key={event} value={event}>{({subscribe:"New subscription",resubscribe:"Resubscription shared in chat",gift:"Gift subscriptions",hype_begin:"Hype Train starts",hype_progress:"Hype Train progresses",hype_end:"Hype Train ends"})[event]}</option>)}</select><button type="submit">Preview Twitch event →</button></form></div>
          <div className="timer-controls">
            <button
              aria-pressed={running}
              onClick={() => {
                if (!running) {
                  engine.current = createAutomationState(
                    Date.now() + offset.current,
                  );
                  setNotice(
                    "Timers started. They run only while this preview stays open.",
                  );
                }
                setRunning((v) => !v);
              }}
            >
              {running ? "Pause timers" : "Start timers"}
            </button>
            <button
              disabled={!running}
              onClick={() => {
                offset.current += 300000;
                evaluate({ type: "tick" });
                setNow(Date.now() + offset.current);
              }}
            >
              Advance preview 5 minutes
            </button>
            <span>{running ? "Timers running" : "Timers paused"}</span>
          </div>
          <DeveloperPanel onEvent={evaluate} />
          <p className="director-notice" role="status">
            {notice}
          </p>
          <details>
            <summary>What just happened</summary>
            <ol>
              {log.map((item) => (
                <li key={item.id}>{item.text}</li>
              ))}
            </ol>
          </details>
        </section>
      </main>
    </div>
  );
}

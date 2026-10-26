import React, { useEffect, useRef, useState } from "react";
import { channelProfile, readTwitchScene, sendParty, watchTwitchScene } from "./twitch.mjs";
import { PARTY_PRESETS, partyEvent } from "./party.mjs";
import AutomationViewer from "./AutomationViewer.jsx";
import { objectAppearance, safeLink } from "./scene.mjs";
import { InteractiveWidget } from "./InteractiveWidgets.jsx";

const symbols = { spark: "✦", heart: "♡", star: "☆", gift: "◇", info: "i", bolt: "ϟ", message: "☏", link: "↗" };

// One controller per mounted mobile viewer. State is transient, bounded and
// channel-local; late requests from a previous channel cannot update this one.
export function createMobileActions({ getSession, getScene, notify, showDetail, showCount, showBurst, shareIdentity, send = sendParty, clock = Date.now, isVisible = () => true }) {
  const seen = new Set(), counts = new Map();
  let generation = 0, busy = false, nextParty = 0, personalSequence = 0;
  function acceptParty(raw) {
    const event = partyEvent(JSON.stringify(raw), clock());
    if (!event || seen.has(event.eventId) || !isVisible()) return false;
    seen.add(event.eventId);
    if (seen.size > 100) seen.delete(seen.values().next().value);
    const preset = PARTY_PRESETS[event.preset];
    showBurst({ id: event.eventId, text: preset.text, symbol: preset.symbol, actor: event.actor, shared: true });
    return true;
  }
  async function performActivate(objectId) {
    const session = getSession(), object = getScene()?.objects.find(item => item.id === objectId);
    if (!isVisible() || !object || !session?.auth?.token || session.creator?.id !== session.auth.channelId) {
      notify("Wait for this channel’s connection before tapping an object."); return;
    }
    if (object.action === "reveal") { showDetail({ title: object.title, text: object.detail }); return; }
    if (object.action === "counter") {
      const count = Math.min(Number.MAX_SAFE_INTEGER, (counts.get(object.id) || 0) + 1);
      counts.set(object.id, count); if (counts.size > 100) counts.delete(counts.keys().next().value); showCount(object.id, count); return;
    }
    if (object.action === "celebrate") {
      // A local animation key is not a credential or a delivery receipt. Older
      // Android WebViews can render the extension but lack crypto.randomUUID.
      showBurst({ id: `personal:${generation}:${++personalSequence}`, text: object.detail || "You made this moment!", symbol: symbols[object.icon] || "✦", shared: false }); return;
    }
    if (object.action !== "party") { notify("This object is not available in this Twitch view."); return; }
    if (busy || clock() < nextParty) { notify("Let the confetti settle. Wait a moment before another tap."); return; }
    // Preflight never consumes the cooldown or sends a network request.
    if (!session.linked) {
      try { shareIdentity(); notify("Share your Twitch identity, then tap again to celebrate and post in chat."); }
      catch { notify("Twitch could not open identity sharing. Reopen Scene Studio and try again."); }
      return;
    }
    if (!session.chatEnabled) { notify("The streamer has not enabled extension chat."); return; }
    const channel = session.auth.channelId, startedGeneration = generation;
    const current = () => generation === startedGeneration && getSession()?.auth?.channelId === channel;
    busy = true; nextParty = clock() + 20000;
    notify("Sending your celebration…");
    try {
      const event = await send(session.auth, object);
      if (!current()) return;
      acceptParty(event); notify("Posted in chat. Celebration sent to connected viewers!");
    } catch (error) {
      if (current()) notify(error?.message || "Result not confirmed. Check chat before another tap.");
    } finally { if (current()) busy = false; }
  }
  async function activate(objectId) {
    try { await performActivate(objectId); }
    catch { notify("This action could not be shown. Please try again."); }
  }
  return { activate, acceptParty, reset() { generation++; busy = false; nextParty = 0; seen.clear(); counts.clear(); } };
}

export function MobileObjectCards({ scene, counts = {}, onActivate }) {
  const [images, setImages] = useState({});
  useEffect(() => { setImages(old => Object.fromEntries(scene.objects.filter(item => old[item.id]).map(item => [item.id, true]))); }, [scene]);
  return <section className="mobile-objects" aria-label="Channel objects">
    {scene.objects.filter(object=>!object.popupOnly).map(object => {
      const destination = object.action === 'link' ? safeLink(object.url) : '';
      const Control = destination ? 'a' : 'button';
      const isWidget = Boolean(object.quiz || object.goal);
      return <article key={object.id} className="mobile-object" style={{ "--object-accent": object.color, ...objectAppearance(object) }}>
      {isWidget ? <div className="mobile-object-action mobile-widget-heading">
        {object.image && object.imageFit==='icon' ? <img className="mobile-custom-icon" src={object.image} alt="" /> : <span className="mobile-object-symbol" aria-hidden="true">{object.customIcon || symbols[object.icon] || "✦"}</span>}
        <div className="mobile-object-copy"><strong>{object.title}</strong><span>{object.caption}</span></div>
        <InteractiveWidget object={object} count={counts[object.id] || 0} onCount={() => onActivate(object.id)} />
      </div> : <Control className="mobile-object-action" {...(destination ? {href:destination,target:'_blank',rel:'noopener noreferrer'} : {onClick:()=>onActivate(object.id)})}>
        {object.image && object.imageFit==='icon' ? <img className="mobile-custom-icon" src={object.image} alt="" /> : <span className="mobile-object-symbol" aria-hidden="true">{object.customIcon || (object.action === "party" ? PARTY_PRESETS[object.preset ?? "ducks"].symbol : symbols[object.icon] || "✦")}</span>}
        <span className="mobile-object-copy"><strong>{object.title}</strong>
          <span>{object.action === "party" ? "Celebrate together + post in chat" : object.caption}</span>
          {object.action === "counter" && <span className="mobile-count" aria-live="polite">{counts[object.id] || 0} from you this visit{counts[object.id] ? ` · ${object.detail}` : ""}</span>}
          {object.action === "celebrate" && <small>A celebration just for you</small>}
          {destination && <small>Open website ↗</small>}
        </span>
      </Control>}
      {object.image && object.imageFit!=='icon' && <><button className="mobile-image-toggle" aria-expanded={Boolean(images[object.id])} aria-label={`${images[object.id] ? "Hide" : "Show"} image for ${object.title}`} onClick={() => setImages(old => ({ ...old, [object.id]: !old[object.id] }))}>{images[object.id] ? "Hide image" : "Show image"}</button>{images[object.id] && <img src={object.image} alt={object.title} />}</>}
    </article>})}
  </section>;
}

export default function MobileViewer({ helper = globalThis.window?.Twitch?.ext }) {
  const [auth, setAuth] = useState(null), [creator, setCreator] = useState(null), [scene, setScene] = useState(null);
  const [status, setStatus] = useState(helper ? "Connecting to this channel…" : "Open Scene Studio from the Extensions menu in the Twitch app.");
  const [notice, setNotice] = useState(""), [counts, setCounts] = useState({}), [detail, setDetail] = useState(null), [burst, setBurst] = useState(null), [visible, setVisible] = useState(true), [retry, setRetry] = useState(0);
  const session = useRef({ auth: null, creator: null }), sceneRef = useRef(null), visibleRef = useRef(true), mounted = useRef(false), controller = useRef(null);
  const detailRef = useRef(null), burstRef = useRef(null), noticeRef = useRef(null);
  sceneRef.current = scene; visibleRef.current = visible;
  if (!controller.current) controller.current = createMobileActions({
    getSession: () => ({ ...session.current, linked: helper?.viewer?.isLinked === true, chatEnabled: helper?.features?.isChatEnabled === true }),
    getScene: () => sceneRef.current, isVisible: () => mounted.current && visibleRef.current,
    notify: setNotice, showDetail: setDetail, showCount: (id, value) => setCounts(old => ({ ...old, [id]: value })), showBurst: setBurst,
    shareIdentity: () => helper.actions.requestIdShare(),
  });
  useEffect(() => {
    mounted.current = true;
    if (!helper) return () => { mounted.current = false; controller.current.reset(); };
    let active = true;
    const stop = watchTwitchScene(helper, next => { if (active) { setScene(next); setDetail(null); setCounts(old => Object.fromEntries(next.objects.filter(item => Object.hasOwn(old, item.id)).map(item => [item.id, old[item.id]]))); } }, message => { if (active) setStatus(message); }, event => { if (active) controller.current.acceptParty(event); });
    helper.onAuthorized(next => {
      if (!active) return;
      if (session.current.auth?.channelId !== next.channelId) {
        controller.current.reset(); setCounts({}); setDetail(null); setBurst(null); setNotice(""); setScene(null);
        session.current.creator = null; setCreator(null);
        const raw = helper.configuration?.broadcaster?.content;
        if (raw) { try { setScene(readTwitchScene(raw)); } catch { setStatus("This channel’s objects could not be loaded."); } }
      }
      session.current.auth = next; setAuth(next);
    });
    helper.onVisibilityChanged?.(shown => {
      if (!active) return;
      visibleRef.current = shown; setVisible(shown);
      if (!shown) { setBurst(null); setDetail(null); setNotice(""); }
    });
    return () => { active = false; mounted.current = false; stop(); controller.current.reset(); };
  }, [helper]);
  useEffect(() => {
    if (!auth) return;
    let active = true;
    channelProfile(auth).then(profile => {
      if (active && session.current.auth?.channelId === profile.id) { session.current.creator = profile; setCreator(profile); setStatus(""); }
    }).catch(() => { if (active) setStatus("The channel connection could not be confirmed. Try reconnecting below."); });
    return () => { active = false; };
  }, [auth, retry]);
  useEffect(() => {
    if (!burst) return;
    burstRef.current?.scrollIntoView?.({ block: "nearest" });
    const timer = setTimeout(() => setBurst(null), burst.shared ? 6000 : 3000);
    return () => clearTimeout(timer);
  }, [burst]);
  useEffect(() => {
    if (!detail) return;
    detailRef.current?.focus({ preventScroll: true });
    detailRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [detail]);
  useEffect(() => { if (notice) noticeRef.current?.scrollIntoView?.({ block: "nearest" }); }, [notice]);
  const ready = creator?.id === auth?.channelId && Boolean(creator);
  return <main className="mobile-viewer">
    <header className="mobile-header"><span>SCENE STUDIO</span><h1>{ready ? `@${creator.login}` : "Your channel’s interactive space"}</h1><p>Tap an object. Live moments appear here while this view is open.</p></header>
    {status && <p className="mobile-status" role="status">{status}</p>}
    {auth && !ready && <button className="mobile-secondary" onClick={() => setRetry(value => value + 1)}>Retry channel connection</button>}
    {ready && scene?.objects.length > 0 && <MobileObjectCards scene={scene} counts={counts} onActivate={id => void controller.current.activate(id)} />}
    {ready && (!scene || !scene.objects.length) && <p className="mobile-empty">No tap-to-play objects are set up yet. Stay here to see new live moments from the streamer.</p>}
    {notice && <div className="mobile-notice" role="status" ref={noticeRef}><p>{notice}</p><button aria-label="Dismiss status" onClick={() => setNotice("")}>Dismiss</button></div>}
    {detail && <section className="mobile-detail" aria-label={detail.title} ref={detailRef} tabIndex={-1}><h2>{detail.title}</h2><p>{detail.text}</p><button onClick={() => setDetail(null)}>Close message</button></section>}
    {ready && burst && <section className="mobile-burst" role="status" ref={burstRef}><span aria-hidden="true">{burst.symbol} ✦ {burst.symbol}</span><strong>{burst.text}</strong>{burst.actor && <p>@{burst.actor} started this</p>}<button onClick={() => setBurst(null)}>Dismiss celebration</button></section>}
    {visible && ready && <AutomationViewer helper={helper} auth={auth} creator={creator} viewMode="mobile" brandImage={scene?.objects.find(o=>o.image && o.imageFit==='icon')?.image} />}
    {ready && <footer>Objects by @{creator.login} · Made with Scene Studio</footer>}
  </main>;
}

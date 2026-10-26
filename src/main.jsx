import React, { useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-800.css";
import {
  ACTIONS,
  ICONS,
  STORAGE_KEY,
  MAX_OBJECTS,
  aiPrompt,
  bytes,
  id,
  moveObject,
  newObject,
  objectAppearance,
  parseScene,
  safeLink,
  starterScene,
  validateScene,
} from "./scene.mjs";
import "./style.css";
import { PARTY_PRESETS } from "./party.mjs";
import AutomationViewer from "./AutomationViewer.jsx";
import AutomationStudio from "./AutomationStudio.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import { InteractiveWidget } from "./InteractiveWidgets.jsx";
import DeveloperPanel from "./DeveloperPanel.jsx";
import { TEMPLATE_OPTIONS, createTemplate, createInteractivePreset } from "./templates.mjs";
import ExperienceHome from "./ExperienceHome.jsx";
import {
  prepareImage,
  publishImages,
  preflightPublish,
  imageLibrary,
  deleteImage,
} from "./images.mjs";
import {
  readTwitchScene,
  watchTwitchScene,
  sendTwitchScene,
  channelProfile,
  sendParty,
  getChatConnection,
  startChatConnection,
  disconnectChatConnection,
} from "./twitch.mjs";

const symbols = {
  spark: "✦",
  heart: "♡",
  star: "☆",
  gift: "◇",
  info: "i",
  bolt: "ϟ",
  message: "☏",
  link: "↗",
};
const names = {
  party: "Celebrate with chat",
  reveal: "Reveal a message",
  counter: "Collect a reaction",
  celebrate: "Start a celebration",
  link: "Open a website",
};
const descriptions = {
  party: "A shared animation and a preset chat message.",
  reveal: "A story, schedule, clue, or surprise.",
  counter: "A little love, one tap at a time.",
  celebrate: "Give viewers a moment of delight.",
  link: "Your world beyond the stream.",
};
const isViewer = location.pathname.endsWith("/viewer.html");
const isConfig = location.pathname.endsWith("/config.html");
const helper = window.Twitch?.ext;

function Modal({ title, children, onClose, status }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button onClick={onClose} aria-label="Close dialog">
          ×
        </button>
      </div>
      {status && (
        <p role="status" className="dialog-status">
          {status}
        </p>
      )}
      {children}
    </dialog>
  );
}

function ChatConnectionPanel({ auth, canManage, linked, onLink }) {
  const [connection, setConnection] = useState(null);
  const [authorization, setAuthorization] = useState(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const pending = useRef(false);

  async function act(action) {
    if (!canManage || !linked || pending.current) return;
    const current = generation.current;
    pending.current = true;
    setWorking(true);
    setMessage("");
    try {
      if (action === "connect") {
        const next = await startChatConnection(auth);
        if (current !== generation.current) return;
        setAuthorization(next);
        setMessage("Continue on Twitch to review the permission, then return here and check the connection.");
      } else if (action === "disconnect") {
        const next = await disconnectChatConnection(auth);
        if (current !== generation.current) return;
        setAuthorization(null);
        setConnection(previous => ({ available: previous?.available ?? true, connected: false, reconnectRequired: false }));
        setMessage(next.accessRevoked
          ? "Disconnected. The stored connection was removed and its access token was revoked. You can also remove the full app authorization in Twitch Connections."
          : "The stored connection was removed. Access-token revocation could not be confirmed; remove Scene Studio in Twitch Connections to revoke the full app authorization.");
      } else {
        const next = await getChatConnection(auth);
        if (current !== generation.current) return;
        setConnection(next);
        if (next.connected && !next.reconnectRequired) setAuthorization(null);
        setMessage(!next.available ? "Shared chat is not enabled for this channel yet. You can still build and preview your overlay."
          : next.reconnectRequired ? "Twitch needs you to reconnect before shared chat can work."
          : next.connected ? "Connected. Enabled shared-chat actions can check channel bans and timeouts."
          : "Not connected. Your overlay and personal effects still work.");
      }
    } catch (error) {
      if (current === generation.current) setMessage(error.message);
    } finally {
      if (current === generation.current) { pending.current = false; setWorking(false); }
    }
  }

  useEffect(() => {
    generation.current += 1;
    pending.current = false;
    setWorking(false);
    setConnection(null);
    setAuthorization(null);
    setMessage("");
    if (canManage && linked && auth?.token) act("check");
    return () => { generation.current += 1; };
  }, [auth?.token, auth?.channelId, canManage, linked]);

  return <>
    <p>This connection is optional. It is only needed for shared celebrations that also post in chat. Your images, reveal cards, personal effects, and local preview work without it.</p>
    <p>On enabled channels, Twitch's <strong>moderation:read</strong> permission lets Scene Studio check bans and timeouts before shared-chat actions. It cannot ban or time out anyone.</p>
    {!canManage ? <p className="hint">Open Scene Studio's configuration for your own channel in Twitch to manage this connection. The local editor never requests this permission.</p>
      : !linked ? <><p>Connect your broadcaster identity first. This is separate from the optional moderation permission.</p><button onClick={onLink}>Connect Twitch identity</button></>
      : <>
        <p role="status">{working ? "Checking with Twitch…" : message || "Check the connection to see whether shared chat is available."}</p>
        <div className="modal-actions">
          <button disabled={working} onClick={() => act("check")}>Check connection</button>
          {connection?.available && (!connection.connected || connection.reconnectRequired) && <button className="primary" disabled={working} onClick={() => act("connect")}>{connection.reconnectRequired ? "Reconnect shared chat" : "Connect shared chat"}</button>}
          {(connection?.connected || connection?.reconnectRequired) && <button disabled={working} onClick={() => act("disconnect")}>Disconnect shared chat</button>}
        </div>
        {authorization && <p><a href={authorization.authorizeUrl} target="_blank" rel="noopener noreferrer" onClick={event => {
          if (authorization.expiresAt <= Date.now()) { event.preventDefault(); setAuthorization(null); setMessage("That authorization link expired. Choose Connect shared chat again."); }
        }}>Continue on Twitch ↗</a><br /><small>Review the permission there, then return and choose Check connection.</small></p>}
        <p className="fine-print">Disconnect removes the stored connection and attempts to revoke its access token. To remove the full app authorization, even after token revocation succeeds, remove Scene Studio from <a href="https://www.twitch.tv/settings/connections" target="_blank" rel="noopener noreferrer">Twitch Connections</a>. Your saved overlay and images stay in place.</p>
      </>}
  </>;
}

const PREVIEW_SHAPES = [
  { key: "desktop", label: "Desktop · 16:9", ratio: 16 / 9 },
  { key: "wide", label: "Wide · 21:9", ratio: 21 / 9 },
  { key: "classic", label: "Classic · 4:3", ratio: 4 / 3 },
  { key: "portrait", label: "Portrait · 9:16", ratio: 9 / 16 },
];

function PreviewViewport({ value, onChange, children, fullscreen = false }) {
  const controlId = useId();
  const frame = useRef(null);
  const [size, setSize] = useState(null);
  const shape = PREVIEW_SHAPES.find(item => item.key === value.shape) ?? PREVIEW_SHAPES[0];
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  return <div className={`preview-viewport${fullscreen ? " fullscreen-viewport" : ""}`}>
    <div className="preview-viewport-controls" role="group" aria-label="Preview screen size">
      <label htmlFor={`${controlId}-shape`}>Screen shape
        <select id={`${controlId}-shape`} value={shape.key} onChange={event => onChange({ ...value, shape: event.target.value })}>
          {PREVIEW_SHAPES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      </label>
      <label className="preview-width-control" htmlFor={`${controlId}-width`}>Preview width <output htmlFor={`${controlId}-width`}>{value.width}px max</output>
        <input id={`${controlId}-width`} type="range" min="320" max="1280" step="16" value={value.width}
          aria-valuetext={`${value.width} pixels maximum; fits available space`}
          onChange={event => onChange({ ...value, width: Number(event.target.value) })} />
      </label>
      <span className="preview-size-readout">{size ? `${size.width} × ${size.height}px shown` : "Fits available space"}</span>
    </div>
    <div className="preview-viewport-space" style={{ "--preview-width": `${value.width}px`, "--preview-ratio": shape.ratio, "--preview-height-width": `${shape.ratio * 100}cqh` }}>
      <div className="preview-viewport-frame" ref={frame}>{children}</div>
    </div>
    <p className="preview-viewport-note">Screen size changes this preview, not your saved layout. This does not confirm Twitch mobile support.</p>
    {size && size.width < 320 && <p className="preview-viewport-note">Scaled down to fit this space. A multi-column layout keeps its columns; use a portrait-specific layout for larger objects and readable text.</p>}
  </div>;
}

function SceneObjectControl({ widget, children, ...props }) {
  return widget ? <div {...props} role="group">{children}</div> : <button {...props}>{children}</button>;
}

function Scene({
  scene,
  editing = false,
  selected,
  onSelect,
  onChange,
  backdrop = false,
  sharedEvent = null,
  onParty,
  beforeParty,
}) {
  const stage = useRef(null),
    drag = useRef(null);
  const [counts, setCounts] = useState({}),
    [detail, setDetail] = useState(null),
    [burst, setBurst] = useState(null),
    [partyNotice, setPartyNotice] = useState("");
  const seenParties = useRef(new Set()), partyBusy = useRef(false), nextParty = useRef(0);
  function showParty(event) {
    if(!event || seenParties.current.has(event.eventId)) return;
    // HTTP acknowledgments and broadcasts can arrive in either order, even
    // across multiple parties. Remember both paths without growing forever.
    seenParties.current.add(event.eventId);
    if(seenParties.current.size>100) seenParties.current.delete(seenParties.current.values().next().value);
    const preset=PARTY_PRESETS[event.preset];
    setBurst({id:event.eventId,text:preset.text,color:preset.color,symbol:preset.symbol,actor:event.actor,preset:event.preset});
  }
  useEffect(()=>{showParty(sharedEvent);},[sharedEvent]);
  useEffect(() => {
    if (!burst) return;
    const t = setTimeout(() => setBurst(null), burst.preset ? 4200 : 1600);
    return () => clearTimeout(t);
  }, [burst]);
  async function activate(o) {
    if (editing) return onSelect(o.id);
    if (o.action === "reveal") setDetail(o);
    if (o.action === "counter")
      setCounts((c) => ({ ...c, [o.id]: (c[o.id] || 0) + 1 }));
    if (o.action === "celebrate")
      setBurst({
        id: id(),
        text: o.detail || "You made this moment!",
        color: o.color,
      });
    if(o.action === "party") {
      if(!onParty) {
        showParty({eventId:id(),preset:o.preset??"ducks",actor:"Preview"});
        setPartyNotice("Preview only — no chat message sent.");
        return;
      }
      if(partyBusy.current || Date.now()<nextParty.current) {setPartyNotice("Let the confetti settle. Wait a moment before another click.");return;}
      try {
        // Identity prompts and disabled chat have not sent anything, so they
        // must not consume the viewer's cooldown.
        beforeParty?.();
        partyBusy.current=true;
        nextParty.current=Date.now()+20000;
        setPartyNotice("Sending your celebration…");
        const event=await onParty(o);showParty(event);setPartyNotice("Posted in chat. Party delivered!");
      }
      catch(error){setPartyNotice(error.message||"Result not confirmed. Check chat before another click.");}
      finally{partyBusy.current=false;}
    }
    if (o.action === "link") {
      try {
        const url = safeLink(o.url);
        if (url) window.open(url, "_blank", "noopener,noreferrer");
        else
          setDetail({
            ...o,
            detail: "This object does not have a website yet.",
          });
      } catch {
        setDetail({ ...o, detail: "This website address is not available." });
      }
    }
  }
  return (
    <div
      className={`stage ${backdrop ? "backdrop" : ""}`}
      ref={stage}
      aria-label="Interactive scene"
    >
      {backdrop && (
        <div className="stage-art" aria-hidden="true">
          <span className="live-dot">TWITCH PLAYER PREVIEW</span>
          <div className="horizon" />
          <div className="scene-caption">
            <small>CLICKABLE OBJECTS OVER YOUR STREAM</small>
            <strong>
              Make room
              <br />
              for possibility.
            </strong>
          </div>
          <span className="stage-watermark">
            Sample background · not part of your overlay
          </span>
        </div>
      )}
      {scene.objects.filter(o=>editing || !o.popupOnly).map((o) => (
        <div
          key={o.id}
          className="scene-object-frame"
          style={{
            left: o.x + "%",
            top: o.y + "%",
            width: o.width + "%",
            height: o.height + "%",
            "--accent": o.color,
          }}
        >
        <div className={`scene-object-motion motion-${!editing && ["float", "pulse", "sway"].includes(o.motion) ? o.motion : "none"}`}>
        <SceneObjectControl widget={!editing && Boolean(o.quiz || o.goal)}
          style={objectAppearance(o)}
          aria-label={editing ? `Edit ${o.title}` : o.title}
          title={[o.title, o.caption].filter(Boolean).join(" — ")}
          className={`scene-object ${o.shape} image-fit-${o.imageFit ?? 'cover'} ${selected === o.id && editing ? "selected" : ""} ${o.image ? "has-image" : ""} ${o.quiz || o.goal ? "interactive-object" : ""}`}
          onClick={() => { if (editing || (!o.quiz && !o.goal)) activate(o); }}
          onPointerDown={(e) => {
            if (!editing || e.button !== 0) return;
            onSelect(o.id);
            const rect = stage.current.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            drag.current = {
              id: o.id,
              offsetX: ((e.clientX - rect.left) / rect.width) * 100 - o.x,
              offsetY: ((e.clientY - rect.top) / rect.height) * 100 - o.y,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.id !== o.id) return;
            const rect = stage.current.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            onChange(
              moveObject(
                o,
                ((e.clientX - rect.left) / rect.width) * 100 - d.offsetX,
                ((e.clientY - rect.top) / rect.height) * 100 - d.offsetY,
              ),
              false,
            );
          }}
          onPointerUp={() => {
            if (drag.current) {
              drag.current = null;
              onChange(null, true);
            }
          }}
          onPointerCancel={() => {
            drag.current = null;
            onChange?.(null, true);
          }}
          onKeyDown={(e) => {
            if (
              !editing ||
              isConfig ||
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                e.key,
              )
            )
              return;
            e.preventDefault();
            const step = e.shiftKey ? 5 : 1;
            onChange(
              moveObject(
                o,
                o.x +
                  (e.key === "ArrowRight"
                    ? step
                    : e.key === "ArrowLeft"
                      ? -step
                      : 0),
                o.y +
                  (e.key === "ArrowDown"
                    ? step
                    : e.key === "ArrowUp"
                      ? -step
                      : 0),
              ),
              true,
            );
          }}
        >
          {(o.quiz || o.goal) ? <>{o.image && <img src={o.image} alt="" draggable="false" />}{(editing || o.goal) && <span className="object-copy"><strong>{o.title}</strong><span>{o.caption}</span></span>}<InteractiveWidget object={o} count={counts[o.id] || 0} onCount={() => activate(o)} editing={editing} onComplete={() => setBurst({id:id(),text:o.quiz ? "Correct!" : "Challenge complete!",color:o.color})} /></> : <>
          {o.image && <img src={o.image} alt="" draggable="false" />}
          <span className="object-icon">{o.customIcon || (o.action === "party" ? PARTY_PRESETS[o.preset??"ducks"].symbol : symbols[o.icon])}</span>
          <span className="object-copy">
            <strong>{o.title}</strong>
            <span>
              {o.action === "counter" && !editing
                ? `${counts[o.id] || 0} from you this visit`
                : o.action === "party" ? "Celebrate together + post in chat" : o.caption}
            </span>
            {o.action === "counter" && !editing && counts[o.id] > 0 && (
              <span>{o.detail}</span>
            )}
          </span>
          {o.shape !== "circle" && (
            <span className="object-arrow">
              {o.action === "link" ? "↗" : "+"}
            </span>
          )}
          </>}
        </SceneObjectControl>
        </div>
        </div>
      ))}
      {!scene.objects.length && backdrop && (
        <div className="empty-stage">
          Your canvas is open.
          <br />
          <span>Add your first object from the left.</span>
        </div>
      )}
      {burst && (
        <div
          className={`celebration ${burst.preset ? "shared-party " + burst.preset : ""}`}
          key={burst.id}
          role="status"
          style={{ "--accent": burst.color }}
        >
          <strong>{burst.text}</strong>
          {burst.actor && <span className="party-actor">{burst.actor} started this</span>}
          {Array.from({ length: 22 }, (_, i) => (
            <i key={i} style={{ "--i": i }}>
              {burst.symbol || "✦"}
            </i>
          ))}
        </div>
      )}
      {partyNotice && <div className="party-notice" role="status">{partyNotice}<button aria-label="Dismiss celebration status" onClick={()=>setPartyNotice("")}>×</button></div>}
      {detail && (
        <Modal title={detail.title} onClose={() => setDetail(null)}>
          <p className="message-body">{detail.detail}</p>
        </Modal>
      )}
    </div>
  );
}

function Presentation({scene,onClose,viewport,onViewportChange}) {
  const ref=useRef(null);
  useEffect(()=>{
    const previous=document.activeElement;
    ref.current.showModal();
    return ()=>previous?.focus();
  },[]);
  return <dialog className="presentation" ref={ref} onCancel={onClose} aria-label="Viewer preview">
    <header className="presentation-header">
      <div><small>SCENE STUDIO · VIEWER PREVIEW</small><h2>{scene.name}</h2></div>
      <button onClick={onClose}>← Back to editor</button>
    </header>
    <PreviewViewport value={viewport} onChange={onViewportChange} fullscreen><Scene scene={scene} backdrop /></PreviewViewport>
    <p className="presentation-note">Click any object to try it. This is a preview; celebrations here do not post to Twitch chat. Website buttons open the actual destination.</p>
  </dialog>;
}

function Viewer() {
  const [scene, setScene] = useState(null),
    [creator, setCreator] = useState(null),
    [status, setStatus] = useState("Waiting for the channel’s scene…"),
    [sharedEvent,setSharedEvent]=useState(null),
    [automationAuth,setAutomationAuth]=useState(null);
  const partyAuth=useRef(null);
  useEffect(() => {
    document.body.classList.add("viewer");
    if (!helper) {
      setStatus("Open this viewer through Twitch to load the channel’s scene.");
      return;
    }
    let active = true;
    helper.onAuthorized((auth) => {
      if (!active) return;
      partyAuth.current=auth;
      setAutomationAuth(auth);
      setCreator(previous => previous?.id === auth.channelId ? previous : null);
      channelProfile(auth)
        .then((profile) => {
          if (active && partyAuth.current === auth && profile.id === auth.channelId) setCreator(profile);
        })
        .catch(() => {if(active && partyAuth.current === auth) setStatus("The channel’s creator could not be confirmed. Refresh to try again.");});
    });
    const stop = watchTwitchScene(helper, setScene, setStatus,setSharedEvent);
    return () => {
      active = false;
      stop();
    };
  }, []);
  return <><AutomationViewer helper={helper} auth={automationAuth} creator={creator} brandImage={scene?.objects.find(o=>o.image && o.imageFit==='icon')?.image} />{scene && (creator || scene.objects.length === 0) ? (
    <>
      <Scene scene={scene} sharedEvent={sharedEvent} beforeParty={()=>{
        if(!helper.viewer.isLinked) {helper.actions.requestIdShare();throw new Error("Link your identity, then click again to celebrate and post in chat.");}
        if(!helper.features?.isChatEnabled) throw new Error("The streamer has not enabled extension chat.");
      }} onParty={object=>sendParty(partyAuth.current,object)} />
      {creator && scene.objects.length > 0 && (
        <span className="creator-credit">Objects by {creator.login}</span>
      )}
    </>
  ) : (
    <div className="viewer-status">{status || "Confirming the creator of these objects…"}</div>
  )}</>;
}

function Editor() {
  const bundleApi = useRef(null);
  const [homeOpen, setHomeOpen] = useState(true),
    [flowRequest, setFlowRequest] = useState(null),
    [flowPages, setFlowPages] = useState([]);
  const [automationOpen, setAutomationOpen] = useState(false),
    [automationSession, setAutomationSession] = useState(null);
  const [scene, setScene] = useState(() => {
    if (isConfig) return starterScene();
    try {
      return parseScene(localStorage.getItem(STORAGE_KEY) || "");
    } catch {
      return starterScene();
    }
  });
  const [selected, setSelected] = useState(scene.objects[0]?.id),
    [preview, setPreview] = useState(false),
    [viewport, setViewport] = useState({ shape: "desktop", width: 960 }),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState(null),
    [json, setJson] = useState(""),
    [authorized, setAuthorized] = useState(false),
    [linked, setLinked] = useState(false),
    [profile, setProfile] = useState(null),
    [profileStatus, setProfileStatus] = useState("idle"),
    [publishBarHeight, setPublishBarHeight] = useState(null),
    [busy, setBusy] = useState(false),
    [library, setLibrary] = useState([]),
    [removeImage, setRemoveImage] = useState(null),
    [configReady, setConfigReady] = useState(!isConfig),
    [saveStatus, setSaveStatus] = useState("Saved on this device");
  const sceneRef = useRef(scene),
    authRef = useRef(null),
    editorChannel = useRef(null),
    channelChanged = useRef(false),
    profileRequest = useRef(0),
    publishBarRef = useRef(null),
    lastSentScene = useRef(null),
    lastLoadedScene = useRef(null),
    titleInput = useRef(null),
    focusNewTitle = useRef(false),
    edited = useRef(false),
    history = useRef([]),
    checkpoint = useRef(scene),
    [undoCount, setUndoCount] = useState(0),
    fileRef = useRef(null);
  sceneRef.current = scene;
  const object = scene.objects.find((o) => o.id === selected);
  const websiteLinks = scene.objects.filter(o => o.action === 'link');
  let publishProblem = '';
  try { preflightPublish(scene, isConfig ? authRef.current?.channelId : undefined); } catch(error) { publishProblem = error.message; }
  const cannotPublish = busy || Boolean(publishProblem) || (isConfig && (!authorized || !configReady || (scene.objects.length > 0 && (!linked || !profile))));
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (publishBarRef.current) setPublishBarHeight(Math.ceil(publishBarRef.current.getBoundingClientRect().height));
    });
    observer.observe(publishBarRef.current);
    return () => observer.disconnect();
  }, []);
  async function refreshChannelProfile(auth = authRef.current, retrying = false) {
    const requestId = ++profileRequest.current;
    const channelId = auth?.channelId, helixToken = auth?.helixToken;
    const stillCurrent = () => requestId === profileRequest.current && authRef.current === auth &&
      authRef.current?.channelId === channelId && authRef.current?.helixToken === helixToken;
    setProfile(null);
    setProfileStatus(retrying ? "retrying" : "loading");
    try {
      const next = await channelProfile(auth);
      if (stillCurrent()) { setProfile(next); setProfileStatus("ready"); }
    } catch {
      if (stillCurrent()) { setProfile(null); setProfileStatus("failed"); }
    }
  }
  useEffect(()=>{
    if(focusNewTitle.current && titleInput.current) {
      focusNewTitle.current=false;
      titleInput.current.focus();
      titleInput.current.select();
    }
  },[selected]);
  useEffect(() => {
    if (isConfig) {
      setSaveStatus(
        !configReady ? "Loading your channel’s overlay…"
          : JSON.stringify(scene) === JSON.stringify(lastSentScene.current) ? "Sent to Twitch"
          : JSON.stringify(scene) === JSON.stringify(lastLoadedScene.current) ? "Loaded from Twitch"
          : "Unsaved changes",
      );
      return;
    }
    try {
      validateScene(scene);
    } catch {
      setSaveStatus("Finish this edit to save. Your last valid draft is safe.");
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
      setSaveStatus("Saved on this device");
    } catch {
      setSaveStatus("Device storage is full. Export your design.");
    }
  }, [scene, configReady]);
  useEffect(() => {
    if (!isConfig || !helper) return;
    let active = true;
    helper.onAuthorized((auth) => {
      if (!active) return;
      if (channelChanged.current || (editorChannel.current && editorChannel.current !== auth.channelId)) {
        // Twitch configuration callbacks carry no channel ID. Keep the old draft
        // exportable but require a fresh iframe before binding another channel.
        channelChanged.current = true;
        authRef.current = null;
        setAuthorized(false); setLinked(false); setConfigReady(false);
        setProfile(null); setAutomationSession(null);
        setNotice("The Twitch channel changed. Export any unsaved objects, then reopen this channel's extension configuration before editing or publishing.");
        return;
      }
      editorChannel.current = auth.channelId;
      authRef.current = auth;
      setAutomationSession({ auth, viewer: { role: helper.viewer?.role, isLinked: helper.viewer?.isLinked === true } });
      setAuthorized(helper.viewer?.role === "broadcaster");
      setLinked(Boolean(helper.viewer?.isLinked));
      refreshChannelProfile(auth);
    });
    helper.configuration.onChanged(() => {
      if (!active || channelChanged.current) return;
      const raw = helper.configuration.broadcaster?.content;
      setConfigReady(true);
      if (raw) {
        try {
          const next = readTwitchScene(raw);
          lastLoadedScene.current = next;
          setJson(JSON.stringify(next, null, 2));
          if (!edited.current) {
            setScene(next);
            setSelected(next.objects[0]?.id);
            checkpoint.current = next;
            setNotice("Your channel’s saved overlay is ready to edit.");
          } else
            setNotice(
              "A saved overlay is available. Your current edits have been kept.",
            );
        } catch {
          setNotice("The saved Twitch scene could not be read.");
        }
      }
    });
    return () => { active = false; profileRequest.current += 1; authRef.current = null; };
  }, []);
  function commit(next, complete = true) {
    edited.current = true;
    if (next) setScene(next);
    if (complete) {
      const current = next || sceneRef.current;
      if (JSON.stringify(checkpoint.current) !== JSON.stringify(current)) {
        history.current = [...history.current.slice(-29), checkpoint.current];
        checkpoint.current = current;
        setUndoCount(history.current.length);
      }
    }
  }
  function change(o, complete = true) {
    commit(
      o
        ? {
            ...sceneRef.current,
            objects: sceneRef.current.objects.map((item) =>
              item.id === o.id ? o : item,
            ),
          }
        : null,
      complete,
    );
  }
  function update(patch) {
    if (!object) return;
    const next = { ...object, ...patch };
    change(moveObject(next, next.x, next.y));
  }
  function changeAction(action) {
    if (!object) return;
    const next = { ...object, action };
    if (action !== "reveal") delete next.quiz;
    if (action !== "counter") delete next.goal;
    change(moveObject(next, next.x, next.y));
  }
  function addInteractivePreset(key) {
    try {
      const objects = createInteractivePreset(key);
      if (scene.objects.length + objects.length > MAX_OBJECTS) {
        setNotice(`This starter needs ${objects.length} open object slot${objects.length === 1 ? "" : "s"}. Your scene can contain up to ${MAX_OBJECTS} objects.`);
        return;
      }
      const gridX = [5, 36, 67], gridY = [5, 36, 65];
      const placed = [...scene.objects];
      const added = objects.map(item => {
        const candidates = gridY.flatMap(y => gridX.map(x => ({ x: Math.min(x, 100 - item.width), y: Math.min(y, 100 - item.height) })));
        const position = candidates.map((candidate, order) => ({
          ...candidate, order,
          overlap: placed.reduce((sum, other) => sum + Math.max(0, Math.min(candidate.x + item.width, other.x + other.width) - Math.max(candidate.x, other.x)) * Math.max(0, Math.min(candidate.y + item.height, other.y + other.height) - Math.max(candidate.y, other.y)), 0),
        })).sort((a, b) => a.overlap - b.overlap || a.order - b.order)[0];
        const next = { ...item, x: position.x, y: position.y };
        placed.push(next);
        return next;
      });
      const next = validateScene({ ...scene, objects: [...scene.objects, ...added] });
      commit(next);
      setHomeOpen(false);
      focusNewTitle.current = true;
      setSelected(added[0]?.id);
      setPreview(false);
      setNotice(key === "shared-party" ? "Party starters added. Chat messages require the channel’s optional chat connection; viewer preview never posts to chat." : "Added to your current draft. Customize it, then try it in the viewer preview.");
    } catch (error) {
      setNotice(error.message);
    }
  }
  function addLayoutBundle({ flowKeys = [], widgetKeys = [] }) {
    const additions = [...new Set(widgetKeys)].flatMap(createInteractivePreset);
    if (scene.objects.length + additions.length > MAX_OBJECTS) throw new Error(`These layouts need ${additions.length} object slots. Your scene has ${MAX_OBJECTS - scene.objects.length} available; choose fewer layouts or remove an existing object.`);
    const nextScene = validateScene({ ...scene, objects: [...scene.objects, ...additions] });
    if (flowKeys.length) {
      if (!bundleApi.current) throw new Error("The live moment editor is still loading. Try again shortly.");
      bundleApi.current.add(flowKeys);
    }
    if (additions.length) { commit(nextScene); setSelected(additions[0].id); }
    setNotice(`Added your selected layouts. Open each experience to customize its animation, text, timing, and placement.`);
    // Stay on the overview so every selected layout remains easy to find.
  }
  function add(action) {
    if (scene.objects.length >= MAX_OBJECTS) {
      setNotice("You can have up to 12 objects in a scene.");
      return;
    }
    const next = newObject(action);
    commit({ ...scene, objects: [...scene.objects, next] });
    focusNewTitle.current=true;
    setSelected(next.id);
    setPreview(false);
  }
  function undo() {
    const last = history.current.pop();
    if (last) {
      setScene(last);
      setSelected(current => last.objects.some(o=>o.id===current) ? current : last.objects[0]?.id);
      checkpoint.current = last;
      setUndoCount(history.current.length);
    }
  }
  function applyImport(raw) {
    try {
      const next = parseScene(raw);
      commit(next);
      setSelected(next.objects[0]?.id);
      setPreview(false);
      setModal(null);
      setNotice("Design imported. Try it in preview.");
    } catch (e) {
      setNotice(e.message);
    }
  }
  function chooseTemplate(key) {
    applyImport(JSON.stringify(createTemplate(key)));
    setNotice("Layout ready. Click an object to personalize it. Undo restores your previous design.");
  }
  function download() {
    try {
      const clean = validateScene(scene),
        url = URL.createObjectURL(
          new Blob([JSON.stringify(clean, null, 2)], {
            type: "application/json",
          }),
        );
      const a = document.createElement("a");
      a.href = url;
      a.download = "scene-studio.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Design exported. Keep it as a backup or share it to remix.");
    } catch (e) {
      setNotice(e.message);
    }
  }
  async function upload(file) {
    if (!file) return;
    const target = object?.id;
    if (!target) return;
    try {
      const data = await prepareImage(file);
      const current = sceneRef.current;
      const next = validateScene({
        ...current,
        objects: current.objects.map((o) =>
          o.id === target ? { ...o, image: data } : o,
        ),
      });
      commit(next);
      setNotice(
        "Image resized and ready to preview. Save overlay on Twitch to make it public for viewers.",
      );
    } catch (e) {
      setNotice(e.message);
    }
  }
  async function saveTwitch() {
    if (busy) return;
    try {
      if (publishProblem) throw new Error(publishProblem);
      if (!authorized || !helper)
        throw new Error(
          "Open the configuration page as the broadcaster in Twitch to save.",
        );
      if (!configReady)
        throw new Error("Wait for your channel’s overlay to finish loading.");
      if (scene.objects.length && !linked)
        throw new Error(
          "Choose Connect Twitch identity before publishing your objects.",
        );
      if (scene.objects.length && !profile)
        throw new Error(
          "Wait for Twitch to confirm your channel, then save again.",
        );
      setBusy(true);
      setNotice("Preparing your overlay…");
      const snapshot = sceneRef.current;
      const publishingAuth = authRef.current;
      const prepared = await publishImages(snapshot, publishingAuth);
      if (channelChanged.current || !authRef.current || authRef.current.channelId !== publishingAuth?.channelId || helper.viewer?.role !== "broadcaster" || (prepared.objects.length && !helper.viewer?.isLinked))
        throw new Error("Your Twitch channel or permissions changed during upload. Nothing was published; reopen configuration for the intended channel.");
      const message = sendTwitchScene(helper, prepared);
      lastSentScene.current = prepared;
      // Keep edits made during a slow upload; never overwrite a newer draft.
      if (sceneRef.current === snapshot) commit(prepared);
      setNotice(message);
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function openImages() {
    setModal("images");
    setRemoveImage(null);
    setBusy(true);
    try {
      setLibrary(await imageLibrary(authRef.current));
      setNotice("");
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function eraseImage() {
    if (!removeImage || busy) return;
    setBusy(true);
    try {
      await deleteImage(removeImage, authRef.current);
      setLibrary((items) => items.filter((item) => item.url !== removeImage));
      setRemoveImage(null);
      setNotice(
        "Image removed from hosting. Older exported designs using it will show no image.",
      );
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
    {homeOpen && <ExperienceHome objects={scene.objects} flows={flowPages} channelName={profile?.login} live={isConfig}
      onChooseWidget={addInteractivePreset}
      onChooseBundle={addLayoutBundle}
      onOpenAI={() => { setHomeOpen(false); setAutomationOpen(false); setJson(""); setModal("ai"); }}
      onChooseFlow={key => { setFlowRequest({ key, requestId: crypto.randomUUID() }); setHomeOpen(false); setAutomationOpen(true); }}
      onEditObject={id => { setSelected(id); setPreview(false); setHomeOpen(false); setAutomationOpen(false); }}
      onEditFlows={pageId => { setFlowRequest({ pageId, requestId: crypto.randomUUID() }); setHomeOpen(false); setAutomationOpen(true); }}
      onOpenCanvas={() => { setHomeOpen(false); setAutomationOpen(false); }}
      onOpenAdvanced={() => { setHomeOpen(false); setAutomationOpen(false); setModal('advanced'); }} />}
    {homeOpen && notice && <p className="home-feedback" role="status">{notice}</p>}
    <div hidden={automationOpen || homeOpen}>
    <div className={`app-shell editor-refresh${isConfig ? ' is-twitch-config' : ''}`} style={publishBarHeight == null ? undefined : { "--publish-bar-height": `${publishBarHeight}px` }}>
      <header className="topbar">
        <a className="brand" href={isConfig ? "./config.html" : "./"}>
          <span>✳</span> scene<span className="brand-light">studio</span>
          <sup>EARLY BUILD</sup>
        </a>
        <div className="top-actions">
          <button onClick={() => setHomeOpen(true)}>← Your experiences</button>
          <ThemeToggle />
          <span className="save-status">● {saveStatus}</span>
          {profile && (
            <span
              className="channel-identity"
              title={`Twitch channel ${profile.id}`}
            >
              {profile.login}
            </span>
          )}
          {isConfig && authorized && !linked && (
            <button onClick={() => helper.actions.requestIdShare()}>
              Connect Twitch identity
            </button>
          )}
          {isConfig && <button onClick={()=>{setJson(JSON.stringify(scene,null,2));setNotice('');setModal('expert');}}>Expert mode & API</button>}
          <button disabled={busy || (isConfig && !authorized)} onClick={() => {
            setAutomationOpen(true);
          }}>Live action builder →</button>
          <button onClick={() => setModal("present")}>Open viewer preview ↗</button>
          <button
            className="primary"
            disabled={cannotPublish}
            onClick={isConfig ? saveTwitch : () => setModal("publish")}
          >
            {busy ? "Publishing…" : "Publish to Twitch"}{" "}
            <span>→</span>
          </button>
        </div>
      </header>
      <main>
        <div className="editor-toolbar">
          <div><h1>Build your overlay</h1><p>Add an object, drag it into place, then publish.</p></div>
          <nav className="editor-mode-tabs" aria-label="More editor tools">
            <button onClick={()=>setModal('advanced')}>Layouts &amp; advanced tools…</button>
          </nav>
        </div>
        <div className="intro">
          <div>
            <span className="eyebrow">
              ONE TWITCH EXTENSION. YOUR OWN INTERACTIVE OVERLAY.
            </span>
            <h1>Make your Twitch player interactive.</h1>
            <p>
              Place clickable objects over your stream for viewers on Twitch. No
              OBS setup needed.
            </p>
            {(import.meta.env.DEV || import.meta.env.VITE_PUBLIC_BUILDER) && !isConfig && <p><a href="./automations.html" target="_blank" rel="noopener noreferrer" style={{color:"#c2ec78"}}>Try carousels, triggers & developer mode ↗</a> <small>Separate prototype</small></p>}
          </div>
        </div>
        <nav className="builder-steps" aria-label="Build your overlay">
          <button onClick={()=>document.querySelector('.starter-library')?.scrollIntoView({behavior:'smooth',block:'center'})}><b>1</b><span>Choose something interactive<small>Add a starter to this draft</small></span><span>→</span></button>
          <button disabled={!object} onClick={()=>{setPreview(false);titleInput.current?.focus();}}><b>2</b><span>Make it yours<small>Your words, images, and placement</small></span><span>→</span></button>
          <button onClick={()=>setModal("present")}><b>3</b><span>Try the viewer experience<small>Click everything before you publish</small></span><span>↗</span></button>
          <button onClick={()=>setModal("publish")}><b>4</b><span>Publish when ready<small>Review draft and channel status</small></span><span>↗</span></button>
        </nav>
        <div className="experience-edit-heading"><span>Customize this interaction below. Drag it into place, then try it as a viewer.</span><button onClick={() => setHomeOpen(true)}>＋ Add another experience</button></div>
        <div className="workspace">
          <aside className="library">
            <details className="object-library">
            <summary>Other ways to start</summary>
            <div className="panel-heading">
              <h2>Add an object</h2>
              <span>01</span>
            </div>
            <p className="hint">Pick what happens when a viewer clicks.</p>
            {ACTIONS.map((action) => (
              <button
                className="library-card"
                key={action}
                onClick={() => add(action)}
              >
                <span className={`library-icon ${action}`}>
                  {
                    symbols[
                      {
                        reveal: "info",
                        counter: "heart",
                        celebrate: "spark",
                        party: "gift",
                        link: "link",
                      }[action]
                    ]
                  }
                </span>
                <span>
                  <strong>{names[action]}</strong>
                  <small>{descriptions[action]}</small>
                </span>
                <span className="plus">+</span>
              </button>
            ))}
            <div className="library-bottom">
              <span className="eyebrow">MADE TO BE YOURS</span>
              <h3>Bring your own idea.</h3>
              <p>
                Use any image, write your own words, and choose an interaction.
              </p>
              <button onClick={() => fileRef.current.click()}>
                Import a design ↓
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files[0];
                  if (f) {
                    if (f.size > 2000000)
                      setNotice("File too large. Keep designs under 2 MB.");
                    else applyImport(await f.text());
                  }
                  e.target.value = "";
                }}
              />
            </div>
            </details>
          </aside>
          <section className="canvas-panel">
            <div className="canvas-toolbar">
              <input
                className="scene-name"
                aria-label="Scene name"
                value={scene.name}
                maxLength={80}
                onChange={(e) => commit({ ...scene, name: e.target.value })}
              />
              <div className="segmented">
                <button
                  aria-pressed={!preview}
                  className={!preview ? "active" : ""}
                  onClick={() => setPreview(false)}
                >
                  Edit
                </button>
                <button
                  aria-pressed={preview}
                  className={preview ? "active" : ""}
                  onClick={() => setPreview(true)}
                >
                  Try it out
                </button>
              </div>
            </div>
            <PreviewViewport value={viewport} onChange={setViewport}><Scene
              scene={scene}
              editing={!preview}
              selected={selected}
              onSelect={setSelected}
              onChange={change}
              backdrop
            /></PreviewViewport>
            <div className="canvas-footer">
              <span>
                {preview
                  ? "Click an object to try the viewer experience."
                  : isConfig
                    ? "Drag objects to place them."
                    : "Drag objects to place them. Arrow keys make fine adjustments."}
              </span>
              <button onClick={undo} disabled={!undoCount}>
                ↶ Undo
              </button>
            </div>
            <div className="layer-heading">
              <h2>
                Your objects <span>{scene.objects.length}/12</span>
              </h2>
              <button
                onClick={() => {
                  commit({ ...scene, objects: [] });
                  setSelected(null);
                }}
              >
                Clear canvas
              </button>
            </div>
            <div className="layers">
              {scene.objects.map((o, i) => (
                <button
                  key={o.id}
                  className={selected === o.id ? "chosen" : ""}
                  onClick={() => {
                    setSelected(o.id);
                    setPreview(false);
                  }}
                >
                  <span style={{ color: o.color }}>{symbols[o.icon]}</span>
                  <strong>{o.title || "Untitled object"}</strong>
                  <small>{String(i + 1).padStart(2, "0")}</small>
                </button>
              ))}
            </div>
            <div className="tip">
              <span>✦</span>
              <p>
                <strong>Small objects. Endless possibilities.</strong> A secret
                message, a community inside joke, a link to your latest work.
                Start with something that feels like you.
              </p>
            </div>
          </section>
          <aside className="inspector">
            <div className="panel-heading">
              <h2>Object settings</h2>
              <span>02</span>
            </div>
            {object ? (
              <>
                <label>
                  Title
                  <input
                    ref={titleInput}
                    value={object.title}
                    maxLength={70}
                    onChange={(e) => update({ title: e.target.value })}
                  />
                </label>
                {object.action !== "party" && <label>
                  Small print
                  <input
                    value={object.caption}
                    maxLength={100}
                    onChange={(e) => update({ caption: e.target.value })}
                  />
                </label>}
                <label>
                  On click
                  <select
                    value={object.action}
                    onChange={(e) => changeAction(e.target.value)}
                  >
                    {ACTIONS.map((a) => (
                      <option value={a} key={a}>
                        {names[a]}
                      </option>
                    ))}
                  </select>
                </label>
                {object.action === "reveal" && object.quiz && <section className="inspector-section quiz-controls" aria-label="Quiz answers">
                  <h3>Quiz answers</h3>
                  <p>Viewers choose one answer. Mark the correct choice for the reveal.</p>
                  {object.quiz.choices.map((choice, index) => <div className="quiz-choice-row" key={index}>
                    <label>Choice {index + 1}<input aria-label={`Quiz choice ${index + 1}`} maxLength={80} value={choice} onChange={e => update({ quiz: { ...object.quiz, choices: object.quiz.choices.map((value, i) => i === index ? e.target.value : value) } })}/></label>
                    <button type="button" aria-label={`Remove choice ${index + 1}`} disabled={object.quiz.choices.length <= 2} onClick={() => { const choices = object.quiz.choices.filter((_, i) => i !== index); const correctIndex = object.quiz.correctIndex === index ? 0 : object.quiz.correctIndex > index ? object.quiz.correctIndex - 1 : object.quiz.correctIndex; update({ quiz: { choices, correctIndex } }); }}>−</button>
                  </div>)}
                  <label>Correct answer<select value={object.quiz.correctIndex} onChange={e => update({ quiz: { ...object.quiz, correctIndex: Number(e.target.value) } })}>{object.quiz.choices.map((choice, index) => <option key={index} value={index}>{choice || `Choice ${index + 1}`}</option>)}</select></label>
                  <button type="button" disabled={object.quiz.choices.length >= 4} onClick={() => update({ quiz: { ...object.quiz, choices: [...object.quiz.choices, `Choice ${object.quiz.choices.length + 1}`] } })}>＋ Add answer choice</button>
                </section>}
                {object.action === "counter" && <label>Personal tap goal
                  <input type="number" min="2" max="1000" step="1" value={object.goal ?? 20} onChange={e => { const value = Number(e.target.value); if (Number.isInteger(value) && value >= 2 && value <= 1000) update({ goal: value }); }}/>
                  <small>Each viewer has their own count for this visit. This is a personal challenge, not a shared poll.</small>
                </label>}
                {object.action === "party" ? (
                  <label>Celebration
                    <select value={object.preset??"ducks"} onChange={e=>update({preset:e.target.value})}>
                      {Object.entries(PARTY_PRESETS).map(([key,p])=><option value={key} key={key}>{p.symbol} {p.label}</option>)}
                    </select>
                    <small>Posts in chat as Scene Studio and celebrates for viewers. Connect optional chat for this channel first. Viewers must share their Twitch identity; channel moderation and a 20-second cooldown apply.</small>
                    <small>Chat: [viewer] {PARTY_PRESETS[object.preset??"ducks"].chat}</small>
                  </label>
                ) : object.action === "link" ? (
                  <label>
                    Website address
                    <input
                      type="url"
                      placeholder="https://your-website.com"
                      value={object.url}
                      onChange={(e) => update({ url: e.target.value })}
                    />
                    <small>
                      Opens after a viewer clicks. HTTPS required. Social, commerce and promotional destinations may not pass Twitch public review.
                    </small>
                  </label>
                ) : (
                  <label>
                    {object.action === "counter" ? "Thank-you text" : "Message"}
                    <textarea
                      rows={3}
                      value={object.detail}
                      maxLength={1200}
                      onChange={(e) => update({ detail: e.target.value })}
                    />
                    {object.action === "counter" && (
                      <small>
                        Each viewer has their own count for this visit.
                      </small>
                    )}
                  </label>
                )}
                {object.action === "party" && <button onClick={() => setModal("chat")}>Set up optional chat</button>}
                <div className="divider" />
                <section className="inspector-section" aria-label="Object appearance">
                <h3>Appearance</h3>
                <div className="style-presets" aria-label="Quick styles">
                  <button onClick={()=>update({background:'#17102b',textColor:'#ffffff',color:'#a970ff',radius:18,opacity:100,fontScale:100})}>Neon</button>
                  <button onClick={()=>update({background:'#ffffff',textColor:'#17141f',color:'#6441a5',radius:12,opacity:100,fontScale:100})}>Clean</button>
                  <button onClick={()=>update({background:'#071e28',textColor:'#baf7ff',color:'#22d3ee',radius:4,opacity:90,fontScale:110})}>Arcade</button>
                </div>
                <div className="control-pair">
                  <label>
                    Shape
                    <select
                      value={object.shape}
                      onChange={(e) => update({ shape: e.target.value })}
                    >
                      <option value="card">Card</option>
                      <option value="showcase">Photo showcase</option>
                      <option value="sticker">Image only / sticker</option>
                      <option value="pill">Pill</option>
                      <option value="circle">Round</option>
                    </select>
                  </label>
                  <label>
                    Accent
                    <input
                      type="color"
                      value={object.color}
                      onChange={(e) => update({ color: e.target.value })}
                    />
                  </label>
                </div>
                <label>
                  Motion
                  <select value={object.motion ?? "none"} onChange={(e) => update({ motion: e.target.value })}>
                    <option value="none">Off</option>
                    <option value="float">Gentle float</option>
                    <option value="pulse">Pulse</option>
                    <option value="sway">Sway</option>
                  </select>
                  <small>Plays in the viewer preview. Objects stay still while you place them. Reduced-motion preferences are respected.</small>
                </label>
                <div className="control-pair">
                  <label>Background<input type="color" value={object.background ?? '#172019'} onChange={e=>update({background:e.target.value})} /></label>
                  <label>Text color<input type="color" value={object.textColor ?? '#ffffff'} onChange={e=>update({textColor:e.target.value})} /></label>
                </div>
                <label>Text size <span className="value">{object.fontScale ?? 100}%</span><input type="range" min="70" max="160" value={object.fontScale ?? 100} onChange={e=>update({fontScale:Number(e.target.value)})} /></label>
                <label>Opacity <span className="value">{object.opacity ?? 100}%</span><input type="range" min="30" max="100" value={object.opacity ?? 100} onChange={e=>update({opacity:Number(e.target.value)})} /></label>
                <label>Corner radius <span className="value">{object.radius ?? 14}px</span><input type="range" min="0" max="48" value={object.radius ?? 14} onChange={e=>update({radius:Number(e.target.value)})} /></label>
                </section>
                {object.action !== "party" && <label>
                  Icon
                  <span className="icon-picker">
                    {ICONS.map((icon) => (
                      <button
                        key={icon}
                        aria-label={`${icon} icon`}
                        aria-pressed={object.icon === icon}
                        className={object.icon === icon ? "chosen" : ""}
                        onClick={() => update({ icon, customIcon:'' })}
                      >
                        {symbols[icon]}
                      </button>
                    ))}
                  </span>
                </label>}
                <label>Custom icon or emoji<input value={object.customIcon ?? ''} placeholder="🎮 or your own symbol" onChange={e=>update({customIcon:Array.from(e.target.value).slice(0,8).join('')})} /><small>Leave blank to use a preset. Upload a logo below and choose “Custom image icon” to use your own artwork.</small></label>
                <label><input type="checkbox" checked={object.popupOnly===true} onChange={e=>update({popupOnly:e.target.checked})} /> Hide from the always-visible overlay<small>Use Carousels & chat triggers to show a timed popup. This checkbox alone does not create a chat rule.</small></label>
                <label className="upload">
                  {object.image ? "Replace image" : "Add your own image"}
                  <input
                    type="file"
                    aria-label="Choose image"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(e) => {
                      upload(e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                <label>Image display<select value={object.imageFit ?? 'cover'} onChange={e=>update({imageFit:e.target.value})}><option value="cover">Background photo · fill</option><option value="contain">Background photo · fit whole image</option><option value="icon">Custom image icon · beside text</option></select></label>
                <p className="hint">
                  We resize your image automatically. Saving makes it public for
                  viewers. Animations become still images.
                </p>
                {isConfig && !linked && (
                  <button onClick={() => helper?.actions?.requestIdShare()}>
                    Connect Twitch identity
                  </button>
                )}
                {isConfig && linked && (
                  <button disabled={busy} onClick={openImages}>
                    Manage uploaded images
                  </button>
                )}
                {object.image && (
                  <button onClick={() => update({ image: "" })}>
                    Remove image
                  </button>
                )}
                <label>
                  Width <span className="value">{object.width}%</span>
                  <input
                    type="range"
                    min="10"
                    max="80"
                    value={object.width}
                    onChange={(e) => update({ width: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Height <span className="value">{object.height}%</span>
                  <input
                    type="range"
                    min="10"
                    max="60"
                    value={object.height}
                    onChange={(e) => update({ height: Number(e.target.value) })}
                  />
                </label>
                <details className="inspector-section"><summary>Exact position & layer order</summary>
                  <div className="control-pair">
                    <label>Left (%)<input type="number" min="0" max={100-object.width} step="0.1" value={object.x} onChange={e=>{if(e.target.value!=='')update({x:Number(e.target.value)});}} /></label>
                    <label>Top (%)<input type="number" min="0" max={100-object.height} step="0.1" value={object.y} onChange={e=>{if(e.target.value!=='')update({y:Number(e.target.value)});}} /></label>
                  </div>
                  <div className="object-actions"><button onClick={()=>commit({...scene,objects:[...scene.objects.filter(o=>o.id!==object.id),object]})}>Bring to front</button><button onClick={()=>commit({...scene,objects:[object,...scene.objects.filter(o=>o.id!==object.id)]})}>Send to back</button></div>
                </details>
                <div className="object-actions">
                  <button
                    onClick={() => {
                      if (scene.objects.length >= MAX_OBJECTS)
                        return setNotice("You can have up to 12 objects.");
                      const next = moveObject(
                        { ...object, id: id() },
                        object.x + 3,
                        object.y + 3,
                      );
                      commit({ ...scene, objects: [...scene.objects, next] });
                      setSelected(next.id);
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      commit({
                        ...scene,
                        objects: scene.objects.filter(
                          (o) => o.id !== object.id,
                        ),
                      });
                      setSelected(null);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </>
            ) : (
              <p className="hint">
                Choose an object on your canvas, or add a new one to begin.
              </p>
            )}
          </aside>
        </div>
        <footer className="app-footer">
          <span>Built for creators. Open to possibility.</span>
          <span>
            {isConfig ? "Twitch test version" : "Browser preview"} · no paid AI
            calls
          </span>
        </footer>
      </main>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
      <section ref={publishBarRef} className={`publish-bar${publishProblem ? ' publish-blocked' : ''}`} aria-label="Publish your overlay">
        <div className="publish-summary">
          <strong>{publishProblem ? 'This draft is not ready to publish' : busy ? 'Publishing your overlay…' : isConfig ? saveStatus === 'Sent to Twitch' ? 'Update sent to Twitch' : saveStatus === 'Loaded from Twitch' ? 'Current Twitch configuration' : 'You have unpublished changes' : 'Your draft is not on Twitch yet'}</strong>
          <p>{publishProblem || (isConfig ? !configReady ? 'Loading the channel’s saved configuration.' : !authorized ? 'Open this editor as the channel’s broadcaster on Twitch.' : scene.objects.length && !linked ? 'Connect your Twitch identity, then publish your changes.' : scene.objects.length && !profile ? profileStatus === 'failed' ? 'Twitch could not confirm this channel. Retry the channel connection; your draft is safe.' : profileStatus === 'retrying' ? 'Retrying the channel connection…' : 'Waiting for Twitch to confirm the channel.' : saveStatus === 'Sent to Twitch' ? 'Reopen configuration to verify the saved design. New edits need another publish.' : `Publishing updates ${profile?.login || 'this channel'} and sends the overlay to connected viewers.` : 'Open the publishing steps to move this draft into your channel’s Twitch configuration.')}</p>
          {websiteLinks.length > 0 && !publishProblem && <small>{websiteLinks.length} HTTPS link{websiteLinks.length===1?'':'s'} · test configuration. Social and commerce links still need Twitch policy review for release.</small>}
        </div>
        <div className="publish-bar-actions">
          {isConfig && authorized && !linked && <button onClick={()=>helper.actions.requestIdShare()}>Connect Twitch identity</button>}
          {isConfig && authorized && (profileStatus === "failed" || profileStatus === "retrying") && <button disabled={profileStatus === "retrying"} onClick={() => refreshChannelProfile(authRef.current, true)}>{profileStatus === "retrying" ? "Retrying connection…" : "Retry channel connection"}</button>}
          {publishProblem && <button onClick={()=>setModal('publish')}>Why can’t I publish?</button>}
          <button className="primary" disabled={cannotPublish} onClick={isConfig ? saveTwitch : ()=>setModal('publish')}>{busy ? 'Publishing…' : 'Publish to Twitch →'}</button>
        </div>
      </section>
      {modal === "present" && <Presentation scene={scene} viewport={viewport} onViewportChange={setViewport} onClose={()=>setModal(null)} />}
      {modal === 'expert' && <Modal title="Expert mode" onClose={()=>setModal(null)} status={notice}>
        <div className="expert-tools">
          <p>Edit the complete design, set exact placement and layer order in Object settings, or connect your own tools.</p>
          <details open><summary>Design JSON · import, edit and validate</summary>
            <p>Supports all object properties below. Apply updates the draft; Publish to Twitch sends it live. Executable HTML, JavaScript and CSS are not supported.</p>
            <textarea aria-label="Expert design JSON" rows={14} spellCheck={false} value={json} onChange={e=>setJson(e.target.value)} />
            <div className="modal-actions"><button className="primary" onClick={()=>applyImport(json)}>Apply design JSON</button><button onClick={download}>Export current design</button></div>
          </details>
          <details><summary>Object properties</summary><p>title, caption, detail, action, image, shape, motion, color, background, textColor, opacity (30–100), fontScale (70–160), radius (0–48), x, y, width and height. Positions and sizes are percentages. The objects array sets back-to-front layer order.</p></details>
          <button onClick={()=>{setModal(null);if(isConfig){setAutomationVisited(true);setAutomationOpen(true);}else window.location.href='./automations.html';}}>Open carousels, chat rules & event simulator →</button>
          <button onClick={()=>setModal('chat')}>Manage Twitch chat connection</button>
          <DeveloperPanel onEvent={()=>setNotice('Use the event simulator in Carousels & chat triggers to test your rules.')} />
        </div>
      </Modal>}
      {modal === "advanced" && <Modal title="Layouts & advanced tools" onClose={()=>setModal(null)}>
        <p>These options offer broader starting points and developer tools. Current drafts are preserved in the object starters above; layouts replace the draft and can be undone.</p>
        <div className="advanced-tools-list">
          <button onClick={()=>setModal("templates")}>Choose a starting layout <span>Replaces this draft · Undo available</span></button>
          <button onClick={()=>{setJson("");setModal("ai");}}>Create with AI <span>Generate a design, then review it here</span></button>
          <button onClick={()=>{setJson(JSON.stringify(scene,null,2));setNotice("");setModal("expert");}}>Expert mode &amp; API <span>Edit the complete design with advanced fields</span></button>
        </div>
      </Modal>}
      {modal === "templates" && <Modal title="Start with something that feels like you" onClose={()=>setModal(null)}>
        <p>Choose a layout, then change any image, words, or position. Nothing changes on Twitch until you save there.</p>
        <div className="template-options">{TEMPLATE_OPTIONS.map(t=><button key={t.key} onClick={()=>chooseTemplate(t.key)}>
          <span className="template-symbol" aria-hidden="true">{t.icon}</span>
          <span><small>{t.tag}</small><strong>{t.title}</strong><span>{t.description}</span></span><span aria-hidden="true">→</span>
        </button>)}</div>
        <p className="fine-print">This replaces the draft in this editor. Undo brings your previous design back. Shared celebrations need the channel’s optional chat connection; previewing them here never posts to chat.</p>
      </Modal>}
      {modal === "ai" && (
        <Modal
          title="Your idea, your AI."
          status={notice}
          onClose={() => setModal(null)}
        >
          <p>
            Use your existing AI account to design a scene. Copy the
            instructions, add what you want, then paste its design below. Your
            AI provider’s limits apply.
          </p>
          <button
            className="primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(aiPrompt(scene));
                setNotice(
                  "Instructions copied. Paste them into your AI and describe your idea.",
                );
              } catch {
                setJson(aiPrompt(scene));
                setNotice(
                  "Clipboard unavailable. Copy the instructions from the box.",
                );
              }
            }}
          >
            1. Copy design instructions
          </button>
          <label>
            2. Paste the JSON design from your AI
            <textarea
              rows={8}
              value={json}
              onChange={(e) => setJson(e.target.value)}
              placeholder={'{"version":1,"name":"My idea","objects":[…]}'}
            />
          </label>
          <button className="primary" onClick={() => applyImport(json)}>
            3. Bring it to life →
          </button>
          <p className="fine-print">
            No AI service is connected to this prototype. Imported designs use
            the same supported objects and interactions as the editor.
          </p>
        </Modal>
      )}
      {modal === "images" && (
        <Modal
          title="Your uploaded images"
          status={notice}
          onClose={() => setModal(null)}
        >
          <p>
            {library.length} of 48 images. Remove unused uploads to make room.
            Images used in this draft or the saved Twitch overlay are protected.
          </p>
          {removeImage ? (
            <div>
              <img
                className="library-preview"
                src={removeImage}
                alt="Image selected for removal"
              />
              <p>
                Remove this hosted image? Older exports and another open editor
                may still use it. This cannot be undone here.
              </p>
              <button onClick={() => setRemoveImage(null)}>Keep image</button>
              <button className="danger" disabled={busy} onClick={eraseImage}>
                Remove from hosting
              </button>
            </div>
          ) : (
            <div className="image-library">
              {library.map((item) => {
                let savedUses = true;
                try {
                  const raw = helper?.configuration?.broadcaster?.content;
                  savedUses = raw
                    ? readTwitchScene(raw).objects.some(
                        (o) => o.image === item.url,
                      )
                    : false;
                } catch {
                  /* Fail closed when the saved design cannot be read. */
                }
                const used =
                  savedUses ||
                  lastSentScene.current?.objects.some(
                    (o) => o.image === item.url,
                  ) ||
                  scene.objects.some((o) => o.image === item.url);
                return (
                  <div key={item.url}>
                    <img src={item.url} alt="Uploaded channel image" />
                    <button
                      disabled={busy || used}
                      onClick={() => setRemoveImage(item.url)}
                    >
                      {used ? "In use" : "Remove"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}
      {modal === "chat" && <Modal title="Optional shared chat" onClose={() => setModal(null)}>
        <ChatConnectionPanel auth={authRef.current} canManage={isConfig && authorized} linked={linked} onLink={() => helper?.actions?.requestIdShare()} />
      </Modal>}
      {modal === "publish" && (
        <Modal
          title="Publish your overlay to Twitch"
          status={notice}
          onClose={() => setModal(null)}
        >
          {publishProblem && <p role="alert">{publishProblem}</p>}
          <p>
            Scene Studio is currently available on invited test channels.
            Public installation is not available yet. Your design belongs in
            the extension’s configuration page for the channel you want to use.
          </p>
          <ol>
            <li>Try your objects in the viewer preview, then export your design.</li>
            <li>
              Open your Twitch Creator Dashboard, choose Extensions, and open
              Scene Studio’s configuration.
            </li>
            <li>Choose Import a design and select the file you exported.</li>
            <li>Check the channel name, connect your Twitch identity if asked,
              then choose Publish to Twitch (called “Save overlay” in the currently submitted 0.1.0 version).</li>
          </ol>
          <p>
            Saving uploads your images for viewers on the test channel.
            HTTPS link objects can be saved in this test version. Twitch public
            review restricts social, commerce and promotional destinations;
            publishing a configuration does not approve its links for release.
          </p>
          <div className="modal-actions">
            <button className={isConfig ? "" : "primary"} onClick={download}>Export design</button>
            {isConfig && <button
              className="primary"
              disabled={cannotPublish}
              onClick={saveTwitch}
            >
              Publish to Twitch
            </button>}
          </div>
          {isConfig && helper && (
            <button
              onClick={() => {
                const raw = helper.configuration.broadcaster?.content;
                if (raw) applyImport(raw);
                else setNotice("No saved Twitch scene is available.");
              }}
            >
              Load Twitch scene
            </button>
          )}
          <p className="fine-print">
            {bytes(JSON.stringify(scene))} / 5,000 bytes for Twitch
            configuration before image uploads. Counters and personal
            celebrations stay with each viewer. “Celebrate with chat” sends
            a shared celebration and a preset chat message. The channel must
            connect optional chat, and viewers must share their Twitch identity.
            Channel bans, timeouts, and cooldowns apply.
          </p>
        </Modal>
      )}
    </div>
    </div>
    <div hidden={!automationOpen || homeOpen}>
      <AutomationStudio bundleApi={bundleApi} session={isConfig ? { auth: automationSession?.auth, viewer: automationSession?.viewer, profile } : undefined} visible={automationOpen && !homeOpen} experienceRequest={flowRequest} onRequestHandled={setFlowRequest} onPagesChange={setFlowPages} onBack={() => { setAutomationOpen(false); setHomeOpen(true); }} />
    </div>
    </>
  );
}

const root =
  import.meta.hot?.data.root ?? createRoot(document.getElementById("root"));
if (import.meta.hot)
  import.meta.hot.dispose((data) => {
    data.root = root;
  });
root.render(isViewer ? <Viewer /> : <Editor />);

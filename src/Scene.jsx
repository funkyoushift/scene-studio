import React,{useRef,useEffect,useState} from 'react';
import {id,moveObject,objectAppearance,safeLink} from './scene.mjs';
import {PARTY_PRESETS} from './party.mjs';
import {InteractiveWidget} from './InteractiveWidgets.jsx';
import ExperienceLauncher from './ExperiencePlayer.jsx';
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

function SceneObjectControl({ widget, children, ...props }) {
  return widget ? <div {...props} role="group">{children}</div> : <button {...props}>{children}</button>;
}

function Scene({
  scene,
  editing = false,
  isConfig = false,
  selected,
  onSelect,
  onChange,
  backdrop = false,
  sharedEvent = null,
  onParty,
  beforeParty,
  onExperienceOpen,
  experienceInitiallyOpen = false,
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
      {!editing && scene.experience && <ExperienceLauncher slot={scene.experience} onOpenChange={onExperienceOpen} initiallyOpen={experienceInitiallyOpen} />}
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
      {!scene.objects.length && !scene.experience && backdrop && (
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


export default Scene;

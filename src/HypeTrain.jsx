import React, { useEffect, useRef, useState } from "react";
import { TrainArt } from "./Celebration.jsx";
import CelebrationAudio from "./CelebrationAudio.jsx";
import { liveText } from "./live-context.mjs";
import "./hype-train.css";

export default function HypeTrain({ event, onDismiss, fullMotion = false }) {
  const [now, setNow] = useState(Date.now);
  const [levelUp, setLevelUp] = useState(false);
  const previous = useRef(null);
  const hype = event.hype;
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const changed = previous.current?.id === hype.id && hype.level > previous.current.level;
    previous.current = { id: hype.id, level: hype.level };
    setLevelUp(changed);
    if (changed) { const timer = setTimeout(() => setLevelUp(false), 3500); return () => clearTimeout(timer); }
  }, [hype.id, hype.level]);
  const ended = hype.phase === "ended";
  const seconds = Math.max(0, Math.ceil((hype.expiresAt - Math.max(now, hype.updatedAt)) / 1000));
  const percent = Math.min(100, Math.max(0, Math.round(hype.progress / hype.goal * 100)));
  return <section className={`ss-hype ss-celebration${levelUp ? " ss-hype-level-up" : ""}`} data-full-motion={fullMotion || undefined} style={{ "--ss-celebration-color": event.effect.appearance.color }} aria-label="Live Hype Train">
    <header><strong>{ended ? "THANKS FOR RIDING" : levelUp ? "LEVEL UP!" : "ALL ABOARD"}</strong><span className="ss-hype-level">Level {hype.level}</span>{onDismiss && <button onClick={onDismiss} aria-label="Hide Hype Train">×</button>}</header>
    <p className="ss-hype-message">{ended ? `Level ${hype.level} reached. What a ride, chat!` : liveText(event.effect.message, { hypeLevel: hype.level })}</p>
    <TrainArt />
    {!ended && <><div className="ss-hype-progress-label"><span>{percent}% to Level {hype.level + 1}</span><time aria-label="Time remaining">{seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "Waiting for Twitch’s update…"}</time></div><div className="ss-hype-progress" role="progressbar" aria-label="Hype Train level progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${percent}%` }}/></div><p className="ss-hype-invite">Enjoying the stream? Subs and cheers help keep the train rolling.</p></>}
    {ended && <p className="ss-hype-invite">Thank you to everyone who joined in!</p>}
  </section>;
}

export function HypeTrainDemo({ effect, onClose }) {
  const make = () => ({ type: "scene-studio-hype", eventId: "preview", created: Date.now(), expires: Date.now() + 90000, effect, hype: { id: "preview-train", phase: "active", level: 1, progress: 20, goal: 100, expiresAt: Date.now() + 90000, updatedAt: Date.now() } });
  const [event, setEvent] = useState(make);
  const [motion, setMotion] = useState(false);
  const change = patch => setEvent(current => ({ ...current, expires: Date.now() + (patch.phase === "ended" ? 12000 : 90000), hype: { ...current.hype, ...patch, expiresAt: Date.now() + (patch.phase === "ended" ? 12000 : 90000), updatedAt: Date.now() } }));
  return <div className="ss-hype-demo" role="dialog" aria-modal="true" aria-label="Hype Train lifecycle preview"><header><div><strong>Try the whole Hype Train</strong><p>Simulated Twitch data · nothing is sent to your stream.</p></div><button onClick={onClose}>Close preview</button></header><div className="ss-hype-demo-stage"><HypeTrain event={event} fullMotion={motion}/></div><div className="ss-hype-demo-controls"><button onClick={() => setEvent(make())}>Start train</button><button disabled={event.hype.phase === "ended"} onClick={() => change({ progress: Math.min(event.hype.goal, event.hype.progress + 25) })}>Add progress</button><button disabled={event.hype.phase === "ended"} onClick={() => change({ level: event.hype.level + 1, progress: 10, goal: event.hype.goal + 50 })}>Reach next level</button><button disabled={event.hype.phase === "ended"} onClick={() => change({ phase: "ended" })}>End train</button><button aria-pressed={motion} onClick={() => setMotion(!motion)}>{motion ? "Respect reduced motion" : "Preview full motion"}</button></div><CelebrationAudio preview eventId={`${event.hype.id}:${event.hype.level}:${event.hype.phase}`} sound={event.effect.appearance.sound} expires={event.expires}/></div>;
}

import React, { useEffect, useRef, useState } from "react";
import { createCelebrationPlayer, CELEBRATION_SOUND_PRESETS } from "./celebration-audio.mjs";
import { hostedSound } from "./sound-address.mjs";

function expiryTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export default function CelebrationAudio({ eventId, sound, expires, preview = false, loop = false }) {
  const configured = Boolean(sound && (
    CELEBRATION_SOUND_PRESETS.includes(sound.preset) ||
    (sound.preset === "upload" && (
      hostedSound(sound.url) ||
      (typeof sound.url === "string" && (sound.url.startsWith("data:audio/wav;base64,") || sound.url.startsWith("data:audio/mpeg;base64,")))
    ))
  ));
  const [enabled, setEnabled] = useState(false);
  const [volume, setVolume] = useState(70);
  const [status, setStatus] = useState("");
  const playerRef = useRef(null);
  const playedEventRef = useRef(null);
  const activeEventRef = useRef(null);
  const activeLoopRef = useRef(false);
  const soundRef = useRef(sound);
  const volumeRef = useRef(volume);
  soundRef.current = sound;
  volumeRef.current = volume;
  const soundIdentity = JSON.stringify([sound?.preset, sound?.url, sound?.name, sound?.volume, sound?.playback]);
  const loopingUpload = loop && sound?.preset === "upload" && sound.playback === "hype-loop";

  useEffect(() => {
    const player = createCelebrationPlayer();
    playerRef.current = player;
    return () => {
      playerRef.current = null;
      void player.dispose();
    };
  }, []);

  useEffect(() => {
    if (!enabled || !configured || !playerRef.current) {
      playerRef.current?.stop();
      if (activeLoopRef.current) setStatus("Background music stopped.");
      activeEventRef.current = null;
      activeLoopRef.current = false;
      return;
    }
    const key = eventId == null ? null : `${String(eventId)}|${soundIdentity}`;
    const expiration = expiryTime(expires);
    if (key === null || !expiration || expiration <= Date.now()) {
      playerRef.current.stop();
      if (activeLoopRef.current) setStatus("Background music stopped.");
      activeEventRef.current = null;
      activeLoopRef.current = false;
      return;
    }
    if (activeEventRef.current !== key) playerRef.current.stop();
    else if (activeLoopRef.current && !loop) { playerRef.current.stop(); setStatus("Background music stopped."); }
    activeEventRef.current = key;
    activeLoopRef.current = loop;
    if (playedEventRef.current !== key) {
      playedEventRef.current = key;
      const currentSound = soundRef.current;
      if (currentSound?.preset) {
        const player = playerRef.current;
        const stillCurrent = () => playerRef.current === player && activeEventRef.current === key && activeLoopRef.current && playedEventRef.current === key;
        if (loop) setStatus("Background music is loading…");
        void player.playSound(currentSound, volumeRef.current, { loop }).then(started => {
          if (loop && stillCurrent()) setStatus(started ? "Background music is playing." : "Background music could not play. Mute and enable sound to try again.");
        }).catch(() => {
          if (loop && stillCurrent()) setStatus("Background music could not play. Mute and enable sound to try again.");
        });
      }
    }
    const timeout = setTimeout(() => playerRef.current?.stop(), Math.max(0, expiration - Date.now()));
    return () => clearTimeout(timeout);
  }, [enabled, configured, eventId, expires, soundIdentity, loop]);

  async function enableSound() {
    setStatus("");
    try {
      await playerRef.current?.unlock();
      setEnabled(true);
      setStatus("Celebration sound enabled for this viewer.");
    } catch (error) {
      setEnabled(false);
      setStatus(error instanceof Error ? error.message : "Celebration sound could not be enabled.");
    }
  }

  function muteSound() {
    playerRef.current?.stop();
    playedEventRef.current = null;
    activeEventRef.current = null;
    activeLoopRef.current = false;
    setEnabled(false);
    setStatus("Celebration sound muted.");
  }

  function previewSound() {
    if (!enabled || loopingUpload) return;
    playerRef.current?.stop();
    const currentSound = soundRef.current;
    if (currentSound?.preset) void playerRef.current?.playSound(currentSound, volume, { loop: false });
  }

  if (!configured && !enabled) return null;
  return <div className="ss-celebration-audio" role="group" aria-label="Celebration sound controls">
    <style>{`
      .ss-celebration-audio,.ss-celebration-audio *{box-sizing:border-box}.ss-celebration-audio{position:relative;z-index:20;display:flex;align-items:center;gap:8px;max-width:min(100%,390px);padding:8px 10px;border:1px solid #ffffff38;border-radius:12px;background:#111522ed;color:#f8f9ff;box-shadow:0 8px 24px #0007;font:12px/1.35 system-ui,sans-serif;pointer-events:auto}.ss-celebration-audio button{min-height:34px;padding:6px 10px;border:1px solid #ffffff50;border-radius:8px;background:#27344a;color:#fff;font:700 12px/1 system-ui,sans-serif;cursor:pointer}.ss-celebration-audio button:hover{background:#354767}.ss-celebration-audio button:focus-visible,.ss-celebration-audio input:focus-visible{outline:3px solid #c9f27b;outline-offset:2px}.ss-celebration-audio .ss-ca-controls{display:flex;align-items:center;gap:8px;min-width:0}.ss-celebration-audio .ss-ca-label{font-weight:700;white-space:nowrap}.ss-celebration-audio input[type=range]{width:92px;accent-color:#c9f27b}.ss-celebration-audio .ss-ca-volume{display:flex;align-items:center;gap:5px;color:#e1e7f1;white-space:nowrap}.ss-celebration-audio .ss-ca-status{position:absolute;right:0;bottom:calc(100% + 6px);max-width:min(320px,90vw);padding:6px 9px;border-radius:7px;background:#111522;color:#fff;font-size:11px;box-shadow:0 4px 12px #0006}.ss-celebration-audio .ss-ca-preview{font-size:11px;padding-inline:8px}@media(max-width:420px){.ss-celebration-audio{gap:6px;padding:7px}.ss-celebration-audio input[type=range]{width:66px}.ss-celebration-audio .ss-ca-label{font-size:11px}}
    `}</style>
    {!enabled ? <button type="button" onClick={enableSound}>Enable celebration sound</button> : <div className="ss-ca-controls">
      <span className="ss-ca-label">Sound on</span>
      <label className="ss-ca-volume"><span>Volume</span><input type="range" min="0" max="100" value={volume} aria-label="Celebration sound volume" onChange={event => { const next = Number(event.target.value); if (loopingUpload) playerRef.current?.setVolume(next); else playerRef.current?.stop(); setVolume(next); }} /></label>
      {preview && <button className="ss-ca-preview" type="button" disabled={!configured || loopingUpload} onClick={previewSound}>Play sample</button>}
      <button type="button" onClick={muteSound}>Mute</button>
    </div>}
    {status && <span className="ss-ca-status" role="status">{status}</span>}
  </div>;
}

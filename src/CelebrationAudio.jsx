import React, { useEffect, useRef, useState } from "react";
import { createCelebrationPlayer, CELEBRATION_SOUND_PRESETS } from "./celebration-audio.mjs";

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

export default function CelebrationAudio({ eventId, sound, expires, preview = false }) {
  const configured = Boolean(sound && CELEBRATION_SOUND_PRESETS.includes(sound.preset));
  const [enabled, setEnabled] = useState(false);
  const [volume, setVolume] = useState(70);
  const [status, setStatus] = useState("");
  const playerRef = useRef(null);
  const playedEventRef = useRef(null);
  const activeEventRef = useRef(null);
  const soundRef = useRef(sound);
  const volumeRef = useRef(volume);
  soundRef.current = sound;
  volumeRef.current = volume;

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
      return;
    }
    const key = eventId == null ? null : String(eventId);
    const expiration = expiryTime(expires);
    if (key === null || !expiration || expiration <= Date.now()) {
      playerRef.current.stop();
      activeEventRef.current = null;
      return;
    }
    if (activeEventRef.current !== key) playerRef.current.stop();
    activeEventRef.current = key;
    if (playedEventRef.current === key) return;
    playedEventRef.current = key;
    const currentSound = soundRef.current;
    if (currentSound?.preset && playerRef.current.play(currentSound.preset, volumeRef.current * (currentSound.volume ?? 100) / 100)) {
      const timeout = setTimeout(() => playerRef.current?.stop(), Math.max(0, expiration - Date.now()));
      return () => clearTimeout(timeout);
    }
  }, [enabled, configured, eventId, expires]);

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
    setEnabled(false);
    setStatus("Celebration sound muted.");
  }

  function previewSound() {
    if (!enabled) return;
    playerRef.current?.stop();
    const currentSound = soundRef.current;
    if (currentSound?.preset) playerRef.current?.play(currentSound.preset, volume * (currentSound.volume ?? 100) / 100);
  }

  if (!configured && !enabled) return null;
  return <div className="ss-celebration-audio" role="group" aria-label="Celebration sound controls">
    <style>{`
      .ss-celebration-audio,.ss-celebration-audio *{box-sizing:border-box}.ss-celebration-audio{position:relative;z-index:20;display:flex;align-items:center;gap:8px;max-width:min(100%,390px);padding:8px 10px;border:1px solid #ffffff38;border-radius:12px;background:#111522ed;color:#f8f9ff;box-shadow:0 8px 24px #0007;font:12px/1.35 system-ui,sans-serif;pointer-events:auto}.ss-celebration-audio button{min-height:34px;padding:6px 10px;border:1px solid #ffffff50;border-radius:8px;background:#27344a;color:#fff;font:700 12px/1 system-ui,sans-serif;cursor:pointer}.ss-celebration-audio button:hover{background:#354767}.ss-celebration-audio button:focus-visible,.ss-celebration-audio input:focus-visible{outline:3px solid #c9f27b;outline-offset:2px}.ss-celebration-audio .ss-ca-controls{display:flex;align-items:center;gap:8px;min-width:0}.ss-celebration-audio .ss-ca-label{font-weight:700;white-space:nowrap}.ss-celebration-audio input[type=range]{width:92px;accent-color:#c9f27b}.ss-celebration-audio .ss-ca-volume{display:flex;align-items:center;gap:5px;color:#e1e7f1;white-space:nowrap}.ss-celebration-audio .ss-ca-status{position:absolute;right:0;bottom:calc(100% + 6px);max-width:min(320px,90vw);padding:6px 9px;border-radius:7px;background:#111522;color:#fff;font-size:11px;box-shadow:0 4px 12px #0006}.ss-celebration-audio .ss-ca-preview{font-size:11px;padding-inline:8px}@media(max-width:420px){.ss-celebration-audio{gap:6px;padding:7px}.ss-celebration-audio input[type=range]{width:66px}.ss-celebration-audio .ss-ca-label{font-size:11px}}
    `}</style>
    {!enabled ? <button type="button" onClick={enableSound}>Enable celebration sound</button> : <div className="ss-ca-controls">
      <span className="ss-ca-label">Sound on</span>
      <label className="ss-ca-volume"><span>Volume</span><input type="range" min="0" max="100" value={volume} aria-label="Celebration sound volume" onChange={event => { playerRef.current?.stop(); setVolume(Number(event.target.value)); }} /></label>
      {preview && <button className="ss-ca-preview" type="button" disabled={!configured} onClick={previewSound}>Play sample</button>}
      <button type="button" onClick={muteSound}>Mute</button>
    </div>}
    {status && <span className="ss-ca-status" role="status">{status}</span>}
  </div>;
}

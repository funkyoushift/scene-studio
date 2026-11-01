import React, { useEffect, useRef, useState } from "react";
import {
  advanceExperience,
  conditionsMet,
  experienceText,
  initialExperienceState,
  restoreExperienceState,
} from "./experience.mjs";
import { loadExperience, resolveMedia } from "./experience-media.mjs";
import "./experience-builder.css";

export function ExperienceMedia({
  asset,
  fit = "contain",
  loop = false,
  paused = false,
  onEnded,
  className = "",
}) {
  const [source, setSource] = useState(null),
    [error, setError] = useState(""),
    [playing, setPlaying] = useState(false);
  const videoRef = useRef(null);
  useEffect(() => {
    if (paused) videoRef.current?.pause();
  }, [paused]);
  useEffect(() => {
    let active = true,
      release = () => {};
    setSource(null);
    setError("");
    setPlaying(false);
    if (asset)
      resolveMedia(asset.source)
        .then((result) => {
          if (!active) {
            result.release();
            return;
          }
          release = result.release;
          setSource({ original: asset.source, url: result.url });
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
      release();
    };
  }, [asset?.source]);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) videoRef.current?.pause();
    };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  if (!asset) return null;
  if (error)
    return (
      <p className="experience-media-error" role="status">
        {error}
      </p>
    );
  if (!source || source.original !== asset.source)
    return <span role="status">Loading media…</span>;
  return asset.kind === "video" ? (
    <>
      <video
        ref={videoRef}
        className={className}
        style={{ objectFit: fit }}
        src={source.url}
        muted
        controls
        playsInline
        preload="metadata"
        loop={loop}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={onEnded}
        onError={() =>
          setError(
            "This video could not play. Try another browser or ask the creator to use MP4 with H.264.",
          )
        }
      />
      <button
        className="experience-video-toggle"
        disabled={paused}
        onClick={async () => {
          if (playing) videoRef.current?.pause();
          else
            try {
              await videoRef.current?.play();
            } catch {
              setError(
                "Playback could not start. Use the video controls or try another file.",
              );
            }
        }}
      >
        {playing ? "Pause video" : "Play video"}
      </button>
    </>
  ) : (
    <img
      className={className}
      style={{ objectFit: fit }}
      src={source.url}
      alt={asset.name}
      onError={() => setError("This image could not be loaded.")}
    />
  );
}
export function ExperiencePlayer({ design, storageKey, onClose }) {
  const saveKey =
    storageKey && design.saveProgress
      ? `scene-studio-progress:${storageKey}:${design.id}`
      : null;
  const [state, setState] = useState(() => {
    if (saveKey)
      try {
        return restoreExperienceState(
          design,
          JSON.parse(localStorage.getItem(saveKey)),
        );
      } catch {
        /* browser storage may be disabled */
      }
    return initialExperienceState(design);
  });
  const [paused, setPaused] = useState(false),
    [seconds, setSeconds] = useState(null),
    [notice, setNotice] = useState("");
  const stateRef = useRef(state),
    pausedRef = useRef(paused),
    heading = useRef(null),
    timerFired = useRef(-1),
    ended = useRef(-1);
  stateRef.current = state;
  pausedRef.current = paused;
  const scene =
    design.scenes.find((s) => s.id === state.scene) || design.scenes[0];
  const asset = design.assets.find((a) => a.id === scene.media);
  useEffect(() => {
    if (!saveKey) return;
    try {
      localStorage.setItem(saveKey, JSON.stringify(state));
    } catch {
      setNotice(
        "Progress is available for this visit, but could not be saved on this device.",
      );
    }
  }, [saveKey, state]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [state.scene, state.visit]);
  useEffect(() => {
    if (!scene.timer) {
      setSeconds(null);
      return;
    }
    let remaining = scene.timer.seconds * 1000,
      last = performance.now();
    setSeconds(Math.ceil(remaining / 1000));
    const timer = setInterval(() => {
      const now = performance.now(),
        elapsed = now - last;
      last = now;
      if (pausedRef.current || document.hidden) return;
      remaining -= elapsed;
      setSeconds(Math.max(0, Math.ceil(remaining / 1000)));
      if (remaining <= 0 && timerFired.current !== state.visit) {
        timerFired.current = state.visit;
        clearInterval(timer);
        setState((old) =>
          old.visit === state.visit
            ? advanceExperience(design, old, scene.timer.actions)
            : old,
        );
      }
    }, 100);
    return () => clearInterval(timer);
  }, [design, scene.id, state.visit]);
  const click = (element) => {
    if (paused) return;
    setState((old) =>
      old.visit === state.visit &&
      old.scene === scene.id &&
      conditionsMet(element.when, old.values)
        ? advanceExperience(design, old, element.actions)
        : old,
    );
  };
  return (
    <section className="experience-player" aria-label={design.name}>
      <header className="experience-player-toolbar">
        <strong>{design.name}</strong>
        <span>{seconds !== null ? `${seconds}s` : ""}</span>
        <button onClick={() => setPaused((v) => !v)}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={() => {
            timerFired.current = -1;
            ended.current = -1;
            setState((old) => ({
              ...initialExperienceState(design),
              visit: old.visit + 1,
            }));
          }}
        >
          Restart
        </button>
        {onClose && <button onClick={onClose}>Close experience</button>}
      </header>
      <h3 ref={heading} tabIndex={-1}>
        {experienceText(scene.title, state.values)}
      </h3>
      {scene.description && (
        <p className="experience-description">
          {experienceText(scene.description, state.values)}
        </p>
      )}
      <div
        className="experience-stage"
        style={{ background: scene.background }}
      >
        <ExperienceMedia
          key={`${scene.id}:${state.visit}`}
          asset={asset}
          paused={paused}
          className="experience-background"
          fit={scene.fit}
          loop={scene.loop}
          onEnded={() => {
            if (
              pausedRef.current ||
              stateRef.current.visit !== state.visit ||
              ended.current === stateRef.current.visit
            )
              return;
            ended.current = stateRef.current.visit;
            setState((old) => advanceExperience(design, old, scene.videoEnd));
          }}
        />
        {scene.elements
          .filter((e) => conditionsMet(e.when, state.values))
          .map((e) => {
            const style = {
              left: `${e.x}%`,
              top: `${e.y}%`,
              width: `${e.width}%`,
              height: `${e.height}%`,
              color: e.color,
              background: e.transparent ? "transparent" : e.background,
              fontSize: `clamp(12px, ${e.fontSize / 10}cqw, ${e.fontSize}px)`,
            };
            const label = experienceText(e.label, state.values);
            return e.kind === "button" ? (
              <button
                key={e.id}
                className={`experience-element experience-motion-${e.motion} ${e.transparent ? "experience-hotspot" : ""}`}
                style={style}
                aria-label={label || "Continue"}
                disabled={paused}
                onClick={() => click(e)}
              >
                {e.transparent ? (
                  <span className="experience-sr">{label}</span>
                ) : (
                  label
                )}
              </button>
            ) : (
              <div
                key={e.id}
                className={`experience-element experience-motion-${e.motion}`}
                style={style}
              >
                {e.kind === "text" ? (
                  label
                ) : (
                  <ExperienceMedia
                    asset={design.assets.find((a) => a.id === e.asset)}
                  />
                )}
              </div>
            );
          })}
        {paused && (
          <div className="experience-pause">
            Paused<button onClick={() => setPaused(false)}>Resume</button>
          </div>
        )}
      </div>
      <div className="experience-choice-list" aria-label="Scene choices">
        {scene.elements
          .filter(
            (e) => e.kind === "button" && conditionsMet(e.when, state.values),
          )
          .map((e) => (
            <button key={e.id} disabled={paused} onClick={() => click(e)}>
              {experienceText(e.label, state.values) || "Continue"}
            </button>
          ))}
      </div>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
export default function ExperienceLauncher({ slot }) {
  const [open, setOpen] = useState(false),
    [design, setDesign] = useState(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open || !slot) return;
    const controller = new AbortController();
    let active = true;
    setDesign(null);
    setError("");
    loadExperience(slot, { signal: controller.signal })
      .then((result) => {
        if (active) setDesign(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [slot, open, retry]);
  if (!slot || slot.enabled === false) return null;
  return (
    <div className={`experience-launcher ${open ? "is-open" : ""}`}>
      {!open ? (
        <button onClick={() => setOpen(true)}>Play · {slot.name}</button>
      ) : (
        <>
          {design ? (
            <ExperiencePlayer
              key={JSON.stringify(slot)}
              design={design}
              storageKey={slot.url}
              onClose={() => setOpen(false)}
            />
          ) : (
            <div className="experience-loading">
              <p role="status">{error || "Loading experience…"}</p>
              {error && (
                <button onClick={() => setRetry((v) => v + 1)}>
                  Try again
                </button>
              )}
              <button onClick={() => setOpen(false)}>Close experience</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

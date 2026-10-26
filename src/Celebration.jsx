import React, { useState } from "react";
import "./celebration.css";

const PARTICLES = Array.from({ length: 36 }, (_, index) => {
  const angle = -158 + (index * 316) / 35;
  const distance = 115 + ((index * 37) % 135);
  return {
    "--ss-particle-x": `${8 + ((index * 47) % 84)}%`,
    "--ss-particle-y": `${42 + ((index * 13) % 34)}%`,
    "--ss-particle-angle": `${angle}deg`,
    "--ss-particle-distance": `${distance}px`,
    "--ss-particle-delay": `${(index % 9) * 24}ms`,
    "--ss-particle-hue": `${(index * 41) % 360}deg`,
    "--ss-particle-shape": index % 3 === 0 ? "50%" : "2px",
  };
});
const MOTIFS = Array.from({ length: 18 }, (_, index) => ({
  "--ss-motif-x": `${5 + ((index * 43) % 90)}%`,
  "--ss-motif-y": `${8 + ((index * 29) % 78)}%`,
  "--ss-motif-delay": `${(index % 8) * -0.31}s`,
  "--ss-motif-size": `${9 + ((index * 7) % 13)}px`,
  "--ss-motif-angle": `${index * 20}deg`,
}));
const FIREWORKS = Array.from({ length: 3 }, (_, index) => ({
  "--ss-firework-x": `${14 + index * 36}%`,
  "--ss-firework-y": `${18 + (index % 2) * 17}%`,
  "--ss-firework-delay": `${index * 0.42}s`,
}));
const FIREWORK_SPARKS = Array.from({ length: 10 }, (_, index) => ({
  "--ss-firework-angle": `${index * 36}deg`,
  "--ss-firework-distance": `${26 + (index % 3) * 11}px`,
  "--ss-firework-spark-delay": `${(index % 4) * 0.06}s`,
}));

function safeColor(value) {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value : "#c9f27b";
}

function TrainArt() {
  return <svg className="ss-celebration-train-art" viewBox="0 0 400 100" role="img" aria-label="A celebration train rolling by">
    <g className="ss-celebration-train-cars">
      <g transform="translate(12 22)"><path d="M4 20h76v38H4z"/><path d="M14 28h17v15H14zm27 0h17v15H41z"/><path d="M0 58h84v8H0z"/><g className="ss-celebration-wheel"><circle cx="23" cy="69" r="8"/><path className="ss-celebration-wheel-spoke" d="M18 69h10M23 64v10"/></g><g className="ss-celebration-wheel"><circle cx="66" cy="69" r="8"/><path className="ss-celebration-wheel-spoke" d="M61 69h10M66 64v10"/></g><path d="M4 16h76" className="ss-celebration-trim"/></g>
      <g transform="translate(102 22)"><path d="M4 20h76v38H4z"/><path d="M14 28h17v15H14zm27 0h17v15H41z"/><path d="M0 58h84v8H0z"/><g className="ss-celebration-wheel"><circle cx="23" cy="69" r="8"/><path className="ss-celebration-wheel-spoke" d="M18 69h10M23 64v10"/></g><g className="ss-celebration-wheel"><circle cx="66" cy="69" r="8"/><path className="ss-celebration-wheel-spoke" d="M61 69h10M66 64v10"/></g><path d="M4 16h76" className="ss-celebration-trim"/></g>
      <g transform="translate(207 8)"><path d="M5 36h91v37H5z"/><path d="M15 42h35v19H15z"/><path d="M57 42h17v19H57z"/><path d="M0 72h102v9H0z"/><path d="M75 18h12v18H75zM72 27h18v9H72z"/><path d="M24 28h29V17h8v19H24z"/><g className="ss-celebration-wheel"><circle cx="28" cy="83" r="10"/><path className="ss-celebration-wheel-spoke" d="M22 83h12M28 77v12"/></g><g className="ss-celebration-wheel"><circle cx="79" cy="83" r="10"/><path className="ss-celebration-wheel-spoke" d="M73 83h12M79 77v12"/></g><path d="M4 31h94" className="ss-celebration-trim"/></g>
    </g>
  </svg>;
}

export default function Celebration({ message, appearance, creator, brandImage, onDismiss, eventId, remainingSeconds, previewFullMotion = false }) {
  const styles = ["confetti", "spotlight", "hype-train", "hearts", "starfall", "fireworks", "bubbles", "meteor", "aurora", "arcade", "petals", "orbit"];
  const style = styles.includes(appearance?.style) ? appearance.style : "confetti";
  // The parent keys each event. Freeze the initial remaining lifetime so editor
  // clock ticks cannot continually shorten/restart the CSS animation timeline.
  const [duration] = useState(() => Number.isFinite(remainingSeconds) ? Math.max(0.1, remainingSeconds) : Math.max(0.1, Number(appearance?.durationSeconds) || 8));
  const color = safeColor(appearance?.color);
  const creatorName = typeof creator === "string" ? creator : creator?.displayName || creator?.login || creator?.name;
  const styleLabel = { "hype-train": "LIVE EXPRESS", spotlight: "IN THE SPOTLIGHT", hearts: "SENDING LOVE", starfall: "A WISH FOR YOU", fireworks: "MAKE SOME NOISE", bubbles: "A LITTLE MOMENT", meteor: "MAKING AN ENTRANCE", aurora: "AURORA MOMENT", arcade: "BONUS ROUND", petals: "A MOMENT IN BLOOM", orbit: "IN YOUR ORBIT" }[style] || "A MOMENT TO CELEBRATE";
  const rootStyle = { "--ss-celebration-color": color, "--ss-celebration-duration": `${duration}s` };
  return <div className={`ss-celebration ss-celebration-${style}`} style={rootStyle} data-event-id={eventId} data-full-motion={previewFullMotion || undefined}>
    <div className="ss-celebration-stage">
      <div className="ss-celebration-effects" aria-hidden="true">
        {style === "confetti" && <div className="ss-celebration-cannon">{PARTICLES.map((vars, index) => <i key={index} style={vars} />)}</div>}
        {style === "spotlight" && <><div className="ss-celebration-rays"/><i className="ss-celebration-orbit ss-celebration-orbit-one"/><i className="ss-celebration-orbit ss-celebration-orbit-two"/><i className="ss-celebration-orbit ss-celebration-orbit-three"/></>}
        {style === "hype-train" && <TrainArt />}
        {["hearts", "starfall", "bubbles", "meteor", "arcade", "petals"].includes(style) && <div className={`ss-celebration-motifs ss-celebration-motifs-${style}`}>{MOTIFS.map((vars, index) => <i key={index} style={vars} />)}</div>}
        {style === "aurora" && <div className="ss-celebration-aurora"><i/><i/><i/></div>}
        {style === "orbit" && <div className="ss-celebration-dot-orbit">{MOTIFS.slice(0, 14).map((vars, index) => <i key={index} style={vars} />)}</div>}
        {style === "fireworks" && <div className="ss-celebration-fireworks">{FIREWORKS.map((vars, index) => <span className="ss-celebration-firework" key={index} style={vars}>{FIREWORK_SPARKS.map((sparkVars, sparkIndex) => <i key={sparkIndex} style={sparkVars}/>)}</span>)}</div>}
      </div>
      <section className="ss-celebration-card" role="status" aria-live="polite">
        <div className="ss-celebration-eyebrow"><span className="ss-celebration-mark" aria-hidden="true">{styleLabel}</span>
          {onDismiss && <button className="ss-celebration-dismiss" type="button" onClick={onDismiss} aria-label="Dismiss celebration">×</button>}
        </div>
        <div className="ss-celebration-content">
          {brandImage && <img className="ss-celebration-brand" src={brandImage} alt="" />}
          <p className="ss-celebration-message">{message || "Let's hear it!"}</p>
          {creatorName && <span className="ss-celebration-creator">Created by @{creatorName} with Scene Studio</span>}
        </div>
        <div className="ss-celebration-rule" aria-hidden="true"><i /></div>
      </section>
    </div>
  </div>;
}

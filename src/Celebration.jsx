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

export function TrainArt() {
  const wheel = (x, y, r = 14) => <g className="ss-celebration-wheel" key={x} style={{ transformOrigin: `${x}px ${y}px`, transformBox: "view-box" }}><circle cx={x} cy={y} r={r}/><path className="ss-celebration-wheel-spoke" d={`M${x-r+3} ${y}h${2*r-6}M${x} ${y-r+3}v${2*r-6}`}/><circle cx={x} cy={y} r="3" fill="#fff"/></g>;
  return <svg className="ss-celebration-train-art" viewBox="0 0 640 180" role="img" aria-label="Steam locomotive with two carriages, turning wheels and rising steam">
    <g className="ss-train-track" stroke="#8493a8" strokeWidth="3"><path d="M0 158H640M0 168H640"/>{Array.from({length:22},(_,i)=><path key={i} d={`M${i*30} 155l-8 17`}/>)}</g>
    <g className="ss-celebration-train-cars">
      {[36,174].map(x=><g key={x} transform={`translate(${x} 0)`}><rect className="ss-train-body" x="0" y="79" width="120" height="58" rx="8"/><path className="ss-train-roof" d="M-5 80Q60 51 125 80Z"/>{[12,47,82].map(w=><rect className="ss-train-window" key={w} x={w} y="88" width="25" height="23" rx="4"/>)}<path className="ss-train-trim" d="M0 123H120"/>{wheel(26,143)}{wheel(95,143)}<path className="ss-train-coupling" d="M120 133h18"/></g>)}
      <g className="ss-train-engine">
        <path className="ss-train-roof" d="M314 64h88l8 12H306z"/>
        <rect className="ss-train-body" x="318" y="76" width="80" height="65" rx="4"/>
        <rect className="ss-train-window" x="332" y="84" width="43" height="33" rx="5"/>
        <path className="ss-train-boiler" d="M398 97h108q36 0 36 40H398Z"/>
        <path className="ss-train-trim" d="M429 99v38M481 99v38"/>
        <path className="ss-train-body" d="M480 97V67h25v30z"/>
        <path className="ss-train-roof" d="M473 60h39v13h-39z"/>
        <path className="ss-train-cowcatcher" d="M534 131l37 23h-42z"/>
        <circle cx="535" cy="110" r="8" fill="#fff2a1" stroke="#f9bd55" strokeWidth="3"/>
        <path className="ss-train-base" d="M310 135h225v8H310z"/>
        {wheel(344,141,18)}{wheel(398,141,18)}{wheel(455,143,15)}{wheel(509,143,15)}
        <path className="ss-train-rod" d="M344 141h54"/>
        {[0,1,2].map(i=><circle key={i} className="ss-train-steam" cx="493" cy="48" r={10+i*4} style={{animationDelay:`${-i*.6}s`}}/>)}
      </g>
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
  const styleLabel = { "hype-train": "ALL ABOARD · HYPE TRAIN", spotlight: "IN THE SPOTLIGHT", hearts: "SENDING LOVE", starfall: "A WISH FOR YOU", fireworks: "MAKE SOME NOISE", bubbles: "A LITTLE MOMENT", meteor: "MAKING AN ENTRANCE", aurora: "AURORA MOMENT", arcade: "BONUS ROUND", petals: "A MOMENT IN BLOOM", orbit: "IN YOUR ORBIT" }[style] || "A MOMENT TO CELEBRATE";
  const rootStyle = { "--ss-celebration-color": color, "--ss-celebration-duration": `${duration}s` };
  return <div className={`ss-celebration ss-celebration-${style}`} style={rootStyle} data-event-id={eventId} data-full-motion={previewFullMotion || undefined}>
    <div className="ss-celebration-stage">
      <div className="ss-celebration-effects" aria-hidden="true">
        {style === "confetti" && <div className="ss-celebration-cannon">{PARTICLES.map((vars, index) => <i key={index} style={vars} />)}</div>}
        {style === "spotlight" && <><div className="ss-celebration-rays"/><i className="ss-celebration-orbit ss-celebration-orbit-one"/><i className="ss-celebration-orbit ss-celebration-orbit-two"/><i className="ss-celebration-orbit ss-celebration-orbit-three"/></>}
        
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
        {style === "hype-train" && <TrainArt />}
        <div className="ss-celebration-rule" aria-hidden="true"><i /></div>
      </section>
    </div>
  </div>;
}

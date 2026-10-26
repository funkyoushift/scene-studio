import React, { useEffect, useRef, useState } from "react";
import { watchAutomationEvents } from "./automation-twitch.mjs";

// This component deliberately imports no editor CSS: html/body and the video
// stay transparent, and only the visible object captures pointer events.
export default function AutomationViewer({ helper, auth, creator, viewMode = "overlay" }) {
  const [active, setActive] = useState(null), [slideIndex, setSlideIndex] = useState(0);
  const [connection, setConnection] = useState({ state: "loading", message: "Loading live moments…" });
  const [retry, setRetry] = useState(0);
  const container = useRef(null);
  useEffect(() => {
    if (active && viewMode === "mobile") container.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [active, viewMode, creator?.login]);
  useEffect(() => {
    setActive(null);
    setConnection({ state: "loading", message: "Loading live moments…" });
    if (!helper || !auth?.token || !auth.channelId) return;
    return watchAutomationEvents(helper, auth, next => {
      setConnection({ state: "ready", message: "Channel effects loaded. Waiting for a live moment." });
      setActive(previous => previous && previous.event.revision !== next.revision ? null : previous);
    }, (event, config) => { setSlideIndex(0); setActive({ event, config }); }, message => {
      setConnection({ state: "error", message: `Live moments could not connect. ${message}` });
    }, undefined, undefined, { catchUp: viewMode === "mobile" });
  }, [helper, auth?.channelId, auth?.token, retry, viewMode]);
  useEffect(() => {
    if (!active) return;
    const dismiss = setTimeout(() => setActive(null), Math.max(0, active.event.expires - Date.now()));
    const advance = setInterval(() => setSlideIndex(index => index + 1), 5000);
    return () => { clearTimeout(dismiss); clearInterval(advance); };
  }, [active]);
  if (!active || !creator?.login) return viewMode === "mobile" ? <section className="mobile-live-status" aria-label="Live moments connection">
    <p role="status">{connection.message}</p>
    <button className="mobile-secondary" disabled={connection.state === "loading"} onClick={() => setRetry(value => value + 1)}>Reconnect live moments</button>
  </section> : null;
  const effect = active.event.effect;
  const carousel = effect.type === "carousel" ? active.config.design.carousels.find(c => c.id === effect.carouselId) : null;
  const slide = carousel?.slides[((slideIndex % carousel.slides.length) + carousel.slides.length) % carousel.slides.length];
  return <div ref={container} className={`ss-live-automation${viewMode === "mobile" ? " ss-live-mobile" : ""}`}>
    <style>{`
      .ss-live-automation{position:fixed;inset:0;z-index:1000;pointer-events:none;font:14px system-ui,sans-serif;color:#f6fff7}
      .ss-live-card{position:absolute;bottom:9%;right:3%;width:min(300px,38vw);max-height:78%;overflow:auto;border:1px solid #b8ea7599;border-radius:16px;background:#101a16f2;box-shadow:0 10px 40px #0008;pointer-events:auto}
      .ss-live-card header,.ss-live-nav{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px}
      .ss-live-card header{font-size:12px}.ss-live-automation button{font:inherit;color:inherit;border:1px solid #74996b;background:#243b2c;border-radius:8px;padding:6px 10px;cursor:pointer}
      .ss-live-automation button:focus-visible,.ss-live-automation a:focus-visible{outline:3px solid #e1ff9e;outline-offset:2px}
      .ss-live-card img{display:block;width:100%;height:min(21vh,190px);object-fit:contain;background:#ffffff0b}
      .ss-live-copy{padding:10px 13px}.ss-live-copy strong{font-size:16px}.ss-live-copy p{margin:7px 0}.ss-live-copy a{display:inline-block;color:#d0ff9c;padding:5px 0}
      .ss-live-celebration{position:absolute;left:12%;right:12%;top:32%;text-align:center;padding:22px;border-radius:20px;background:#14251fee;box-shadow:0 0 60px #c2ec7877;font-size:clamp(16px,3vw,38px);overflow-wrap:anywhere;pointer-events:none}
      .ss-live-celebration button{position:absolute;right:5px;top:5px;font-size:14px;pointer-events:auto}.ss-live-stars{color:#dbff82;letter-spacing:.4em}
      .ss-live-credit{display:block;font-size:11px;line-height:1.4;color:#d7e9d0;padding:5px 12px 9px;letter-spacing:normal}
      @media(max-width:500px){.ss-live-card{width:52vw;bottom:10%;right:2%;font-size:11px}.ss-live-copy strong{font-size:13px}.ss-live-card header{font-size:10px}}
      .ss-live-mobile{position:relative;inset:auto;z-index:auto;font-size:15px}
      .ss-live-mobile .ss-live-card{position:relative;inset:auto;width:100%;max-height:none;box-sizing:border-box;margin-bottom:16px;font-size:15px}
      .ss-live-mobile .ss-live-card header{font-size:14px}.ss-live-mobile .ss-live-copy strong{font-size:18px}
      .ss-live-mobile .ss-live-card img{height:180px;max-height:45vh}
      .ss-live-mobile button,.ss-live-mobile a{min-width:44px;min-height:44px;box-sizing:border-box}
      .ss-live-mobile .ss-live-celebration{position:relative;inset:auto;margin:0 0 16px;padding:54px 16px 18px;font-size:22px}
      @media(prefers-reduced-motion:reduce){.ss-live-automation *{animation:none!important;transition:none!important}}
    `}</style>
    {carousel && slide && <aside className="ss-live-card" aria-label={carousel.title}>
      <header><span>{carousel.title}</span><button aria-label="Dismiss carousel" onClick={() => setActive(null)}>×</button></header>
      {slide.image && <img src={slide.image} alt={slide.title} />}
      <div className="ss-live-copy"><strong>{slide.title}</strong><p>{slide.caption}</p>
        {active.config.ownedMerch && slide.url && <a href={slide.url} target="_blank" rel="noopener noreferrer">View item ↗</a>}
      </div>
      <div className="ss-live-nav"><button aria-label="Previous slide" onClick={() => setSlideIndex(index => index - 1)}>←</button><span>{((slideIndex % carousel.slides.length) + carousel.slides.length) % carousel.slides.length + 1} / {carousel.slides.length}</span><button aria-label="Next slide" onClick={() => setSlideIndex(index => index + 1)}>→</button></div>
      <small className="ss-live-credit">Created by @{creator.login} with Scene Studio</small>
    </aside>}
    {effect.type === "celebrate" && <div className="ss-live-celebration" role="status"><button aria-label="Dismiss celebration" onClick={() => setActive(null)}>×</button><div className="ss-live-stars" aria-hidden="true">✦ ✨ ✦</div><strong>{effect.message}</strong><div className="ss-live-stars" aria-hidden="true">✦ ✨ ✦</div><small className="ss-live-credit">Created by @{creator.login} with Scene Studio</small></div>}
  </div>;
}

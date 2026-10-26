import React, { useEffect, useRef, useState } from "react";
import { watchAutomationEvents } from "./automation-twitch.mjs";

// This component deliberately imports no editor CSS: html/body and the video
// stay transparent, and only the visible object captures pointer events.
export default function AutomationViewer({ helper, auth, creator, viewMode = "overlay", brandImage }) {
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
  const brand = <div className="ss-live-brand">{brandImage && <img src={brandImage} alt="" />}<span>@{creator.login}</span></div>;
  return <div ref={container} className={`ss-live-automation${viewMode === "mobile" ? " ss-live-mobile" : ""}`}>
    <style>{`
      .ss-live-automation{position:fixed;inset:0;z-index:1000;pointer-events:none;font:14px system-ui,sans-serif;color:#f5f8ff}
      .ss-live-card{position:absolute;bottom:9%;right:3%;width:min(300px,38vw);max-height:78%;overflow:auto;border:1px solid #52cfde66;border-radius:16px;background:#0c1527f7;box-shadow:0 10px 40px #0008,0 0 22px #39c9de18;pointer-events:auto;animation:ss-live-enter .28s ease-out both}
      .ss-live-card header,.ss-live-celebration header,.ss-live-nav{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px}
      .ss-live-card header,.ss-live-celebration header{border-bottom:2px solid #ff7a18;background:#142139;font-size:13px;border-radius:15px 15px 0 0}
      .ss-live-brand{display:flex;align-items:center;gap:9px;min-width:0;text-align:left;font-size:14px;font-weight:700;letter-spacing:0;color:#fff2e8}
      .ss-live-brand span{min-width:0;overflow-wrap:anywhere}
      .ss-live-brand img{display:block;width:36px;height:36px;max-height:none;flex:0 0 36px;object-fit:contain;border-radius:8px;background:#07101c;padding:2px;border:1px solid #4fc9dc66}
      .ss-live-collection{margin:0;padding:10px 13px;font-size:13px;font-weight:600;color:#a6dfeb;overflow-wrap:anywhere}
      .ss-live-automation button{font:inherit;color:#f5f8ff;border:1px solid #56849d;background:#1b3049;border-radius:8px;padding:6px 10px;cursor:pointer;flex-shrink:0}
      .ss-live-automation button:hover{background:#29445e;border-color:#ff7a18}
      .ss-live-automation button:focus-visible,.ss-live-automation a:focus-visible{outline:3px solid #ff9a4d;outline-offset:2px}
      .ss-live-card > .ss-live-product-image{display:block;width:100%;height:min(16vh,160px);object-fit:contain;background:#ffffff0b}
      .ss-live-copy{padding:10px 13px;overflow-wrap:anywhere}.ss-live-copy strong{font-size:16px}.ss-live-copy p{margin:7px 0;color:#d2dcea}.ss-live-copy a{display:inline-block;color:#ffb47c;padding:5px 0}
      .ss-live-celebration{position:absolute;left:12%;right:12%;top:32%;text-align:center;padding:0 0 18px;border:1px solid #52cfde66;border-radius:18px;background:#0c1527f7;box-shadow:0 10px 40px #0008,0 0 40px #39c9de22;font-size:clamp(16px,3vw,38px);overflow-wrap:anywhere;pointer-events:none;animation:ss-live-enter .28s ease-out both}
      .ss-live-celebration button{font-size:14px;pointer-events:auto}.ss-live-celebration > strong{display:block;padding:0 16px}.ss-live-stars{color:#ff7a18;letter-spacing:.3em;padding:8px 12px}
      .ss-live-credit{display:block;font-size:11px;line-height:1.4;color:#aec4da;padding:5px 12px 9px;letter-spacing:normal;overflow-wrap:anywhere}
      @keyframes ss-live-enter{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
      @media(max-width:500px){.ss-live-card{width:52vw;bottom:10%;right:2%;font-size:12px}.ss-live-copy strong{font-size:14px}.ss-live-brand{font-size:12px}}
      @media(max-height:500px){.ss-live-card{font-size:12px}.ss-live-card header{padding:6px 10px}.ss-live-brand img{width:28px;height:28px;flex-basis:28px}.ss-live-copy{padding:9px 12px}.ss-live-copy strong{font-size:14px}.ss-live-copy p{line-height:1.35;margin:6px 0}.ss-live-credit{font-size:10px;padding-bottom:7px}}
      .ss-live-mobile{position:relative;inset:auto;z-index:auto;font-size:15px;min-width:0;max-width:100%}
      .ss-live-mobile .ss-live-card{position:relative;inset:auto;width:100%;max-height:none;box-sizing:border-box;margin-bottom:16px;font-size:15px}
      .ss-live-mobile .ss-live-card header{font-size:14px}.ss-live-mobile .ss-live-copy strong{font-size:18px}
      .ss-live-mobile .ss-live-card > .ss-live-product-image{height:180px;max-height:45vh}
      .ss-live-mobile .ss-live-brand{font-size:14px}.ss-live-mobile .ss-live-nav{flex-wrap:wrap}
      .ss-live-mobile button,.ss-live-mobile a{min-width:44px;min-height:44px;box-sizing:border-box}
      .ss-live-mobile .ss-live-celebration{position:relative;inset:auto;width:100%;max-width:100%;box-sizing:border-box;margin:0 0 16px;padding:0 0 18px;font-size:22px}
      @media(prefers-reduced-motion:reduce){.ss-live-automation *{animation:none!important;transition:none!important}}
    `}</style>
    {carousel && slide && <aside key={active.event.eventId} className="ss-live-card" aria-label={carousel.title}>
      <header>{brand}<button aria-label="Dismiss carousel" onClick={() => setActive(null)}>×</button></header>
      {carousel.title !== slide.title && <p className="ss-live-collection">{carousel.title}</p>}
      {slide.image && <img className="ss-live-product-image" src={slide.image} alt={slide.title} />}
      <div className="ss-live-copy"><strong>{slide.title}</strong><p>{slide.caption}</p>
        {active.config.ownedMerch && slide.url && <a href={slide.url} target="_blank" rel="noopener noreferrer">Open link ↗</a>}
      </div>
      {carousel.slides.length > 1 && <div className="ss-live-nav"><button aria-label="Previous slide" onClick={() => setSlideIndex(index => index - 1)}>←</button><span>{((slideIndex % carousel.slides.length) + carousel.slides.length) % carousel.slides.length + 1} / {carousel.slides.length}</span><button aria-label="Next slide" onClick={() => setSlideIndex(index => index + 1)}>→</button></div>}
      <small className="ss-live-credit">Created by @{creator.login} with Scene Studio</small>
    </aside>}
    {effect.type === "celebrate" && <div key={active.event.eventId} className="ss-live-celebration" role="status"><header>{brand}<button aria-label="Dismiss celebration" onClick={() => setActive(null)}>×</button></header><div className="ss-live-stars" aria-hidden="true">✦ ✨ ✦</div><strong>{effect.message}</strong><div className="ss-live-stars" aria-hidden="true">✦ ✨ ✦</div><small className="ss-live-credit">Created by @{creator.login} with Scene Studio</small></div>}
  </div>;
}

import React, { useState } from "react";
import { safeShoutoutProfile, shoutoutChannelUrl } from "./shoutout-contract.mjs";
import "./shoutout.css";

export default function Shoutout({ profile, effect, creator, onDismiss, mobile = false }) {
  const [imageFailed, setImageFailed] = useState(false);
  const clean = safeShoutoutProfile(profile);
  if (!clean || effect?.type !== "shoutout") return null;
  const message = effect.message.replaceAll("{name}", clean.displayName);
  const initial = clean.displayName.trim().slice(0, 1).toUpperCase();
  return <aside className={`ss-shoutout${mobile ? " ss-shoutout-mobile" : ""}`} style={{ "--ss-shoutout-color": effect.color }} aria-label={`Creator shoutout for ${clean.displayName}`}>
    <header><span>Creator shoutout</span><button type="button" aria-label="Dismiss shoutout" onClick={onDismiss}>×</button></header>
    <div className="ss-shoutout-main">
      {clean.image && !imageFailed ? <img src={clean.image} alt="" onError={() => setImageFailed(true)} /> : <span className="ss-shoutout-avatar" aria-hidden="true">{initial}</span>}
      <div><strong>{clean.displayName}</strong><span>@{clean.login}</span></div>
    </div>
    <p>{message}</p>
    <a href={shoutoutChannelUrl(clean)} target="_blank" rel="noopener noreferrer">Visit channel ↗</a>
    {creator && <small>Shared by @{creator} with Scene Studio</small>}
  </aside>;
}

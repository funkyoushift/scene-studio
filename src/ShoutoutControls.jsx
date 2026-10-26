import React, { useEffect, useRef, useState } from "react";

function ChannelList({ label, value, onChange, help }) {
  const [draft, setDraft] = useState(value.join(", "));
  const focused = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!focused.current) setDraft(value.join(", ")); }, [value.join(",")]);
  return <label>{label}<textarea rows={2} value={draft} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; if (!error) setDraft(value.join(", ")); }} placeholder="channel_one, channel_two" onChange={event => {
    const text = event.target.value; setDraft(text);
    const names = [...new Set(text.split(/[\s,]+/).filter(Boolean).map(name => name.replace(/^@/, "").toLowerCase()))];
    if (names.length > 50 || names.some(name => !/^[a-z0-9_]{1,25}$/.test(name))) { setError("Use up to 50 Twitch usernames, separated by commas."); return; }
    setError(""); onChange(names);
  }}/><small>{error || help}</small></label>;
}

export function ShoutoutTriggerControls({ trigger, onChange }) {
  const automatic = trigger.mode !== "command";
  return <div className="flow-fields flow-shoutout-controls">
    <label>WHEN TO SHOUT OUT<select value={trigger.mode} onChange={event => onChange({ mode: event.target.value })}>
      <option value="both">Automatically + moderator command</option>
      <option value="automatic">Automatically on first chat message</option>
      <option value="command">Only on moderator command</option>
    </select></label>
    {trigger.mode !== "automatic" && <p><b>!so @username</b> — you or a moderator can type this in chat. It does not send a separate chat message.</p>}
    {automatic && <>
      <p>During a live stream, show the card when a matching person first speaks in chat. Simply opening the stream does not trigger a shoutout.</p>
      <fieldset><legend>AUTOMATICALLY INCLUDE</legend>{[["partner", "Twitch Partners"], ["affiliate", "Twitch Affiliates"], ["regular", "Other Twitch users"]].map(([type, label]) => <label className="flow-option-check" key={type}><input type="checkbox" checked={trigger.types.includes(type)} onChange={event => onChange({ types: event.target.checked ? [...trigger.types, type] : trigger.types.filter(item => item !== type) })}/>{label}</label>)}</fieldset>
      <ChannelList label="ALSO INCLUDE THESE CHANNELS" value={trigger.users} onChange={users => onChange({ users })} help="These people qualify even if their account type is not selected above."/>
      {!trigger.types.length && !trigger.users.length && <p role="status">Choose an account type or add a channel to enable automatic matches.</p>}
    </>}
    <ChannelList label="NEVER SHOUT OUT" value={trigger.exclusions} onChange={exclusions => onChange({ exclusions })} help="Excluded usernames are blocked for both automatic and command shoutouts."/>
    <small>Automatic shoutouts are limited to once per person per stream. The cooldown below spaces cards apart. Account type is their Twitch creator status, not their role in your chat.</small>
  </div>;
}

export function ShoutoutCardControls({ effect, onChange }) {
  return <div className="flow-fields flow-shoutout-controls">
    <p>Their Twitch profile picture and display name load automatically. The card includes a clickable Visit channel button. If no image is available, it shows their initial.</p>
    <label>SHOUTOUT MESSAGE<input maxLength={160} value={effect.message} onChange={event => onChange({ message: event.target.value })}/><small>Use {"{name}"} for their display name.</small></label>
    <label>ACCENT COLOR<input type="color" value={effect.color} onChange={event => onChange({ color: event.target.value })}/></label>
    <label>SECONDS ON SCREEN<input type="number" min="5" max="30" value={effect.durationSeconds} onChange={event => onChange({ durationSeconds: Math.max(5, Math.min(30, Number(event.target.value) || 5)) })}/></label>
    <small>The preview uses a sample person. Published shoutouts use the selected person’s real Twitch profile.</small>
  </div>;
}

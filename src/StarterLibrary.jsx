import React from "react";
import { INTERACTIVE_PRESET_OPTIONS } from "./templates.mjs";
import "./starter-library.css";

export default function StarterLibrary({ objectCount, maxObjects, onAdd, onOpenAutomation }) {
  return <section className="starter-library" aria-labelledby="starter-library-heading">
    <div className="starter-library-heading">
      <span className="starter-eyebrow">START WITH A MOMENT</span>
      <h2 id="starter-library-heading">Add something interactive</h2>
      <p>Pick a starter, personalize it, then try it in your viewer preview.</p>
    </div>
    <div className="starter-list">
      {INTERACTIVE_PRESET_OPTIONS.map(option => {
        const full = objectCount + option.objectCount > maxObjects;
        return <article className="starter-card" key={option.key}>
          <span className="starter-icon" aria-hidden="true">{option.icon}</span>
          <span className="starter-copy"><strong>{option.title}</strong><small>{option.description}</small></span>
          <button type="button" className="starter-add" disabled={full} title={full ? `This starter needs ${option.objectCount} open object slot${option.objectCount === 1 ? "" : "s"}.` : `Add ${option.title}`} onClick={() => onAdd(option.key)}>Add</button>
        </article>;
      })}
    </div>
    <p className="starter-limit" aria-live="polite">{objectCount} of {maxObjects} objects used.</p>
    <button type="button" className="starter-automation" onClick={onOpenAutomation}>Add chat, subscriber, or Hype Train triggers →</button>
  </section>;
}

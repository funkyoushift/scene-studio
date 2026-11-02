import React, { useState } from "react";
import { validateAutomations } from "../src/automations.mjs";
import { prepareImage } from "../src/images.mjs";

// Hold incomplete text in the form until Save, so validation never interrupts typing.
export default function FlowDetails({
  workspace,
  page,
  onSave,
  onPreview,
  onFullEditor,
  onPreviewWhole,
}) {
  const [design, setDesign] = useState(() =>
    structuredClone(workspace.automation),
  );
  const [notice, setNotice] = useState("");
  const rules = design.rules.filter((r) => page.ruleIds.includes(r.id));
  const cards = design.carousels.filter((c) => page.carouselIds.includes(c.id));
  const slideChange = (id, index, field, value) =>
    setDesign((old) => ({
      ...old,
      carousels: old.carousels.map((c) =>
        c.id === id
          ? {
              ...c,
              slides: c.slides.map((s, i) =>
                i === index ? { ...s, [field]: value } : s,
              ),
            }
          : c,
      ),
    }));
  const ruleChange = (id, patch) =>
    setDesign((old) => ({
      ...old,
      rules: old.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  const validated = (fn) => {
    try {
      fn(validateAutomations(design));
    } catch (e) {
      setNotice(e.message);
    }
  };
  return (
    <section className="panel fields">
      {notice && <p role="status">{notice}</p>}
      <h2>Pictures and messages</h2>
      <p>Edit the cards and event rules below, then save your local changes.</p>
      {cards.map((c) => (
        <section key={c.id} className="flow-cards">
          <h3>{c.title}</h3>
          {c.slides.map((s, i) => (
            <details key={s.id} open={i === 0}>
              <summary>
                Card {i + 1} · {s.title || "Untitled"}
              </summary>
              <div className="fields">
                <label>
                  Card title
                  <input
                    maxLength={70}
                    value={s.title}
                    onChange={(e) =>
                      slideChange(c.id, i, "title", e.target.value)
                    }
                  />
                </label>
                <label>
                  Short text
                  <input
                    maxLength={100}
                    value={s.caption}
                    onChange={(e) =>
                      slideChange(c.id, i, "caption", e.target.value)
                    }
                  />
                </label>
                <label>
                  Website link
                  <input
                    type="url"
                    placeholder="https://…"
                    value={s.url}
                    onChange={(e) =>
                      slideChange(c.id, i, "url", e.target.value)
                    }
                  />
                </label>
                <label>
                  Custom picture
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={async (e) => {
                      const f = e.target.files[0];
                      if (!f) return;
                      try {
                        slideChange(c.id, i, "image", await prepareImage(f));
                        setNotice(
                          "Picture ready. Save to keep it in your local draft.",
                        );
                      } catch (error) {
                        setNotice(error.message);
                      }
                    }}
                  />
                </label>
              </div>
            </details>
          ))}
        </section>
      ))}
      <h2>When it appears</h2>
      {rules.map((r) => (
        <details key={r.id} open={rules.length === 1}>
          <summary>{r.name}</summary>
          <div className="fields">
            <label className="check-row">
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={(e) =>
                  ruleChange(r.id, { enabled: e.target.checked })
                }
              />{" "}
              Enabled in this draft
            </label>
            {r.trigger.type === "keyword" ? (
              <label>
                Chat word or phrase
                <input
                  maxLength={80}
                  value={r.trigger.phrase}
                  onChange={(e) =>
                    ruleChange(r.id, {
                      trigger: { ...r.trigger, phrase: e.target.value },
                    })
                  }
                />
              </label>
            ) : (
              <p>
                Trigger:{" "}
                {r.trigger.type === "interval"
                  ? `Every ${r.trigger.everySeconds} seconds`
                  : r.trigger.type === "shoutout"
                    ? "Creator arrival or shoutout command"
                    : r.trigger.event}
              </p>
            )}
            {r.effect.message !== undefined && (
              <label>
                Message
                <input
                  maxLength={160}
                  value={r.effect.message}
                  onChange={(e) =>
                    ruleChange(r.id, {
                      effect: { ...r.effect, message: e.target.value },
                    })
                  }
                />
              </label>
            )}
            <label>
              Minimum seconds between appearances
              <input
                type="number"
                min="0"
                value={r.cooldownSeconds}
                onChange={(e) =>
                  ruleChange(r.id, { cooldownSeconds: Number(e.target.value) })
                }
              />
            </label>
            <button
              onClick={() =>
                validated((automation) =>
                  onPreview(r, { ...workspace, automation }),
                )
              }
            >
              Preview {r.name}
            </button>
          </div>
        </details>
      ))}
      <button className="primary" onClick={() => validated(onPreviewWhole)}>
        Save & preview in scene →
      </button>
      <button
        className="primary"
        onClick={() =>
          validated((automation) => {
            onSave(automation);
            setNotice("Saved in this local scene draft.");
          })
        }
      >
        Save local changes
      </button>
      <button
        onClick={() =>
          validated((automation) => onFullEditor({ ...workspace, automation }))
        }
      >
        All triggers, sounds and layout settings ↗
      </button>
    </section>
  );
}

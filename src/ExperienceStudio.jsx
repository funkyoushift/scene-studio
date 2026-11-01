import React, { useEffect, useRef, useState } from "react";
import {
  experiencePrompt,
  experienceWarnings,
  newExperience,
  validateExperience,
} from "./experience.mjs";
import {
  exportExperience,
  importExperience,
  importMedia,
  loadExperience,
} from "./experience-media.mjs";
import { ExperienceMedia, ExperiencePlayer } from "./ExperiencePlayer.jsx";
import {
  EXPERIENCE_EXAMPLES,
  experienceExample,
} from "./experience-examples.mjs";

const uid = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const newPage = () => ({
  id: uid("scene"),
  title: "New scene",
  description: "",
  media: "",
  background: "#161b2e",
  elements: [],
});
const valueFor = (text, initial) =>
  typeof initial === "boolean"
    ? text === "true"
    : typeof initial === "number"
      ? Number(text)
      : text;
function ValueField({ value, initial, onChange, label = "Value" }) {
  return typeof initial === "boolean" ? (
    <label>
      {label}
      <select
        value={String(value)}
        onChange={(e) => onChange(e.target.value === "true")}
      >
        <option value="true">Yes / true</option>
        <option value="false">No / false</option>
      </select>
    </label>
  ) : (
    <label>
      {label}
      <input
        type={typeof initial === "number" ? "number" : "text"}
        value={value ?? ""}
        onChange={(e) => onChange(valueFor(e.target.value, initial))}
      />
    </label>
  );
}
function Actions({ value = [], onChange, design, label = "When clicked" }) {
  const update = (index, patch) =>
    onChange(value.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  return (
    <fieldset className="experience-rules">
      <legend>{label}</legend>
      {value.map((a, i) => (
        <div className="experience-rule" key={i}>
          <select
            aria-label={`Action ${i + 1}`}
            value={a.type}
            onChange={(e) => {
              const type = e.target.value,
                v = design.variables.find((v) =>
                  type === "add"
                    ? typeof v.initial === "number"
                    : type === "toggle"
                      ? typeof v.initial === "boolean"
                      : true,
                );
              onChange(
                value.map((old, n) =>
                  n !== i
                    ? old
                    : type === "goto"
                      ? { type, scene: design.start }
                      : type === "random"
                        ? { type, scenes: [design.start] }
                        : type === "restart"
                          ? { type }
                          : {
                              type,
                              variable: v?.id ?? "",
                              ...(type === "toggle"
                                ? {}
                                : {
                                    value:
                                      type === "add" ? 1 : (v?.initial ?? ""),
                                  }),
                            },
                ),
              );
            }}
          >
            <option value="goto">Go to scene</option>
            <option value="set">Remember / set value</option>
            <option value="add">Add to number</option>
            <option value="toggle">Toggle yes/no</option>
            <option value="random">Random scene</option>
            <option value="restart">Restart experience</option>
          </select>
          {a.type === "goto" && (
            <select
              aria-label="Destination scene"
              value={a.scene}
              onChange={(e) => update(i, { scene: e.target.value })}
            >
              {design.scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title || s.id}
                </option>
              ))}
            </select>
          )}
          {a.type === "random" && (
            <label>
              Possible destinations
              <select
                multiple
                value={a.scenes}
                onChange={(e) =>
                  update(i, {
                    scenes: [...e.target.selectedOptions].map((o) => o.value),
                  })
                }
              >
                {design.scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title || s.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          {["set", "add", "toggle"].includes(a.type) && (
            <>
              <select
                aria-label="Action variable"
                value={a.variable}
                onChange={(e) =>
                  update(i, {
                    variable: e.target.value,
                    value:
                      a.type === "add"
                        ? 1
                        : design.variables.find((v) => v.id === e.target.value)
                            ?.initial,
                  })
                }
              >
                <option value="">Choose a variable</option>
                {design.variables
                  .filter((v) =>
                    a.type === "add"
                      ? typeof v.initial === "number"
                      : a.type === "toggle"
                        ? typeof v.initial === "boolean"
                        : true,
                  )
                  .map((v) => (
                    <option key={v.id}>{v.id}</option>
                  ))}
              </select>
              {a.type !== "toggle" && (
                <ValueField
                  value={a.value}
                  initial={
                    design.variables.find((v) => v.id === a.variable)?.initial
                  }
                  onChange={(v) => update(i, { value: v })}
                />
              )}
            </>
          )}
          <button
            aria-label={`Remove action ${i + 1}`}
            onClick={() => onChange(value.filter((_, n) => n !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        disabled={value.length >= 16}
        onClick={() =>
          onChange([...value, { type: "goto", scene: design.start }])
        }
      >
        + Action
      </button>
      <small>Remember values first; place one scene change last.</small>
    </fieldset>
  );
}
function Conditions({ value = [], onChange, design }) {
  return (
    <fieldset className="experience-rules">
      <legend>Show only when all match</legend>
      {value.map((c, i) => {
        const update = (patch) =>
          onChange(
            value.map((old, n) => (n === i ? { ...old, ...patch } : old)),
          );
        const variable = design.variables.find((v) => v.id === c.variable);
        return (
          <div className="experience-rule" key={i}>
            <select
              aria-label="Condition variable"
              value={c.variable}
              onChange={(e) =>
                update({
                  variable: e.target.value,
                  op: "eq",
                  value: design.variables.find((v) => v.id === e.target.value)
                    .initial,
                })
              }
            >
              {design.variables.map((v) => (
                <option key={v.id}>{v.id}</option>
              ))}
            </select>
            <select
              aria-label="Comparison"
              value={c.op}
              onChange={(e) => update({ op: e.target.value })}
            >
              {[
                ["eq", "equals"],
                ["ne", "does not equal"],
                ...(typeof variable?.initial === "number"
                  ? [
                      ["gt", "greater than"],
                      ["gte", "at least"],
                      ["lt", "less than"],
                      ["lte", "at most"],
                    ]
                  : []),
              ].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <ValueField
              initial={variable?.initial}
              value={c.value}
              onChange={(value) => update({ value })}
            />
            <button onClick={() => onChange(value.filter((_, n) => n !== i))}>
              Remove condition
            </button>
          </div>
        );
      })}
      <button
        disabled={!design.variables.length || value.length >= 12}
        onClick={() =>
          onChange([
            ...value,
            {
              variable: design.variables[0].id,
              op: "eq",
              value: design.variables[0].initial,
            },
          ])
        }
      >
        + Condition
      </button>
    </fieldset>
  );
}
export default function ExperienceStudio({
  slot,
  onSave,
  onClose,
  onRemove,
  draftKey = "scene-studio-experience-workspace",
}) {
  const [design, setDesign] = useState(null),
    [selectedPage, setSelectedPage] = useState(""),
    [selectedElement, setSelectedElement] = useState("");
  const [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [playing, setPlaying] = useState(false),
    [ai, setAI] = useState(false),
    [json, setJson] = useState(""),
    [variableName, setVariableName] = useState("");
  const [downloadURL, setDownloadURL] = useState("");
  useEffect(
    () => () => {
      if (downloadURL) URL.revokeObjectURL(downloadURL);
    },
    [downloadURL],
  );
  const [history, setHistory] = useState([]),
    stage = useRef(null),
    drag = useRef(null),
    current = useRef(null),
    backup = useRef(null),
    touched = useRef(false);
  const initialSlot = useRef(slot);
  useEffect(() => {
    let active = true;
    (initialSlot.current
      ? loadExperience(initialSlot.current)
      : Promise.resolve(newExperience())
    )
      .then((next) => {
        if (!active) return;
        try {
          const saved = localStorage.getItem(draftKey);
          if (saved) {
            const restored = validateExperience(JSON.parse(saved));
            if (!initialSlot.current) {
              next = restored;
              setNotice("Restored your unfinished device draft.");
            } else {
              backup.current = restored;
              setNotice(
                "A device draft is available. Restore it below if you want to continue those edits.",
              );
            }
          }
        } catch {
          /* ignore invalid drafts */
        }
        setDesign(next);
        setSelectedPage(next.start);
      })
      .catch((e) => {
        if (active) setNotice(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  current.current = design;
  let clean,
    problem = "";
  try {
    if (design) clean = validateExperience(design);
  } catch (e) {
    problem = e.message;
  }
  useEffect(() => {
    if (!design || !touched.current) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(design));
    } catch {
      setNotice("Device storage is full. Export a backup before closing.");
    }
  }, [design, draftKey]);
  const edit = (next) => {
    touched.current = true;
    const previous = current.current;
    setHistory((old) => [...old.slice(-29), previous]);
    setDesign(next);
  };
  const page =
    design?.scenes.find((s) => s.id === selectedPage) || design?.scenes[0];
  const element = page?.elements.find((e) => e.id === selectedElement);
  const pageEdit = (patch) =>
    edit({
      ...design,
      scenes: design.scenes.map((s) =>
        s.id === page.id ? { ...s, ...patch } : s,
      ),
    });
  const elementEdit = (patch) =>
    pageEdit({
      elements: page.elements.map((e) =>
        e.id === element.id ? { ...e, ...patch } : e,
      ),
    });
  const run = async (action) => {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const download = (text) => {
    setDownloadURL(
      URL.createObjectURL(new Blob([text], { type: "application/json" })),
    );
    setNotice(
      "Backup ready, including uploaded media. Choose Download backup to save the file.",
    );
  };
  if (!design)
    return (
      <section className="experience-studio">
        <p role="status">{notice || "Opening your experience…"}</p>
        <button onClick={onClose}>Back</button>
      </section>
    );
  return (
    <section className="experience-studio" aria-label="Experience builder">
      <header className="experience-studio-header">
        <div>
          <small>SCENE STUDIO · EXPERIENCE BUILDER</small>
          <h1>Create something viewers can explore.</h1>
          <p>
            Connect scenes, place interactive elements, and give choices
            consequences.
          </p>
        </div>
        <div className="experience-tools">
          <button onClick={onClose}>Back without applying</button>
          <button
            disabled={busy || !!problem}
            className="primary"
            onClick={() => onSave(clean)}
          >
            Apply to overlay
          </button>
        </div>
      </header>
      <div className="experience-tools">
        <button
          disabled={!history.length}
          onClick={() => {
            setDesign(history.at(-1));
            setHistory((old) => old.slice(0, -1));
          }}
        >
          Undo
        </button>
        <button disabled={!!problem} onClick={() => setPlaying((v) => !v)}>
          {playing ? "Edit experience" : "Play preview"}
        </button>
        <button onClick={() => setAI((v) => !v)}>Build with AI</button>
        <button
          disabled={busy || !!problem}
          onClick={() =>
            run(async () =>
              download(await exportExperience(clean), "experience-backup.json"),
            )
          }
        >
          Export with media
        </button>
        <label className="experience-file">
          Import experience
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files[0];
              e.target.value = "";
              if (file)
                run(async () => {
                  if (file.size > 140_000_000)
                    throw new Error("Keep backups under 140 MB.");
                  const next = await importExperience(await file.text());
                  edit(next);
                  setSelectedPage(next.start);
                });
            }}
          />
        </label>
        {onRemove && slot && (
          <button onClick={onRemove}>Remove from overlay</button>
        )}
        {backup.current && (
          <button
            onClick={() => {
              edit(backup.current);
              setSelectedPage(backup.current.start);
              backup.current = null;
              setNotice("Device draft restored.");
            }}
          >
            Restore device draft
          </button>
        )}
      </div>
      <p role="status" className="experience-notice">
        {busy
          ? "Working…"
          : notice ||
            "Draft stays on this device. Applying adds it to your overlay draft; it does not publish to Twitch."}
      </p>
      {downloadURL && (
        <a
          className="experience-download"
          href={downloadURL}
          download="experience-backup.json"
        >
          Download backup
        </a>
      )}
      {problem && (
        <p role="alert" className="experience-error">
          {problem}
        </p>
      )}
      <details className="experience-examples">
        <summary>Explore examples you can remix</summary>
        <p>
          Optional starting points. Your current draft can be restored with
          Undo.
        </p>
        <div className="experience-tools">
          {EXPERIENCE_EXAMPLES.map((example) => (
            <button
              key={example.id}
              onClick={() => {
                const next = experienceExample(example.id);
                edit(next);
                setSelectedPage(next.start);
                setSelectedElement("");
                setPlaying(false);
              }}
            >
              {example.name}
              <small>{example.description}</small>
            </button>
          ))}
        </div>
      </details>
      {ai && (
        <section className="experience-ai">
          <h2>Build with your AI</h2>
          <p>
            Upload your media first. Copy the instructions to your AI, describe
            your idea, and paste its design here. Review and play before
            applying.
          </p>
          <button
            onClick={() =>
              run(async () => {
                const prompt = experiencePrompt(design);
                try {
                  await navigator.clipboard.writeText(prompt);
                  setNotice("Instructions copied.");
                } catch {
                  setJson(prompt);
                  setNotice("Copy the instructions from the box.");
                }
              })
            }
          >
            Copy experience instructions
          </button>
          <label>
            AI design JSON
            <textarea
              rows={8}
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
          </label>
          <button
            onClick={() =>
              run(async () => {
                const next = await importExperience(json);
                edit(next);
                setSelectedPage(next.start);
                setNotice(
                  "Design imported. Play the preview to check its behavior.",
                );
              })
            }
          >
            Import AI design
          </button>
          <small>
            Uses your own AI account. No AI service is connected here.
          </small>
        </section>
      )}
      {playing && clean ? (
        <ExperiencePlayer key={JSON.stringify(clean)} design={clean} />
      ) : (
        <div className="experience-editor-grid">
          <aside>
            <h2>Your experience</h2>
            <label>
              Name
              <input
                maxLength={80}
                value={design.name}
                onChange={(e) => edit({ ...design, name: e.target.value })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={design.enabled !== false}
                onChange={(e) => edit({ ...design, enabled: e.target.checked })}
              />{" "}
              Available to viewers
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!design.saveProgress}
                onChange={(e) =>
                  edit({ ...design, saveProgress: e.target.checked })
                }
              />{" "}
              Remember progress on viewer’s device
            </label>
            <label>
              Starting scene
              <select
                value={design.start}
                onChange={(e) => edit({ ...design, start: e.target.value })}
              >
                {design.scenes.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.title || s.id}
                  </option>
                ))}
              </select>
            </label>
            <h2>Scenes · {design.scenes.length}</h2>
            <nav className="experience-scene-list">
              {design.scenes.map((s) => (
                <button
                  aria-pressed={s.id === page.id}
                  key={s.id}
                  onClick={() => {
                    setSelectedPage(s.id);
                    setSelectedElement("");
                  }}
                >
                  {s.title || s.id}
                  <small>
                    {s.elements.filter((e) => e.kind === "button").length}{" "}
                    choices
                  </small>
                </button>
              ))}
            </nav>
            <button
              disabled={design.scenes.length >= 100}
              onClick={() => {
                const s = newPage();
                edit({ ...design, scenes: [...design.scenes, s] });
                setSelectedPage(s.id);
              }}
            >
              + Scene
            </button>
            <button
              disabled={design.scenes.length >= 100}
              onClick={() => {
                const s = {
                  ...structuredClone(page),
                  id: uid("scene"),
                  title: `${page.title} copy`.slice(0, 100),
                };
                edit({ ...design, scenes: [...design.scenes, s] });
                setSelectedPage(s.id);
              }}
            >
              Duplicate scene
            </button>
            <button
              disabled={design.scenes.length <= 1}
              onClick={() => {
                const referenced = design.scenes.some(
                  (s) =>
                    s.id !== page.id &&
                    [
                      ...s.elements.flatMap((e) => e.actions ?? []),
                      ...(s.timer?.actions ?? []),
                      ...(s.videoEnd ?? []),
                    ].some(
                      (a) => a.scene === page.id || a.scenes?.includes(page.id),
                    ),
                );
                if (referenced || design.start === page.id) {
                  setNotice(
                    "Choose another start and remove links to this scene before deleting it.",
                  );
                  return;
                }
                edit({
                  ...design,
                  scenes: design.scenes.filter((s) => s.id !== page.id),
                });
                setSelectedPage(design.start);
              }}
            >
              Delete scene
            </button>
            <h2>Media library</h2>
            <label className="experience-file">
              Upload images or video
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
                multiple
                disabled={busy}
                onChange={(e) => {
                  const files = [...e.target.files];
                  e.target.value = "";
                  run(async () => {
                    if (design.assets.length + files.length > 128)
                      throw new Error(
                        "This experience can hold 128 media files.",
                      );
                    const additions = [];
                    for (const f of files) additions.push(await importMedia(f));
                    edit({
                      ...current.current,
                      assets: [...current.current.assets, ...additions],
                    });
                    setNotice(
                      `${additions.length} media files saved on this device.`,
                    );
                  });
                }}
              />
            </label>
            <small>
              Images up to 10 MB; MP4/WebM up to 25 MB each. Images are resized;
              videos keep their original encoding. GIFs become still images.
            </small>
            {design.assets.map((a) => (
              <div className="experience-asset" key={a.id}>
                <span>
                  {a.kind === "video" ? "▶" : "▧"} {a.name}
                </span>
                <button onClick={() => pageEdit({ media: a.id })}>
                  Use in scene
                </button>
                <button
                  onClick={() => {
                    if (
                      design.scenes.some(
                        (s) =>
                          s.media === a.id ||
                          s.elements.some((e) => e.asset === a.id),
                      )
                    ) {
                      setNotice("Remove this media from its scenes first.");
                      return;
                    }
                    edit({
                      ...design,
                      assets: design.assets.filter(
                        (asset) => asset.id !== a.id,
                      ),
                    });
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </aside>
          <main>
            <div className="experience-tools">
              <button
                onClick={() => {
                  const e = {
                    id: uid("button"),
                    kind: "button",
                    label: "Continue",
                    x: 35,
                    y: 75,
                    width: 30,
                    height: 12,
                    actions: [],
                  };
                  pageEdit({ elements: [...page.elements, e] });
                  setSelectedElement(e.id);
                }}
                disabled={page.elements.length >= 40}
              >
                + Button / hotspot
              </button>
              <button
                onClick={() => {
                  const e = {
                    id: uid("text"),
                    kind: "text",
                    label: "Your text or {score}",
                    x: 10,
                    y: 10,
                    width: 70,
                    height: 16,
                    transparent: true,
                  };
                  pageEdit({ elements: [...page.elements, e] });
                  setSelectedElement(e.id);
                }}
                disabled={page.elements.length >= 40}
              >
                + Text
              </button>
              <button
                disabled={
                  !design.assets.some((a) => a.kind === "image") ||
                  page.elements.length >= 40
                }
                onClick={() => {
                  const e = {
                    id: uid("image"),
                    kind: "image",
                    label: "",
                    asset: design.assets.find((a) => a.kind === "image").id,
                    x: 10,
                    y: 30,
                    width: 25,
                    height: 25,
                    transparent: true,
                  };
                  pageEdit({ elements: [...page.elements, e] });
                  setSelectedElement(e.id);
                }}
              >
                + Image layer
              </button>
            </div>
            <div
              ref={stage}
              className="experience-stage experience-edit-stage"
              style={{ background: page.background }}
            >
              <ExperienceMedia
                asset={design.assets.find((a) => a.id === page.media)}
                className="experience-background"
                fit={page.fit}
              />
              {page.elements.map((e) => (
                <button
                  key={e.id}
                  className={`experience-element experience-edit-element ${selectedElement === e.id ? "selected" : ""}`}
                  style={{
                    left: `${e.x}%`,
                    top: `${e.y}%`,
                    width: `${e.width}%`,
                    height: `${e.height}%`,
                    color: e.color ?? "#fff",
                    background: e.transparent
                      ? "#ffffff20"
                      : (e.background ?? "#4338ca"),
                  }}
                  onClick={() => setSelectedElement(e.id)}
                  onPointerDown={(event) => {
                    touched.current = true;
                    setSelectedElement(e.id);
                    const bounds = stage.current.getBoundingClientRect();
                    drag.current = {
                      id: e.id,
                      startX: event.clientX,
                      startY: event.clientY,
                      x: e.x,
                      y: e.y,
                      bounds,
                      before: current.current,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const d = drag.current;
                    if (!d || d.id !== e.id) return;
                    const x = Math.max(
                      0,
                      Math.min(
                        100 - e.width,
                        d.x +
                          ((event.clientX - d.startX) / d.bounds.width) * 100,
                      ),
                    );
                    const y = Math.max(
                      0,
                      Math.min(
                        100 - e.height,
                        d.y +
                          ((event.clientY - d.startY) / d.bounds.height) * 100,
                      ),
                    );
                    setDesign((old) => ({
                      ...old,
                      scenes: old.scenes.map((s) =>
                        s.id === page.id
                          ? {
                              ...s,
                              elements: s.elements.map((item) =>
                                item.id === e.id
                                  ? {
                                      ...item,
                                      x: Math.round(x * 10) / 10,
                                      y: Math.round(y * 10) / 10,
                                    }
                                  : item,
                              ),
                            }
                          : s,
                      ),
                    }));
                  }}
                  onPointerUp={() => {
                    const before = drag.current?.before;
                    if (before)
                      setHistory((old) => [...old.slice(-29), before]);
                    drag.current = null;
                  }}
                  onPointerCancel={() => {
                    if (drag.current?.before) setDesign(drag.current.before);
                    drag.current = null;
                  }}
                >
                  {e.kind === "image" ? (
                    <ExperienceMedia
                      asset={design.assets.find((a) => a.id === e.asset)}
                    />
                  ) : (
                    e.label || "Clickable area"
                  )}
                </button>
              ))}
            </div>
            <p>
              Drag elements to position them. Transparent buttons remain visible
              here so you can edit them.
            </p>
            <label>
              Scene title
              <input
                value={page.title}
                maxLength={100}
                onChange={(e) => pageEdit({ title: e.target.value })}
              />
            </label>
            <label>
              Description / dialogue
              <textarea
                value={page.description}
                maxLength={3000}
                onChange={(e) => pageEdit({ description: e.target.value })}
              />
            </label>
            <div className="experience-tools">
              <label>
                Background
                <input
                  type="color"
                  value={page.background}
                  onChange={(e) => pageEdit({ background: e.target.value })}
                />
              </label>
              <label>
                Scene media
                <select
                  value={page.media}
                  onChange={(e) => pageEdit({ media: e.target.value })}
                >
                  <option value="">No media</option>
                  {design.assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Fit
                <select
                  value={page.fit ?? "contain"}
                  onChange={(e) => pageEdit({ fit: e.target.value })}
                >
                  <option value="contain">Show whole image / video</option>
                  <option value="cover">Fill scene</option>
                </select>
              </label>
            </div>
            {design.assets.find((a) => a.id === page.media)?.kind ===
              "video" && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={!!page.loop}
                    onChange={(e) => pageEdit({ loop: e.target.checked })}
                  />{" "}
                  Loop video
                </label>
                <p>
                  Video starts muted and has viewer playback and volume
                  controls.
                </p>
                <Actions
                  design={design}
                  label="When video ends (non-looping)"
                  value={page.videoEnd}
                  onChange={(actions) => pageEdit({ videoEnd: actions })}
                />
              </>
            )}
            <details>
              <summary>Scene timer</summary>
              <label>
                <input
                  type="checkbox"
                  checked={!!page.timer}
                  onChange={(e) =>
                    pageEdit({
                      timer: e.target.checked
                        ? { seconds: 30, actions: [] }
                        : undefined,
                    })
                  }
                />{" "}
                Enable countdown
              </label>
              {page.timer && (
                <>
                  <label>
                    Seconds
                    <input
                      type="number"
                      min="0.5"
                      max="3600"
                      step="0.5"
                      value={page.timer.seconds}
                      onChange={(e) =>
                        pageEdit({
                          timer: {
                            ...page.timer,
                            seconds: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <Actions
                    design={design}
                    label="When time runs out"
                    value={page.timer.actions}
                    onChange={(actions) =>
                      pageEdit({ timer: { ...page.timer, actions } })
                    }
                  />
                </>
              )}
            </details>
            <details>
              <summary>Map connections and checks</summary>
              {design.scenes.map((s) => (
                <p key={s.id}>
                  <b>{s.title || s.id}</b> →{" "}
                  {[
                    ...s.elements.flatMap((e) => e.actions ?? []),
                    ...(s.timer?.actions ?? []),
                    ...(s.videoEnd ?? []),
                  ]
                    .flatMap((a) =>
                      a.type === "goto"
                        ? [a.scene]
                        : a.type === "random"
                          ? a.scenes
                          : [],
                    )
                    .map(
                      (id) =>
                        design.scenes.find((s) => s.id === id)?.title || id,
                    )
                    .join(", ") || "No outgoing scene links"}
                </p>
              ))}
              {clean &&
                experienceWarnings(clean).map((message) => (
                  <p key={message}>{message}</p>
                ))}
            </details>
          </main>
          <aside>
            <h2>{element ? "Selected element" : "Choose an element"}</h2>
            {element && (
              <label>
                Motion
                <select
                  value={element.motion ?? "none"}
                  onChange={(event) =>
                    elementEdit({ motion: event.target.value })
                  }
                >
                  {["none", "float", "pulse", "sway"].map((motion) => (
                    <option key={motion} value={motion}>
                      {motion}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {element && (
              <>
                <label>
                  Text / accessible label
                  <input
                    value={element.label}
                    onChange={(e) => elementEdit({ label: e.target.value })}
                  />
                </label>
                <div className="experience-position">
                  {["x", "y", "width", "height"].map((field) => (
                    <label key={field}>
                      {field}
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={element[field]}
                        onChange={(e) =>
                          elementEdit({ [field]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
                <label>
                  Text color
                  <input
                    type="color"
                    value={element.color ?? "#ffffff"}
                    onChange={(e) => elementEdit({ color: e.target.value })}
                  />
                </label>
                <label>
                  Fill color
                  <input
                    type="color"
                    value={element.background ?? "#4338ca"}
                    onChange={(e) =>
                      elementEdit({ background: e.target.value })
                    }
                  />
                </label>
                <label>
                  Text size
                  <input
                    type="number"
                    min="12"
                    max="64"
                    value={element.fontSize ?? 18}
                    onChange={(e) =>
                      elementEdit({ fontSize: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={!!element.transparent}
                    onChange={(e) =>
                      elementEdit({ transparent: e.target.checked })
                    }
                  />{" "}
                  {element.kind === "button"
                    ? "Invisible hotspot (keep a descriptive label)"
                    : "Transparent background"}
                </label>
                {element.kind === "image" && (
                  <label>
                    Image
                    <select
                      value={element.asset}
                      onChange={(e) => elementEdit({ asset: e.target.value })}
                    >
                      {design.assets
                        .filter((a) => a.kind === "image")
                        .map((a) => (
                          <option value={a.id} key={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {element.kind === "button" && (
                  <Actions
                    design={design}
                    value={element.actions}
                    onChange={(actions) => elementEdit({ actions })}
                  />
                )}
                <Conditions
                  design={design}
                  value={element.when}
                  onChange={(when) => elementEdit({ when })}
                />
                <button
                  onClick={() => {
                    pageEdit({
                      elements: page.elements.filter(
                        (e) => e.id !== element.id,
                      ),
                    });
                    setSelectedElement("");
                  }}
                >
                  Delete element
                </button>
              </>
            )}
            <h2>Remembered values</h2>
            <p>
              Use yes/no for inventory or choices; numbers for scores or
              resources; text for names. Display one with {"{variableId}"}.
            </p>
            {design.variables.map((v) => (
              <div className="experience-variable" key={v.id}>
                <strong>{v.id}</strong>
                <ValueField
                  label="Starting value"
                  value={v.initial}
                  initial={v.initial}
                  onChange={(initial) =>
                    edit({
                      ...design,
                      variables: design.variables.map((old) =>
                        old.id === v.id ? { ...old, initial } : old,
                      ),
                    })
                  }
                />
                <button
                  onClick={() => {
                    const serialized = JSON.stringify(design.scenes);
                    if (serialized.includes(`"variable":"${v.id}"`)) {
                      setNotice(
                        "Remove actions and conditions using this variable first.",
                      );
                      return;
                    }
                    edit({
                      ...design,
                      variables: design.variables.filter(
                        (old) => old.id !== v.id,
                      ),
                    });
                  }}
                >
                  Remove variable
                </button>
              </div>
            ))}
            <label>
              New variable ID
              <input
                placeholder="score or has_key"
                value={variableName}
                onChange={(e) => setVariableName(e.target.value)}
              />
            </label>
            <div className="experience-tools">
              {[
                ["Yes / no", false],
                ["Number", 0],
                ["Text", ""],
              ].map(([name, initial]) => (
                <button
                  key={name}
                  disabled={design.variables.length >= 64}
                  onClick={() => {
                    if (
                      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(variableName) ||
                      ["constructor", "prototype"].includes(variableName) ||
                      design.variables.some((v) => v.id === variableName)
                    ) {
                      setNotice(
                        "Use a unique ID starting with a letter, followed by letters, numbers, dashes or underscores.",
                      );
                      return;
                    }
                    edit({
                      ...design,
                      variables: [
                        ...design.variables,
                        { id: variableName, initial },
                      ],
                    });
                    setVariableName("");
                  }}
                >
                  + {name}
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

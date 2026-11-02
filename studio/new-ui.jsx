import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {runtime} from './runtime.mjs';
import PublishPanel from './PublishPanel.jsx';
import {loadMazeTemplate} from './maze-template.mjs';
import {startStudioSignIn,signOutStudio} from '../src/studio-client.mjs';
import '@fontsource/dm-sans/latin-400.css';
import './base.css';
import merchArt from './merch.svg';
import creatorArt from './creator.svg';
import mazeArt from './maze.svg';
const {snapshot,automationSnapshot,auth}=runtime;
import {
  catalog,
  categories,
  findTemplates,
  makeTemplate,
  simpleContent,
  changeContent,
  eventFor,
  emptyScene,
  emptyAutomation,
} from "./catalog.mjs";
import { validateScene } from "../src/scene.mjs";
import {
  validateAutomations,
  deriveLegacyAutomationPages,
} from "../src/automations.mjs";
import { previewExperienceRule } from "../src/experience-preview.mjs";
import { prepareImage } from "../src/images.mjs";
import {
  sceneDraftStorageKey,
  automationDraftStorageKey,
} from "../src/draft-workspace.mjs";
import "./new-ui.css";
import FlowDetails from "./FlowDetails.jsx";
import {CommunityChoices} from '../src/CommunityChoices.jsx';
import '../src/community.css';
const {SAVE,BACKUP,SLUG,base}=runtime;
const liveURL = new URL('./legacy.html',location.href).href;
const communityURL=new URL('./community.html',location.href).href;
const art={merch:merchArt,avatar:creatorArt,maze:mazeArt};
function readDraft() {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE));
    if (v)
      return {
        ...v,
        scene: validateScene(v.scene),
        automation: validateAutomations(v.automation),
      };
  } catch {}
  return structuredClone(base);
}
function download(name, value) {
  const u = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
const tools = [
  {
    id: "overview",
    name: "Scene overview",
    text: "Arrange the whole scene and try viewer interactions.",
    words: "preview scene layer layout live publish published draft",
  },
  {
    id: "room",
    name: "Viewer rooms",
    text: "Create your invitation, preview the viewer room and share it with your community.",
    words: "room viewer tester invite link share guest community",
  },
  {
    id: "cards",
    name: "Cards Against Humanity",
    text: "Decks, expansions, house rules and a shared lobby.",
    words: "cards against humanity cah packs",
  },
  {
    id: "builder",
    name: "Game & story builder",
    text: "Scenes, images, videos, choices, timers and remembered values.",
    words: "maze game story map video engine",
  },
  {
    id: "ai",
    name: "Build with AI",
    text: "Use your own model, import its design, then preview.",
    words: "ai prompt json model",
  },
  {
    id: "media",
    name: "Media library",
    text: "Pictures in this draft and image uploads.",
    words: "upload image picture photo media",
  },
  {
    id: "connections",
    name: "Connections & live tests",
    text: "Twitch, chat arrivals, subscriptions and Hype Train.",
    words: "twitch connect permission chat affiliate partner arrival",
  },
  {
    id: "advanced",
    name: "Full editor & imports",
    text: "Every existing editing control, layouts, JSON and exports.",
    words: "advanced expert import export animation audio sound custom",
  },
  {
    id: "history",
    name: "Published history & recovery",
    text: "Restore published versions in the connected studio.",
    words: "undo restore rollback history backup",
  },
];
function Picture({ item }) {
  const photo =
    item.image ||
    (item.key === "quiet-vault"
      ? art.maze
      : /merch|product|featured|showcase/.test(item.key || "")
        ? art.merch
        : /shoutout/.test(item.key || "")
          ? art.avatar
          : null);
  return (
    <div
      className={`template-art tone-${(item.category || item.kind || "").length % 5}`}
    >
      {photo ? (
        <img src={photo} alt="" />
      ) : (
        <>
          <span className="art-badge">
            {item.type === "layout"
              ? "FULL SCENE"
              : item.type === "bundle"
                ? "STARTER BUNDLE"
                : "VIEWER MOMENT"}
          </span>
          <div className="art-card">
            <span>{item.icon || "✦"}</span>
            <b>{item.title || item.name}</b>
            <i>
              {item.type === "experience"
                ? "Choose your next step →"
                : item.category === "Celebrations"
                  ? "Thanks for being here!"
                  : "Your image · your message"}
            </i>
          </div>
        </>
      )}
    </div>
  );
}
function Frame({
  workspace,
  mode = "play",
  selected,
  onSelect,
  onObjects,
  onExperienceOpen,
  forceObjectId,
  autoOpenExperience = false,
  event,
  resetKey = 0,
}) {
  const ref = useRef(null),
    [ready, setReady] = useState(false),
    [frameError, setFrameError] = useState("");
  const data = {
    source: "studio-overview",
    scene: {
      ...workspace.scene,
      objects: workspace.scene.objects
        .filter(
          (o) => o.id === forceObjectId || !workspace.hidden?.includes(o.id),
        )
        .map((o) => (o.id === forceObjectId ? { ...o, popupOnly: false } : o)),
    },
    automation: workspace.automation,
    editing: mode === "arrange",
    selected,
    event,
    resetKey,
    autoOpenExperience,
  };
  let validationError = "";
  try {
    validateScene(data.scene);
    validateAutomations(data.automation);
  } catch (error) {
    validationError = error.message;
  }
  const latest = useRef(data);
  latest.current = validationError ? null : data;
  useEffect(() => {
    const receive = (e) => {
      if (
        e.origin !== location.origin ||
        e.source !== ref.current?.contentWindow ||
        e.data?.source !== "studio-preview"
      )
        return;
      if (e.data.ready) {
        setReady(true);
        if (latest.current)
          ref.current.contentWindow.postMessage(
            latest.current,
            location.origin,
          );
      }
      if (e.data.error) setFrameError(e.data.error);
      if (e.data.selected) onSelect?.(e.data.selected);
      if (e.data.objects) onObjects?.(e.data.objects);
      if (typeof e.data.experienceOpen === "boolean")
        onExperienceOpen?.(e.data.experienceOpen);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onSelect, onObjects, onExperienceOpen]);
  useEffect(() => {
    if (ready && !validationError) {
      setFrameError("");
      ref.current?.contentWindow.postMessage(data, location.origin);
    }
  }, [
    workspace,
    mode,
    selected,
    event,
    resetKey,
    ready,
    forceObjectId,
    autoOpenExperience,
  ]);
  return (
    <div>
      {(validationError || frameError) && (
        <p className="callout" role="status">
          Preview is waiting: {validationError || frameError}
        </p>
      )}
      <iframe
        ref={ref}
        className="scene-frame"
        title="Interactive scene preview"
        src="./studio/scene-preview.html"
      />
    </div>
  );
}
function App() {
  const [route, setRoute] = useState("home"),
    [query, setQuery] = useState(""),
    [group, setGroup] = useState("All templates"),
    [limit, setLimit] = useState(12),
    [draft, setDraft] = useState(readDraft),
    [notice, setNotice] = useState(""),
    [selection, setSelection] = useState(null),
    [chosen, setChosen] = useState(null),
    [sample, setSample] = useState(null),
    [version, setVersion] = useState("draft"),
    [mode, setMode] = useState("play"),
    [event, setEvent] = useState(null),
    [resetKey, setResetKey] = useState(0),
    [previewItem, setPreviewItem] = useState(null),
    [previewGame, setPreviewGame] = useState(false),
    [pending, setPending] = useState(null),
    [editing, setEditing] = useState(null),
    [uploaded, setUploaded] = useState([]),
    [testSelection, setTestSelection] = useState("");
  const fullEditorWindow = useRef(null),
    fullEditorContext = useRef(null);
  const headingRef = useRef(null),
    fileRef = useRef(null);
  const savedRef = useRef(draft);
  savedRef.current = draft;
  useEffect(() => {
    try {
      localStorage.setItem(SAVE, JSON.stringify(draft));
    } catch {
      setNotice(
        "This browser could not save the local draft. Export a backup before leaving.",
      );
    }
  }, [draft]);
  const templateLoad = useRef(0);
  const go = (next) => {
    templateLoad.current++;
    setPreviewGame(false);
    setRoute(next);
    setQuery("");
    setEvent(null);
    setSelection(null);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [route]);
  const head = (title, sub, action) => (
    <div className="heading">
      <div>
        <h1 ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        <p>{sub}</p>
      </div>
      {action}
    </div>
  );
  const mutate = (fn) => {
    try {
      const next = fn(structuredClone(savedRef.current));
      const valid = {
        ...next,
        scene: validateScene(next.scene),
        automation: validateAutomations(next.automation),
      };
      savedRef.current = valid;
      setDraft(valid);
    } catch (e) {
      setNotice(e.message);
    }
  };
  const replace = (next) => {
    try {
      localStorage.setItem(BACKUP, JSON.stringify(draft));
      setDraft({ ...draft, ...next, hidden: [] });
      setPending(null);
      go("overview");
      setNotice(
        "Started a separate local scene. Your previous local draft is available under Restore previous draft.",
      );
    } catch (e) {
      setNotice(e.message);
    }
  };
  const fullEditor = (payload = draft, tool = "", focus = "") => {
    try {
      fullEditorContext.current = { tool, focus };
      localStorage.setItem(
        sceneDraftStorageKey(SLUG),
        JSON.stringify(payload.scene),
      );
      localStorage.setItem(
        automationDraftStorageKey(SLUG),
        JSON.stringify(payload.automation),
      );
      fullEditorWindow.current = window.open(
        `./studio/full-editor.html?draft=${SLUG}&studioTool=${encodeURIComponent(tool)}&focus=${encodeURIComponent(focus)}`,
        `studio-full-editor-${SLUG}`,
      );
      setNotice(
        "Full editor opened with an isolated copy. Use “Bring back full-editor changes” here when finished.",
      );
    } catch (e) {
      setNotice(e.message);
    }
  };
  const bringBack = () => {
    try {
      const scene = validateScene(
          JSON.parse(localStorage.getItem(sceneDraftStorageKey(SLUG))),
        ),
        automation = validateAutomations(
          JSON.parse(localStorage.getItem(automationDraftStorageKey(SLUG))),
        );
      localStorage.setItem(BACKUP, JSON.stringify(draft));
      setDraft({ ...draft, scene, automation, hidden: [] });
      go("overview");
      setVersion("draft");
      setMode("play");
      const target = fullEditorContext.current;
      if (target?.tool === "object") {
        setPreviewItem({ type: "object", id: target.focus });
        setSelection(target.focus);
      } else if (target?.tool === "experience") {
        setPreviewItem({ type: "game" });
        setPreviewGame(true);
        setResetKey((n) => n + 1);
      } else if (target?.tool === "events") {
        const page = automation.pages?.find((p) => p.id === target.focus),
          rule =
            automation.rules.find((r) => page?.ruleIds.includes(r.id)) ||
            automation.rules[0];
        if (rule) {
          setTestSelection(rule.id);
          testRule(rule, { scene, automation });
        }
      }

      setNotice(
        "Full-editor changes loaded into this local draft. Nothing was published.",
      );
    } catch {
      setNotice("No valid full-editor changes are available yet.");
    }
  };
  const returnHandler = useRef(bringBack);
  returnHandler.current = bringBack;
  useEffect(() => {
    const receive = (e) => {
      let knownEditor = e.source === fullEditorWindow.current;
      if (e.origin === location.origin && !knownEditor) {
        try {
          knownEditor =
            e.source?.name === `studio-full-editor-${SLUG}` &&
            ["full-editor.html", "automations.html"].some(
              (file) =>
                e.source.location.pathname ===
                new URL("./studio/" + file, location.href).pathname,
            );
        } catch {}
      }
      if (
        e.origin === location.origin &&
        knownEditor &&
        e.data?.source === "studio-full-editor" &&
        e.data.action === "return-preview"
      ) {
        if (!fullEditorContext.current) {
          const query = new URLSearchParams(e.source.location.search);
          fullEditorContext.current = {
            tool: query.get("studioTool") || "",
            focus: query.get("focus") || "",
          };
        }
        returnHandler.current();
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  const previewObject = (id) => {
    go("overview");
    setMode("play");
    setVersion("draft");
    setSelection(id);
    setPreviewItem({ type: "object", id });
  };
  const choose = async (item) => {
    const ticket=++templateLoad.current;
    try {
      setChosen(item);
      setNotice('Preparing template…');
      let maze;
      if(item.type==='maze') {
        maze=await loadMazeTemplate(setNotice);
      }
      if(ticket!==templateLoad.current)return;
      setSample(makeTemplate(item, maze));
      go("template");
    } catch (e) {
      setNotice(e.message);
    }
  };
  const pages =
    draft.automation.pages || deriveLegacyAutomationPages(draft.automation);
  const saved = [
    ...draft.scene.objects.map((o) => ({
      id: o.id,
      title: o.title,
      description: o.caption,
      image: o.image,
      kind: "Viewer interaction",
      type: "object",
      value: o,
    })),
    ...pages.map((p) => ({
      id: p.id,
      title: p.name,
      description: `${p.ruleIds.length} event rule${p.ruleIds.length === 1 ? "" : "s"}`,
      image: draft.automation.carousels.find((c) =>
        p.carouselIds?.includes(c.id),
      )?.slides[0]?.image,
      kind: "Live moment",
      type: "flow",
      value: p,
    })),
    ...(draft.scene.experience
      ? [
          {
            id: "experience",
            title: draft.scene.experience.name,
            kind: "Game or story",
            type: "experience",
            key: "quiet-vault",
          },
        ]
      : []),
  ];
  const openSaved = (item) => {
    if (item.type === "object") {
      setEditing(item.id);
      go("object");
    } else if (item.type === "flow") {
      setEditing(item.id);
      setSample(null);
      go("flow");
    } else fullEditor(draft, "experience");
  };
  const testRule = (rule, workspace) => {
    try {
      const result = previewExperienceRule(
        workspace.automation,
        rule.id,
        eventFor(rule),
        Date.now(),
      );
      if (!result.events.length) {
        setNotice(
          "This rule is disabled or did not match the sample event. Its saved settings were not changed.",
        );
        return;
      }
      setEvent({ ...result.events[0], id: crypto.randomUUID() });
      setPreviewItem({ type: "flow", id: rule.id });
      setNotice(`Local test: ${rule.name}. No event sent to Twitch.`);
    } catch (e) {
      setNotice(e.message);
    }
  };
  const addSample = () => {
    try {
      const ids = new Set([
        ...draft.scene.objects.map((o) => o.id),
        ...draft.automation.rules.map((r) => r.id),
        ...draft.automation.carousels.map((c) => c.id),
      ]);
      if (
        [
          ...sample.scene.objects,
          ...sample.automation.rules,
          ...sample.automation.carousels,
        ].some((v) => ids.has(v.id))
      )
        throw Error(
          "This starter is already in the scene. Edit it in Your experiences, or start a separate scene.",
        );
      if (sample.scene.experience && draft.scene.experience)
        throw Error(
          "This scene already has a game/story. Use a separate scene to try this one.",
        );
      const scene = validateScene({
          ...draft.scene,
          objects: [...draft.scene.objects, ...sample.scene.objects],
          ...(sample.scene.experience
            ? { experience: sample.scene.experience }
            : {}),
        }),
        automation = validateAutomations({
          ...draft.automation,
          rules: [...draft.automation.rules, ...sample.automation.rules],
          carousels: [
            ...draft.automation.carousels,
            ...sample.automation.carousels,
          ],
          pages: [...pages, ...(sample.automation.pages || [])],
        });
      localStorage.setItem(BACKUP, JSON.stringify(draft));
      setDraft({ ...draft, scene, automation });
      go("overview");
      setNotice("Added to your local scene draft. It has not been published.");
    } catch (e) {
      setNotice(e.message);
    }
  };
  const upload = async (file, apply) => {
    if (!file) return;
    try {
      const image = await prepareImage(file);
      apply(image);
      setUploaded((old) => [...old, { name: file.name, image }]);
      setNotice(
        "Image added locally. It has not been uploaded to your channel.",
      );
    } catch (e) {
      setNotice(e.message);
    }
  };
  const renderCards = (items) => (
    <div className="gallery-grid">
      {items.map((item) => (
        <article className="saved-card" key={item.id}>
          <Picture item={item} />
          <div className="copy">
            <span className="tag">{item.category || item.kind}</span>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            <button
              onClick={() => (item.kind ? openSaved(item) : choose(item))}
            >
              {item.kind ? "Open experience" : "Preview & customize"} →
            </button>
          </div>
        </article>
      ))}
    </div>
  );
  let content;
  if (query.trim()) {
    const terms = query.toLowerCase().trim().split(/\s+/),
      match = (s) => terms.every((t) => s.toLowerCase().includes(t)),
      foundSaved = saved.filter((s) =>
        match(s.title + " " + s.description + " " + s.kind),
      ),
      foundTemplates = findTemplates(query),
      foundTools = tools.filter((t) =>
        match(t.name + " " + t.text + " " + t.words),
      );
    content = (
      <>
        {head(
          "Search your studio",
          `${foundSaved.length + foundTemplates.length + foundTools.length} matches across your work, every template, and tools.`,
        )}
        {[
          ["Your experiences", foundSaved],
          ["Templates", foundTemplates],
        ].map(
          ([label, items]) =>
            items.length > 0 && (
              <section className="search-section" key={label}>
                <h2>
                  {label} · {items.length}
                </h2>
                <div className="results">
                  {items.map((item) => (
                    <button
                      className="result"
                      key={item.id}
                      onClick={() =>
                        item.kind ? openSaved(item) : choose(item)
                      }
                    >
                      <div>
                        <b>{item.title}</b>
                        <small>{item.description || item.kind}</small>
                      </div>
                      <span className="arrow">→</span>
                    </button>
                  ))}
                </div>
              </section>
            ),
        )}
        {foundTools.length > 0 && (
          <section className="search-section">
            <h2>Tools</h2>
            <div className="results">
              {foundTools.map((t) => (
                <button className="result" key={t.id} onClick={() => go(t.id)}>
                  <b>{t.name}</b>
                  <small>{t.text}</small>
                </button>
              ))}
            </div>
          </section>
        )}
        {!foundSaved.length && !foundTemplates.length && !foundTools.length && (
          <div className="empty">
            <h2>No matches</h2>
            <p>
              Try a name, an action, or a topic such as “schedule”, “image”, or
              “Hype Train”.
            </p>
            <button onClick={() => go("create")}>Browse every template</button>
          </div>
        )}
      </>
    );
  } else if (route === "home")
    content = (
      <>
        {head(
          "Your studio",
          "Find a starting point, edit your scene, or prepare for your stream.",
        )}
        <div className="destinations">
          {[
            {
              route: "create",
              title: "Template gallery",
              text: `${catalog.length} starters, layouts, bundles and games.`,
              key: "merch-carousel",
            },
            {
              route: "overview",
              title: "Scene overview",
              text: "See the whole scene. Arrange it. Try everything.",
              key: "quiet-vault",
            },
            {
              route: "library",
              title: "Your experiences",
              text: `${saved.length} items in your current local draft.`,
              image: art.avatar,
            },
          ].map((t) => (
            <button
              className="destination"
              key={t.route}
              onClick={() => go(t.route)}
            >
              <Picture item={t} />
              <span className="copy">
                <h2>{t.title}</h2>
                <p>{t.text}</p>
                <span className="go">Open →</span>
              </span>
            </button>
          ))}
        </div>
        <div className="section-head"><h2>Play with your community</h2></div>
        <CommunityChoices onGo={go}/>
        <div className="section-head">
          <h2>In your scene</h2>
          <button onClick={() => go("library")}>
            See all {saved.length} experiences →
          </button>
        </div>
        {renderCards(saved.slice(0, 3))}
        <div className="callout">
          Draft based on published scene revision{" "}
          {snapshot.revision}. Review and publish when you are ready.
        </div>
      </>
    );
  else if (route === "create") {
    const matches = findTemplates("", group);
    content = (
      <>
        {head(
          "Find your next idea",
          `${catalog.length} options. Choose a category or use the search above. Every existing starter is included.`,
        )}
        <div className="tabs" aria-label="Template categories">
          {categories.map((c) => (
            <button
              key={c}
              aria-pressed={c === group}
              onClick={() => {
                setGroup(c);
                setLimit(12);
              }}
            >
              {c} <small>{findTemplates("", c).length}</small>
            </button>
          ))}
        </div>
        <p className="subtle" role="status">
          Showing {Math.min(limit, matches.length)} of {matches.length}{" "}
          templates
        </p>
        {renderCards(matches.slice(0, limit))}
        {matches.length > limit && (
          <button className="load-more" onClick={() => setLimit((n) => n + 12)}>
            Show next {Math.min(12, matches.length - limit)} templates
          </button>
        )}
        <section className="search-section">
          <h2>More ways to create</h2>
          <div className="tools-grid">
            {tools
              .filter((t) =>
                ["room", "cards", "builder", "ai", "advanced"].includes(t.id),
              )
              .map((t) => (
                <button className="tool" key={t.id} onClick={() => go(t.id)}>
                  <div>
                    <h3>{t.name}</h3>
                    <p>{t.text}</p>
                    <span className="go">Open →</span>
                  </div>
                </button>
              ))}
          </div>
        </section>
      </>
    );
  } else if (route === "library")
    content = (
      <>
        {head(
          "Your experiences",
          `${saved.length} items from the current local scene draft.`,
          <button className="primary" onClick={() => go("create")}>
            ＋ Add an experience
          </button>,
        )}
        {renderCards(saved)}
      </>
    );
  else if (route === "template" && sample) {
    const fields = simpleContent(sample),
      imageCapable =
        sample.scene.objects.length > 0 ||
        sample.automation.carousels.length > 0;
    content = (
      <>
        {head(
          chosen.title,
          chosen.description,
          <button onClick={() => go("create")}>← Template gallery</button>,
        )}
        <div className="editor-columns">
          <section className="panel">
            <span className="eyebrow">1 · Customize the essentials</span>
            <h2>Make it yours</h2>
            <p>
              This uses the actual starter design. Extra slides, rules and game
              logic are preserved.
            </p>
            {!sample.scene.experience && (
              <div className="fields">
                <label>
                  Title or message
                  <input
                    value={fields.title}
                    maxLength={imageCapable ? 70 : 160}
                    onChange={(e) =>
                      setSample(changeContent(sample, "title", e.target.value))
                    }
                  />
                </label>
                {imageCapable && (
                  <>
                    <label>
                      Short text
                      <input
                        value={fields.caption}
                        maxLength={100}
                        onChange={(e) =>
                          setSample(
                            changeContent(sample, "caption", e.target.value),
                          )
                        }
                      />
                    </label>
                    <label>
                      Custom picture
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) =>
                          upload(e.target.files[0], (image) =>
                            setSample(changeContent(sample, "image", image)),
                          )
                        }
                      />
                    </label>
                    <label>
                      Website link (optional)
                      <input
                        type="url"
                        placeholder="https://…"
                        value={fields.url}
                        onChange={(e) =>
                          setSample(
                            changeContent(sample, "url", e.target.value),
                          )
                        }
                      />
                    </label>
                  </>
                )}
              </div>
            )}
            {sample.scene.experience && (
              <p>
                Play the game on the right. Open the full editor to change its
                scenes, media and choices.
              </p>
            )}
            <details>
              <summary>All settings and advanced options</summary>
              <p className="subtle">
                The full editor retains every slide, trigger, rule, animation,
                sound, timer and scene control supported by this starter.
              </p>
              <button
                onClick={() =>
                  fullEditor(
                    sample,
                    sample.scene.experience
                      ? "experience"
                      : sample.automation.rules.length
                        ? "events"
                        : "object",
                  )
                }
              >
                Open full editor with this starter ↗
              </button>
            </details>
            <div className="callout">
              {sample.automation.rules.length} event rules ·{" "}
              {sample.automation.carousels.length} card sets ·{" "}
              {sample.scene.objects.length} viewer objects
              {sample.scene.experience ? " · 1 game/story" : ""}
            </div>
          </section>
          <section>
            <h2>2 · Try it here</h2>
            <p className="subtle">
              Click viewer objects, or test an event below.
            </p>
            <Frame workspace={sample} event={event} />
            <div className="test-buttons">
              {sample.automation.rules.map((r) => (
                <button key={r.id} onClick={() => testRule(r, sample)}>
                  Test {r.name}
                </button>
              ))}
              <button onClick={() => setEvent(null)}>Clear test</button>
            </div>
          </section>
        </div>
        <div className="setup-actions">
          <p>3 · Keep the result in your local workspace</p>
          <button onClick={() => setPending(sample)}>
            Start a separate scene
          </button>
          <button className="primary" onClick={addSample}>
            Add to scene draft →
          </button>
        </div>
      </>
    );
  } else if (route === "overview") {
    const ws = version === "published" ? base : draft,
      selected = ws.scene.objects.find((o) => o.id === selection);
    const previewRule = ws.automation.rules.find((r) => r.id === event?.ruleId);
    const previewObjectItem =
      previewItem?.type === "object"
        ? ws.scene.objects.find((o) => o.id === previewItem.id)
        : selected;
    const previewName =
      previewRule?.name ||
      (previewItem?.type === "game" ? ws.scene.experience?.name : null) ||
      previewObjectItem?.title ||
      "Whole scene";
    const editPreview = () => {
      if (previewRule) {
        const page = pages.find((p) => p.ruleIds.includes(previewRule.id));
        if (!page) {
          setNotice("This published event is not in your local draft.");
          return;
        }
        setEditing(page.id);
        setSample(null);
        go("flow");
      } else if (previewItem?.type === "game") {
        fullEditor(draft, "experience");
      } else if (previewObjectItem) {
        setEditing(previewObjectItem.id);
        go("object");
      } else fullEditor();
    };
    content = (
      <>
        {head(
          "Scene overview",
          "One place to see the scene, arrange layers, and test viewer experiences.",
        )}
        <div className="overview-toolbar">
          <div className="tabs" aria-label="Scene version">
            <button
              aria-pressed={version === "draft"}
              onClick={() => {
                setVersion("draft");
                setEvent(null);
              }}
            >
              Local draft
            </button>
            <button
              aria-pressed={version === "published"}
              onClick={() => {
                setVersion("published");
                setMode("play");
                setEvent(null);
              }}
            >
              Published scene · rev {snapshot.revision}
            </button>
          </div>
          <div className="tabs" aria-label="Preview mode">
            <button
              aria-pressed={mode === "play"}
              onClick={() => setMode("play")}
            >
              Try as viewer
            </button>
            <button
              disabled={version === "published"}
              aria-pressed={mode === "arrange"}
              onClick={() => setMode("arrange")}
            >
              Arrange layers
            </button>
          </div>
        </div>
        <div className="overview-grid">
          <section className="stage-panel">
            <section className="panel preview-tests">
              <h2>Test a saved moment</h2>
              <div className="local-test-control">
                <label>
                  Choose a saved moment
                  <select
                    value={
                      ws.automation.rules.some((r) => r.id === testSelection)
                        ? testSelection
                        : ws.automation.rules[0]?.id || ""
                    }
                    onChange={(e) => setTestSelection(e.target.value)}
                  >
                    {ws.automation.rules.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {!r.enabled ? " (disabled)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="primary"
                  disabled={!ws.automation.rules.length}
                  onClick={() =>
                    testRule(
                      ws.automation.rules.find((r) => r.id === testSelection) ||
                        ws.automation.rules[0],
                      ws,
                    )
                  }
                >
                  Show in preview
                </button>
              </div>
              <button onClick={() => setEvent(null)}>Clear test popup</button>
            </section>
            <div className="preview-context">
              <div>
                <small>Previewing</small>
                <strong>{previewName}</strong>
              </div>
              <button className="primary" onClick={editPreview}>
                {previewRule
                  ? "Edit this popup"
                  : previewItem?.type === "game"
                    ? "Edit this game"
                    : previewObjectItem
                      ? "Edit this object"
                      : "Edit scene"}
              </button>
            </div>
            <Frame
              workspace={ws}
              autoOpenExperience={previewGame}
              mode={mode}
              selected={selection}
              onSelect={(id) => {
                setSelection(id);
                setPreviewItem({ type: "object", id });
                setEvent(null);
              }}
              forceObjectId={
                mode === "play" && previewItem?.type === "object"
                  ? previewItem.id
                  : undefined
              }
              onExperienceOpen={(open) => {
                if (open) {
                  setPreviewItem({ type: "game" });
                  setEvent(null);
                } else
                  setPreviewItem((old) => (old?.type === "game" ? null : old));
              }}
              onObjects={(objects) => {
                if (version === "draft")
                  mutate((d) => ({
                    ...d,
                    scene: {
                      ...d.scene,
                      objects: d.scene.objects.map(
                        (o) => objects.find((n) => n.id === o.id) || o,
                      ),
                    },
                  }));
              }}
              event={event}
              resetKey={resetKey}
            />
            <div className="stage-status">
              <span>
                {mode === "arrange"
                  ? "Drag an object to move it. Hidden layers stay in your draft."
                  : "Click the scene to try links, games and interactive objects."}
              </span>
              <button
                onClick={() => {
                  setEvent(null);
                  setResetKey((n) => n + 1);
                  setPreviewItem(null);
                  setPreviewGame(false);
                  setSelection(null);
                }}
              >
                Reset preview
              </button>
            </div>
            <p className="subtle">
              Published scene loaded {new Date(snapshot.capturedAt).toLocaleString()}
              . Live viewer activity is not connected here. Per-viewer maze
              progress and private card hands differ.
            </p>
            {selected && version === "draft" && (
              <div className="panel">
                <h3>{selected.title}</h3>
                <div className="test-buttons">
                  <button
                    onClick={() => {
                      setEditing(selected.id);
                      go("object");
                    }}
                  >
                    Edit content
                  </button>
                  <button
                    onClick={() =>
                      mutate((d) => ({
                        ...d,
                        scene: {
                          ...d.scene,
                          objects: [
                            ...d.scene.objects.filter(
                              (o) => o.id !== selected.id,
                            ),
                            selected,
                          ],
                        },
                      }))
                    }
                  >
                    Bring to front
                  </button>
                </div>
              </div>
            )}
          </section>
          <aside className="layer-panel">
            <h2>In this scene</h2>
            <p className="subtle">
              {ws.scene.objects.length} objects · {ws.automation.rules.length}{" "}
              event rules
            </p>
            {ws.scene.objects.map((o) => (
              <div
                className={`layer-row ${selection === o.id ? "active" : ""}`}
                key={o.id}
              >
                <button
                  className="layer-title"
                  onClick={() => {
                    setSelection(o.id);
                    setPreviewItem({ type: "object", id: o.id });
                    setEvent(null);
                  }}
                >
                  {o.image && <img src={o.image} alt="" />}
                  <span>
                    <b>{o.title}</b>
                    <small>
                      {ws.hidden?.includes(o.id)
                        ? "Hidden in local preview"
                        : o.popupOnly
                          ? "Popup only"
                          : "Included in preview"}
                    </small>
                  </span>
                </button>
                {version === "draft" && (
                  <button
                    aria-label={`${ws.hidden?.includes(o.id) ? "Show" : "Hide"} ${o.title}`}
                    onClick={() =>
                      mutate((d) => ({
                        ...d,
                        hidden: d.hidden.includes(o.id)
                          ? d.hidden.filter((x) => x !== o.id)
                          : [...d.hidden, o.id],
                      }))
                    }
                  >
                    {ws.hidden?.includes(o.id) ? "Show" : "Hide"}
                  </button>
                )}
              </div>
            ))}
            {ws.scene.experience && (
              <div className="layer-row">
                <div>
                  <b>{ws.scene.experience.name}</b>
                  <small>
                    {ws.scene.experience.enabled !== false
                      ? "Enabled in configuration"
                      : "Disabled in configuration"}
                  </small>
                  <p className="subtle">
                    Open its launcher in the preview to play.
                  </p>
                </div>
              </div>
            )}
            <div className="callout">
              Configuration enabled ≠ currently showing. This preview does not
              confirm delivery to live viewers.
            </div>
            <button onClick={() => go("create")}>
              ＋ Add from template gallery
            </button>
            <details>
              <summary>Draft, backup and full editor</summary>
              <div className="fields">
                <button onClick={() => fullEditor()}>Open full editor ↗</button>
                <button onClick={bringBack}>
                  Bring back full-editor changes
                </button>
                <button
                  onClick={() =>
                    download("scene-studio-local-scene.json", {
                      ...draft.scene,
                      objects: draft.scene.objects.filter(
                        (o) => !draft.hidden.includes(o.id),
                      ),
                    })
                  }
                >
                  Export scene
                </button>
                <button
                  onClick={() =>
                    download("scene-studio-local-events.json", draft.automation)
                  }
                >
                  Export events
                </button>
                <button
                  onClick={() => {
                    try {
                      const v = JSON.parse(localStorage.getItem(BACKUP));
                      if (!v) throw Error();
                      setDraft({
                        ...v,
                        scene: validateScene(v.scene),
                        automation: validateAutomations(v.automation),
                      });
                      setEvent(null);
                      setPreviewItem(null);
                      setPreviewGame(false);
                      setVersion("draft");
                      setResetKey((n) => n + 1);
                      setNotice("Previous local draft restored.");
                    } catch {
                      setNotice("No previous local draft is saved yet.");
                    }
                  }}
                >
                  Restore previous draft
                </button>
              </div>
            </details>
          </aside>
        </div>
      </>
    );
  } else if (route === "flow") {
    const page = pages.find((p) => p.id === editing);
    content = page ? (
      <>
        {head(
          page.name,
          "Edit this live moment, then test it in the whole scene.",
          <button
            onClick={() => {
              go("overview");
              setPreviewItem(null);
            }}
          >
            ← Back to scene overview
          </button>,
        )}
        <div className="editor-columns">
          <FlowDetails
            key={page.id}
            workspace={draft}
            page={page}
            onSave={(automation) => {
              setDraft({ ...draft, automation });
              setSample(null);
            }}
            onPreview={(r, ws) => {
              setSample(ws);
              testRule(r, ws);
            }}
            onFullEditor={(ws) => fullEditor(ws, "events", page.id)}
            onPreviewWhole={(automation) => {
              const ws = { ...draft, automation };
              setDraft(ws);
              go("overview");
              setVersion("draft");
              setMode("play");
              const rule = automation.rules.find((r) =>
                page.ruleIds.includes(r.id),
              );
              if (rule) {
                setTestSelection(rule.id);
                testRule(rule, ws);
              }
            }}
          />
          <section>
            <div className="preview-context">
              <strong>Previewing {page.name}</strong>
              <button onClick={() => headingRef.current?.focus()}>
                Edit this popup ↑
              </button>
            </div>
            <Frame workspace={sample || draft} event={event} />
            <p className="subtle">
              Local test only. The preview keeps the popup visible so you can
              inspect it.
            </p>
            <button onClick={() => setEvent(null)}>Clear test popup</button>
          </section>
        </div>
      </>
    ) : (
      <p>Choose a saved live moment from Your experiences.</p>
    );
  } else if (route === "object") {
    const o = draft.scene.objects.find((o) => o.id === editing);
    content = o ? (
      <>
        {head(
          o.title,
          "Edit the local draft. Preview updates beside your controls.",
          <div className="test-buttons">
            <button onClick={() => previewObject(o.id)}>
              Preview this object →
            </button>
            <button
              onClick={() => {
                go("overview");
                setPreviewItem(null);
              }}
            >
              ← Back to scene overview
            </button>
          </div>,
        )}
        <div className="editor-columns">
          <div className="panel fields">
            {[
              ["title", "Title"],
              ["caption", "Short text"],
              ["detail", "Expanded message"],
              ...(o.action === "link" ? [["url", "Website address"]] : []),
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  defaultValue={o[key] || ""}
                  maxLength={
                    key === "title"
                      ? 70
                      : key === "caption"
                        ? 100
                        : key === "detail"
                          ? 1200
                          : 1000
                  }
                  onBlur={(e) =>
                    mutate((d) => ({
                      ...d,
                      scene: {
                        ...d.scene,
                        objects: d.scene.objects.map((x) =>
                          x.id === o.id ? { ...x, [key]: e.target.value } : x,
                        ),
                      },
                    }))
                  }
                />
              </label>
            ))}
            <label>
              Custom picture
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) =>
                  upload(e.target.files[0], (image) =>
                    mutate((d) => ({
                      ...d,
                      scene: {
                        ...d.scene,
                        objects: d.scene.objects.map((x) =>
                          x.id === o.id ? { ...x, image } : x,
                        ),
                      },
                    })),
                  )
                }
              />
            </label>
            <button onClick={() => fullEditor(draft, "object", o.id)}>
              All object settings in full editor ↗
            </button>
          </div>
          <section>
            <div className="preview-context">
              <strong>Previewing {o.title}</strong>
              <button onClick={() => headingRef.current?.focus()}>
                Edit this object ↑
              </button>
            </div>
            <Frame workspace={draft} forceObjectId={o.id} />
            <button onClick={() => previewObject(o.id)}>
              Open in scene preview →
            </button>
          </section>
        </div>
      </>
    ) : (
      <div className="empty">Choose an experience from your library.</div>
    );
  } else if (route === "media") {
    const media = [
      ...draft.scene.objects
        .filter((o) => o.image)
        .map((o) => ({ name: o.title, image: o.image })),
      ...draft.automation.carousels.flatMap((c) =>
        c.slides
          .filter((s) => s.image)
          .map((s) => ({ name: s.title, image: s.image })),
      ),
      ...uploaded,
    ];
    content = (
      <>
        {head(
          "Media library",
          "Pictures used by this local scene, together in one place.",
        )}
        <label className="upload-control">
          Add a picture
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => upload(e.target.files[0], () => {})}
          />
        </label>
        <p className="subtle">
          To use a new picture, open an experience and choose Custom picture.
          Video and audio tools remain in the full editor.
        </p>
        <div className="gallery-grid">
          {media.map((m, i) => (
            <article className="saved-card" key={i}>
              <Picture item={{ image: m.image }} />
              <div className="copy">
                <h3>{m.name}</h3>
                <button
                  onClick={() => {
                    navigator.clipboard
                      .writeText(m.image)
                      .then(() =>
                        setNotice("Image source copied for the full editor."),
                      )
                      .catch(() =>
                        setNotice(
                          "Clipboard unavailable; use the image picker in the editor.",
                        ),
                      );
                  }}
                >
                  Copy image source
                </button>
              </div>
            </article>
          ))}
        </div>
      </>
    );
  } else if (route === 'room' || route === 'cards') {
    const t=tools.find(t=>t.id===route);
    content=<>{head(t.name,t.text)}<CommunityChoices onGo={go}/><section className="panel"><h2>{route==='room'?'Invite viewers to your own room':'Decks → house rules → review → play'}</h2><p>{route==='room'?'Create a permanent testing invitation, copy its link, or open the viewer page. Your channel has its own room.':'Browse all available expansions, keep your selections while you move between steps, and open a live lobby when you are ready.'}</p><a className="community-trial-launch primary" href={`${communityURL}#${route}`} target="scene-studio-community">{route==='room'?'Open my viewer room setup ↗':'Set up Cards Against Humanity ↗'}</a><p className="subtle">Open your channel’s community setup. Your scene draft stays saved here while you choose decks or invite viewers.</p></section></>;
  } else if (route === "controls")
    content = (
      <>
        {head(
          "Stream controls",
          "Choose between safe local tests and the connected live studio.",
        )}
        <CommunityChoices onGo={go}/>
        <div className="tools-grid">
          <button className="tool" onClick={() => go("overview")}>
            <div>
              <h2>Test the whole scene</h2>
              <p>Try your saved moments without sending them to viewers.</p>
              <span className="go">Open scene overview →</span>
            </div>
          </button>
          <a className="tool" href={liveURL} target="_blank" rel="noreferrer">
            <div>
              <h2>Open connected live studio ↗</h2>
              <p>
                Run the current live controls, card lobby and channel
                connections there.
              </p>
              <span className="go">Twitch sign-in may be needed</span>
            </div>
          </a>
        </div>
        <p className="callout">
          Draft previews are private. Publish your scene or moments below to send changes to your connected viewers. Viewer rooms and Cards Against Humanity have their own setup pages.
        </p>
      </>
    );
  else if (
    ["builder", "ai", "connections", "history"].includes(route)
  ) {
    const t = tools.find((t) => t.id === route),
      connected = ["cards", "connections", "history"].includes(route);
    content = (
      <>
        {head(t.name, t.text)}
        <section className="panel">
          <h2>
            {connected
              ? "Open the connected studio"
              : "Continue in the full local editor"}
          </h2>
          <p>
            {connected
              ? "Your Twitch account, live card lobby, and published history stay in the connected website."
              : "This opens a separate copy of your current local scene with every existing editing control. Use Bring back changes when you are done."}
          </p>
          <button
            className="primary"
            onClick={() =>
              connected
                ? window.open(liveURL, "scene-studio-connected")
                : fullEditor(
                    draft,
                    route === "builder"
                      ? "experience"
                      : route === "ai"
                        ? "ai"
                        : "advanced",
                  )
            }
          >
            {connected ? "Open connected studio ↗" : "Open full local editor ↗"}
          </button>
          {!connected && (
            <button onClick={bringBack}>Bring back full-editor changes</button>
          )}
        </section>
      </>
    );
  } else {
    const tool = tools.find((t) => t.id === route);
    content = (
      <>
        {head(
          tool?.name || "All tools",
          tool?.text || "Every existing tool remains available.",
        )}
        <div className="tools-grid">
          {tools.map((t) => (
            <button
              className="tool"
              key={t.id}
              onClick={() => {
                if (["overview", "media", "room", "cards"].includes(t.id)) go(t.id);
                else if (["connections", "history"].includes(t.id))
                  window.open(liveURL, "scene-studio-connected");
                else
                  fullEditor(
                    draft,
                    t.id === "builder"
                      ? "experience"
                      : t.id === "ai"
                        ? "ai"
                        : "advanced",
                  );
              }}
            >
              <div>
                <h3>{t.name}</h3>
                <p>{t.text}</p>
                <span className="go">
                  {["connections", "history"].includes(t.id)
                    ? "Open connected studio ↗"
                    : ["overview", "media", "room", "cards"].includes(t.id)
                      ? "Open here →"
                      : "Open full local editor ↗"}
                </span>
              </div>
            </button>
          ))}
        </div>
        <section className="panel search-section">
          <h2>Import an existing design</h2>
          <p>
            Scene and automation JSON use the existing validators. Imported
            designs replace only the matching part of this local draft; a backup
            is kept.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            aria-label="Import scene or events"
            onChange={async (e) => {
              try {
                const f = e.target.files[0];
                if (!f) return;
                if (f.size > 12000000) throw Error("This file is too large.");
                const value = JSON.parse(await f.text()),
                  next = value.objects
                    ? { ...draft, scene: validateScene(value), hidden: [] }
                    : { ...draft, automation: validateAutomations(value) };
                localStorage.setItem(BACKUP, JSON.stringify(draft));
                setDraft(next);
                setNotice("Design imported into the local draft.");
              } catch (err) {
                setNotice(err.message);
              }
            }}
          />
          <button onClick={bringBack}>Bring back full-editor changes</button>
        </section>
      </>
    );
  }
  return (
    <>
      <aside className="sidebar">
        <div className="brand">
          <i>✳</i>Scene Studio
        </div>
        <nav aria-label="Main navigation">
          {[
            ["home", "⌂", "Home"],
            ["create", "＋", "Template gallery"],
            ["overview", "▣", "Scene overview"],
            ["library", "▦", "Your experiences"],
            ["room", "▣", "Viewer rooms"],
            ["cards", "♠", "Cards Against Humanity"],
            ["controls", "▷", "Stream controls"],
            ["media", "▧", "Media library"],
            ["advanced", "⚙", "All tools"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              aria-current={route === id ? "page" : undefined}
              onClick={() => go(id)}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="profile">
          <img src={art.avatar} alt="" />
          <div>
            <b>{auth ? `@${auth.profile.login}` : "Your studio"}</b>
            <small>{auth ? "Your channel workspace" : "Explore the templates"}</small>{auth&&<button onClick={()=>signOutStudio(auth).catch(e=>setNotice(e.message))}>Sign out</button>}
          </div>
        </div>
      </aside>
      <div className="shell">
        <header className="topbar">
          <label className="search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              aria-label="Search everything"
              placeholder="Search templates, your experiences, and tools…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button className="preview-badge" onClick={()=>auth ? go('overview') : startStudioSignIn().catch(e=>setNotice(e.message))}>{auth ? 'Preview & publish' : 'Sign in with Twitch'}</button>
        </header>
        <main>
          {notice && (
            <div className="notice" role="status">
              <span>{notice}</span>
              <button onClick={() => setNotice("")}>Dismiss</button>
            </div>
          )}
          {content}
          {(route==='overview'||route==='controls')&&<PublishPanel workspace={draft} setWorkspace={setDraft} onPreview={()=>go('overview')} onPublished={()=>setResetKey(n=>n+1)}/>}
          <p className="prototype-footer">
            Your draft stays on this device. Publishing updates your channel’s connected players. The preview simulates interactions; open your viewer room to check the published experience.
          </p>
        </main>
      </div>
      {pending && (
        <div className="confirm-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Start separate local scene"
            className="panel"
          >
            <h2>Start a separate local scene?</h2>
            <p>
              Your current local draft will be backed up. The new scene starts
              with {pending.scene.name}. Twitch is unchanged.
            </p>
            <div className="test-buttons">
              <button autoFocus onClick={() => setPending(null)}>
                Keep current draft
              </button>
              <button className="primary" onClick={() => replace(pending)}>
                Start separate scene
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
const root =
  import.meta.hot?.data.root ?? createRoot(document.getElementById("root"));
if (import.meta.hot)
  import.meta.hot.dispose((data) => {
    data.root = root;
  });
root.render(<App />);

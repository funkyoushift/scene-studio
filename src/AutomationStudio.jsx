import React, { useEffect, useRef, useState } from "react";
import {
  validateAutomations,
  parseAutomations,
  createAutomationState,
  evaluateAutomations,
} from "./automations.mjs";
import { prepareImage } from "./images.mjs";
import merch from "../designs/funkyoushift-merch-preview.json";
import "./automations.css";
import DeveloperPanel from "./DeveloperPanel.jsx";

const KEY = "scene-studio-automation-preview-v1";
const uid = () => crypto.randomUUID();
function initialDesign() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return parseAutomations(saved);
  } catch {}
  return validateAutomations({
    version: 1,
    carousels: [
      {
        id: "merch",
        title: "The FunkYouSHiFT collection",
        displaySeconds: 20,
        slides: merch.objects
          .filter((o) => o.image)
          .map((o) => ({
            id: o.id,
            title: o.title,
            caption: o.caption.replace(" · View on Streamlabs ↗", ""),
            image: o.image,
            url: o.url,
          })),
      },
    ],
    rules: [
      {
        id: "timed-merch",
        name: "An occasional merch moment",
        enabled: true,
        trigger: { type: "interval", everySeconds: 300 },
        effect: { type: "carousel", carouselId: "merch" },
        cooldownSeconds: 60,
      },
      {
        id: "asked-merch",
        name: "Show it when someone asks",
        enabled: true,
        trigger: { type: "keyword", phrase: "merch", match: "word" },
        effect: { type: "carousel", carouselId: "merch" },
        cooldownSeconds: 30,
      },
      {
        id: "party-word",
        name: "Chat starts the party",
        enabled: true,
        trigger: { type: "keyword", phrase: "party", match: "word" },
        effect: { type: "celebrate", message: "CHAT HAS ENTERED PARTY MODE" },
        cooldownSeconds: 10,
      },
    ],
  });
}

export default function AutomationStudio() {
  const [design, setDesign] = useState(initialDesign),
    [tab, setTab] = useState("rules"),
    [carouselId, setCarouselId] = useState(() => design.carousels[0]?.id),
    [slideIndex, setSlideIndex] = useState(0);
  const [message, setMessage] = useState("merch"),
    [externalName, setExternalName] = useState("boss_defeated"),
    [notice, setNotice] = useState(
      "Try a message below. Nothing is sent to Twitch.",
    ),
    [running, setRunning] = useState(false),
    [now, setNow] = useState(Date.now());
  const [active, setActive] = useState(null),
    [queue, setQueue] = useState([]),
    [log, setLog] = useState([]),
    [manualSlide, setManualSlide] = useState(null);
  const offset = useRef(0),
    engine = useRef(createAutomationState(Date.now())),
    designRef = useRef(design),
    runningRef = useRef(running);
  designRef.current = design;
  runningRef.current = running;
  const carousel =
    design.carousels.find((c) => c.id === carouselId) || design.carousels[0];
  const slide = carousel?.slides[slideIndex] || carousel?.slides[0];
  function record(text) {
    setLog((old) => [{ id: uid(), text }, ...old].slice(0, 8));
  }
  function enqueue(events, clean) {
    const next = events.map((e) => ({
      ...e,
      id: uid(),
      carousel:
        e.effect.type === "carousel"
          ? clean.carousels.find((c) => c.id === e.effect.carouselId)
          : null,
    }));
    setQueue((old) => [...old, ...next].slice(0, 8));
    for (const e of next)
      record(
        `${e.name} → ${e.effect.type === "carousel" ? "show carousel" : "celebrate"}`,
      );
  }
  function evaluate(event, time = Date.now() + offset.current) {
    try {
      const clean = validateAutomations(designRef.current);
      const result = evaluateAutomations(clean, engine.current, event, time);
      engine.current = result.state;
      enqueue(result.events, clean);
      if (event.type !== "tick")
        setNotice(
          result.events.length
            ? `${result.events.length} rule${result.events.length === 1 ? "" : "s"} matched.`
            : "No action: no matching enabled rule, or its cooldown is still active.",
        );
    } catch (error) {
      setNotice(error.message);
      setRunning(false);
    }
  }
  useEffect(() => {
    const timer = setInterval(() => {
      const time = Date.now() + offset.current;
      setNow(time);
      if (runningRef.current) evaluate({ type: "tick" }, time);
    }, 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!active && queue.length) {
      setActive({ ...queue[0], startedAt: now });
      setQueue((q) => q.slice(1));
      setManualSlide(null);
    }
  }, [active, queue, now]);
  useEffect(() => {
    if (
      active &&
      now - active.startedAt >= (active.carousel?.displaySeconds ?? 4) * 1000
    )
      setActive(null);
  }, [active, now]);
  function save() {
    try {
      const clean = validateAutomations(design);
      localStorage.setItem(KEY, JSON.stringify(clean));
      setDesign(clean);
      setNotice(
        "Saved in this browser. This prototype is separate from your Twitch overlay.",
      );
    } catch (e) {
      setNotice(e.message);
    }
  }
  function updateRule(id, patch) {
    setDesign((d) => ({
      ...d,
      rules: d.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  }
  function updateCarousel(patch) {
    setDesign((d) => ({
      ...d,
      carousels: d.carousels.map((c) =>
        c.id === carousel.id ? { ...c, ...patch } : c,
      ),
    }));
  }
  function updateSlide(patch) {
    updateCarousel({
      slides: carousel.slides.map((s) =>
        s.id === slide.id ? { ...s, ...patch } : s,
      ),
    });
  }
  function previewCarousel() {
    try {
      const clean = validateAutomations(design);
      enqueue(
        [
          {
            name: "Manual preview",
            effect: { type: "carousel", carouselId: carousel.id },
          },
        ],
        clean,
      );
    } catch (e) {
      setNotice(e.message);
    }
  }
  async function upload(file) {
    if (!file) return;
    const owner = carousel.id,
      target = slide.id;
    try {
      const image = await prepareImage(file);
      setDesign((d) => ({
        ...d,
        carousels: d.carousels.map((c) =>
          c.id === owner
            ? {
                ...c,
                slides: c.slides.map((s) =>
                  s.id === target ? { ...s, image } : s,
                ),
              }
            : c,
        ),
      }));
      setNotice("Image ready for the preview. Save to keep your changes.");
    } catch (e) {
      setNotice(e.message);
    }
  }
  function exportDesign() {
    try {
      const clean = validateAutomations(design);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(clean, null, 2)], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "scene-studio-triggers.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setNotice(e.message);
    }
  }
  async function importDesign(file) {
    if (!file) return;
    try {
      if (file.size > 2000000) throw Error("Keep the design under 2 MB.");
      const clean = parseAutomations(await file.text());
      setDesign(clean);
      setCarouselId(clean.carousels[0]?.id);
      setSlideIndex(0);
      setQueue([]);
      setActive(null);
      setRunning(false);
      engine.current = createAutomationState(Date.now() + offset.current);
      setNotice("Imported for preview. Save to keep this design.");
    } catch (e) {
      setNotice(e.message);
    }
  }
  const shown = active?.carousel;
  const currentSlide =
    shown?.slides[
      (manualSlide ?? Math.floor((now - active.startedAt) / 5000)) %
        shown.slides.length
    ];
  return (
    <div className="director">
      <header className="director-top">
        <a href="./">✳ scene studio</a>
        <span className="draft-badge">NEXT VERSION · INTERACTIVE PREVIEW</span>
        <div>
          <button onClick={exportDesign}>Export</button>
          <label className="import-control">
            Import
            <input
              type="file"
              accept="application/json,.json"
              aria-label="Import trigger design"
              onChange={(e) => {
                importDesign(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </label>
          <button className="lime" onClick={save}>
            Save this draft
          </button>
        </div>
      </header>
      <section className="director-intro">
        <p className="eyebrow">YOUR STREAM, ON CUE</p>
        <h1>Make the moment happen.</h1>
        <p>
          A word from chat. A little time. Your images, your message, your
          moment.
        </p>
        <p className="prototype-note">
          This is an interactive prototype. Test messages are simulated; timers
          run only on this page. Store links open real sites in preview. Twitch
          chat reading, advertising and purchase links are not enabled in the
          submitted extension.
        </p>
      </section>
      <main className="director-grid">
        <section className="control-panel">
          <nav aria-label="Edit automation">
            <button
              aria-pressed={tab === "rules"}
              onClick={() => setTab("rules")}
            >
              01 · Chat & timing
            </button>
            <button
              aria-pressed={tab === "carousels"}
              onClick={() => setTab("carousels")}
            >
              02 · Your carousels
            </button>
          </nav>
          {tab === "rules" ? (
            <div className="rule-list">
              <div className="section-heading">
                <h2>If this, then that.</h2>
                <button
                  disabled={design.rules.length >= 8}
                  onClick={() =>
                    setDesign((d) => ({
                      ...d,
                      rules: [
                        ...d.rules,
                        {
                          id: uid(),
                          name: "My new moment",
                          enabled: true,
                          trigger: {
                            type: "keyword",
                            phrase: "hello",
                            match: "word",
                          },
                          effect: {
                            type: "celebrate",
                            message: "WELCOME TO THE STREAM",
                          },
                          cooldownSeconds: 20,
                        },
                      ],
                    }))
                  }
                >
                  + Add rule
                </button>
              </div>
              {design.rules.map((r, index) => (
                <article className="rule" key={r.id}>
                  <div className="rule-head">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <input
                      aria-label={`Rule ${index + 1} name`}
                      value={r.name}
                      maxLength={70}
                      onChange={(e) =>
                        updateRule(r.id, { name: e.target.value })
                      }
                    />
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) =>
                          updateRule(r.id, { enabled: e.target.checked })
                        }
                      />
                      On
                    </label>
                  </div>
                  <label>
                    When
                    <select
                      aria-label={`Rule ${index + 1} trigger`}
                      value={r.trigger.type}
                      onChange={(e) =>
                        updateRule(r.id, {
                          trigger:
                            e.target.value === "keyword"
                              ? {
                                  type: "keyword",
                                  phrase: "hello",
                                  match: "word",
                                }
                              : e.target.value === "external"
                                ? { type: "external", event: "boss_defeated" }
                                : { type: "interval", everySeconds: 300 },
                        })
                      }
                    >
                      <option value="keyword">
                        Chat says a word or phrase
                      </option>
                      <option value="interval">A timer comes around</option>
                      <option value="external">
                        A game or service sends an event
                      </option>
                    </select>
                  </label>
                  {r.trigger.type === "external" && (
                    <label>
                      Event name
                      <input
                        aria-label={`Rule ${index + 1} event name`}
                        value={r.trigger.event}
                        maxLength={64}
                        onChange={(e) =>
                          updateRule(r.id, {
                            trigger: { ...r.trigger, event: e.target.value },
                          })
                        }
                      />
                      <small>
                        Choose your own name, like boss_defeated or
                        goal.reached. Local simulation only.
                      </small>
                    </label>
                  )}
                  {r.trigger.type === "keyword" ? (
                    <div className="field-pair">
                      <label>
                        Word or phrase
                        <input
                          aria-label={`Rule ${index + 1} phrase`}
                          value={r.trigger.phrase}
                          maxLength={80}
                          onChange={(e) =>
                            updateRule(r.id, {
                              trigger: { ...r.trigger, phrase: e.target.value },
                            })
                          }
                        />
                      </label>
                      <label>
                        Match
                        <select
                          value={r.trigger.match}
                          onChange={(e) =>
                            updateRule(r.id, {
                              trigger: { ...r.trigger, match: e.target.value },
                            })
                          }
                        >
                          <option value="word">Whole word / phrase</option>
                          <option value="contains">
                            Anywhere in a message
                          </option>
                        </select>
                      </label>
                    </div>
                  ) : r.trigger.type === "interval" ? (
                    <label>
                      Every (seconds)
                      <input
                        aria-label={`Rule ${index + 1} interval`}
                        type="number"
                        min="5"
                        max="3600"
                        value={r.trigger.everySeconds}
                        onChange={(e) =>
                          updateRule(r.id, {
                            trigger: {
                              ...r.trigger,
                              everySeconds: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  ) : null}
                  <label>
                    Then
                    <select
                      aria-label={`Rule ${index + 1} effect`}
                      value={r.effect.type}
                      onChange={(e) =>
                        updateRule(r.id, {
                          effect:
                            e.target.value === "celebrate"
                              ? {
                                  type: "celebrate",
                                  message: "YOU MADE THIS MOMENT",
                                }
                              : {
                                  type: "carousel",
                                  carouselId: design.carousels[0].id,
                                },
                        })
                      }
                    >
                      <option
                        value="carousel"
                        disabled={!design.carousels.length}
                      >
                        Show an image carousel
                      </option>
                      <option value="celebrate">Celebrate on screen</option>
                    </select>
                  </label>
                  {r.effect.type === "carousel" ? (
                    <label>
                      Which carousel
                      <select
                        value={r.effect.carouselId}
                        onChange={(e) =>
                          updateRule(r.id, {
                            effect: { ...r.effect, carouselId: e.target.value },
                          })
                        }
                      >
                        {design.carousels.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label>
                      Celebration message
                      <input
                        aria-label={`Rule ${index + 1} celebration message`}
                        value={r.effect.message}
                        maxLength={160}
                        onChange={(e) =>
                          updateRule(r.id, {
                            effect: { ...r.effect, message: e.target.value },
                          })
                        }
                      />
                    </label>
                  )}
                  <div className="rule-bottom">
                    <label>
                      Cooldown (seconds)
                      <input
                        aria-label={`Rule ${index + 1} cooldown`}
                        type="number"
                        min="0"
                        max="3600"
                        value={r.cooldownSeconds}
                        onChange={(e) =>
                          updateRule(r.id, {
                            cooldownSeconds: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <button
                      className="quiet"
                      onClick={() =>
                        setDesign((d) => ({
                          ...d,
                          rules: d.rules.filter((x) => x.id !== r.id),
                        }))
                      }
                    >
                      Remove rule
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="carousel-editor">
              <div className="section-heading">
                <h2>Images with somewhere to go.</h2>
                <button
                  disabled={design.carousels.length >= 3}
                  onClick={() => {
                    const id = uid();
                    setDesign((d) => ({
                      ...d,
                      carousels: [
                        ...d.carousels,
                        {
                          id,
                          title: "My carousel",
                          displaySeconds: 20,
                          slides: [
                            {
                              id: uid(),
                              title: "Your first slide",
                              caption: "Make it yours",
                              image: "",
                              url: "",
                            },
                          ],
                        },
                      ],
                    }));
                    setCarouselId(id);
                    setSlideIndex(0);
                  }}
                >
                  + New
                </button>
              </div>
              {carousel ? (
                <>
                  <label>
                    Carousel
                    <select
                      value={carousel.id}
                      onChange={(e) => {
                        setCarouselId(e.target.value);
                        setSlideIndex(0);
                      }}
                    >
                      {design.carousels.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Name
                    <input
                      value={carousel.title}
                      maxLength={80}
                      onChange={(e) =>
                        updateCarousel({ title: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Stay on screen (seconds)
                    <input
                      aria-label="Carousel visible seconds"
                      type="number"
                      min="2"
                      max="300"
                      value={carousel.displaySeconds}
                      onChange={(e) =>
                        updateCarousel({
                          displaySeconds: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <div className="slide-tabs" aria-label="Slides">
                    {carousel.slides.map((s, i) => (
                      <button
                        key={s.id}
                        aria-pressed={slide?.id === s.id}
                        onClick={() => setSlideIndex(i)}
                      >
                        {i + 1}
                      </button>
                    ))}
                    <button
                      disabled={carousel.slides.length >= 6}
                      onClick={() => {
                        updateCarousel({
                          slides: [
                            ...carousel.slides,
                            {
                              id: uid(),
                              title: "New slide",
                              caption: "",
                              image: "",
                              url: "",
                            },
                          ],
                        });
                        setSlideIndex(carousel.slides.length);
                      }}
                    >
                      +
                    </button>
                  </div>
                  {slide && (
                    <>
                      <div className="slide-image">
                        {slide.image ? (
                          <img src={slide.image} alt={slide.title} />
                        ) : (
                          <span>Your image goes here</span>
                        )}
                      </div>
                      <label>
                        Choose an image
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={(e) => {
                            upload(e.target.files[0]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <label>
                        Slide title
                        <input
                          value={slide.title}
                          maxLength={70}
                          onChange={(e) =>
                            updateSlide({ title: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Caption
                        <input
                          value={slide.caption}
                          maxLength={100}
                          onChange={(e) =>
                            updateSlide({ caption: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Website link (optional)
                        <input
                          aria-label="Slide website link"
                          type="url"
                          placeholder="https://…"
                          value={slide.url}
                          maxLength={1000}
                          onChange={(e) => updateSlide({ url: e.target.value })}
                        />
                      </label>
                      <div className="field-pair">
                        <button
                          disabled={carousel.slides.length < 2}
                          onClick={() => {
                            updateCarousel({
                              slides: carousel.slides.filter(
                                (s) => s.id !== slide.id,
                              ),
                            });
                            setSlideIndex(0);
                          }}
                        >
                          Remove slide
                        </button>
                        <button className="lime" onClick={previewCarousel}>
                          Show carousel now
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p>Add a carousel to begin.</p>
              )}
            </div>
          )}
        </section>
        <section className="preview-panel">
          <div className="preview-heading">
            <span>INTERACTIVE PREVIEW</span>
            <span>SIMULATED CHAT · NO LIVE POSTING</span>
          </div>
          <div className="director-stage">
            <div className="stage-scenery">
              <span className="stream-tag">YOUR STREAM</span>
              <div className="orbit one" />
              <div className="orbit two" />
              <h2>
                Keep the stream.
                <br />
                <em>Add the unexpected.</em>
              </h2>
              <p>Your moments appear when you decide.</p>
            </div>
            {active?.effect.type === "celebrate" && (
              <div className="director-burst" role="status">
                <strong>{active.effect.message}</strong>
                {Array.from({ length: 20 }, (_, i) => (
                  <i key={i} style={{ "--i": i }}>
                    ✦
                  </i>
                ))}
              </div>
            )}
            {shown && currentSlide && (
              <aside className="popup-carousel" aria-label="Carousel preview">
                <div className="popup-top">
                  <span>{shown.title}</span>
                  <button
                    aria-label="Dismiss carousel"
                    onClick={() => setActive(null)}
                  >
                    ×
                  </button>
                </div>
                {currentSlide.image && (
                  <img src={currentSlide.image} alt={currentSlide.title} />
                )}
                <div className="popup-copy">
                  <strong>{currentSlide.title}</strong>
                  <p>{currentSlide.caption}</p>
                  {currentSlide.url ? (
                    <a
                      href={currentSlide.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View item ↗
                    </a>
                  ) : (
                    <small>Image showcase</small>
                  )}
                </div>
                <div className="popup-controls">
                  <button
                    aria-label="Previous slide"
                    onClick={() =>
                      setManualSlide(
                        ((manualSlide ??
                          Math.floor((now - active.startedAt) / 5000)) +
                          shown.slides.length -
                          1) %
                          shown.slides.length,
                      )
                    }
                  >
                    ←
                  </button>
                  <span>
                    {((manualSlide ??
                      Math.floor((now - active.startedAt) / 5000)) %
                      shown.slides.length) +
                      1}{" "}
                    / {shown.slides.length}
                  </span>
                  <button
                    aria-label="Next slide"
                    onClick={() =>
                      setManualSlide(
                        ((manualSlide ??
                          Math.floor((now - active.startedAt) / 5000)) +
                          1) %
                          shown.slides.length,
                      )
                    }
                  >
                    →
                  </button>
                </div>
                <div
                  className="popup-progress"
                  style={{
                    width: `${Math.max(0, 100 - (now - active.startedAt) / (shown.displaySeconds * 10))}%`,
                  }}
                />
              </aside>
            )}
            <div className="stage-status">
              {active
                ? "A moment is on screen"
                : running
                  ? "Waiting for the next cue"
                  : "Ready when you are"}
              {queue.length > 0 ? ` · ${queue.length} queued` : ""}
            </div>
          </div>
          <div className="preview-actions">
            <button onClick={previewCarousel} disabled={!carousel}>
              Show carousel now
            </button>
            <button
              onClick={() => {
                try {
                  enqueue(
                    [
                      {
                        name: "Manual celebration",
                        effect: {
                          type: "celebrate",
                          message: "THIS IS YOUR MOMENT",
                        },
                      },
                    ],
                    validateAutomations(design),
                  );
                } catch (e) {
                  setNotice(e.message);
                }
              }}
            >
              Try celebration
            </button>
            <button
              onClick={() => {
                setActive(null);
                setQueue([]);
                setNotice("Preview cleared.");
              }}
            >
              Clear preview
            </button>
          </div>
          <div className="try-chat">
            <label htmlFor="preview-chat">Try a chat message</label>
            <p>
              Start with{" "}
              <button onClick={() => setMessage("merch")}>merch</button> or{" "}
              <button onClick={() => setMessage("party")}>party</button>. Change
              those words in your rules.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                evaluate({ type: "message", text: message });
              }}
            >
              <input
                id="preview-chat"
                maxLength={2000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type a message to test your rules…"
              />
              <button className="lime" type="submit">
                Test message →
              </button>
            </form>
          </div>
          <div className="try-chat">
            <label htmlFor="preview-event">Try an outside event</label>
            <p>
              Choose “A game or service sends an event” in a rule, then use the
              same event name here. This tests the response; no external service
              is connected yet.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                evaluate({ type: "external", name: externalName });
              }}
            >
              <input
                id="preview-event"
                maxLength={64}
                value={externalName}
                onChange={(e) => setExternalName(e.target.value)}
              />
              <button type="submit">Simulate event →</button>
            </form>
          </div>
          <div className="timer-controls">
            <button
              aria-pressed={running}
              onClick={() => {
                if (!running) {
                  engine.current = createAutomationState(
                    Date.now() + offset.current,
                  );
                  setNotice(
                    "Timers started. They run only while this preview stays open.",
                  );
                }
                setRunning((v) => !v);
              }}
            >
              {running ? "Pause timers" : "Start timers"}
            </button>
            <button
              disabled={!running}
              onClick={() => {
                offset.current += 300000;
                evaluate({ type: "tick" });
                setNow(Date.now() + offset.current);
              }}
            >
              Advance preview 5 minutes
            </button>
            <span>{running ? "Timers running" : "Timers paused"}</span>
          </div>
          <DeveloperPanel onEvent={evaluate} />
          <p className="director-notice" role="status">
            {notice}
          </p>
          <details>
            <summary>What just happened</summary>
            <ol>
              {log.map((item) => (
                <li key={item.id}>{item.text}</li>
              ))}
            </ol>
          </details>
        </section>
      </main>
    </div>
  );
}

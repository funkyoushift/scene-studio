import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Scene from "../src/Scene.jsx";
import Celebration from "../src/Celebration.jsx";
import Shoutout from "../src/Shoutout.jsx";
import { validateScene } from "../src/scene.mjs";
import "../src/style.css";
import "../src/widgets.css";
function App() {
  const [data, setData] = useState({
      scene: { version: 1, name: "Preview", objects: [] },
      editing: false,
    }),
    [event, setEvent] = useState(null);
  const send = (message) =>
    parent.postMessage(
      { source: "studio-preview", ...message },
      location.origin,
    );
  const experienceOpen = useCallback(
    (open) =>
      parent.postMessage(
        { source: "studio-preview", experienceOpen: open },
        location.origin,
      ),
    [],
  );
  useEffect(() => {
    const receive = (e) => {
      if (
        e.origin !== location.origin ||
        e.source !== parent ||
        e.data?.source !== "studio-overview"
      )
        return;
      try {
        if (e.data.scene)
          setData({ ...e.data, scene: validateScene(e.data.scene) });
        if ("event" in e.data) setEvent(e.data.event);
      } catch (error) {
        send({ error: error.message });
      }
    };
    window.addEventListener("message", receive);
    send({ ready: true });
    return () => window.removeEventListener("message", receive);
  }, []);
  return (
    <>
      <style>{`html,body,#root{margin:0;width:100%;height:100%;background:#0c1221;overflow:hidden}.stage{width:100%;height:100%;aspect-ratio:auto;border:0;border-radius:0}.stage .scene-caption,.stage .empty-stage{display:none}.stage .stage-watermark{font-size:12px}.local-popup{position:absolute;z-index:1000;border-radius:14px;padding:16px;background:#1e293b;color:white;border:2px solid #a78bfa;box-sizing:border-box;overflow:auto}.local-popup img{width:100%;height:55%;object-fit:contain}.local-popup h2{font-size:20px}.local-popup p{font-size:15px}.local-popup button{position:absolute;right:8px;top:8px}.ss-celebration,.ss-shoutout{pointer-events:auto}`}</style>
      <Scene
        key={data.resetKey || "scene"}
        scene={data.scene}
        editing={data.editing}
        selected={data.selected}
        onSelect={(id) => send({ selected: id })}
        onExperienceOpen={experienceOpen}
        experienceInitiallyOpen={data.autoOpenExperience}
        onChange={(object) => {
          if (object)
            send({
              objects: data.scene.objects.map((o) =>
                o.id === object.id ? object : o,
              ),
            });
        }}
        backdrop
      />
      {event?.effect?.type === "celebrate" && (
        <Celebration
          key={event.id}
          message={event.effect.message}
          appearance={event.effect.appearance}
          onDismiss={() => setEvent(null)}
          eventId={event.id}
          previewFullMotion
        />
      )}
      {event?.effect?.type === "shoutout" && (
        <Shoutout
          profile={event.shoutout}
          effect={event.effect}
          onDismiss={() => setEvent(null)}
        />
      )}
      {event?.effect?.type === "carousel" &&
        (() => {
          const c = data.automation?.carousels.find(
              (c) => c.id === event.effect.carouselId,
            ),
            s = c?.slides[event.slide || 0],
            l = c?.layout;
          if (!c || !s) return null;
          return (
            <aside
              className="local-popup"
              aria-label={`Preview: ${s.title}`}
              style={{
                left: `${l?.x ?? 65}%`,
                top: `${l?.y ?? 5}%`,
                width: `${l?.width ?? 30}%`,
                height: `${l?.height ?? 60}%`,
              }}
            >
              <button onClick={() => setEvent(null)} aria-label="Dismiss popup">
                ×
              </button>
              {s.image && <img src={s.image} alt="" />}
              <h2>{s.title}</h2>
              <p>{s.caption}</p>
              {s.url && (
                <a href={s.url} target="_blank" rel="noreferrer">
                  Open website ↗
                </a>
              )}
              {c.slides.length > 1 && (
                <div>
                  <button
                    style={{ position: "static" }}
                    onClick={() =>
                      setEvent({
                        ...event,
                        slide: ((event.slide || 0) + 1) % c.slides.length,
                      })
                    }
                  >
                    Next slide
                  </button>
                  <span>
                    {" "}
                    {(event.slide || 0) + 1} / {c.slides.length}
                  </span>
                </div>
              )}
            </aside>
          );
        })()}
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

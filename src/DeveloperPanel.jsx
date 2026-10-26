import React, { useEffect, useRef, useState } from "react";

// Local development only. Credentials never enter a scene export or localStorage.
const BRIDGE = "http://127.0.0.1:5190";
export default function DeveloperPanel({ onEvent }) {
  const [session, setSession] = useState(null),
    [status, setStatus] = useState("Start a sandbox to connect your own code."),
    [eventName, setEventName] = useState("boss_defeated"),
    [actionName, setActionName] = useState("viewer.cheer"),
    [stateText, setStateText] = useState('{"goal": 10}'),
    [received, setReceived] = useState([]),
    [busy, setBusy] = useState(false);
  const callback = useRef(onEvent),
    cursor = useRef(0);
  callback.current = onEvent;
  async function request(path, method = "GET", body, connection = session) {
    const response = await fetch(`${connection.baseUrl}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${connection.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
      credentials: "omit",
    });
    const data = await response.json();
    if (!response.ok)
      throw Error(data.error || `API request failed (${response.status}).`);
    return data;
  }
  async function start() {
    setBusy(true);
    try {
      const response = await fetch(`${BRIDGE}/dev/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(5000),
        redirect: "error",
        credentials: "omit",
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Could not start sandbox.");
      cursor.current = 0;
      setSession(data);
      setReceived([]);
      setStatus(
        "Local API connected. Events received here can trigger your rules.",
      );
    } catch (error) {
      setStatus(
        `Sandbox unavailable: ${error.message}. Start the local developer bridge on this PC.`,
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!session) return;
    let stopped = false,
      inFlight = false;
    const poll = async () => {
      if (inFlight || stopped) return;
      inFlight = true;
      try {
        const data = await request(
          `events?after=${cursor.current}`,
          "GET",
          undefined,
          session,
        );
        if (stopped) return;
        for (const event of data.events) {
          cursor.current = event.sequence;
          callback.current({ type: "external", name: event.name });
          setReceived((old) =>
            [`${event.sequence} · ${event.name}`, ...old].slice(0, 6),
          );
        }
        if (data.events.length)
          setStatus(
            `Received ${data.events.length} API event${data.events.length === 1 ? "" : "s"}. Check the rule result below.`,
          );
      } catch (error) {
        if (!stopped) setStatus(`API connection: ${error.message}`);
      } finally {
        inFlight = false;
      }
    };
    poll();
    const timer = setInterval(poll, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [session]);
  async function perform(fn) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setStatus(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') return (
    <details className="developer-panel">
      <summary>Developer mode · API roadmap and preview</summary>
      <p>Connect a game, website or service through named events, viewer actions and shared JSON state. The visual builder and event simulator work here without a local server.</p>
      <p>The hosted developer API is not enabled yet. Channel-owned keys, permissions and revocation must be connected before an outside application can control a real Twitch overlay.</p>
      <pre>{`POST /channels/{channel}/events\n{ "id": "victory-1", "name": "boss_defeated", "data": { "score": 100 } }\n\nGET /channels/{channel}/actions?after={cursor}\nGET /channels/{channel}/state`}</pre>
      <p>These are the planned cloud API shapes, not active endpoints. Try your event names with “Try an outside event” above. No local API calls are made from this hosted page.</p>
    </details>
  );
  return (
    <details className="developer-panel">
      <summary>Developer mode · connect your own code</summary>
      <p>
        Build your game adapter, website or tool against a real local API.
        Incoming events trigger rules; actions and JSON state let your code
        exchange data with this sandbox.
      </p>
      <p className="prototype-note">
        This PC only · expires after one hour · no live Twitch access. Event
        data is accepted by the API but is not yet bound to text or properties
        in the overlay. Closing this page stops preview playback; restarting the
        bridge clears the sandbox.
      </p>
      {!session ? (
        <button disabled={busy} onClick={start}>
          Start developer sandbox
        </button>
      ) : (
        <>
          <label>
            API address
            <input readOnly value={session.baseUrl} />
          </label>
          <label>
            Temporary API key
            <input
              readOnly
              type="password"
              value={session.token}
              autoComplete="off"
            />
          </label>
          <button
            onClick={() =>
              perform(async () => {
                await navigator.clipboard.writeText(session.token);
                setStatus(
                  "Temporary sandbox key copied. Use it only for this local sandbox.",
                );
              })
            }
          >
            Copy temporary key
          </button>
          <p>
            Set <code>SCENE_TOKEN</code> to that key in your own process. Your
            integration can be written in any language.
          </p>
          <pre>{`curl -X POST "${session.baseUrl}/events" \\\n  -H "Authorization: Bearer $SCENE_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"id":"victory-1","name":"boss_defeated","data":{"score":100}}'`}</pre>
          <div className="field-pair">
            <label>
              Incoming event
              <input
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                maxLength={64}
              />
            </label>
            <button
              disabled={busy}
              onClick={() =>
                perform(async () => {
                  await request("events", "POST", {
                    id: crypto.randomUUID(),
                    name: eventName,
                    data: { source: "developer-panel" },
                  });
                  setStatus(
                    "Event accepted by the local API. Waiting for the preview listener.",
                  );
                })
              }
            >
              Send through API
            </button>
          </div>
          <div className="field-pair">
            <label>
              Action to send back
              <input
                value={actionName}
                onChange={(e) => setActionName(e.target.value)}
                maxLength={64}
              />
            </label>
            <button
              disabled={busy}
              onClick={() =>
                perform(async () => {
                  await request("actions", "POST", {
                    id: crypto.randomUUID(),
                    name: actionName,
                    data: { source: "simulated-viewer" },
                  });
                  setStatus(
                    "Simulated viewer action recorded. Your code can read it from /actions?after=0.",
                  );
                })
              }
            >
              Simulate viewer action
            </button>
          </div>
          <label>
            Shared JSON state
            <textarea
              value={stateText}
              onChange={(e) => setStateText(e.target.value)}
              rows={3}
              maxLength={8192}
            />
          </label>
          <div className="preview-actions">
            <button
              disabled={busy}
              onClick={() =>
                perform(async () => {
                  await request("state", "PUT", JSON.parse(stateText));
                  setStatus("Sandbox state saved through the API.");
                })
              }
            >
              Write state
            </button>
            <button
              disabled={busy}
              onClick={() =>
                perform(async () => {
                  const data = await request("state");
                  setStateText(JSON.stringify(data.state, null, 2));
                  setStatus("Read state back from the API.");
                })
              }
            >
              Read state
            </button>
          </div>
          <p>
            <code>GET /events?after=0</code> · <code>GET /actions?after=0</code>{" "}
            · <code>GET/PUT /state</code>
          </p>
          <p>
            Reuse an event ID only when retrying the same event. Poll using the
            last sequence received; this sandbox keeps a bounded, short-lived
            history.
          </p>
          {received.length > 0 && (
            <ol aria-label="Received API events">
              {received.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          )}
          <button
            onClick={() => {
              setSession(null);
              setStatus(
                "Preview disconnected. The temporary key remains valid until it expires or the local bridge stops.",
              );
            }}
          >
            Disconnect preview
          </button>
        </>
      )}
      <p role="status">{status}</p>
    </details>
  );
}

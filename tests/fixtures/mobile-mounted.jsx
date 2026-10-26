// Local test fixture only. No real Twitch identity, network, or messages.
import React from "react";
import { createRoot } from "react-dom/client";
import MobileViewer from "../../src/MobileViewer.jsx";
import "../../src/mobile.css";

const options = new URLSearchParams(location.search);
if (options.has("withoutUuid")) Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
window.addEventListener("unhandledrejection", event => { document.getElementById("fixture-errors").textContent = event.reason?.message || "Unhandled request"; });
const base = { x: 5, y: 5, width: 30, height: 25, color: "#a3e635", shape: "card", icon: "spark", image: "", url: "", motion: "none" };
const scene = { version: 1, name: "Mounted mobile fixture", objects: [
  { ...base, id: "message", action: "reveal", title: "About this channel", caption: "Tap for a message", detail: "You found the message." },
  { ...base, id: "moment", action: "celebrate", title: "Your moment", caption: "Tap to celebrate", detail: "You made this moment!" },
  { ...base, id: "reaction", action: "counter", title: "Send some love", caption: "Tap to add a heart", detail: "Thanks!" },
] };
const auth = { token: "local-fixture-token", channelId: "123", clientId: "localfixture", helixToken: "local-profile-token" };
const listeners = new Map(), visibilityCallbacks = new Set();
let configFails = options.has("failConfig"), configReads = 0, activeReads = 0, eventSequence = 0, visible = true, lastMockEvent = null;
const automationConfig = { channelId: "123", revision: 1, ownedMerch: false, updatedAt: 1000, design: {
  version: 1, rules: [], carousels: [{ id: "collection", title: "Fixture collection", displaySeconds: 90, slides: [
    { id: "mug", title: "Fixture mug", caption: "A mock carousel received through the real viewer subscription.", image: "", url: "" },
    { id: "shirt", title: "Fixture shirt", caption: "Second carousel item.", image: "", url: "" },
  ] }],
} };
function fixtureStatus() {
  document.getElementById("fixture-status").textContent = `Mock config: ${configFails ? "failing" : "available"}; config reads: ${configReads}; active reads: ${activeReads}; view: ${visible ? "visible" : "hidden"}; broadcasts: ${eventSequence}.`;
}
const helper = {
  viewer: { isLinked: false, role: "viewer" }, features: { isChatEnabled: true }, actions: { requestIdShare() {} },
  configuration: { broadcaster: { content: JSON.stringify(scene) }, onChanged(callback) { queueMicrotask(callback); } },
  listen(target, callback) { const callbacks = listeners.get(target) || new Set(); callbacks.add(callback); listeners.set(target, callbacks); },
  unlisten(target, callback) { listeners.get(target)?.delete(callback); },
  onAuthorized(callback) { queueMicrotask(() => callback(auth)); },
  onVisibilityChanged(callback) { visibilityCallbacks.add(callback); queueMicrotask(() => callback(visible)); },
};
window.fetch = async address => {
  const url = new URL(address);
  if (url.origin === "https://api.twitch.tv" && url.pathname === "/helix/users") return Response.json({ data: [{ id: "123", login: "funkyoushift" }] });
  if (url.pathname === "/v1/automations/123/config") {
    configReads++; fixtureStatus();
    return configFails ? Response.json({ message: "The local fixture is rejecting config requests." }, { status: 503 }) : Response.json(automationConfig);
  }
  if (url.pathname === "/v1/automations/123/active") {
    activeReads++; fixtureStatus();
    return Response.json({ channelId: "123", revision: automationConfig.revision, event: lastMockEvent?.expires > Date.now() ? lastMockEvent : null });
  }
  throw Error("The local fixture blocked an unexpected network request.");
};
document.getElementById("fixture-carousel").addEventListener("click", () => {
  const created = Date.now();
  const event = { type: "scene-studio-automation", channelId: "123", revision: 1, eventId: `fixture-${++eventSequence}`, created, expires: created + 90000, effect: { type: "carousel", carouselId: "collection" } };
  lastMockEvent = event;
  for (const callback of [...listeners.get("broadcast") || []]) void callback("broadcast", "application/json", JSON.stringify(event));
  fixtureStatus();
});
document.getElementById("fixture-expire").addEventListener("click", () => { if (lastMockEvent) lastMockEvent = { ...lastMockEvent, expires: Date.now() - 1 }; fixtureStatus(); });
document.getElementById("fixture-config-fail").addEventListener("click", () => { configFails = true; fixtureStatus(); });
document.getElementById("fixture-config-restore").addEventListener("click", () => { configFails = false; fixtureStatus(); });
function visibility(shown) { visible = shown; for (const callback of visibilityCallbacks) callback(shown); fixtureStatus(); }
document.getElementById("fixture-hide").addEventListener("click", () => visibility(false));
document.getElementById("fixture-show").addEventListener("click", () => visibility(true));
fixtureStatus();
createRoot(document.getElementById("root")).render(<MobileViewer helper={helper} />);

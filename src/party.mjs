export const PARTY_PRESETS = Object.freeze({
  ducks: { label: "Duck invasion", symbol: "🦆", text: "QUACK. The ducks have taken over.", color: "#facc15", chat: "released the emergency ducks. QUACK. 🦆" },
  disco: { label: "Emergency disco", symbol: "🪩", text: "Absolutely unnecessary. Entirely fabulous.", color: "#e879f9", chat: "declared an emergency disco. Everybody remain fabulous. 🪩" },
  confetti: { label: "Confetti cannon", symbol: "🎉", text: "A wildly disproportionate celebration!", color: "#38bdf8", chat: "fired the confetti cannon. We are celebrating... something! 🎉" },
});
export function partyEvent(raw, now = Date.now()) {
  let e;
  try { e = JSON.parse(raw); } catch { return null; }
  if (e?.type !== "scene-studio-party" || !Object.hasOwn(PARTY_PRESETS, e.preset) ||
      !/^[a-f0-9-]{36}$/.test(e.eventId) || !/^[a-z0-9_]{1,25}$/.test(e.actor) ||
      !Number.isFinite(e.created) || Math.abs(now - e.created) > 60_000) return null;
  return { type: e.type, eventId: e.eventId, preset: e.preset, actor: e.actor, created: e.created };
}

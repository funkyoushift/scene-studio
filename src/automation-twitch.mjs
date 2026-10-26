import { CELEBRATION_SOUNDS, CELEBRATION_STYLES, validateAutomations } from "./automations.mjs";
import { IMAGE_ORIGIN, hostedImage } from "./image-address.mjs";
import { prepareImage } from "./images.mjs";

export const AUTOMATION_CONFIG_BYTES = 16_384;
const bytes = value => new TextEncoder().encode(value).length;
// Twitch's Helper keeps one onAuthorized callback. An embedded editor consumes
// the parent's session instead of replacing that callback or navigating frames.
export function connectAutomationSession(helper, suppliedSession, onSession) {
  let active = true;
  const accept = session => { if (active) onSession(session); };
  if (suppliedSession !== undefined) accept(suppliedSession);
  else if (helper) helper.onAuthorized(auth => accept({ auth, viewer: { role: helper.viewer?.role, isLinked: helper.viewer?.isLinked === true } }));
  return () => { active = false; };
}
function channel(auth) {
  if (!auth?.token || !/^[1-9][0-9]{0,19}$/.test(auth.channelId)) throw Error("Open this editor inside your channel's Twitch extension configuration.");
  return auth.channelId;
}
function matchesSavedCelebration(effect, option) {
  if (option.type !== "celebrate" || option.message !== effect.message) return false;
  if (!Object.hasOwn(effect, "appearance")) return !Object.hasOwn(option, "appearance");
  const appearance = effect.appearance;
  if (!appearance || typeof appearance !== "object" || Array.isArray(appearance) ||
      !CELEBRATION_STYLES.includes(appearance.style) ||
      typeof appearance.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(appearance.color) ||
      !Number.isInteger(appearance.durationSeconds) || appearance.durationSeconds < 4 || appearance.durationSeconds > 20) return false;
  const hasSound = Object.hasOwn(appearance, "sound");
  if (Object.keys(appearance).length !== (hasSound ? 4 : 3)) return false;
  let sound;
  if (hasSound) {
    sound = appearance.sound;
    if (!sound || typeof sound !== "object" || Array.isArray(sound) || Object.keys(sound).length !== 2 ||
        !Object.hasOwn(sound, "preset") || !Object.hasOwn(sound, "volume") ||
        !CELEBRATION_SOUNDS.includes(sound.preset) || !Number.isInteger(sound.volume) || sound.volume < 0 || sound.volume > 100) return false;
  }
  if (hasSound !== Object.hasOwn(option.appearance ?? {}, "sound")) return false;
  return option.appearance?.style === appearance.style && option.appearance?.color === appearance.color &&
    option.appearance?.durationSeconds === appearance.durationSeconds &&
    (!hasSound || (option.appearance.sound.preset === sound.preset && option.appearance.sound.volume === sound.volume));
}
export function currentAutomationPublisher(expectedAuth, currentAuth, viewer) {
  if (!currentAuth?.token || currentAuth.channelId !== expectedAuth?.channelId || viewer?.role !== "broadcaster" || viewer?.isLinked !== true)
    throw Error("Your Twitch channel or permissions changed while preparing images. The design was not published. Reopen this channel's configuration before saving.");
  return currentAuth;
}
async function request(auth, suffix, method = "GET", body, fetcher = fetch) {
  const id = channel(auth);
  let response;
  try {
    response = await fetcher(`${IMAGE_ORIGIN}/v1/automations/${id}/${suffix}`, {
      method, headers: { Authorization: `Bearer ${auth.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body), credentials: "omit", redirect: "error", signal: AbortSignal.timeout(20000),
    });
  } catch { throw Error(method === "GET" ? "Could not load the channel's automation service." : "The result is uncertain. Reload saved settings before repeating this action."); }
  let result;
  try { result = await response.json(); } catch { throw Error("The automation service returned an unreadable result."); }
  if (!response.ok) throw Error(typeof result.message === "string" ? result.message.slice(0, 200) : typeof result.error === "string" ? result.error.slice(0, 200) : result.status === "cooldown" ? "Please wait for the channel cooldown before firing again." : "The channel automation request was rejected.");
  return result;
}
export function readAutomationConfig(value, channelId) {
  if (value?.channelId !== channelId || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.ownedMerch !== "boolean") throw Error("Channel automation settings could not be verified.");
  const design = validateAutomations(value.design);
  if (bytes(JSON.stringify(design)) > AUTOMATION_CONFIG_BYTES || design.carousels.some(c => c.slides.some(s => s.image && !hostedImage(s.image, channelId)))) throw Error("Saved channel automation contains invalid images or is too large.");
  return { ...value, design };
}
export async function getAutomationConfig(auth, fetcher = fetch) {
  return readAutomationConfig(await request(auth, "config", "GET", undefined, fetcher), channel(auth));
}
export function automationPreflight(input, channelId, ownedMerch) {
  const design = validateAutomations(input);
  if (design.rules.some(rule => rule.trigger.type === "interval" && rule.trigger.everySeconds < 60)) throw Error("Live timer rules, including disabled rules, need at least 60 seconds between appearances.");
  if (design.carousels.some(c => c.slides.some(s => s.url)) && ownedMerch !== true) throw Error("Confirm that all linked carousels are your own branded merchandise before saving.");
  if (design.carousels.some(c => c.slides.some(s => s.image && !s.image.startsWith("data:") && !hostedImage(s.image, channelId)))) throw Error("Replace images that belong to another channel before saving.");
  const estimate = { ...design, carousels: design.carousels.map(c => ({ ...c, slides: c.slides.map(s => ({ ...s, image: s.image ? `${IMAGE_ORIGIN}/images/${channelId}/${"0".repeat(64)}.png` : "" })) })) };
  if (bytes(JSON.stringify(estimate)) > AUTOMATION_CONFIG_BYTES) throw Error("Keep the saved automation design below 16 KB. Shorten text or remove slides.");
  return design;
}
export async function publishAutomationImages(input, auth, ownedMerch, fetcher = fetch, prepare = prepareImage) {
  const id = channel(auth), design = automationPreflight(input, id, ownedMerch), uploaded = new Map();
  for (const carousel of design.carousels) for (const slide of carousel.slides) {
    if (!slide.image.startsWith("data:")) continue;
    const original = slide.image;
    if (!uploaded.has(original)) {
      const raw = Uint8Array.from(atob(original.split(",")[1]), c => c.charCodeAt(0));
      const prepared = await prepare(new Blob([raw], { type: original.slice(5, original.indexOf(";")) }));
      if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(prepared)) throw Error("Choose a valid prepared PNG image.");
      const body = Uint8Array.from(atob(prepared.split(",")[1]), c => c.charCodeAt(0));
      if (body.length > 200_000) throw Error("Prepared image is too large.");
      const response = await fetcher(`${IMAGE_ORIGIN}/images/${id}`, { method: "POST", headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "image/png" }, body, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      const address = `${IMAGE_ORIGIN}${result.path}`;
      if (!response.ok || !hostedImage(address, id)) throw Error("Image upload could not be confirmed. Your draft is unchanged.");
      uploaded.set(original, address);
    }
    slide.image = uploaded.get(original);
  }
  return design;
}
export async function saveAutomationConfig(auth, design, expectedRevision, ownedMerch, fetcher = fetch) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error("Load the channel's saved revision before saving.");
  const clean = automationPreflight(design, channel(auth), ownedMerch);
  if (clean.carousels.some(c => c.slides.some(s => s.image.startsWith("data:")))) throw Error("Upload prepared images before saving.");
  return readAutomationConfig(await request(auth, "config", "PUT", { design: clean, expectedRevision, ownedMerch: ownedMerch === true }, fetcher), channel(auth));
}
export async function fireAutomation(auth, effect, fetcher = fetch) {
  const result = await request(auth, "fire", "POST", { ...effect, eventId: crypto.randomUUID() }, fetcher);
  if (!["sent", "uncertain", "cooldown", "no_match"].includes(result.status)) throw Error("The live action result could not be confirmed. Do not repeat it yet.");
  return result;
}

// The watcher owns channel/revision admission and event deduplication. It never
// interprets preview messages as Twitch events or retries a fire request.
export function watchAutomationEvents(helper, auth, onConfig, onEvent, onError = () => {}, fetcher = fetch, clock = Date.now, { catchUp = false } = {}) {
  const id = channel(auth), seen = new Map(), fetched = new Set();
  let active = true, config = null, loading = null, latestCreated = -Infinity;
  function report(message) { try { onError(message); } catch {} }
  function validEnvelope(event) {
    return event?.channelId === id && Number.isSafeInteger(event.revision) && event.revision > 0;
  }
  async function refresh(revision = 0) {
    if (fetched.has(revision)) return loading;
    fetched.add(revision);
    if (fetched.size > 100) fetched.delete(fetched.values().next().value);
    if (loading) { await loading; if (!active || config?.revision >= revision) return; }
    loading = getAutomationConfig(auth, fetcher).then(next => {
      if (active && (!config || next.revision >= config.revision)) { config = next; onConfig(next); }
    }).catch(error => { fetched.delete(revision); if (active) report(error.message); }).finally(() => { loading = null; });
    return loading;
  }
  async function receive(target, contentType, message) {
    if (!active || target !== "broadcast" || contentType !== "application/json" || typeof message !== "string" || message.length > 5000) return;
    let event;
    try { event = JSON.parse(message); } catch { return; }
    if (!validEnvelope(event)) return;
    if (event.type === "scene-studio-automation-config") {
      if (!config || event.revision > config.revision) await refresh(event.revision);
      return;
    }
    if (event.type !== "scene-studio-automation" || typeof event.eventId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(event.eventId)) return;
    const now = clock();
    if (!Number.isFinite(event.created) || !Number.isFinite(event.expires) || event.created > now + 30_000 || event.expires <= now || event.expires <= event.created || event.expires - event.created > 300_000) return;
    for (const [key, expiry] of seen) if (expiry <= now) seen.delete(key);
    if (seen.has(event.eventId)) return;
    seen.set(event.eventId, event.expires);
    if (seen.size > 200) seen.delete(seen.keys().next().value);
    if (!config || event.revision > config.revision) await refresh(event.revision);
    if (!active || config?.revision !== event.revision || event.expires <= clock()) {
      // A later duplicate notification may recover a failed configuration read.
      // It must never replay an effect already admitted to the viewer.
      if (active && (!config || config.revision < event.revision)) seen.delete(event.eventId);
      return;
    }
    const effect = event.effect;
    if (effect?.type === "carousel") {
      if (!config.design.carousels.some(c => c.id === effect.carouselId)) return;
    } else if (effect?.type === "celebrate") {
      if (!config.design.rules.some(r => r.enabled && (r.effect.type === "choose" ? r.effect.options : [r.effect]).some(option => matchesSavedCelebration(effect, option)))) return;
    } else return;
    if (event.created < latestCreated) return;
    latestCreated = event.created;
    try { onEvent(event, config); } catch (error) { report(error.message); }
  }
  helper.listen("broadcast", receive);
  void refresh().then(async () => {
    if (!active || !config || !catchUp) return;
    try {
      const result = await request(auth, "active", "GET", undefined, fetcher);
      if (!active) return;
      if (result?.channelId !== id || !Number.isSafeInteger(result.revision) || result.revision < 0 ||
          (result.event !== null && (!validEnvelope(result.event) || result.event.revision !== result.revision)))
        throw Error("The current live moment could not be verified.");
      if (result.event) await receive("broadcast", "application/json", JSON.stringify(result.event));
    } catch (error) { if (active) report(error.message); }
  });
  return () => { active = false; helper.unlisten("broadcast", receive); };
}

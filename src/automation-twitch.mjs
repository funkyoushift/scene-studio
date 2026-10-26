import { AUTOMATION_DESIGN_BYTES, CELEBRATION_STYLES, validateAutomations } from "./automations.mjs";
import { IMAGE_ORIGIN, hostedImage } from "./image-address.mjs";
import { prepareImage } from "./images.mjs";
import { safeHypeState } from "./hype-state.mjs";
import { validateCelebrationSound } from "./sound-contract.mjs";
import { publishSound } from "./sounds.mjs";
import { SOUND_ORIGIN } from "./sound-address.mjs";
import { normalizeShoutoutEffect, safeShoutoutProfile } from "./shoutout-contract.mjs";

export const AUTOMATION_CONFIG_BYTES = AUTOMATION_DESIGN_BYTES;
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
function matchesSavedCelebration(effect, option, channelId) {
  if (option.type !== "celebrate" || option.message !== effect.message) return false;
  if (!Object.hasOwn(effect, "appearance")) return !Object.hasOwn(option, "appearance");
  const appearance = effect.appearance;
  if (!appearance || typeof appearance !== "object" || Array.isArray(appearance) ||
      !CELEBRATION_STYLES.includes(appearance.style) ||
      typeof appearance.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(appearance.color) ||
      !Number.isInteger(appearance.durationSeconds) || appearance.durationSeconds < 4 || appearance.durationSeconds > 20) return false;
  const hasSound = Object.hasOwn(appearance, "sound");
  const hasLifecycle = Object.hasOwn(appearance, "hypeLifecycle");
  if (hasLifecycle && appearance.hypeLifecycle !== true) return false;
  if (hasLifecycle !== Object.hasOwn(option.appearance ?? {}, "hypeLifecycle")) return false;
  if (Object.keys(appearance).length !== 3 + Number(hasSound) + Number(hasLifecycle)) return false;
  let sound;
  if (hasSound) {
    try { sound = validateCelebrationSound(appearance.sound, { allowInline: false, channel: channelId }); }
    catch { return false; }
  }
  if (hasSound !== Object.hasOwn(option.appearance ?? {}, "sound")) return false;
  return option.appearance?.style === appearance.style && option.appearance?.color === appearance.color &&
    option.appearance?.durationSeconds === appearance.durationSeconds &&
    (!hasSound || (option.appearance.sound.preset === sound.preset && option.appearance.sound.volume === sound.volume &&
      (sound.preset !== "upload" || (option.appearance.sound.url === sound.url && option.appearance.sound.name === sound.name && option.appearance.sound.playback === sound.playback))));
}
function matchesSavedShoutout(event, design) {
  const profile = safeShoutoutProfile(event.shoutout);
  if (!profile || typeof event.ruleId !== "string" || !event.effect || Object.keys(event.effect).length !== 4) return null;
  let effect;
  try { effect = normalizeShoutoutEffect(event.effect); } catch { return null; }
  const rule = design.rules.find(candidate => candidate.id === event.ruleId && candidate.enabled && candidate.trigger.type === "shoutout" && candidate.effect.type === "shoutout");
  if (!rule || rule.effect.message !== effect.message || rule.effect.color !== effect.color || rule.effect.durationSeconds !== effect.durationSeconds ||
      event.expires - event.created > effect.durationSeconds * 1000 ||
      rule.trigger.exclusions.includes(profile.login)) return null;
  return profile;
}
function celebrationEffects(design) {
  return design.rules.flatMap(rule => rule.effect.type === "choose" ? rule.effect.options : [rule.effect]).filter(effect => effect.type === "celebrate");
}
function checkSoundChannels(design, channelId, allowInline) {
  for (const effect of celebrationEffects(design)) if (effect.appearance?.sound) {
    try { validateCelebrationSound(effect.appearance.sound, { allowInline, channel: channelId }); }
    catch { throw Error("Replace celebration sounds that belong to another channel or have not been uploaded."); }
  }
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
  checkSoundChannels(design, channelId, false);
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
  checkSoundChannels(design, channelId, true);
  const estimate = { ...design, carousels: design.carousels.map(c => ({ ...c, slides: c.slides.map(s => ({ ...s, image: s.image ? `${IMAGE_ORIGIN}/images/${channelId}/${"0".repeat(64)}.png` : "" })) })) };
  estimate.rules = design.rules.map(rule => ({ ...rule, effect: rule.effect.type === "choose"
    ? { ...rule.effect, options: rule.effect.options.map(option => estimateSound(option, channelId)) }
    : estimateSound(rule.effect, channelId) }));
  if (bytes(JSON.stringify(estimate)) > AUTOMATION_CONFIG_BYTES) throw Error("Keep the saved automation design within 64 KiB. Shorten text or remove slides.");
  return design;
}
function estimateSound(effect, channelId) {
  if (effect.type !== "celebrate" || effect.appearance?.sound?.preset !== "upload" || !effect.appearance.sound.url.startsWith("data:")) return effect;
  const extension = effect.appearance.sound.url.startsWith("data:audio/mpeg;base64,") ? "mp3" : "wav";
  return { ...effect, appearance: { ...effect.appearance, sound: { ...effect.appearance.sound, url: `${SOUND_ORIGIN}/sounds/${channelId}/${"0".repeat(64)}.${extension}` } } };
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
  const sounds = new Map();
  for (const effect of celebrationEffects(design)) {
    const sound = effect.appearance?.sound;
    if (sound?.preset !== "upload" || !sound.url.startsWith("data:")) continue;
    if (!sounds.has(sound.url)) sounds.set(sound.url, await publishSound(sound, auth, fetcher));
    effect.appearance.sound = { preset: "upload", url: sounds.get(sound.url).url, name: sound.name, volume: sound.volume, ...(sound.playback === "hype-loop" ? { playback: "hype-loop" } : {}) };
  }
  return design;
}
export async function saveAutomationConfig(auth, design, expectedRevision, ownedMerch, fetcher = fetch) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error("Load the channel's saved revision before saving.");
  const clean = automationPreflight(design, channel(auth), ownedMerch);
  if (clean.carousels.some(c => c.slides.some(s => s.image.startsWith("data:")))) throw Error("Upload prepared images before saving.");
  checkSoundChannels(clean, channel(auth), false);
  return readAutomationConfig(await request(auth, "config", "PUT", { design: clean, expectedRevision, ownedMerch: ownedMerch === true }, fetcher), channel(auth));
}
export async function fireAutomation(auth, effect, fetcher = fetch) {
  const result = await request(auth, "fire", "POST", { ...effect, eventId: crypto.randomUUID() }, fetcher);
  if (!["sent", "uncertain", "cooldown", "no_match"].includes(result.status)) throw Error("The live action result could not be confirmed. Do not repeat it yet.");
  return result;
}

// The watcher owns channel/revision admission and event deduplication. It never
// interprets preview messages as Twitch events or retries a fire request.
export function watchAutomationEvents(helper, auth, onConfig, onEvent, onError = () => {}, fetcher = fetch, clock = Date.now, { catchUp = false, onHype } = {}) {
  const id = channel(auth), seen = new Map(), fetched = new Set();
  let active = true, config = null, loading = null, latestCreated = -Infinity;
  let hypeTimer, latestHype = null, hypeReceivedAt = -Infinity, hypePresent = false;
  async function receiveHype(raw) {
    const event = safeHypeState(raw);
    if (!active || !event || !validEnvelope(event) || event.created > clock() + 30_000 || event.expires <= clock()) return;
    if (!config || event.revision > config.revision) await refresh(event.revision);
    if (!active || config?.revision !== event.revision || event.expires <= clock()) return;
    if (!config.design.rules.some(rule => rule.enabled && rule.trigger.type === "twitch" && rule.trigger.event.startsWith("hype_") &&
      (rule.effect.type === "choose" ? rule.effect.options : [rule.effect]).some(option => matchesSavedCelebration(event.effect, option, id)))) return;
    if (latestHype && (event.created < latestHype.created || event.eventId === latestHype.eventId ||
      (event.hype.id === latestHype.hype.id && (event.hype.updatedAt < latestHype.hype.updatedAt || (latestHype.hype.phase === "ended" && event.hype.phase !== "ended"))))) return;
    latestHype = event; hypeReceivedAt = clock(); hypePresent = true;
    onHype?.(event, config);
    if (typeof onHype === "function") { clearTimeout(hypeTimer); hypeTimer = setTimeout(pollHype, 10000); }
  }
  async function pollHype() {
    if (!active || typeof onHype !== "function") return;
    const requestedAt = clock();
    try {
      const result = await request(auth, "hype", "GET", undefined, fetcher);
      if (!active || result?.channelId !== id || !Number.isSafeInteger(result.revision) || result.revision < 0) return;
      if (result.revision > (config?.revision ?? 0)) await refresh(result.revision);
      if (result.event) {
        if (result.event.revision === result.revision) await receiveHype(result.event);
      } else if (requestedAt >= hypeReceivedAt && config?.revision === result.revision) {
        hypePresent = false; onHype(null, config);
      }
    } catch { /* Existing snapshots expire locally if the service is unavailable. */ }
    finally { if (active) { clearTimeout(hypeTimer); hypeTimer = setTimeout(pollHype, hypePresent && latestHype?.hype.phase === "active" && latestHype.expires > clock() ? 10000 : 60000); } }
  }
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
    if (event.type === "scene-studio-hype") { await receiveHype(event); return; }
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
      if (!config.design.rules.some(r => r.enabled && (r.effect.type === "choose" ? r.effect.options : [r.effect]).some(option => matchesSavedCelebration(effect, option, id)))) return;
    } else if (effect?.type === "shoutout") {
      const profile = matchesSavedShoutout(event, config.design);
      if (!profile) return;
      event.shoutout = profile;
    } else return;
    if (event.created < latestCreated) return;
    latestCreated = event.created;
    try { onEvent(event, config); } catch (error) { report(error.message); }
  }
  helper.listen("broadcast", receive);
  if (typeof onHype === "function") void refresh().then(pollHype);
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
  return () => { active = false; clearTimeout(hypeTimer); helper.unlisten("broadcast", receive); };
}

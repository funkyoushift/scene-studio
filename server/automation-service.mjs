import { AUTOMATION_DESIGN_BYTES, validateAutomations, evaluateAutomations, createAutomationState, keywordMatches, TWITCH_AUTOMATION_EVENTS, CELEBRATION_STYLES } from "../src/automations.mjs";
import { hostedImage } from "../src/image-address.mjs";
import { validateCelebrationSound } from "../src/sound-contract.mjs";
import { signPartyToken } from "./party-service.mjs";
import { safeLiveContext, ruleEffects } from "../src/live-context.mjs";
import { safeHypeState, HYPE_ACTIVE_MAX_MS, HYPE_END_MS } from "../src/hype-state.mjs";

export const HOSTED_AUTOMATION_LIMITS = Object.freeze({ designBytes: AUTOMATION_DESIGN_BYTES, channels: 100, receipts: 10000, channelReceipts: 1000, retentionMs: 86400000, channelCooldownMs: 8000, tickBatch: 2 });
const utf8 = new TextEncoder();
const numericId = /^[1-9][0-9]{0,19}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const stmt = (env, sql, ...values) => env.IMAGES.prepare(sql).bind(...values);
export class AutomationError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new AutomationError(status, code, message); };
function cleanCelebrationAppearance(value, channel) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !CELEBRATION_STYLES.includes(value.style) ||
      typeof value.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(value.color) ||
      !Number.isInteger(value.durationSeconds) || value.durationSeconds < 4 || value.durationSeconds > 20) return null;
  const appearance = { style: value.style, color: value.color, durationSeconds: value.durationSeconds };
  if (Object.hasOwn(value, "sound")) {
    try { appearance.sound = validateCelebrationSound(value.sound, { allowInline: false, channel }); }
    catch { return null; }
  }
  if (Object.hasOwn(value, "hypeLifecycle")) {
    if (value.hypeLifecycle !== true || value.style !== "hype-train") return null;
    appearance.hypeLifecycle = true;
  }
  return appearance;
}
function enabled(env, channel) {
  if (env.AUTOMATIONS_ENABLED !== "true") fail(404, "not_enabled", "Hosted automations are not enabled.");
  if (typeof channel !== "string" || !numericId.test(channel)) fail(400, "invalid_channel", "Invalid channel.");
}
function clock(now) {
  if (!Number.isSafeInteger(now) || now < 0) fail(400, "invalid_time", "Invalid automation clock.");
}
function authorize(request, env, channel, claims, now, owner = false) {
  if (!claims || !["viewer", "moderator", "broadcaster"].includes(claims.role) || claims.channel_id !== channel ||
      !Number.isFinite(claims.exp) || claims.exp <= Math.floor(now / 1000) ||
      (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > Math.floor(now / 1000))))
    fail(401, "authorization_required", "Open this extension on the correct Twitch channel.");
  if (!env.EXTENSION_ORIGIN || request.headers.get("origin") !== env.EXTENSION_ORIGIN)
    fail(403, "origin_not_allowed", "Open this extension on Twitch.");
  if (owner && (claims.role !== "broadcaster" || claims.user_id !== channel))
    fail(403, "broadcaster_required", "Only this channel’s broadcaster can change automations.");
}
async function jsonBody(request, max = 20000, tooLargeMessage = "The request body is too large.") {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") fail(415, "json_required", "Use application/json.");
  const reader = request.body?.getReader(); if (!reader) fail(400, "invalid_body", "Missing request.");
  const chunks = []; let size = 0;
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length;
    if (size > max) { await reader.cancel(); fail(413, "body_too_large", tooLargeMessage); }
    chunks.push(part.value);
  }
  const data = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { data.set(chunk, at); at += chunk.length; }
  try { const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(); return value; }
  catch { fail(400, "invalid_body", "Use a valid JSON object."); }
}
function allowedStore(env, channel, value) {
  let mapping; try { mapping = JSON.parse(env.MERCH_TEST_STORES || "{}"); } catch { return false; }
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return false;
  if (!Object.hasOwn(mapping, channel) || typeof mapping[channel] !== "string") return false;
  let base, url; try { base = new URL(mapping[channel]); url = new URL(value); } catch { return false; }
  const basePath = base.pathname.match(/^\/([A-Za-z0-9_]{1,25})\/merch\/?$/);
  // This test path accepts only the mapped store or numeric product listings.
  // No arbitrary suffix, redirect route, query, fragment, or affiliate code.
  const product = url.pathname.match(/^\/([A-Za-z0-9_]{1,25})\/merch(?:\/([0-9]+))?\/?$/);
  return Boolean(basePath && product && base.origin === "https://streamlabs.com" && !base.username && !base.password && !base.search && !base.hash &&
    url.origin === base.origin && !url.username && !url.password && !url.search && !url.hash &&
    basePath[1].toLowerCase() === product[1].toLowerCase());
}
function allowedChannelLink(env, channel, value) {
  try {
    const mapping=JSON.parse(env.POPUP_TEST_LINKS || '{}');
    if(!mapping || Array.isArray(mapping) || !Object.hasOwn(mapping,channel) || !Array.isArray(mapping[channel]) || mapping[channel].length>12) return false;
    const url=new URL(value);
    if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash) return false;
    return mapping[channel].some(entry=>typeof entry==='string' && new URL(entry).href===url.href);
  } catch { return false; }
}
function hostedDesign(env, channel, raw, ownedMerch) {
  let design; try { design = validateAutomations(raw); } catch (error) { fail(400, "invalid_design", error.message); }
  for (const rule of design.rules) for (const effect of ruleEffects(rule)) {
    if (effect.type === "celebrate" && effect.appearance?.sound) {
      try { validateCelebrationSound(effect.appearance.sound, { allowInline: false, channel }); }
      catch { fail(400, "sound_not_owned", "Upload every custom sound to this channel before saving automations."); }
    }
  }
  for (const carousel of design.carousels) for (const slide of carousel.slides) {
    if (slide.image && !hostedImage(slide.image, channel)) fail(400, "image_not_owned", "Upload every image to this channel before saving automations.");
    if (slide.url && (ownedMerch !== true || (!allowedStore(env, channel, slide.url) && !allowedChannelLink(env,channel,slide.url))))
      fail(400, "store_not_allowed", "Confirm ownership and use this channel’s configured popup destinations or Streamlabs store; sponsor and affiliate links are excluded.");
  }
  if (design.rules.some(rule => rule.trigger.type === "interval" && rule.trigger.everySeconds < 60)) fail(400, "interval_too_short", "Hosted timers must be at least 60 seconds.");
  if (utf8.encode(JSON.stringify(design)).length > HOSTED_AUTOMATION_LIMITS.designBytes) fail(413, "design_too_large", "Keep the hosted automation design within 64 KiB.");
  return design;
}
async function load(env, channel) {
  return stmt(env, "SELECT * FROM automation_configs WHERE channel=?1", channel).first();
}
function view(row, channel, design) {
  return { channelId: channel, revision: row?.revision ?? 0, design: design ?? (row ? JSON.parse(row.design) : { version: 1, carousels: [], rules: [] }), ownedMerch: row?.owned_merch === 1, updatedAt: row?.updated ?? null };
}
async function broadcast(env, channel, event, fetcher, now) {
  const jwt = await signPartyToken(env, channel, now);
  const response = await fetcher("https://api.twitch.tv/helix/extensions/pubsub", {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${jwt}`, "Client-Id": env.EXTENSION_CLIENT_ID, "Content-Type": "application/json" },
    body: JSON.stringify({ broadcaster_id: channel, target: ["broadcast"], message: JSON.stringify(event) }),
  });
  await response.body?.cancel();
  if (response.status !== 204) throw Error("Broadcast was not confirmed.");
}
const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8.encode(text))), b => b.toString(16).padStart(2, "0")).join("");
function receipt(row, replayed = false) {
  return { status: row.status === "pending" ? "uncertain" : row.status, event: JSON.parse(row.event), replayed };
}
async function activeMoment(env, channel, currentTime) {
  const now = currentTime();
  // One snapshot binds the receipt to the current channel revision. Receipt
  // retention is deliberately unrelated to the much shorter visual lifetime.
  const row = await stmt(env, `SELECT c.revision, (
    SELECT r.event FROM automation_receipts r
    WHERE r.channel=c.channel AND r.revision=c.revision AND r.status='sent'
      AND CASE WHEN length(CAST(r.event AS BLOB))<=4096 AND json_valid(r.event) THEN
        json_extract(r.event,'$.channelId')=c.channel
        AND json_extract(r.event,'$.revision')=c.revision
        AND json_extract(r.event,'$.eventId')=r.event_id
        AND json_type(r.event,'$.expires')='integer'
        AND json_extract(r.event,'$.expires')>?2
      ELSE 0 END
    ORDER BY r.created DESC,r.event_id DESC LIMIT 1
  ) AS event FROM automation_configs c WHERE c.channel=?1`, channel, now).first();
  const result = { channelId: channel, revision: row?.revision ?? 0, event: null };
  if (!row?.event) return result;
  const event = JSON.parse(row.event);
  const checkedAt = currentTime();
  if (event.type !== "scene-studio-automation" || event.channelId !== channel || event.revision !== row.revision || !uuid.test(event.eventId ?? "") ||
    !Number.isSafeInteger(event.created) || event.created < 0 || event.created > checkedAt ||
    !Number.isSafeInteger(event.expires) || event.expires <= checkedAt || event.expires - event.created > 300000) return result;
  let effect;
  if (event.effect?.type === "carousel" && typeof event.effect.carouselId === "string" && event.effect.carouselId.length > 0 && event.effect.carouselId.length <= 64)
    effect = { type: "carousel", carouselId: event.effect.carouselId };
  else if (event.effect?.type === "celebrate" && typeof event.effect.message === "string" && event.effect.message.length > 0 && event.effect.message.length <= 160) {
    const appearance = cleanCelebrationAppearance(event.effect.appearance, channel);
    if (appearance === null) return result;
    effect = { type: "celebrate", message: event.effect.message, ...(appearance ? { appearance } : {}) };
  }
  else return result;
  // Return only the same public visual envelope as PubSub, never receipt data.
  result.event = { type: event.type, eventId: event.eventId, channelId: channel, revision: row.revision, created: event.created, expires: event.expires, effect };
  return result;
}

const lifecycleOption = option => option?.type === "celebrate" && option.appearance?.style === "hype-train" && option.appearance.hypeLifecycle === true;
function lifecycleEffect(design, phase) {
  const event = phase === "active" ? "hype_progress" : "hype_end";
  const rules = design.rules.filter(rule => rule.enabled && rule.trigger.type === "twitch");
  const phaseRule = rules.find(rule => rule.trigger.event === event && ruleEffects(rule).some(lifecycleOption));
  const anchor = rules.find(rule => rule.trigger.event === "hype_begin" && lifecycleOption(rule.effect));
  const selected = phaseRule ? ruleEffects(phaseRule).find(lifecycleOption) : anchor?.effect;
  return selected ? structuredClone(selected) : null;
}
function beginEffect(design) {
  const rule = design.rules.find(item => item.enabled && item.trigger.type === "twitch" && item.trigger.event === "hype_begin" && lifecycleOption(item.effect));
  return rule ? structuredClone(rule.effect) : null;
}
function sameLifecycleEffect(left, right) {
  const leftSound = left?.appearance?.sound, rightSound = right?.appearance?.sound;
  return left?.type === "celebrate" && right?.type === "celebrate" && left.message === right.message &&
    left.appearance?.style === right.appearance?.style && left.appearance?.color === right.appearance?.color &&
    left.appearance?.durationSeconds === right.appearance?.durationSeconds &&
    left.appearance?.hypeLifecycle === right.appearance?.hypeLifecycle &&
    (["preset", "volume", "url", "name"].every(key => (leftSound?.[key] ?? null) === (rightSound?.[key] ?? null)));
}
async function hypeMoment(env, channel, currentTime) {
  const result = { channelId: channel, revision: 0, event: null };
  const row = await stmt(env, `SELECT c.revision,c.design,c.owned_merch,h.event,h.expires
    FROM automation_configs c LEFT JOIN hype_sessions h ON h.channel=c.channel
    WHERE c.channel=?1`, channel).first();
  if (!row) return result;
  result.revision = row.revision;
  const now = currentTime();
  if (!row.event || row.expires <= now || typeof row.event !== "string" || utf8.encode(row.event).length > 4096) return result;
  let event;
  try { event = safeHypeState(JSON.parse(row.event)); } catch { return result; }
  if (!event || event.channelId !== channel || event.revision !== row.revision || event.created > now || event.expires <= now) return result;
  const design = hostedDesign(env, channel, JSON.parse(row.design), row.owned_merch === 1);
  const anchor = beginEffect(design);
  if (!anchor) return result;
  const options = [anchor, lifecycleEffect(design, event.hype.phase)].filter(Boolean);
  if (!options.some(option => sameLifecycleEffect(option, event.effect))) return result;
  result.event = event;
  return result;
}

const providerId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const providerNumber = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000;
function providerTime(value) {
  if (typeof value !== "string" || value.length > 64) return null;
  const at = Date.parse(value);
  return Number.isSafeInteger(at) && at >= 0 ? at : null;
}
async function processHypeLifecycle(env, channel, event, row, design, { now, fetcher }) {
  const anchor = beginEffect(design);
  if (!anchor) return null;
  const source = event.hype;
  if (!source || !providerId(source.id) || !Number.isSafeInteger(source.sentAt) || Math.abs(now - source.sentAt) > 600000) return { status: "no_match" };
  const startedAt = providerTime(source.startedAt);
  if (startedAt === null || startedAt > source.sentAt + 600000 || startedAt > now + 600000) return { status: "no_match" };
  const old = await stmt(env, "SELECT * FROM hype_sessions WHERE channel=?1", channel).first();
  const same = old?.train_id === source.id;
  if (old && (!same && startedAt <= old.started_at || same &&
      (old.phase === "ended" || source.sentAt < old.source_at || source.sentAt === old.source_at && event.event !== "hype_end" && event.id <= old.source_id))) return { status: "no_match" };
  const level = providerNumber(source.level) && source.level >= 1 && source.level <= 10000 ? source.level : same ? old.level : null;
  const total = providerNumber(source.total) ? source.total : same ? old.total : null;
  const progress = providerNumber(source.progress) ? source.progress : same ? old.progress : event.event === "hype_end" ? total : null;
  const goal = providerNumber(source.goal) && source.goal >= 1 ? source.goal : same ? old.goal : event.event === "hype_end" ? Math.max(1, total ?? 0) : null;
  if (level === null || total === null || progress === null || goal === null) return { status: "no_match" };
  const phase = event.event === "hype_end" ? "ended" : "active";
  if (same && phase === "active" && (level < old.level || total < old.total)) return { status: "no_match" };
  const nextLevel = same ? Math.max(level, old.level) : level;
  const nextTotal = same ? Math.max(total, old.total) : total;
  const nextProgress = same && level < old.level ? old.progress : same && nextLevel === old.level ? Math.max(progress, old.progress) : progress;
  const nextGoal = same && level < old.level ? old.goal : same && nextLevel === old.level ? Math.max(goal, old.goal) : goal;
  const providerExpiry = providerTime(source.expiresAt);
  if (phase === "active" && (providerExpiry === null || providerExpiry <= now)) return { status: "no_match" };
  const expires = phase === "ended" ? now + HYPE_END_MS :
    Math.min(source.sentAt + HYPE_ACTIVE_MAX_MS, Math.max(providerExpiry, same ? old.expires : 0));
  const effect = event.event === "hype_begin" ? anchor : lifecycleEffect(design, phase) ?? anchor;
  const snapshot = safeHypeState({ type: "scene-studio-hype", eventId: crypto.randomUUID(), channelId: channel,
    revision: row.revision, created: now, expires, effect,
    hype: { id: source.id, phase, level: nextLevel, progress: nextProgress, goal: nextGoal, expiresAt: expires, updatedAt: now } });
  if (!snapshot) return { status: "no_match" };
  const shouldBroadcast = !old || old.broadcast_at < 0 || old.broadcast_at <= now - HOSTED_AUTOMATION_LIMITS.channelCooldownMs;
  const saved = await stmt(env, `INSERT INTO hype_sessions(channel,train_id,started_at,source_at,source_id,revision,level,total,progress,goal,phase,event,expires,broadcast_at)
    SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14
    WHERE EXISTS(SELECT 1 FROM automation_configs WHERE channel=?1 AND revision=?6)
      AND ((SELECT count(*) FROM hype_sessions)<${HOSTED_AUTOMATION_LIMITS.channels} OR EXISTS(SELECT 1 FROM hype_sessions WHERE channel=?1))
    ON CONFLICT(channel) DO UPDATE SET train_id=excluded.train_id,started_at=excluded.started_at,source_at=excluded.source_at,
      source_id=excluded.source_id,revision=excluded.revision,level=excluded.level,total=excluded.total,progress=excluded.progress,goal=excluded.goal,
      phase=excluded.phase,event=excluded.event,expires=excluded.expires,broadcast_at=excluded.broadcast_at
    WHERE hype_sessions.train_id=?15 AND hype_sessions.source_at=?16 AND hype_sessions.source_id=?17 AND hype_sessions.phase=?18`,
    channel, source.id, startedAt, source.sentAt, event.id, row.revision, nextLevel, nextTotal, nextProgress, nextGoal, phase,
    JSON.stringify(snapshot), expires, shouldBroadcast ? now : old?.broadcast_at ?? -1,
    old?.train_id ?? "", old?.source_at ?? -1, old?.source_id ?? "", old?.phase ?? "").run();
  if (!saved.meta.changes) return { status: "no_match" };
  if (!shouldBroadcast) return { status: "cooldown", event: snapshot };
  try { await broadcast(env, channel, snapshot, fetcher, now); return { status: "sent", event: snapshot }; }
  catch { return { status: "uncertain", event: snapshot }; }
}
async function admittedEffect(env, channel, row, inputId, inputHash, effect, nextState, { now, fetcher, context }) {
  await stmt(env, "DELETE FROM automation_receipts WHERE expires<=?1", now).run();
  const existing = () => stmt(env, "SELECT input_hash,status,event FROM automation_receipts WHERE channel=?1 AND input_id=?2", channel, inputId).first();
  const old = await existing();
  if (old) {
    if (old.input_hash !== inputHash) fail(409, "input_conflict", "This input ID has already been used for a different event.");
    return receipt(old, true);
  }
  const duration = effect.type === "carousel" ? JSON.parse(row.design).carousels.find(item => item.id === effect.carouselId).displaySeconds : effect.appearance?.durationSeconds ?? 8;
  const event = { type: "scene-studio-automation", eventId: crypto.randomUUID(), channelId: channel, revision: row.revision, created: now, expires: now + duration * 1000, effect };
  const inserted = await stmt(env, `INSERT OR IGNORE INTO automation_receipts(channel,input_id,input_hash,event_id,revision,engine_state,event,created,expires,status)
    SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,'pending' WHERE
    EXISTS(SELECT 1 FROM automation_configs WHERE channel=?1 AND revision=?5 AND engine_revision=?10 AND (last_event_at<0 OR last_event_at<=?8-?11))
    AND (SELECT count(*) FROM automation_receipts WHERE channel=?1)<?12 AND (SELECT count(*) FROM automation_receipts)<?13`,
    channel, inputId, inputHash, event.eventId, row.revision, JSON.stringify(nextState), JSON.stringify(event), now, now + HOSTED_AUTOMATION_LIMITS.retentionMs,
    row.engine_revision, HOSTED_AUTOMATION_LIMITS.channelCooldownMs, HOSTED_AUTOMATION_LIMITS.channelReceipts, HOSTED_AUTOMATION_LIMITS.receipts).run();
  if (!inserted.meta.changes) {
    const concurrent = await existing();
    if (concurrent) {
      if (concurrent.input_hash !== inputHash) fail(409, "input_conflict", "This input ID has already been used for a different event.");
      return receipt(concurrent, true);
    }
    return { status: "cooldown", retryAfterSeconds: 8, message: "Wait for the current moment to settle, or retry after refreshing the saved design. Daily receipt capacity may also be reached." };
  }
  // Once admitted, an uncertain outbound response is never sent again.
  let status = "uncertain";
  // Names exist only in the live broadcast. Durable receipts/catch-up contain
  // the unchanged template, never subscriber names or subscription text.
  const displayContext = safeLiveContext(context);
  const outgoing = Object.keys(displayContext).length ? { ...event, context: displayContext } : event;
  try { await broadcast(env, channel, outgoing, fetcher, now); status = "sent"; } catch {}
  try { await stmt(env, "UPDATE automation_receipts SET status=?3 WHERE channel=?1 AND input_id=?2", channel, inputId, status).run(); }
  catch { status = "uncertain"; }
  return { status, event, replayed: false };
}

// Caller is trusted server code (verified webhook or authenticated API adapter).
// Message text is used transiently for matching; it is never stored or broadcast.
export async function processAutomationInput(env, channel, event, { now = Date.now(), fetcher = fetch } = {}) {
  enabled(env, channel); clock(now);
  if (!event || !["message", "external", "tick", "twitch"].includes(event.type)) fail(400, "invalid_event", "Unsupported automation input.");
  if (event.type !== "tick" && (typeof event.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(event.id))) fail(400, "event_id_required", "Pass a stable source event ID.");
  if (event.type === "message" && (typeof event.text !== "string" || event.text.length > 2000)) fail(400, "invalid_event", "Chat input must be at most 2000 characters.");
  if (event.type === "twitch" && !TWITCH_AUTOMATION_EVENTS.includes(event.event)) fail(400, "invalid_event", "Use a supported Twitch event.");
  if (event.type === "external" && (typeof event.name !== "string" || !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(event.name))) fail(400, "invalid_event", "Use a valid external event name.");
  const row = await load(env, channel);
  if (!row) return { status: "no_match" };
  const design = hostedDesign(env, channel, JSON.parse(row.design), row.owned_merch === 1);
  if (event.type === "twitch" && event.event.startsWith("hype_") && event.hype) {
    const lifecycle = await processHypeLifecycle(env, channel, event, row, design, { now, fetcher });
    if (lifecycle) return lifecycle;
  }
  const previous = JSON.parse(row.engine_state);
  // Check receipts before cooldown evaluation, so an uncertain input cannot
  // become a different rule after its original rule enters cooldown.
  const inputId = `${event.type}:${event.type === "tick" ? Math.floor(now / 60000) : event.id}`;
  const inputHash = await hash(JSON.stringify({ type: event.type, text: event.text ?? null, name: event.name ?? null, ...(event.type === "twitch" ? { event: event.event } : {}) }));
  const old = await stmt(env, "SELECT input_hash,status,event FROM automation_receipts WHERE channel=?1 AND input_id=?2 AND expires>?3", channel, inputId, now).first();
  if (old) { if (old.input_hash !== inputHash) fail(409, "input_conflict", "This input ID has already been used for a different event."); return receipt(old, true); }
  const result = evaluateAutomations(design, previous, event, now);
  const selected = result.events[0];
  if (!selected) return { status: "no_match" };
  const nextState = { startedAt: previous.startedAt, lastFired: { ...previous.lastFired, [selected.ruleId]: now } };
  if (previous.choiceIndexes || result.state.choiceIndexes) nextState.choiceIndexes = { ...previous.choiceIndexes, ...(result.state.choiceIndexes?.[selected.ruleId] !== undefined ? { [selected.ruleId]: result.state.choiceIndexes[selected.ruleId] } : {}) };
  return admittedEffect(env, channel, row, inputId, inputHash, selected.effect, nextState, { now, fetcher, context: event.type === "twitch" ? event.context : undefined });
}

export async function hasMatchingKeywordRule(env, channel, text) {
  enabled(env, channel);
  if (typeof text !== "string" || text.length > 2000) return false;
  const row = await load(env, channel); if (!row) return false;
  const design = hostedDesign(env, channel, JSON.parse(row.design), row.owned_merch === 1);
  return design.rules.some(rule => rule.enabled && rule.trigger.type === "keyword" && keywordMatches(text, rule.trigger.phrase, rule.trigger.match));
}

export async function tickAutomations(env, { now = Date.now(), fetcher = fetch, limit = HOSTED_AUTOMATION_LIMITS.tickBatch } = {}) {
  if (env.AUTOMATIONS_ENABLED !== "true") return { checked: 0, sent: 0 };
  clock(now);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) fail(400, "invalid_limit", "Tick batch must contain 1 to 5 channels.");
  const due = await stmt(env, "SELECT channel,revision,next_tick FROM automation_configs WHERE has_timers=1 AND next_tick<=?1 ORDER BY next_tick,channel LIMIT ?2", now, limit).all();
  let checked = 0, sent = 0;
  for (const row of due.results) {
    // Move checked channels to the back of the persisted due queue, including
    // no-match and failed delivery cases. Parallel cron runs cannot claim twice.
    const claimed = await stmt(env, "UPDATE automation_configs SET next_tick=?4 WHERE channel=?1 AND revision=?2 AND next_tick=?3", row.channel, row.revision, row.next_tick, now + 60000).run();
    if (!claimed.meta.changes) continue;
    checked++;
    try { const result = await processAutomationInput(env, row.channel, { type: "tick" }, { now, fetcher }); if (result.status === "sent") sent++; } catch {}
  }
  return { checked, sent };
}

// The host router must verify the Twitch JWT signature before passing claims.
// These checks add channel/role/expiry/origin binding; they do not replace that proof.
export async function automationRequest(request, env, channel, { claims, now = Date.now(), fetcher = fetch } = {}) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (env.EXTENSION_ORIGIN && request.headers.get("origin") === env.EXTENSION_ORIGIN) Object.assign(headers, { "Access-Control-Allow-Origin": env.EXTENSION_ORIGIN, Vary: "Origin" });
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
  const started = Date.now(), currentTime = () => now + Math.max(0, Date.now() - started);
  try {
    enabled(env, channel); clock(now);
    const path = new URL(request.url).pathname;
    if (!["config", "fire", "active", "hype"].some(name => path === `/v1/automations/${channel}/${name}`)) fail(404, "not_found", "Endpoint not found.");
    const config = path.endsWith("/config");
    const active = path.endsWith("/active");
    const hype = path.endsWith("/hype");
    if (!(config ? ["GET", "PUT"] : active || hype ? ["GET"] : ["POST"]).includes(request.method)) fail(405, "method_not_allowed", "Unsupported method.");
    authorize(request, env, channel, claims, now, !((config || active || hype) && request.method === "GET"));
    if (hype) {
      const moment = await hypeMoment(env, channel, currentTime);
      authorize(request, env, channel, claims, currentTime());
      return json(moment);
    }
    if (active) {
      const moment = await activeMoment(env, channel, currentTime);
      authorize(request, env, channel, claims, currentTime());
      return json(moment);
    }
    if (config && request.method === "GET") {
      const row = await load(env, channel);
      return json(view(row, channel, row ? hostedDesign(env, channel, JSON.parse(row.design), row.owned_merch === 1) : undefined));
    }
    const input = await jsonBody(request, config ? AUTOMATION_DESIGN_BYTES + 1024 : 1024,
      config ? "The automation request must fit a 64 KiB design plus metadata." : "The action request is too large.");
    authorize(request, env, channel, claims, currentTime(), true);
    if (config) {
      const design = hostedDesign(env, channel, input.design, input.ownedMerch);
      const revision = input.expectedRevision;
      if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) fail(400, "invalid_revision", "Supply the last saved revision (0 for a new design).");
      const hasTimers = design.rules.some(rule => rule.enabled && rule.trigger.type === "interval") ? 1 : 0;
      const savedAt = currentTime();
      const values = [channel, JSON.stringify(design), input.ownedMerch === true ? 1 : 0, savedAt, JSON.stringify(createAutomationState(savedAt)), hasTimers, savedAt + 60000];
      const saved = revision === 0
        ? await stmt(env, `INSERT OR IGNORE INTO automation_configs(channel,design,revision,owned_merch,updated,engine_state,has_timers,next_tick)
          SELECT ?1,?2,1,?3,?4,?5,?6,?7 WHERE (SELECT count(*) FROM automation_configs)<?8`, ...values, HOSTED_AUTOMATION_LIMITS.channels).run()
        : await stmt(env, `UPDATE automation_configs SET design=?2,revision=revision+1,owned_merch=?3,updated=?4,engine_state=?5,
          engine_revision=engine_revision+1,has_timers=?6,next_tick=?7 WHERE channel=?1 AND revision=?8`, ...values, revision).run();
      if (!saved.meta.changes) fail(409, "config_conflict", "The saved design changed or channel capacity is full. Reload before saving again.");
      let notification = "uncertain";
      try { await broadcast(env, channel, { type: "scene-studio-automation-config", channelId: channel, revision: revision + 1 }, fetcher, currentTime()); notification = "sent"; } catch {}
      return json({ ...view({ revision: revision + 1, owned_merch: values[2], updated: savedAt }, channel, design), notification });
    }
    if (!uuid.test(input.eventId ?? "")) fail(400, "event_id_required", "Use a stable UUID for this manual action.");
    const row = await load(env, channel); if (!row) fail(409, "config_required", "Save this channel’s automation design first.");
    const design = hostedDesign(env, channel, JSON.parse(row.design), row.owned_merch === 1);
    let effect;
    if (input.type === "carousel" && design.carousels.some(item => item.id === input.carouselId)) effect = { type: "carousel", carouselId: input.carouselId };
    else if (input.type === "celebrate" && typeof input.message === "string") {
      const requestedAppearance = cleanCelebrationAppearance(input.appearance, channel);
      if (requestedAppearance === null) fail(409, "effect_not_saved", "Choose a saved celebration appearance.");
      const matches = design.rules.filter(rule => rule.enabled).flatMap(ruleEffects)
        .filter(option => option.type === "celebrate" && option.message === input.message &&
          (input.appearance === undefined || JSON.stringify(option.appearance) === JSON.stringify(requestedAppearance)));
      if (matches.length === 1) effect = structuredClone(matches[0]);
      else if (matches.length > 1) fail(409, "effect_ambiguous", "Choose a specific saved celebration appearance.");
      else fail(409, "effect_not_saved", "Choose a carousel or enabled celebration from the saved design.");
    }
    else fail(409, "effect_not_saved", "Choose a carousel or enabled celebration from the saved design.");
    const inputHash = await hash(JSON.stringify(effect));
    const result = await admittedEffect(env, channel, row, `manual:${input.eventId}`, inputHash, effect, JSON.parse(row.engine_state), { now: currentTime(), fetcher });
    return json(result, result.status === "cooldown" ? 429 : 200);
  } catch (error) {
    if (error instanceof AutomationError) return json({ error: error.code, message: error.message }, error.status);
    return json({ error: "automation_unavailable", message: "Automation result could not be confirmed. Do not repeat an uncertain action with a new ID." }, 503);
  }
}

// Scheduled Get Chatters polling, not a claim that a person is watching video.
// First complete snapshot and reconnects establish a silent baseline.
import { getPresenceAuthorization, checkPresenceModeration } from './chat-authorization.mjs';
import { getShoutoutStream, mayAttemptShoutout, processShoutoutChat } from './shoutout-service.mjs';
import { validateAutomations } from '../src/automations.mjs';
const stmt = (env, sql, ...args) => env.IMAGES.prepare(sql).bind(...args);
const ID = /^[1-9][0-9]{0,19}$/;
const INTERVAL = 60000, STALE = 300000, MAX_PENDING = 60;

export async function readChatMembers(env, channel, accessToken, fetcher = fetch) {
  const members = new Set(); let cursor = '';
  for (let page = 0; page < 2; page++) {
    const url = new URL('https://api.twitch.tv/helix/chat/chatters');
    url.search = new URLSearchParams({ broadcaster_id: channel, moderator_id: channel, first: '1000', ...(cursor ? { after: cursor } : {}) });
    const response = await fetcher(url.href, { headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': env.TWITCH_CHAT_CLIENT_ID }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw Error('Chat list unavailable');
    const reader = response.body?.getReader(); if (!reader) throw Error('Chat list unavailable');
    const chunks = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 256000) { await reader.cancel(); throw Error('Chat list too large'); } chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(body.data) || body.data.length > 1000 || body.data.some(user => !ID.test(user?.user_id))) throw Error('Invalid chat list');
    for (const user of body.data) members.add(user.user_id);
    cursor = body.pagination?.cursor ?? '';
    if (typeof cursor !== 'string' || cursor.length > 2048) throw Error('Invalid chat cursor');
    if (!cursor) return [...members];
  }
  // Never replace a complete snapshot with an incomplete paginated list.
  throw Error('Chat list exceeds arrival detector capacity');
}

export function arrivalDelta(previous, members, streamId, grantId, now) {
  const baseline = !previous?.checked_at || previous.stream_id !== streamId || previous.grant_id !== grantId || now - previous.checked_at > STALE;
  if (baseline) return { pending: [], baseline: true };
  const old = new Set(JSON.parse(previous.members)), current = new Set(members);
  const pending = JSON.parse(previous.pending).filter(item => current.has(item.id) && now - item.at < STALE);
  const queued = new Set(pending.map(item => item.id));
  for (const id of members) if (!old.has(id) && !queued.has(id) && pending.length < MAX_PENDING) { pending.push({ id, at: now }); queued.add(id); }
  return { pending, baseline: false };
}

export async function pollArrivalChannel(env, channel, {
  now = Date.now(), fetcher = fetch, processInput,
  authorize = getPresenceAuthorization, moderate = checkPresenceModeration,
  stream = getShoutoutStream, members = readChatMembers,
  attempt = mayAttemptShoutout, shoutout = processShoutoutChat,
} = {}) {
  if (env.TWITCH_PRESENCE_ENABLED !== 'true' || env.AUTOMATIONS_ENABLED !== 'true' || !ID.test(channel)) return { status: 'disabled' };
  await stmt(env, 'INSERT OR IGNORE INTO shoutout_presence(channel) VALUES(?1)', channel).run();
  const lease = crypto.randomUUID();
  const claimed = await stmt(env, 'UPDATE shoutout_presence SET lease=?2,next_check=?3 WHERE channel=?1 AND next_check<=?4', channel, lease, now + INTERVAL, now).run();
  if (!claimed.meta.changes) return { status: 'busy' };
  const save = async (sql, ...args) => stmt(env, sql, channel, lease, ...args).run();
  try {
    const config = await stmt(env, 'SELECT design,engine_state,last_event_at FROM automation_configs WHERE channel=?1', channel).first();
    const rules = config ? validateAutomations(JSON.parse(config.design)).rules.filter(r => r.enabled && r.trigger.type === 'shoutout' && r.trigger.arrival === 'presence' && r.trigger.mode !== 'command') : [];
    if (!rules.length) {
      await save("UPDATE shoutout_presence SET members='[]',pending='[]',stream_id='',checked_at=0,status='disabled' WHERE channel=?1 AND lease=?2");
      return { status: 'disabled' };
    }
    const grant = await authorize(env, channel, { fetcher, now, verify: true });
    const streamId = await stream(env, channel, { fetcher, now });
    if (!streamId) {
      await save("UPDATE shoutout_presence SET members='[]',pending='[]',stream_id='',checked_at=0,status='offline' WHERE channel=?1 AND lease=?2");
      return { status: 'offline' };
    }
    const current = await members(env, channel, grant.accessToken, fetcher);
    const previous = await stmt(env, 'SELECT * FROM shoutout_presence WHERE channel=?1 AND lease=?2', channel, lease).first();
    if (!previous) return { status: 'busy' };
    const { pending, baseline } = arrivalDelta(previous, current, streamId, grant.grantId, now);
    await save('UPDATE shoutout_presence SET members=?3,pending=?4,stream_id=?5,grant_id=?6,checked_at=?7,status=?8 WHERE channel=?1 AND lease=?2', JSON.stringify(current), JSON.stringify(pending), streamId, grant.grantId, now, baseline ? 'baseline' : 'watching');
    const state = JSON.parse(config.engine_state);
    // Hold queued arrivals during an active card/rule cooldown; do not consume them.
    if (config.last_event_at > now - 8000 || rules.every(r => (state.lastFired?.[r.id] ?? -Infinity) + r.cooldownSeconds * 1000 > now)) return { status: 'cooldown' };
    for (let count = 0; pending.length && count < 8; count++) {
      const item = pending.shift();
      // Claim before effects. Failed/uncertain outbound sends must never replay.
      const owned = await save('UPDATE shoutout_presence SET pending=?3 WHERE channel=?1 AND lease=?2', JSON.stringify(pending));
      if (!owned.meta.changes) return { status: 'busy' };
      if (item.id === channel || !await attempt(env, channel, 'automatic', item.id, now)) continue;
      const admission = await moderate(env, channel, item.id, fetcher, now);
      if (!admission.allowed) continue;
      const outcome = await shoutout(env, channel, { mode: 'automatic', source: 'presence', chatterId: item.id, messageId: `arrival-${crypto.randomUUID()}` }, {
        now, fetcher, processInput,
        recheck: async () => {
          const fresh = await authorize(env, channel, { fetcher, now });
          const held = await stmt(env, 'SELECT lease FROM shoutout_presence WHERE channel=?1', channel).first();
          return fresh.grantId === grant.grantId && held?.lease === lease;
        },
      });
      if (['sent', 'uncertain', 'cooldown', 'denied'].includes(outcome?.status)) return outcome;
    }
    return { status: baseline ? 'baseline' : 'watching' };
  } catch (error) {
    if (['presence_connection_required', 'reconnect_required', 'wrong_authorization'].includes(error?.code))
      await save("UPDATE shoutout_presence SET members='[]',pending='[]',checked_at=0,stream_id='' WHERE channel=?1 AND lease=?2");
    await save("UPDATE shoutout_presence SET status='unavailable',next_check=?3 WHERE channel=?1 AND lease=?2", now + 5 * INTERVAL);
    return { status: 'unavailable' };
  }
}

export async function tickArrivals(env, options = {}) {
  if (env.TWITCH_PRESENCE_ENABLED !== 'true' || env.AUTOMATIONS_ENABLED !== 'true') return;
  const now = options.now ?? Date.now();
  await stmt(env, 'DELETE FROM shoutout_first_messages WHERE expires<=?1', now).run();
  await stmt(env, 'DELETE FROM shoutout_presence WHERE checked_at>0 AND checked_at<?1', now - 86400000).run();
  const rows = await stmt(env, `SELECT a.channel FROM automation_configs a
    JOIN chat_oauth_grants g ON g.channel=a.channel AND g.invalidated=0
    LEFT JOIN shoutout_presence p ON p.channel=a.channel
    WHERE COALESCE(p.next_check,0)<=?1 AND EXISTS(
      SELECT 1 FROM json_each(a.design,'$.rules') r WHERE json_extract(r.value,'$.enabled')=1
      AND json_extract(r.value,'$.trigger.type')='shoutout' AND json_extract(r.value,'$.trigger.arrival')='presence'
      AND json_extract(r.value,'$.trigger.mode') IN ('both','automatic'))
    ORDER BY COALESCE(p.next_check,0),a.channel LIMIT 2`, now).all();
  for (const row of rows.results) await pollArrivalChannel(env, row.channel, { ...options, now });
}

export async function getArrivalStatus(env, channel, options = {}) {
  if (env.TWITCH_PRESENCE_ENABLED !== 'true') return { available: false, authorized: false, connected: false };
  try {
    await getPresenceAuthorization(env, channel, options);
    const row = await stmt(env, 'SELECT status,checked_at FROM shoutout_presence WHERE channel=?1', channel).first();
    return { available: true, authorized: true, connected: Boolean(row && ['baseline', 'watching'].includes(row.status) && row.checked_at > (options.now ?? Date.now()) - STALE), status: row?.status ?? 'waiting', lastChecked: row?.checked_at ?? null };
  } catch { return { available: true, authorized: false, connected: false, status: 'connect_required' }; }
}

// Optional broadcaster OAuth, separate from Twitch Extension JWTs.
// Routes must verify the extension JWT before passing verifiedClaims here.
// https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow
// https://dev.twitch.tv/docs/authentication/validate-tokens/
// https://dev.twitch.tv/docs/api/reference/#get-banned-users
export const CHAT_AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS chat_oauth_states (
  channel TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  expires INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS chat_oauth_state_expiry ON chat_oauth_states(expires);
CREATE TABLE IF NOT EXISTS chat_oauth_grants (
  channel TEXT PRIMARY KEY,
  encrypted_tokens TEXT NOT NULL,
  revision TEXT NOT NULL,
  expires INTEGER NOT NULL,
  invalidated INTEGER NOT NULL DEFAULT 0,
  refresh_lock TEXT,
  refresh_until INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS chat_oauth_validation (
  channel TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  next_check INTEGER NOT NULL,
  checked_at INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS chat_oauth_validation_due ON chat_oauth_validation(next_check);
CREATE TABLE IF NOT EXISTS chat_oauth_intents (
  channel TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  trigger_access INTEGER NOT NULL,
  expires INTEGER NOT NULL
) WITHOUT ROWID;
`;
export const CHAT_MAX_CONNECTIONS = 100;
export const CHAT_VALIDATION_BATCH_LIMIT = 5;

const utf8 = new TextEncoder();
const validId = value => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const decode = text => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const SCOPE = "moderation:read";
export const TRIGGER_SCOPES = Object.freeze(["moderation:read", "user:read:chat", "user:bot", "channel:bot"]);
const STATE_TTL = 10 * 60_000;

export class ChatAuthorizationError extends Error {
  constructor(status, code, message) { super(message); this.name = "ChatAuthorizationError"; this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new ChatAuthorizationError(status, code, message); };
async function safe(operation) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof ChatAuthorizationError) throw error;
    // Never propagate provider bodies, URLs, credentials, or crypto errors.
    fail(503, "unavailable", "Chat moderation is unavailable. Please try again later.");
  }
}
function ownChannel(env, channel, origin, claims) {
  if (!validId(channel) || !env.EXTENSION_ORIGIN || origin !== env.EXTENSION_ORIGIN ||
      claims?.role !== "broadcaster" || claims.user_id !== channel || claims.channel_id !== channel)
    fail(403, "broadcaster_required", "Open this channel’s configuration as its broadcaster.");
}
function settings(env) {
  if (!/^[a-zA-Z0-9]{5,128}$/.test(env.TWITCH_CHAT_CLIENT_ID || "") ||
      !env.TWITCH_CHAT_CLIENT_SECRET || !env.EXTENSION_SECRET || !env.PUBLIC_SERVICE_URL)
    fail(503, "not_configured", "Optional chat authorization is not available yet.");
  const base = new URL(env.PUBLIC_SERVICE_URL);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/")
    fail(503, "not_configured", "Optional chat authorization is not available yet.");
  return { client: env.TWITCH_CHAT_CLIENT_ID, callback: `${base.origin}/chat/callback` };
}
const statement = (env, sql, ...args) => env.IMAGES.prepare(sql).bind(...args);
async function hash(text) { return encode(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8.encode(text)))); }
async function encryptionKey(env, channel) {
  const secret = decode(env.EXTENSION_SECRET);
  if (secret.length < 32) fail(503, "not_configured", "Optional chat authorization is not available yet.");
  const master = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name:"HKDF", hash:"SHA-256", salt:utf8.encode("scene-studio-chat-v1"),
    info:utf8.encode(`${env.TWITCH_CHAT_CLIENT_ID}:${channel}`)}, master, {name:"AES-GCM", length:256}, false, ["encrypt", "decrypt"]);
}
const aad = (env, channel) => utf8.encode(`scene-studio-chat-v1:${env.TWITCH_CHAT_CLIENT_ID}:${channel}`);
async function encrypt(env, channel, tokens) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({name:"AES-GCM", iv, additionalData:aad(env,channel)},
    await encryptionKey(env,channel), utf8.encode(JSON.stringify(tokens)));
  return `v1.${encode(iv)}.${encode(new Uint8Array(cipher))}`;
}
async function decrypt(env, row) {
  const [version, iv, cipher, extra] = row.encrypted_tokens.split(".");
  if (version !== "v1" || !iv || !cipher || extra || cipher.length > 24_000) throw new Error();
  const plain = await crypto.subtle.decrypt({name:"AES-GCM", iv:decode(iv), additionalData:aad(env,row.channel)},
    await encryptionKey(env,row.channel), decode(cipher));
  const tokens = JSON.parse(new TextDecoder().decode(plain));
  if (!validToken(tokens.access_token) || !validToken(tokens.refresh_token)) throw new Error();
  return tokens;
}
const validToken = value => typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\r\n]/.test(value);
async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 32_000) { await reader.cancel(); throw new Error(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
const call = (fetcher, url, options = {}) => fetcher(url, {...options, redirect:"manual", signal:AbortSignal.timeout(8000)});
function form(parameters) {
  return {method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:new URLSearchParams(parameters).toString()};
}
async function tokenExchange(env, parameters, fetcher) {
  const response = await call(fetcher, "https://id.twitch.tv/oauth2/token", form({
    client_id:env.TWITCH_CHAT_CLIENT_ID, client_secret:env.TWITCH_CHAT_CLIENT_SECRET, ...parameters,
  }));
  if ([400,401].includes(response.status)) fail(409,"reconnect_required","Connect chat moderation again in the extension’s configuration.");
  if (!response.ok) throw new Error();
  const tokens = await boundedJson(response);
  if (!validToken(tokens.access_token) || !validToken(tokens.refresh_token) || tokens.token_type?.toLowerCase() !== "bearer") throw new Error();
  return {access_token:tokens.access_token, refresh_token:tokens.refresh_token};
}
async function validate(env, channel, token, fetcher, required = [SCOPE]) {
  const response = await call(fetcher, "https://id.twitch.tv/oauth2/validate", {headers:{Authorization:`OAuth ${token}`}});
  if (response.status === 401) return null;
  if (!response.ok) throw new Error();
  const claims = await boundedJson(response);
  if (claims.client_id !== env.TWITCH_CHAT_CLIENT_ID || claims.user_id !== channel ||
      !Array.isArray(claims.scopes) || claims.scopes.length > 100 || claims.scopes.some(scope => typeof scope !== "string" || scope.length > 100) || !required.every(scope => claims.scopes.includes(scope)) ||
      !Number.isSafeInteger(claims.expires_in) || claims.expires_in <= 0 || claims.expires_in > 366 * 86400)
    fail(409,"wrong_authorization","Authorize the correct broadcaster account with chat moderation access.");
  return claims;
}

function beginConnect(env, channel, origin, verifiedClaims, now, triggerAccess) {
  return safe(async () => {
    ownChannel(env,channel,origin,verifiedClaims);
    if (triggerAccess && env.CHAT_TRIGGERS_ENABLED !== "true") fail(503,"not_configured","Chat keyword triggers are not enabled yet.");
    const {client,callback} = settings(env);
    // Verify encryption is usable before asking the broadcaster to consent.
    await encryptionKey(env,channel);
    const capacity = await statement(env,"SELECT count(*) AS total, coalesce(sum(channel=?1),0) AS own FROM chat_oauth_grants",channel).first();
    if (capacity.total >= CHAT_MAX_CONNECTIONS && !capacity.own)
      fail(503,"connection_limit","The free chat prototype has reached its channel limit. Please try again later.");
    const state = encode(crypto.getRandomValues(new Uint8Array(32))), expiresAt = now + STATE_TTL;
    await statement(env,"DELETE FROM chat_oauth_states WHERE expires <= ?1",now).run();
    await statement(env,`INSERT INTO chat_oauth_states(channel,state_hash,expires,consumed) VALUES(?1,?2,?3,0)
      ON CONFLICT(channel) DO UPDATE SET state_hash=excluded.state_hash,expires=excluded.expires,consumed=0`,channel,await hash(state),expiresAt).run();
    await statement(env,"DELETE FROM chat_oauth_intents WHERE expires<=?1",now).run();
    await statement(env,`INSERT INTO chat_oauth_intents(channel,state_hash,trigger_access,expires)
      SELECT channel,state_hash,?3,expires FROM chat_oauth_states WHERE channel=?1 AND state_hash=?2
      ON CONFLICT(channel) DO UPDATE SET state_hash=excluded.state_hash,trigger_access=excluded.trigger_access,expires=excluded.expires`,channel,await hash(state),triggerAccess?1:0).run();
    const url = new URL("https://id.twitch.tv/oauth2/authorize");
    url.search = new URLSearchParams({client_id:client,redirect_uri:callback,response_type:"code",scope:triggerAccess?TRIGGER_SCOPES.join(" "):SCOPE,state,force_verify:"true"}).toString();
    return {authorizeUrl:url.href,expiresAt};
  });
}

export function startConnect(env,channel,origin,verifiedClaims,now=Date.now()) {
  return beginConnect(env,channel,origin,verifiedClaims,now,false);
}
export function startTriggerConnect(env,channel,origin,verifiedClaims,now=Date.now()) {
  return beginConnect(env,channel,origin,verifiedClaims,now,true);
}

export function completeConnect(env, callbackUrl, fetcher = fetch, now = Date.now()) {
  return safe(async () => {
    const {callback} = settings(env), url = new URL(callbackUrl);
    if (url.origin + url.pathname !== callback || url.username || url.password || url.hash ||
        url.searchParams.getAll("state").length !== 1 || url.searchParams.getAll("code").length > 1 || url.searchParams.getAll("error").length > 1)
      fail(400,"invalid_callback","Start a fresh chat connection from the extension’s configuration.");
    const state = url.searchParams.get("state");
    if (!/^[A-Za-z0-9_-]{43}$/.test(state || "")) fail(400,"invalid_state","This connection request is invalid or expired. Start again.");
    const stateHash = await hash(state);
    // Consume once, retaining a tombstone until commit: disconnect or a newer
    // start removes/replaces it, so an in-flight callback cannot restore access.
    const pending = await statement(env,`UPDATE chat_oauth_states SET consumed=1
      WHERE state_hash=?1 AND expires>?2 AND consumed=0 RETURNING channel`,stateHash,now).first();
    if (!pending) fail(400,"invalid_state","This connection request is invalid or expired. Start again.");
    const intent = await statement(env,"SELECT trigger_access FROM chat_oauth_intents WHERE channel=?1 AND state_hash=?2",pending.channel,stateHash).first();
    const triggerAccess = intent?.trigger_access === 1;
    if(triggerAccess && env.CHAT_TRIGGERS_ENABLED !== "true") fail(503,"not_configured","Chat keyword triggers are not enabled yet.");
    if (url.searchParams.has("error")) fail(400,"authorization_declined","Chat authorization was not completed. You can connect again when ready.");
    const code = url.searchParams.get("code");
    if (!validToken(code)) fail(400,"invalid_callback","Start a fresh chat connection from the extension’s configuration.");
    const tokens = await tokenExchange(env,{grant_type:"authorization_code",code,redirect_uri:callback},fetcher);
    const claims = await validate(env,pending.channel,tokens.access_token,fetcher,triggerAccess?TRIGGER_SCOPES:[SCOPE]);
    if (!claims) fail(409,"reconnect_required","Twitch could not validate this connection. Please connect again.");
    const result = await statement(env,`INSERT INTO chat_oauth_grants(channel,encrypted_tokens,revision,expires,invalidated,refresh_lock,refresh_until)
      SELECT channel,?3,?4,?5,0,NULL,0 FROM chat_oauth_states WHERE channel=?1 AND state_hash=?2 AND consumed=1 AND expires>?6
      AND (EXISTS(SELECT 1 FROM chat_oauth_grants WHERE channel=?1) OR (SELECT count(*) FROM chat_oauth_grants) < ${CHAT_MAX_CONNECTIONS})
      ON CONFLICT(channel) DO UPDATE SET encrypted_tokens=excluded.encrypted_tokens,revision=excluded.revision,
      expires=excluded.expires,invalidated=0,refresh_lock=NULL,refresh_until=0`,
      pending.channel,stateHash,await encrypt(env,pending.channel,{...tokens,scopes:claims.scopes,triggerEnabled:triggerAccess,...(triggerAccess?{triggerEpoch:crypto.randomUUID()}:{})}),crypto.randomUUID(),now + claims.expires_in*1000,now).run();
    if (!result.meta.changes) {
      const capacity = await statement(env,"SELECT count(*) AS total, coalesce(sum(channel=?1),0) AS own FROM chat_oauth_grants",pending.channel).first();
      if (capacity.total >= CHAT_MAX_CONNECTIONS && !capacity.own)
        fail(503,"connection_limit","The free chat prototype has reached its channel limit. Please try again later.");
      fail(409,"connection_changed","The connection changed while authorizing. Start again if needed.");
    }
    await statement(env,"DELETE FROM chat_oauth_states WHERE channel=?1 AND state_hash=?2",pending.channel,stateHash).run();
    await statement(env,"DELETE FROM chat_oauth_intents WHERE channel=?1 AND state_hash=?2",pending.channel,stateHash).run();
    return {connected:true,channel:pending.channel,...(triggerAccess?{triggerAccess:true}:{})};
  });
}

async function loadGrant(env,channel) {
  const row = await statement(env,"SELECT * FROM chat_oauth_grants WHERE channel=?1",channel).first();
  if (!row || row.invalidated) fail(409,"reconnect_required","The streamer needs to connect chat moderation in the extension’s configuration.");
  return row;
}
async function refreshGrant(env, row, fetcher, now) {
  const lock = crypto.randomUUID();
  const acquired = await statement(env,`UPDATE chat_oauth_grants SET refresh_lock=?3,refresh_until=?4
    WHERE channel=?1 AND revision=?2 AND invalidated=0 AND refresh_until<=?5`,row.channel,row.revision,lock,now+60_000,now).run();
  if (!acquired.meta.changes) {
    const latest = await loadGrant(env,row.channel);
    if (latest.revision !== row.revision) return latest;
    fail(503,"refresh_busy","Chat moderation is reconnecting. Please try again shortly.");
  }
  try {
    const previous = await decrypt(env,row);
    const tokens = await tokenExchange(env,{grant_type:"refresh_token",refresh_token:previous.refresh_token},fetcher);
    const claims = await validate(env,row.channel,tokens.access_token,fetcher);
    if (!claims) fail(409,"reconnect_required","The streamer needs to reconnect chat moderation.");
    const result = await statement(env,`UPDATE chat_oauth_grants SET encrypted_tokens=?4,revision=?5,expires=?6,refresh_lock=NULL,refresh_until=0
      WHERE channel=?1 AND revision=?2 AND refresh_lock=?3 AND invalidated=0`,
      row.channel,row.revision,lock,await encrypt(env,row.channel,{...tokens,scopes:claims.scopes,triggerEnabled:previous.triggerEnabled===true && TRIGGER_SCOPES.every(scope=>claims.scopes.includes(scope)),...(previous.triggerEpoch?{triggerEpoch:previous.triggerEpoch}:{})}),crypto.randomUUID(),now+claims.expires_in*1000).run();
    if (!result.meta.changes) fail(409,"connection_changed","The chat connection changed. Please try again.");
    return loadGrant(env,row.channel);
  } catch (error) {
    // Confirmed invalid grants require consent. Transient failures retain the
    // encrypted grant; revision and lease guards preserve concurrent reconnects.
    if (error instanceof ChatAuthorizationError && ["reconnect_required","wrong_authorization"].includes(error.code))
      await statement(env,"UPDATE chat_oauth_grants SET invalidated=1,encrypted_tokens='' WHERE channel=?1 AND revision=?2 AND refresh_lock=?3",row.channel,row.revision,lock).run();
    throw error;
  } finally {
    await statement(env,"UPDATE chat_oauth_grants SET refresh_lock=NULL,refresh_until=0 WHERE channel=?1 AND revision=?2 AND refresh_lock=?3",row.channel,row.revision,lock).run();
  }
}

export function checkViewerModeration(env,channel,userId,fetcher = fetch,now = Date.now()) {
  return safe(async () => {
    settings(env);
    if (!validId(channel) || !validId(userId)) fail(400,"invalid_identity","A linked Twitch identity is required.");
    let row = await loadGrant(env,channel), tokens = await decrypt(env,row), refreshed = false;
    // Validate on every action, including after Worker restarts. No long-lived
    // OAuth session is exposed without a fresh validation and ban check.
    let verified;
    try { verified = await validate(env,channel,tokens.access_token,fetcher); }
    catch (error) {
      if (error instanceof ChatAuthorizationError && error.code === "wrong_authorization")
        await statement(env,"UPDATE chat_oauth_grants SET invalidated=1,encrypted_tokens='' WHERE channel=?1 AND revision=?2",channel,row.revision).run();
      throw error;
    }
    if (!verified) {
      row = await refreshGrant(env,row,fetcher,now); tokens = await decrypt(env,row); refreshed = true;
    } else if(tokens.triggerEnabled && !TRIGGER_SCOPES.every(scope=>verified.scopes.includes(scope))) {
      await statement(env,"UPDATE chat_oauth_grants SET encrypted_tokens=?3 WHERE channel=?1 AND revision=?2 AND invalidated=0",channel,row.revision,await encrypt(env,channel,{...tokens,scopes:verified.scopes,triggerEnabled:false})).run();
    }
    async function get(url) {
      let response = await call(fetcher,url,{headers:{Authorization:`Bearer ${tokens.access_token}`,"Client-Id":env.TWITCH_CHAT_CLIENT_ID}});
      if (response.status === 401 && !refreshed) {
        row = await refreshGrant(env,row,fetcher,now); tokens = await decrypt(env,row); refreshed = true;
        response = await call(fetcher,url,{headers:{Authorization:`Bearer ${tokens.access_token}`,"Client-Id":env.TWITCH_CHAT_CLIENT_ID}});
      }
      if (response.status === 401) {
        await statement(env,"UPDATE chat_oauth_grants SET invalidated=1,encrypted_tokens='' WHERE channel=?1 AND revision=?2",channel,row.revision).run();
        fail(409,"reconnect_required","The streamer needs to reconnect chat moderation.");
      }
      if (!response.ok) throw new Error();
      return boundedJson(response);
    }
    const moderation = await get(`https://api.twitch.tv/helix/moderation/banned?broadcaster_id=${channel}&user_id=${userId}`);
    if (!Array.isArray(moderation.data) || moderation.data.some(item => item?.user_id !== userId)) throw new Error();
    if (moderation.data.length) return {allowed:false,reason:moderation.data[0].expires_at ? "timed_out" : "banned"};
    const users = await get(`https://api.twitch.tv/helix/users?id=${userId}`), actor = users.data?.[0];
    if (!Array.isArray(users.data) || users.data.length !== 1 || actor?.id !== userId || !/^[a-z0-9_]{1,25}$/.test(actor.login || "")) throw new Error();
    // A disconnect/reconnect during the checks must not authorize an old session.
    const current = await loadGrant(env,channel);
    if (current.revision !== row.revision) fail(409,"connection_changed","The chat connection changed. Please try again.");
    return {allowed:true,actor:actor.login};
  });
}

export function getChatConnection(env,channel,origin,verifiedClaims) {
  return safe(async () => {
    ownChannel(env,channel,origin,verifiedClaims);
    try { settings(env); } catch { return {available:false,connected:false,reconnectRequired:false}; }
    const row = await statement(env,"SELECT invalidated FROM chat_oauth_grants WHERE channel=?1",channel).first();
    return {available:true,connected:Boolean(row && !row.invalidated),reconnectRequired:Boolean(row?.invalidated)};
  });
}

// Trusted server use only; returns no token. Old moderation-only grants stay valid
// for their original feature and never implicitly opt into chat ingestion.
export function getTriggerAuthorization(env,channel,{fetcher=fetch,now=Date.now(),verify=false}={}) {
  return safe(async()=>{
    settings(env);
    if(env.CHAT_TRIGGERS_ENABLED!=="true" || !validId(channel)) fail(409,"trigger_connection_required","Connect optional chat keyword triggers first.");
    let row=await loadGrant(env,channel),tokens=await decrypt(env,row);
    const enabled=()=>tokens.triggerEnabled===true && Array.isArray(tokens.scopes) && TRIGGER_SCOPES.every(scope=>tokens.scopes.includes(scope));
    if(!enabled()) fail(409,"trigger_connection_required","Connect optional chat keyword triggers first. Existing moderation access is unchanged.");
    if(verify) {
      if(!await validate(env,channel,tokens.access_token,fetcher,TRIGGER_SCOPES)) {
        row=await refreshGrant(env,row,fetcher,now);tokens=await decrypt(env,row);
        if(!enabled() || !await validate(env,channel,tokens.access_token,fetcher,TRIGGER_SCOPES)) fail(409,"trigger_connection_required","Reconnect optional chat keyword triggers.");
      }
      const current=await loadGrant(env,channel);
      if(current.revision!==row.revision) fail(409,"connection_changed","The chat connection changed. Try again.");
    }
    return {channel,revision:row.revision,grantId:tokens.triggerEpoch || row.revision,authorized:true};
  });
}

// Invoke once per minute from the Worker's scheduled handler. At most five
// grants are processed per call, including refreshes, to bound free-tier work.
// Persistent due times drain subsequent batches fairly across isolates. With
// the 100-connection admission cap, a full initial sweep takes at most 20 runs.
// Success is due again after 55 minutes; outages defer a retry for five minutes.
// Stored token expiry never substitutes for calling Twitch's /validate.
export function validateIdleChatGrants(env,{limit=CHAT_VALIDATION_BATCH_LIMIT,fetcher=fetch,now=Date.now()}={}) {
  return safe(async () => {
    settings(env);
    if (!Number.isInteger(limit) || limit < 1 || limit > CHAT_VALIDATION_BATCH_LIMIT || !Number.isFinite(now))
      fail(400,"invalid_batch","Choose a validation batch of one to five connections.");
    const dueSql = `FROM chat_oauth_grants g LEFT JOIN chat_oauth_validation v ON v.channel=g.channel
      WHERE g.invalidated=0 AND (v.channel IS NULL OR v.revision<>g.revision OR v.next_check<=?1)`;
    const {results:rows} = await statement(env,`SELECT g.* ${dueSql}
      ORDER BY CASE WHEN v.revision=g.revision THEN v.next_check ELSE 0 END,g.channel LIMIT ?2`,now,limit).all();
    const results = await Promise.all(rows.map(async original => {
      let row = original;
      // Claim before I/O. A concurrent run skips this revision until the retry
      // time, while a reconnect creates a different revision and is checked anew.
      const claim = await statement(env,`INSERT INTO chat_oauth_validation(channel,revision,next_check,checked_at)
        SELECT channel,revision,?3,0 FROM chat_oauth_grants WHERE channel=?1 AND revision=?2 AND invalidated=0
        ON CONFLICT(channel) DO UPDATE SET revision=excluded.revision,next_check=excluded.next_check,
        checked_at=CASE WHEN chat_oauth_validation.revision=excluded.revision THEN chat_oauth_validation.checked_at ELSE 0 END
        WHERE chat_oauth_validation.revision<>excluded.revision OR chat_oauth_validation.next_check<=?4`,
        row.channel,row.revision,now+5*60_000,now).run();
      if (!claim.meta.changes) return "deferred";
      try {
        const tokens = await decrypt(env,row);
        const verified=await validate(env,row.channel,tokens.access_token,fetcher);
        if (!verified) row = await refreshGrant(env,row,fetcher,now);
        else if(tokens.triggerEnabled && !TRIGGER_SCOPES.every(scope=>verified.scopes.includes(scope)))
          await statement(env,"UPDATE chat_oauth_grants SET encrypted_tokens=?3 WHERE channel=?1 AND revision=?2 AND invalidated=0",row.channel,row.revision,await encrypt(env,row.channel,{...tokens,scopes:verified.scopes,triggerEnabled:false})).run();
        const saved = await statement(env,`UPDATE chat_oauth_validation SET revision=?3,next_check=?4,checked_at=?5
          WHERE channel=?1 AND revision=?2 AND EXISTS(SELECT 1 FROM chat_oauth_grants WHERE channel=?1 AND revision=?3 AND invalidated=0)`,
          row.channel,original.revision,row.revision,now+55*60_000,now).run();
        return saved.meta.changes ? "valid" : "deferred";
      } catch (error) {
        if (error instanceof ChatAuthorizationError && ["reconnect_required","wrong_authorization"].includes(error.code)) {
          const removed = await statement(env,"UPDATE chat_oauth_grants SET invalidated=1,encrypted_tokens='' WHERE channel=?1 AND revision=?2",original.channel,original.revision).run();
          return removed.meta.changes ? "reconnectRequired" : "deferred";
        }
        // Unknown outcomes retain ciphertext and the five-minute retry marker.
        return "deferred";
      }
    }));
    const remaining = await statement(env,`SELECT count(*) AS total ${dueSql}`,now).first();
    return {processed:rows.length,valid:results.filter(result=>result==="valid").length,
      reconnectRequired:results.filter(result=>result==="reconnectRequired").length,
      deferred:results.filter(result=>result==="deferred").length,remainingDue:remaining.total};
  });
}

export function disconnectChat(env,channel,origin,verifiedClaims,fetcher = fetch) {
  return safe(async () => {
    ownChannel(env,channel,origin,verifiedClaims);
    await statement(env,"DELETE FROM chat_oauth_states WHERE channel=?1",channel).run();
    await statement(env,"DELETE FROM chat_oauth_intents WHERE channel=?1",channel).run();
    const row = await statement(env,"DELETE FROM chat_oauth_grants WHERE channel=?1 RETURNING *",channel).first();
    await statement(env,"DELETE FROM chat_oauth_validation WHERE channel=?1",channel).run();
    let accessRevoked = !row;
    if (row) {
      try {
        const tokens = await decrypt(env,row);
        // Twitch documents revocation of access tokens, not refresh tokens.
        // Both are removed locally; do not claim the entire OAuth grant revoked.
        const response = await call(fetcher,"https://id.twitch.tv/oauth2/revoke",form({client_id:env.TWITCH_CHAT_CLIENT_ID,token:tokens.access_token}));
        accessRevoked = response.status === 200;
      } catch { /* Local disconnect has completed even if Twitch is unavailable. */ }
    }
    return {connected:false,accessRevoked};
  });
}

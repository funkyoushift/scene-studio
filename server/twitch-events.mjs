// Optional Twitch subscription and Hype Train EventSub webhook ingestion.
// No usernames, chat/subscription messages, or event payloads are retained.
import { getActivityAuthorization, ChatAuthorizationError } from "./chat-authorization.mjs";
import { safeLiveContext } from "../src/live-context.mjs";

export const ACTIVITY_EVENTS = Object.freeze(["subscribe", "resubscribe", "gift", "hype_begin", "hype_progress", "hype_end"]);
export const ACTIVITY_SCHEMA = `
CREATE TABLE IF NOT EXISTS twitch_activity_oauth_intents (
  channel TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  activity_access INTEGER NOT NULL,
  expires INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS twitch_activity_subscriptions (
  channel TEXT NOT NULL,
  event TEXT NOT NULL,
  subscription_id TEXT NOT NULL DEFAULT '',
  grant_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  status TEXT NOT NULL,
  updated INTEGER NOT NULL,
  lock_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(channel,event)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS twitch_activity_receipts (
  channel TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY(channel,message_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS twitch_activity_receipt_time ON twitch_activity_receipts(created);
`;

const TYPES = Object.freeze({
  subscribe: {type:"channel.subscribe",version:"1"},
  resubscribe: {type:"channel.subscription.message",version:"1"},
  gift: {type:"channel.subscription.gift",version:"1"},
  hype_begin: {type:"channel.hype_train.begin",version:"2"},
  hype_progress: {type:"channel.hype_train.progress",version:"2"},
  hype_end: {type:"channel.hype_train.end",version:"2"},
});
const utf8 = new TextEncoder();
const validId = value => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);
const sql = (env,query,...args) => env.IMAGES.prepare(query).bind(...args);
const DAY = 86400000;
const emptyEvents = status => ACTIVITY_EVENTS.map(event=>({event,status,connected:false,retryRequired:false}));
export const ACTIVITY_RECEIPT_LIMIT = 100000;
export const ACTIVITY_PENDING_TTL = 120000;
const fail = (status,code,message) => { throw new ChatAuthorizationError(status,code,message); };
function configuration(env,channel,event) {
  if(env.TWITCH_ACTIVITY_ENABLED!=="true") fail(503,"not_configured","Twitch activity events are not enabled yet.");
  if(!validId(channel) || !ACTIVITY_EVENTS.includes(event) || !env.TWITCH_CHAT_CLIENT_ID || !env.TWITCH_CHAT_CLIENT_SECRET || !env.EXTENSION_SECRET)
    fail(503,"not_configured","Twitch activity events are not configured.");
  let base;try{base=new URL(env.PUBLIC_SERVICE_URL);}catch{fail(503,"not_configured","Twitch activity events are not configured.");}
  if(base.protocol!=="https:" || base.username || base.password || base.search || base.hash || base.pathname!=="/")
    fail(503,"not_configured","Twitch activity events are not configured.");
  return `${base.origin}/eventsub/activity/${channel}/${event}`;
}
async function safe(operation) {
  try{return await operation();}catch(error){if(error instanceof ChatAuthorizationError)throw error;fail(503,"activity_unavailable","Twitch activity events could not be confirmed. Check the connection before trying again.");}
}
async function rawBody(source,limit=65536) {
  const reader=source.body?.getReader();if(!reader)throw new Error("Missing body");
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail(413,"body_limit","Webhook body is too large.");}chunks.push(value);}}finally{reader.releaseLock();}
  const result=new Uint8Array(size);let at=0;for(const chunk of chunks){result.set(chunk,at);at+=chunk.byteLength;}return result;
}
async function readJson(response,limit=65536){return JSON.parse(new TextDecoder().decode(await rawBody(response,limit)));}
function response(status=204,body=null){return new Response(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Type":"text/plain; charset=utf-8"}});}
const call=(fetcher,url,options={})=>fetcher(url,{...options,redirect:"manual",signal:AbortSignal.timeout(8000)});
async function appToken(env,fetcher) {
  const result=await call(fetcher,"https://id.twitch.tv/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.TWITCH_CHAT_CLIENT_ID,client_secret:env.TWITCH_CHAT_CLIENT_SECRET,grant_type:"client_credentials"}).toString()});
  if(!result.ok)throw new Error();const value=await readJson(result);
  if(typeof value.access_token!=="string" || value.access_token.length>4096 || !value.access_token || /[\r\n]/.test(value.access_token) || value.token_type?.toLowerCase()!=="bearer")throw new Error();
  return value.access_token;
}
const providerHeaders=(env,token)=>({Authorization:`Bearer ${token}`,"Client-Id":env.TWITCH_CHAT_CLIENT_ID,"Content-Type":"application/json"});

// Separate channel/event/epoch key; the derived key itself is sent only to Twitch.
export async function deriveActivityWebhookSecret(env,channel,event,nonce) {
  if(!validId(channel) || !ACTIVITY_EVENTS.includes(event) || typeof nonce!=="string" || !/^[a-f0-9-]{36}$/.test(nonce))throw new Error();
  const raw=Uint8Array.from(atob(env.EXTENSION_SECRET),char=>char.charCodeAt(0));if(raw.length<32)throw new Error();
  const key=await crypto.subtle.importKey("raw",raw,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const material=`scene-studio-twitch-activity-v1:${env.TWITCH_CHAT_CLIENT_ID}:${channel}:${event}:${nonce}`;
  const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",key,utf8.encode(material)));
  return Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
}
export async function cleanupActivityReceipts(env,now=Date.now()) {
  await sql(env,"DELETE FROM twitch_activity_receipts WHERE created<=?1",now-DAY).run();
}

export function getActivityConnection(env,channel,{now=Date.now()}={}) {
  return safe(async()=>{
    if(env.TWITCH_ACTIVITY_ENABLED!=="true")return{available:false,connected:false,authorized:false,reconnectRequired:false,status:"unavailable",events:emptyEvents("unavailable")};
    // Validate endpoint configuration even if the account has no active grant.
    configuration(env,channel,ACTIVITY_EVENTS[0]);
    let grant;try{grant=await getActivityAuthorization(env,channel,{now});}catch(error){
      if(error instanceof ChatAuthorizationError && error.status===409)return{available:true,connected:false,authorized:false,reconnectRequired:true,status:"authorization_required",events:emptyEvents("authorization_required")};throw error;
    }
    const {results=[]}=await sql(env,"SELECT event,status,updated,grant_id FROM twitch_activity_subscriptions WHERE channel=?1 ORDER BY event",channel).all();
    if(results.length>ACTIVITY_EVENTS.length)throw new Error();
    const byEvent=new Map(results.map(row=>[row.event,row]));
    const events=ACTIVITY_EVENTS.map(event=>{const row=byEvent.get(event),current=row?.grant_id===grant.grantId;const retryRequired=Boolean(current&&row?.status==="pending"&&row.updated+ACTIVITY_PENDING_TTL<=now);return{event,status:!current?(row?"authorization_changed":"not_listening"):retryRequired?"verification_expired":row?.status||"not_listening",connected:Boolean(current&&row?.status==="enabled"),retryRequired};});
    return{available:true,connected:events.every(item=>item.connected),authorized:true,reconnectRequired:false,status:events.every(item=>item.connected)?"connected":events.some(item=>item.status==="uncertain")?"uncertain":"not_listening",events};
  });
}

async function matchingSubscriptions(env,channel,event,callback,token,fetcher) {
  const definition=TYPES[event],matches=[];let cursor="";
  for(let page=0;page<10;page++) {
    const address=new URL("https://api.twitch.tv/helix/eventsub/subscriptions");address.searchParams.set("user_id",channel);if(cursor)address.searchParams.set("after",cursor);
    const result=await call(fetcher,address.href,{headers:providerHeaders(env,token)});if(!result.ok)throw new Error();
    const value=await readJson(result,262144);if(!Array.isArray(value.data)||value.data.length>1000)throw new Error();
    for(const item of value.data)if(item.type===definition.type&&item.version===definition.version&&item.condition?.broadcaster_user_id===channel&&item.transport?.method==="webhook"&&item.transport.callback===callback) {
      if(typeof item.id!=="string"||!item.id||item.id.length>128)throw new Error();matches.push(item.id);
    }
    cursor=value.pagination?.cursor;if(!cursor)return matches;if(typeof cursor!=="string"||cursor.length>2048)throw new Error();
  }
  throw new Error("Subscription listing exceeded bound");
}
async function deleteSubscription(env,id,token,fetcher) {
  const result=await call(fetcher,`https://api.twitch.tv/helix/eventsub/subscriptions?id=${encodeURIComponent(id)}`,{method:"DELETE",headers:providerHeaders(env,token)});
  if(result.status!==204&&result.status!==404)throw new Error();
}
async function ensureOne(env,channel,event,grant,{fetcher,now}) {
  const callback=configuration(env,channel,event);
  const old=await sql(env,"SELECT * FROM twitch_activity_subscriptions WHERE channel=?1 AND event=?2",channel,event).first();
  if(old?.grant_id===grant.grantId&&(old.status==="enabled"||(old.status==="pending"&&old.updated+ACTIVITY_PENDING_TTL>now)))return;
  const nonce=crypto.randomUUID();
  const locked=await sql(env,`INSERT INTO twitch_activity_subscriptions(channel,event,subscription_id,grant_id,nonce,status,updated,lock_until)
    SELECT ?1,?2,'',?3,?4,'registering',?5,?6 WHERE (SELECT count(*) FROM twitch_activity_subscriptions)<600 OR EXISTS(SELECT 1 FROM twitch_activity_subscriptions WHERE channel=?1 AND event=?2)
    ON CONFLICT(channel,event) DO UPDATE SET subscription_id='',grant_id=excluded.grant_id,nonce=excluded.nonce,status='registering',updated=excluded.updated,lock_until=excluded.lock_until
    WHERE twitch_activity_subscriptions.lock_until<=?5 AND (twitch_activity_subscriptions.status<>'disabled' OR twitch_activity_subscriptions.updated<?5)`,channel,event,grant.grantId,nonce,now,now+60000).run();
  if(!locked.meta.changes)fail(503,"registration_busy","Twitch activity is connecting, recently disconnected, or at its channel limit. Check again shortly.");
  try {
    const token=await appToken(env,fetcher);
    for(const id of await matchingSubscriptions(env,channel,event,callback,token,fetcher))await deleteSubscription(env,id,token,fetcher);
    const current=await getActivityAuthorization(env,channel,{now});
    if(current.grantId!==grant.grantId)fail(409,"connection_changed","The Twitch activity connection changed. Try again.");
    const row=await sql(env,"SELECT nonce,status FROM twitch_activity_subscriptions WHERE channel=?1 AND event=?2",channel,event).first();
    if(row?.nonce!==nonce||row.status!=="registering")fail(409,"connection_changed","Twitch activity listening was disconnected.");
    const definition=TYPES[event];
    const result=await call(fetcher,"https://api.twitch.tv/helix/eventsub/subscriptions",{method:"POST",headers:providerHeaders(env,token),body:JSON.stringify({type:definition.type,version:definition.version,condition:{broadcaster_user_id:channel},transport:{method:"webhook",callback,secret:await deriveActivityWebhookSecret(env,channel,event,nonce)}})});
    if(result.status!==202)throw new Error();const value=await readJson(result);const subscription=value.data?.[0];
    if(!Array.isArray(value.data)||value.data.length!==1||typeof subscription.id!=="string"||!subscription.id||subscription.id.length>128||subscription.type!==definition.type||subscription.version!==definition.version||subscription.condition?.broadcaster_user_id!==channel||subscription.transport?.method!=="webhook"||subscription.transport.callback!==callback)throw new Error();
    const saved=await sql(env,`UPDATE twitch_activity_subscriptions SET subscription_id=?4,status=CASE WHEN status='enabled' THEN 'enabled' ELSE 'pending' END,lock_until=0
      WHERE channel=?1 AND event=?2 AND nonce=?3 AND status IN ('registering','enabled')`,channel,event,nonce,subscription.id).run();
    if(!saved.meta.changes){await deleteSubscription(env,subscription.id,token,fetcher);fail(409,"connection_changed","Twitch activity listening changed while connecting.");}
  }catch(error){
    await sql(env,"UPDATE twitch_activity_subscriptions SET status='uncertain',lock_until=0 WHERE channel=?1 AND event=?2 AND nonce=?3 AND status='registering'",channel,event,nonce).run();
    throw error;
  }
}
export function ensureActivitySubscriptions(env,channel,{fetcher=fetch,now=Date.now()}={}) {
  return safe(async()=>{
    configuration(env,channel,ACTIVITY_EVENTS[0]);
    const grant=await getActivityAuthorization(env,channel,{fetcher,now,verify:true});
    // Disconnected chat grants cannot authorize activity delivery. Reclaim
    // their bounded listener rows before admitting this channel's six slots.
    await sql(env,"DELETE FROM twitch_activity_subscriptions WHERE channel NOT IN (SELECT channel FROM chat_oauth_grants)").run();
    for(const event of ACTIVITY_EVENTS)await ensureOne(env,channel,event,grant,{fetcher,now});
    return getActivityConnection(env,channel,{now});
  });
}

export function disconnectActivitySubscriptions(env,channel,{fetcher=fetch,now=Date.now()}={}) {
  return safe(async()=>{
    if(!validId(channel))fail(400,"invalid_channel","Choose a channel.");
    const prior=await sql(env,"SELECT event,subscription_id,status FROM twitch_activity_subscriptions WHERE channel=?1",channel).all();
    const existing=new Map((prior.results||[]).map(row=>[row.event,row]));
    // Tombstones invalidate registrations already in flight and prevent an old
    // ensure call from recreating listeners after a concurrent disconnect.
    for(const event of ACTIVITY_EVENTS)await sql(env,`INSERT INTO twitch_activity_subscriptions(channel,event,subscription_id,grant_id,nonce,status,updated,lock_until)
      SELECT ?1,?2,'','','','disabled',?3,0 WHERE (SELECT count(*) FROM twitch_activity_subscriptions)<600 OR EXISTS(SELECT 1 FROM twitch_activity_subscriptions WHERE channel=?1 AND event=?2)
      ON CONFLICT(channel,event) DO UPDATE SET subscription_id='',nonce=?4,status='disabled',updated=?5,lock_until=0`,channel,event,now,crypto.randomUUID(),now).run();
    let subscriptionRemoved=existing.size===0;
    if(existing.size)try {
      const token=await appToken(env,fetcher);subscriptionRemoved=true;
      for(const event of ACTIVITY_EVENTS) {
        const row=existing.get(event);if(row?.subscription_id)await deleteSubscription(env,row.subscription_id,token,fetcher);
        for(const id of await matchingSubscriptions(env,channel,event,configuration(env,channel,event),token,fetcher))await deleteSubscription(env,id,token,fetcher);
      }
    }catch{subscriptionRemoved=false;}
    return{connected:false,subscriptionRemoved};
  });
}

export async function handleActivityWebhook(request,env,channel,event,{processInput,waitUntil,fetcher=fetch,now=Date.now(),clock=Date.now}={}) {
  const startedAt=clock(),currentTime=()=>now+Math.max(0,clock()-startedAt);
  try {
    const callback=configuration(env,channel,event),definition=TYPES[event];
    if(request.method!=="POST")return response(405,"POST required.");
    const url=new URL(request.url);if(url.origin+url.pathname!==callback||url.username||url.password||url.search||url.hash)return response(403,"Invalid callback.");
    if(!/^application\/json(?:;|$)/i.test(request.headers.get("content-type")||""))return response(415,"JSON required.");
    const row=await sql(env,"SELECT * FROM twitch_activity_subscriptions WHERE channel=?1 AND event=?2",channel,event).first();
    if(!row||!["registering","pending","enabled"].includes(row.status))return response(410,"Listener is inactive.");
    const messageId=request.headers.get("twitch-eventsub-message-id"),timestamp=request.headers.get("twitch-eventsub-message-timestamp"),signature=request.headers.get("twitch-eventsub-message-signature"),kind=request.headers.get("twitch-eventsub-message-type");
    const sentAt=Date.parse(timestamp||"");
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(messageId||"")||!timestamp||timestamp.length>64||!Number.isFinite(sentAt)||Math.abs(now-sentAt)>600000||!/^sha256=[a-f0-9]{64}$/.test(signature||""))return response(403,"Invalid signature or age.");
    if(request.headers.get("twitch-eventsub-subscription-type")!==definition.type||request.headers.get("twitch-eventsub-subscription-version")!==definition.version)return response(400,"Unsupported subscription.");
    const raw=await rawBody(request);const prefix=utf8.encode(messageId+timestamp),signed=new Uint8Array(prefix.length+raw.length);signed.set(prefix);signed.set(raw,prefix.length);
    const secret=await deriveActivityWebhookSecret(env,channel,event,row.nonce),key=await crypto.subtle.importKey("raw",utf8.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
    const signatureBytes=Uint8Array.from(signature.slice(7).match(/../g),pair=>parseInt(pair,16));
    if(!await crypto.subtle.verify("HMAC",key,signatureBytes,signed))return response(403,"Invalid signature.");
    let body;try{body=JSON.parse(new TextDecoder().decode(raw));}catch{return response(400,"Invalid JSON.");}
    const subscription=body?.subscription;
    if(subscription?.type!==definition.type||subscription.version!==definition.version||subscription.condition?.broadcaster_user_id!==channel||subscription.transport?.method!=="webhook"||subscription.transport.callback!==callback||typeof subscription.id!=="string"||!subscription.id||subscription.id.length>128)return response(403,"Subscription mismatch.");
    if(row.subscription_id&&row.subscription_id!==subscription.id)return response(403,"Subscription mismatch.");
    if(kind==="revocation") {
      await sql(env,"UPDATE twitch_activity_subscriptions SET status='revoked',lock_until=0,updated=?4 WHERE channel=?1 AND event=?2 AND nonce=?3",channel,event,row.nonce,now).run();return response();
    }
    let grant;try{grant=await getActivityAuthorization(env,channel,{now});}catch{return response(410,"Authorization is inactive.");}
    if(grant.grantId!==row.grant_id)return response(410,"Authorization changed.");
    if(kind==="webhook_callback_verification") {
      if(typeof body.challenge!=="string"||!body.challenge||body.challenge.length>4096)return response(400,"Invalid challenge.");
      const activated=await sql(env,`UPDATE twitch_activity_subscriptions SET subscription_id=?4,status='enabled',lock_until=0,updated=?5
        WHERE channel=?1 AND event=?2 AND nonce=?3 AND status IN ('registering','pending','enabled')`,channel,event,row.nonce,subscription.id,now).run();
      return activated.meta.changes?response(200,body.challenge):response(410,"Listener changed.");
    }
    if(kind!=="notification"||row.status!=="enabled")return response(400,"Listener is not ready.");
    const incoming=body.event;
    if(incoming?.broadcaster_user_id!==channel)return response(400,"Invalid activity event.");
    // channel.subscribe also reports gifts; channel.subscription.gift is the
    // canonical gift trigger, so ignore this copy to avoid double firing.
    if(event==="subscribe"&&incoming.is_gift===true) {
      await cleanupActivityReceipts(env,now);
      const admitted=await sql(env,`INSERT OR IGNORE INTO twitch_activity_receipts(channel,message_id,created,status)
        SELECT ?1,?2,?3,'ignored' WHERE (SELECT count(*) FROM twitch_activity_receipts)<?4`,channel,messageId,now,ACTIVITY_RECEIPT_LIMIT).run();
      if(!admitted.meta.changes){const duplicate=await sql(env,"SELECT status FROM twitch_activity_receipts WHERE channel=?1 AND message_id=?2",channel,messageId).first();return duplicate?response():response(503,"Listener receipt capacity reached.");}
      return response();
    }
    if(typeof processInput!=="function")return response(503,"Listener processing is unavailable.");
    await cleanupActivityReceipts(env,now);
    const admitted=await sql(env,`INSERT OR IGNORE INTO twitch_activity_receipts(channel,message_id,created,status)
      SELECT ?1,?2,?3,'pending' WHERE (SELECT count(*) FROM twitch_activity_receipts)<?4`,channel,messageId,now,ACTIVITY_RECEIPT_LIMIT).run();
    if(!admitted.meta.changes){const duplicate=await sql(env,"SELECT status FROM twitch_activity_receipts WHERE channel=?1 AND message_id=?2",channel,messageId).first();return duplicate?response():response(503,"Listener receipt capacity reached.");}
    const work=(async()=>{
      let status="uncertain";
      try {
        const fresh=await getActivityAuthorization(env,channel,{now:currentTime()});
        const current=await sql(env,"SELECT nonce,status,grant_id FROM twitch_activity_subscriptions WHERE channel=?1 AND event=?2",channel,event).first();
        if(fresh.grantId===grant.grantId&&current?.nonce===row.nonce&&current.status==="enabled"&&current.grant_id===grant.grantId) {
          const context=safeLiveContext({ ...(["subscribe","resubscribe","gift"].includes(event)&&!incoming.is_anonymous?{subscriber:incoming.user_name}:{}), ...(event.startsWith("hype_")?{hypeLevel:incoming.level}:{}) });
          // Only nonpersonal, bounded train fields cross into lifecycle storage.
          // The verified message timestamp and ID order provider snapshots.
          const hype=event.startsWith("hype_")?{
            id:incoming.id, level:incoming.level,
            total:incoming.total, progress:incoming.progress, goal:incoming.goal,
            expiresAt:incoming.expires_at, startedAt:incoming.started_at, sentAt,
          }:undefined;
          const outcome=await processInput(env,channel,{type:"twitch",event,id:messageId,...(Object.keys(context).length?{context}:{}),...(hype?{hype}:{})},{now:currentTime(),fetcher});
          status=["sent","uncertain","cooldown","no_match"].includes(outcome?.status)?outcome.status:"uncertain";
        } else status="denied";
      }catch{status="uncertain";} // A notification retry never repeats an uncertain automation effect.
      await sql(env,"UPDATE twitch_activity_receipts SET status=?3 WHERE channel=?1 AND message_id=?2",channel,messageId,status).run();
    })();
    if(waitUntil)waitUntil(work);else await work;
    return response();
  }catch(error){return response(error instanceof ChatAuthorizationError?error.status:503,"Twitch activity request could not be accepted.");}
}

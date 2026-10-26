// Twitch EventSub webhook chat ingestion. No chat text is written to storage.
// https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchatmessage
// https://dev.twitch.tv/docs/eventsub/handling-webhook-events/
import { getTriggerAuthorization, checkViewerModeration, ChatAuthorizationError } from "./chat-authorization.mjs";
import { parseShoutoutCommand, trustedShoutoutActor, mayAttemptShoutout, processShoutoutChat } from "./shoutout-service.mjs";

const utf8 = new TextEncoder();
const validId = value => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);
const sql = (env, query, ...args) => env.IMAGES.prepare(query).bind(...args);
const call = (fetcher,url,options={}) => fetcher(url,{...options,redirect:"manual",signal:AbortSignal.timeout(8000)});
export const CHAT_TRIGGER_RECEIPT_LIMIT = 100000;
export const CHAT_TRIGGER_PENDING_TTL = 120000;
const DAY = 86400000;
const fail = (status,code,message) => { throw new ChatAuthorizationError(status,code,message); };
function configuration(env,channel) {
  if(env.CHAT_TRIGGERS_ENABLED!=="true") fail(503,"not_configured","Chat keyword triggers are not enabled yet.");
  if(!validId(channel) || !env.TWITCH_CHAT_CLIENT_ID || !env.TWITCH_CHAT_CLIENT_SECRET || !env.EXTENSION_SECRET) fail(503,"not_configured","Chat keyword triggers are not configured.");
  let base;try{base=new URL(env.PUBLIC_SERVICE_URL);}catch{fail(503,"not_configured","Chat keyword triggers are not configured.");}
  if(base.protocol!=="https:" || base.username || base.password || base.search || base.hash || base.pathname!=="/") fail(503,"not_configured","Chat keyword triggers are not configured.");
  return `${base.origin}/eventsub/chat/${channel}`;
}
async function safe(operation) {
  try{return await operation();}catch(error){if(error instanceof ChatAuthorizationError)throw error;fail(503,"trigger_unavailable","The chat listener could not be confirmed. Check its connection before trying again.");}
}
async function rawBody(source,limit=65536) {
  const reader=source.body?.getReader();if(!reader)throw new Error("Missing body");
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail(413,"body_limit","Webhook body is too large.");}chunks.push(value);}}finally{reader.releaseLock();}
  const result=new Uint8Array(size);let at=0;for(const chunk of chunks){result.set(chunk,at);at+=chunk.byteLength;}return result;
}
async function readJson(response,limit=65536){return JSON.parse(new TextDecoder().decode(await rawBody(response,limit)));}
function response(status=204,body=null){return new Response(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Type":"text/plain; charset=utf-8"}});}
async function appToken(env,fetcher) {
  const result=await call(fetcher,"https://id.twitch.tv/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.TWITCH_CHAT_CLIENT_ID,client_secret:env.TWITCH_CHAT_CLIENT_SECRET,grant_type:"client_credentials"}).toString()});
  if(!result.ok)throw new Error();const value=await readJson(result);
  if(typeof value.access_token!=="string" || value.access_token.length>4096 || !value.access_token || /[\r\n]/.test(value.access_token) || value.token_type?.toLowerCase()!=="bearer")throw new Error();
  return value.access_token;
}
const providerHeaders=(env,token)=>({Authorization:`Bearer ${token}`,"Client-Id":env.TWITCH_CHAT_CLIENT_ID,"Content-Type":"application/json"});

// The secret is derived for this channel and registration epoch. It is sent
// only to Twitch's subscription endpoint, never to the browser or a log.
export async function deriveChatWebhookSecret(env,channel,nonce) {
  if(!validId(channel) || typeof nonce!=="string" || !/^[a-f0-9-]{36}$/.test(nonce))throw new Error();
  const raw=Uint8Array.from(atob(env.EXTENSION_SECRET),char=>char.charCodeAt(0));if(raw.length<32)throw new Error();
  const key=await crypto.subtle.importKey("raw",raw,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",key,utf8.encode(`scene-studio-chat-webhook-v1:${env.TWITCH_CHAT_CLIENT_ID}:${channel}:${nonce}`)));
  return Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
}

export async function cleanupChatTriggerReceipts(env,now=Date.now()) {
  await sql(env,"DELETE FROM chat_trigger_receipts WHERE created<=?1",now-DAY).run();
}
export function getTriggerConnection(env,channel,{now=Date.now()}={}) {
  return safe(async()=>{
    if(env.CHAT_TRIGGERS_ENABLED!=="true")return{available:false,connected:false,authorized:false,reconnectRequired:false,status:"unavailable"};
    configuration(env,channel);
    let grant;try{grant=await getTriggerAuthorization(env,channel,{now});}catch(error){
      if(error instanceof ChatAuthorizationError && error.status===409)return{available:true,connected:false,authorized:false,reconnectRequired:true,status:"authorization_required"};throw error;
    }
    const row=await sql(env,"SELECT * FROM chat_trigger_subscriptions WHERE channel=?1",channel).first();
    const current=row?.grant_id===grant.grantId;
    const retryRequired=Boolean(current&&row.status==="pending"&&row.updated+CHAT_TRIGGER_PENDING_TTL<=now);
    return{available:true,connected:Boolean(current&&row.status==="enabled"),authorized:true,reconnectRequired:false,retryRequired,status:retryRequired?"verification_expired":current?row.status:"not_listening"};
  });
}

async function matchingSubscriptions(env,channel,callback,token,fetcher) {
  const matches=[];let cursor="";
  for(let page=0;page<10;page++) {
    const address=new URL("https://api.twitch.tv/helix/eventsub/subscriptions");address.searchParams.set("user_id",channel);if(cursor)address.searchParams.set("after",cursor);
    const result=await call(fetcher,address.href,{headers:providerHeaders(env,token)});if(!result.ok)throw new Error();
    const value=await readJson(result,262144);if(!Array.isArray(value.data)||value.data.length>1000)throw new Error();
    for(const item of value.data)if(item.type==="channel.chat.message"&&item.version==="1"&&item.condition?.broadcaster_user_id===channel&&item.condition?.user_id===channel&&item.transport?.method==="webhook"&&item.transport.callback===callback) {
      if(typeof item.id!=="string" || item.id.length>128)throw new Error();matches.push(item.id);
    }
    cursor=value.pagination?.cursor;if(!cursor)return matches;if(typeof cursor!=="string"||cursor.length>2048)throw new Error();
  }
  throw new Error("Subscription listing exceeded bound");
}
async function deleteSubscription(env,id,token,fetcher) {
  const result=await call(fetcher,`https://api.twitch.tv/helix/eventsub/subscriptions?id=${encodeURIComponent(id)}`,{method:"DELETE",headers:providerHeaders(env,token)});
  if(result.status!==204&&result.status!==404)throw new Error();
}
export function ensureTriggerSubscription(env,channel,{fetcher=fetch,now=Date.now()}={}) {
  return safe(async()=>{
    const callback=configuration(env,channel);
    const grant=await getTriggerAuthorization(env,channel,{fetcher,now,verify:true});
    const old=await sql(env,"SELECT * FROM chat_trigger_subscriptions WHERE channel=?1",channel).first();
    // Do not churn a new registration while Twitch is challenging it. A lost
    // challenge must eventually be recoverable without requesting OAuth again.
    if(old?.grant_id===grant.grantId&&(old.status==="enabled"||(old.status==="pending"&&old.updated+CHAT_TRIGGER_PENDING_TTL>now)))return getTriggerConnection(env,channel,{now});
    const nonce=crypto.randomUUID();
    const locked=await sql(env,`INSERT INTO chat_trigger_subscriptions(channel,subscription_id,grant_id,nonce,status,updated,lock_until)
      SELECT ?1,'',?2,?3,'registering',?4,?5 WHERE (SELECT count(*) FROM chat_trigger_subscriptions)<100 OR EXISTS(SELECT 1 FROM chat_trigger_subscriptions WHERE channel=?1)
      ON CONFLICT(channel) DO UPDATE SET subscription_id='',grant_id=excluded.grant_id,nonce=excluded.nonce,status='registering',updated=excluded.updated,lock_until=excluded.lock_until
      WHERE chat_trigger_subscriptions.lock_until<=?4`,channel,grant.grantId,nonce,now,now+60000).run();
    if(!locked.meta.changes)fail(503,"registration_busy","The chat listener is connecting or has reached its channel limit. Check again shortly.");
    try {
      const token=await appToken(env,fetcher);
      // Reconcile an uncertain earlier POST before creating anything new.
      for(const id of await matchingSubscriptions(env,channel,callback,token,fetcher))await deleteSubscription(env,id,token,fetcher);
      const current=await getTriggerAuthorization(env,channel,{now});
      if(current.grantId!==grant.grantId)fail(409,"connection_changed","The chat connection changed. Try again.");
      const row=await sql(env,"SELECT nonce,status FROM chat_trigger_subscriptions WHERE channel=?1",channel).first();
      if(row?.nonce!==nonce||row.status!=="registering")fail(409,"connection_changed","The chat listener was disconnected.");
      const result=await call(fetcher,"https://api.twitch.tv/helix/eventsub/subscriptions",{method:"POST",headers:providerHeaders(env,token),body:JSON.stringify({type:"channel.chat.message",version:"1",condition:{broadcaster_user_id:channel,user_id:channel},transport:{method:"webhook",callback,secret:await deriveChatWebhookSecret(env,channel,nonce)}})});
      if(result.status!==202)throw new Error();const value=await readJson(result);const subscription=value.data?.[0];
      if(!Array.isArray(value.data)||value.data.length!==1||typeof subscription.id!=="string"||!subscription.id||subscription.id.length>128||subscription.type!=="channel.chat.message"||subscription.version!=="1"||subscription.condition?.broadcaster_user_id!==channel||subscription.condition?.user_id!==channel||subscription.transport?.method!=="webhook"||subscription.transport.callback!==callback)throw new Error();
      const saved=await sql(env,`UPDATE chat_trigger_subscriptions SET subscription_id=?3,status=CASE WHEN status='enabled' THEN 'enabled' ELSE 'pending' END,lock_until=0
        WHERE channel=?1 AND nonce=?2 AND status IN ('registering','enabled')`,channel,nonce,subscription.id).run();
      if(!saved.meta.changes){await deleteSubscription(env,subscription.id,token,fetcher);fail(409,"connection_changed","The chat listener was disconnected while connecting.");}
      return getTriggerConnection(env,channel,{now});
    } catch(error) {
      await sql(env,"UPDATE chat_trigger_subscriptions SET status='uncertain',lock_until=0 WHERE channel=?1 AND nonce=?2 AND status='registering'",channel,nonce).run();
      throw error;
    }
  });
}

export function disconnectTriggerSubscription(env,channel,{fetcher=fetch,now=Date.now()}={}) {
  return safe(async()=>{
    if(!validId(channel))fail(400,"invalid_channel","Choose a channel.");
    const row=await sql(env,"SELECT * FROM chat_trigger_subscriptions WHERE channel=?1",channel).first();
    await sql(env,"UPDATE chat_trigger_subscriptions SET status='disabled',nonce=?2,lock_until=0,updated=?3 WHERE channel=?1",channel,crypto.randomUUID(),now).run();
    let subscriptionRemoved=!row;
    if(row)try {
      const token=await appToken(env,fetcher);
      if(row.subscription_id)await deleteSubscription(env,row.subscription_id,token,fetcher);
      // Includes a POST whose provider response was lost before its ID was saved.
      const base=new URL(env.PUBLIC_SERVICE_URL);
      for(const id of await matchingSubscriptions(env,channel,`${base.origin}/eventsub/chat/${channel}`,token,fetcher))await deleteSubscription(env,id,token,fetcher);
      subscriptionRemoved=true;
    }catch{ /* Local disabling takes effect even if provider cleanup fails. */ }
    return{connected:false,subscriptionRemoved};
  });
}

export async function handleChatWebhook(request,env,channel,{processInput,hasMatchingKeywordRule,hasShoutoutCandidate,processShoutout=processShoutoutChat,waitUntil,fetcher=fetch,now=Date.now(),clock=Date.now}={}) {
  const startedAt=clock(),currentTime=()=>now+Math.max(0,clock()-startedAt);
  try {
    const callback=configuration(env,channel);
    if(request.method!=="POST")return response(405,"POST required.");
    const url=new URL(request.url);if(url.origin+url.pathname!==callback||url.search) return response(403,"Invalid callback.");
    if(!/^application\/json(?:;|$)/i.test(request.headers.get("content-type")||""))return response(415,"JSON required.");
    const row=await sql(env,"SELECT * FROM chat_trigger_subscriptions WHERE channel=?1",channel).first();
    if(!row||!["registering","pending","enabled"].includes(row.status))return response(410,"Listener is inactive.");
    const messageId=request.headers.get("twitch-eventsub-message-id"),timestamp=request.headers.get("twitch-eventsub-message-timestamp"),signature=request.headers.get("twitch-eventsub-message-signature"),kind=request.headers.get("twitch-eventsub-message-type");
    const sentAt=Date.parse(timestamp||"");
    if(!messageId||messageId.length>256||!timestamp||timestamp.length>64||!Number.isFinite(sentAt)||Math.abs(now-sentAt)>600000||!/^sha256=[a-f0-9]{64}$/.test(signature||""))return response(403,"Invalid signature or age.");
    if(request.headers.get("twitch-eventsub-subscription-type")!=="channel.chat.message"||request.headers.get("twitch-eventsub-subscription-version")!=="1")return response(400,"Unsupported subscription.");
    const raw=await rawBody(request);const prefix=utf8.encode(messageId+timestamp),signed=new Uint8Array(prefix.length+raw.length);signed.set(prefix);signed.set(raw,prefix.length);
    const secret=await deriveChatWebhookSecret(env,channel,row.nonce),key=await crypto.subtle.importKey("raw",utf8.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
    const signatureBytes=Uint8Array.from(signature.slice(7).match(/../g),pair=>parseInt(pair,16));
    if(!await crypto.subtle.verify("HMAC",key,signatureBytes,signed))return response(403,"Invalid signature.");
    let body;try{body=JSON.parse(new TextDecoder().decode(raw));}catch{return response(400,"Invalid JSON.");}
    const subscription=body?.subscription;
    if(subscription?.type!=="channel.chat.message"||subscription.version!=="1"||subscription.condition?.broadcaster_user_id!==channel||subscription.condition?.user_id!==channel||subscription.transport?.method!=="webhook"||subscription.transport.callback!==callback||typeof subscription.id!=="string"||!subscription.id||subscription.id.length>128)return response(403,"Subscription mismatch.");
    if(row.subscription_id&&row.subscription_id!==subscription.id)return response(403,"Subscription mismatch.");
    if(kind==="revocation") {
      await sql(env,"UPDATE chat_trigger_subscriptions SET status='revoked',lock_until=0,updated=?3 WHERE channel=?1 AND nonce=?2",channel,row.nonce,now).run();return response();
    }
    let grant;try{grant=await getTriggerAuthorization(env,channel,{now});}catch{return response(410,"Authorization is inactive.");}
    if(grant.grantId!==row.grant_id)return response(410,"Authorization changed.");
    if(kind==="webhook_callback_verification") {
      if(typeof body.challenge!=="string"||!body.challenge||body.challenge.length>4096)return response(400,"Invalid challenge.");
      const activated=await sql(env,"UPDATE chat_trigger_subscriptions SET subscription_id=?3,status='enabled',lock_until=0,updated=?4 WHERE channel=?1 AND nonce=?2 AND status IN ('registering','pending','enabled')",channel,row.nonce,subscription.id,now).run();
      return activated.meta.changes?response(200,body.challenge):response(410,"Listener changed.");
    }
    if(kind!=="notification"||row.status!=="enabled")return response(400,"Listener is not ready.");
    const event=body.event;
    if(event?.broadcaster_user_id!==channel||!validId(event.chatter_user_id)||typeof event.message_id!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(event.message_id)||typeof event.message?.text!=="string"||event.message.text.length>2000)return response(400,"Invalid chat event.");
    // Shared-chat messages originating elsewhere must not trigger this channel.
    if(event.source_broadcaster_user_id&&event.source_broadcaster_user_id!==channel)return response();
    if(typeof processInput!=="function"||typeof hasMatchingKeywordRule!=="function")return response(503,"Listener processing is unavailable.");
    await cleanupChatTriggerReceipts(env,now);
    const admitted=await sql(env,`INSERT OR IGNORE INTO chat_trigger_receipts(channel,message_id,created,status)
      SELECT ?1,?2,?3,'pending' WHERE (SELECT count(*) FROM chat_trigger_receipts)<?4`,channel,event.message_id,now,CHAT_TRIGGER_RECEIPT_LIMIT).run();
    if(!admitted.meta.changes){const duplicate=await sql(env,"SELECT status FROM chat_trigger_receipts WHERE channel=?1 AND message_id=?2",channel,event.message_id).first();return duplicate?response():response(503,"Listener receipt capacity reached.");}
    const work=(async()=>{
      let status="ignored";
      try {
        const commandTarget=parseShoutoutCommand(event.message.text);
        const commandAllowed=Boolean(commandTarget&&trustedShoutoutActor(event,channel));
        const mode=commandTarget?(commandAllowed?"command":null):"automatic";
        const chatterLogin=typeof event.chatter_user_login==="string"&&/^[a-z0-9_]{1,25}$/i.test(event.chatter_user_login)
          ?event.chatter_user_login.toLowerCase():null;
        const shoutoutCandidate=Boolean(mode&&typeof hasShoutoutCandidate==="function"&&
          await hasShoutoutCandidate(env,channel,mode,mode==="command"?commandTarget:chatterLogin)&&
          await mayAttemptShoutout(env,channel,mode,event.chatter_user_id,currentTime()));
        const keywordCandidate=await hasMatchingKeywordRule(env,channel,event.message.text);
        if(shoutoutCandidate||keywordCandidate) {
          const moderation=await checkViewerModeration(env,channel,event.chatter_user_id,fetcher,currentTime());
          const fresh=await getTriggerAuthorization(env,channel,{now:currentTime()});
          const current=await sql(env,"SELECT nonce,status FROM chat_trigger_subscriptions WHERE channel=?1",channel).first();
          if(moderation.allowed&&fresh.grantId===grant.grantId&&current?.nonce===row.nonce&&current.status==="enabled") {
            if(shoutoutCandidate) {
              const outcome=await processShoutout(env,channel,{mode,messageId:event.message_id,
                chatterId:event.chatter_user_id,targetLogin:commandTarget},{now:currentTime(),fetcher,processInput,
                recheck:async()=>{
                  try {
                    const check=await getTriggerAuthorization(env,channel,{now:currentTime()});
                    const live=await sql(env,"SELECT nonce,status FROM chat_trigger_subscriptions WHERE channel=?1",channel).first();
                    return check.grantId===grant.grantId&&live?.nonce===row.nonce&&live.status==="enabled";
                  }catch{return false;}
                }});
              if(["sent","uncertain","cooldown","denied"].includes(outcome?.status))status=outcome.status;
            }
            if(keywordCandidate&&status==="ignored") {
              const outcome=await processInput(env,channel,{type:"message",text:event.message.text,id:event.message_id},{now:currentTime(),fetcher});
              status=["sent","uncertain","cooldown","no_match"].includes(outcome?.status)?outcome.status:"uncertain";
            }
          } else status="denied";
        }
      }catch{status="uncertain";} // Never replay uncertain side effects automatically.
      await sql(env,"UPDATE chat_trigger_receipts SET status=?3 WHERE channel=?1 AND message_id=?2",channel,event.message_id,status).run();
    })();
    if(waitUntil)waitUntil(work);else await work;
    return response();
  }catch(error){return response(error instanceof ChatAuthorizationError?error.status:503,"Chat listener request could not be accepted.");}
}

import { PARTY_PRESETS } from "../src/party.mjs";
import { parseScene } from "../src/scene.mjs";
import { checkViewerModeration, ChatAuthorizationError } from "./chat-authorization.mjs";

const encoder = new TextEncoder();
const decode = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const encodedJson = value => encode(encoder.encode(JSON.stringify(value)));
export const MAX_PARTY_ATTEMPTS = 10000;
class PartyError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new PartyError(status, message); };

export async function verifyPartyViewer(request, secret, channel, now) {
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
    if (!token || token.length > 8192 || !secret) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 3 || JSON.parse(new TextDecoder().decode(decode(parts[0]))).alg !== "HS256") throw new Error();
    const key = await crypto.subtle.importKey("raw", decode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC",key,decode(parts[2]),encoder.encode(parts.slice(0,2).join(".")))) throw new Error();
    const c = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    if (!["viewer","moderator","broadcaster"].includes(c.role) || c.channel_id !== channel ||
      !/^[1-9][0-9]{0,19}$/.test(c.user_id) || !Number.isFinite(c.exp) || c.exp <= Math.floor(now/1000) ||
      (c.nbf !== undefined && (!Number.isFinite(c.nbf) || c.nbf > Math.floor(now/1000)))) throw new Error();
    return c;
  } catch { fail(401,"Link your Twitch identity to join the celebration."); }
}

export async function signPartyToken(env, channel, now) {
  const body = {role:"external",user_id:env.EXTENSION_OWNER,channel_id:channel,exp:Math.floor(now/1000)+60,pubsub_perms:{send:["broadcast"]}};
  const input = encodedJson({alg:"HS256",typ:"JWT"})+"."+encodedJson(body);
  const key = await crypto.subtle.importKey("raw",decode(env.EXTENSION_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return input+"."+encode(new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(input))));
}

async function smallJson(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) fail(400,"Missing request.");
  let size=0; const chunks=[];
  while(true) { const {done,value}=await reader.read(); if(done)break; size+=value.length;
    if(size>limit){await reader.cancel();fail(413,"Request too large.");} chunks.push(value); }
  const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,"Invalid request.");}
}

async function claimAttempt(env,channel,userId,now) {
  // Rejected viewers throttle only themselves. These short-lived entries are
  // not action receipts and never reserve the channel's shared celebration slot.
  await env.IMAGES.prepare("DELETE FROM party_attempts WHERE expires<=?1").bind(now).run();
  const insert=await env.IMAGES.prepare(`INSERT OR IGNORE INTO party_attempts(channel,user_id,expires)
    SELECT ?1,?2,?3 WHERE (SELECT count(*) FROM party_attempts)<?4`).bind(channel,userId,now+20000,MAX_PARTY_ATTEMPTS).run();
  if(insert.meta.changes) return;
  const own=await env.IMAGES.prepare("SELECT expires FROM party_attempts WHERE channel=?1 AND user_id=?2").bind(channel,userId).first();
  if(own?.expires>now) fail(429,"Let the confetti settle—wait 20 seconds before trying again.");
  fail(503,"Celebrations are busy. Please try again shortly.");
}

// Only the two named test identities can trigger shared chat until moderation
// integration is qualified. This is intentionally not an all-viewer release.
export async function partyRequest(request,env,channel,json,fetcher=fetch,now=Date.now()) {
  let eventId, admitted=false, stage="admission";
  const startedAt=Date.now(), currentTime=()=>now+Math.max(0,Date.now()-startedAt);
  try {
    if(request.method!=="POST") return json({error:"Method not allowed."},405);
    if(request.headers.get("origin")!==env.EXTENSION_ORIGIN || !env.EXTENSION_ORIGIN) fail(403,"Open this extension on Twitch.");
    const publicChat = env.PUBLIC_CHAT === "true";
    if(!publicChat && !(env.PARTY_CHANNELS||"").split(",").includes(channel)) fail(403,"Chat celebrations are not enabled for this channel.");
    const claims=await verifyPartyViewer(request,env.EXTENSION_SECRET,channel,now);
    const testers=JSON.parse(env.PARTY_TEST_VIEWERS||"{}");
    let actor=Object.hasOwn(testers,claims.user_id)?testers[claims.user_id]:null;
    if(!publicChat && !/^[a-z0-9_]{1,25}$/.test(actor||"")) fail(403,"Chat celebrations are currently limited to the invited test accounts.");
    if(request.headers.get("content-type")!=="application/json") fail(415,"Use JSON.");
    const input=await smallJson(request,1024);
    eventId=input.eventId;
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(eventId||"") ||
       typeof input.objectId!=="string" || input.objectId.length>64 || !Object.hasOwn(PARTY_PRESETS,input.preset)) fail(400,"Choose a supported celebration.");
    const old=await env.IMAGES.prepare("SELECT status, user_id FROM party_events WHERE channel=?1 AND event_id=?2").bind(channel,eventId).first();
    if(old) { if(old.user_id!==claims.user_id) fail(409,"That celebration request already exists."); return json({status:old.status,replayed:true},old.status==="sent"?200:202); }
    await claimAttempt(env,channel,claims.user_id,currentTime());
    if (publicChat) {
      stage="moderation";
      const moderation=await checkViewerModeration(env,channel,claims.user_id,fetcher,now);
      if(!moderation.allowed) fail(403,"This channel’s chat moderation prevents this celebration.");
      actor=moderation.actor;
    }
    stage="signing";
    // Moderation can include a token refresh. Mint this short-lived credential
    // after those checks rather than spending its lifetime on earlier requests.
    const jwt=await signPartyToken(env,channel,currentTime());
    const headers={Authorization:`Bearer ${jwt}`,"Client-Id":env.EXTENSION_CLIENT_ID,"Content-Type":"application/json"};
    // Workers supports manual/follow, not the browser's redirect:error mode.
    // Manual keeps the signed credential on the fixed Twitch host; redirects
    // are rejected by the response.ok checks below.
    const call=(url,options={})=>fetcher(url,{...options,headers,redirect:"manual",signal:AbortSignal.timeout(8000)});
    stage="config_fetch";
    const configResponse=await call(`https://api.twitch.tv/helix/extensions/configurations?extension_id=${env.EXTENSION_CLIENT_ID}&segment=broadcaster&broadcaster_id=${channel}`);
    if(!configResponse.ok) fail(503,"Could not check the streamer's current buttons. Try again later.");
    stage="config_read";
    const configs=await smallJson(configResponse,32000);
    const saved=configs.data?.find(c=>c.segment==="broadcaster"&&c.broadcaster_id===channel);
    let scene;try{scene=parseScene(saved?.content);}catch{fail(409,"The streamer needs to save this setup first.");}
    if(!scene.objects.some(o=>o.id===input.objectId&&o.action==="party"&&o.preset===input.preset)) fail(409,"This celebration is no longer enabled. Refresh the player.");
    // Only an authorized viewer clicking a currently saved object can consume
    // the shared slot or create a retained receipt. Atomic admission still
    // prevents concurrent requests from exceeding Twitch's channel limit.
    stage="admission";
    const insert=await env.IMAGES.prepare(`INSERT OR IGNORE INTO party_events(channel,event_id,user_id,created,status)
      SELECT ?1,?2,?3,?4,'pending' WHERE (SELECT count(*) FROM party_events)<100000 AND NOT EXISTS(
        SELECT 1 FROM party_events WHERE channel=?1 AND (created>?4-8000 OR (user_id=?3 AND created>?4-20000)))`).bind(channel,eventId,claims.user_id,currentTime()).run();
    if(!insert.meta.changes) {
      const capacity=await env.IMAGES.prepare("SELECT count(*) AS total FROM party_events").bind().first();
      if(capacity.total>=100000) fail(503,"Shared celebrations have reached the service’s free storage limit. Contact Scene Studio support.");
      fail(429,"Let the confetti settle—wait 20 seconds before trying again.");
    }
    admitted=true;
    const text=`${actor} ${PARTY_PRESETS[input.preset].chat}`;
    stage="chat_send";
    const chat=await call(`https://api.twitch.tv/helix/extensions/chat?broadcaster_id=${channel}`,{method:"POST",body:JSON.stringify({text,extension_id:env.EXTENSION_CLIENT_ID,extension_version:env.EXTENSION_VERSION})});
    if(!chat.ok) fail(503,"Twitch did not accept the chat message. The streamer may need to enable extension chat.");
    stage="chat_receipt";
    await env.IMAGES.prepare("UPDATE party_events SET status='chat_sent' WHERE channel=?1 AND event_id=?2").bind(channel,eventId).run();
    const event={type:"scene-studio-party",eventId,preset:input.preset,actor,created:Date.now()};
    stage="broadcast";
    const broadcast=await call("https://api.twitch.tv/helix/extensions/pubsub",{method:"POST",body:JSON.stringify({broadcaster_id:channel,target:["broadcast"],message:JSON.stringify(event)})});
    if(!broadcast.ok) return json({status:"chat_sent",error:"Posted in chat, but the shared animation was unavailable. Do not retry this click."},202);
    await env.IMAGES.prepare("UPDATE party_events SET status='sent' WHERE channel=?1 AND event_id=?2").bind(channel,eventId).run();
    return json({status:"sent",event});
  } catch(error) {
    // An uncertain network result must never trigger an automatic retry.
    if(admitted) await env.IMAGES.prepare("UPDATE party_events SET status=CASE WHEN status='pending' THEN ?3 ELSE status END WHERE channel=?1 AND event_id=?2").bind(channel,eventId,`${stage}_uncertain`).run().catch(()=>{});
    const known = error instanceof PartyError || error instanceof ChatAuthorizationError;
    return json({error:known?error.message:"The result could not be confirmed. Check chat before another click.",uncertain:admitted},known?error.status:503);
  }
}

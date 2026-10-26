import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { CHAT_AUTH_SCHEMA, TRIGGER_SCOPES, startConnect, startTriggerConnect, completeConnect, getChatConnection, getTriggerAuthorization, disconnectChat, checkViewerModeration } from "../server/chat-authorization.mjs";
import { ensureTriggerSubscription, getTriggerConnection, handleChatWebhook, disconnectTriggerSubscription, deriveChatWebhookSecret, cleanupChatTriggerReceipts, CHAT_TRIGGER_PENDING_TTL } from "../server/chat-triggers.mjs";

const now=Date.now(),origin="https://example.ext-twitch.tv",claims={role:"broadcaster",user_id:"123",channel_id:"123"};
function fixture(t) {
 const db=new DatabaseSync(":memory:");db.exec(CHAT_AUTH_SCHEMA);db.exec(readFileSync(new URL("../server/chat-triggers-schema.sql",import.meta.url),"utf8"));t.after(()=>db.close());
 const env={CHAT_TRIGGERS_ENABLED:"true",EXTENSION_ORIGIN:origin,EXTENSION_SECRET:Buffer.alloc(32,7).toString("base64"),TWITCH_CHAT_CLIENT_ID:"testclient",TWITCH_CHAT_CLIENT_SECRET:"testsecret",PUBLIC_SERVICE_URL:"https://service.example",IMAGES:{prepare(query){return{bind(...args){const stmt=db.prepare(query),values=Object.fromEntries(args.map((value,index)=>[String(index+1),value]));return{first:async()=>stmt.get(values)||null,run:async()=>({meta:stmt.run(values)}),all:async()=>({results:stmt.all(values)})};}};}}};
 const calls=[],effects=[],subscriptions=[];const options={scopes:[...TRIGGER_SCOPES],banned:false,failDelete:false,loseCreate:false,expired:false,refreshes:0,match:true,failEffect:false};
 const fetcher=async(address,init={})=>{
  assert.equal(init.redirect,"manual");calls.push({address,init});const url=new URL(address);
  if(url.pathname==="/oauth2/token") {
   const body=new URLSearchParams(init.body);assert.equal(body.get("client_secret"),"testsecret");
   if(body.get("grant_type")==="client_credentials")return Response.json({access_token:"app-token",token_type:"bearer",expires_in:3600});
   if(body.get("grant_type")==="refresh_token"){options.refreshes++;return Response.json({access_token:"new-access",refresh_token:"new-refresh",token_type:"bearer"});}
   return Response.json({access_token:"old-access",refresh_token:"old-refresh",token_type:"bearer"});
  }
  if(url.pathname==="/oauth2/validate") {
   if(options.expired&&init.headers.Authorization==="OAuth old-access")return new Response(null,{status:401});
   return Response.json({client_id:"testclient",user_id:"123",scopes:options.scopes,expires_in:3600});
  }
  if(url.pathname==="/oauth2/revoke")return new Response(null,{status:200});
  if(url.pathname==="/helix/moderation/banned")return Response.json({data:options.banned?[{user_id:"456",expires_at:""}]:[]});
  if(url.pathname==="/helix/users")return Response.json({data:[{id:"456",login:"viewer"}]});
  if(url.pathname==="/helix/eventsub/subscriptions") {
   assert.equal(init.headers.Authorization,"Bearer app-token");
   if(init.method==="POST") {
    const body=JSON.parse(init.body);assert.deepEqual(body.condition,{broadcaster_user_id:"123",user_id:"123"});assert.match(body.transport.secret,/^[a-f0-9]{64}$/);
    const entry={id:crypto.randomUUID(),...body,transport:{method:"webhook",callback:body.transport.callback},status:"webhook_callback_verification_pending"};subscriptions.push(entry);
    if(options.loseCreate){options.loseCreate=false;throw new Error("lost result containing provider detail");}
    return Response.json({data:[entry]},{status:202});
   }
   if(init.method==="DELETE") {if(options.failDelete)throw new Error("provider unavailable");const i=subscriptions.findIndex(item=>item.id===url.searchParams.get("id"));if(i>=0)subscriptions.splice(i,1);return new Response(null,{status:204});}
   return Response.json({data:subscriptions,pagination:{}});
  }
  throw new Error("Unexpected provider call");
 };
 async function connect(trigger=true) {
  const start=await(trigger?startTriggerConnect:startConnect)(env,"123",origin,claims,now);
  const url=new URL(start.authorizeUrl);
  assert.equal(url.searchParams.get("scope"),trigger?TRIGGER_SCOPES.join(" "):"moderation:read");
  assert.ok(!url.searchParams.get("scope").includes("user:write:chat"));
  return completeConnect(env,`https://service.example/chat/callback?state=${url.searchParams.get("state")}&code=test`,fetcher,now);
 }
 async function signed(kind="notification",overrides={},at=now) {
  const row=db.prepare("SELECT * FROM chat_trigger_subscriptions WHERE channel='123'").get();
  const body={subscription:{id:row.subscription_id||subscriptions.at(-1)?.id||crypto.randomUUID(),type:"channel.chat.message",version:"1",condition:{broadcaster_user_id:"123",user_id:"123"},transport:{method:"webhook",callback:"https://service.example/eventsub/chat/123"}},...(kind==="webhook_callback_verification"?{challenge:"verify-this-challenge"}:{}),...(kind==="notification"?{event:{broadcaster_user_id:"123",chatter_user_id:"456",message_id:crypto.randomUUID(),message:{text:"party now — private raw chat text"}}}:{}),...overrides};
  const raw=JSON.stringify(body),messageId=crypto.randomUUID(),timestamp=new Date(at).toISOString(),secret=await deriveChatWebhookSecret(env,"123",row.nonce);
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature=Buffer.from(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(messageId+timestamp+raw))).toString("hex");
  return new Request("https://service.example/eventsub/chat/123",{method:"POST",headers:{"Content-Type":"application/json","Twitch-Eventsub-Message-Id":messageId,"Twitch-Eventsub-Message-Timestamp":timestamp,"Twitch-Eventsub-Message-Signature":`sha256=${signature}`,"Twitch-Eventsub-Message-Type":kind,"Twitch-Eventsub-Subscription-Type":"channel.chat.message","Twitch-Eventsub-Subscription-Version":"1"},body:raw});
 }
 const processInput=async(env,channel,event)=>{effects.push({channel,event});if(options.failEffect)throw new Error("uncertain effect");return{status:"sent"};};
 const hasMatchingKeywordRule=async()=>options.match;
 const handle=(request,extra={})=>handleChatWebhook(request,env,"123",{processInput,hasMatchingKeywordRule,fetcher,now,...extra});
 async function listen(){await connect();await ensureTriggerSubscription(env,"123",{fetcher,now});const result=await handle(await signed("webhook_callback_verification"));assert.equal(result.status,200);}
 return{db,env,calls,effects,subscriptions,options,fetcher,connect,signed,handle,listen};
}

test("trigger consent is separate, scope-verified, and preserves moderation-only grants",async t=>{
 const s=fixture(t);s.options.scopes=["moderation:read"];
 assert.deepEqual(await s.connect(false),{connected:true,channel:"123"});
 assert.equal((await getChatConnection(s.env,"123",origin,claims)).connected,true);
 assert.equal((await getTriggerConnection(s.env,"123")).authorized,false);
 const old=s.db.prepare("SELECT encrypted_tokens FROM chat_oauth_grants").get().encrypted_tokens;
 await assert.rejects(s.connect(true),error=>error.code==="wrong_authorization");
 assert.equal(s.db.prepare("SELECT encrypted_tokens FROM chat_oauth_grants").get().encrypted_tokens,old);
 s.options.scopes=[...TRIGGER_SCOPES];assert.deepEqual(await s.connect(),{connected:true,channel:"123",triggerAccess:true});
 assert.equal((await getTriggerAuthorization(s.env,"123")).authorized,true);
 assert.ok(!s.db.prepare("SELECT encrypted_tokens FROM chat_oauth_grants").get().encrypted_tokens.includes("old-access"));
 s.env.CHAT_TRIGGERS_ENABLED="false";
 await assert.rejects(startTriggerConnect(s.env,"123",origin,claims,now),error=>error.status===503);
 assert.equal((await getChatConnection(s.env,"123",origin,claims)).connected,true);
});

test("registration uses an app token, keeps one subscription, and reconciles uncertain creation",async t=>{
 const s=fixture(t);await s.connect();s.options.loseCreate=true;
 await assert.rejects(ensureTriggerSubscription(s.env,"123",{fetcher:s.fetcher,now}),error=>error.status===503);
 assert.equal(s.subscriptions.length,1);
 assert.equal((await getTriggerConnection(s.env,"123")).status,"uncertain");
 const status=await ensureTriggerSubscription(s.env,"123",{fetcher:s.fetcher,now:now+1});
 assert.equal(status.status,"pending");assert.equal(s.subscriptions.length,1);
 const before=s.calls.length;
 await ensureTriggerSubscription(s.env,"123",{fetcher:s.fetcher,now:now+2});
 assert.equal(s.subscriptions.length,1);
 assert.equal(s.calls.slice(before).filter(call=>call.init.method==="POST").length,0);
 const challenge=await s.handle(await s.signed("webhook_callback_verification"));
 assert.equal(await challenge.text(),"verify-this-challenge");
 assert.equal((await getTriggerConnection(s.env,"123")).connected,true);
});

test("webhooks require raw-body signature, bounded age, exact channel and active subscription",async t=>{
 const s=fixture(t);await s.listen();
 const bad=await s.signed();bad.headers.set("Twitch-Eventsub-Message-Signature",`sha256=${"0".repeat(64)}`);
 assert.equal((await s.handle(bad)).status,403);
 assert.equal((await s.handle(await s.signed("notification",{},now-600001))).status,403);
 const wrong=await s.signed("notification",{event:{broadcaster_user_id:"999",chatter_user_id:"456",message_id:crypto.randomUUID(),message:{text:"party"}}});
 assert.equal((await s.handle(wrong)).status,400);
 const oversized=await s.signed("notification",{padding:"x".repeat(65536)});assert.equal((await s.handle(oversized)).status,413);
 const subtype=await s.signed();subtype.headers.set("Twitch-Eventsub-Subscription-Version","2");assert.equal((await s.handle(subtype)).status,400);
 assert.equal(s.effects.length,0);assert.equal(s.db.prepare("SELECT count(*) n FROM chat_trigger_receipts").get().n,0);
});

test("expired pending verification retries without new OAuth and invalidates the old challenge",async t=>{
 const s=fixture(t);await s.connect();
 await ensureTriggerSubscription(s.env,"123",{fetcher:s.fetcher,now});
 const first=s.db.prepare("SELECT * FROM chat_trigger_subscriptions").get();
 const oldChallenge=await s.signed("webhook_callback_verification");
 const before=s.calls.length;
 await ensureTriggerSubscription(s.env,"123",{fetcher:s.fetcher,now:now+CHAT_TRIGGER_PENDING_TTL-1});
 assert.equal(s.calls.slice(before).filter(call=>new URL(call.address).pathname==="/helix/eventsub/subscriptions").length,0);
 const retryAt=now+CHAT_TRIGGER_PENDING_TTL;
 const expired=await getTriggerConnection(s.env,"123",{now:retryAt});
 assert.equal(expired.status,"verification_expired");assert.equal(expired.retryRequired,true);
 await ensureTriggerSubscription(s.env,"123",{fetcher:s.fetcher,now:retryAt});
 const second=s.db.prepare("SELECT * FROM chat_trigger_subscriptions").get();
 assert.equal(second.grant_id,first.grant_id,"retry retains the approved OAuth grant");
 assert.notEqual(second.nonce,first.nonce);assert.notEqual(second.subscription_id,first.subscription_id);
 assert.equal(s.subscriptions.length,1,"reconciliation removes the unverified provider subscription");
 assert.equal((await s.handle(oldChallenge,{now:retryAt})).status,403);
 assert.equal((await s.handle(await s.signed("webhook_callback_verification",{},retryAt),{now:retryAt})).status,200);
 assert.equal((await getTriggerConnection(s.env,"123",{now:retryAt})).connected,true);
});

test("webhook receipts distinguish cooldown, no match, uncertain and provider acceptance",async t=>{
 const s=fixture(t);await s.listen();
 for(const status of ["cooldown","no_match","uncertain","sent","unexpected"]) {
  const messageId=crypto.randomUUID();let invoked=0;
  const req=await s.signed("notification",{event:{broadcaster_user_id:"123",chatter_user_id:"456",message_id:messageId,message:{text:"party"}}});
  const duplicate=req.clone();
  const processInput=async()=>{invoked++;return{status};};
  assert.equal((await s.handle(req,{processInput})).status,204);
  assert.equal(s.db.prepare("SELECT status FROM chat_trigger_receipts WHERE message_id=?").get(messageId).status,status==="unexpected"?"uncertain":status);
  await s.handle(duplicate,{processInput});assert.equal(invoked,1,"none of the recorded outcomes replays on notification retry");
 }
});

test("notifications acknowledge before deferred effects, deduplicate chat IDs, and store no text",async t=>{
 const s=fixture(t);await s.listen();const request=await s.signed(),clone=request.clone();const work=[];
 const accepted=await s.handle(request,{waitUntil:promise=>work.push(promise)});assert.equal(accepted.status,204);assert.equal(work.length,1);
 await Promise.all(work);assert.equal(s.effects.length,1);assert.equal(s.effects[0].channel,"123");
 assert.equal(s.effects[0].event.type,"message");assert.match(s.effects[0].event.id,/^[0-9a-f-]{36}$/);
 assert.equal((await s.handle(clone)).status,204);assert.equal(s.effects.length,1);
 const receipts=s.db.prepare("SELECT * FROM chat_trigger_receipts").all();assert.equal(receipts[0].status,"sent");assert.ok(!JSON.stringify(receipts).includes("private raw chat"));
 s.options.failEffect=true;const uncertain=await s.signed(),again=uncertain.clone();await s.handle(uncertain);await s.handle(again);
 assert.equal(s.effects.length,2);assert.equal(s.db.prepare("SELECT count(*) n FROM chat_trigger_receipts WHERE status='uncertain'").get().n,1);
});

test("prefilter avoids provider work and moderation or grant changes prevent automation delivery",async t=>{
 const s=fixture(t);await s.listen();s.options.match=false;let before=s.calls.length;
 await s.handle(await s.signed());assert.equal(s.calls.length,before);assert.equal(s.effects.length,0);
 s.options.match=true;s.options.banned=true;await s.handle(await s.signed());assert.equal(s.effects.length,0);
 s.options.banned=false;s.options.scopes=["moderation:read"];
 await s.handle(await s.signed());assert.equal(s.effects.length,0);
 assert.equal((await getChatConnection(s.env,"123",origin,claims)).connected,true,"losing trigger scopes must not remove moderation access");
 assert.equal((await getTriggerConnection(s.env,"123")).authorized,false);
});

test("effect dispatch gets a fresh clock after slow moderation rather than webhook arrival time",async t=>{
 const s=fixture(t);await s.listen();let elapsed=0,dispatchedAt;
 const fetcher=async(url,init)=>{
  if(url.includes("/moderation/banned"))elapsed+=6000;
  if(url.includes("/helix/users"))elapsed+=2000;
  return s.fetcher(url,init);
 };
 const result=await s.handle(await s.signed(),{clock:()=>elapsed,fetcher,processInput:async(env,channel,event,options)=>{dispatchedAt=options.now;}});
 assert.equal(result.status,204);
 assert.equal(dispatchedAt,now+8000,"a4-second effect must not be expired before it is dispatched");
});

test("refresh preserves listener identity, reconnect changes it, and revocation stops delivery",async t=>{
 const s=fixture(t);await s.listen();const first=await getTriggerAuthorization(s.env,"123");
 s.options.expired=true;await checkViewerModeration(s.env,"123","456",s.fetcher,now);
 assert.equal((await getTriggerAuthorization(s.env,"123")).grantId,first.grantId);assert.equal(s.options.refreshes,1);
 s.options.expired=false;const beforeReconnect=await s.signed();await s.connect();
 assert.notEqual((await getTriggerAuthorization(s.env,"123")).grantId,first.grantId);
 assert.equal((await s.handle(beforeReconnect)).status,410);
 await ensureTriggerSubscription(s.env,"123",{fetcher:s.fetcher,now:now+1});await s.handle(await s.signed("webhook_callback_verification"));assert.equal(s.subscriptions.length,1);
 assert.equal((await s.handle(await s.signed("revocation"))).status,204);
 assert.equal((await getTriggerConnection(s.env,"123")).status,"revoked");
 assert.equal((await s.handle(await s.signed())).status,410);assert.equal(s.effects.length,0);
});

test("disconnect stops locally despite provider failure and moderation disconnect invalidates ingestion",async t=>{
 const s=fixture(t);await s.listen();const request=await s.signed();s.options.failDelete=true;
 assert.deepEqual(await disconnectTriggerSubscription(s.env,"123",{fetcher:s.fetcher,now}),{connected:false,subscriptionRemoved:false});
 assert.equal((await s.handle(request)).status,410);assert.equal(s.effects.length,0);
 assert.equal((await getChatConnection(s.env,"123",origin,claims)).connected,true);
 await disconnectChat(s.env,"123",origin,claims,s.fetcher);
 assert.equal((await getTriggerConnection(s.env,"123")).authorized,false);
});

test("receipt storage has an admission cap and 24-hour cleanup",async t=>{
 const s=fixture(t);await s.listen();
 s.db.prepare("WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM seq WHERE x<100000) INSERT INTO chat_trigger_receipts SELECT '999',CAST(x AS TEXT),?,'ignored' FROM seq").run(now);
 assert.equal((await s.handle(await s.signed())).status,503);assert.equal(s.effects.length,0);
 await cleanupChatTriggerReceipts(s.env,now+86400000);
 assert.equal(s.db.prepare("SELECT count(*) n FROM chat_trigger_receipts").get().n,0);
 assert.equal((await s.handle(await s.signed())).status,204);assert.equal(s.effects.length,1);
});

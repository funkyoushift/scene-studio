import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { CHAT_AUTH_SCHEMA, ACTIVITY_SCOPES, TRIGGER_SCOPES, startConnect, startTriggerConnect, startActivityConnect, completeConnect, getActivityAuthorization, getChatConnection, checkViewerModeration, validateIdleChatGrants } from "../server/chat-authorization.mjs";
import { deriveActivityWebhookSecret, ensureActivitySubscriptions, getActivityConnection, disconnectActivitySubscriptions, handleActivityWebhook, cleanupActivityReceipts } from "../server/twitch-events.mjs";
import { automationRequest, processAutomationInput } from "../server/automation-service.mjs";

const now=Date.now(),origin="https://example.ext-twitch.tv",claims={role:"broadcaster",user_id:"123",channel_id:"123"};
function fixture(t) {
 const db=new DatabaseSync(":memory:");db.exec(CHAT_AUTH_SCHEMA);db.exec(readFileSync(new URL("../server/twitch-events-schema.sql",import.meta.url),"utf8"));db.exec(readFileSync(new URL("../server/automation-schema.sql",import.meta.url),"utf8"));t.after(()=>db.close());
 const env={TWITCH_ACTIVITY_ENABLED:"true",CHAT_TRIGGERS_ENABLED:"true",AUTOMATIONS_ENABLED:"true",EXTENSION_ORIGIN:origin,EXTENSION_SECRET:Buffer.alloc(32,7).toString("base64"),EXTENSION_CLIENT_ID:"testclient",EXTENSION_OWNER:"999",TWITCH_CHAT_CLIENT_ID:"testclient",TWITCH_CHAT_CLIENT_SECRET:"testsecret",PUBLIC_SERVICE_URL:"https://service.example",IMAGES:{prepare(query){return{bind(...args){const stmt=db.prepare(query),values=Object.fromEntries(args.map((value,index)=>[String(index+1),value]));return{first:async()=>stmt.get(values)||null,run:async()=>({meta:stmt.run(values)}),all:async()=>({results:stmt.all(values)})};}};}}};
 const options={scopes:["moderation:read",...ACTIVITY_SCOPES],failDelete:false,loseCreate:false,expired:false,refreshes:0};const calls=[],subscriptions=[],effects=[];
 const fetcher=async(address,init={})=>{
  assert.equal(init.redirect,"manual");calls.push({address,init});const url=new URL(address);
  if(url.pathname==="/oauth2/token") {const body=new URLSearchParams(init.body);if(body.get("grant_type")==="client_credentials")return Response.json({access_token:"app-token",token_type:"bearer",expires_in:3600});if(body.get("grant_type")==="refresh_token"){options.refreshes++;return Response.json({access_token:"refreshed-access",refresh_token:"refreshed-refresh",token_type:"bearer"});}return Response.json({access_token:"user-access",refresh_token:"user-refresh",token_type:"bearer"});}
  if(url.pathname==="/oauth2/validate") {if(options.expired&&init.headers.Authorization==="OAuth user-access")return new Response(null,{status:401});return Response.json({client_id:"testclient",user_id:"123",scopes:options.scopes,expires_in:3600});}
  if(url.pathname==="/helix/eventsub/subscriptions") {
   assert.equal(init.headers.Authorization,"Bearer app-token");
   if(init.method==="POST") {const body=JSON.parse(init.body);assert.match(body.transport.secret,/^[a-f0-9]{64}$/);const entry={id:crypto.randomUUID(),...body,transport:{method:"webhook",callback:body.transport.callback},status:"webhook_callback_verification_pending"};subscriptions.push(entry);if(options.loseCreate){options.loseCreate=false;throw new Error("response lost");}return Response.json({data:[entry]},{status:202});}
   if(init.method==="DELETE"){if(options.failDelete)throw new Error("provider failure");const i=subscriptions.findIndex(item=>item.id===url.searchParams.get("id"));if(i>=0)subscriptions.splice(i,1);return new Response(null,{status:204});}
   return Response.json({data:subscriptions.filter(item=>item.condition.broadcaster_user_id===url.searchParams.get("user_id")),pagination:{}});
  }
  if(url.pathname==="/helix/extensions/pubsub") {assert.equal(init.method,"POST");assert.equal(init.headers["Client-Id"],"testclient");const body=JSON.parse(init.body);assert.deepEqual(body.target,["broadcast"]);assert.equal(body.broadcaster_id,"123");effects.push(JSON.parse(body.message));return new Response(null,{status:204});}
  throw new Error(`Unexpected provider request ${url.pathname}`);
 };
 async function consent(kind="activity") {
  const begin=kind==="activity"?startActivityConnect:kind==="trigger"?startTriggerConnect:startConnect;
  const hadGrant=Boolean(db.prepare("SELECT 1 FROM chat_oauth_grants WHERE channel='123'").get());
  const started=await begin(env,"123",origin,claims,now),url=new URL(started.authorizeUrl),requested=url.searchParams.get("scope").split(" ");
  if(kind!=="activity"||hadGrant)assert.ok(requested.includes("moderation:read"));else assert.equal(requested.includes("moderation:read"),false);
  if(kind==="activity"){assert.ok(ACTIVITY_SCOPES.every(scope=>requested.includes(scope)));if(!hadGrant)assert.equal(requested.includes("user:read:chat"),false);}
  if(kind==="trigger")assert.ok(TRIGGER_SCOPES.every(scope=>requested.includes(scope)));
  options.scopes=requested;
  return completeConnect(env,`https://service.example/chat/callback?state=${url.searchParams.get("state")}&code=authorization-code`,fetcher,now);
 }
 async function signed(eventName,kind="notification",eventBody={broadcaster_user_id:"123"},at=now) {
  const row=db.prepare("SELECT * FROM twitch_activity_subscriptions WHERE channel='123' AND event=?").get(eventName);
  const entry=subscriptions.find(item=>item.id===row.subscription_id);
  const body={subscription:{id:row.subscription_id,type:entry.type,version:entry.version,condition:entry.condition,transport:{method:"webhook",callback:entry.transport.callback}},...(kind==="webhook_callback_verification"?{challenge:"eventsub-challenge"}:{}),...(kind==="notification"?{event:eventBody}:{})};
  const raw=JSON.stringify(body),messageId=crypto.randomUUID(),timestamp=new Date(at).toISOString(),secret=await deriveActivityWebhookSecret(env,"123",eventName,row.nonce);
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature=Buffer.from(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(messageId+timestamp+raw))).toString("hex");
  return new Request(entry.transport.callback,{method:"POST",headers:{"Content-Type":"application/json","Twitch-Eventsub-Message-Id":messageId,"Twitch-Eventsub-Message-Timestamp":timestamp,"Twitch-Eventsub-Message-Signature":`sha256=${signature}`,"Twitch-Eventsub-Message-Type":kind,"Twitch-Eventsub-Subscription-Type":entry.type,"Twitch-Eventsub-Subscription-Version":entry.version},body:raw});
 }
 const handle=(request,extra={})=>handleActivityWebhook(request,env,"123",extra.event||"subscribe",{fetcher,now,processInput:async(...args)=>{effects.push(args);return{status:"sent"};},...extra});
 return{db,env,options,calls,subscriptions,effects,fetcher,consent,signed,handle};
}

test("optional activity consent requests only its scopes and retains chat triggers on later reconnection",async t=>{
 const s=fixture(t);
 const activity=await s.consent("activity");assert.deepEqual(activity,{connected:true,channel:"123",activityAccess:true});
 assert.deepEqual(await s.consent("trigger"),{connected:true,channel:"123",triggerAccess:true,activityAccess:true});
 const stored=s.db.prepare("SELECT encrypted_tokens FROM chat_oauth_grants WHERE channel='123'").get().encrypted_tokens;
 assert.ok(!stored.includes("user-access"));assert.ok(!stored.includes("user-refresh"));
 assert.equal((await getActivityAuthorization(s.env,"123")).authorized,true);
 // Existing optional scopes are carried on a later chat authorization request.
 const ordinary=await startConnect(s.env,"123",origin,claims,now),scope=new URL(ordinary.authorizeUrl).searchParams.get("scope").split(" ");
 assert.ok(ACTIVITY_SCOPES.every(item=>scope.includes(item)));assert.ok(TRIGGER_SCOPES.every(item=>scope.includes(item)));
});

test("a new activity-only grant requests only the two activity scopes and survives validation and refresh",async t=>{
 const s=fixture(t);assert.deepEqual(await s.consent("activity"),{connected:true,channel:"123",activityAccess:true});
 assert.deepEqual(s.options.scopes,[...ACTIVITY_SCOPES]);
 assert.equal((await getChatConnection(s.env,"123",origin,claims)).connected,false);
 await assert.rejects(checkViewerModeration(s.env,"123","456",s.fetcher,now),error=>error.status===409&&error.code==="reconnect_required");
 assert.equal(s.db.prepare("SELECT invalidated FROM chat_oauth_grants").get().invalidated,0,"a missing moderation scope must not invalidate activity consent");
 s.options.expired=true;
 assert.equal((await getActivityAuthorization(s.env,"123",{fetcher:s.fetcher,now,verify:true})).authorized,true);
 assert.equal(s.options.refreshes,1);
 const validation=await validateIdleChatGrants(s.env,{fetcher:s.fetcher,now:now+1});
 assert.equal(validation.valid,1);assert.equal(validation.reconnectRequired,0);
 assert.equal((await getActivityAuthorization(s.env,"123",{fetcher:s.fetcher,now:now+2,verify:true})).authorized,true);
});

test("losing activity scopes disables only activity access and preserves the chat grant",async t=>{
 const s=fixture(t);await s.consent("chat");await s.consent("activity");s.options.scopes=["moderation:read"];
 await assert.rejects(getActivityAuthorization(s.env,"123",{fetcher:s.fetcher,now,verify:true}),error=>error.code==="activity_connection_required");
 assert.equal((await getChatConnection(s.env,"123",origin,claims)).connected,true);
 await assert.rejects(getActivityAuthorization(s.env,"123"),error=>error.code==="activity_connection_required");
});

test("all six bounded registrations use the expected Twitch type/version and reconcile without duplicates",async t=>{
 const s=fixture(t);await s.consent("activity");
 const result=await ensureActivitySubscriptions(s.env,"123",{fetcher:s.fetcher,now});
 assert.deepEqual(s.subscriptions.map(item=>[item.type,item.version]),[
  ["channel.subscribe","1"],["channel.subscription.message","1"],["channel.subscription.gift","1"],
  ["channel.hype_train.begin","2"],["channel.hype_train.progress","2"],["channel.hype_train.end","2"],
 ]);
 assert.equal(result.events.length,6);assert.equal(result.connected,false);assert.equal(s.subscriptions.length,6);
 const before=s.calls.filter(call=>call.init.method==="POST").length;
 await ensureActivitySubscriptions(s.env,"123",{fetcher:s.fetcher,now:now+1});
 assert.equal(s.calls.filter(call=>call.init.method==="POST").length,before);
 s.db.prepare("UPDATE twitch_activity_subscriptions SET grant_id='previous-consent',status='enabled' WHERE channel='123' AND event='subscribe'").run();
 const stale=await getActivityConnection(s.env,"123",{now:now+2});
 assert.equal(stale.events.find(item=>item.event==="subscribe").connected,false,"enabled rows from an older consent epoch are stale");
 assert.equal(stale.events.find(item=>item.event==="subscribe").status,"authorization_changed");
 assert.ok(s.subscriptions.every(item=>item.condition.broadcaster_user_id==="123"));
});

test("signed webhook verifies challenge, maps only enum and ID, deduplicates receipts, and ignores gift duplicates",async t=>{
 const s=fixture(t);await s.consent("activity");await ensureActivitySubscriptions(s.env,"123",{fetcher:s.fetcher,now});
 const challenge=await s.handle(await s.signed("subscribe","webhook_callback_verification"));
 assert.equal(challenge.status,200);assert.equal(await challenge.text(),"eventsub-challenge");
 const body={broadcaster_user_id:"123",user_name:"must-not-be-retained",message:{text:"private resub note"}};
 const notification=await s.signed("subscribe","notification",body),duplicate=notification.clone();
 assert.equal((await s.handle(notification)).status,204);assert.equal(s.effects.length,1);
 assert.deepEqual(s.effects[0][2],{type:"twitch",event:"subscribe",id:new Headers(notification.headers).get("twitch-eventsub-message-id")});
 assert.equal((await s.handle(duplicate)).status,204);assert.equal(s.effects.length,1);
 const receipt=JSON.stringify(s.db.prepare("SELECT * FROM twitch_activity_receipts").all());assert.ok(!receipt.includes("must-not-be-retained"));assert.ok(!receipt.includes("private resub note"));
 const giftCopy=await s.signed("subscribe","notification",{broadcaster_user_id:"123",is_gift:true});
 assert.equal((await s.handle(giftCopy)).status,204);assert.equal(s.effects.length,1);
 assert.equal((await s.handle(await s.signed("resubscribe","webhook_callback_verification"),{event:"resubscribe"})).status,200);
 let attempts=0;const uncertain=await s.signed("resubscribe","notification",{broadcaster_user_id:"123",message:{text:"not retained"}}),again=uncertain.clone();
 const processInput=async()=>{attempts++;return{status:"uncertain"};};
 assert.equal((await s.handle(uncertain,{event:"resubscribe",processInput})).status,204);
 assert.equal((await s.handle(again,{event:"resubscribe",processInput})).status,204);assert.equal(attempts,1,"uncertain side effects are never replayed on webhook retries");
 const stale=await s.signed("subscribe","notification",body,now-600001);assert.equal((await s.handle(stale)).status,403);
 const bad=await s.signed("subscribe");bad.headers.set("Twitch-Eventsub-Subscription-Version","2");assert.equal((await s.handle(bad)).status,400);
});

test("signed Twitch notifications run saved subscribe and Hype Train rules through real PubSub once",async t=>{
 t.mock.method(Date,"now",()=>now);
 const s=fixture(t);await s.consent("activity");await ensureActivitySubscriptions(s.env,"123",{fetcher:s.fetcher,now});
 const design={version:1,carousels:[{id:"welcome",title:"Welcome",displaySeconds:10,slides:[{id:"slide",title:"Welcome!",caption:"",image:"",url:""}]}],rules:[
  {id:"new-sub",name:"New subscriber popup",enabled:true,trigger:{type:"twitch",event:"subscribe"},effect:{type:"carousel",carouselId:"welcome"},cooldownSeconds:0},
  {id:"hype",name:"Hype Train popup",enabled:true,trigger:{type:"twitch",event:"hype_begin"},effect:{type:"carousel",carouselId:"welcome"},cooldownSeconds:0},
 ]};
 const saveRequest=new Request("https://service.example/v1/automations/123/config",{method:"PUT",headers:{origin,authorization:"Bearer unused","content-type":"application/json"},body:JSON.stringify({design,expectedRevision:0,ownedMerch:false})});
 // automationRequest consumes already-verified extension claims just as the Worker router does.
 const saved=await automationRequest(saveRequest,s.env,"123",{claims:{role:"broadcaster",user_id:"123",channel_id:"123",exp:Math.floor(now/1000)+3600},fetcher:s.fetcher,now});
 assert.equal(saved.status,200);await saved.body.cancel();
 s.effects.length=0; // Exclude the config-change notification; count only event effects below.
 for(const event of ["subscribe","hype_begin"]) {
  const request=await s.signed(event,"webhook_callback_verification");
  assert.equal((await s.handle(request,{event})).status,200);
 }
 for(const [event,at] of [["subscribe",now+1000], ["hype_begin",now+20000]]) {
  const notification=await s.signed(event,"notification",{broadcaster_user_id:"123"},at),duplicate=notification.clone();
  assert.equal((await s.handle(notification,{event,now:at,clock:()=>at,processInput:processAutomationInput})).status,204);
  assert.equal((await s.handle(duplicate,{event,now:at,clock:()=>at,processInput:processAutomationInput})).status,204);
 }
 assert.equal(s.effects.length,2,"each distinct signed Twitch message produces one PubSub broadcast");
 assert.deepEqual(s.effects.map(message=>({type:message.type,channelId:message.channelId,effect:message.effect})),Array.from({length:2},()=>({type:"scene-studio-automation",channelId:"123",effect:{type:"carousel",carouselId:"welcome"}})));
});

test("uncertain provider registration is reconciled before retry, and disconnect disables locally",async t=>{
 const s=fixture(t);await s.consent("activity");s.options.loseCreate=true;
 await assert.rejects(ensureActivitySubscriptions(s.env,"123",{fetcher:s.fetcher,now}),error=>error.status===503);
 assert.equal((await getActivityConnection(s.env,"123")).events[0].status,"uncertain");
 const restored=await ensureActivitySubscriptions(s.env,"123",{fetcher:s.fetcher,now:now+1});
 assert.equal(restored.events[0].status,"pending");assert.equal(s.subscriptions.length,6);
 s.options.failDelete=true;
 assert.deepEqual(await disconnectActivitySubscriptions(s.env,"123",{fetcher:s.fetcher,now:now+2}),{connected:false,subscriptionRemoved:false});
 assert.equal((await getActivityConnection(s.env,"123",{now:now+3})).events.every(item=>!item.connected),true);
});

test("activity receipt cleanup removes expired IDs and retains current delivery records",async t=>{
 const s=fixture(t);
 s.db.prepare("INSERT INTO twitch_activity_receipts(channel,message_id,created,status) VALUES (?,?,?,?)").run("123","old",now-86400000,"sent");
 s.db.prepare("INSERT INTO twitch_activity_receipts(channel,message_id,created,status) VALUES (?,?,?,?)").run("123","current",now-1000,"sent");
 await cleanupActivityReceipts(s.env,now);
 assert.deepEqual(s.db.prepare("SELECT message_id FROM twitch_activity_receipts").all().map(r=>r.message_id),["current"]);
});

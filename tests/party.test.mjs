import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { partyRequest, signPartyToken, MAX_PARTY_ATTEMPTS } from "../server/party-service.mjs";
import { partyEvent } from "../src/party.mjs";
import { newObject, twitchContent } from "../src/scene.mjs";
import { watchTwitchScene } from "../src/twitch.mjs";
import { CHAT_AUTH_SCHEMA, startConnect, completeConnect } from "../server/chat-authorization.mjs";

const secret=Buffer.from("only-a-test-secret-not-used-in-production").toString("base64");
const origin="https://test.ext-twitch.tv", now=Date.now();
async function viewerToken(overrides={}) {
 const head=Buffer.from(JSON.stringify({alg:"HS256"})).toString("base64url");
 const body=Buffer.from(JSON.stringify({role:"viewer",user_id:"456",channel_id:"123",exp:Math.floor(now/1000)+3600,...overrides})).toString("base64url");
 const key=await crypto.subtle.importKey("raw",Buffer.from(secret,"base64"),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signature=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(head+"."+body));
 return head+"."+body+"."+Buffer.from(signature).toString("base64url");
}
function setup() {
 const db=new DatabaseSync(":memory:");db.exec(readFileSync(new URL("../server/schema.sql",import.meta.url),"utf8"));
 const env={EXTENSION_SECRET:secret,EXTENSION_ORIGIN:origin,PARTY_CHANNELS:"123",PARTY_TEST_VIEWERS:'{"456":"tester"}',EXTENSION_CLIENT_ID:"client",EXTENSION_OWNER:"789",EXTENSION_VERSION:"0.1.0",IMAGES:{prepare(sql){return{bind(...args){const p=Object.fromEntries(args.map((v,i)=>[String(i+1),v]));const s=db.prepare(sql);return{first:async()=>s.get(p),run:async()=>({meta:s.run(p)})};}}}}};
 const object={...newObject("party"),id:"duck-button"};
 const scene={version:1,name:"Party",objects:[object]};
 const calls=[];
 const fetcher=async(url,opts)=>{assert.equal(opts.redirect,"manual");calls.push({url,opts});if(url.includes("configurations"))return Response.json({data:[{segment:"broadcaster",broadcaster_id:"123",content:twitchContent(scene)}]});return new Response(null,{status:204});};
 const json=(data,status=200)=>Response.json(data,{status});
 const request=async({eventId=crypto.randomUUID(),claims={},extra={},from=origin}={})=>new Request("https://example.com/party/123",{method:"POST",headers:{Origin:from,Authorization:`Bearer ${await viewerToken(claims)}`,"Content-Type":"application/json"},body:JSON.stringify({eventId,objectId:object.id,preset:"ducks",...extra})});
 return{db,env,object,scene,calls,fetcher,json,request};
}
test("shared chat requires a linked invited identity, matching channel, origin and enabled channel",async()=>{
 const s=setup();
 for(const options of [{claims:{user_id:undefined}},{claims:{role:"external"}},{claims:{channel_id:"999"}},{claims:{exp:0}},{claims:{user_id:"555"}},{from:"https://evil.example"}]) {
  const r=await partyRequest(await s.request(options),s.env,"123",s.json,s.fetcher,now);assert.ok([401,403].includes(r.status));
 }
 assert.equal(s.calls.length,0);
 const r=await partyRequest(await s.request(),{...s.env,PARTY_CHANNELS:""},"123",s.json,s.fetcher,now);assert.equal(r.status,403);
 s.db.close();
});
test("party admission is channel-scoped, rate-limited, idempotent, and uses only saved presets",async()=>{
 const s=setup(),eventId=crypto.randomUUID();
 let r=await partyRequest(await s.request({eventId,extra:{text:"injected chat"}}),s.env,"123",s.json,s.fetcher,now);
 assert.equal(r.status,200);assert.equal((await r.json()).status,"sent");assert.equal(s.calls.length,3);
 const chat=JSON.parse(s.calls[1].opts.body);assert.equal(chat.text,"tester released the emergency ducks. QUACK. 🦆");
 const body=JSON.parse(s.calls[2].opts.body);assert.equal(body.broadcaster_id,"123");assert.equal(partyEvent(body.message).actor,"tester");
 r=await partyRequest(await s.request({eventId}),s.env,"123",s.json,s.fetcher,now+30000);assert.equal((await r.json()).replayed,true);assert.equal(s.calls.length,3);
 r=await partyRequest(await s.request(),s.env,"123",s.json,s.fetcher,now+1000);assert.equal(r.status,429);assert.equal(s.calls.length,3);
 r=await partyRequest(await s.request({extra:{preset:"disco"}}),s.env,"123",s.json,s.fetcher,now+21000);assert.equal(r.status,409);assert.equal(s.calls.length,4);
 assert.equal(s.db.prepare("SELECT count(*) AS n FROM party_events").get().n,1,"unsupported saved object must not create an action receipt");
 const jwt=await signPartyToken(s.env,"123",now),claims=JSON.parse(Buffer.from(jwt.split(".")[1],"base64url"));assert.equal(claims.user_id,"789");assert.equal(claims.channel_id,"123");assert.deepEqual(claims.pubsub_perms.send,["broadcast"]);
 s.db.close();
});
test("uncertain chat delivery is recorded and never replayed automatically",async()=>{
 const s=setup(),eventId=crypto.randomUUID();let sends=0;
 const failFetch=async(url,opts)=>{if(url.includes("/chat?")){sends++;throw new Error("timeout");}return s.fetcher(url,opts);};
 let r=await partyRequest(await s.request({eventId}),s.env,"123",s.json,failFetch,now);assert.equal(r.status,503);
 r=await partyRequest(await s.request({eventId}),s.env,"123",s.json,failFetch,now+30000);assert.equal(r.status,202);assert.equal((await r.json()).status,"chat_send_uncertain");assert.equal(sends,1);
 s.db.close();
});
test("shared celebrations do not replace scene configuration and reject expired or repeated packets",()=>{
 let receive;const helper={listen(t,cb){receive=cb;},unlisten(){},configuration:{onChanged(){}}};const scenes=[],events=[];
 watchTwitchScene(helper,s=>scenes.push(s),()=>{},e=>events.push(e));
 const event={type:"scene-studio-party",eventId:crypto.randomUUID(),preset:"ducks",actor:"tester",created:Date.now()};
 receive("broadcast","application/json",JSON.stringify(event));receive("broadcast","application/json",JSON.stringify(event));
 receive("broadcast","application/json",JSON.stringify({...event,eventId:crypto.randomUUID(),created:Date.now()-61000}));
 assert.equal(events.length,1);assert.equal(scenes.length,0);
});

test("public chat requires moderation authorization and blocks banned or timed-out viewers before delivery",async t=>{
 const s=setup();t.after(()=>s.db.close());s.db.exec(CHAT_AUTH_SCHEMA);
 Object.assign(s.env,{PUBLIC_CHAT:"true",PARTY_CHANNELS:"",TWITCH_CHAT_CLIENT_ID:"testclient",TWITCH_CHAT_CLIENT_SECRET:"unit-test-only",PUBLIC_SERVICE_URL:"https://service.example"});
 let banned=[],failModeration=false;
 const fetcher=async(url,opts)=>{
  if(url.endsWith("/oauth2/token"))return Response.json({access_token:"testaccess",refresh_token:"testrefresh",token_type:"bearer"});
  if(url.endsWith("/oauth2/validate"))return Response.json({client_id:"testclient",user_id:"123",scopes:["moderation:read"],expires_in:3600});
  if(url.includes("/moderation/banned")){if(failModeration)throw new Error("offline");return Response.json({data:banned});}
  if(url.includes("/helix/users?"))return Response.json({data:[{id:"456",login:"verified_viewer"}]});
  return s.fetcher(url,opts);
 };
 let result=await partyRequest(await s.request(),s.env,"123",s.json,fetcher,now);
 assert.equal(result.status,409);assert.equal(s.calls.length,0);
 const start=await startConnect(s.env,"123",origin,{role:"broadcaster",channel_id:"123",user_id:"123"},now);
 await completeConnect(s.env,`https://service.example/chat/callback?state=${new URL(start.authorizeUrl).searchParams.get("state")}&code=test`,fetcher,now);
 for(const [i,expires] of ["","2030-01-01T00:00:00Z"].entries()){
  banned=[{user_id:"456",expires_at:expires}];
  result=await partyRequest(await s.request(),s.env,"123",s.json,fetcher,now+(i+1)*21000);
  assert.equal(result.status,403);assert.equal(s.calls.length,0);
 }
 banned=[];failModeration=true;
 result=await partyRequest(await s.request(),s.env,"123",s.json,fetcher,now+63000);
 assert.equal(result.status,503);assert.equal(s.calls.length,0);
 failModeration=false;
 result=await partyRequest(await s.request(),s.env,"123",s.json,fetcher,now+84000);
 assert.equal(result.status,200);
 assert.ok(JSON.parse(s.calls[1].opts.body).text.startsWith("verified_viewer "));
 assert.equal(s.calls.length,3);
});

test("free receipt capacity denies new delivery while preserving existing idempotency receipts",async t=>{
 const s=setup();t.after(()=>s.db.close());
 s.db.exec("WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM seq WHERE x<100000) INSERT INTO party_events SELECT '999',CAST(x AS TEXT),'456',0,'sent' FROM seq");
 const result=await partyRequest(await s.request(),s.env,"123",s.json,s.fetcher,now);
 assert.equal(result.status,503);assert.match((await result.json()).error,/storage limit/);
 assert.equal(s.calls.length,1);assert.ok(s.calls[0].url.includes("configurations"),"capacity failure never sends chat or a broadcast");
 assert.equal(s.db.prepare("SELECT count(*) AS n FROM party_events").get().n,100000);
});

test("a banned viewer cannot reserve the shared cooldown or leave a retained receipt",async t=>{
 const s=setup();t.after(()=>s.db.close());
 Object.assign(s.env,{PUBLIC_CHAT:"true",TWITCH_CHAT_CLIENT_ID:"testclient",TWITCH_CHAT_CLIENT_SECRET:"unit-test-only",PUBLIC_SERVICE_URL:"https://service.example"});
 let moderationCalls=0;
 const fetcher=async(url,opts)=>{
  if(url.endsWith("/oauth2/token"))return Response.json({access_token:"testaccess",refresh_token:"testrefresh",token_type:"bearer"});
  if(url.endsWith("/oauth2/validate"))return Response.json({client_id:"testclient",user_id:"123",scopes:["moderation:read"],expires_in:3600});
  if(url.includes("/moderation/banned")){
   moderationCalls++;
   return Response.json({data:new URL(url).searchParams.get("user_id")==="456"?[{user_id:"456",expires_at:""}]:[]});
  }
  if(url.includes("/helix/users?"))return Response.json({data:[{id:new URL(url).searchParams.get("id"),login:"allowed_viewer"}]});
  return s.fetcher(url,opts);
 };
 const start=await startConnect(s.env,"123",origin,{role:"broadcaster",channel_id:"123",user_id:"123"},now);
 await completeConnect(s.env,`https://service.example/chat/callback?state=${new URL(start.authorizeUrl).searchParams.get("state")}&code=test`,fetcher,now);
 const denied=await partyRequest(await s.request(),s.env,"123",s.json,fetcher,now);
 assert.equal(denied.status,403);assert.equal((await denied.json()).uncertain,false);
 assert.equal(s.db.prepare("SELECT count(*) AS n FROM party_events").get().n,0);
 assert.equal(s.calls.length,0);
 const retry=await partyRequest(await s.request(),s.env,"123",s.json,fetcher,now+1);
 assert.equal(retry.status,429);assert.equal(moderationCalls,1,"rejected viewer cannot hammer moderation");
 const allowed=await partyRequest(await s.request({claims:{user_id:"555"}}),s.env,"123",s.json,fetcher,now+2);
 assert.equal(allowed.status,200,"another viewer can celebrate immediately after the rejected attempt");
 assert.deepEqual(s.db.prepare("SELECT user_id,status FROM party_events").all().map(row=>({...row})),[{user_id:"555",status:"sent"}]);
 assert.equal(JSON.parse(s.calls[1].opts.body).text,"allowed_viewer released the emergency ducks. QUACK. 🦆");
});

test("attempt capacity denies new callers without evicting active entries and expired slots are reclaimed",async t=>{
 const s=setup();t.after(()=>s.db.close());
 const add=s.db.prepare("INSERT INTO party_attempts(channel,user_id,expires) VALUES('999',?,?)");
 for(let i=0;i<MAX_PARTY_ATTEMPTS;i++)add.run(String(30000+i),now+20000);
 let result=await partyRequest(await s.request(),s.env,"123",s.json,s.fetcher,now);
 assert.equal(result.status,503);assert.equal(s.calls.length,0);
 assert.equal(s.db.prepare("SELECT count(*) AS n FROM party_attempts").get().n,MAX_PARTY_ATTEMPTS);
 assert.equal(s.db.prepare("SELECT count(*) AS n FROM party_events").get().n,0);
 result=await partyRequest(await s.request(),s.env,"123",s.json,s.fetcher,now+20001);
 assert.equal(result.status,200);assert.equal(s.db.prepare("SELECT count(*) AS n FROM party_attempts").get().n,1);
});

test("concurrent attempts by one viewer make at most one provider delivery",async t=>{
 const s=setup();t.after(()=>s.db.close());
 const requests=await Promise.all([s.request(),s.request()]);
 const results=await Promise.all(requests.map(request=>partyRequest(request,s.env,"123",s.json,s.fetcher,now)));
 assert.deepEqual(results.map(result=>result.status).sort(),[200,429]);
 assert.equal(s.calls.filter(call=>call.url.includes("/chat?")).length,1);
 assert.equal(s.db.prepare("SELECT count(*) AS n FROM party_events").get().n,1);
});

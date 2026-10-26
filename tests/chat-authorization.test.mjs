import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  CHAT_AUTH_SCHEMA, ChatAuthorizationError, startConnect, completeConnect,
  checkViewerModeration, getChatConnection, disconnectChat, validateIdleChatGrants, CHAT_MAX_CONNECTIONS,
} from "../server/chat-authorization.mjs";

const now = Date.now(), origin = "https://example.ext-twitch.tv";
const broadcaster = channel => ({role:"broadcaster",user_id:channel,channel_id:channel});
const expectedError = code => error => error instanceof ChatAuthorizationError && error.code === code;
function fixture() {
  const db = new DatabaseSync(":memory:"); db.exec(CHAT_AUTH_SCHEMA);
  const env = {
    EXTENSION_ORIGIN:origin, EXTENSION_SECRET:Buffer.alloc(32,7).toString("base64"),
    TWITCH_CHAT_CLIENT_ID:"testclient", TWITCH_CHAT_CLIENT_SECRET:"test-client-secret",
    PUBLIC_SERVICE_URL:"https://service.example",
    IMAGES:{prepare(sql) { return {bind(...args) {
      const query = db.prepare(sql), values = Object.fromEntries(args.map((value,index) => [String(index+1),value]));
      return {first:async()=>query.get(values) || null,run:async()=>({meta:query.run(values)}),all:async()=>({results:query.all(values)})};
    }}; }},
  };
  const options = {channel:"123",expired:false,banned:[],failPath:null,validation:{},actorId:"456",refreshes:0};
  const calls = [];
  const fetcher = async (url,init) => {
    calls.push({url,init}); assert.equal(init.redirect,"manual"); assert.ok(init.signal);
    const parsed = new URL(url), body = new URLSearchParams(init.body);
    if (parsed.pathname === options.failPath) throw new Error("provider failure contains secret values");
    if (parsed.pathname === "/oauth2/token") {
      assert.equal(body.get("client_id"),env.TWITCH_CHAT_CLIENT_ID);
      assert.equal(body.get("client_secret"),env.TWITCH_CHAT_CLIENT_SECRET);
      if (body.get("grant_type") === "refresh_token") {
        options.refreshes++; assert.equal(body.get("refresh_token"),"old-refresh%token&encoded");
        await options.refreshGate;
        return Response.json({access_token:"new-access-token",refresh_token:"new-refresh-token",token_type:"bearer"});
      }
      assert.equal(body.get("redirect_uri"),`${env.PUBLIC_SERVICE_URL}/chat/callback`);
      return Response.json({access_token:"old-access-token",refresh_token:"old-refresh%token&encoded",token_type:"bearer"});
    }
    if (parsed.pathname === "/oauth2/validate") {
      if (options.expired && init.headers.Authorization === "OAuth old-access-token") return new Response(null,{status:401});
      return Response.json({client_id:env.TWITCH_CHAT_CLIENT_ID,user_id:options.channel,scopes:["moderation:read"],expires_in:3600,...options.validation});
    }
    if (parsed.pathname === "/helix/moderation/banned") {
      assert.equal(parsed.searchParams.get("broadcaster_id"),options.channel);
      assert.equal(parsed.searchParams.get("user_id"),"456");
      return Response.json({data:options.banned});
    }
    if (parsed.pathname === "/helix/users") return Response.json({data:[{id:options.actorId,login:"actual_viewer"}]});
    if (parsed.pathname === "/oauth2/revoke") { assert.ok(body.get("token")); return new Response(null,{status:200}); }
    throw new Error("Unexpected test request");
  };
  async function begin(channel="123",time=now) {
    const started = await startConnect(env,channel,origin,broadcaster(channel),time);
    const authorization = new URL(started.authorizeUrl);
    assert.equal(authorization.searchParams.get("scope"),"moderation:read");
    assert.equal(authorization.searchParams.get("response_type"),"code");
    return `${env.PUBLIC_SERVICE_URL}/chat/callback?state=${authorization.searchParams.get("state")}&code=test-code`;
  }
  async function connect() { const callback = await begin(); await completeConnect(env,callback,fetcher,now); return callback; }
  return {db,env,options,calls,fetcher,begin,connect};
}

test("OAuth start is bound to authenticated own-channel claims; state is hashed, expiring and single use",async t=>{
  const s=fixture(); t.after(()=>s.db.close());
  for (const [from,claims] of [["https://evil.example",broadcaster("123")],[origin,broadcaster("789")],[origin,{...broadcaster("123"),role:"viewer"}]])
    await assert.rejects(startConnect(s.env,"123",from,claims,now),expectedError("broadcaster_required"));
  const callback=await s.begin(),state=new URL(callback).searchParams.get("state");
  assert.notEqual(s.db.prepare("SELECT state_hash FROM chat_oauth_states").get().state_hash,state);
  await assert.rejects(completeConnect(s.env,callback,s.fetcher,now+600001),expectedError("invalid_state"));
  const next=await s.begin();
  assert.deepEqual(await completeConnect(s.env,next,s.fetcher,now),{connected:true,channel:"123"});
  const requests=s.calls.length;
  await assert.rejects(completeConnect(s.env,next,s.fetcher,now),expectedError("invalid_state"));
  assert.equal(s.calls.length,requests);
  assert.deepEqual(await getChatConnection(s.env,"123",origin,broadcaster("123")),{available:true,connected:true,reconnectRequired:false});
});

test("callback rejects other accounts, clients or missing scope without replacing a working grant",async t=>{
  const s=fixture(); t.after(()=>s.db.close()); await s.connect();
  const previous=s.db.prepare("SELECT encrypted_tokens FROM chat_oauth_grants").get().encrypted_tokens;
  for (const validation of [{user_id:"789"},{client_id:"anotherclient"},{scopes:[]}]) {
    s.options.validation=validation;
    await assert.rejects(completeConnect(s.env,await s.begin(),s.fetcher,now),expectedError("wrong_authorization"));
    assert.equal(s.db.prepare("SELECT encrypted_tokens FROM chat_oauth_grants").get().encrypted_tokens,previous);
  }
});

test("encrypted credentials cannot be read as plaintext or copied to authorize another channel",async t=>{
  const s=fixture(); t.after(()=>s.db.close()); await s.connect();
  const row=s.db.prepare("SELECT * FROM chat_oauth_grants").get();
  assert.equal(JSON.stringify(row).includes("old-access-token"),false);
  assert.equal(JSON.stringify(row).includes("old-refresh"),false);
  s.db.prepare("INSERT INTO chat_oauth_grants(channel,encrypted_tokens,revision,expires) VALUES(?,?,?,?)").run("789",row.encrypted_tokens,row.revision,row.expires);
  await assert.rejects(checkViewerModeration(s.env,"789","456",s.fetcher,now),expectedError("unavailable"));
});

test("moderation rejects bans and timeouts, resolves actual username, and fails closed on outages or mismatched users",async t=>{
  const s=fixture(); t.after(()=>s.db.close());
  await assert.rejects(checkViewerModeration(s.env,"123","456",s.fetcher,now),expectedError("reconnect_required"));
  await s.connect();
  s.options.banned=[{user_id:"456",expires_at:""}];
  assert.deepEqual(await checkViewerModeration(s.env,"123","456",s.fetcher,now),{allowed:false,reason:"banned"});
  s.options.banned=[{user_id:"456",expires_at:new Date(now+60000).toISOString()}];
  assert.deepEqual(await checkViewerModeration(s.env,"123","456",s.fetcher,now),{allowed:false,reason:"timed_out"});
  s.options.banned=[];
  assert.deepEqual(await checkViewerModeration(s.env,"123","456",s.fetcher,now),{allowed:true,actor:"actual_viewer"});
  s.options.actorId="999";
  await assert.rejects(checkViewerModeration(s.env,"123","456",s.fetcher,now),expectedError("unavailable"));
  s.options.failPath="/helix/moderation/banned";
  await assert.rejects(checkViewerModeration(s.env,"123","456",s.fetcher,now),error=>error.code==="unavailable"&&!error.message.includes("secret"));
});

test("expired token refresh is serialized across requests and persists rotated tokens",async t=>{
  const s=fixture(); t.after(()=>s.db.close()); await s.connect(); s.options.expired=true;
  let release, reached; const refreshing=new Promise(resolve=>{reached=resolve;});
  s.options.refreshGate=new Promise(resolve=>{release=resolve;});
  const fetcher=async(url,init)=>{if(url.endsWith("/token"))reached();return s.fetcher(url,init);};
  const first=checkViewerModeration(s.env,"123","456",fetcher,now); await refreshing;
  await assert.rejects(checkViewerModeration(s.env,"123","456",fetcher,now),expectedError("refresh_busy"));
  release(); assert.equal((await first).allowed,true); assert.equal(s.options.refreshes,1);
  assert.equal((await checkViewerModeration(s.env,"123","456",s.fetcher,now+1)).allowed,true);
  assert.equal(s.options.refreshes,1);
  assert.equal(JSON.stringify(s.db.prepare("SELECT * FROM chat_oauth_grants").get()).includes("new-access-token"),false);
});

test("ambiguous refresh failure retains grant while confirmed rejection requires reconnect",async t=>{
  const s=fixture(); t.after(()=>s.db.close()); await s.connect(); s.options.expired=true;
  const previous=s.db.prepare("SELECT encrypted_tokens FROM chat_oauth_grants").get().encrypted_tokens;
  s.options.failPath="/oauth2/token";
  await assert.rejects(checkViewerModeration(s.env,"123","456",s.fetcher,now),expectedError("unavailable"));
  let row=s.db.prepare("SELECT * FROM chat_oauth_grants").get();
  assert.equal(row.encrypted_tokens,previous); assert.equal(row.invalidated,0); assert.equal(row.refresh_lock,null);
  const rejected=(url,init)=>url.endsWith("/token")?Promise.resolve(new Response(null,{status:401})):s.fetcher(url,init);
  await assert.rejects(checkViewerModeration(s.env,"123","456",rejected,now),expectedError("reconnect_required"));
  row=s.db.prepare("SELECT * FROM chat_oauth_grants").get(); assert.equal(row.invalidated,1); assert.equal(row.encrypted_tokens,"");
});

test("a delayed refresh cannot overwrite a newly authorized connection",async t=>{
  const s=fixture(); t.after(()=>s.db.close()); await s.connect(); s.options.expired=true;
  let release,reached; const waiting=new Promise(resolve=>{reached=resolve;});
  s.options.refreshGate=new Promise(resolve=>{release=resolve;});
  const paused=async(url,init)=>{if(url.endsWith("/token"))reached();return s.fetcher(url,init);};
  const pending=checkViewerModeration(s.env,"123","456",paused,now); await waiting;
  s.options.expired=false; await s.connect();
  const replacement=s.db.prepare("SELECT revision FROM chat_oauth_grants").get().revision;
  release(); await assert.rejects(pending,expectedError("connection_changed"));
  assert.equal(s.db.prepare("SELECT revision FROM chat_oauth_grants").get().revision,replacement);
  assert.equal((await checkViewerModeration(s.env,"123","456",s.fetcher,now)).allowed,true);
});

test("disconnect removes local access despite revoke failure and prevents an in-flight callback from restoring it",async t=>{
  const s=fixture(); t.after(()=>s.db.close()); await s.connect();
  await assert.rejects(disconnectChat(s.env,"123",origin,broadcaster("999"),s.fetcher),expectedError("broadcaster_required"));
  const callback=await s.begin(); let release,reached; const waiting=new Promise(resolve=>{reached=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const paused=async(url,init)=>{if(url.endsWith("/token")){reached();await gate;}return s.fetcher(url,init);};
  const pending=completeConnect(s.env,callback,paused,now); await waiting;
  s.options.failPath="/oauth2/revoke";
  assert.deepEqual(await disconnectChat(s.env,"123",origin,broadcaster("123"),s.fetcher),{connected:false,accessRevoked:false});
  release(); await assert.rejects(pending,expectedError("connection_changed"));
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM chat_oauth_grants").get().n,0);
});

test("redirects, oversized provider replies and callback host substitution fail closed",async t=>{
  const s=fixture(); t.after(()=>s.db.close());
  const callback=await s.begin();
  await assert.rejects(completeConnect(s.env,callback.replace("service.example","evil.example"),s.fetcher,now),expectedError("invalid_callback"));
  await assert.rejects(completeConnect(s.env,callback,async()=>new Response(null,{status:302,headers:{Location:"https://evil.example"}}),now),expectedError("unavailable"));
  const another=await s.begin();
  await assert.rejects(completeConnect(s.env,another,async()=>new Response("x".repeat(33000)),now),expectedError("unavailable"));
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM chat_oauth_grants").get().n,0);
});

test("idle validation drains bounded persistent batches and checks future-expiry grants again within an hour",async t=>{
  const s=fixture(); t.after(()=>s.db.close());
  for (const channel of ["121","122","123"]) {
    s.options.channel=channel;
    await completeConnect(s.env,await s.begin(channel),s.fetcher,now);
  }
  const validations=[];
  // All three issued test tokens are identical; associate the mock's response
  // with the sole row claimed for each one-item scheduled batch.
  const provider=async(url,init)=>{
    if (url.endsWith("/validate")) {
      const row=s.db.prepare("SELECT channel FROM chat_oauth_validation WHERE next_check=? ORDER BY channel").get(now+5*60000);
      validations.push(row.channel);
      return Response.json({client_id:s.env.TWITCH_CHAT_CLIENT_ID,user_id:row.channel,scopes:["moderation:read"],expires_in:3600});
    }
    return s.fetcher(url,init);
  };
  const one=await validateIdleChatGrants(s.env,{limit:1,fetcher:provider,now});
  const two=await validateIdleChatGrants(s.env,{limit:1,fetcher:provider,now});
  const three=await validateIdleChatGrants(s.env,{limit:1,fetcher:provider,now});
  assert.deepEqual(validations,["121","122","123"]);
  assert.deepEqual([one.remainingDue,two.remainingDue,three.remainingDue],[2,1,0]);
  assert.equal(one.valid+two.valid+three.valid,3);
  assert.equal((await validateIdleChatGrants(s.env,{fetcher:provider,now:now+54*60000})).processed,0);
  s.options.channel="121";
  const next=await validateIdleChatGrants(s.env,{limit:1,fetcher:s.fetcher,now:now+55*60000});
  assert.equal(next.valid,1); assert.equal(next.remainingDue,2);
  await assert.rejects(validateIdleChatGrants(s.env,{limit:6,fetcher:provider,now}),expectedError("invalid_batch"));
});

test("idle transient outages retain credentials; confirmed revocation clears them and requests reconnect",async t=>{
  const s=fixture(); t.after(()=>s.db.close()); await s.connect();
  const old=s.db.prepare("SELECT encrypted_tokens FROM chat_oauth_grants").get().encrypted_tokens;
  s.options.failPath="/oauth2/validate";
  assert.equal((await validateIdleChatGrants(s.env,{fetcher:s.fetcher,now})).deferred,1);
  assert.equal(s.db.prepare("SELECT encrypted_tokens FROM chat_oauth_grants").get().encrypted_tokens,old);
  assert.equal((await validateIdleChatGrants(s.env,{fetcher:s.fetcher,now:now+60000})).processed,0);
  const revoked=async(url,init)=>url.endsWith("/validate")||url.endsWith("/token")?new Response(null,{status:401}):s.fetcher(url,init);
  const result=await validateIdleChatGrants(s.env,{fetcher:revoked,now:now+5*60000});
  assert.equal(result.reconnectRequired,1);
  const row=s.db.prepare("SELECT * FROM chat_oauth_grants").get();
  assert.equal(row.encrypted_tokens,""); assert.equal(row.invalidated,1);
  assert.equal((await getChatConnection(s.env,"123",origin,broadcaster("123"))).reconnectRequired,true);
  assert.equal((await disconnectChat(s.env,"123",origin,broadcaster("123"),s.fetcher)).connected,false);
});

test("idle validation repairs an expired token but never restores a disconnected grant",async t=>{
  const s=fixture(); t.after(()=>s.db.close()); await s.connect(); s.options.expired=true;
  assert.equal((await validateIdleChatGrants(s.env,{fetcher:s.fetcher,now})).valid,1);
  assert.equal(s.options.refreshes,1);
  let release,reached; const waiting=new Promise(resolve=>{reached=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const paused=async(url,init)=>{if(url.endsWith("/validate")){reached();await gate;}return s.fetcher(url,init);};
  const check=validateIdleChatGrants(s.env,{fetcher:paused,now:now+55*60000}); await waiting;
  await disconnectChat(s.env,"123",origin,broadcaster("123"),s.fetcher); release();
  const result=await check; assert.equal(result.valid,0); assert.equal(result.deferred,1);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM chat_oauth_grants").get().n,0);
});

test("connection capacity is enforced atomically at callback while existing channels may reconnect",async t=>{
  const s=fixture(); t.after(()=>s.db.close());
  const pending=await s.begin();
  const insert=s.db.prepare("INSERT INTO chat_oauth_grants(channel,encrypted_tokens,revision,expires,invalidated) VALUES(?,'','test',0,1)");
  for (let i=0;i<CHAT_MAX_CONNECTIONS;i++) insert.run(String(1000+i));
  await assert.rejects(completeConnect(s.env,pending,s.fetcher,now),expectedError("connection_limit"));
  await assert.rejects(s.begin("999"),expectedError("connection_limit"));
  s.options.channel="1000";
  assert.equal((await completeConnect(s.env,await s.begin("1000"),s.fetcher,now)).connected,true);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM chat_oauth_grants").get().n,CHAT_MAX_CONNECTIONS);
});

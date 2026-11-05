import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import worker from '../server/image-worker.mjs';
import {studioAuth,digest} from '../server/studio-service.mjs';
import {testChannelEnv,studioChannelEnabled,registerStudioChannel} from '../server/tester-access.mjs';
import {experienceExample} from '../src/experience-examples.mjs';

function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  for(const schema of ['studio','experience','card-game'])db.exec(readFileSync(new URL(`../server/${schema}-schema.sql`,import.meta.url),'utf8'));
  const files=new Map();
  const env={STUDIO_ENABLED:'true',STUDIO_ORIGIN:'https://studio.test',STUDIO_URL:'https://studio.test/',PUBLIC_SERVICE_URL:'https://api.test',EXTENSION_ORIGIN:'https://test.ext-twitch.tv',TEST_CHANNELS:'123',TEST_STREAMER_LOGINS:'existing_tester',EXPERIENCES_ENABLED:'true',CARD_GAMES_ENABLED:'true',TWITCH_CHAT_CLIENT_ID:'fixture-client',TWITCH_CHAT_CLIENT_SECRET:'fixture-only',EXTENSION_SECRET:Buffer.from('fixture-only-secret').toString('base64'),
    IMAGES:{prepare(sql){return {bind(...args){const stmt=db.prepare(sql),bound=Object.fromEntries(args.map((v,i)=>[i+1,v]));return {async first(){return stmt.get(bound);},async all(){return {results:stmt.all(bound)};},async run(){return {meta:stmt.run(bound)};}};}};}},
    EXPERIENCE_MEDIA:{async put(key,data){files.set(key,new Uint8Array(data));},async get(key){return files.has(key)?{body:files.get(key)}:null;}}};
  const req=(path,token,body,method=body===undefined?'GET':'POST')=>new Request(`https://api.test${path}`,{method,headers:{Origin:env.STUDIO_ORIGIN,Authorization:`Bearer ${token||''}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const call=(path,token,body,method)=>worker.fetch(req(path,token,body,method),env);
  async function grant(id='9001',login='new_streamer'){
    const verifier='v'.repeat(43),challenge=await digest(verifier);
    const start=await(await call('/studio/auth/start','',{challenge})).json();
    const state=new URL(start.authorizeUrl).searchParams.get('state');
    const response=await studioAuth(req(`/chat/callback?state=${state}&code=fixture`),env,{fetcher:async url=>Response.json(url.endsWith('/token')?{access_token:'fixture-server-only'}:{client_id:env.TWITCH_CHAT_CLIENT_ID,user_id:id,login})});
    return response.status===303?{code:new URL(response.headers.get('location')).hash.slice('#studio_code='.length),verifier}:response;
  }
  async function signIn(id,login){const g=await grant(id,login);if(g instanceof Response)return g;return call('/studio/auth/exchange','',g);}
  return {env,db,files,call,grant,signIn};
}

test('public enrollment requires explicit gate and validated identity; shutdown and blocking revoke access without altering testers',async t=>{
  const {env,db,call,signIn,grant}=fixture(t);
  for(const value of [undefined,'false','TRUE']){env.STUDIO_PUBLIC_ENABLED=value;assert.equal((await signIn()).status,403);}
  assert.equal(db.prepare("SELECT count(*) AS n FROM studio_auth WHERE kind='studio_channel'").get().n,0);
  env.STUDIO_PUBLIC_ENABLED='true';
  const host=await(await signIn()).json();assert.match(host.token,/^ss_/);
  assert.equal(env.TEST_CHANNELS,'123');assert.equal(env.STUDIO_CHANNEL,undefined);
  assert.equal((await call('/studio/auth/session',host.token)).status,200);
  assert.equal((await call('/v1/cards/9002/game',host.token)).status,403);
  assert.equal((await call('/v1/channel/9002/history',host.token)).status,403);
  assert.equal((await call('/experiences/9002',host.token,{})).status,403);
  const scope=await testChannelEnv(env,'9001');assert.equal(studioChannelEnabled(scope,'9001'),true);
  assert.equal(studioChannelEnabled(scope,'9002'),false);
  assert.equal(studioChannelEnabled(await testChannelEnv(scope,'9002'),'9001'),false,'request scope cannot leak to another channel');
  const waiting=await grant('9002','second_streamer');
  env.STUDIO_PUBLIC_ENABLED='false';
  assert.equal((await call('/studio/auth/exchange','',waiting)).status,403,'gate is rechecked after OAuth callback');
  assert.equal((await call('/studio/auth/session',host.token)).status,403);
  assert.equal((await call('/test-room/manage',host.token)).status,403);
  assert.equal((await signIn('123','existing_channel')).status,200,'explicit tester still works');
  assert.equal((await signIn('456','existing_tester')).status,200,'named tester still works');
  env.STUDIO_PUBLIC_ENABLED='true';env.STUDIO_BLOCKED_CHANNELS='9001';
  assert.equal((await call('/studio/auth/session',host.token)).status,403);
  assert.equal((await signIn()).status,403,'blocked channel cannot re-enroll');
  assert.equal((await call('/studio/auth/session',(await(await signIn('123','existing_channel')).json()).token)).status,200);
});

test('public sessions expire, sign out and lose access when enrollment is revoked; room shutdown remains separate',async t=>{
  const {env,db,call,signIn}=fixture(t);env.STUDIO_PUBLIC_ENABLED='true';
  const host=await(await signIn()).json();
  const room=await(await call('/test-room/manage',host.token,{})).json();
  const guest=await(await call('/test-room/join',room.invite,{})).json();
  assert.equal((await call('/test-room/play/scene',guest.token)).status,200);
  assert.equal((await call('/studio/auth/session',host.token,undefined,'DELETE')).status,200);
  assert.equal((await call('/studio/auth/session',host.token)).status,401);
  assert.equal((await call('/test-room/play/scene',guest.token)).status,200,'sign-out does not close a room');
  const again=await(await signIn()).json();
  db.prepare('UPDATE studio_auth SET expires=0 WHERE hash=?').run(await digest(again.token));
  assert.equal((await call('/studio/auth/session',again.token)).status,401);
  const current=await(await signIn()).json();
  db.prepare("DELETE FROM studio_auth WHERE kind='studio_channel' AND proof='9001'").run();
  assert.equal((await call('/studio/auth/session',current.token)).status,403);
  assert.equal((await call('/test-room/play/scene',guest.token)).status,403);
  await signIn(); // explicit, newly validated OAuth can enroll again
  env.STUDIO_PUBLIC_ENABLED='false';
  assert.equal((await call('/test-room/play/scene',guest.token)).status,403);
  assert.equal(db.prepare("SELECT count(*) AS n FROM studio_auth WHERE kind='test_room'").get().n,1,'gate rollback retains the room');
  env.STUDIO_PUBLIC_ENABLED='true';env.TEST_ROOMS_RELEASED='true';
  assert.equal((await call('/test-room/play/scene',guest.token)).status,410);
});

test('public experience uploads retain ownership, schema and storage limits without enabling PUBLIC_EXPERIENCES',async t=>{
  const {env,db,call,signIn,files}=fixture(t);env.STUDIO_PUBLIC_ENABLED='true';
  const host=await(await signIn()).json();
  const design=experienceExample('story');
  const uploaded=await call('/experiences/9001',host.token,design);
  assert.equal(uploaded.status,201,JSON.stringify(await uploaded.clone().json()));
  assert.equal(files.size,1);assert.equal(env.PUBLIC_EXPERIENCES,undefined);
  assert.equal((await call('/experiences/9001',host.token,{...design,unsupportedNewFeature:true})).status,400);
  assert.equal((await call('/experiences/9002',host.token,design)).status,403);
  db.prepare('INSERT INTO experience_files(key,channel,bytes,ready,created) VALUES(?,?,?,?,?)').run('quota-fixture','9001',500000000,1,Date.now());
  assert.equal((await call('/experiences/9001',host.token,{...design,name:'different content'})).status,409);
  assert.equal(files.size,1,'quota rejection writes no new object');
  env.STUDIO_BLOCKED_CHANNELS='9001';
  assert.equal((await call('/experiences/9001',host.token,design)).status,403);
});

test('production enrollment is bounded and does not register arbitrary supplied identities',async t=>{
  const {env,db}=fixture(t);
  await registerStudioChannel(env,{id:'9001',login:'new_streamer'});
  assert.equal(db.prepare('SELECT count(*) AS n FROM studio_auth').get().n,0);
  env.STUDIO_PUBLIC_ENABLED='true';
  await assert.rejects(registerStudioChannel(env,{id:'wrong',login:'new_streamer'}));
  await registerStudioChannel(env,{id:'9001',login:'new_streamer'});
  db.exec("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<9999) INSERT INTO studio_auth SELECT 'fixture-'||x,'state','','',9000000000000 FROM n");
  await assert.rejects(registerStudioChannel(env,{id:'9002',login:'second_streamer'}),/busy/);
  await registerStudioChannel(env,{id:'9001',login:'renamed_streamer'});
  assert.equal(db.prepare('SELECT count(*) AS n FROM studio_auth').get().n,10000);
});

test('existing native player credentials read an enrolled public channel but cannot become its owner',async t=>{
  const {env,signIn}=fixture(t);env.STUDIO_PUBLIC_ENABLED='true';await signIn();
  const encoded=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const input=`${encoded({alg:'HS256',typ:'JWT'})}.${encoded({role:'viewer',channel_id:'9001',user_id:'777',opaque_user_id:'U777',exp:Math.floor(Date.now()/1000)+60})}`;
  const token=input+'.'+createHmac('sha256',Buffer.from(env.EXTENSION_SECRET,'base64')).update(input).digest('base64url');
  const native=(path,body)=>worker.fetch(new Request('https://api.test'+path,{method:body?'POST':'GET',headers:{Origin:env.EXTENSION_ORIGIN,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);
  const response=await native('/v1/channel/9001/scene');assert.equal(response.status,200);
  const scene=await response.json();assert.equal(scene.schema,1);assert.equal(scene.requires.protocol,1);
  assert.equal((await native('/v1/cards/9001/game')).status,404,'public enrollment does not grant catalog rights');
  env.CARD_TEST_CHANNELS='9001';
  assert.equal((await native('/v1/cards/9001/game')).status,200,'separate explicit card pilot');
  env.CARD_TEST_CHANNELS='';
  assert.equal((await native('/v1/cards/9001/game')).status,404,'pilot revocation applies to existing credentials');
  assert.equal((await native('/v1/channel/9001/history')).status,403);
  assert.equal((await native('/v1/channel/9001/scene',{revision:1,scene:{}})).status,403);
  assert.equal((await native('/experiences/9001',experienceExample('story'))).status,401);
  assert.ok([401,403].includes((await native('/v1/channel/9002/scene')).status));
  env.STUDIO_PUBLIC_ENABLED='false';assert.equal((await native('/v1/channel/9001/scene')).status,403);
});

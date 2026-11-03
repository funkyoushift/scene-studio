import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {testRoomRequest,TEST_ROOM_OPEN_ENDED,extendOpenTestRooms} from '../server/test-room-service.mjs';
import {digest,studioSession,studioAuth,studioGateway,channelSceneRequest} from '../server/studio-service.mjs';
import worker,{extensionClaims} from '../server/image-worker.mjs';
import {testChannelEnv,registerTester,requestTestChannelEnv} from '../server/tester-access.mjs';
import {newCardGame,cardTransition} from '../src/card-game.mjs';
import {starterScene} from '../src/scene.mjs';
import {roomAutomationFetch,twitchVideoUrl} from '../src/test-room-client.mjs';
const now=100000,hostToken='ss_'+'a'.repeat(43);
async function fixture(){
  const db=new DatabaseSync(':memory:');
  for(const file of ['studio-schema.sql','card-game-schema.sql'])db.exec(readFileSync(new URL(`../server/${file}`,import.meta.url),'utf8'));
  const env={db,STUDIO_ENABLED:'true',STUDIO_ORIGIN:'https://studio.test',STUDIO_URL:'https://studio.test/scene-studio/',PUBLIC_SERVICE_URL:'https://api.test',EXTENSION_ORIGIN:'https://test.ext-twitch.tv',TEST_CHANNELS:'123',CARD_GAMES_ENABLED:'true',EXPERIENCE_MEDIA:{get:async()=>null},IMAGES:{prepare(sql){return{bind(...args){const statement=db.prepare(sql),bound=Object.fromEntries(args.map((v,i)=>[i+1,v]));return{async first(){return statement.get(bound);},async all(){return{results:statement.all(bound)};},async run(){return{meta:statement.run(bound)};}};}};}}};
  db.prepare('INSERT INTO studio_auth VALUES(?,?,?,?,?)').run(await digest(hostToken),'session','',JSON.stringify({channelId:'123',profile:{id:'123',login:'tester'}}),now+3600000);
  db.prepare('INSERT INTO channel_scenes VALUES(?,?,?,?)').run('123',1,JSON.stringify({...starterScene(),name:'Test scene',objects:[]}),now);
  const call=(route,token=hostToken,method='GET',body,clock=now,origin=env.STUDIO_ORIGIN)=>testRoomRequest(new Request(`https://api.test/test-room/${route}`,{method,headers:{Origin:origin,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{now:clock});
  return {env,db,call};
}
test('owner creates one revocable room; two guests read its scene, never owner routes',async()=>{
  const {call,db}=await fixture();
  const created=await(await call('manage',hostToken,'POST')).json();
  assert.match(created.invite,/^tr_/);assert.match(created.url,/test-room.html#room=tr_/);
  assert.equal((await(await call('manage')).json()).roomId,created.roomId);
  assert.equal((await call('manage',hostToken,'POST')).status,409);
  const a=await(await call('join',created.invite,'POST')).json(),b=await(await call('join',created.invite,'POST')).json();
  assert.notEqual(a.token,b.token);assert.equal(a.profile.login,'tester');assert.equal(a.user_id,undefined);
  assert.equal((await(await call('play/scene',a.token)).json()).scene.name,'Test scene');
  for(const route of ['manage','play/history','play/fire','play/config/123'])assert.ok([401,404].includes((await call(route,a.token)).status));
  assert.equal((await call('play/scene',a.token,'POST',{scene:{}})).status,405);
  assert.equal((await call('play/cards',a.token,'POST',{type:'close'})).status,403);
  assert.equal((await call('manage',a.token,'DELETE')).status,401);
  assert.equal((await call('play/scene',hostToken)).status,401);
  assert.equal((await call('play/scene',a.token,'GET',undefined,now,'https://evil.test')).status,403);
  assert.equal((await call('manage',hostToken,'DELETE')).status,200);
  for(const token of [a.token,b.token])assert.equal((await call('play/scene',token)).status,410);
  assert.equal((await call('join',created.invite,'POST')).status,410);
  assert.equal(db.prepare('SELECT name FROM sqlite_master WHERE name=?').get('channel_scenes').name,'channel_scenes');
});
test('guest expiry, tampering and room rotation cannot regain access',async()=>{
  const {call}=await fixture();const room=await(await call('manage',hostToken,'POST')).json();
  const a=await(await call('join',room.invite,'POST')).json();
  assert.equal((await call('play/scene',a.token,'GET',undefined,a.expiresAt)).status,401);
  assert.equal(room.expiresAt,null);
  assert.equal((await call('join',room.invite,'POST',undefined,now+90*86400000)).status,200);
  assert.equal((await call('play/scene',a.token.slice(0,-3)+'xyz')).status,401);
  await call('manage',hostToken,'DELETE');const next=await(await call('manage',hostToken,'POST')).json();
  assert.notEqual(next.invite,room.invite);assert.notEqual(next.roomId,room.roomId);assert.ok([401,410].includes((await call('play/scene',a.token)).status));
});
test('release retires persistent rooms; migrating open rooms preserves links and expired guest credentials',async()=>{
  const {env,db,call}=await fixture();const room=await(await call('manage',hostToken,'POST')).json();
  const guest=await(await call('join',room.invite,'POST')).json();
  db.prepare("UPDATE studio_auth SET expires=? WHERE kind='test_room'").run(now+86400000);
  db.prepare('INSERT INTO studio_auth VALUES(?,?,?,?,?)').run('old-closed','test_room','999','{}',now-1);
  assert.equal((await extendOpenTestRooms(env,now)).meta.changes,1);
  assert.equal(db.prepare("SELECT expires FROM studio_auth WHERE proof='123' AND kind='test_room'").get().expires,TEST_ROOM_OPEN_ENDED);
  assert.equal(db.prepare("SELECT expires FROM studio_auth WHERE hash='old-closed'").get().expires,now-1);
  assert.equal((await(await call('manage')).json()).roomId,room.roomId);
  assert.equal((await call('join',room.invite,'POST',undefined,now+365*86400000)).status,200);
  assert.equal((await call('play/scene',guest.token,'GET',undefined,guest.expiresAt)).status,401);
  env.TEST_ROOMS_RELEASED='true';
  assert.equal((await call('join',room.invite,'POST')).status,410);
  assert.equal((await call('play/scene',guest.token)).status,410);
  assert.equal((await call('manage',hostToken,'POST')).status,410);
  assert.equal((await call('manage',hostToken,'DELETE')).status,200);
});
test('guest card seats and private hands are distinct; guests cannot impersonate host',async()=>{
  const {call,db}=await fixture();const room=await(await call('manage',hostToken,'POST')).json();
  const a=await(await call('join',room.invite,'POST')).json(),b=await(await call('join',room.invite,'POST')).json();
  const deck={white:Array.from({length:150},(_,i)=>({text:`Answer ${i}`})),black:Array.from({length:12},(_,i)=>({text:`Prompt ${i}: _`,pick:1,draw:0})),available:{white:150,black:12},packs:[{id:'fixture',name:'Original test cards'}]};
  let game=cardTransition(newCardGame('123',{},deck,now),'123',{type:'join'},now);
  db.prepare('INSERT INTO card_games(channel,revision,game,expires) VALUES(?,?,?,?)').run('123',game.revision,JSON.stringify(game),game.expires);
  async function act(token,action){const state=await(await call('play/cards',token)).json();return call('play/cards',token,'POST',{...action,gameId:state.game.id,revision:state.game.revision});}
  assert.equal((await act(a.token,{type:'join',user_id:'123'})).status,200);
  assert.equal((await act(b.token,{type:'join'})).status,200);
  game=JSON.parse(db.prepare('SELECT game FROM card_games').get().game);game=cardTransition(game,'123',{type:'start'},now);
  db.prepare('UPDATE card_games SET game=?,revision=?').run(JSON.stringify(game),game.revision);
  const av=(await(await call('play/cards',a.token)).json()).game,bv=(await(await call('play/cards',b.token)).json()).game;
  assert.notEqual(av.me,bv.me);assert.equal(av.isHost,false);assert.ok(av.hand.length>0);assert.ok(bv.hand.length>0);
  assert.equal(av.hand.some(c=>bv.hand.some(other=>other.id===c.id)),false);
  assert.equal((await act(a.token,{type:'start'})).status,403);
  assert.equal((await act(a.token,{type:'kick',player:bv.me})).status,403);
});
test('approved streamer names bind only to server-verified identities and stay revocable',async()=>{
  const {env,db}=await fixture();env.TEST_STREAMER_LOGINS='approved';
  await registerTester(env,{id:'456',login:'stranger'});assert.equal((await testChannelEnv(env,'456')).TEST_CHANNELS,'123');
  await registerTester(env,{id:'456',login:'approved'});assert.equal((await testChannelEnv(env,'456')).TEST_CHANNELS,'123,456');
  assert.equal((await requestTestChannelEnv(new Request('https://api.test/v1/cards/456/game'),env)).TEST_CHANNELS,'123,456');
  assert.equal((await testChannelEnv(env,'789')).TEST_CHANNELS,'123');
  const token='ss_'+'b'.repeat(43);db.prepare('INSERT INTO studio_auth VALUES(?,?,?,?,?)').run(await digest(token),'session','',JSON.stringify({channelId:'456',profile:{id:'456',login:'approved'}}),now+50000);
  const req=new Request('https://api.test/',{headers:{Authorization:`Bearer ${token}`}});assert.equal((await studioSession(req,env,now)).channelId,'456');
  env.TEST_STREAMER_LOGINS='';assert.equal((await testChannelEnv(env,'456')).TEST_CHANNELS,'123');await assert.rejects(()=>studioSession(req,env,now),/not enabled/);
});
test('website request adapter admits only the room channel and read-only moment routes',async()=>{
  let count=0;const adapter=roomAutomationFetch({channelId:'123',token:'guest'},()=>{},async(url,options)=>{count++;assert.ok(url.endsWith('/test-room/play/active'));assert.equal(options.headers.Authorization,'Bearer guest');return Response.json({});});
  const base='https://scene-studio-images.scene-studio-free-prototype.workers.dev';
  await adapter(`${base}/v1/automations/123/active`);
  for(const url of [`${base}/v1/automations/456/active`,`${base}/v1/automations/123/fire`,'https://evil.test/v1/automations/123/active'])await assert.rejects(()=>adapter(url));
  assert.equal(count,1);assert.match(twitchVideoUrl('tester','studio.test'),/parent=studio.test/);assert.throws(()=>twitchVideoUrl('bad/name','studio.test'));
});

for(const publicAccess of [false,true]) test(`${publicAccess?'two unlisted public streamers':'two newly approved streamers'} sign in, bootstrap independent rooms, and host isolated games through the website gateway`,async()=>{
  const {env,db}=await fixture();
  Object.assign(env,{TEST_STREAMER_LOGINS:'scootermagoo,x_bella_beast_x',TWITCH_CHAT_CLIENT_ID:'fixture-client',TWITCH_CHAT_CLIENT_SECRET:'fixture-only',EXTENSION_SECRET:Buffer.from('fixture-only-secret').toString('base64')});
  const catalog={version:'0123456789abcdef',shards:1,packs:[{id:'cah:0',name:'Original fixture cards'}]};
  const deck={catalogVersion:catalog.version,packs:catalog.packs,available:{white:150,black:12},white:Array.from({length:150},(_,i)=>({text:`Answer ${i}`})),black:Array.from({length:12},(_,i)=>({text:`Prompt ${i}: _`,pick:1,draw:0}))};
  env.EXPERIENCE_MEDIA={get:async key=>key.endsWith('catalog.json')?{json:async()=>catalog}:null};
  const req=(path,token,body,method=body?'POST':'GET')=>new Request(`https://api.test${path}`,{method,headers:{Origin:env.STUDIO_ORIGIN,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const call=(path,token,body,method)=>worker.fetch(req(path,token,body,method),env);
  async function okay(response){const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;}
  async function signIn(id,login){
    const verifier='v'.repeat(43),challenge=await digest(verifier);
    const start=await okay(await studioAuth(req('/studio/auth/start','',{challenge}),env));
    const state=new URL(start.authorizeUrl).searchParams.get('state');
    const callback=await studioAuth(req(`/chat/callback?state=${state}&code=fixture`),env,{fetcher:async url=>Response.json(url.endsWith('/token')?{access_token:'fixture-server-only'}:{client_id:env.TWITCH_CHAT_CLIENT_ID,user_id:id,login})});
    if(callback.status!==303)return callback;
    const code=new URL(callback.headers.get('location')).hash.slice('#studio_code='.length);
    return okay(await call('/studio/auth/exchange','',{code,verifier}));
  }
  // Synthetic IDs only: no use of or sign-in to anybody's real account.
  assert.equal((await signIn('9003','unapproved')).status,403);
  if(publicAccess){env.STUDIO_PUBLIC_ENABLED='true';env.TEST_STREAMER_LOGINS='';}
  const hosts=[await signIn('9001','scootermagoo'),await signIn('9002','x_bella_beast_x')];
  const rooms=[],guests=[];
  for(const [i,host] of hosts.entries()){
    assert.equal(host.channelId,`900${i+1}`);
    assert.equal(env.TEST_CHANNELS,'123','dynamic enablement must not mutate the shared environment');
    const sceneRequest=req(`/v1/channel/${host.channelId}/scene`,host.token);
    const initial=await studioGateway(sceneRequest,env,async(internal,scoped)=>{
      const claims=await extensionClaims(internal,scoped.EXTENSION_SECRET,host.channelId);
      return channelSceneRequest(internal,scoped,{channel:host.channelId,route:'scene',claims},(data,status=200)=>Response.json(data,{status}),{fetcher:async()=>Response.json({data:[]})});
    });
    assert.equal((await okay(initial)).revision,1,'a streamer with no old extension setup gets an initial scene');
    assert.deepEqual((await okay(await call(`/v1/cards/${host.channelId}/catalog`,host.token))).packs,catalog.packs);
    rooms.push(await okay(await call('/test-room/manage',host.token,{})));
    assert.equal(rooms[i].expiresAt,null);
    guests.push(await Promise.all([1,2].map(async()=>okay(await call('/test-room/join',rooms[i].invite,{})))));
    assert.ok(guests[i].every(g=>g.channelId===host.channelId&&g.profile.login===host.profile.login));
    await okay(await call(`/v1/channel/${host.channelId}/scene`,host.token,{revision:1,scene:{...starterScene(),objects:[],name:`${host.profile.login}'s scene`}}));
    assert.equal((await okay(await call('/test-room/play/scene',guests[i][0].token))).scene.name,`${host.profile.login}'s scene`);
    const created=await okay(await call(`/v1/cards/${host.channelId}/game`,host.token,{type:'create',catalogVersion:catalog.version,deck,rules:{handSize:i?7:5,winningScore:0,roundLimit:1,seconds:0}}));
    assert.equal(created.game.isHost,true);assert.equal(created.game.rules.handSize,i?7:5);
  }
  assert.notEqual(rooms[0].roomId,rooms[1].roomId);
  async function hostAction(i,action){const host=hosts[i],path=`/v1/cards/${host.channelId}/game`,state=await okay(await call(path,host.token));return okay(await call(path,host.token,{...action,gameId:state.game.id,revision:state.game.revision}));}
  async function guestAction(i,j,action){const token=guests[i][j].token,state=await okay(await call('/test-room/play/cards',token));return okay(await call('/test-room/play/cards',token,{...action,gameId:state.game.id,revision:state.game.revision}));}
  for(let i=0;i<2;i++){
    for(let j=0;j<2;j++)await guestAction(i,j,{type:'join'});
    await hostAction(i,{type:'start'});
  }
  const a=(await okay(await call('/test-room/play/cards',guests[0][0].token))).game;
  const b=(await okay(await call('/test-room/play/cards',guests[1][0].token))).game;
  assert.notEqual(a.id,b.id);assert.equal(a.hand.length,5);assert.equal(b.hand.length,7);
  assert.equal((await call(`/v1/cards/${hosts[1].channelId}/game`,hosts[0].token)).status,403);
  assert.equal((await call('/test-room/play/cards',guests[0][0].token,{type:'submit',gameId:b.id,revision:b.revision,cards:[b.hand[0].id],channelId:hosts[1].channelId})).status,409);
  assert.equal((await call('/test-room/play/cards',guests[0][0].token,{type:'close'})).status,403);
  for(let i=0;i<2;i++){
    for(let j=0;j<2;j++){
      const state=(await okay(await call('/test-room/play/cards',guests[i][j].token))).game;
      await guestAction(i,j,{type:'submit',cards:[state.hand[0].id]});
    }
    const host=hosts[i],state=(await okay(await call(`/v1/cards/${host.channelId}/game`,host.token))).game;
    assert.equal(state.phase,'judging');assert.equal(state.submissions.length,2);
    assert.ok(state.submissions.every(s=>!('player' in s)&&!('user' in s)));
    await hostAction(i,{type:'judge',submission:state.submissions[0].id});
    const final=(await hostAction(i,{type:'next'})).game;
    assert.equal(final.phase,'finished');assert.equal(final.players.reduce((n,p)=>n+p.score,0),1);
    for(const guest of guests[i])assert.deepEqual((await okay(await call('/test-room/play/cards',guest.token))).game.players,final.players);
  }
  await okay(await call('/test-room/manage',hosts[0].token,undefined,'DELETE'));
  assert.equal((await call('/test-room/play/cards',guests[0][0].token)).status,410);
  assert.equal((await call('/test-room/play/cards',guests[1][0].token)).status,200);
  if(publicAccess)env.STUDIO_BLOCKED_CHANNELS=hosts[1].channelId;
  else env.TEST_STREAMER_LOGINS='scootermagoo';
  assert.equal((await call('/test-room/manage',hosts[1].token)).status,403);
  assert.equal((await call('/test-room/play/cards',guests[1][0].token)).status,403);
  db.close();
});

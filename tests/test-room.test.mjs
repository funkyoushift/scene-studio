import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {testRoomRequest} from '../server/test-room-service.mjs';
import {digest,studioSession} from '../server/studio-service.mjs';
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
test('expiry, tampering and room rotation cannot regain access',async()=>{
  const {call}=await fixture();const room=await(await call('manage',hostToken,'POST')).json();
  const a=await(await call('join',room.invite,'POST')).json();
  assert.equal((await call('play/scene',a.token,'GET',undefined,a.expiresAt)).status,401);
  assert.equal((await call('join',room.invite,'POST',undefined,room.expiresAt)).status,410);
  assert.equal((await call('play/scene',a.token.slice(0,-3)+'xyz')).status,401);
  await call('manage',hostToken,'DELETE');const next=await(await call('manage',hostToken,'POST')).json();
  assert.notEqual(next.invite,room.invite);assert.equal((await call('play/scene',a.token)).status,410);
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

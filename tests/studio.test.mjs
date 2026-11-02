import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {studioAuth,studioGateway,digest,channelSceneRequest,publishedScene,studioRouteChannel} from '../server/studio-service.mjs';
import {extensionClaims} from '../server/image-worker.mjs';
import {starterScene} from '../src/scene.mjs';
import {pollPublishedScene} from '../src/player-channel.mjs';
import {signOutStudio} from '../src/studio-client.mjs';
const host={role:'broadcaster',user_id:'123',channel_id:'123'};
const scene={...starterScene(),objects:[]};
const json=(data,status=200)=>Response.json(data,{status});
test('studio moment-save preflight permits PUT only from the configured website',async()=>{
  const e=env();let forwarded=false;
  const res=await studioGateway(request('/v1/automations/123/config',null,'OPTIONS'),e,()=>{forwarded=true;});
  assert.equal(res.status,204);assert.equal(res.headers.get('Access-Control-Allow-Origin'),e.STUDIO_ORIGIN);
  assert.ok(res.headers.get('Access-Control-Allow-Methods').split(', ').includes('PUT'));assert.equal(forwarded,false);
  assert.equal(await studioGateway(request('/v1/automations/123/config',null,'OPTIONS','https://other.test'),e,()=>{}),null);
});
function env(){
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../server/studio-schema.sql',import.meta.url),'utf8'));
  return {db,STUDIO_ENABLED:'true',STUDIO_ORIGIN:'https://studio.test',STUDIO_URL:'https://studio.test/project/',PUBLIC_SERVICE_URL:'https://api.test',TEST_CHANNELS:'123',TWITCH_CHAT_CLIENT_ID:'client',TWITCH_CHAT_CLIENT_SECRET:'fixture',EXTENSION_SECRET:Buffer.from('fixture secret only').toString('base64'),EXTENSION_ORIGIN:'https://test.ext-twitch.tv',IMAGES:{prepare(sql){return{bind(...args){const query=db.prepare(sql),values=Object.fromEntries(args.map((v,i)=>[i+1,v]));return{async first(){return query.get(values);},async all(){return{results:query.all(values)};},async run(){return{meta:query.run(values)};}};}};}}};
}
function request(path,body,method=body?'POST':'GET',origin='https://studio.test',token){return new Request(`https://api.test${path}`,{method,headers:{Origin:origin,...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});}
async function login(e){
  const verifier='a'.repeat(43),challenge=await digest(verifier);
  const start=await studioAuth(request('/studio/auth/start',{challenge}),e);
  assert.equal(start.status,200);const state=new URL((await start.json()).authorizeUrl).searchParams.get('state');
  const callback=request(`/chat/callback?state=${state}&code=fixture-code`);
  const fetcher=async url=>Response.json(url.endsWith('/token')?{access_token:'server-only'}:{client_id:'client',user_id:'123',login:'fixture'});
  const result=await studioAuth(callback,e,{fetcher});assert.equal(result.status,303);
  const code=new URL(result.headers.get('location')).hash.slice('#studio_code='.length);
  return {verifier,code,callback,fetcher};
}
test('studio OAuth binds state, browser proof, account and one-use grant; session expires and revokes',async()=>{
  const e=env();const flow=await login(e);
  assert.equal((await studioAuth(flow.callback,e,{fetcher:flow.fetcher})).status,400);
  assert.equal((await studioAuth(request('/studio/auth/exchange',{code:flow.code,verifier:'b'.repeat(43)}),e)).status,401);
  const exchange=()=>studioAuth(request('/studio/auth/exchange',{code:flow.code,verifier:flow.verifier}),e);
  const auth=await (await exchange()).json();assert.match(auth.token,/^ss_/);assert.equal(auth.channelId,'123');assert.equal(auth.access_token,undefined);
  assert.equal((await exchange()).status,401);
  assert.equal((await studioAuth(request('/studio/auth/session',null,'GET',e.STUDIO_ORIGIN,auth.token),e)).status,200);
  assert.equal((await studioAuth(request('/studio/auth/session',null,'GET','https://evil.test',auth.token),e)).status,403);
  assert.equal((await studioAuth(request('/studio/auth/session',null,'GET',e.STUDIO_ORIGIN,auth.token),e,{now:auth.expiresAt+1})).status,401);
  assert.equal((await studioAuth(request('/studio/auth/session',null,'DELETE',e.STUDIO_ORIGIN,auth.token),e)).status,200);
  assert.equal((await studioAuth(request('/studio/auth/session',null,'GET',e.STUDIO_ORIGIN,auth.token),e)).status,401);
});
test('studio gateway never trusts a browser channel or creates a usable external extension credential',async()=>{
  const e=env(),flow=await login(e),auth=await(await studioAuth(request('/studio/auth/exchange',flow),e)).json();
  let called=0;
  const forward=async req=>{called++;assert.equal(req.headers.get('origin'),e.EXTENSION_ORIGIN);const claims=await extensionClaims(req,e.EXTENSION_SECRET,'123',Date.now(),true);assert.equal(claims.user_id,'123');return Response.json({ok:true});};
  const result=await studioGateway(request('/v1/cards/123/catalog',null,'GET',e.STUDIO_ORIGIN,auth.token),e,forward);
  assert.equal(result.status,200);assert.equal(result.headers.get('access-control-allow-origin'),e.STUDIO_ORIGIN);assert.deepEqual(await result.json(),{ok:true});
  assert.equal((await studioGateway(request('/v1/cards/999/catalog',null,'GET',e.STUDIO_ORIGIN,auth.token),e,forward)).status,403);assert.equal(called,1);
  for(const path of ['/eventsub/chat/123','/chat/callback','/v2/channels/123/events','/v1/cards/123/../../999/catalog'])assert.equal(studioRouteChannel(path),undefined);
});
test('channel migration preserves Twitch scene, rejects stale writes and isolates rollback history',async()=>{
  const e=env();let imports=0;
  const fetcher=async()=>{imports++;return Response.json({data:[{segment:'broadcaster',broadcaster_id:'123',content:JSON.stringify({...scene,name:'Original Twitch design'})}]});};
  const call=(route,body,claims=host)=>channelSceneRequest(request(`/v1/channel/123/${route}`,body),e,{channel:'123',route,claims},json,{fetcher});
  assert.deepEqual(await(await call('scene',null,{role:'viewer'})).json(),{schema:1,revision:0,scene:null});assert.equal(imports,0);
  assert.equal((await(await call('scene')).json()).scene.name,'Original Twitch design');await call('scene');assert.equal(imports,1);
  assert.equal((await call('scene',{revision:1,scene:{...scene,name:'New maze'}})).status,200);
  assert.equal((await call('scene',{revision:1,scene})).status,409);
  assert.equal((await call('scene',{revision:2,scene},{role:'viewer'})).status,403);
  assert.equal((await call('rollback',{revision:2,targetRevision:999})).status,404);
  const restored=await(await call('rollback',{revision:2,targetRevision:1})).json();assert.equal(restored.revision,3);assert.equal(restored.scene.name,'Original Twitch design');
  for(let revision=3;revision<24;revision++)await call('scene',{revision,scene});
  const history=await(await call('history')).json();assert.equal(history.history.length,20);assert.equal(history.history[0].revision,24);
  assert.throws(()=>publishedScene({...scene,experience:{kind:'experience-ref',name:'Foreign maze',enabled:true,url:'https://scene-studio-images.scene-studio-free-prototype.workers.dev/experiences/999/'+ 'a'.repeat(64)+'.json'}},'123'),/own channel/);
});
test('failed Twitch import leaves no channel scene and never starts blank',async()=>{
  const e=env();const res=await channelSceneRequest(request('/v1/channel/123/scene'),e,{channel:'123',route:'scene',claims:host},json,{fetcher:async()=>new Response('',{status:503})});
  assert.equal(res.status,503);assert.equal(e.db.prepare('SELECT count(*) AS n FROM channel_scenes').get().n,0);
});
test('same player accepts new revisions, keeps valid scene after bad data and ignores disposed replies',async()=>{
  let next,answer={schema:1,revision:1,scene},auth={channelId:'123',token:'fixture'},seen=[];
  const stop=pollPublishedScene(()=>auth,s=>seen.push(s.name),{fetcher:async()=>Response.json(answer),schedule:fn=>{next=fn;},cancel(){}});
  await new Promise(r=>setImmediate(r));assert.equal(seen.length,1);
  answer={schema:1,revision:2,scene:{...scene,name:'Second maze'}};await next();assert.equal(seen.at(-1),'Second maze');
  answer={schema:1,revision:3,scene:{evil:true}};await next();assert.equal(seen.length,2);
  answer={schema:2,revision:4,scene};await next();assert.equal(seen.length,2);
  stop();answer={schema:1,revision:5,scene};await next();assert.equal(seen.length,2);
});
test('expired studio session can sign out; service outages keep the recoverable session',async()=>{
  const originalFetch=globalThis.fetch;let removed=0,reloaded=0;
  globalThis.sessionStorage={removeItem(){removed++;}};globalThis.location={reload(){reloaded++;}};
  try {
    globalThis.fetch=async()=>Response.json({error:'Expired'},{status:401});
    await signOutStudio({token:'fixture'});assert.equal(removed,1);assert.equal(reloaded,1);
    globalThis.fetch=async()=>Response.json({error:'Unavailable'},{status:503});
    await assert.rejects(()=>signOutStudio({token:'fixture'}),/Unavailable/);assert.equal(removed,1);
  } finally {globalThis.fetch=originalFetch;delete globalThis.sessionStorage;delete globalThis.location;}
});

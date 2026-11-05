import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalDestination,reviewedLink,sceneLinkPolicy,popupLinkPolicy,outboundRequest} from '../server/outbound-policy.mjs';
import {newObject,starterScene,parseScene} from '../src/scene.mjs';
import {channelSceneRequest} from '../server/studio-service.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const now=1800000000000,url='https://creator.example/about';
const record=()=>({id:'fixture_review_0001',channel:'123',url,kind:'noncommercial',status:'approved',reviewedBy:'fixture-reviewer',evidence:'fixture-evidence',reviewedAt:now-100,redirectsCheckedAt:now-100,expiresAt:now+1000});
const environment=(rows=[record()])=>({STUDIO_ENABLED:'true',TEST_CHANNELS:'123',LINK_POLICY_CHANNELS:'123',OUTBOUND_LINK_REVIEWS:JSON.stringify(rows)});
const scene=()=>({...starterScene(),objects:[{...newObject('link'),url}]});

test('canonical destinations reject ambiguous, redirected, credentialed and encoded inputs',()=>{
  assert.equal(canonicalDestination(url),url);
  for(const bad of ['http://creator.example/about','javascript:alert(1)','https://user@creator.example/about','https://creator.example:443/about','https://creator.example:8443/about','https://creator.example./about','https://creator.example/a/../about','https://creator.example/%61bout','https://creator.example//about','https://creator.example/about?next=https://evil.example/','https://creator.example/about#sale','https://creator.example\\about','https://127.0.0.1/','https://[::1]/','https://localhost/','https://xn--bcher-kva.example/','https://creаtor.example/about',' https://creator.example/about','https://creator.example/\nabout'])assert.equal(canonicalDestination(bad),null,bad);
});
test('exact review is channel-bound, noncommercial, current and fail-closed',()=>{
  assert.match(reviewedLink(environment(),'123',url,now),/\/outbound\/123\/fixture_review_0001$/);
  for(const change of [{channel:'456'},{url:url+'/other'},{status:'revoked'},{kind:'merch'},{kind:'sponsor'},{kind:'affiliate'},{reviewedBy:''},{evidence:''},{expiresAt:now},{reviewedAt:now+1},{redirectsCheckedAt:now-86400000},{redirectsCheckedAt:now+1},{expiresAt:now+31*86400000}])assert.throws(()=>reviewedLink(environment([{...record(),...change}]),'123',url,now));
  for(const raw of ['invalid','{}',JSON.stringify([record(),record()])])assert.throws(()=>reviewedLink({...environment(),OUTBOUND_LINK_REVIEWS:raw},'123',url,now));
  assert.throws(()=>reviewedLink(environment(),'123','https://creator.example.evil.test/about',now));
  assert.throws(()=>reviewedLink(environment([{...record(),evidence:'x'.repeat(4096)}]),'123',url,now));
  assert.throws(()=>reviewedLink(environment([{...record(),evidence:'🧩'.repeat(1024)}]),'123',url,now));
});
test('a cached broker link stops immediately on revocation, expiry, channel blocking or missing enrollment',async()=>{
  const env=environment(),link=reviewedLink(env,'123',url,now),request=()=>new Request(link);
  let response=await outboundRequest(request(),env,now);
  assert.equal(response.status,303);assert.equal(response.headers.get('location'),url);assert.equal(response.headers.get('cache-control'),'no-store');
  for(const overrides of [{OUTBOUND_LINK_REVIEWS:JSON.stringify([{...record(),status:'revoked'}])},{OUTBOUND_LINK_REVIEWS:'[]'},{STUDIO_BLOCKED_CHANNELS:'123'},{TEST_CHANNELS:''},{OUTBOUND_LINK_REVIEWS:JSON.stringify([record(),record()])},{OUTBOUND_LINK_REVIEWS:JSON.stringify([record(),{...record(),id:'different_review_0001',status:'revoked'}])}])assert.equal((await outboundRequest(request(),{...env,...overrides},now)).status,410);
  assert.equal((await outboundRequest(request(),env,now+1000)).status,410);
  assert.equal((await outboundRequest(new Request(link+'?url=https://evil.example/'),env,now)).status,404);
  assert.equal((await outboundRequest(new Request(link,{method:'POST'}),env,now)).status,405);
  assert.equal((await outboundRequest(new Request(link.replace('/123/','/456/')),env,now)).status,410);
  const unavailable={...env,TEST_CHANNELS:'',STUDIO_PUBLIC_ENABLED:'true',IMAGES:{prepare(){throw Error('storage offline');}}};
  response=await outboundRequest(request(),unavailable,now);assert.equal(response.status,503);assert.equal(response.headers.get('location'),null);
});
test('public scene and popup destinations cannot use ownership checkbox or provider mappings as permission',()=>{
  const env={...environment([]),TEST_CHANNELS:'',MERCH_TEST_STORES:JSON.stringify({'123':'https://streamlabs.com/fixture/merch'})};
  const candidate=scene();candidate.objects[0].url='https://streamlabs.com/fixture/merch/123';
  assert.throws(()=>sceneLinkPolicy(env,'123',candidate,{now}));
  assert.throws(()=>popupLinkPolicy(env,'123',{carousels:[{slides:[{url:candidate.objects[0].url}]}]},{now}));
  const delivered=sceneLinkPolicy(env,'123',candidate,{delivery:true,now});
  assert.equal(delivered.objects.length,0,'unapproved listing image and text are also hidden');
  parseScene(JSON.stringify(delivered));
  assert.throws(()=>sceneLinkPolicy({TEST_CHANNELS:'123'},'123',candidate),'private tester status cannot bypass blocked stores');
  const approved=sceneLinkPolicy(environment(),'123',scene(),{delivery:true,now});
  assert.match(approved.objects[0].caption,/external/);assert.match(approved.objects[0].url,/\/outbound\//);
  parseScene(JSON.stringify(approved));
  for(const shape of ['circle','sticker','pill']){
    const hidden=scene();hidden.objects[0].shape=shape;
    assert.throws(()=>sceneLinkPolicy(environment(),'123',hidden,{now}),/notice/);
    assert.equal(sceneLinkPolicy(environment(),'123',hidden,{now,delivery:true}).objects.length,0);
  }
});
test('scene publication and rollback recheck approvals; delivery strips revoked links without changing saved content',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(readFileSync(new URL('../server/studio-schema.sql',import.meta.url),'utf8'));
  const env={...environment(),IMAGES:{prepare(sql){return{bind(...args){const q=db.prepare(sql),bound=Object.fromEntries(args.map((v,i)=>[i+1,v]));return{first:async()=>q.get(bound),all:async()=>({results:q.all(bound)}),run:async()=>({meta:q.run(bound)})};}};}}};
  db.prepare('INSERT INTO channel_scenes VALUES (?,?,?,?)').run('123',1,JSON.stringify(scene()),now);
  const call=(route,body,viewer=false)=>channelSceneRequest(new Request('https://service.example/',{method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})}),env,{channel:'123',route,claims:viewer?{role:'viewer',user_id:'456'}:{role:'broadcaster',studio_editor:true,user_id:'123'}},(v,status=200)=>Response.json(v,{status}),{now});
  let response=await call('scene',{revision:1,scene:scene()});assert.equal(response.status,200);
  assert.equal((await response.json()).scene.objects[0].url,url,'owner can edit and republish original URL');
  assert.match((await (await call('scene',undefined,true)).json()).scene.objects[0].url,/\/outbound\//);
  const stored=db.prepare('SELECT * FROM channel_scenes').get();assert.equal(JSON.parse(stored.scene).objects[0].url,url);
  env.OUTBOUND_LINK_REVIEWS=JSON.stringify([{...record(),status:'revoked'}]);
  await assert.rejects(call('scene',{revision:2,scene:scene()}),/needs review/);
  await assert.rejects(call('rollback',{revision:2,targetRevision:1}),/needs review/);
  response=await call('scene',undefined,true);assert.equal((await response.json()).scene.objects.length,0);
  assert.equal((await (await call('scene')).json()).scene.objects[0].url,url,'owner can remove revoked destination');
  const nativeOwner=await channelSceneRequest(new Request('https://service.example/',{headers:{'X-Studio-Editor':'true'}}),env,{channel:'123',route:'scene',claims:{role:'broadcaster',user_id:'123'}},(v,status=200)=>Response.json(v,{status}),{now});
  assert.equal((await nativeOwner.json()).scene.objects.length,0,'native broadcaster viewer is filtered; unsigned headers cannot become the external editor');
  assert.deepEqual(db.prepare('SELECT * FROM channel_scenes').get(),stored);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {ordinaryDestination,destinationClass,ordinaryAllowed} from '../server/ordinary-links.mjs';
import {sceneLinkPolicy,popupLinkPolicy,outboundRequest} from '../server/outbound-policy.mjs';
import {channelSceneRequest} from '../server/studio-service.mjs';
import {automationRequest,processAutomationInput} from '../server/automation-service.mjs';
import {starterScene,newObject} from '../src/scene.mjs';
const now=1800000000000,origin='https://fixture.ext-twitch.tv';
const scene=url=>({...starterScene(),objects:[{...newObject('link'),url}]});
const design=url=>({version:1,carousels:[{id:'resources',title:'Resources',displaySeconds:20,slides:[{id:'guide',title:'Guide',caption:'Read more',image:'',url}]}],rules:[{id:'chat',name:'Welcome',enabled:true,trigger:{type:'keyword',phrase:'hello',match:'word'},effect:{type:'celebrate',message:'Welcome'},cooldownSeconds:0}]});
function setup(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  for(const file of ['studio-schema.sql','automation-schema.sql'])db.exec(readFileSync(new URL('../server/'+file,import.meta.url),'utf8'));
  const env={STUDIO_ENABLED:'true',TEST_CHANNELS:'123,456',AUTOMATIONS_ENABLED:'true',EXTENSION_ORIGIN:origin,EXTENSION_CLIENT_ID:'fixture',EXTENSION_SECRET:Buffer.alloc(32,7).toString('base64'),IMAGES:{prepare(sql){return{bind(...args){const q=db.prepare(sql),a=Object.fromEntries(args.map((v,i)=>[i+1,v]));return{first:async()=>q.get(a),all:async()=>({results:q.all(a)}),run:async()=>({meta:q.run(a)})};}};}}};
  const host={role:'broadcaster',studio_editor:true,user_id:'123',channel_id:'123',exp:now/1000+3600};
  const fetcher=async()=>new Response(null,{status:204});
  return {db,env,host,fetcher};
}
test('ordinary resources accept useful encoded text, query and fragment without manual approval',()=>{
  for(const url of ['https://creator.example/about','https://creator.example/guides/hello%20world?language=en#setup','https://docs.fourthwall.com/guides/oauth','https://discord.gg/community']){
    assert.ok(ordinaryDestination(url));assert.equal(ordinaryAllowed({},url),true);
  }
  for(const url of ['http://example.com/','https://127.0.0.1/','https://server.local/','https://u:p@example.com/','https://example.com/?next=https://internal/','https://example.com/%0a','https://example.com/a%2fb','https://example.com:8443/'])assert.equal(ordinaryDestination(url),null,url);
  for(const url of ['https://creator.example/shop/shirt','https://store.fourthwall.com/','https://streamlabs.com/creator/merch','https://opensea.io/collection','https://kick.com/creator','https://bit.ly/example'])assert.equal(ordinaryAllowed({},url),false,url);
  assert.equal(destinationClass('https://fourthwall.com.evil.example/about'),'ordinary','hostname matching is exact; unknown content still needs moderation');
});
test('scene publication creates automatic channel/revision-bound links and old links expire on edits',async t=>{
  const {db,env,host}=setup(t),url='https://creator.example/about?language=en#hello';
  db.prepare('INSERT INTO channel_scenes VALUES(?,?,?,?)').run('123',1,JSON.stringify(scene(url)),now);
  const call=(method,body)=>channelSceneRequest(new Request('https://service.example/',{method,...(body?{body:JSON.stringify(body)}:{})}),env,{channel:'123',route:'scene',claims:method==='GET'?{role:'viewer'}:host},(v,status=200)=>Response.json(v,{status}),{now});
  assert.equal((await call('POST',{revision:1,scene:scene(url)})).status,200);
  const delivered=(await (await call('GET')).json()).scene;
  assert.match(delivered.objects[0].caption,/external/);
  const link=delivered.objects[0].url;assert.match(link,/auto_s2_0$/);
  assert.equal((await outboundRequest(new Request(link),env,now)).headers.get('location'),url);
  assert.equal((await outboundRequest(new Request(link.replace('/123/','/456/')),env,now)).status,410);
  assert.equal((await outboundRequest(new Request(link+'?url=https://evil.example/'),env,now)).status,404);
  assert.equal((await outboundRequest(new Request(link,{method:'POST'}),env,now)).status,405);
  assert.equal((await call('POST',{revision:2,scene:scene('https://creator.example/new')})).status,200);
  assert.equal((await outboundRequest(new Request(link),env,now)).status,410,'old link never silently changes its target');
});
test('popup publication and viewer delivery use the same automatic-link rules',async t=>{
  const {env,host,fetcher}=setup(t),url='https://creator.example/guide';
  const call=(method,claims,input)=>automationRequest(new Request('https://service.example/v1/automations/123/config',{method,headers:{Origin:origin,'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})}),env,'123',{claims,now,fetcher});
  assert.equal((await call('PUT',host,{expectedRevision:0,design:design(url)})).status,200);
  const body=await (await call('GET',{...host,studio_editor:false,role:'viewer'})).json();
  const link=body.design.carousels[0].slides[0].url;assert.match(link,/auto_p1_0_0$/);
  assert.equal((await outboundRequest(new Request(link),env,now)).headers.get('location'),url);
  assert.equal((await call('PUT',host,{expectedRevision:1,design:design('https://creator.example/changed')})).status,200);
  assert.equal((await outboundRequest(new Request(link),env,now)).status,410);
});
test('block controls, explicit holds, disabled channels and storage failure stop automatic redirects',async t=>{
  const {db,env}=setup(t),url='https://creator.example/guide';
  db.prepare('INSERT INTO channel_scenes VALUES(?,?,?,?)').run('123',1,JSON.stringify(scene(url)),now);
  const link=sceneLinkPolicy(env,'123',scene(url),{delivery:true,revision:1,now}).objects[0].url;
  for(const change of [{OUTBOUND_LINKS_DISABLED:'true'},{OUTBOUND_BLOCKED_HOSTS:'creator.example'},
    {OUTBOUND_BLOCKED_URLS:JSON.stringify([url])},{OUTBOUND_BLOCKED_URLS:'invalid'},{STUDIO_BLOCKED_CHANNELS:'123'},
    {OUTBOUND_LINK_REVIEWS:JSON.stringify([{channel:'123',url,status:'revoked'}])},{OUTBOUND_LINK_REVIEWS:'invalid'}]){
    assert.equal((await outboundRequest(new Request(link),{...env,...change},now)).status,410);
    assert.equal(sceneLinkPolicy({...env,...change},'123',scene(url),{delivery:true,revision:1,now}).objects.length,0);
  }
  assert.equal((await outboundRequest(new Request(link),{...env,IMAGES:{prepare(){throw Error('offline');}}},now)).status,503);
});
test('legacy blocked merch does not prevent unrelated runtime chat celebrations',async t=>{
  const {db,env,fetcher}=setup(t),raw=design('https://store.fourthwall.com/products/shirt');
  db.prepare('INSERT INTO automation_configs(channel,design,revision,updated,engine_state,next_tick) VALUES(?,?,?,?,?,?)').run('123',JSON.stringify(raw),1,now,JSON.stringify({startedAt:now,lastFired:{}}),now+60000);
  const result=await processAutomationInput(env,'123',{type:'message',id:'original-message',text:'hello'},{now,fetcher});
  assert.equal(result.status,'sent');
  assert.equal(popupLinkPolicy(env,'123',raw,{delivery:true,revision:1,now}).carousels[0].slides[0].url,'');
  assert.throws(()=>popupLinkPolicy(env,'123',raw,{revision:2,now}),'publishing a new blocked sale is still rejected');
});
test('a false-positive store path has an exact noncommercial review route; confirmed storefronts do not',async t=>{
  const {env}=setup(t),url='https://docs.example/products/api';
  assert.equal(destinationClass(url),'review');
  assert.throws(()=>sceneLinkPolicy(env,'123',scene(url),{revision:1,now}));
  const record={id:'fixture_review_0001',channel:'123',url,kind:'noncommercial',status:'approved',reviewedBy:'operator',evidence:'Fixture documentation review',reviewedAt:now-1,redirectsCheckedAt:now-1,expiresAt:now+60000};
  env.OUTBOUND_LINK_REVIEWS=JSON.stringify([record]);
  const link=sceneLinkPolicy(env,'123',scene(url),{delivery:true,revision:1,now}).objects[0].url;
  assert.equal((await outboundRequest(new Request(link),env,now)).headers.get('location'),url);
  const store='https://fixture.fourthwall.com/products/shirt';
  env.OUTBOUND_LINK_REVIEWS=JSON.stringify([{...record,url:store}]);
  assert.throws(()=>sceneLinkPolicy(env,'123',scene(store),{revision:1,now}));
});
test('automation cohort revocation stops reads, saves and background events without deleting the config',async t=>{
  const {db,env,host,fetcher}=setup(t);
  db.prepare('INSERT INTO automation_configs(channel,design,revision,updated,engine_state,next_tick) VALUES(?,?,?,?,?,?)').run('123',JSON.stringify(design('')),1,now,JSON.stringify({startedAt:now,lastFired:{}}),now+60000);
  env.STUDIO_BLOCKED_CHANNELS='123';
  for(const method of ['GET','PUT']){
    const response=await automationRequest(new Request('https://service.example/v1/automations/123/config',{method,headers:{Origin:origin,'Content-Type':'application/json'},...(method==='PUT'?{body:JSON.stringify({expectedRevision:1,design:design('')})}:{})}),env,'123',{claims:host,now,fetcher});
    assert.equal(response.status,403);
  }
  await assert.rejects(processAutomationInput(env,'123',{type:'message',id:'blocked',text:'hello'},{now,fetcher}),/not enabled/);
  assert.equal(db.prepare('SELECT revision FROM automation_configs').get().revision,1);
});

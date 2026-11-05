import test from 'node:test';
import assert from 'node:assert/strict';
import {futureMerchFixture} from './fixtures/merch-approval.mjs';
import {sceneLinkPolicy,popupLinkPolicy,reviewedLink,outboundRequest} from '../server/outbound-policy.mjs';
import {starterScene,newObject} from '../src/scene.mjs';
import worker from '../server/image-worker.mjs';
const now=1800000000000;
const scene=url=>({...starterScene(),objects:[{...newObject('link'),title:'Fixture branded shirt',image:'',url}]});
const design=url=>({version:1,carousels:[{id:'collection',title:'Fixture collection',displaySeconds:20,slides:[{id:'shirt',title:'Fixture branded shirt',caption:'Fixture',image:'',url}]}],rules:[]});

test('merch is blocked by default including legacy maps, approved record, tester status and public signup',async()=>{
  const {record,env}=futureMerchFixture(now);
  env.MERCH_TEST_STORES=JSON.stringify({'123':'https://streamlabs.com/fixture/merch'});
  env.POPUP_TEST_LINKS=JSON.stringify({'123':[record.url]});
  for(const flags of [{},{STUDIO_PUBLIC_ENABLED:'true'},{MERCH_ENABLED:'false'},{MERCH_ENABLED:'TRUE'}]){
    const e={...env,...flags};
    assert.throws(()=>sceneLinkPolicy(e,'123',scene(record.url),{now}));
    assert.throws(()=>popupLinkPolicy(e,'123',design(record.url),{now}));
    assert.equal(sceneLinkPolicy(e,'123',scene(record.url),{now,delivery:true}).objects.length,0);
    const blocked=popupLinkPolicy(e,'123',design(record.url),{now,delivery:true}).carousels[0].slides[0];
    assert.equal(blocked.url,'');assert.equal(blocked.image,'');assert.equal(blocked.title,'Unavailable');
    assert.equal((await outboundRequest(new Request('https://service.example/outbound/123/'+record.id),e,now)).status,410);
  }
  const disguised={...record,kind:'noncommercial'};
  assert.throws(()=>reviewedLink({...env,OUTBOUND_LINK_REVIEWS:JSON.stringify([disguised])},'123',record.url,now));
});
test('future switch requires independent matching Twitch, channel, product and ownership evidence',async()=>{
  const {record,clearance,env}=futureMerchFixture(now,{enabled:true});
  const link=reviewedLink(env,'123',record.url,now);
  assert.match(link,/\/outbound\/123\/fixture_merch_0001$/);
  assert.equal((await outboundRequest(new Request(link),env,now)).headers.get('location'),record.url);
  for(const change of [{status:'revoked'},{scope:'provider-approved'},{extensionId:'other'},{channels:['456']},{expiresAt:now},{reference:''}]){
    const e={...env,MERCH_TWITCH_CLEARANCE:JSON.stringify({...clearance,...change})};
    assert.throws(()=>reviewedLink(e,'123',record.url,now));
    assert.equal((await outboundRequest(new Request(link),e,now)).status,410);
  }
  for(const change of [{status:'disconnected'},{channel:'456'},{brandOwnerChannel:'456'},{productKind:'digital'},
    {productUrl:record.url+'/other'},{productId:''},{storeId:''},{brandEvidence:''},{evidence:''},{verifiedAt:now-3600000},{expiresAt:now}]){
    const e={...env,OUTBOUND_LINK_REVIEWS:JSON.stringify([{...record,ownership:{...record.ownership,...change}}])};
    assert.throws(()=>reviewedLink(e,'123',record.url,now));
    assert.equal((await outboundRequest(new Request(link),e,now)).status,410);
  }
  assert.throws(()=>reviewedLink({...env,MERCH_TWITCH_CLEARANCE:'{}'},'123',record.url,now));
  assert.equal((await outboundRequest(new Request(link),{...env,MERCH_ENABLED:'false'},now)).status,410);
});
test('alternate routes and request-supplied approval fields cannot activate a store catalog',async()=>{
  const {env,record}=futureMerchFixture(Date.now());
  for(const path of ['/merch/catalog','/v1/merch/123/catalog','/v1/channel/123/merch-catalog','/catalog','/card-catalog/v1/catalog.json']){
    const result=await worker.fetch(new Request('https://service.example'+path,{headers:{'X-Merch-Enabled':'true'}}),env,{});
    assert.ok(result.status>=400,path);
  }
  const result=await worker.fetch(new Request('https://service.example/outbound/123/'+record.id+'?MERCH_ENABLED=true'),env,{});
  assert.equal(result.status,404);assert.equal(result.headers.get('location'),null);
});

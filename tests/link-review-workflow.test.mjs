import test from 'node:test';
import assert from 'node:assert/strict';
import {createLinkReviewPrototype} from '../server/link-review-workflow.mjs';
import {futureMerchFixture} from './fixtures/merch-approval.mjs';
import {reviewedLink,outboundRequest} from '../server/outbound-policy.mjs';

const start=1800000000000;
const product={provider:'fourthwall',storeId:'fixture-shop',productId:'fixture-shirt',url:'https://fixture.fourthwall.com/products/shirt'};
function fixture() {
  let time=start,wait=null;
  const sessions=new Map([
    ['owner',{userId:'123',channel:'123'}],['reviewer',{userId:'999',channel:'999'}],
    ['other',{userId:'456',channel:'456'}],['moderator',{userId:'456',channel:'123'}],
  ]),records=new Map();
  const workflow=createLinkReviewPrototype({
    authorize:async token=>sessions.get(token),reviewerIds:['999','123'],extensionId:'fixtureclient',clock:()=>time,
    getEvidence:async ref=>{if(wait)await wait;return structuredClone(records.get(ref));},
  });
  function evidence(r) {
    const refs={};
    for(const kind of ['shop','rights','destination','twitch']) {
      const ref=kind+'-'+r.id+'-'+r.revision;refs[kind]=ref;
      records.set(ref,{kind,status:'verified',reference:'SYNTHETIC-NOT-REAL-'+kind,reviewedBy:'999',
        verifiedAt:time-1,expiresAt:time+60000,
        subject:{requestId:r.id,revision:r.revision,channel:r.channel,...r.product},
        ...(kind==='shop'?{method:'oauth'}:{}),
        ...(kind==='rights'?{brandOwnerChannel:r.channel,productKind:'physical'}:{}),
        ...(kind==='destination'?{finalUrl:r.product.url}:{}),
        ...(kind==='twitch'?{extensionId:'fixtureclient',scope:'owned-branded-physical-merch'}:{}),
      });
    }
    return refs;
  }
  const approve=(r,refs=evidence(r))=>workflow.review('reviewer',r.id,r.revision,{decision:'approve',reason:'Synthetic review only',refs});
  return {workflow,records,evidence,approve,setTime:t=>time=t,setWait:p=>wait=p};
}

test('independent review projects into existing broker but cannot enable commerce',async()=>{
  const f=fixture(),r=await f.workflow.submit('owner',product);
  assert.equal(await f.workflow.activeRecord(r.id),null);
  await f.approve(r);
  const record=await f.workflow.activeRecord(r.id);
  const {env}=futureMerchFixture(start);
  env.OUTBOUND_LINK_REVIEWS=JSON.stringify([record]);
  assert.throws(()=>reviewedLink(env,'123',record.url,start));
  env.MERCH_ENABLED='true'; // Synthetic fixture only, not production.
  const link=reviewedLink(env,'123',record.url,start);
  assert.equal((await outboundRequest(new Request(link),env,start)).status,303);
  await f.workflow.revoke('owner',r.id,r.revision,'Disconnect request');
  assert.equal(await f.workflow.activeRecord(r.id),null);
  env.OUTBOUND_LINK_REVIEWS='[]'; // Future adapter must resolve live at each click.
  assert.equal((await outboundRequest(new Request(link),env,start)).status,410);
});

test('request-supplied identity, approval and evidence cannot grant authority',async()=>{
  const f=fixture();
  await assert.rejects(f.workflow.submit({userId:'123',channel:'123'},product));
  await assert.rejects(f.workflow.submit('moderator',product));
  for(const added of [{channel:'456'},{status:'approved'},{ownership:{status:'verified'}}])
    await assert.rejects(f.workflow.submit('owner',{...product,...added}));
  const r=await f.workflow.submit('owner',product),refs=f.evidence(r);
  for(const actor of ['owner','other']) await assert.rejects(f.workflow.review(actor,r.id,1,{decision:'approve',refs,reason:'Approve'}));
  await assert.rejects(f.workflow.inspect('other',r.id));
  await assert.rejects(f.workflow.revise('other',r.id,1,product));
  await assert.rejects(f.workflow.revoke('other',r.id,1,'Revoke'));
});

test('all evidence layers and every exact subject binding are mandatory',async()=>{
  for(const kind of ['shop','rights','destination','twitch']) {
    for(const field of ['requestId','revision','channel','provider','storeId','productId','url']) {
      const f=fixture(),r=await f.workflow.submit('owner',product),refs=f.evidence(r);
      f.records.get(refs[kind]).subject[field]='other';
      await assert.rejects(f.approve(r,refs),kind+':'+field);
    }
    const f=fixture(),r=await f.workflow.submit('owner',product),refs=f.evidence(r);
    f.records.delete(refs[kind]);await assert.rejects(f.approve(r,refs));
  }
});

test('rights and Twitch decisions cannot be replaced by shop access or owner assertions',async()=>{
  for(const [kind,change] of [
    ['rights',{reviewedBy:'123'}],['rights',{brandOwnerChannel:'456'}],['rights',{productKind:'digital'}],
    ['twitch',{extensionId:'other'}],['twitch',{scope:'provider-owns-store'}],
    ['destination',{finalUrl:product.url+'/redirect'}],['destination',{reviewedBy:'untrusted'}],
    ['shop',{method:'checkbox'}],['shop',{method:'manual',reviewedBy:'123'}],
  ]) {
    const f=fixture(),r=await f.workflow.submit('owner',product),refs=f.evidence(r);
    Object.assign(f.records.get(refs[kind]),change);await assert.rejects(f.approve(r,refs));
  }
  const f=fixture(),r=await f.workflow.submit('owner',product),refs=f.evidence(r);
  f.records.get(refs.shop).method='manual';await f.approve(r,refs);
  assert.ok(await f.workflow.activeRecord(r.id));
});

test('edits invalidate approval; stale review references and revisions cannot be reused',async()=>{
  for(const change of [{storeId:'new-shop'},{productId:'new-product'},{url:'https://other.example/product'},{provider:'printify'}]) {
    const f=fixture(),r=await f.workflow.submit('owner',product),refs=f.evidence(r);
    await f.approve(r,refs);
    const next=await f.workflow.revise('owner',r.id,1,{...product,...change});
    assert.equal(next.status,'pending');assert.equal(await f.workflow.activeRecord(r.id),null);
    await assert.rejects(f.approve(r,refs));await assert.rejects(f.approve(next,refs));
    await f.approve(next);assert.ok(await f.workflow.activeRecord(r.id));
  }
});

test('expiry, disconnection, evidence errors and reviewer revocation stop projection',async()=>{
  for(const kind of ['shop','rights','destination','twitch']) {
    const f=fixture(),r=await f.workflow.submit('owner',product),refs=f.evidence(r);
    await f.approve(r,refs);f.records.get(refs[kind]).status='revoked';
    assert.equal(await f.workflow.activeRecord(r.id),null);
  }
  const f=fixture(),r=await f.workflow.submit('owner',product);await f.approve(r);
  f.setTime(start+60000);assert.equal(await f.workflow.activeRecord(r.id),null);
  f.setTime(start);await f.workflow.revoke('reviewer',r.id,1,'Rights withdrawn');
  assert.equal(await f.workflow.activeRecord(r.id),null);
});

test('pending evidence checks cannot overwrite newer edits or revocations',async()=>{
  for(const action of ['revise','revoke']) {
    const f=fixture(),r=await f.workflow.submit('owner',product),refs=f.evidence(r);
    let release;f.setWait(new Promise(resolve=>release=resolve));
    const pending=f.approve(r,refs);
    await new Promise(resolve=>setImmediate(resolve));
    if(action==='revise')await f.workflow.revise('owner',r.id,1,{...product,productId:'changed'});
    else await f.workflow.revoke('owner',r.id,1,'Withdrawn');
    release();await assert.rejects(pending);assert.equal(await f.workflow.activeRecord(r.id),null);
  }
});

test('rejection supports a fresh review attempt without recycling old evidence',async()=>{
  const f=fixture(),r=await f.workflow.submit('owner',product);
  const rejected=await f.workflow.review('reviewer',r.id,1,{decision:'reject',reason:'Brand evidence unclear'});
  assert.equal(rejected.status,'rejected');await assert.rejects(f.approve(r));
  const next=await f.workflow.revise('owner',r.id,1,product);await f.approve(next);
  const copy=await f.workflow.inspect('owner',r.id);copy.approval.reviewedBy='123';copy.audit.length=0;
  const current=await f.workflow.inspect('owner',r.id);
  assert.equal(current.audit.length,4);assert.equal(current.approval.reviewedBy,'999');
});

test('URLs are parsed only; internal and ambiguous destinations are rejected without fetching',async()=>{
  const f=fixture();
  for(const url of ['http://example.com/a','https://127.0.0.1/a','https://localhost/a',
    'https://user:pass@example.com/a','https://example.com/a?next=internal','https://example.com/%2e%2e/a'])
    await assert.rejects(f.workflow.submit('owner',{...product,url}));
  // No URL is fetched by this module, including DNS names that might resolve privately.
  const r=await f.workflow.submit('owner',{...product,url:'https://internal.example/a'});
  assert.equal(r.status,'pending');assert.equal(await f.workflow.activeRecord(r.id),null);
});

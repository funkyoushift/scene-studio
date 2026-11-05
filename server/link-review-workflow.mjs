// Local workflow prototype, deliberately NOT connected to HTTP or the Worker.
// authorize/getEvidence MUST be server-owned adapters, never request-body claims.
// In-memory storage is for tests only; production needs transactional persistence.
import {canonicalDestination} from './outbound-policy.mjs';

const clone = value => structuredClone(value);
const deny = message => { throw new Error(message); };
const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const label = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 180;
const fields = ['provider', 'storeId', 'productId', 'url'];
const evidenceKinds = ['shop', 'rights', 'destination', 'twitch'];
const lifetimes = {shop:3600000, rights:30*86400000, destination:86400000, twitch:30*86400000};

export function createLinkReviewPrototype({authorize, getEvidence, reviewerIds, extensionId, clock=Date.now}) {
  if(typeof authorize!=='function'||typeof getEvidence!=='function'||!label(extensionId)||
      !Array.isArray(reviewerIds)||reviewerIds.some(v=>!id(v))) deny('Invalid trusted adapters.');
  const reviewers = new Set(reviewerIds), requests = new Map();
  function normalize(input) {
    if(!input||Object.keys(input).length!==fields.length||Object.keys(input).some(k=>!fields.includes(k))||
      !['fourthwall','printful','printify','streamlabs'].includes(input.provider)||
      !label(input.storeId)||!label(input.productId)||!canonicalDestination(input.url)) deny('Invalid product request.');
    return Object.fromEntries(fields.map(k=>[k,input[k]]));
  }
  async function principal(context) {
    const p=await authorize(context);
    if(!p||!id(p.userId)||!id(p.channel)) deny('Sign in required.');
    return p;
  }
  function owner(p,r) {return p.userId===r.channel&&p.channel===r.channel;}
  function reviewer(p,r) {
    return reviewers.has(p.userId)&&p.userId!==r.channel&&p.userId!==r.submittedBy;
  }
  function read(key,revision) {
    const r=requests.get(key);
    if(!r||r.revision!==revision) deny('Request changed. Reload before continuing.');
    return r;
  }
  function commit(old,next,event,actor,reason='') {
    if(old&&requests.get(old.id)!==old) deny('Request changed. Reload before continuing.');
    if((old?.audit.length||0)>=100&&event!=='revoked') deny('Review history limit reached.');
    if(event==='revoked'&&old?.status==='revoked') deny('Already revoked.');
    const result={...next,audit:[...(old?.audit||[]),{event,actor,at:clock(),reason}]};
    requests.set(result.id,result);
    return clone(result);
  }
  function subject(r) {
    return {requestId:r.id,revision:r.revision,channel:r.channel,...r.product};
  }
  async function evidence(r,refs,now) {
    if(!refs||Object.keys(refs).length!==4||Object.keys(refs).some(k=>!evidenceKinds.includes(k))||
      Object.values(refs).some(v=>!label(v))) deny('Four independent evidence references required.');
    const verified={};
    for(const kind of evidenceKinds) {
      const e=await getEvidence(refs[kind]);
      const expected=subject(r);
      if(!e||e.kind!==kind||e.status!=='verified'||!label(e.reference)||
        !e.subject||Object.keys(e.subject).length!==Object.keys(expected).length||
        Object.entries(expected).some(([k,v])=>e.subject[k]!==v)||
        !Number.isSafeInteger(e.verifiedAt)||!Number.isSafeInteger(e.expiresAt)||
        e.verifiedAt>now||e.expiresAt<=now||e.expiresAt<=e.verifiedAt||
        e.expiresAt-e.verifiedAt>lifetimes[kind]||now-e.verifiedAt>=lifetimes[kind]) deny('Missing, changed or expired '+kind+' evidence.');
      if(kind!=='shop'&&(!reviewers.has(e.reviewedBy)||e.reviewedBy===r.channel||e.reviewedBy===r.submittedBy))
        deny('Evidence needs an independent authorized reviewer.');
      if(kind==='shop'&&!['oauth','manual'].includes(e.method)) deny('Shop verification method required.');
      if(kind==='shop'&&e.method==='manual'&&(!reviewers.has(e.reviewedBy)||e.reviewedBy===r.channel))
        deny('Manual shop evidence needs an independent reviewer.');
      if(kind==='rights'&&(e.brandOwnerChannel!==r.channel||e.productKind!=='physical')) deny('Broadcaster brand and physical product rights required.');
      if(kind==='destination'&&e.finalUrl!==r.product.url) deny('Exact reviewed final destination required.');
      if(kind==='twitch'&&(e.extensionId!==extensionId||e.scope!=='owned-branded-physical-merch')) deny('Applicable Twitch clearance required.');
      verified[kind]=clone(e);
    }
    return verified;
  }
  return {
    async submit(context,input) {
      const p=await principal(context);
      if(p.userId!==p.channel) deny('Only the channel owner can submit.');
      const product=normalize(input);
      if(requests.size>=8) deny('Prototype request capacity reached.');
      const key=crypto.randomUUID().replaceAll('-','');
      return commit(null,{id:key,revision:1,channel:p.channel,submittedBy:p.userId,product,status:'pending',approval:null},'submitted',p.userId);
    },
    async inspect(context,key) {
      const p=await principal(context),r=requests.get(key);
      if(!r||(!owner(p,r)&&!reviewer(p,r))) deny('Request unavailable.');
      return clone(r);
    },
    async revise(context,key,revision,input) {
      const p=await principal(context),r=read(key,revision);
      if(!owner(p,r)) deny('Only the channel owner can revise.');
      return commit(r,{...r,revision:r.revision+1,product:normalize(input),status:'pending',approval:null},'resubmitted',p.userId);
    },
    async review(context,key,revision,{decision,refs,reason}) {
      const p=await principal(context),r=read(key,revision);
      if(!reviewer(p,r)) deny('Independent reviewer required.');
      if(r.status!=='pending'||!['approve','reject'].includes(decision)||!label(reason)) deny('Invalid review decision.');
      if(decision==='reject')return commit(r,{...r,status:'rejected',approval:null},'rejected',p.userId,reason);
      const now=clock(),proof=await evidence(r,refs,now);
      const expiresAt=Math.min(...Object.values(proof).map(e=>e.expiresAt));
      if(expiresAt<=clock())deny('Evidence expired during review.');
      return commit(r,{...r,status:'approved',approval:{reviewedBy:p.userId,reviewedAt:now,expiresAt,refs:clone(refs)}},'approved',p.userId,reason);
    },
    async revoke(context,key,revision,reason) {
      const p=await principal(context),r=read(key,revision);
      if((!owner(p,r)&&!reviewer(p,r))||!label(reason)) deny('Revocation not authorized.');
      return commit(r,{...r,status:'revoked',approval:null},'revoked',p.userId,reason);
    },
    // Internal-only projection. Does not enable MERCH_ENABLED or issue clearance.
    // Must be resolved at delivery AND click time; do not copy into a static flag.
    async activeRecord(key) {
      const r=requests.get(key),now=clock();
      if(!r||r.status!=='approved'||r.approval.expiresAt<=now)return null;
      try {
        const e=await evidence(r,r.approval.refs,now);
        const expiresAt=Math.min(r.approval.expiresAt,...Object.values(e).map(x=>x.expiresAt));
        if(requests.get(key)!==r||expiresAt<=clock())return null;
        return {id:r.id,channel:r.channel,url:r.product.url,kind:'merch',status:'approved',
          reviewedBy:r.approval.reviewedBy,reviewedAt:r.approval.reviewedAt,expiresAt,
          redirectsCheckedAt:e.destination.verifiedAt,evidence:e.twitch.reference,
          ownership:{status:'verified',channel:r.channel,brandOwnerChannel:r.channel,
            provider:r.product.provider,storeId:r.product.storeId,productId:r.product.productId,
            productUrl:r.product.url,productKind:'physical',evidence:e.shop.reference,
            brandEvidence:e.rights.reference,verifiedAt:e.shop.verifiedAt,expiresAt:Math.min(expiresAt,e.shop.expiresAt)}};
      }catch{return null;}
    },
  };
}

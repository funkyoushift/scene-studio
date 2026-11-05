// Server-owned review records; never accept these fields from a scene or OAuth.
// Provider sign-in and our records do NOT grant Twitch commerce permission.
import {IMAGE_ORIGIN} from '../src/image-address.mjs';
import {studioChannelEnabled, testChannelEnv} from './tester-access.mjs';
import {ordinaryAllowed,ordinaryReference,currentOrdinaryDestination,blockedDestination,destinationClass} from './ordinary-links.mjs';
const listed=(value,channel)=>(value||'').split(',').map(s=>s.trim()).includes(channel);
export const privateTestChannel=(env,channel)=>listed(env.TEST_CHANNELS,channel);
// Tester status never bypasses blocked stores. Ordinary published links use
// automatic screening and revision-bound redirects, without a manual queue.
export const strictLinks=()=>true;
const fail=()=>{throw Object.assign(Error('This destination needs review. Sales links are blocked without current channel, product and Twitch approval.'),{status:400});};

const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=300;
function validWindow(value,now,maxAge){
  return Number.isSafeInteger(value?.verifiedAt)&&Number.isSafeInteger(value?.expiresAt)&&
    value.verifiedAt<=now&&value.expiresAt>now&&value.expiresAt>value.verifiedAt&&
    now-value.verifiedAt<maxAge&&value.expiresAt-value.verifiedAt<=maxAge;
}
function knownStoreDestination(value){
  return destinationClass(value)==='commerce';
}
export function merchApproved(env,channel,record,now=Date.now()){
  if(env.MERCH_ENABLED!=='true'||record?.kind!=='merch')return false;
  let clearance;
  try{
    const raw=env.MERCH_TWITCH_CLEARANCE;
    if(typeof raw!=='string'||new TextEncoder().encode(raw).length>4096)return false;
    clearance=JSON.parse(raw);
  }catch{return false;}
  // This is an operator's record of actual written authorization, NOT an
  // automated inference that provider OAuth or our channel list satisfies 4.9.
  if(clearance?.status!=='approved'||clearance.scope!=='owned-branded-physical-merch'||
    !text(env.EXTENSION_CLIENT_ID)||clearance.extensionId!==env.EXTENSION_CLIENT_ID||
    !text(clearance.reference)||!text(clearance.reviewedBy)||!validWindow(clearance,now,30*86400000)||
    !Array.isArray(clearance.channels)||clearance.channels.length>8||
    clearance.channels.some(id=>typeof id!=='string'||! /^[1-9][0-9]{0,19}$/.test(id))||
    !clearance.channels.includes(channel))return false;
  const owner=record.ownership;
  return owner?.status==='verified'&&owner.channel===channel&&owner.brandOwnerChannel===channel&&
    ['streamlabs','fourthwall','printful','printify'].includes(owner.provider)&&
    text(owner.storeId)&&text(owner.productId)&&text(owner.evidence)&&text(owner.brandEvidence)&&
    owner.productKind==='physical'&&owner.productUrl===record.url&&validWindow(owner,now,3600000);
}

// Deliberately narrow canonical form. No normalization of ambiguous destinations,
// redirect parameters, IDNs, credentials, IP literals or encoded path syntax.
export function canonicalDestination(value){
  if(typeof value!=='string'||value.length>1000||!/^[\x21-\x7e]+$/.test(value)||/[\\%?#]/.test(value))return null;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.href!==value||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname)||
      url.hostname.split('.').some(s=>s.startsWith('xn--'))||url.pathname.includes('//'))return null;
    return url.href;
  }catch{return null;}
}
function records(env){
  try{
    const raw=env.OUTBOUND_LINK_REVIEWS||'[]';
    // Pilot registry fits below Workers' 5 KB per-variable limit. A scalable
    // approval service needs durable records/audit storage, not larger flags.
    if(typeof raw!=='string'||raw.length>4096||new TextEncoder().encode(raw).length>4096)return [];
    const result=JSON.parse(raw);
    return Array.isArray(result)&&result.length<=8?result:[];
  }catch{return [];}
}
function approved(env,channel,record,now){
  return record&&!blockedDestination(env,record.url)&&!['nft','competing','redirect','unsafe'].includes(destinationClass(record.url))&&record.channel===channel&&record.status==='approved'&&
    (record.kind==='noncommercial'?(canonicalDestination(record.url)&&!knownStoreDestination(record.url)):merchApproved(env,channel,record,now))&&
    /^[A-Za-z0-9_-]{16,64}$/.test(record.id||'')&&canonicalDestination(record.url)&&
    typeof record.reviewedBy==='string'&&record.reviewedBy.length>0&&
    typeof record.evidence==='string'&&record.evidence.length>0&&
    Number.isSafeInteger(record.reviewedAt)&&Number.isSafeInteger(record.expiresAt)&&
    Number.isSafeInteger(record.redirectsCheckedAt)&&record.reviewedAt<=now&&
    record.redirectsCheckedAt<=now&&now-record.redirectsCheckedAt<86400000&&
    record.expiresAt>now&&record.expiresAt-record.reviewedAt<=30*86400000;
}
function approval(env,channel,value,now){
  const url=canonicalDestination(value);
  if(!url)return null;
  const matches=records(env).filter(r=>r?.channel===channel&&r?.url===url);
  // Duplicate/conflicting reviews fail closed, including an older approval.
  return matches.length===1&&approved(env,channel,matches[0],now)?matches[0]:null;
}
export function reviewedLink(env,channel,value,now=Date.now()){
  if(!value)return '';
  if(!studioChannelEnabled(env,channel))fail();
  const record=approval(env,channel,value,now);
  if(!record)fail();
  return `${IMAGE_ORIGIN}/outbound/${channel}/${record.id}`;
}
function policyLink(env,channel,value,now,reference){
  if(!studioChannelEnabled(env,channel)||blockedDestination(env,value))fail();
  // A revoked/expired/conflicting explicit decision cannot fall back to auto.
  const raw=env.OUTBOUND_LINK_REVIEWS||'[]',rows=records(env);
  if(raw!=='[]'&&!rows.length)fail();
  if(rows.some(r=>r?.channel===channel&&r?.url===value))return reviewedLink(env,channel,value,now);
  if(reference&&ordinaryAllowed(env,value))return `${IMAGE_ORIGIN}/outbound/${channel}/${reference}`;
  return reviewedLink(env,channel,value,now);
}
export function sceneLinkPolicy(env,channel,scene,{delivery=false,now=Date.now(),revision}={}){
  if(!scene||!strictLinks(env,channel))return scene;
  return {...scene,objects:scene.objects.map((object,index)=>{
    if(!object.url&&object.action!=='link')return object;
    try{
      if(!object.url)fail();
      if(object.action==='link'&&!['card','showcase'].includes(object.shape))
        throw Object.assign(Error('Use a card or showcase layout so the external-link notice stays visible.'),{status:400});
      const link=policyLink(env,channel,object.url,now,ordinaryReference('s',revision,index));
      return {...object,url:delivery?link:object.url,...(delivery&&object.action==='link'?{caption:'Opens external website ↗'}:{})};
    }catch(error){
      if(!delivery)throw error;
      // Do not keep advertising a product after merely removing its click URL.
      return null;
    }
  }).filter(Boolean)};
}
export function popupLinkPolicy(env,channel,design,{delivery=false,now=Date.now(),revision}={}){
  if(!strictLinks(env,channel))return design;
  return {...design,carousels:design.carousels.map((carousel,index)=>{
    let hidden=false;
    const slides=carousel.slides.map((slide,slideIndex)=>{
      if(!slide.url)return slide;
      try{const link=policyLink(env,channel,slide.url,now,ordinaryReference('p',revision,index,slideIndex));return {...slide,url:delivery?link:slide.url};}
      catch(error){if(!delivery)throw error;hidden=true;return {id:slide.id,title:'Unavailable',caption:'This item is not currently approved.',image:'',url:''};}
    });
    return {...carousel,title:hidden?'Collection unavailable':carousel.title,slides};
  })};
}
export async function outboundRequest(request,env,now=Date.now()){
  const url=new URL(request.url),match=url.pathname.match(/^\/outbound\/([1-9][0-9]{0,19})\/([A-Za-z0-9_-]{8,64})$/);
  if(!url.pathname.startsWith('/outbound/'))return null;
  const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  if(request.method!=='GET')return new Response('Method not allowed.',{status:405,headers});
  if(!match||url.search)return new Response('Link unavailable.',{status:404,headers});
  const channel=match[1];let scoped;
  try{scoped=await testChannelEnv(env,channel);}
  catch{return new Response('Link verification is temporarily unavailable.',{status:503,headers});}
  if(match[2].startsWith('auto_')){
    if(!studioChannelEnabled(scoped,channel))return new Response('Link unavailable.',{status:410,headers});
    try{
      const target=await currentOrdinaryDestination(scoped,channel,match[2]);
      if(!target)return new Response('This link changed or is unavailable. Refresh the stream.',{status:410,headers});
      // Explicit revocations/holds also override previously issued auto links.
      const rows=records(scoped),raw=scoped.OUTBOUND_LINK_REVIEWS||'[]';
      if((raw!=='[]'&&!rows.length)||rows.some(r=>r?.channel===channel&&r?.url===target))
        return new Response('This link now needs a fresh review.',{status:410,headers});
      return new Response(null,{status:303,headers:{...headers,Location:target}});
    }catch{return new Response('Link verification is temporarily unavailable.',{status:503,headers});}
  }
  const matches=records(scoped).filter(r=>r?.id===match[2]&&r?.channel===channel);
  const record=matches.length===1?matches[0]:null;
  if(!studioChannelEnabled(scoped,channel)||!strictLinks(scoped,channel)||!approved(scoped,channel,record,now)||approval(scoped,channel,record.url,now)?.id!==record.id)
    return new Response('This link is no longer approved.',{status:410,headers});
  // Never fetch user-supplied URLs here. A click rechecks revocation even in a
  // frozen player that retains its last scene or cached automation configuration.
  return new Response(null,{status:303,headers:{...headers,Location:record.url}});
}

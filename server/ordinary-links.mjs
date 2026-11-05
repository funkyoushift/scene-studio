// Automatic ordinary-link screening, NOT a finding of content/brand ownership.
// Never fetch a submitted URL or follow its redirects on the server.
const hostMatches=(host,base)=>host===base||host.endsWith('.'+base);
const salesHosts=['fourthwall.com','printful.com','printify.com','myshopify.com','etsy.com','gumroad.com','spring.com','teespring.com','spreadshop.com','spreadshirt.com','redbubble.com','ko-fi.com','buymeacoffee.com','patreon.com'];
const nftHosts=['opensea.io','magiceden.io','rarible.com','blur.io'];
const redirectHosts=['bit.ly','tinyurl.com','t.co','shorturl.at','cutt.ly','rebrand.ly'];
const competingHosts=['kick.com','dlive.tv'];
const docsHosts=['docs.fourthwall.com','help.fourthwall.com','developers.printful.com','developers.printify.com'];
const redirectKeys=/^(?:url|uri|redirect|redirect_uri|redirect_url|redirect_to|return|returnto|return_url|next|dest|destination|target|continue|go)$/i;

export function ordinaryDestination(value) {
  if(typeof value!=='string'||value.length>1000||!value||/[\u0000-\u0020\u007f\\]/.test(value))return null;
  try {
    const u=new URL(value);
    if(u.protocol!=='https:'||u.username||u.password||u.port||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(u.hostname)||
      /(?:^|\.)(?:localhost|local|internal|lan|home|onion)$/.test(u.hostname)||
      u.hostname.split('.').some(p=>p.startsWith('xn--'))||
      u.pathname.includes('//')||/[\u0000-\u001f\u007f\\]/.test(decodeURIComponent(u.pathname+u.search+u.hash))||
      [...u.searchParams.keys()].some(k=>redirectKeys.test(k)))return null;
    // Encoding is supported for real path/query text, not hidden separators.
    if(/%2f|%5c/i.test(u.pathname))return null;
    return u.href.length<=1000?u.href:null;
  }catch{return null;}
}

export function destinationClass(value) {
  const safe=ordinaryDestination(value);
  if(!safe)return 'unsafe';
  const {hostname,pathname}=new URL(safe);
  if(hostname==='scene-studio-images.scene-studio-free-prototype.workers.dev'&&pathname.startsWith('/outbound/'))return 'redirect';
  if(nftHosts.some(h=>hostMatches(hostname,h)))return 'nft';
  if(redirectHosts.some(h=>hostMatches(hostname,h)))return 'redirect';
  if(competingHosts.some(h=>hostMatches(hostname,h)))return 'competing';
  if(docsHosts.includes(hostname))return 'ordinary';
  if(salesHosts.some(h=>hostMatches(hostname,h))||
    (hostMatches(hostname,'streamlabs.com')&&/\/(?:merch|tip|donate)(?:\/|$)/i.test(pathname)))return 'commerce';
  // A generic path is a signal, not proof: an exact noncommercial review may
  // clear a documentation page such as /products/api without enabling stores.
  if(/\/(?:shop|store|merch|products?|checkout|cart)(?:\/|$)/i.test(decodeURIComponent(pathname)))return 'review';
  return 'ordinary';
}

export function blockedDestination(env,value) {
  if(env.OUTBOUND_LINKS_DISABLED==='true')return true;
  try {
    const hosts=env.OUTBOUND_BLOCKED_HOSTS||'',raw=env.OUTBOUND_BLOCKED_URLS||'[]';
    if(hosts.length>4096||raw.length>4096)return true;
    const list=hosts.split(',').map(s=>s.trim()).filter(Boolean),urls=JSON.parse(raw);
    if(list.length>128||list.some(h=>!ordinaryDestination('https://'+h+'/'))||
      !Array.isArray(urls)||urls.length>32||urls.some(u=>!ordinaryDestination(u)))return true;
    const safe=ordinaryDestination(value);if(!safe)return true;
    return list.some(h=>hostMatches(new URL(safe).hostname,h))||urls.some(u=>ordinaryDestination(u)===safe);
  }catch{return true;}
}

export function ordinaryAllowed(env,value) {
  return !blockedDestination(env,value)&&destinationClass(value)==='ordinary';
}

// Short references use current persisted revisions and indexes, not a caller's
// destination. Updating/removing a link invalidates every old revision URL.
export function ordinaryReference(kind,revision,index,slide) {
  if(!Number.isSafeInteger(revision)||revision<1||!Number.isInteger(index)||index<0||index>99)return null;
  if(kind==='s')return `auto_s${revision}_${index}`;
  if(kind==='p'&&Number.isInteger(slide)&&slide>=0&&slide<=99)return `auto_p${revision}_${index}_${slide}`;
  return null;
}

export async function currentOrdinaryDestination(env,channel,reference) {
  const m=reference.match(/^auto_([sp])([1-9][0-9]{0,15})_([0-9]{1,2})(?:_([0-9]{1,2}))?$/);
  if(!m||!Number.isSafeInteger(Number(m[2]))||(m[1]==='s'?m[4]!==undefined:m[4]===undefined))return null;
  const scene=m[1]==='s';
  const sql=scene?'SELECT scene AS content,revision FROM channel_scenes WHERE channel=?1 AND revision=?2':
    'SELECT design AS content,revision FROM automation_configs WHERE channel=?1 AND revision=?2';
  const row=await env.IMAGES.prepare(sql).bind(channel,Number(m[2])).first();
  if(!row||row.revision!==Number(m[2])||typeof row.content!=='string'||new TextEncoder().encode(row.content).length>(scene?5000:65536))return null;
  const content=JSON.parse(row.content);
  const item=scene?content.objects?.[Number(m[3])]:content.carousels?.[Number(m[3])]?.slides?.[Number(m[4])];
  if(scene&&(item?.action!=='link'||!['card','showcase'].includes(item.shape)))return null;
  return ordinaryAllowed(env,item?.url)?ordinaryDestination(item.url):null;
}

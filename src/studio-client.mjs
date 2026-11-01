import { IMAGE_ORIGIN } from './image-address.mjs';

export const STUDIO_URL = 'https://www.funkyoushift.com/scene-studio/';
const KEY = 'scene-studio-session-v1';
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function request(path, auth, body, method = body ? 'POST' : 'GET') {
  const res = await fetch(`${IMAGE_ORIGIN}${path}`, { method, headers:{...(auth?.token ? {Authorization:`Bearer ${auth.token}`} : {}), ...(body ? {'Content-Type':'application/json'} : {})}, body:body ? JSON.stringify(body) : undefined, credentials:'omit', redirect:'error', signal:AbortSignal.timeout(20000) });
  const data = await res.json();
  if(!res.ok) throw Object.assign(Error(data.error || 'Scene Studio could not connect.'),{status:res.status});
  return data;
}
export async function startStudioSignIn() {
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  sessionStorage.setItem('studio-proof',verifier);
  const data=await request('/studio/auth/start',null,{challenge});
  const url=new URL(data.authorizeUrl);
  if(url.origin !== 'https://id.twitch.tv' || url.pathname !== '/oauth2/authorize') throw Error('The sign-in address could not be verified.');
  location.assign(url.href);
}
export async function loadStudioSession() {
  const code=new URLSearchParams(location.hash.slice(1)).get('studio_code');
  if(code) {
    history.replaceState(null,'',location.pathname+location.search);
    const verifier=sessionStorage.getItem('studio-proof');
    sessionStorage.removeItem('studio-proof');
    const auth=await request('/studio/auth/exchange',null,{code,verifier});
    sessionStorage.setItem(KEY,JSON.stringify(auth));
    return auth;
  }
  const saved=sessionStorage.getItem(KEY);
  if(!saved) return null;
  try {
    const auth=JSON.parse(saved);
    if(auth.expiresAt<=Date.now()) {sessionStorage.removeItem(KEY); return null;}
    const identity=await request('/studio/auth/session',auth);
    if(identity.channelId!==auth.channelId) throw Error('Channel changed.');
    return {...auth,...identity};
  } catch(e) { if(e.status===401 || e.status===403) {sessionStorage.removeItem(KEY);return null;} throw e; }
}
export async function signOutStudio(auth) {
  try { await request('/studio/auth/session',auth,null,'DELETE'); }
  catch(e) { if(e.status!==401) throw e; }
  sessionStorage.removeItem(KEY); location.reload();
}
export function studioHelper(auth, initial) {
  let revision=initial.revision;
  const helper={
    studio:true, viewer:{role:'broadcaster',isLinked:true}, features:{isChatEnabled:true},
    actions:{requestIdShare(){}}, onAuthorized(fn){queueMicrotask(()=>fn(auth));},
    configuration:{ broadcaster:{content:JSON.stringify(initial.scene)}, onChanged(fn){queueMicrotask(fn);} },
    async publishScene(scene) {
      const result=await request(`/v1/channel/${auth.channelId}/scene`,auth,{scene,revision});
      revision=result.revision;
      helper.configuration.broadcaster.content=JSON.stringify(result.scene);
      return `Published revision ${revision}. Connected players receive it automatically within about 10 seconds.`;
    },
  };
  return helper;
}
export const loadPublishedScene = auth => request(`/v1/channel/${auth.channelId}/scene`,auth);
export const loadPublishHistory = auth => request(`/v1/channel/${auth.channelId}/history`,auth);
export const restorePublishedScene = (auth, revision, targetRevision) => request(`/v1/channel/${auth.channelId}/rollback`,auth,{revision,targetRevision});


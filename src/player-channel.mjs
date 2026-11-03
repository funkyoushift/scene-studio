import {IMAGE_ORIGIN} from './image-address.mjs';
import {parseScene,twitchContent} from './scene.mjs';
import {checkPlayerRequirements} from './player-contract.mjs';
const readTwitchScene=raw=>{const scene=parseScene(raw);twitchContent(scene);return scene;};
// Last known valid scene survives network failures and malformed updates. A
// channel change resets the revision guard, and disposed polls cannot deliver.
export function pollPublishedScene(getAuth,onScene,{fetcher=fetch,delay=10000,schedule=setTimeout,cancel=clearTimeout}={}) {
  let stopped=false,timer,channel,revision=0;
  const poll=async()=>{
    const auth=getAuth();
    if(auth?.channelId!==channel){channel=auth?.channelId;revision=0;}
    try {
      if(auth?.token) {
        const res=await fetcher(`${IMAGE_ORIGIN}/v1/channel/${auth.channelId}/scene`,{headers:{Authorization:`Bearer ${auth.token}`},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
        if(res.ok) {
          const data=await res.json();
          checkPlayerRequirements(data.requires);
          if(!stopped && getAuth()?.channelId===auth.channelId && data.schema===1 && Number.isSafeInteger(data.revision) && data.revision>revision && data.scene) {
            const scene=readTwitchScene(JSON.stringify(data.scene));
            revision=data.revision;onScene(scene);
          }
        }
      }
    } catch { /* Keep the working scene. */ }
    finally {if(!stopped) timer=schedule(poll,delay);}
  };
  poll();
  return ()=>{stopped=true;cancel(timer);};
}

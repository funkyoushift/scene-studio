import {IMAGE_ORIGIN} from './image-address.mjs';
export async function roomRequest(route,token,{method='GET',body,fetcher=fetch}={}){
  const response=await fetcher(`${IMAGE_ORIGIN}/test-room/${route}`,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(!response.ok)throw Object.assign(Error(data.error||'The test room could not connect.'),{status:response.status});
  return data;
}
// The existing automation renderer reads its normal viewer resources through
// this explicit adapter. It cannot turn a visitor token into studio access.
export function roomAutomationFetch(auth,onExpired=()=>{},fetcher=fetch){
  return async (url,options={})=>{
    const parsed=new URL(url),match=parsed.pathname.match(/^\/v1\/automations\/([1-9][0-9]{0,19})\/(config|active|hype)$/);
    if(parsed.origin!==IMAGE_ORIGIN || !match || match[1]!==auth.channelId || (options.method&&options.method!=='GET'))throw Error('Unsupported test-room request.');
    const response=await fetcher(`${IMAGE_ORIGIN}/test-room/play/${match[2]}`,{...options,headers:{Authorization:`Bearer ${auth.token}`},credentials:'omit',redirect:'error'});
    if([401,403,410].includes(response.status))onExpired();
    return response;
  };
}
export const roomCardRequest=(auth,route,action)=>{
  if(route!=='game')throw Error('Only the viewer card table is available.');
  return roomRequest('play/cards',auth.token,{method:action?'POST':'GET',body:action});
};
export function twitchVideoUrl(login,hostname){
  if(!/^[a-z0-9_]{1,25}$/.test(login)||!hostname)throw Error('Invalid stream address.');
  return `https://player.twitch.tv/?${new URLSearchParams({channel:login,parent:hostname,autoplay:'false'})}`;
}

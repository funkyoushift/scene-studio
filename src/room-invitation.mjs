// An invitation is a shareable room link, never a streamer or guest credential.
const key=channel=>`scene-studio-test-invite-v2-${channel}`;
function valid(value){
  if(!value||typeof value.roomId!=='string'||!value.roomId)return false;
  try{const url=new URL(value.url);return url.origin==='https://www.funkyoushift.com'&&url.pathname==='/scene-studio/test-room.html'&&!url.search&&/^#room=tr_[A-Za-z0-9_-]{43}$/.test(url.hash);}catch{return false;}
}
export function readRoomInvitation(channel,stores,roomId){
  for(const storage of stores){try{const value=JSON.parse(storage.getItem(key(channel)));if(valid(value)&&(!roomId||value.roomId===roomId))return value;}catch{}}
  return {};
}
export function saveRoomInvitation(channel,stores,value){if(!valid(value))return;for(const storage of stores){try{storage.setItem(key(channel),JSON.stringify(value));}catch{}}}
export function clearRoomInvitation(channel,stores){for(const storage of stores){try{storage.removeItem(key(channel));}catch{}}}

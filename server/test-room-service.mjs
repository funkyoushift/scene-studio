import {studioSession, digest, channelSceneRequest} from './studio-service.mjs';
import {readExperienceBody} from './experience-service.mjs';
import {automationRequest} from './automation-service.mjs';
import {cardGameRequest} from './card-game-service.mjs';
import {testChannelEnv} from './tester-access.mjs';

const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const bearer=request=>request.headers.get('authorization')?.slice(7) || '';
async function body(request){try{return JSON.parse(new TextDecoder().decode(await readExperienceBody(request,4096)));}catch(e){fail(e.status||400,'Invalid test-room request.');}}
const enabled=(env,channel)=>(env.TEST_CHANNELS||'').split(',').includes(channel);
async function save(env,token,kind,proof,identity,expires){
  const result=await env.IMAGES.prepare("INSERT INTO studio_auth(hash,kind,proof,identity,expires) SELECT ?1,?2,?3,?4,?5 WHERE (SELECT count(*) FROM studio_auth)<10000 AND (?2!='test_room' OR NOT EXISTS(SELECT 1 FROM studio_auth WHERE kind='test_room' AND proof=?3)) AND (?2!='test_viewer' OR (SELECT count(*) FROM studio_auth WHERE kind='test_viewer' AND proof=?3)<1000)")
    .bind(await digest(token),kind,proof,JSON.stringify(identity),expires).run();
  if(!result.meta.changes)fail(503,'Test rooms are busy. Please try again later.');
}
async function room(env,hash,now){
  const row=await env.IMAGES.prepare("SELECT identity,expires FROM studio_auth WHERE hash=?1 AND kind='test_room' AND expires>?2").bind(hash,now).first();
  if(!row)fail(410,'This test room is closed or expired. Ask the streamer for a new link.');
  const identity=JSON.parse(row.identity);
  if(!enabled(await testChannelEnv(env,identity.channelId),identity.channelId))fail(403,'This channel is not enabled for testing.');
  return {...identity,expiresAt:row.expires};
}

// Separate website capability: no Twitch JWT, owner session, or Twitch user ID
// is ever sent to visitors. Every request checks the revocable parent room.
export async function testRoomRequest(request,env,{now=Date.now()}={}){
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/test-room/'))return null;
  const origin=request.headers.get('origin');
  const cors=origin===env.STUDIO_ORIGIN ? origin : null;
  const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(cors?{'Access-Control-Allow-Origin':cors,Vary:'Origin'}:{})}});
  try {
    if(env.STUDIO_ENABLED!=='true')fail(404,'Test rooms are not enabled.');
    if(!cors)fail(403,'Open the official Scene Studio test page.');
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':cors,Vary:'Origin','Access-Control-Allow-Methods':'GET, POST, DELETE','Access-Control-Allow-Headers':'Authorization, Content-Type'}});
    if(path==='/test-room/manage'){
      const identity=await studioSession(request,env,now);
      env=await testChannelEnv(env,identity.channelId);
      if(!['GET','POST','DELETE'].includes(request.method))fail(405,'Method not allowed.');
      const current=await env.IMAGES.prepare("SELECT hash,expires FROM studio_auth WHERE kind='test_room' AND proof=?1 AND expires>?2 ORDER BY expires DESC LIMIT 1").bind(identity.channelId,now).first();
      if(request.method==='GET')return json({open:!!current,roomId:current?.hash||null,expiresAt:current?.expires||null});
      // Creating an invite never silently disconnects an existing room.
      if(request.method==='POST' && current)fail(409,'A room is already open. Use your saved link, or close it before creating a replacement.');
      await env.IMAGES.prepare("DELETE FROM studio_auth WHERE kind='test_room' AND proof=?1 AND (?2='DELETE' OR expires<=?3)").bind(identity.channelId,request.method,now).run();
      if(request.method==='DELETE')return json({open:false});
      await env.IMAGES.prepare('DELETE FROM studio_auth WHERE expires<=?1').bind(now).run();
      const invite=`tr_${random()}`,expiresAt=now+86400000;
      await save(env,invite,'test_room',identity.channelId,identity,expiresAt);
      return json({open:true,invite,roomId:await digest(invite),expiresAt,url:`${new URL('test-room.html',env.STUDIO_URL).href}#room=${invite}`});
    }
    if(path==='/test-room/join'){
      if(request.method!=='POST')fail(405,'Method not allowed.');
      const invite=bearer(request);
      if(!/^tr_[A-Za-z0-9_-]{43}$/.test(invite))fail(401,'Use the full test-room link from the streamer.');
      const hash=await digest(invite),identity=await room(env,hash,now);
      await env.IMAGES.prepare("DELETE FROM studio_auth WHERE kind='test_viewer' AND expires<=?1").bind(now).run();
      const count=await env.IMAGES.prepare("SELECT count(*) AS n FROM studio_auth WHERE kind='test_viewer' AND proof=?1").bind(hash).first();
      if(count.n>=1000)fail(429,'This test room is full. Please try again later.');
      const token=`tv_${random()}`,expiresAt=Math.min(identity.expiresAt,now+28800000);
      const viewer={channelId:identity.channelId,profile:identity.profile,guestId:`guest_${random()}`};
      await save(env,token,'test_viewer',hash,viewer,expiresAt);
      return json({token,channelId:viewer.channelId,profile:viewer.profile,expiresAt});
    }
    const match=path.match(/^\/test-room\/play\/(scene|config|active|hype|cards)$/);
    if(!match)fail(404,'Test-room route not found.');
    const route=match[1];
    if(request.method!=='GET' && !(route==='cards' && request.method==='POST'))fail(405,'Viewer access only.');
    const token=bearer(request);
    if(!/^tv_[A-Za-z0-9_-]{43}$/.test(token))fail(401,'Rejoin the test room.');
    const row=await env.IMAGES.prepare("SELECT identity,proof FROM studio_auth WHERE hash=?1 AND kind='test_viewer' AND expires>?2").bind(await digest(token),now).first();
    if(!row)fail(401,'Your test session expired. Rejoin the room.');
    const identity=JSON.parse(row.identity),parent=await room(env,row.proof,now);
    env=await testChannelEnv(env,identity.channelId);
    if(parent.channelId!==identity.channelId)fail(403,'Wrong test room.');
    const channel=identity.channelId,claims={role:'viewer',channel_id:channel,exp:Math.floor(now/1000)+60,test_room:true,guest_id:identity.guestId};
    if(route==='scene')return channelSceneRequest(request,env,{channel,route:'scene',claims},json,{now});
    const suffix=route==='cards'?`cards/${channel}/game`:`automations/${channel}/${route}`;
    let action;
    if(request.method==='POST'){
      action=await body(request);
      if(!['join','leave','submit','judge','redraw'].includes(action?.type))fail(403,'Only viewer card actions are available here.');
    }
    const internal=new Request(`${env.PUBLIC_SERVICE_URL}/v1/${suffix}`,{method:request.method,headers:{Origin:env.EXTENSION_ORIGIN,'Content-Type':'application/json'},...(action?{body:JSON.stringify(action)}:{})});
    if(route==='cards')return cardGameRequest(internal,env,{channel,route:'game',claims},json,now);
    const response=await automationRequest(internal,env,channel,{claims,now});
    const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin',cors);headers.set('Vary','Origin');headers.set('Cache-Control','no-store');
    return new Response(response.body,{status:response.status,headers});
  }catch(e){return json({error:e.status?e.message:'The test room is temporarily unavailable.'},e.status||503);}
}

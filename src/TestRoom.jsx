import React,{useState,useEffect,useMemo,useCallback} from 'react';
import Scene from './Scene.jsx';
import AutomationViewer from './AutomationViewer.jsx';
import CardPlayer from './CardPlayer.jsx';
import {parseScene,twitchContent} from './scene.mjs';
import {roomRequest,roomAutomationFetch,roomCardRequest,twitchVideoUrl} from './test-room-client.mjs';

function RoomPlayer({auth,onExpired}){
  const [scene,setScene]=useState(null),[message,setMessage]=useState('Connecting to the streamer…'),[video,setVideo]=useState(false);
  const helper=useMemo(()=>{const listeners=new Set();return {viewer:{isLinked:true,role:'viewer'},listen(_target,callback){listeners.add(callback);},unlisten(_target,callback){listeners.delete(callback);},deliver(event){for(const callback of listeners)callback('broadcast','application/json',JSON.stringify(event));}};},[auth]);
  const fetcher=useMemo(()=>roomAutomationFetch(auth,onExpired),[auth,onExpired]);
  useEffect(()=>{
    let active=true,timer,revision=0;
    const poll=async()=>{
      try{
        const data=await roomRequest('play/scene',auth.token);
        if(!active)return;
        if(data.schema!==1||!Number.isSafeInteger(data.revision))throw Error('The published scene could not be read.');
        if(data.scene && data.revision>revision){const next=parseScene(JSON.stringify(data.scene));twitchContent(next);revision=data.revision;setScene(next);}
        setMessage(data.scene?'Connected · published changes arrive automatically.':'Connected · the streamer has not published a scene yet.');
      }catch(e){if(active){setMessage(e.message);if([401,403,410].includes(e.status))onExpired(e.message);}}
      finally{if(active)timer=setTimeout(poll,10000);}
    };
    poll();return()=>{active=false;clearTimeout(timer);};
  },[auth,onExpired]);
  useEffect(()=>{
    let active=true,timer;
    const poll=async()=>{try{const data=await roomRequest('play/active',auth.token);if(active && data.event)helper.deliver(data.event);}catch(e){if(active&&[401,403,410].includes(e.status))onExpired(e.message);}finally{if(active)timer=setTimeout(poll,5000);}};
    poll();return()=>{active=false;clearTimeout(timer);};
  },[auth,helper,onExpired]);
  return <main className="test-room"><header><div><small>SCENE STUDIO · COMMUNITY TEST</small><h1>Play along with @{auth.profile.login}</h1><p role="status">{message}</p></div><a href={`https://www.twitch.tv/${auth.profile.login}`} target="_blank" rel="noopener noreferrer">Open Twitch ↗</a></header>
    <p className="test-room-note">You’re playing as a guest. Try the objects and games below. Your maze progress stays in this browser; the card table is shared with the streamer.</p>
    <div className="test-room-grid"><section className="test-room-stream" aria-label="Streamer video"><h2>The stream</h2>{video?<iframe title={`${auth.profile.login} on Twitch`} src={twitchVideoUrl(auth.profile.login,location.hostname)} allowFullScreen allow="autoplay; fullscreen"/>:<div className="test-room-video-intro"><span>▶</span><h3>Watch while you test</h3><p>Load the Twitch player here, or keep watching in your usual Twitch tab.</p><button onClick={()=>setVideo(true)}>Load stream</button></div>}</section>
    <section className="test-room-interactions" aria-label="Interactive player"><h2>Click, explore, play</h2><div className="test-room-stage">{scene?<Scene scene={scene}/>:<p>Waiting for a published scene…</p>}<CardPlayer auth={auth} helper={helper} request={roomCardRequest}/><AutomationViewer helper={helper} auth={auth} creator={auth.profile} fetcher={fetcher} catchUp viewMode="overlay" brandImage={scene?.objects.find(o=>o.image&&o.imageFit==='icon')?.image}/></div></section></div>
    <footer>Website test player · Twitch’s native extension still requires tester access. Local celebration buttons do not send chat messages. Guest session expires {new Date(auth.expiresAt).toLocaleString()}.</footer></main>;
}
export default function TestRoom(){
  const [invite]=useState(()=>new URLSearchParams(location.hash.slice(1)).get('room')||'');
  const [auth,setAuth]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const expired=useCallback((text='This room is no longer available. Rejoin or ask the streamer for a new link.')=>{sessionStorage.removeItem(`test-room-${invite}`);setAuth(null);setMessage(text);},[invite]);
  async function join(){setBusy(true);setMessage('');try{
    if(!/^tr_[A-Za-z0-9_-]{43}$/.test(invite))throw Error('Open the complete invitation link from your streamer.');
    const key=`test-room-${invite}`;let next;
    try{const saved=JSON.parse(sessionStorage.getItem(key));if(saved?.expiresAt>Date.now()){await roomRequest('play/scene',saved.token);next=saved;}}catch(e){if(e.status&&!([401,403,410].includes(e.status)))throw e;}
    next||=await roomRequest('join',invite,{method:'POST'});sessionStorage.setItem(key,JSON.stringify(next));setAuth(next);
  }catch(e){setMessage(e.message);}finally{setBusy(false);}}
  if(auth)return <RoomPlayer auth={auth} onExpired={expired}/>;
  return <main className="test-room-welcome"><small>SCENE STUDIO</small><h1>You’re invited to play.</h1><p>Try your streamer’s interactive scene, puzzles and card games. Open this link in your browser—there’s nothing to install.</p><button disabled={busy||!invite} onClick={join}>{busy?'Joining…':'Join as a guest'}</button><p role="status">{message||(!invite?'Ask your streamer for their viewer test-room link.':'No Twitch tester signup needed. The streamer controls when this room is open.')}</p><p>Guest card actions join the streamer’s current table. Twitch chat and purchases remain on Twitch.</p></main>;
}

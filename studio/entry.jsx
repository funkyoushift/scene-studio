import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {loadStudioSession,loadPublishedScene,startStudioSignIn} from '../src/studio-client.mjs';
import {getAutomationConfig} from '../src/automation-twitch.mjs';
import {takeCommunityReturn} from '../src/community-navigation.mjs';
import {emptyScene,emptyAutomation} from './catalog.mjs';
import {workspaceKeys,publishedWorkspace} from './workspace.mjs';
import {runtime} from './runtime.mjs';
import './base.css';
const root=createRoot(document.getElementById('root'));
function Problem({error}) {
  const [message,setMessage]=useState(error);
  return <main><h1>Your studio could not connect</h1><p role="alert">{message}</p><button onClick={()=>location.reload()}>Try again</button><button onClick={()=>startStudioSignIn().catch(e=>setMessage(e.message))}>Sign in with Twitch</button><p>Your saved draft has not been changed.</p></main>;
}
async function start(){
  root.render(<main><h1>Opening your studio…</h1></main>);
  try{
    const auth=await loadStudioSession();
    if(auth){const next=takeCommunityReturn(sessionStorage);if(next){location.replace(new URL(next,location.href));return;}}
    const [snapshot,automationSnapshot]=auth ? await Promise.all([loadPublishedScene(auth),getAutomationConfig(auth)]) : [{scene:emptyScene(),revision:0},{design:emptyAutomation(),revision:0,ownedMerch:false}];
    snapshot.capturedAt=new Date().toISOString();
    Object.assign(runtime,{auth,snapshot,automationSnapshot,...workspaceKeys(auth?.channelId||null),base:publishedWorkspace(snapshot,automationSnapshot)});
    root.unmount();
    await import('./new-ui.jsx');
  }catch(e){root.render(<Problem error={e.message}/>);}
}
start();

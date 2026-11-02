import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {loadStudioSession,loadPublishedScene,studioHelper,startStudioSignIn,signOutStudio,loadPublishHistory,restorePublishedScene} from './studio-client.mjs';
import './studio.css';import TestRoomControls from './TestRoomControls.jsx';import './test-room.css';import {takeCommunityReturn} from './community-navigation.mjs';

const root=createRoot(document.getElementById('root'));
function Welcome({message=''}) {
  const [status,setStatus]=useState(message),[busy,setBusy]=useState(false);
  return <main className="studio-welcome"><small>SCENE STUDIO</small><h1>Your stream. Your ideas.</h1><p>Build interactive scenes, games and live moments. Publish them to your Twitch player from here.</p><button disabled={busy} onClick={async()=>{setBusy(true);try{await startStudioSignIn();}catch(e){setStatus(e.message);setBusy(false);}}}>Sign in with Twitch</button><button onClick={()=>{sessionStorage.setItem('studio-preview','true');location.reload();}}>Explore the builder</button><p role="status">{status}</p><section aria-label="Testing with your community"><h2>Bring your own viewers</h2><ol><li><strong>Sign in as your channel.</strong> Approved streamer testers get their own studio.</li><li><strong>Create a viewer room.</strong> Choose Viewer test room and share your link.</li><li><strong>Host Cards Against Humanity.</strong> Pick your decks and rules, open the table, then start when players have joined.</li></ol><p>Your room, games and scores belong to your channel. Viewers join as guests on the website; no Twitch tester signup is needed.</p></section><p className="studio-note">Directly on Twitch, the unreleased extension still requires tester access. Viewer-room links stay open throughout testing, until release or until you close them.</p></main>;
}
function AccountBar({auth}) {
  const [history,setHistory]=useState(null),[target,setTarget]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function restore() {
    if(busy || !target || !history?.length)return;
    setBusy(true);setMessage('Restoring published design…');
    try {await restorePublishedScene(auth,history[0].revision,target);location.reload();}
    catch(e){setMessage(e.message);setBusy(false);setTarget(null);}
  }
  return <div className="studio-account">
    <strong>Studio · @{auth.profile.login}</strong><span>Changes go to your Twitch player</span>
    <TestRoomControls auth={auth}/>    <a className="studio-community-link" href="./community.html">Viewer rooms &amp; Cards Against Humanity →</a>    <button disabled={busy} onClick={async()=>{try{setHistory((await loadPublishHistory(auth)).history);setTarget(null);}catch(e){setMessage(e.message);}}}>Published history</button>
    <button onClick={()=>window.dispatchEvent(new Event('studio-recover'))}>Recover local draft</button>
    <button disabled={busy} onClick={async()=>{try{await signOutStudio(auth);}catch(e){setMessage(e.message);}}}>Sign out</button>
    {message && <p role="status">{message}</p>}
    {history && <section className="studio-history" aria-label="Published designs">
      <h2>Published designs</h2><p>Restoring changes your live overlay. Export any unsaved editor work before continuing.</p>
      {history.map((item,i)=><div key={item.revision}>Revision {item.revision} · {item.name} {i===0 ? '(current)' : <button disabled={busy} onClick={()=>setTarget(item.revision)}>Restore revision {item.revision}</button>}</div>)}
      {target && <section aria-label="Confirm restore"><p>Restore revision {target} to your live player and reload the editor? Unsaved edits will be lost.</p><button disabled={busy} onClick={restore}>Confirm restore</button><button disabled={busy} onClick={()=>setTarget(null)}>Cancel restore</button></section>}
      <button disabled={busy} onClick={()=>{setHistory(null);setTarget(null);}}>Close history</button>
    </section>}
  </div>;
}
async function start() {
  root.render(<main className="studio-welcome"><h1>Opening your studio…</h1></main>);
  try {
    const auth=await loadStudioSession();
    if(!auth && sessionStorage.getItem('studio-preview')!=='true'){root.render(<Welcome/>);return;}
    if(auth) {      const destination=takeCommunityReturn(sessionStorage);      if(destination){location.replace(new URL(destination,location.href).href);return;}
      sessionStorage.removeItem('studio-preview');
      const saved=await loadPublishedScene(auth);
      if(!saved.scene) throw Error('Your saved Twitch design could not be loaded. Please try again.');
      window.SceneStudioHelper=studioHelper(auth,saved);
      window.Twitch={ext:window.SceneStudioHelper};
      const account=document.createElement('div');account.id='studio-account';document.body.prepend(account);
      createRoot(account).render(<AccountBar auth={auth}/>);
    } else {
      const banner=document.createElement('div');banner.className='studio-account';banner.textContent='Preview mode · Sign in to publish to Twitch. ';
      const button=document.createElement('button');button.textContent='Sign in with Twitch';button.onclick=()=>startStudioSignIn().catch(e=>alert(e.message));banner.append(button);document.body.prepend(banner);
    }
    root.unmount();
    await import('./main.jsx');
  } catch(e) {root.render(<Welcome message={e.message}/>);}
}
start();

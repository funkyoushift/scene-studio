import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {loadStudioSession,startStudioSignIn,signOutStudio} from './studio-client.mjs';
import {communitySection,findCommunityTools} from './community-navigation.mjs';
import {CommunityChoices} from './CommunityChoices.jsx';
import TestRoomControls from './TestRoomControls.jsx';
import CardGame from './CardGame.jsx';
import './community.css';
import './test-room.css';

function CommunityStudio(){
  const [section,setSection]=useState(()=>communitySection(location.hash.slice(1))),[auth,setAuth]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState('');
  useEffect(()=>{let current=true;loadStudioSession().then(value=>{if(current)setAuth(value);}).catch(e=>{if(current)setError(e.message);}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[]);
  useEffect(()=>{const change=()=>{setSection(communitySection(location.hash.slice(1)));setQuery('');};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  function go(next){setQuery('');setSection(next);history.replaceState(null,'',`#${next}`);window.scrollTo({top:0,behavior:'instant'});}
  async function signIn(){setBusy(true);setError('');try{await startStudioSignIn({community:true,section});}catch(e){setError(e.message);setBusy(false);}}
  return <div className="community-app">
    <aside className="community-sidebar"><a className="community-brand" href="#home" onClick={e=>{e.preventDefault();go('home');}}><span>✳</span> Scene Studio</a><nav aria-label="Community navigation">{[['home','⌂','Community home'],['room','▣','Viewer rooms'],['cards','♠','Cards Against Humanity']].map(([id,icon,label])=><button key={id} aria-current={section===id?'page':undefined} onClick={()=>go(id)}><span aria-hidden="true">{icon}</span>{label}</button>)}</nav><a className="community-editor-link" href="./index.html">← Scene editor &amp; all tools</a><div className="community-account">{auth?<><strong>@{auth.profile.login}</strong><small>Your channel’s live studio</small><button disabled={busy} onClick={async()=>{setBusy(true);try{await signOutStudio(auth);}catch(e){setError(e.message);setBusy(false);}}}>Sign out</button></>:<><strong>Your community starts here</strong><small>Sign in as the streamer</small></>}</div></aside>
    <div className="community-shell"><header className="community-topbar"><label><span aria-hidden="true">⌕</span><input type="search" aria-label="Search viewer rooms and games" placeholder="Find rooms, invitations, decks or rules…" value={query} onChange={e=>setQuery(e.target.value)}/></label><span className="community-live-badge">{auth?'Connected to your channel':'Streamer testing'}</span></header>
    <main>{error&&<p className="community-error" role="alert">{error}</p>}{loading?<h1>Opening your community studio…</h1>:<>
      {query?<><h1>Find your next step</h1><div className="community-search-results">{findCommunityTools(query).map(tool=><button key={tool.id} onClick={()=>go(tool.id)}><strong>{tool.name}</strong><span>{tool.description} →</span></button>)}{!findCommunityTools(query).length&&<p>No matches. Try “invite”, “CAH”, “packs” or “rules”.</p>}</div></>:<>
      {section==='home'&&<><div className="community-heading"><small>PLAY WITH YOUR COMMUNITY</small><h1>{auth?`Your viewers. Your game night.`:'Bring everyone into the game.'}</h1><p>A room to share. A game to play. Everything belongs to your own channel.</p></div><CommunityChoices onGo={go}/><section className="community-how"><h2>From setup to game night</h2><ol><li><b>1 · Invite</b><span>Create your viewer-room link and share it.</span></li><li><b>2 · Set up</b><span>Choose Cards Against Humanity decks and house rules.</span></li><li><b>3 · Play</b><span>Open your lobby. Start when at least three players are seated.</span></li></ol></section></>}
      {section==='room'&&<div className="community-heading"><small>INVITE YOUR COMMUNITY</small><h1>Viewer rooms</h1><p>One link for your stream’s scenes, clickable moments and games.</p></div>}
      {section==='cards'&&<div className="community-heading"><small>GAME NIGHT</small><h1>Cards Against Humanity</h1><p>Pick your decks, make the rules yours, and play together.</p><button className="community-secondary" onClick={()=>go('room')}>Get your viewer invitation →</button></div>}
      </>}
      {!auth&&<section className="community-signin"><div><h2>Sign in to your own studio</h2><p>Approved streamers can create rooms and host games. Your viewers join your invitation as guests, with nothing to install.</p></div><button className="community-primary" disabled={busy} onClick={signIn}>{busy?'Opening Twitch…':'Sign in with Twitch'}</button></section>}
      {auth&&<><div hidden={!!query||section!=='room'}><TestRoomControls key={auth.channelId} auth={auth} embedded onHostGame={()=>go('cards')}/></div><div hidden={!!query||section!=='cards'}><CardGame key={auth.channelId} auth={auth} host inline guided onClose={()=>go('home')}/></div></>}
      <p className="community-footnote">Viewer rooms stay open throughout testing, until release or until you close them. Website guests need no Twitch tester signup. Your scenes and games stay separate from other streamers’ channels.</p>
    </>}</main></div>
  </div>;
}
createRoot(document.getElementById('root')).render(<CommunityStudio/>);

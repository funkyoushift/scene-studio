import React,{useEffect,useRef,useState} from 'react';
import {CardTable,cardRequest} from './CardGame.jsx';

// Viewer entry has no catalog, deck preparation, or authoring controls.
export default function CardPlayer({auth,helper,request=cardRequest}) {
  const [game,setGame]=useState(null),[open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const dialog=useRef(null),generation=useRef(0),locked=useRef(false),epoch=useRef(0);
  const accept=data=>setGame(old=>!data.game ? null : old?.id===data.game.id && old.revision>data.game.revision ? old : data.game);
  useEffect(()=>{generation.current++;setGame(null);setOpen(false);setError('');setBusy(false);locked.current=false;return()=>{generation.current++;};},[auth?.channelId]);
  useEffect(()=>{
    if(!auth?.token)return;
    let active=true,timer;
    const poll=async()=>{const started=epoch.current;try{if(!document.hidden && !locked.current){const data=await request(auth,'game');if(active && started===epoch.current)accept(data);}}catch(e){if(active && open)setError(e.message);}finally{if(active)timer=setTimeout(poll,open?4000:20000);}};
    poll();return()=>{active=false;clearTimeout(timer);};
  },[auth?.channelId,auth?.token,open,request]);
  useEffect(()=>{if(open && dialog.current && !dialog.current.open)dialog.current.showModal();},[open]);
  const act=async action=>{
    if(locked.current || !auth?.token)return;
    if(helper?.viewer && !helper.viewer.isLinked){helper.actions.requestIdShare();setError('Share your Twitch identity, then try again.');return;}
    if(!['join','leave','submit','judge','redraw'].includes(action.type))return;
    const started=generation.current;epoch.current++;locked.current=true;setBusy(true);setError('');
    try{const data=await request(auth,'game',{...action,gameId:game?.id,revision:game?.revision});if(started===generation.current)accept(data);}
    catch(e){if(started===generation.current){setError(e.message);try{const data=await request(auth,'game');if(started===generation.current)accept(data);}catch{}}}
    finally{if(started===generation.current){locked.current=false;setBusy(false);}}
  };
  if(!game && !open)return null;
  return <>{!open && game && <button className="cg-launcher" onClick={()=>setOpen(true)}>♠ Card table · {game.players.length} players</button>}{open && <dialog className="cg-dialog" ref={dialog} aria-label="Stream card game" onCancel={e=>{e.preventDefault();setOpen(false);}}><header><h2>Cards with your community</h2><button aria-label="Close card game window" onClick={()=>setOpen(false)}>×</button></header><div className="cg-body">{error && <p role="alert">{error}</p>}{game ? <CardTable game={game} busy={busy} act={act} isHost={false}/> : <p>The streamer has closed the table.</p>}</div></dialog>}</>;
}

import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import CardGame,{CardTable} from '../../src/CardGame.jsx';
import {newCardGame,cardTransition,cardView} from '../../src/card-game.mjs';
const testDeck={white:Array.from({length:100},(_,i)=>({text:['A raccoon running the soundboard.','An emergency confetti delivery.','The loading screen that never ends.','A heroic snack break.','One very confused rubber duck.'][i%5]+` #${i+1}`})),black:Array.from({length:8},(_,i)=>({text:i%2?'Tonight’s stream is sponsored by _ and _.':'The secret to a perfect BRB screen is _.',pick:i%2?2:1,draw:0})),packs:[{id:'original',name:'Original UI test cards'}],available:{white:100,black:8}};
function initial(){let s=newCardGame('123',{},testDeck);for(const user of ['123','200','300'])s=cardTransition(s,user,{type:'join'});return s;}
function App(){const [state,setState]=useState(initial),[actor,setActor]=useState('123'),[error,setError]=useState(''),[setup,setSetup]=useState(false);
 const request=async(auth,route,action)=>{
   if(route==='catalog')return (await fetch('/outputs/card-game-20261101/catalog/assets/card-catalog/v1/catalog.json')).json();
   if(route.startsWith('shard-')){const [part,v]=route.split('?v=');return(await fetch(`/outputs/card-game-20261101/catalog/assets/card-catalog/v1/${v}/${part}.json`)).json();}
   if(action?.type==='create'){setState(newCardGame('123',action.rules,action.deck));throw Error('Local catalog preparation succeeded. This fixture does not create a Twitch lobby.');}
   return {game:null};
 };
 return <main style={{maxWidth:1100,margin:'20px auto',padding:20}}><h1>Card game · local test</h1><p>Simulated identities and original fixture cards. No Twitch actions.</p><div className="cg-actions">{[['123','Streamer'],['200','Player 2'],['300','Player 3'],['','Spectator']].map(([id,name])=><button key={id} onClick={()=>{setActor(id);setError('');}}>{name} view</button>)}<button onClick={()=>setSetup(true)}>Inspect real expansion catalog</button><button onClick={()=>{setState(initial());setActor('123');setError('');}}>Reset test</button></div>{error&&<p role="alert">{error}</p>}
 <section className="cg-dialog" style={{width:'100%',maxHeight:'none',padding:24}}><CardTable game={cardView(state,actor).game} isHost={actor==='123'} busy={false} act={action=>{try{setState(cardTransition(state,actor,action));setError('');}catch(e){setError(e.message);}}}/></section>
 {setup&&<CardGame auth={{channelId:'123',token:'local-test-only'}} host request={request} onClose={()=>setSetup(false)}/>}</main>;
}createRoot(document.getElementById('root')).render(<App/>);

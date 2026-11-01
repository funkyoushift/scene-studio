// Only an explicit conflict proves a submission was rejected. Never replay a
// timed-out/failed network write, or carry selected cards into another round.
export async function performCardAction(auth,action,original,request,isCurrent=()=>true){
  let snapshot=original;
  for(let attempt=0;attempt<3;attempt++){
    if(!isCurrent())throw Error('The player session changed.');
    try{return await request(auth,'game',{...action,gameId:snapshot?.id,revision:snapshot?.revision});}
    catch(error){
      if(error.status!==409 || action.type!=='submit' || attempt===2 || !original?.me || !Array.isArray(action.cards))throw error;
      const fresh=await request(auth,'game'),next=fresh.game;
      if(!isCurrent() || !next || next.id!==original.id || next.round!==original.round || next.me!==original.me)throw error;
      if(next.submitted)return fresh;
      if(next.phase!=='playing' || next.judge!==original.judge || !action.cards.every(id=>next.hand.some(card=>card.id===id)))throw error;
      snapshot=next;
    }
  }
}

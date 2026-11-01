import test from 'node:test';
import assert from 'node:assert/strict';
import {performCardAction} from '../src/card-actions.mjs';
const initial={id:'game',revision:1,round:1,phase:'playing',me:'p2',judge:'p1',submitted:false,hand:[{id:10},{id:11}]};
const conflict=()=>Object.assign(Error('Table changed'),{status:409});
test('simultaneous rejected submissions refresh and preserve each chosen answer',async()=>{
  let revision=1;const submitted=new Map(),posts=[];
  const request=async(auth,route,action)=>{
    if(!action)return{game:{...initial,me:auth.player,revision,submitted:submitted.has(auth.player)}};
    posts.push({player:auth.player,...action});
    if(action.revision!==revision)throw conflict();
    submitted.set(auth.player,action.cards);revision++;
    return{game:{...initial,me:auth.player,revision,submitted:true}};
  };
  const results=await Promise.all(['p2','p3','p4'].map(player=>performCardAction({player},{type:'submit',cards:[10]},{...initial,me:player},request)));
  assert.equal(submitted.size,3);assert.ok(results.every(data=>data.game.submitted));
  assert.ok(posts.every(action=>action.cards.length===1&&action.cards[0]===10));
  for(const player of ['p2','p3','p4'])assert.ok(posts.filter(p=>p.player===player).length<=3);
});
test('uncertain writes and host controls are never replayed',async()=>{
  for(const [action,error] of [[{type:'submit',cards:[10]},Error('Network timeout')],[{type:'start'},conflict()]]){
    let calls=0;await assert.rejects(()=>performCardAction({},action,initial,async()=>{calls++;throw error;}));assert.equal(calls,1);
  }
});
test('changed rounds, seats, judges, unavailable cards, and changed sessions stop retries',async()=>{
  for(const change of [{id:'different'},{round:2},{me:'p3'},{judge:'p3'},{phase:'judging'},{hand:[]}]){
    let posts=0;await assert.rejects(()=>performCardAction({},{type:'submit',cards:[10]},initial,async(_a,_r,action)=>{if(action){posts++;throw conflict();}return{game:{...initial,...change,revision:2}};}));assert.equal(posts,1);
  }
  let current=true,posts=0;
  await assert.rejects(()=>performCardAction({},{type:'submit',cards:[10]},initial,async(_a,_r,action)=>{if(action){posts++;throw conflict();}current=false;return{game:{...initial,revision:2}};},()=>current));assert.equal(posts,1);
});
test('accepted answers are not submitted twice and repeated conflicts are bounded',async()=>{
  let posts=0;
  const result=await performCardAction({},{type:'submit',cards:[10]},initial,async(_a,_r,action)=>{if(action){posts++;throw conflict();}return{game:{...initial,submitted:true,revision:2}};});assert.equal(posts,1);assert.equal(result.game.submitted,true);
  posts=0;await assert.rejects(()=>performCardAction({},{type:'submit',cards:[10]},initial,async(_a,_r,action)=>{if(action){posts++;throw conflict();}return{game:{...initial,revision:2}};}));assert.equal(posts,3);
});

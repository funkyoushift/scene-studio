import test from 'node:test';
import assert from 'node:assert/strict';
import {communitySection,rememberCommunityReturn,takeCommunityReturn,findCommunityTools} from '../src/community-navigation.mjs';
import {readRoomInvitation,saveRoomInvitation,clearRoomInvitation} from '../src/room-invitation.mjs';
test('Twitch sign-in returns only to a known community page and consumes its destination once',()=>{
  const values=new Map(),storage={setItem:(key,value)=>values.set(key,value),getItem:key=>values.get(key)??null,removeItem:key=>values.delete(key)};
  for(const section of ['room','cards','home']){rememberCommunityReturn(storage,section);assert.equal(takeCommunityReturn(storage),`community.html#${section}`);assert.equal(takeCommunityReturn(storage),null);}
  for(const bad of ['https://evil.test','//evil.test','../other','cards?token=secret']){assert.equal(communitySection(bad),'home');values.set('scene-studio-return-v1',bad);assert.equal(takeCommunityReturn(storage),'community.html#home');}
});
test('new navigation finds invitations, CAH, expansions and rules without a full-page scan',()=>{
  for(const query of ['invite','viewer room','guest','share link'])assert.deepEqual(findCommunityTools(query).map(t=>t.id),['room']);
  for(const query of ['cah','cards against humanity','packs','expansions','rules'])assert.deepEqual(findCommunityTools(query).map(t=>t.id),['cards']);
  assert.deepEqual(findCommunityTools('unfindable'),[]);
});
test('room links survive a new tab, migrate old tab storage, and never cross channels or room replacements',()=>{
  const makeStorage=()=>{const map=new Map();return{getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};};
  const local=makeStorage(),oldTab=makeStorage(),newTab=makeStorage();
  const a={roomId:'room-a',url:'https://www.funkyoushift.com/scene-studio/test-room.html#room=tr_'+'a'.repeat(43)};
  const b={roomId:'room-b',url:a.url.replace('a'.repeat(43),'b'.repeat(43))};
  saveRoomInvitation('123',[oldTab],a);
  assert.deepEqual(readRoomInvitation('123',[local,oldTab],'room-a'),a);
  saveRoomInvitation('123',[local,oldTab],readRoomInvitation('123',[local,oldTab],'room-a'));
  assert.deepEqual(readRoomInvitation('123',[local,newTab],'room-a'),a);
  assert.deepEqual(readRoomInvitation('456',[local,oldTab]),{});
  saveRoomInvitation('123',[local,newTab],b);
  assert.deepEqual(readRoomInvitation('123',[local,oldTab],'room-b'),b);
  assert.deepEqual(readRoomInvitation('123',[local,newTab],'room-a'),{});
  saveRoomInvitation('456',[local],{...a,url:'https://evil.test/#room=tr_'+'a'.repeat(43)});
  assert.deepEqual(readRoomInvitation('456',[local]),{});
  clearRoomInvitation('123',[local,newTab]);assert.deepEqual(readRoomInvitation('123',[local,newTab]),{});
  assert.deepEqual(readRoomInvitation('123',[{getItem(){throw Error('blocked');}}]),{});
});

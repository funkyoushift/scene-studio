import test from 'node:test';
import assert from 'node:assert/strict';
import {communitySection,rememberCommunityReturn,takeCommunityReturn,findCommunityTools} from '../src/community-navigation.mjs';
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

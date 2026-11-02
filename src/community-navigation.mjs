// Only known first-party destinations can be restored after Twitch sign-in.
const RETURN_KEY='scene-studio-return-v1';
export const communitySection=value=>['room','cards'].includes(value)?value:'home';
export function rememberCommunityReturn(storage,section){storage.setItem(RETURN_KEY,communitySection(section));}
export function takeCommunityReturn(storage){const value=storage.getItem(RETURN_KEY);storage.removeItem(RETURN_KEY);return value!==null?`community.html#${communitySection(value)}`:null;}
export const communityTools=[
  {id:'room',name:'Viewer rooms',description:'Create a link and invite your viewers to play.',words:'invite share link guest tester preview room'},
  {id:'cards',name:'Cards Against Humanity',description:'Choose expansions, set house rules and host your table.',words:'cah card game packs decks expansions rules lobby host'},
];
export function findCommunityTools(query){const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean);return communityTools.filter(t=>words.every(word=>`${t.name} ${t.description} ${t.words}`.toLowerCase().includes(word)));}

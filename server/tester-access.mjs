// Twitch tester names are approved explicitly by the project owner. A name is
// bound to a numeric channel only after Twitch validates that account's OAuth.
export const approvedTester=(env,login)=>(env.TEST_STREAMER_LOGINS||'').split(',').includes(login);
const listed=(value,item)=>(value||'').split(',').map(s=>s.trim()).includes(item);
const validChannel=channel=>/^[1-9][0-9]{0,19}$/.test(channel||'');
export const publicStudioEnabled=env=>env.STUDIO_ENABLED==='true'&&env.STUDIO_PUBLIC_ENABLED==='true';
export const channelBlocked=(env,channel)=>listed(env.STUDIO_BLOCKED_CHANNELS,channel);
// STUDIO_CHANNEL is an internal, request-scoped result of enrollment lookup.
// It is never accepted from a request header, body or OAuth query parameter.
export const studioChannelEnabled=(env,channel)=>validChannel(channel)&&!channelBlocked(env,channel)&&
  (listed(env.TEST_CHANNELS,channel)||(publicStudioEnabled(env)&&env.STUDIO_CHANNEL===channel));
export const studioLoginAllowed=(env,channel,login)=>validChannel(channel)&&!channelBlocked(env,channel)&&
  (listed(env.TEST_CHANNELS,channel)||approvedTester(env,login)||publicStudioEnabled(env));

export async function registerStudioChannel(env,profile){
  if(!validChannel(profile?.id)||!/^[a-z0-9_]{1,25}$/.test(profile?.login||''))throw Error('Invalid verified channel identity.');
  if(!publicStudioEnabled(env)||channelBlocked(env,profile.id)||listed(env.TEST_CHANNELS,profile.id)||approvedTester(env,profile.login))return;
  const key=`studio-channel:${profile.id}`;
  // One durable enrollment per verified channel, sharing the existing bounded
  // auth-store capacity. Existing enrollments remain refreshable at capacity.
  const result=await env.IMAGES.prepare("INSERT INTO studio_auth(hash,kind,proof,identity,expires) SELECT ?1,'studio_channel',?2,?3,?4 WHERE (SELECT count(*) FROM studio_auth)<10000 OR EXISTS(SELECT 1 FROM studio_auth WHERE hash=?1 AND kind='studio_channel') ON CONFLICT(hash) DO UPDATE SET identity=excluded.identity")
    .bind(key,profile.id,JSON.stringify(profile),Number.MAX_SAFE_INTEGER).run();
  if(!result.meta.changes)throw Object.assign(Error('Studio enrollment is busy. Please try again later.'),{status:503});
}
export async function registerTester(env,profile){
  if(!approvedTester(env,profile.login))return;
  await env.IMAGES.prepare("INSERT INTO studio_auth(hash,kind,proof,identity,expires) VALUES(?1,'test_channel',?2,?3,?4) ON CONFLICT(hash) DO UPDATE SET identity=excluded.identity")
    .bind(`test-channel:${profile.id}`,profile.id,JSON.stringify(profile),Number.MAX_SAFE_INTEGER).run();
}
export async function testChannelEnv(env,channel){
  // Discard any previous request scope before resolving this channel.
  const {STUDIO_CHANNEL:previousScope,...base}=env;
  if(!validChannel(channel)||channelBlocked(base,channel)||listed(base.TEST_CHANNELS,channel))return base;
  if(base.TEST_STREAMER_LOGINS){
    const row=await base.IMAGES.prepare("SELECT identity FROM studio_auth WHERE hash=?1 AND kind='test_channel' AND proof=?2").bind(`test-channel:${channel}`,channel).first();
    const profile=row?JSON.parse(row.identity):null;
    if(profile?.id===channel&&approvedTester(base,profile.login))return {...base,TEST_CHANNELS:[base.TEST_CHANNELS,channel].filter(Boolean).join(',')};
  }
  if(publicStudioEnabled(base)){
    const row=await base.IMAGES.prepare("SELECT identity FROM studio_auth WHERE hash=?1 AND kind='studio_channel' AND proof=?2").bind(`studio-channel:${channel}`,channel).first();
    const profile=row?JSON.parse(row.identity):null;
    if(profile?.id===channel&&/^[a-z0-9_]{1,25}$/.test(profile.login||''))return {...base,STUDIO_CHANNEL:channel};
  }
  return base;
}
export async function requestTestChannelEnv(request,env){
  const path=new URL(request.url).pathname;
  const channel=path.match(/^\/v1\/(?:channel|cards|automations|chat)\/([1-9][0-9]{0,19})\//)?.[1] || path.match(/^\/(?:images|media|experiences|sounds|party)\/([1-9][0-9]{0,19})(?:\/|$)/)?.[1];
  return channel ? testChannelEnv(env,channel) : env;
}

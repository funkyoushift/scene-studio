// Twitch tester names are approved explicitly by the project owner. A name is
// bound to a numeric channel only after Twitch validates that account's OAuth.
export const approvedTester=(env,login)=>(env.TEST_STREAMER_LOGINS||'').split(',').includes(login);
export async function registerTester(env,profile){
  if(!approvedTester(env,profile.login))return;
  await env.IMAGES.prepare("INSERT INTO studio_auth(hash,kind,proof,identity,expires) VALUES(?1,'test_channel',?2,?3,?4) ON CONFLICT(hash) DO UPDATE SET identity=excluded.identity")
    .bind(`test-channel:${profile.id}`,profile.id,JSON.stringify(profile),Number.MAX_SAFE_INTEGER).run();
}
export async function testChannelEnv(env,channel){
  if((env.TEST_CHANNELS||'').split(',').includes(channel))return env;
  if(!env.TEST_STREAMER_LOGINS || !/^[1-9][0-9]{0,19}$/.test(channel||''))return env;
  const row=await env.IMAGES.prepare("SELECT identity FROM studio_auth WHERE hash=?1 AND kind='test_channel' AND proof=?2").bind(`test-channel:${channel}`,channel).first();
  if(!row)return env;
  const profile=JSON.parse(row.identity);
  return profile.id===channel&&approvedTester(env,profile.login) ? {...env,TEST_CHANNELS:[env.TEST_CHANNELS,channel].filter(Boolean).join(',')} : env;
}
export async function requestTestChannelEnv(request,env){
  const path=new URL(request.url).pathname;
  const channel=path.match(/^\/v1\/(?:channel|cards|automations|chat)\/([1-9][0-9]{0,19})\//)?.[1] || path.match(/^\/(?:images|media|experiences|sounds|party)\/([1-9][0-9]{0,19})(?:\/|$)/)?.[1];
  return channel ? testChannelEnv(env,channel) : env;
}

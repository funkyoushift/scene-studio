import { readExperienceBody } from './experience-service.mjs';
import { parseScene, twitchContent, starterScene } from '../src/scene.mjs';
import { hostedImage } from '../src/image-address.mjs';
import { signPartyToken } from './party-service.mjs';
import {approvedTester,registerTester,testChannelEnv} from './tester-access.mjs';

const encoder = new TextEncoder();
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async value => encode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
const jsonBody = async request => {
  try { return JSON.parse(new TextDecoder().decode(await readExperienceBody(request, 12000))); }
  catch (e) { if(e.status) throw e; fail(400, 'Invalid request.'); }
};
const allowedChannel = (env, channel) => (env.TEST_CHANNELS || '').split(',').includes(channel);
function response(data, status = 200, origin) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  } });
}
export async function studioSession(request, env, now = Date.now()) {
  const token = request.headers.get('authorization')?.match(/^Bearer (ss_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) fail(401, 'Sign in to Scene Studio again. Your work is kept.');
  const row = await env.IMAGES.prepare("SELECT identity FROM studio_auth WHERE hash=?1 AND kind='session' AND expires>?2").bind(await digest(token), now).first();
  if (!row) fail(401, 'Your studio sign-in expired. Sign in again; your work is kept.');
  const identity = JSON.parse(row.identity);
  if (!allowedChannel(env, identity.channelId) && !approvedTester(env,identity.profile?.login)) fail(403, 'This channel is not enabled for the current test.');
  return identity;
}
async function remember(env, value, kind, proof, identity, expires) {
  const saved = await env.IMAGES.prepare('INSERT INTO studio_auth(hash,kind,proof,identity,expires) SELECT ?1,?2,?3,?4,?5 WHERE (SELECT count(*) FROM studio_auth)<10000')
    .bind(await digest(value), kind, proof, identity ? JSON.stringify(identity) : null, expires).run();
  if (!saved.meta.changes) fail(503, 'Sign-in is busy. Please try again shortly.');
}
async function consume(env, value, kind, proof, now) {
  return env.IMAGES.prepare('DELETE FROM studio_auth WHERE hash=?1 AND kind=?2 AND proof=?3 AND expires>?4 RETURNING identity,proof')
    .bind(await digest(value), kind, proof, now).first();
}

// OAuth tokens stay on the server and are discarded after identity validation.
// The website receives a one-hour, revocable studio session, never an extension JWT.
export async function studioAuth(request, env, { now = Date.now(), fetcher = fetch } = {}) {
  const url = new URL(request.url), origin = request.headers.get('origin');
  const callback = url.pathname === '/chat/callback' && url.searchParams.get('state')?.startsWith('studio_');
  if (!callback && !url.pathname.startsWith('/studio/auth/')) return null;
  if (env.STUDIO_ENABLED !== 'true') return response({ error: 'Studio sign-in is not enabled.' }, 404);
  const cors = origin === env.STUDIO_ORIGIN ? origin : undefined;
  try {
    if (callback) {
      if(request.method !== 'GET') fail(405, 'Method not allowed.');
      const state = url.searchParams.get('state');
      if(!/^studio_[A-Za-z0-9_-]{43}$/.test(state)) fail(400, 'Invalid sign-in.');
      const row = await env.IMAGES.prepare("DELETE FROM studio_auth WHERE hash=?1 AND kind='state' AND expires>?2 RETURNING proof").bind(await digest(state), now).first();
      if (!row || url.searchParams.has('error') || !url.searchParams.get('code')) fail(400, 'Sign-in expired or was declined. Return to Scene Studio and sign in again.');
      const exchange = await fetcher('https://id.twitch.tv/oauth2/token', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000), body: new URLSearchParams({
        client_id: env.TWITCH_CHAT_CLIENT_ID, client_secret: env.TWITCH_CHAT_CLIENT_SECRET,
        code: url.searchParams.get('code'), grant_type: 'authorization_code', redirect_uri: `${env.PUBLIC_SERVICE_URL}/chat/callback`,
      }) });
      if (!exchange.ok) fail(502, 'Twitch sign-in could not be completed. Return to Scene Studio and try again.');
      const access = (await exchange.json()).access_token;
      if (typeof access !== 'string') fail(502, 'Twitch sign-in could not be verified.');
      const validation = await fetcher('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${access}` }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
      if (!validation.ok) fail(401, 'Twitch sign-in could not be verified.');
      const user = await validation.json();
      if (user.client_id !== env.TWITCH_CHAT_CLIENT_ID || !/^[1-9][0-9]{0,19}$/.test(user.user_id) || !/^[a-z0-9_]{1,25}$/.test(user.login)) fail(401, 'Twitch identity did not match.');
      if (!allowedChannel(env, user.user_id) && !approvedTester(env,user.login)) fail(403, 'This channel is not enabled for the current test.');
      await registerTester(env,{id:user.user_id,login:user.login});
      const code = random();
      await remember(env, code, 'grant', row.proof, { channelId: user.user_id, profile: { id: user.user_id, login: user.login } }, now + 120000);
      return new Response(null, { status: 303, headers: { Location: `${env.STUDIO_URL}#studio_code=${code}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    }
    if (!cors) fail(403, 'Open the official Scene Studio website.');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': cors, Vary:'Origin', 'Access-Control-Allow-Methods':'GET, POST, DELETE', 'Access-Control-Allow-Headers':'Authorization, Content-Type' } });
    if (url.pathname === '/studio/auth/session' && request.method === 'GET') return response(await studioSession(request, env, now), 200, cors);
    if (url.pathname === '/studio/auth/session' && request.method === 'DELETE') {
      await studioSession(request, env, now);
      await env.IMAGES.prepare('DELETE FROM studio_auth WHERE hash=?1').bind(await digest(request.headers.get('authorization').slice(7))).run();
      return response({ signedOut:true }, 200, cors);
    }
    if (request.method !== 'POST') fail(405, 'Method not allowed.');
    const body = await jsonBody(request);
    if (url.pathname === '/studio/auth/start') {
      if (!/^[A-Za-z0-9_-]{43}$/.test(body.challenge)) fail(400, 'Invalid sign-in proof.');
      await env.IMAGES.prepare('DELETE FROM studio_auth WHERE expires<=?1').bind(now).run();
      const state = `studio_${random()}`;
      await remember(env, state, 'state', body.challenge, null, now + 600000);
      const target = new URL('https://id.twitch.tv/oauth2/authorize');
      target.search = new URLSearchParams({ client_id: env.TWITCH_CHAT_CLIENT_ID, redirect_uri: `${env.PUBLIC_SERVICE_URL}/chat/callback`, response_type:'code', scope:'', state });
      return response({ authorizeUrl:target.href }, 200, cors);
    }
    if (url.pathname === '/studio/auth/exchange') {
      if (!/^[A-Za-z0-9_-]{43}$/.test(body.code) || !/^[A-Za-z0-9_-]{43}$/.test(body.verifier)) fail(400, 'Invalid sign-in proof.');
      const row = await consume(env, body.code, 'grant', await digest(body.verifier), now);
      if(!row) fail(401, 'Sign-in expired or belongs to another browser tab. Sign in again.');
      const identity = JSON.parse(row.identity), token = `ss_${random()}`, expiresAt = now + 3600000;
      await remember(env, token, 'session', '', identity, expiresAt);
      return response({ ...identity, token, expiresAt, studio:true }, 200, cors);
    }
    fail(404, 'Not found.');
  } catch (e) { return response({ error:e.status ? e.message : 'Studio sign-in is temporarily unavailable.' }, e.status || 503, cors); }
}

// Explicit, channel-scoped routes only. External studio credentials cannot be
// used for webhooks, public callbacks, developer APIs or another channel.
export function studioRouteChannel(path) {
  return path.match(/^\/v1\/(?:channel|cards|automations|chat)\/([1-9][0-9]{0,19})\/(?:scene|history|rollback|catalog|game|shard-(?:[0-9]|[12][0-9]|3[01])|config|fire|active|hype|connection|connect|triggers|trigger-connect|activity|activity-connect|presence|presence-connect)$/)?.[1]
    || path.match(/^\/(?:images|media|experiences|sounds)\/([1-9][0-9]{0,19})(?:\/[a-f0-9]{64}\.(?:png|mp4|webm|json|wav|mp3))?$/)?.[1];
}
async function internalToken(env, channel, now) {
  const part = obj => encode(encoder.encode(JSON.stringify(obj)));
  const input = `${part({alg:'HS256',typ:'JWT'})}.${part({ role:'broadcaster', user_id:channel, channel_id:channel, opaque_user_id:`U${channel}`, exp:Math.floor(now/1000)+60 })}`;
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(env.EXTENSION_SECRET), c=>c.charCodeAt(0)), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return `${input}.${encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(input))))}`;
}
export async function studioGateway(request, env, forward) {
  if (env.STUDIO_ENABLED !== 'true' || request.headers.get('origin') !== env.STUDIO_ORIGIN) return null;
  const channel = studioRouteChannel(new URL(request.url).pathname);
  if (!channel) return null;
  // Public immutable asset reads do not require a session.
  if(request.method==='GET' && /\/[a-f0-9]{64}\./.test(new URL(request.url).pathname)) return null;
  try {
    if(request.method === 'OPTIONS') return new Response(null, {status:204, headers:{'Access-Control-Allow-Origin':env.STUDIO_ORIGIN,Vary:'Origin','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'}});
    const identity = await studioSession(request, env);
    if (identity.channelId !== channel) fail(403, 'You can only manage your own channel.');
    const headers = new Headers(request.headers);
    headers.set('Origin',env.EXTENSION_ORIGIN);
    headers.set('Authorization',`Bearer ${await internalToken(env, channel, Date.now())}`);
    const result = await forward(new Request(request, {headers}),await testChannelEnv(env,channel));
    const out = new Headers(result.headers);
    out.set('Access-Control-Allow-Origin',env.STUDIO_ORIGIN); out.set('Vary','Origin'); out.set('Cache-Control','no-store');
    return new Response(result.body,{status:result.status,headers:out});
  } catch(e) { return response({error:e.status ? e.message : 'The studio service is temporarily unavailable.'},e.status || 503,env.STUDIO_ORIGIN); }
}

export function publishedScene(value, channel) {
  const content = twitchContent(value), scene = JSON.parse(content);
  if (scene.objects.some(o=>o.image && !hostedImage(o.image,channel)) || (scene.experience && !scene.experience.url.startsWith(`https://scene-studio-images.scene-studio-free-prototype.workers.dev/experiences/${channel}/`))) fail(400, 'Use media published to your own channel.');
  return content;
}
export async function channelScene(env, channel) {
  if(env.STUDIO_ENABLED !== 'true') return null;
  return env.IMAGES.prepare('SELECT revision,scene,updated FROM channel_scenes WHERE channel=?1').bind(channel).first();
}
export async function channelSceneRequest(request,env,{channel,route,claims},json,{fetcher=fetch,now=Date.now()}={}) {
  const host = claims.role === 'broadcaster' && claims.user_id === channel;
  if(!allowedChannel(env,channel)) return json({error:'This channel is not enabled for the current test.'},403);
  if(route !== 'scene' || request.method !== 'GET') {if(!host) return json({error:'Only the channel owner can change this scene.'},403);}
  if(request.method === 'GET' && route === 'history') {
    const rows = await env.IMAGES.prepare('SELECT revision,updated,scene FROM channel_scene_history WHERE channel=?1 ORDER BY revision DESC LIMIT 20').bind(channel).all();
    return json({history:rows.results.map(r=>({revision:r.revision,updated:r.updated,name:JSON.parse(r.scene).name}))});
  }
  let current = await channelScene(env,channel);
  if(request.method === 'GET' && route === 'scene') {
    // Import the last working Twitch setup once; failed imports cannot silently
    // replace it with a blank design. Viewers never cause writes or Helix calls.
    if(!current && host) {
      const token = await signPartyToken(env, channel, now);
      const res = await fetcher(`https://api.twitch.tv/helix/extensions/configurations?extension_id=${env.EXTENSION_CLIENT_ID}&segment=broadcaster&broadcaster_id=${channel}`,{headers:{Authorization:`Bearer ${token}`,'Client-Id':env.EXTENSION_CLIENT_ID},redirect:'manual',signal:AbortSignal.timeout(15000)});
      if(!res.ok) return json({error:'Your current Twitch setup could not be loaded. Please retry; nothing was changed.'},503);
      const configs=JSON.parse(new TextDecoder().decode(await readExperienceBody(res,32000)));
      const saved=configs.data?.find(c=>c.segment==='broadcaster' && c.broadcaster_id===channel);
      const scene=publishedScene(saved?.content ? parseScene(saved.content) : {...starterScene(),objects:[]},channel);
      await env.IMAGES.prepare('INSERT OR IGNORE INTO channel_scenes(channel,revision,scene,updated) VALUES(?1,1,?2,?3)').bind(channel,scene,now).run();
      current=await channelScene(env,channel);
    }
    return json({schema:1,revision:current?.revision || 0,scene:current ? JSON.parse(current.scene) : null});
  }
  if(request.method !== 'POST' || !['scene','rollback'].includes(route)) return json({error:'Method not allowed.'},405);
  const body=await jsonBody(request);
  if(!Number.isSafeInteger(body.revision) || body.revision<1 || !current || current.revision!==body.revision) return json({error:'The published design changed in another tab. Reload before publishing; export any unsaved work first.'},409);
  let scene=body.scene;
  if(route==='rollback') {
    if(!Number.isSafeInteger(body.targetRevision)) return json({error:'Choose a saved revision.'},400);
    const older=await env.IMAGES.prepare('SELECT scene FROM channel_scene_history WHERE channel=?1 AND revision=?2').bind(channel,body.targetRevision).first();
    if(!older) return json({error:'That revision is no longer available.'},404);
    scene=JSON.parse(older.scene);
  }
  const content=publishedScene(scene,channel);
  const result=await env.IMAGES.prepare('UPDATE channel_scenes SET scene=?1,revision=revision+1,updated=?2 WHERE channel=?3 AND revision=?4').bind(content,now,channel,body.revision).run();
  if(!result.meta.changes) return json({error:'The published design changed. Reload before publishing.'},409);
  return json({schema:1,revision:body.revision+1,scene:JSON.parse(content)});
}

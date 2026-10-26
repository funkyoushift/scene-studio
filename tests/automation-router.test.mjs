import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {extensionClaims} from '../server/image-worker.mjs';
const secret=Buffer.from('automation-route-test-only').toString('base64');
const origin='https://test.ext-twitch.tv';
const env={EXTENSION_SECRET:secret,EXTENSION_ORIGIN:origin,IMAGES:{prepare(){throw Error('Database must not be reached');}}};
async function token(overrides={}) {
  const head=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url');
  const body=Buffer.from(JSON.stringify({role:'viewer',channel_id:'123',exp:Math.floor(Date.now()/1000)+300,...overrides})).toString('base64url');
  const key=await crypto.subtle.importKey('raw',Buffer.from(secret,'base64'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`;
}
test('automation reads allow anonymous signed channel viewers, but never foreign channels or expired tokens',async()=>{
  const req=async overrides=>new Request('https://service.test',{headers:{Authorization:`Bearer ${await token(overrides)}`}});
  assert.equal((await extensionClaims(await req(),secret,'123')).role,'viewer');
  for(const overrides of [{channel_id:'456'},{exp:0},{role:'external'},{nbf:Date.now()}])
    await assert.rejects(extensionClaims(await req(overrides),secret,'123'));
  await assert.rejects(extensionClaims(await req(),secret,'123',Date.now(),true));
});
test('automation routing denies disabled, foreign-origin and non-broadcaster mutations before storage',async()=>{
  const url='https://service.test/v1/automations/123/config';
  assert.equal((await worker.fetch(new Request(url),env)).status,404);
  const enabled={...env,AUTOMATIONS_ENABLED:'true'};
  assert.equal((await worker.fetch(new Request(url),enabled)).status,403);
  for(const method of ['PUT','POST']) {
    const response=await worker.fetch(new Request(method==='POST'?url.replace('/config','/fire'):url,{method,headers:{Origin:origin,Authorization:`Bearer ${await token()}`}}),enabled);
    assert.equal(response.status,401);
  }
  const preflight=await worker.fetch(new Request(url,{method:'OPTIONS',headers:{Origin:origin}}),enabled);
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
  assert.match(preflight.headers.get('Access-Control-Allow-Methods'),/PUT/);
});
test('chat webhook route is closed by default without interpreting a notification',async()=>{
  const response=await worker.fetch(new Request('https://service.test/eventsub/chat/123',{method:'POST',body:'untrusted'}),env);
  assert.equal(response.status,404);
});

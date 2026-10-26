import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/image-worker.mjs';

const origin='https://test.ext-twitch.tv';
const env={EXTENSION_ORIGIN:origin,IMAGES:{prepare(){throw Error('Unexpected database access');}}};
test('developer routing stays disabled before authentication or database access by default',async()=>{
  for(const method of ['GET','POST','OPTIONS']){
    const response=await worker.fetch(new Request('https://service.test/v2/channels/123/keys',{method,headers:{Origin:origin}}),env);
    assert.equal(response.status,404);
    assert.match((await response.json()).error,/not enabled/);
  }
});
test('enabled developer key routing requires a cryptographically verified broadcaster and narrow preflight',async()=>{
  const enabled={...env,DEVELOPER_API_ENABLED:'true'};
  const request=(method,requestOrigin=origin)=>new Request('https://service.test/v2/channels/123/keys',{method,headers:{Origin:requestOrigin}});
  assert.equal((await worker.fetch(request('POST'),enabled)).status,401);
  assert.equal((await worker.fetch(request('OPTIONS','https://foreign.test'),enabled)).status,403);
  const preflight=await worker.fetch(request('OPTIONS'),enabled);
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal((await worker.fetch(new Request('https://service.test/v2/channels/123/events'),enabled)).status,405);
});

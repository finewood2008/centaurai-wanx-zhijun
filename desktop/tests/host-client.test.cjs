const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {once} = require('node:events');
const {mkdtemp, rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {fromEnvironment} = require('../shell/host-client.cjs');
const {startDesktopRuntime} = require('../shell/runtime.cjs');

// Public transport seam: exercise the packaged SDK and application runtime together.
async function fixture(t) {
  const events = new Set(), calls = [];
  const gateway = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer application-token');
    calls.push(req.url);
    if(req.url==='/__wanx/events') {
      events.add(res); res.on('close',()=>events.delete(res));
      res.writeHead(200,{'content-type':'text/event-stream'});
      return res.write('data: {"type":"connection","connection":"ready"}\n\n');
    }
    res.setHeader('content-type','application/json');
    if(req.url==='/__wanx/context') return res.end(JSON.stringify({boxId:'102',user:{id:4,display_name:'万象用户'},connection:'ready'}));
    if(req.url==='/api/auth/me') return res.end(JSON.stringify({id:4,display_name:'万象用户'}));
    if(req.url==='/api/agents') return res.end('[]');
    res.end('{}');
  });
  gateway.listen(0,'127.0.0.1'); await once(gateway,'listening');
  const dir=await mkdtemp(path.join(tmpdir(),'zhijun-host-http-'));
  const env={WANX_HOST_TRANSPORT:'http-v1',WANX_HOST_BASE_URL:`http://127.0.0.1:${gateway.address().port}`,WANX_HOST_TOKEN:'application-token'};
  const runtime=await startDesktopRuntime({dataDir:dir,staticDir:dir,env,serverModule:pathToFileURL(path.resolve(__dirname,'../../server/connections.mjs')).href});
  t.after(async()=>{runtime.close();gateway.closeAllConnections();await new Promise(r=>gateway.close(r));await rm(dir,{recursive:true,force:true});});
  return {runtime,calls,gateway,invalidate(){for(const res of events)res.end('data: {"type":"invalidated","code":"HOST_SESSION_EXPIRED"}\n\n');}};
}

test('Host launch environment reaches box APIs through the packaged SDK without changing business routes', async t=>{
  const f=await fixture(t);
  const connection=await(await fetch(f.runtime.origin+'/api/connection')).json();
  assert.equal(connection.scope,'wanx-host');assert.equal(connection.boxId,'102');
  const status=await(await fetch(f.runtime.origin+'/api/status')).json();
  assert.equal(status.connected,true);assert.equal(status.host,true);
  const me=await fetch(f.runtime.origin+'/api/me');
  assert.equal(me.status,200);assert.equal((await me.json()).id,4);
  assert.ok(f.calls.includes('/api/auth/me'));
  assert.equal((await fetch(f.runtime.origin+'/api/connection/search',{method:'POST',headers:{Origin:f.runtime.origin}})).status,409);
});

test('Host invalidation clears the application session and cannot fall back to LAN', {timeout:3000}, async t=>{
  const f=await fixture(t);
  const invalidated=new Promise(r=>f.runtime.hostClient.onSessionInvalidated(r));
  f.invalidate();await invalidated;
  const count=f.calls.length;
  const me=await fetch(f.runtime.origin+'/api/me');
  assert.equal(me.status,401);assert.equal((await me.json()).code,'HOST_SESSION_EXPIRED');
  const status=await(await fetch(f.runtime.origin+'/api/status')).json();
  assert.equal(status.connected,false);assert.equal(status.sessionExpired,true);
  assert.equal((await(await fetch(f.runtime.origin+'/api/connection')).json()).selected,false);
  assert.equal(f.calls.length,count);
});

test('Host exit invalidates the application even while no business request is active', {timeout:3000}, async t=>{
  const f=await fixture(t);
  const invalidated=new Promise(r=>f.runtime.hostClient.onSessionInvalidated(r));
  f.gateway.closeAllConnections(); await invalidated;
  assert.equal((await fetch(f.runtime.origin+'/api/me')).status,401);
});

test('no Host environment preserves Web/LAN, while incomplete or unsupported Host launches fail closed', ()=>{
  assert.equal(fromEnvironment({}),null);
  assert.throws(()=>fromEnvironment({WANX_HOST_BASE_URL:''}),{code:'HOST_PROTOCOL_UNSUPPORTED'});
  assert.throws(()=>fromEnvironment({WANX_HOST_SOCKET:'/old-ipc'}),{code:'HOST_PROTOCOL_UNSUPPORTED'});
  assert.throws(()=>fromEnvironment({WANX_HOST_TRANSPORT:'http-v1'}),{code:'HOST_SESSION_MISSING'});
  assert.throws(()=>fromEnvironment({WANX_HOST_TRANSPORT:'http-v1',WANX_HOST_BASE_URL:'https://remote.test',WANX_HOST_TOKEN:'secret'}),{code:'HOST_SESSION_INVALID'});
});

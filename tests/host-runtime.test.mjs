import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {startHostRuntime} from '../server/host-runtime.mjs';
import {startTestHost} from './support/host-fixture.mjs';

async function fixture(t,options={}) {
 const root=await mkdtemp(path.join(os.tmpdir(),'zhijun-host-test-'));
 const host=await startTestHost(options);
 const runtime=await startHostRuntime({dataDir:root,staticDir:root,environment:host.environment});
 t.after(async()=>{await runtime.close();await host.close();await rm(root,{recursive:true,force:true});});
 const cookie=runtime.bootstrapCookie.name+'='+runtime.bootstrapCookie.value;
 const request=(target,options={})=>fetch(runtime.origin+target,{...options,headers:{Origin:runtime.origin,Cookie:cookie,...options.headers}});
 return {host,runtime,request,cookie,root};
}

test('managed runtime requires bootstrap cookie and uses WANX identity without independent login',async t=>{
 const f=await fixture(t);
 for(const target of ['/api/status','/api/me'])assert.equal((await fetch(f.runtime.origin+target)).status,401);
 assert.equal(f.host.calls.length,0);
 const status=await (await f.request('/api/status')).json();assert.equal(status.managedHost,true);assert.equal(status.connected,true);
 const me=await (await f.request('/api/me')).json();assert.equal(me.managedHost,true);assert.equal(me.name,'知君测试用户');assert.equal(me.ready,true);assert.equal(me.expertId,'mine');
 assert.ok(f.host.calls.every(c=>!c.headers?.Authorization&&!c.headers?.authorization));
 assert.ok(!JSON.stringify(me).includes(f.host.environment.WANX_HOST_TOKEN));
 for(const route of ['/api/login','/api/login/password','/api/password','/api/connection','/api/connection/search','/api/connection/select'])assert.equal((await f.request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await f.request('/api/captcha')).status,403);
 assert.ok(f.host.calls.every(c=>!c.path.includes('/auth/login')&&!c.path.includes('/auth/captcha')&&!c.path.includes('change-password')));
});

test('managed HTTP and multipart upload cross the actual host IPC without exposing upstream credentials',async t=>{
 const f=await fixture(t);await f.request('/api/me');
 const threads=await(await f.request('/api/threads',{headers:{'X-Zhijun-Expert':'mine'}})).json();assert.equal(threads[0].thread_id,'t1');
 const form=new FormData();form.set('file',new Blob(['hello host upload'],{type:'text/plain'}),'sample.txt');
 const response=await f.request('/api/threads/t1/attachments',{method:'POST',headers:{'X-Zhijun-Expert':'mine'},body:form});
 const attachment=await response.json();assert.equal(response.status,200);assert.equal(attachment.status,'ready');assert.ok(attachment.id);
 const upload=f.host.calls.find(call=>call.path==='/api/agents/mine/upload');assert.ok(upload.body);
 const chunks=[];if(Buffer.isBuffer(upload.body))chunks.push(upload.body);else for await(const chunk of upload.body)chunks.push(Buffer.from(chunk));
 const decoded=await new Response(Buffer.concat(chunks),{headers:{'content-type':upload.headers['content-type']}}).formData();assert.equal(await decoded.get('file').text(),'hello host upload');assert.equal(decoded.get('extract_text'),'true');
 const approval=await f.request('/api/approval',{method:'POST',headers:{'Content-Type':'application/json','X-Zhijun-Expert':'mine'},body:JSON.stringify({thread_id:'t1',decisions:[{type:'approve'}]})});
 assert.equal(approval.headers.get('content-type'),'text/event-stream');assert.match(await approval.text(),/"done"/);
});

test('managed WebSocket chat uses host streams and preserves private request policy', {timeout:10000},async t=>{
 const f=await fixture(t);await f.request('/api/me');
 const socket=new WebSocket(f.runtime.origin.replace('http:','ws:')+'/api/chat?expert=mine',{headers:{Origin:f.runtime.origin,Cookie:f.cookie}});t.after(()=>socket.terminate());
 const frames=[];
 await new Promise((resolve,reject)=>{socket.on('error',reject);socket.on('message',raw=>{const frame=JSON.parse(raw);frames.push(frame);if(frame.type==='ready')socket.send(JSON.stringify({type:'user_turn',text:'你好',thread_id:'t1',knowledge_base_ids:['other'],model:'injected'}));if(frame.type==='done')resolve();});});
 assert.match(frames[1].content,/万象/);assert.deepEqual(f.host.frames[0].knowledge_base_ids,['own']);assert.equal(f.host.frames[0].model,undefined);assert.deepEqual(f.host.frames[0].hitl_policy,{mode:'ask'});
 const closed=once(socket,'close');f.host.revoke();await closed;
 const me=await f.request('/api/me');assert.equal(me.status,401);assert.equal((await me.json()).code,'HOST_SESSION_REVOKED');
});

test('managed logout revokes only its bootstrap session, and account or box changes cannot reuse a runtime',async t=>{
 const f=await fixture(t);await f.request('/api/me');
 const logout=await f.request('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(logout.status,200);
 assert.equal((await f.request('/api/me')).status,401);assert.ok(f.host.calls.every(c=>c.path!=='/api/auth/logout'));
 const second=await startHostRuntime({dataDir:f.root,staticDir:f.root,environment:f.host.environment});t.after(()=>second.close());
 assert.equal(second.namespace,f.runtime.namespace);
 f.host.context.boxId='different-box';
 const cookie=second.bootstrapCookie.name+'='+second.bootstrapCookie.value;
 const me=await fetch(second.origin+'/api/me',{headers:{Origin:second.origin,Cookie:cookie}});assert.equal(me.status,401);assert.equal((await me.json()).code,'HOST_SESSION_REVOKED');
 const third=await startHostRuntime({dataDir:f.root,staticDir:f.root,environment:f.host.environment});t.after(()=>third.close());assert.notEqual(third.namespace,f.runtime.namespace);
});

function pendingHostResponse(input,status,notify) {
 let end;
 const cancelled=new Promise(resolve=>{end=resolve;});
 input.signal.addEventListener('abort',()=>{notify();end();},{once:true});
 return {status,headers:{'content-type':status===200?'text/event-stream':'application/json'},body:(async function*(){yield Buffer.from(status===200?'data: {"type":"pending"}\n\n':'{"error":"denied"}');await cancelled;})()};
}

test('non-success upstream responses cancel their actual Host body instead of leaving a pending stream',{timeout:3000},async t=>{
 let cancelled;const closed=new Promise(resolve=>{cancelled=resolve;});
 const f=await fixture(t,{interceptRequest:input=>input.path==='/api/auth/me'?pendingHostResponse(input,403,cancelled):undefined});
 const response=await f.request('/api/me');assert.equal(response.status,403);
 await closed;
});

test('closing an approval SSE browser response aborts the actual Host upstream request',{timeout:3000},async t=>{
 let cancelled;const closed=new Promise(resolve=>{cancelled=resolve;});
 const f=await fixture(t,{interceptRequest:input=>input.path.endsWith('/chat/hitl/resume')?pendingHostResponse(input,200,cancelled):undefined});
 await f.request('/api/me');
 const response=await f.request('/api/approval',{method:'POST',headers:{'Content-Type':'application/json','X-Zhijun-Expert':'mine'},body:JSON.stringify({thread_id:'t1',decisions:[{type:'approve'}]})});
 assert.equal(response.status,200);await response.body.cancel();await closed;
});

test('rejected approval response cancels the Host response body',{timeout:3000},async t=>{
 let cancelled;const closed=new Promise(resolve=>{cancelled=resolve;});
 const f=await fixture(t,{interceptRequest:input=>input.path.endsWith('/chat/hitl/resume')?pendingHostResponse(input,403,cancelled):undefined});
 await f.request('/api/me');
 const response=await f.request('/api/approval',{method:'POST',headers:{'Content-Type':'application/json','X-Zhijun-Expert':'mine'},body:JSON.stringify({thread_id:'t1',decisions:[{type:'approve'}]})});
 assert.equal(response.status,403);await closed;
});

test('runtime close terminates an upgraded socket after its session was removed even without a peer close handshake',{timeout:3000},async t=>{
 const f=await fixture(t);await f.request('/api/me');
 const client=new WebSocket(f.runtime.origin.replace('http:','ws:')+'/api/chat?expert=mine',{headers:{Origin:f.runtime.origin,Cookie:f.cookie}});
 await once(client,'open');client._socket.pause();
 let timer,closing;
 try {
  assert.equal((await f.request('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,200);
  closing=f.runtime.close();
  await Promise.race([closing,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('runtime waited for a revoked peer close handshake')),500);})]);
 } finally {clearTimeout(timer);client.terminate();await closing;}
});

for(const [status,code,details] of [
 [403,'KNOWLEDGE_FEATURE_DISABLED',{}],
 [403,'FORBIDDEN',{permission:'knowledge_bases'}],
 [409,'KNOWLEDGE_PREREQUISITES_FAILED',{}],
 [403,'KNOWLEDGE_FORBIDDEN',{}],
 [403,'FORBIDDEN',{permission:'users'}],
 [403,'BOX_PLATFORM_ROUTE_FORBIDDEN',{}],
 [401,'AUTH_FAILED',{}],
])test(`chat handles unavailable knowledge narrowly: ${code} ${JSON.stringify(details)}`,{timeout:5000},async t=>{
 const available=['KNOWLEDGE_FEATURE_DISABLED','KNOWLEDGE_PREREQUISITES_FAILED'].includes(code)||(code==='FORBIDDEN'&&details.permission==='knowledge_bases');
 const f=await fixture(t,{interceptRequest:input=>{
  if(input.path!=='/api/knowledge-bases')return;
  return {status:input.method==='POST'?status:200,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify(input.method==='POST'?{error:{code,details,message:'sensitive upstream message'}}:[]))};
 }});
 await f.request('/api/me');
 const socket=new WebSocket(f.runtime.origin.replace('http:','ws:')+'/api/chat?expert=mine',{headers:{Origin:f.runtime.origin,Cookie:f.cookie}});t.after(()=>socket.terminate());
 const frames=[];
 await new Promise((resolve,reject)=>{
  socket.on('error',reject);socket.on('close',resolve);
  socket.on('message',raw=>{const frame=JSON.parse(raw);frames.push(frame);if(frame.type==='ready')socket.send(JSON.stringify({type:'user_turn',text:'你好',thread_id:'t1',knowledge_base_ids:['foreign']}));if(['done','error'].includes(frame.type))resolve();});
 });
 assert.ok(f.host.calls.some(c=>c.path==='/api/knowledge-bases'&&c.method==='POST'));
 assert.equal(JSON.stringify(frames).includes('sensitive upstream message'),false);
 if(available){
  assert.deepEqual(f.host.frames[0].knowledge_base_ids,[]);
  assert.ok(frames.some(f=>f.type==='notice'&&f.code==='CHAT_WITHOUT_KNOWLEDGE'));
  assert.ok(frames.some(f=>f.type==='done'));
  // The knowledge page still reports its failure; chat does not grant new permission.
  assert.equal((await f.request('/api/libraries',{headers:{'X-Zhijun-Expert':'mine'}})).status,status);
 }else{
  assert.equal(f.host.frames.length,0);
  assert.equal(frames.some(f=>f.type==='notice'||f.type==='done'),false);
 }
});

test('chat never bypasses a failed private-library ownership check',{timeout:5000},async t=>{
 const f=await fixture(t,{interceptRequest:input=>input.path==='/api/knowledge-bases'?{status:200,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify(input.method==='POST'?{id:'foreign',owner_user_id:5,shared:false}:[]))}:undefined});
 await f.request('/api/me');
 const socket=new WebSocket(f.runtime.origin.replace('http:','ws:')+'/api/chat?expert=mine',{headers:{Origin:f.runtime.origin,Cookie:f.cookie}});t.after(()=>socket.terminate());
 await new Promise((resolve,reject)=>{socket.on('error',reject);socket.on('message',raw=>{const frame=JSON.parse(raw);if(frame.type==='ready')socket.send(JSON.stringify({type:'user_turn',text:'你好',thread_id:'t1'}));if(frame.type==='error'){assert.match(frame.message,/私人资料/);resolve();}});});
 assert.equal(f.host.frames.length,0);
});

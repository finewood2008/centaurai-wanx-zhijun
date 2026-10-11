const test = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {EventEmitter} = require('node:events');
const {WebSocket} = require('ws');

test('host mode serves the existing API through the WANX host transport', async t => {
 const calls=[];
 const hostClient={
  request: async (path, options={}) => {
   calls.push({path, options});
   if(path==='/api/auth/me') return Response.json({id:4,display_name:'万象用户'});
   if(path==='/api/agents/mine') return Response.json({agent_id:'mine',user_id:4,is_shared:false});
   return Response.json({});
  }
 };
 const config={upstream:'http://wanx-host.invalid',publicOrigin:'http://127.0.0.1:0',bindings:{4:{agentId:'mine'}}};
 const {createApp}=await import('../../server/app.mjs');
 const app=createApp(config,{hostClient,hostContext:{user:{id:4,display_name:'万象用户'}}});
 app.listen(0,'127.0.0.1');
 await once(app,'listening');
 config.publicOrigin=`http://127.0.0.1:${app.address().port}`;
 t.after(()=>new Promise(resolve=>{app.closeAllConnections();app.close(resolve);}));
 const response=await fetch(config.publicOrigin+'/api/me');
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{id:4,name:'万象用户',ready:true,reason:'',expertId:'mine',expertChoices:[],roles:[{id:'personal',name:'个人',description:'关于生活、感受，以及作为自己的我。'}],canCreateRoles:false});
 assert.deepEqual(calls.map(call=>call.path),['/api/auth/me','/api/auth/me','/api/agents/mine']);
});

test('host mode routes the chat WebSocket through the WANX host stream', async t => {
 const calls=[];
 const hostClient={
  request: async path => {
   calls.push(path);
   if(path==='/api/auth/me') return Response.json({id:4,display_name:'万象用户'});
   if(path==='/api/agents/mine') return Response.json({agent_id:'mine',user_id:4,is_shared:false});
   return Response.json({});
  },
  openStream: async path => {
   assert.equal(path,'/api/agents/mine/chat/ws');
   const stream=new EventEmitter();
   stream.readyState=1;
   stream.send=()=>{};
   stream.close=()=>stream.emit('close',1000,Buffer.alloc(0));
   setImmediate(()=>stream.emit('open'));
   return stream;
  },
 };
 const {createApp}=await import('../../server/app.mjs');
 const config={upstream:'http://wanx-host.invalid',publicOrigin:'http://127.0.0.1:0',bindings:{4:{agentId:'mine'}}};
 const app=createApp(config,{hostClient,hostContext:{user:{id:4,display_name:'万象用户'}}});
 app.listen(0,'127.0.0.1');
 await once(app,'listening');
 config.publicOrigin=`http://127.0.0.1:${app.address().port}`;
 t.after(()=>new Promise(resolve=>{app.closeAllConnections();app.close(resolve);}));
 const client=new WebSocket(config.publicOrigin.replace('http:','ws:')+'/api/chat?role=personal',{origin:config.publicOrigin});
 const [message]=await once(client,'message');
 assert.deepEqual(JSON.parse(message.toString()),{type:'ready'});
 client.close();
 await once(client,'close');
 assert.ok(calls.includes('/api/auth/me'));
});

test('host mode serializes attachment uploads through the WANX host request', async t => {
 const uploads=[];
 const hostClient={
  request: async (path, options={}) => {
   if(path==='/api/auth/me') return Response.json({id:4,display_name:'万象用户'});
   if(path==='/api/agents/mine') return Response.json({agent_id:'mine',user_id:4,is_shared:false});
   if(path.endsWith('/threads/t1/history?limit=1')) return Response.json({});
   if(path==='/api/agents/mine/upload') {
    uploads.push({body:options.body,contentType:options.headers['Content-Type']});
    return Response.json({path:'inbound/1720000000000_test.txt',filename:'test.txt',media_type:'text/plain',extraction_status:'ready',extraction_characters:7});
   }
   return Response.json({});
  },
 };
 const {createApp}=await import('../../server/app.mjs');
 const config={upstream:'http://wanx-host.invalid',publicOrigin:'http://127.0.0.1:0',bindings:{4:{agentId:'mine'}}};
 const app=createApp(config,{hostClient,hostContext:{user:{id:4,display_name:'万象用户'}}});
 app.listen(0,'127.0.0.1');
 await once(app,'listening');
 config.publicOrigin=`http://127.0.0.1:${app.address().port}`;
 t.after(()=>new Promise(resolve=>{app.closeAllConnections();app.close(resolve);}));
 const form=new FormData();
 form.set('file',new Blob(['fixture']),'test.txt');
 const response=await fetch(config.publicOrigin+'/api/threads/t1/attachments',{method:'POST',headers:{Origin:config.publicOrigin},body:form});
 assert.equal(response.status,200);
 assert.equal((await response.json()).status,'ready');
 assert.equal(uploads.length,1);
 assert.ok(Buffer.isBuffer(uploads[0].body));
 assert.match(uploads[0].contentType,/^multipart\/form-data; boundary=/);
});

test('host mode forwards approval responses from the connected box', async t => {
 const approvals=[];
 const hostClient={
  request: async (path, options={}) => {
   if(path==='/api/auth/me') return Response.json({id:4,display_name:'万象用户'});
   if(path==='/api/agents/mine') return Response.json({agent_id:'mine',user_id:4,is_shared:false});
   if(path==='/api/agents/mine/chat/hitl/resume') {
    approvals.push(options.body);
    return new Response('data: {"type":"done"}\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
   }
   return Response.json({});
  },
 };
 const {createApp}=await import('../../server/app.mjs');
 const config={upstream:'http://wanx-host.invalid',publicOrigin:'http://127.0.0.1:0',bindings:{4:{agentId:'mine'}}};
 const app=createApp(config,{hostClient,hostContext:{user:{id:4,display_name:'万象用户'}}});
 app.listen(0,'127.0.0.1');
 await once(app,'listening');
 config.publicOrigin=`http://127.0.0.1:${app.address().port}`;
 t.after(()=>new Promise(resolve=>{app.closeAllConnections();app.close(resolve);}));
 const response=await fetch(config.publicOrigin+'/api/approval',{method:'POST',headers:{Origin:config.publicOrigin,'Content-Type':'application/json'},body:JSON.stringify({thread_id:'t1',decisions:[{type:'approve'}]})});
 assert.equal(response.status,200);
 assert.match(await response.text(),/type.*done/);
 assert.deepEqual(approvals,[{thread_id:'t1',decisions:[{type:'approve'}]}]);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');

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

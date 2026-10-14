import test from 'node:test';import assert from 'node:assert/strict';import {once} from 'node:events';
import {createApp} from '../server/app.mjs';import {createRoleStore} from '../server/roles.mjs';
import {presetPreferences,presets,validPreferences} from '../server/interaction-schema.mjs';
async function fixture(t,{status=200,agentPatch={}}={}){
 const calls=[],stored=new Map();
 const config={upstream:'http://127.0.0.1:8088',bindings:{4:{agentId:'mine'}},publicOrigin:'http://127.0.0.1:0'};
 const store=createRoleStore();store.set(4,[{id:'work',name:'工作',description:'',agentId:'work-agent',ready:true}]);
 const fetcher=async(url,options)=>{const path=new URL(url).pathname;const body=options.body?JSON.parse(options.body):undefined;calls.push({path,method:options.method,body});
  let data={},code=200;
  if(path==='/api/auth/login')data={access_token:'test-token',expires_in:3600,user:{id:4,username:'test'}};
  else if(path==='/api/auth/me')data={id:4,username:'test'};
  else if(path.endsWith('/interaction-preferences')){code=status;if(options.method==='PUT')stored.set(path,body);if(options.method==='DELETE')stored.delete(path);data={preferences:stored.get(path)||null};}
  else if(path.startsWith('/api/agents/'))data={agent_id:path.split('/')[3],user_id:4,is_shared:false,...agentPatch};
  return new Response(JSON.stringify(data),{status:code});
 };
 const app=createApp(config,{fetcher,roleStore:store});app.listen(0,'127.0.0.1');await once(app,'listening');config.publicOrigin=`http://127.0.0.1:${app.address().port}`;
 t.after(()=>new Promise(resolve=>{app.closeAllConnections();app.close(resolve);}));let cookie='';
 const request=(method='GET',body,headers={})=>fetch(config.publicOrigin+'/api/interaction-preferences?as_user=5&agent_id=foreign',{method,headers:{Origin:config.publicOrigin,Cookie:cookie,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const login=await fetch(config.publicOrigin+'/api/login',{method:'POST',headers:{Origin:config.publicOrigin,'Content-Type':'application/json'},body:JSON.stringify({username:'test',password:'dummy'})});cookie=login.headers.get('set-cookie').split(';')[0];
 return {request,calls};
}
test('all presets validate and round trip through role-bound gateway, with reset',async t=>{
 const f=await fixture(t);
 for(const p of presets){const prefs=presetPreferences(p.id);assert.equal(validPreferences(prefs),true);
  assert.deepEqual(await (await f.request('PUT',prefs,{'X-Zhijun-Role':'work'})).json(),{supported:true,preferences:prefs});
  assert.equal(f.calls.at(-1).path,'/api/agents/work-agent/interaction-preferences');
  assert.deepEqual(await (await f.request()).json(),{supported:true,preferences:null});
 }
 assert.deepEqual(await (await f.request('DELETE',undefined,{'X-Zhijun-Role':'work'})).json(),{supported:true,preferences:null});
});
test('rejects arbitrary fields and foreign role, ownership and origin',async t=>{
 const f=await fixture(t);for(const extra of [{system_prompt:'bad'},{agent_id:'other'},{temperature:1},{tone:'bad'},{version:2}])assert.equal((await f.request('PUT',{...presetPreferences('natural'),...extra})).status,400);
 assert.equal((await f.request('DELETE',{agent_id:'other'})).status,400);
 assert.equal((await f.request('GET',undefined,{'X-Zhijun-Role':'other'})).status,404);
 assert.equal((await f.request('PUT',presetPreferences('advice'),{Origin:'https://evil.example'})).status,403);
 assert.equal(f.calls.some(c=>c.path.endsWith('/interaction-preferences')),false);
 const foreign=await fixture(t,{agentPatch:{user_id:5}});assert.equal((await foreign.request()).status,403);
});
test('only missing endpoints are unsupported; busy and outages remain errors',async t=>{
 for(const status of [404,405,501]){const f=await fixture(t,{status});assert.deepEqual(await(await f.request()).json(),{supported:false,preferences:null});assert.equal((await f.request('PUT',presetPreferences('natural'))).status,501);}
 const busy=await fixture(t,{status:409});assert.equal((await(await busy.request('PUT',presetPreferences('advice'))).json()).code,'INTERACTION_BUSY');
 const broken=await fixture(t,{status:500});assert.equal((await broken.request()).status,500);
});

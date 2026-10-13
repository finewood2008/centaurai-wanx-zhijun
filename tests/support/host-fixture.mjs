import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import {createApplicationSession} from '../../../centuarai-wanx/wanx-client/app-host/session.mjs';

/** Local integration fixture using the actual WANX application HTTP session. No production account. */
export function createTestConnection({accountId='fixture-account',boxId='fixture-box',interceptRequest}={}) {
  const calls=[],frames=[];let closed=false;
  const assertLive=()=>{if(closed)throw Object.assign(new Error('APPLICATION_SESSION_CLOSED'),{code:'APPLICATION_SESSION_CLOSED'});};
  const user={id:4,username:'test',display_name:'知君测试用户'};
  const context={protocolVersion:1,accountId,clientId:'fixture-client',boxId,user,connection:'ready'};
  const agent={agent_id:'mine',name:'知君',user_id:4,is_shared:false,kind:'agent'};
  const library={id:'own',name:'知君 · 专家资料 · mine',owner_user_id:4,shared:false,default_open:true};
  const streams=new Set(),listeners=new Set();
  return {calls,frames,state:context,context:()=>{assertLive();return structuredClone(context);},
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    revoke(){closed=true;for(const listener of listeners)listener();for(const stream of streams)stream.close();},
    request:async input=>{
      assertLive();calls.push(input);
      const intercepted=await interceptRequest?.(input);if(intercepted){if(intercepted.body?.[Symbol.asyncIterator]&&!intercepted.body.pipe)intercepted.body=Readable.from(intercepted.body);return intercepted;}
      const url=new URL(input.path,'http://fixture.invalid'),p=url.pathname;
      let data={};
      if(p==='/api/auth/me')data=user;
      else if(p==='/api/agents')data=[agent];
      else if(p==='/api/agents/mine')data=agent;
      else if(p==='/api/agents/mine/threads')data=input.method==='POST'?{thread_id:'t1'}:[{thread_id:'t1',title:'应用市场验证对话'}];
      else if(p.endsWith('/history'))data={messages:[],has_more:false};
      else if(p==='/api/knowledge-bases')data=input.method==='POST'?library:[library];
      else if(p==='/api/knowledge-bases/own')data=library;
      else if(p==='/api/agents/mine/upload') {
        // Consume the request before responding, just as the upstream server does.
        if(input.body?.[Symbol.asyncIterator]&&!Buffer.isBuffer(input.body)) {
          const chunks=[];for await(const chunk of input.body)chunks.push(Buffer.from(chunk));
          input.body=Buffer.concat(chunks);
        }
        data={path:'inbound/1234567890123_sample.txt',filename:'sample.txt',media_type:'text/plain',extraction_status:'ready'};
      }
      else if(p.endsWith('/memory/atoms/list'))data={items:[],has_more:false};
      else if(p.endsWith('/chat/hitl/resume'))return {status:200,headers:{'content-type':'text/event-stream'},body:Readable.from((async function*(){yield Buffer.from('data: {"type":"done"}\n\n');})())};
      return {status:200,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify(data))};
    },
    openStream:async()=>{
      assertLive();const stream=new EventEmitter();streams.add(stream);
      stream.readyState=1;stream.pause=()=>{};stream.resume=()=>{};
      stream.send=(data,_options,callback)=>{callback?.();const frame=JSON.parse(data.toString());frames.push(frame);if(frame.type!=='user_turn')return;stream.emit('message',Buffer.from(JSON.stringify({type:'token',thread_id:'t1',content:'你好，知君已通过万象连接。'})),false);stream.emit('message',Buffer.from(JSON.stringify({type:'done',thread_id:'t1'})),false);};
      stream.close=stream.terminate=()=>{if(stream.readyState===3)return;stream.readyState=3;streams.delete(stream);stream.emit('close',1000,Buffer.alloc(0));};
      return stream;
    },
  };
}

export async function startTestHost(options={}) {
  const connection=createTestConnection(options);
  const host=await createApplicationSession({hostApplicationId:'wanx-host',
    applicationId:'centaurai.wanx.zhijun',installPath:path.join(os.tmpdir(),'zhijun-host-fixture'),
    createConnection:()=>connection,
  });
  return {environment:host.environment,context:connection.state,calls:connection.calls,frames:connection.frames,connection,
    revoke(){connection.revoke();},async close(){connection.revoke();await host.close();}};
}

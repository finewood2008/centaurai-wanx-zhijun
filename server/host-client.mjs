import net from 'node:net';
import {EventEmitter} from 'node:events';

const revoked=()=>Object.assign(new Error('HOST_SESSION_REVOKED'),{code:'HOST_SESSION_REVOKED'});
const MAX_LINE=48*1024*1024;
export const HOST_ORIGIN='http://wanx-host.invalid';

/** Main-process only. The launch credential never enters HTTP headers or browser state. */
export function createHostClient({environment=process.env,connect=net.createConnection}={}) {
  const credentials={applicationId:environment.WANX_HOST_CLIENT_APPLICATION_ID,launchId:environment.WANX_HOST_LAUNCH_ID,token:environment.WANX_HOST_TOKEN};
  if(!environment.WANX_HOST_SOCKET||Object.values(credentials).some(value=>typeof value!=='string'||!value))throw revoked();
  let closed=false,binding=null;
  const sockets=new Set();
  function channel({signal,onMessage,onFailure}) {
    if(closed)throw revoked();
    const socket=connect(environment.WANX_HOST_SOCKET);sockets.add(socket);
    let buffer='',settled=false;
    const failure=()=>{if(settled)return;settled=true;onFailure(revoked());socket.destroy();};
    socket.setEncoding('utf8');
    socket.on('error',failure);
    socket.on('close',()=>{sockets.delete(socket);signal?.removeEventListener('abort',failure);if(!settled)failure();});
    socket.on('data',chunk=>{
      buffer+=chunk;if(buffer.length>MAX_LINE)return failure();
      for(let at=buffer.indexOf('\n');at>=0;at=buffer.indexOf('\n')){
        const line=buffer.slice(0,at);buffer=buffer.slice(at+1);
        try {const message=JSON.parse(line);if(message.ok===false||message.error)return failure();onMessage(message);} catch {return failure();}
      }
    });
    signal?.addEventListener('abort',failure,{once:true});
    if(signal?.aborted)failure();
    return {
      send(method,params,id='1'){if(closed||socket.destroyed)throw revoked();socket.write(JSON.stringify({...credentials,id,method,params})+'\n');},
      pause(){socket.pause();},resume(){socket.resume();},
      finish(){settled=true;signal?.removeEventListener('abort',failure);socket.destroy();},
    };
  }
  async function rpc(method,params) {
    return new Promise((resolve,reject)=>{
      let connection;
      connection=channel({signal:AbortSignal.timeout(20000),onFailure:reject,onMessage:message=>{
        if(message.id!=='1')return;
        connection.finish();resolve(message.value);
      }});
      connection.send(method,params);
    });
  }
  async function context() {
    const value=await rpc('context.get');
    if(value?.protocolVersion!==1||value.connection!=='ready'||!value.accountId||!value.boxId||!value.user?.id)throw revoked();
    const next=JSON.stringify([value.accountId,value.clientId,value.boxId,value.user.id]);
    if(binding!==null&&binding!==next){close();throw revoked();}
    binding=next;return value;
  }
  async function fetcher(url,input={}) {
    const target=new URL(url);
    if(target.origin!==HOST_ORIGIN||!target.pathname.startsWith('/api/')||target.username||target.password||target.hash)throw revoked();
    await context();
    const headers={};
    const serialized=new Request(target,{...input,headers:input.headers||{}});
    for(const key of ['content-type','accept','accept-language'])if(serialized.headers.has(key))headers[key]=serialized.headers.get(key);
    const body=serialized.body?Buffer.from(await serialized.arrayBuffer()):undefined;
    if(body?.length>33*1024*1024)throw Object.assign(new Error('FILE_TOO_LARGE'),{code:'FILE_TOO_LARGE'});
    return new Promise((resolve,reject)=>{
      let controller,connection,responded=false,bodyClosed=false;
      const fail=error=>{if(controller&&!bodyClosed){bodyClosed=true;controller.error(error);}if(!responded)reject(error);};
      connection=channel({signal:input.signal||AbortSignal.timeout(300000),onFailure:fail,onMessage:message=>{
        if(message.id==='1'){
          const value=message.value;
          if(!Number.isInteger(value?.status)||value.status<200||value.status>599)throw revoked();
          const noBody=[204,205,304].includes(value.status);
          const body=noBody?null:new ReadableStream({
            start(value){controller=value;},
            pull(){connection.resume();},
            cancel(){bodyClosed=true;connection.finish();},
          });
          resolve(new Response(body,{status:value.status,headers:value.headers||{}}));responded=true;
          if(noBody){bodyClosed=true;connection.finish();}
        } else if(message.type==='http.data') {
          if(bodyClosed)return;
          if(!controller||typeof message.data!=='string')throw revoked();
          controller.enqueue(Buffer.from(message.data,'base64'));
          if(controller.desiredSize<=0)connection.pause();
        } else if(message.type==='http.end') {if(controller&&!bodyClosed){bodyClosed=true;controller.close();}connection.finish();}
        else if(message.type==='http.error') {fail(revoked());connection.finish();}
      }});
      connection.send('http.stream',{path:target.pathname+target.search,method:input.method||'GET',headers,...(body?{body:body.toString('base64'),bodyEncoding:'base64'}:{})});
    });
  }
  function createWebSocket(url) {
    const target=new URL(url),socket=new EventEmitter();let connection,streamId,ended=false,timer;
    socket.readyState=0;
    const end=(code=1000)=>{if(ended)return;ended=true;clearTimeout(timer);socket.readyState=3;connection?.finish();socket.emit('close',code);};
    const error=()=>{if(ended)return;socket.emit('error',revoked());end(1008);};
    socket.on('error',()=>{});
    socket.close=()=>{if(ended)return;try{if(streamId)connection?.send('stream.close',{streamId},'close');}catch{}end();};
    socket.send=data=>{if(socket.readyState!==1)throw revoked();connection.send('stream.send',{streamId,data:Buffer.from(data).toString('base64'),binary:false},'send');};
    timer=setTimeout(error,15000);timer.unref?.();
    void context().then(()=>{
      if(ended)return;
      if(!['ws:','wss:'].includes(target.protocol)||target.hostname!=='wanx-host.invalid'||target.search||!/^\/api\/agents\/[A-Za-z0-9_-]{1,128}\/chat\/ws$/.test(target.pathname))throw revoked();
      connection=channel({onFailure:error,onMessage:message=>{
        if(message.id==='open'){streamId=message.value?.streamId;if(!streamId)throw revoked();clearTimeout(timer);socket.readyState=1;socket.emit('open');}
        else if(message.type==='stream.message')socket.emit('message',Buffer.from(message.data,'base64'),!!message.binary);
        else if(message.type==='stream.close')end(message.code);
        else if(message.type==='stream.error')error();
      }});
      connection.send('stream.open',{path:target.pathname},'open');
    }).catch(error);
    return socket;
  }
  function close(){closed=true;for(const socket of sockets)socket.destroy();sockets.clear();}
  return {context,fetcher,createWebSocket,close};
}

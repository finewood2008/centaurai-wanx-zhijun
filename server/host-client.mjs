import {EventEmitter} from 'node:events';
import {fromEnvironment} from './wanx-host-sdk.cjs';

const revoked=()=>Object.assign(new Error('HOST_SESSION_REVOKED'),{code:'HOST_SESSION_REVOKED'});
export const HOST_ORIGIN='http://wanx-host.invalid';
const normalize=error=>['HOST_SESSION_EXPIRED','HOST_UNAUTHORIZED','HOST_SESSION_MISSING','HOST_SESSION_INVALID','HOST_PROTOCOL_UNSUPPORTED'].includes(error?.code)?revoked():error;

/** Main-process only. The Host SDK keeps the launch credential out of browser state. */
export function createHostClient({environment=process.env}={}) {
  let sdk;
  try {sdk=fromEnvironment(environment);if(!sdk)throw revoked();}catch{throw revoked();}
  let closed=false,binding=null;
  const sockets=new Set();
  async function context() {
    if(closed)throw revoked();
    let value;
    try {value=await sdk.context();}catch(error){throw normalize(error);}
    if(value?.protocolVersion!==1||value.connection!=='ready'||!value.accountId||!value.boxId||!value.user?.id)throw revoked();
    const next=JSON.stringify([value.accountId,value.clientId,value.boxId,value.user.id]);
    if(binding!==null&&binding!==next){close();throw revoked();}
    binding=next;return value;
  }
  async function fetcher(url,input={}) {
    const target=new URL(url);
    if(target.origin!==HOST_ORIGIN||!target.pathname.startsWith('/api/')||target.username||target.password||target.hash)throw revoked();
    await context();
    const serialized=new Request(target,{...input,headers:input.headers||{}}),headers={};
    for(const key of ['content-type','accept','accept-language'])if(serialized.headers.has(key))headers[key]=serialized.headers.get(key);
    const body=serialized.body?Buffer.from(await serialized.arrayBuffer()):undefined;
    if(body?.length>32*1024*1024)throw Object.assign(new Error('FILE_TOO_LARGE'),{code:'FILE_TOO_LARGE'});
    try {
      return await sdk.request(target.pathname+target.search,{method:input.method||'GET',headers,body,signal:input.signal||AbortSignal.timeout(300000)});
    }catch(error){throw normalize(error);}
  }
  function createWebSocket(url) {
    const target=new URL(url),socket=new EventEmitter();let upstream,ended=false;
    socket.readyState=0;sockets.add(socket);
    const end=(code=1000,reason)=>{if(ended)return;ended=true;socket.readyState=3;sockets.delete(socket);socket.emit('close',code,reason);};
    const error=err=>{if(ended)return;socket.emit('error',normalize(err));upstream?.terminate();end(1008);};
    socket.on('error',()=>{});
    socket.close=()=>{if(ended)return;upstream?.terminate();end();};
    socket.send=data=>{if(socket.readyState!==1||!upstream)throw revoked();upstream.send(data);};
    void context().then(async()=>{
      if(ended)return;
      if(!['ws:','wss:'].includes(target.protocol)||target.host!=='wanx-host.invalid'||target.username||target.password||target.search||target.hash||!/^\/api\/agents\/[A-Za-z0-9_-]{1,128}\/chat\/ws$/.test(target.pathname))throw revoked();
      upstream=await sdk.openStream(target.pathname);
      if(ended)return upstream.terminate();
      upstream.on('open',()=>{if(ended)return upstream.terminate();socket.readyState=1;socket.emit('open');});
      upstream.on('message',(data,binary)=>{if(!ended)socket.emit('message',data,binary);});
      upstream.on('error',error);
      upstream.on('close',(code,reason)=>end(code,reason));
    }).catch(error);
    return socket;
  }
  function close(){if(closed)return;closed=true;for(const socket of sockets)socket.close();sdk.close();}
  return {context,fetcher,createWebSocket,close};
}

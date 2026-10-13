import {randomBytes,createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createApp} from './app.mjs';
import {createRoleStore} from './roles.mjs';
import {createHostClient,HOST_ORIGIN} from './host-client.mjs';

/** Each runtime is bound to the launch's account and device; no independent login or upstream URL. */
export async function startHostRuntime({dataDir,staticDir,environment=process.env,hostClient,createServer=createApp}={}) {
  if(typeof dataDir!=='string'||!path.isAbsolute(dataDir))throw new Error('dataDir must be absolute');
  const host=hostClient||createHostClient({environment});
  let server;
  try {
    const context=await host.context();
    const namespace=createHash('sha256').update(JSON.stringify([context.accountId,context.boxId,context.user.id])).digest('hex');
    const directory=path.join(dataDir,'host-scopes',namespace);
    await mkdir(directory,{recursive:true,mode:0o700});
    const cookieName='zhijun_host_session',sid=randomBytes(32).toString('hex');
    const config={upstream:HOST_ORIGIN,publicOrigin:'http://127.0.0.1',bindings:{}};
    server=createServer(config,{
      staticDir,fetcher:host.fetcher,createWebSocket:host.createWebSocket,roleStore:createRoleStore(directory),
      sessionCookieName:cookieName,allowAgentSelection:true,
      managedHost:{assertLive:host.context,session:{sid,user:structuredClone(context.user),token:randomBytes(32).toString('hex'),expires:Date.now()+24*60*60*1000}},
    });
    const sockets=new Set();
    server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin=`http://127.0.0.1:${server.address().port}`;
    config.publicOrigin=origin;
    let closing;
    const close=()=>closing??=(async()=>{
      host.close();
      server.closeManagedSessions?.();
      server.closeAllConnections?.();
      // Revoked sessions may already have left createApp's session map while
      // their WebSocket close handshake is pending. Own every loopback socket.
      for(const socket of sockets)socket.destroy();
      await new Promise(resolve=>server.close(resolve));
    })();
    return {origin,url:origin,namespace,bootstrapCookie:{url:origin,name:cookieName,value:sid,httpOnly:true,sameSite:'strict',path:'/'},close};
  } catch(error){host.close();server?.close();throw error;}
}

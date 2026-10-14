import {afterEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import App from './App';
import {api} from './api';

vi.mock('./Chat',()=>({Chat:()=> <div>测试对话内容</div>}));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('HTTP session-status seam clears private UI and directs a revoked Host launch back to WANX',async()=>{
 let expired=false;
 vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
  if(input==='/api/status')return Response.json({host:true,connected:!expired,sessionExpired:expired,version:'test'});
  if(input==='/api/me')return Response.json({id:4,name:'盒子 102 用户',ready:false,reason:'未配置专家',roles:[]});
  return Response.json([]);
 }));
 render(<App/>);
 expect(await screen.findByRole('button',{name:'盒子 102 用户，私人空间与设置'})).toBeVisible();
 expired=true;
 await act(async()=>{await api('/status');});
 expect(await screen.findByRole('heading',{name:'万象连接已结束'})).toBeVisible();
 expect(screen.queryByRole('button',{name:'盒子 102 用户，私人空间与设置'})).not.toBeInTheDocument();
 expect(screen.queryByRole('form',{name:'登录知君'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'连接服务，搜索或切换 万象WANX'})).not.toBeInTheDocument();
});

it.each([200,204])('successful DELETE with empty response %s does not fail or expire the session',async status=>{
 const expired=vi.fn();window.addEventListener('session-expired',expired);
 try {
  const fetcher=vi.fn(async()=>status===204?new Response(null,{status:204}):Response.json(null));
  vi.stubGlobal('fetch',fetcher);
  await expect(api('/threads/test-thread','DELETE')).resolves.toBeNull();
  expect(fetcher).toHaveBeenCalledWith('/api/threads/test-thread',expect.objectContaining({method:'DELETE'}));
  expect(expired).not.toHaveBeenCalled();
 } finally {window.removeEventListener('session-expired',expired);}
});
it('a null error response preserves a usable error instead of reading host from null',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(null,{status:500})));
 await expect(api('/threads/test-thread','DELETE')).rejects.toThrow('暂时无法完成操作。');
});
it('null unauthorized responses still expire the session',async()=>{
 const expired=vi.fn();window.addEventListener('session-expired',expired);
 try {
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(null,{status:401})));
  await expect(api('/threads/test-thread','DELETE')).rejects.toThrow('暂时无法完成操作。');
  expect(expired).toHaveBeenCalledOnce();
 }finally{window.removeEventListener('session-expired',expired);}
});

it('deleting the selected conversation refreshes the list after a null response',async()=>{
 let deleted=false;
 vi.spyOn(window,'confirm').mockReturnValue(true);
 vi.stubGlobal('fetch',vi.fn(async(input:string,options?:RequestInit)=>{
  if(input==='/api/status')return Response.json({host:true,connected:true,version:'test'});
  if(input==='/api/me')return Response.json({id:4,name:'测试用户',ready:true,roles:[{id:'personal',name:'个人',description:''}]});
  if(input==='/api/threads/test-thread'&&options?.method==='DELETE'){deleted=true;return Response.json(null);}
  if(input==='/api/threads')return Response.json(deleted?[]:[{thread_id:'test-thread',title:'仅用于删除测试',channel_type:'dashboard'}]);
  return Response.json([]);
 }));
 render(<App/>);
 fireEvent.click(await screen.findByRole('button',{name:'仅用于删除测试 网页'}));
 fireEvent.click(await screen.findByRole('button',{name:'删除'}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:'仅用于删除测试 网页'})).not.toBeInTheDocument());
 expect(deleted).toBe(true);expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

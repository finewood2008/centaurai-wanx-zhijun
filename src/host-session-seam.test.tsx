import {afterEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import App from './App';
import {api} from './api';

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

it.each(['json-null','204','205'])('deleting a thread handles %s and refreshes the history list',async response=>{
 let deleted=false;
 Element.prototype.scrollIntoView=vi.fn();
 vi.spyOn(window,'confirm').mockReturnValue(true);
 vi.stubGlobal('WebSocket',class {static OPEN=1;readyState=1;close(){}send(){}});
 vi.stubGlobal('fetch',vi.fn(async(input:string,options?:RequestInit)=>{
  if(input==='/api/status')return Response.json({host:true,connected:true,version:'test'});
  if(input==='/api/me')return Response.json({id:4,name:'删除测试用户',ready:true,reason:'',roles:[]});
  if(input==='/api/threads')return Response.json(deleted?[]:[{thread_id:'delete-test',title:'待删除的测试对话',last_active:0}]);
  if(input==='/api/threads/delete-test'&&options?.method==='DELETE'){
   deleted=true;
   return response==='json-null'?Response.json(null):new Response(null,{status:Number(response)});
  }
  if(input.includes('/history'))return Response.json({messages:[],has_more:false});
  if(input.startsWith('/api/ontology/context'))return Response.json({claims:[]});
  return Response.json({});
 }));
 render(<App/>);
 fireEvent.click(await screen.findByRole('button',{name:/待删除的测试对话/}));
 fireEvent.click(await screen.findByRole('button',{name:'删除'}));
 await waitFor(()=>expect(deleted).toBe(true));
 await waitFor(()=>expect(screen.queryByRole('button',{name:/待删除的测试对话/})).not.toBeInTheDocument());
 expect(screen.queryByRole('button',{name:'删除'})).not.toBeInTheDocument();
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'删除测试用户，私人空间与设置'})).toBeVisible();
});

it.each([401,403])('preserves HTTP %s failure handling for a null error body',async status=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(null,{status})));
 const expired=vi.fn();
 window.addEventListener('session-expired',expired);
 try{
  await expect(api('/threads/delete-test','DELETE')).rejects.toThrow('暂时无法完成操作。');
  expect(expired).toHaveBeenCalledTimes(status===401?1:0);
 }finally{window.removeEventListener('session-expired',expired);}
});

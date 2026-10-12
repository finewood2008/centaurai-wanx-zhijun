import {afterEach,expect,it,vi} from 'vitest';
import {act,render,screen} from '@testing-library/react';
import App from './App';
import {api} from './api';

afterEach(()=>vi.unstubAllGlobals());
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

import {beforeEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {InteractionPreferences} from './InteractionPreferences';
import {Settings} from './Settings';
import App from './App';
import {api,setActiveRole} from './api';
import {settingsNavigationAllowed} from './settingsNavigation';
import {presetPreferences,presets} from '../server/interaction-schema.mjs';
vi.mock('./api',async()=>({...await vi.importActual<typeof import('./api')>('./api'),api:vi.fn()}));
vi.mock('./Memory',()=>({Memory:()=> <div>原生记忆设置</div>}));
const mocked=vi.mocked(api);
const user={id:8,name:'测试者',ready:true,reason:'',roles:[{id:'personal',name:'个人',description:'生活中的我'},{id:'work',name:'工作',description:'工作中的我'}]};
beforeEach(()=>{vi.resetAllMocks();localStorage.clear();setActiveRole('personal',true);mocked.mockImplementation(async(path,method,body)=>path==='/interaction-preferences'?{supported:true,preferences:method==='PUT'?body:null}:path==='/me'?user:path==='/threads'?[]:{connected:true});});
async function choose(name='温和倾听'){fireEvent.click(await screen.findByRole('button',{name:new RegExp(name)}));}

it.each(presets)('saves the $name preset only on explicit save',async p=>{
 render(<InteractionPreferences/>);await choose(p.name);
 expect(mocked.mock.calls.filter(([,method])=>method==='PUT')).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'保存交流方式'}));
 await waitFor(()=>expect(mocked).toHaveBeenCalledWith('/interaction-preferences','PUT',presetPreferences(p.id),expect.any(AbortSignal)));
 expect(await screen.findByRole('status')).toHaveTextContent('从下一次回复开始生效');
 expect(screen.getByRole('button',{name:'保存交流方式'})).toBeDisabled();
});
it('fine tuning becomes custom, and reset is an explicit saved deletion',async()=>{
 render(<InteractionPreferences/>);await choose();
 fireEvent.click(screen.getByText('进一步微调'));
 fireEvent.click(within(screen.getByRole('group',{name:'回复详略'})).getByRole('button',{name:'简短'}));
 expect(screen.getByText(/当前选择：自定义/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'保存交流方式'}));
 await screen.findByRole('status');
 expect(mocked.mock.calls.find(([,m])=>m==='PUT')?.[2]).toMatchObject({preset:'custom',verbosity:'brief',tone:'warm'});
 fireEvent.click(screen.getByRole('button',{name:'恢复原有方式'}));
 expect(mocked.mock.calls.some(([,m])=>m==='DELETE')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'保存交流方式'}));
 await waitFor(()=>expect(mocked).toHaveBeenCalledWith('/interaction-preferences','DELETE',undefined,expect.any(AbortSignal)));
 expect(screen.getByText('沿用原有方式')).toBeVisible();
});
it('reloads saved preferences and does not default new roles to a preset',async()=>{
 mocked.mockResolvedValue({supported:true,preferences:presetPreferences('advice')});
 const first=render(<InteractionPreferences/>);
 expect(await screen.findByRole('button',{name:/直接建议/})).toHaveAttribute('aria-pressed','true');
 first.unmount();mocked.mockResolvedValue({supported:true,preferences:null});render(<InteractionPreferences/>);
 expect(await screen.findByText('沿用原有方式')).toBeVisible();
 expect(screen.getByRole('button',{name:'保存交流方式'})).toBeDisabled();
});
it('old services and network errors cannot show a successful save',async()=>{
 mocked.mockResolvedValue({supported:false,preferences:null});render(<InteractionPreferences/>);
 expect(await screen.findByText('当前服务暂不支持交流方式设置。')).toBeVisible();
 expect(screen.getByRole('button',{name:'保存交流方式'})).toBeDisabled();
 mocked.mockRejectedValue(new Error('网络中断'));
 fireEvent.click(screen.getByRole('button',{name:'重新读取'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('网络中断');
 expect(screen.queryByText('已保存，从下一次回复开始生效。')).not.toBeInTheDocument();
});
it('retains the draft after a busy or failed save',async()=>{
 render(<InteractionPreferences/>);await choose();mocked.mockRejectedValue(new Error('知君正在回应，请等这一轮结束后再保存。'));
 fireEvent.click(screen.getByRole('button',{name:'保存交流方式'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('正在回应');
 expect(screen.getByText(/尚未保存/)).toBeVisible();
 expect(screen.getByRole('button',{name:'保存交流方式'})).toBeEnabled();
});
it('guards tab navigation, beforeunload, and clears guard after confirmed discard',async()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 render(<Settings user={user} roleName="个人" onUser={()=>{}} onLogout={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'交流方式'}));await choose();
 fireEvent.click(screen.getByRole('button',{name:'阅读偏好'}));
 expect(confirm).toHaveBeenCalled();expect(screen.getByText(/当前选择：温和倾听/)).toBeVisible();
 const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true);
 confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'阅读偏好'}));
 expect(screen.getByText('舒服的字号，刚刚好。')).toBeVisible();expect(settingsNavigationAllowed()).toBe(true);
 confirm.mockRestore();
});
it('guards shell navigation and a real role switch before discarding draft',async()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 render(<App/>);fireEvent.click(await screen.findByRole('button',{name:'测试者，私人空间与设置'}));
 fireEvent.click(screen.getByRole('button',{name:'交流方式'}));await choose();
 fireEvent.click(screen.getByRole('button',{name:'对话'}));expect(confirm).toHaveBeenCalled();
 expect(screen.getByText(/当前选择：温和倾听/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'当前角色：个人，切换或创建角色'}));
 fireEvent.click(screen.getByRole('button',{name:/工作 工作中的我/}));
 expect(screen.getByText(/当前选择：温和倾听/)).toBeVisible();
 confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:/工作 工作中的我/}));
 await waitFor(()=>expect(screen.queryByText(/当前选择：温和倾听/)).not.toBeInTheDocument());
 confirm.mockRestore();
});
it('blocks navigation during a save and ignores an unmounted response',async()=>{
 let finish!:(v:any)=>void;
 const alert=vi.spyOn(window,'alert').mockImplementation(()=>{});
 const page=render(<InteractionPreferences/>);await choose();
 mocked.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 fireEvent.click(screen.getByRole('button',{name:'保存交流方式'}));
 expect(settingsNavigationAllowed()).toBe(false);expect(alert).toHaveBeenCalled();
 const signal=mocked.mock.calls.at(-1)?.[3];page.unmount();expect(signal?.aborted).toBe(true);
 await act(async()=>finish({supported:true,preferences:presetPreferences('listening')}));
 expect(settingsNavigationAllowed()).toBe(true);alert.mockRestore();
});

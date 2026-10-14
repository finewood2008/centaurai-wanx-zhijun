import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import App from './App';
import {api,setActiveExpert,setActiveRole} from './api';
import {deleteThread,THREAD_DELETED} from './threads';
import {octopThreadsApi} from './native/api/modules/octopThreads';
const translations=vi.hoisted(()=>({t:(key:string,fallback?:string)=>typeof fallback==='string'?fallback:key}));
vi.mock('react-i18next',()=>({useTranslation:()=>translations}));
vi.mock('./api',async()=>({...await vi.importActual<typeof import('./api')>('./api'),api:vi.fn()}));
vi.mock('./Chat',()=>({Chat:({thread,onChanged}:any)=><div>当前对话 {thread}<button onClick={onChanged}>刷新侧边栏</button></div>}));
vi.mock('./Memory',()=>({Memory:()=> <button onClick={()=>void octopThreadsApi.delete('me','one')}>从对话记录删除</button>}));
vi.mock('./Library',()=>({Library:()=> null}));
const mocked=vi.mocked(api);
const one={thread_id:'one',title:'待删对话',last_active:2};
const two={thread_id:'two',title:'保留对话',last_active:1};
let rows=[one,two];
beforeEach(()=>{
 vi.resetAllMocks();vi.mocked(window.matchMedia).mockImplementation(query=>({matches:false,media:query,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn(),dispatchEvent:()=>true,onchange:null}));
 const getComputedStyle=window.getComputedStyle.bind(window);vi.spyOn(window,'getComputedStyle').mockImplementation(element=>getComputedStyle(element));
 localStorage.clear();setActiveExpert('expert');setActiveRole('personal',true);rows=[one,two];
 vi.spyOn(window,'confirm').mockReturnValue(true);
 mocked.mockImplementation(async(path,method)=>{
  if(path==='/me')return {id:8,name:'测试者',ready:true,expertId:'expert',roles:[{id:'personal',name:'个人',description:''}]};
  if(path==='/threads')return [...rows];
  if(method==='DELETE'){rows=rows.filter(row=>path!==`/threads/${row.thread_id}`);return null;}
  return {connected:true};
 });
});
afterEach(()=>vi.restoreAllMocks());
it('deleting through memory records removes the sidebar entry and clears the selected conversation',async()=>{
 render(<App/>);fireEvent.click(await screen.findByRole('button',{name:/待删对话/}));
 fireEvent.click(screen.getByRole('button',{name:'记忆'}));
 fireEvent.click(screen.getByRole('button',{name:'从对话记录删除'}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:/待删对话/})).not.toBeInTheDocument());
 expect(screen.getByRole('button',{name:/保留对话/})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'对话'}));
 expect(screen.getByRole('button',{name:'开始对话'})).toBeVisible();
 expect(screen.queryByText('当前对话 one')).not.toBeInTheDocument();
});
it('deleting a different thread retains the current thread and failed deletes publish no event',async()=>{
 render(<App/>);fireEvent.click(await screen.findByRole('button',{name:/保留对话/}));
 const deleted=vi.fn();window.addEventListener(THREAD_DELETED,deleted);
 await act(async()=>{await octopThreadsApi.delete('me','one');});
 expect(screen.getByText('当前对话 two')).toBeVisible();expect(deleted).toHaveBeenCalledTimes(1);
 mocked.mockRejectedValueOnce(new Error('删除失败'));
 await expect(deleteThread('two')).rejects.toThrow('删除失败');
 expect(screen.getByRole('button',{name:/保留对话/})).toBeVisible();expect(deleted).toHaveBeenCalledTimes(1);
 window.removeEventListener(THREAD_DELETED,deleted);
});
it('ignores a pre-delete sidebar response arriving after deletion from the chat toolbar',async()=>{
 render(<App/>);fireEvent.click(await screen.findByRole('button',{name:/待删对话/}));
 let resolve!:(value:any)=>void;
 mocked.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 fireEvent.click(screen.getByRole('button',{name:'刷新侧边栏'}));
 fireEvent.click(screen.getByRole('button',{name:'删除'}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:/待删对话/})).not.toBeInTheDocument());
 await act(async()=>resolve([one,two]));
 expect(screen.queryByRole('button',{name:/待删对话/})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'开始对话'})).toBeVisible();
});
it('does not clear a newly selected conversation when an older deletion finishes',async()=>{
 render(<App/>);fireEvent.click(await screen.findByRole('button',{name:/待删对话/}));
 let resolve!:(value:any)=>void;
 mocked.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 fireEvent.click(screen.getByRole('button',{name:'删除'}));
 fireEvent.click(screen.getByRole('button',{name:/保留对话/}));
 rows=[two];await act(async()=>resolve(null));
 expect(screen.getByText('当前对话 two')).toBeVisible();
});
it('does not publish a deletion into another role or a renewed account session',async()=>{
 let resolve!:(value:any)=>void;const deleted=vi.fn();window.addEventListener(THREAD_DELETED,deleted);
 mocked.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 const pending=deleteThread('one');setActiveRole('work');resolve(null);await pending;
 expect(deleted).not.toHaveBeenCalled();
 mocked.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 const renewed=deleteThread('one');setActiveRole('work',true);resolve(null);await renewed;
 expect(deleted).not.toHaveBeenCalled();window.removeEventListener(THREAD_DELETED,deleted);
});

it('keeps deleted memory records absent when an older list reload arrives late',async()=>{
 const {default:ConversationRecords}=await import('./native/pages/Agent/Memory/ConversationRecords');
 render(<ConversationRecords agentId="me"/>);
 await screen.findByText('待删对话');
 let resolve!:(value:any)=>void;mocked.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 fireEvent.click(screen.getByRole('button',{name:'common.refresh'}));
 await act(async()=>{await octopThreadsApi.delete('me','one');});
 expect(screen.queryByText('待删对话')).not.toBeInTheDocument();
 await act(async()=>resolve([one,two]));
 expect(screen.queryByText('待删对话')).not.toBeInTheDocument();
 expect(screen.getByText('保留对话')).toBeVisible();
});

it('closes the deleted record drawer and ignores its late history response',async()=>{
 const {default:ConversationRecords}=await import('./native/pages/Agent/Memory/ConversationRecords');
 render(<ConversationRecords agentId="me"/>);
 await screen.findByText('待删对话');
 let resolve!:(value:any)=>void;mocked.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 fireEvent.click(screen.getAllByRole('button',{name:'common.view'})[0]);
 await screen.findByRole('dialog');
 await act(async()=>{await octopThreadsApi.delete('me','one');});
 await act(async()=>resolve({messages:[{role:'user',content:'已删除的迟到消息'}],has_more:false}));
 expect(screen.queryByText('已删除的迟到消息')).not.toBeInTheDocument();
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(screen.queryByText('待删对话')).not.toBeInTheDocument();
});

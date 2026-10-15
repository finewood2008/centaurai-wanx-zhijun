import {settingsNavigationAllowed} from './settingsNavigation';
import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {dimensions,presets,presetPreferences,validPreferences} from '../server/interaction-schema.mjs';

type Preferences={version:number;preset:string;[key:string]:string|number};
type Response={supported:boolean;preferences:Preferences|null};
const same=(a:Preferences|null,b:Preferences|null)=>JSON.stringify(a)===JSON.stringify(b);
export function InteractionPreferences(){
 const [saved,setSaved]=useState<Preferences|null>(null),[draft,setDraft]=useState<Preferences|null>(null);
 const [loading,setLoading]=useState(true),[supported,setSupported]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
 const dirty=!same(saved,draft),state=useRef({dirty,busy,saved}),mounted=useRef(false),request=useRef<AbortController|null>(null);
 state.current={dirty,busy,saved};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current?.abort();};},[]);
 useEffect(()=>{
  const c=new AbortController();setLoading(true);setError('');setNotice('');setSupported(false);
  api<Response>('/interaction-preferences','GET',undefined,c.signal).then(data=>{
   if(c.signal.aborted)return;
   if(typeof data.supported!=='boolean'||(data.supported&&data.preferences!==null&&!validPreferences(data.preferences)))throw new Error('暂时无法读取交流方式，请稍后重试。');
   setSupported(data.supported);setSaved(data.preferences);setDraft(data.preferences);
  }).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});
  return()=>c.abort();
 },[revision]);
 useEffect(()=>{
  const beforeNavigation=(event:Event)=>{
   if(state.current.busy){event.preventDefault();window.alert('正在保存交流方式，请稍候。');return;}
   if(!state.current.dirty)return;
   if(!window.confirm('交流方式尚未保存，要放弃修改吗？')){event.preventDefault();return;}
   state.current.dirty=false;setDraft(state.current.saved);
  };
  const beforeUnload=(event:BeforeUnloadEvent)=>{if(state.current.dirty||state.current.busy){event.preventDefault();event.returnValue='';}};
  window.addEventListener('zhijun-before-navigation',beforeNavigation);window.addEventListener('beforeunload',beforeUnload);
  return()=>{window.removeEventListener('zhijun-before-navigation',beforeNavigation);window.removeEventListener('beforeunload',beforeUnload);};
 },[]);
 function edit(value:Preferences|null){setDraft(value);setNotice('');setError('');}
 async function save(){
  if(state.current.busy)return;
  state.current.busy=true;setBusy(true);setError('');setNotice('');const c=new AbortController();request.current=c;
  try{
   const result=await api<Response>('/interaction-preferences',draft?'PUT':'DELETE',draft??undefined,c.signal);
   if(!result.supported||(result.preferences!==null&&!validPreferences(result.preferences)))throw new Error('服务未确认保存成功，请重新读取后重试。');
   if(mounted.current&&!c.signal.aborted){setSaved(result.preferences);setDraft(result.preferences);setNotice('已保存，从下一次回复开始生效。');}
  }catch(e){if(mounted.current&&!c.signal.aborted){const failure=e as Error&{code?:string};setError(failure.message);if(failure.code==='INTERACTION_UNSUPPORTED')setSupported(false);}}
  finally{state.current.busy=false;if(mounted.current)setBusy(false);}
 }
 if(loading)return <p role="status">正在读取交流方式…</p>;
 if(!supported)return <section className="setting-card"><p role={error?'alert':'status'}>{error||'当前服务暂不支持交流方式设置。'}</p><button onClick={()=>{if(settingsNavigationAllowed())setRevision(x=>x+1);}}>重新读取</button><button disabled>保存交流方式</button></section>;
 const selected=presets.find(p=>p.id===draft?.preset);
 return <div className="interaction-settings">
  <p className="quiet">适用于这个角色的客户端和微信对话。选择一种交流方式，也可以按自己的习惯微调。</p>
  <p className="interaction-current">{draft?`当前选择：${selected?.name||'自定义'}`:'沿用原有方式'}{dirty&&<span> · 尚未保存</span>}</p>
  <div className="interaction-presets" role="group" aria-label="交流方式预设">{presets.map(p=><button key={p.id} disabled={busy} aria-pressed={draft?.preset===p.id} onClick={()=>edit(presetPreferences(p.id) as Preferences)}><strong>{p.name}</strong><span>{p.description}</span></button>)}</div>
  {draft&&<>
   <section className="setting-card interaction-example"><span className="eyebrow">表达示例</span><p>{selected?.example||'自定义方式会结合下方五项偏好影响回复。'}</p><small className="quiet">示例仅用于理解风格，实际回复会根据话题和上下文变化。</small></section>
   <details className="setting-card interaction-tuning"><summary>进一步微调</summary>{dimensions.map(d=><fieldset key={d.key} disabled={busy}><legend>{d.label}</legend><div>{d.options.map(([value,label])=><button key={value} aria-pressed={draft[d.key]===value} onClick={()=>edit({...draft,preset:'custom',[d.key]:value})}>{label}</button>)}</div></fieldset>)}<p className="quiet">知君仍会纠正事实、保留必要提醒；主动给建议不会增加自动执行权限。</p></details>
  </>}
  {error&&<p className="notice" role="alert">{error}</p>}{notice&&<p className="success" role="status">{notice}</p>}
  <div className="interaction-actions"><button className="primary" disabled={busy||!dirty} onClick={()=>void save()}>{busy?'正在保存…':'保存交流方式'}</button><button disabled={busy||!draft} onClick={()=>edit(null)}>恢复原有方式</button></div>
  <p className="quiet">修改后点击保存。恢复原有方式会移除这些交流偏好，保留角色原来的设置。</p>
 </div>;
}

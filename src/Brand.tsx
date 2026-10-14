import {useRef} from 'react';
import {X} from 'lucide-react';
import {version} from './version';
import centaurLogo from './assets/centaurai-mark.png';
import './brand.css';

export function Brand({className=''}:{className?:string}) {
  const dialog=useRef<HTMLDialogElement>(null);
  return <>
    <div className={`brand ${className}`}>
      <button type="button" className="seal brand-trigger" aria-label="关于知君" aria-haspopup="dialog" onClick={()=>dialog.current?.showModal()}>知</button>
      <div className="brand-copy"><strong>知君</strong><small>CONTEXT OF ME</small></div>
    </div>
    <dialog ref={dialog} className="about-zhijun" aria-labelledby="about-zhijun-title" aria-describedby="about-zhijun-position" onClick={e=>{
      if(e.target!==e.currentTarget)return;
      const bounds=e.currentTarget.getBoundingClientRect();
      if(e.clientX<bounds.left||e.clientX>bounds.right||e.clientY<bounds.top||e.clientY>bounds.bottom)dialog.current?.close();
    }}>
      <button type="button" className="about-close" aria-label="关闭关于知君" onClick={()=>dialog.current?.close()}><X size={18}/></button>
      <div className="about-identity"><span className="seal" aria-hidden="true">知</span><div><h2 id="about-zhijun-title">知君</h2><span>CONTEXT OF ME</span></div></div>
      <div className="about-position" id="about-zhijun-position"><p>个人记忆智能体</p><span lang="en">Personal Memory Agent</span></div>
      <p className="about-purpose">你的知己、益友、良师。</p>
      <footer className="about-footer"><div className="about-maker"><img src={centaurLogo} alt="半人马AI Logo"/><div><strong>半人马人工智能</strong><span lang="en">CentaurAI</span></div></div><p className="about-version">版本 {version}</p></footer>
    </dialog>
  </>;
}

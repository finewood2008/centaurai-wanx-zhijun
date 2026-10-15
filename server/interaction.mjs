import {validPreferences} from './interaction-schema.mjs';
import {fail} from './policy.mjs';

export async function interactionPreferences(upstream,root,session,method,body){
 if(method==='PUT'&&!validPreferences(body))fail(400,'INVALID_INTERACTION_PREFERENCES','交流方式设置无效，请重新选择。');
 if(method==='DELETE'&&body&&Object.keys(body).length)fail(400,'INVALID_INTERACTION_PREFERENCES','恢复原有方式不接受其他配置。');
 try{
  const data=await upstream(`${root}/interaction-preferences`,session,method,method==='PUT'?body:undefined);
  if(!data||!Object.hasOwn(data,'preferences')||(data.preferences!==null&&!validPreferences(data.preferences)))fail(502,'INVALID_INTERACTION_RESPONSE','暂时无法读取交流方式，请稍后重试。');
  return {supported:true,preferences:data.preferences};
 }catch(error){
  if([404,405,501].includes(error.status)){
   if(method==='GET')return {supported:false,preferences:null};
   fail(501,'INTERACTION_UNSUPPORTED','当前服务暂不支持交流方式设置。');
  }
  if(error.status===409)fail(409,'INTERACTION_BUSY','知君正在回应，请等这一轮结束后再保存。');
  throw error;
 }
}

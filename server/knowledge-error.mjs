import {ClientError} from './policy.mjs';

const messages={
 KNOWLEDGE_FEATURE_DISABLED:'知识库尚未启用，请在万象中启用后再使用。',
 KNOWLEDGE_PREREQUISITES_FAILED:'知识库尚未就绪，请在万象中检查知识库配置。',
 KNOWLEDGE_PERMISSION_REQUIRED:'当前账户没有知识库管理权限，请联系管理员。',
};
export const isKnowledgeUnavailable=error=>error instanceof ClientError&&Object.hasOwn(messages,error.code);

/** Read only a bounded error envelope; never surface an upstream message or token. */
export async function knowledgeError(response) {
 if(![403,409].includes(response.status)||!response.body)return null;
 const reader=response.body.getReader();let raw=Buffer.alloc(0),envelope;
 const timer=setTimeout(()=>void reader.cancel().catch(()=>{}),1000);
 try {
  while(raw.length<=16384){
   const {done,value}=await reader.read();if(done)break;
   raw=Buffer.concat([raw,Buffer.from(value)]);if(raw.length>16384)break;
   try {envelope=JSON.parse(raw.toString('utf8'));break;}catch{}
  }
 } catch {} finally {clearTimeout(timer);await reader.cancel().catch(()=>{});reader.releaseLock();}
 const error=envelope?.error;
 let code=error?.code;
 if(response.status===403&&code==='FORBIDDEN'&&error.details?.permission==='knowledge_bases')code='KNOWLEDGE_PERMISSION_REQUIRED';
 if((response.status===403&&['KNOWLEDGE_FEATURE_DISABLED','KNOWLEDGE_PERMISSION_REQUIRED'].includes(code))||
    (response.status===409&&code==='KNOWLEDGE_PREREQUISITES_FAILED'))return new ClientError(response.status,code,messages[code]);
 return null;
}

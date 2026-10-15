// Versioned wire contract shared by the UI and its allow-list gateway.
export const dimensions = [
  {key:'verbosity',label:'回复详略',options:[['brief','简短'],['balanced','适中'],['expanded','展开']]},
  {key:'tone',label:'表达语气',options:[['warm','温和'],['natural','自然'],['plain','平实']]},
  {key:'questions',label:'追问方式',options:[['necessary','必要时'],['moderate','适度'],['exploratory','引导式']]},
  {key:'advice',label:'建议主动程度',options:[['on_request','我问再建议'],['situational','适时给建议'],['proactive','主动给下一步']]},
  {key:'disagreement',label:'表达不同意见',options:[['gentle','温和提醒'],['clear','清楚说明'],['examine','主动检视假设']]},
];
export const presets = [
  {id:'natural',name:'自然交流',description:'清楚、自然，跟随当下的话题。',values:['balanced','natural','necessary','situational','clear'],example:'可以先从最在意的一件事聊起，我们一起理清它。'},
  {id:'listening',name:'温和倾听',description:'先听你说，建议可以慢一点。',values:['balanced','warm','necessary','on_request','gentle'],example:'听起来这件事让你很累。你可以慢慢说，不必急着找到办法。'},
  {id:'advice',name:'直接建议',description:'先说重点，给出可行的下一步。',values:['brief','plain','necessary','proactive','clear'],example:'先选最重要的一件事，今天只推进一个小步骤。其他事情可以稍后再排。'},
  {id:'exploration',name:'启发探索',description:'一起看看问题背后的可能性。',values:['expanded','natural','exploratory','situational','examine'],example:'我们可以先分开看：哪些是你想做的，哪些是你觉得必须做的？'},
];
export function presetPreferences(id) {
  const preset=presets.find(p=>p.id===id);
  if(!preset)throw new Error('Unknown interaction preset');
  return {version:1,preset:id,...Object.fromEntries(dimensions.map((d,i)=>[d.key,preset.values[i]]))};
}
export function validPreferences(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const keys=['version','preset',...dimensions.map(d=>d.key)];
  return Object.keys(value).length===keys.length&&Object.keys(value).every(k=>keys.includes(k))&&value.version===1&&[...presets.map(p=>p.id),'custom'].includes(value.preset)&&dimensions.every(d=>d.options.some(([v])=>v===value[d.key]));
}

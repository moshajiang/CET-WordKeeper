import {scheduler} from '../../shared/mobile-review-contract.mjs';
export const LABELS=Object.freeze({recall:'问答',translation:'翻译',judgment:'判断',choice:'选择',spelling:'拼写',cloze:'原句填空'}),CHECK_VERSION='typed-answer:v1';
const text=(value,max,empty=false)=>{if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw Error('invalid_card_text');return value;};
export function card(value){
 const keys=['id','revision','contentKey','scheduler','type','question','answer','explanation','options','sourceTitle','sourceContent','sourceLabel'];
 if(!value||typeof value!=='object'||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))||!Object.hasOwn(LABELS,value.type)||!Number.isSafeInteger(value.revision)||value.revision<1||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.id)||! /^[a-f0-9]{64}$/.test(value.contentKey))throw Error('invalid_card');
 if(!Array.isArray(value.options)||value.options.length>6)throw Error('invalid_card_options');const options=Array.from(value.options,v=>text(v,1000));
 if(value.type==='choice'){if(options.length<2||new Set(options).size!==options.length||! /^[A-F]$/.test(value.answer)||value.answer.charCodeAt(0)-65>=options.length)throw Error('invalid_card_options');}else if(options.length)throw Error('invalid_card_options');
 if(value.type==='judgment'&&!['正确','错误'].includes(value.answer))throw Error('invalid_card_answer');
 const answer=text(value.answer,6000),question=text(value.question,6000);if(['spelling','cloze'].includes(value.type)){const n=normalizeAnswer(answer),words=n.match(/[a-z]+(?:['\-][a-z]+)*/g)||[];if(answer.length>240||!words.length||words.length>12||!/^[a-z0-9'\- ]+$/.test(n))throw Error('invalid_card_answer');}if(value.type==='cloze'&&question.split('【填空】').length!==2)throw Error('invalid_cloze');
 return {id:value.id,revision:value.revision,contentKey:value.contentKey,scheduler:scheduler(value.scheduler),type:value.type,question,answer,explanation:text(value.explanation,12000,true),options,sourceTitle:text(value.sourceTitle,1000,true),sourceContent:text(value.sourceContent,20000,true),sourceLabel:text(value.sourceLabel,1000,true)};
}
// Same versioned normalization as the desktop; parity is checked by the regression suite.
export const normalizeAnswer=value=>String(value).normalize('NFKC').replace(/[‘’]/g,"'").trim().replace(/\s+/g,' ').toLowerCase();
export function compare(c,response){if(typeof response!=='string'||response.length>10000)throw Error('invalid_response');if(['spelling','cloze'].includes(c.type)){const normalizedAnswer=normalizeAnswer(c.answer),normalizedResponse=normalizeAnswer(response);return {version:CHECK_VERSION,correct:!!normalizedResponse&&normalizedAnswer===normalizedResponse,normalizedAnswer,normalizedResponse};}if(['choice','judgment'].includes(c.type))return {correct:response===c.answer};return {correct:null};}
export function canReveal(c,response,forgot=false){return ['choice','judgment'].includes(c.type)?choices(c).some(v=>v.value===response):['spelling','cloze'].includes(c.type)?forgot||!!response.trim():true;}
export function choices(c){return c.type==='judgment'?['正确','错误'].map(value=>({value,label:value})):c.type==='choice'?c.options.map((label,i)=>({value:String.fromCharCode(65+i),label:String.fromCharCode(65+i)+'. '+label})):[];}
export function grades(c){return c.scheduler.engine==='fsrs-card'?[{value:1,label:'没想起'},{value:2,label:'费力想起'},{value:3,label:'正常想起'},{value:4,label:'很轻松'}]:[{value:0,label:'不会'},{value:1,label:'模糊'},{value:2,label:'会用'}];}
export function canRate(c,response,rating){
 if(!grades(c).some(v=>v.value===rating)||typeof response!=='string'||response.length>10000)return false;
 const objective=['choice','judgment'].includes(c.type),typed=['spelling','cloze'].includes(c.type);if(objective&&!canReveal(c,response))return false;
 if((objective||typed)&&!compare(c,response).correct)return c.scheduler.engine==='fsrs-card'?rating===1:typed?rating===0:rating!==2;return true;
}
export function answerLabel(c){return c.type==='choice'?c.answer+'. '+c.options[c.answer.charCodeAt(0)-65]:c.answer;}

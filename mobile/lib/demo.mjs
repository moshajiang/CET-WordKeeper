import {card} from './review-model.mjs';
const legacy={engine:'legacy-card',version:'1',parameterVersion:null,epoch:0},fsrs={engine:'fsrs-card',version:'5.4.2',parameterVersion:'d'.repeat(64),epoch:0};
const examples=[
 {type:'recall',question:'“take part in” 在下句中是什么意思？\nWe take part in a reading group.',answer:'参加；参与',explanation:'take part in 后接所参与的活动。',sourceContent:'We take part in a reading group.',sourceTitle:'参加阅读小组'},
 {type:'translation',question:'把这句话译成中文：\nSmall steps can lead to lasting progress.',answer:'小步前进也能带来持久的进步。',explanation:'can 表示可能性，lead to 表示带来某种结果。',sourceContent:'Small steps can lead to lasting progress.',sourceTitle:'持续进步'},
 {type:'judgment',question:'“Not all students agreed.” 表示“所有学生都不同意”，对吗？',answer:'错误',explanation:'not all 是部分否定，意思是“并非所有学生都同意”。',sourceContent:'Not all students agreed.',sourceTitle:'部分否定'},
 {type:'choice',question:'选出合适的形式：\nShe ___ a clear limit.',answer:'B',options:['set','sets','setting'],explanation:'主语 She，描述通常行为，一般现在时动词用 sets。',sourceContent:'She sets a clear limit.',sourceTitle:'设定界限',scheduler:fsrs},
 {type:'spelling',question:'按“落下（日落）”的含义，拼写原文中的表达。\n词形提示：第三人称单数，4 个字符。',answer:'sets',explanation:'The sun sets. 此处 sets 表示太阳落下。',sourceContent:'The sun sets.',sourceTitle:'sets · 日落'},
 {type:'cloze',question:'补全原句，只填写目标空：\nShe 【填空】 a clear limit.\n此处含义：设定。',answer:'sets',explanation:'保持原词形，应填 sets，不替换为原形 set 或同义词。',sourceContent:'She sets a clear limit.',sourceTitle:'sets · 设定',scheduler:fsrs},
];
export async function demoCards(crypto=globalThis.crypto){return Promise.all(examples.map(async(e,i)=>{const options=e.options||[],key=JSON.stringify([e.type,e.question,e.answer,options]),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));return card({id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),revision:1,contentKey:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join(''),scheduler:e.scheduler||legacy,type:e.type,question:e.question,answer:e.answer,explanation:e.explanation,options,sourceTitle:e.sourceTitle,sourceContent:e.sourceContent,sourceLabel:'WordKeeper 原创演示 · 非真题'});}));}

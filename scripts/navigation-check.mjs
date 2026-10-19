// 真实组件参数复用、往返定位、滚动监听及正常关闭重启；不触及真实用户库。
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTestSession,availablePort,waitForPage,connectCdp,stopChild} from './lib/test-session.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),session=createTestSession('navigation');
let child,cdp,passed=0;
const check=(name,ok)=>{if(!ok)throw Error(name);passed++;console.log('✓ '+name);};
async function until(code){const end=Date.now()+15000;while(Date.now()<end){if(await cdp.js(code))return;await new Promise(resolve=>setTimeout(resolve,40));}throw Error('等待超时: '+code);}
async function boot(){const port=await availablePort();child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),['.',`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu'],{cwd:root,env:session.env,stdio:'ignore'});cdp=await connectCdp(await waitForPage(port,child));}
const active=()=>cdp.js('document.querySelector(".section-tabs .active")?.textContent.trim()');
async function enter(id){await cdp.js(`location.hash='#/reader/${id}'`);await until(`!!document.querySelector('.reader-topbar') && ![...document.querySelectorAll('.tb-actions button')].find(b=>b.textContent==='交卷核对').disabled`);}
try{
 await boot();
 const make=(year,marker)=>({level:'CET4',year,month:6,set_no:1,passages:[1,2,3].map(seq=>({section:seq===1?'listening':'reading',seq,content:Array.from({length:100},(_,i)=>`${marker} passage ${seq} paragraph ${i}: The students carefully considered different approaches to learning English and remembered the meaning of each sentence.`).join('\n'),translation:seq===1?'':Array.from({length:100},(_,i)=>`第${i}段：学生认真思考不同的英语学习方法，记住每个句子的意思。`).join('\n'),questions:[{stem:'46',options:['A) yes','B) no'],answer:'A',analysis:'本题根据原文选择 A。'}]}))});
 const a=await cdp.js(`window.keeper.importExam(${JSON.stringify(make(2097,'Alpha'))})`),b=await cdp.js(`window.keeper.importExam(${JSON.stringify(make(2098,'Beta'))})`);check('导入两套独立导航回归材料',a.ok&&b.ok);
 const detail=await cdp.js(`window.keeper.examDetail(${a.examId})`),second=detail.passages[1].id,third=detail.passages[2].id;
 await enter(a.examId);await cdp.js(`document.querySelectorAll('.section-tabs button')[2].click()`);await until(`document.querySelector('.section-tabs .active').textContent.trim()==='仔细阅读 3'`);
 await cdp.js(`[...document.querySelectorAll('.tb-modes button')].find(b=>b.textContent==='逐句对照').click();[...document.querySelectorAll('.tb-modes button')].find(b=>b.textContent.includes('左右')).click();[...document.querySelectorAll('.tb-actions button')].find(b=>b.textContent==='A+').click()`);await until(`!!document.querySelector('.layout-split') && !!document.querySelector('.bi-en')`);
 await cdp.js(`document.querySelector('.main').scrollTop=700`);await until(`JSON.parse(localStorage.getItem('keeper.reader.progress'))?.[${a.examId}]?.scroll>=650`);
 check('正文加载后的真实滚动事件持续保存位置和稳定篇章 ID',await cdp.js(`JSON.parse(localStorage.getItem('keeper.reader.progress'))[${a.examId}].passageId===${third}`));
 await cdp.js(`[...document.querySelectorAll('.tb-actions button')].find(b=>b.textContent.includes('对照背诵')).click()`);await until(`!!document.querySelector('.recite-tabs')`);
 check('从阅读进入背诵定位同篇，过滤无译文篇章后身份仍正确',await cdp.js(`document.querySelector('.recite-tabs .active').textContent==='仔细阅读 3' && document.querySelectorAll('.recite-tabs button').length===2 && location.hash.includes('passage=${third}')`));
 await cdp.js(`document.querySelectorAll('.recite-tabs button')[0].click()`);await until(`document.querySelector('.recite-tabs .active').textContent==='仔细阅读 2'`);await cdp.js(`document.querySelector('.recite-actions button.primary').click()`);await until(`document.querySelectorAll('.recite-line').length===1`);
 check('切换背诵篇章从空白开始，并可逐句呈现',await cdp.js(`document.querySelector('.recite-tabs .active').textContent==='仔细阅读 2'`));
 await cdp.js(`[...document.querySelectorAll('.recite-actions button')].find(b=>b.textContent.includes('返回做题')).click()`);await until(`!!document.querySelector('.section-tabs')`);
 check('返回做题定位当前背诵篇章，覆盖阅读器之前的另一篇位置',(await active())==='仔细阅读 2');
 await cdp.js(`location.hash='#/reader/${a.examId}?passage=${third}'`);await until(`document.querySelector('.section-tabs .active').textContent.trim()==='仔细阅读 3'`);check('同一阅读组件只改链接参数也会定位目标篇章',true);
 await cdp.js(`[...document.querySelectorAll('.tb-actions button')].find(b=>b.textContent==='查看解析与翻译').click()`);await until(`!!document.querySelector('.qmark')`);
 await enter(b.examId);check('切换试卷清除解析揭示、翻译和布局，不继承上一卷答案展示',await cdp.js(`!!document.querySelector('.layout-stack') && !document.querySelector('.bi-en') && !document.querySelector('.qmark') && document.querySelector('.article').style.fontSize==='16.5px'`));
 await enter(a.examId);check('返回原试卷恢复其独立篇章和展示偏好',(await active())==='仔细阅读 3'&&await cdp.js(`!!document.querySelector('.layout-split') && !!document.querySelector('.bi-en') && document.querySelector('.article').style.fontSize==='17.5px'`));
 await cdp.js(`document.querySelector('.main').scrollTop=550;setTimeout(()=>window.close(),20);true`);
 const deadline=Date.now()+8000;while(child.exitCode===null&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,40));check('滚动防抖完成前正常关闭窗口',child.exitCode!==null);cdp.close();cdp=null;child=null;
 await boot();await enter(a.examId);check('正常关闭重开恢复篇章和关闭前的滚动位置',(await active())==='仔细阅读 3'&&await cdp.js(`Math.abs(document.querySelector('.main').scrollTop-550)<10`));
 await cdp.js(`location.hash='#/knowledge'`);await until(`!document.querySelector('.reader-topbar')`);await cdp.js(`localStorage.setItem('keeper.reader.progress',JSON.stringify({${a.examId}:{idx:1,scroll:0}}))`);await enter(a.examId);
 check('兼容旧下标记录并升级为稳定篇章身份',(await active())==='仔细阅读 2'&&await cdp.js(`JSON.parse(localStorage.getItem('keeper.reader.progress'))[${a.examId}].passageId===${second}`));
 await cdp.js(`location.hash='#/recite/999999999'`);await until(`!!document.querySelector('[role=alert]')`);check('缺失背诵材料明确显示错误并提供重试',await cdp.js(`document.querySelector('[role=alert]').textContent.includes('未找到') && document.querySelector('[role=alert]').textContent.includes('重试')`));
 await cdp.js(`[...document.querySelectorAll('[role=alert] button')].find(b=>b.textContent==='选择其他真题').click()`);await until(`!!document.querySelector('select option[value="${a.examId}"]')`);check('回到考次选择页会重新加载列表',true);
 await cdp.js(`location.hash='#/recite/${a.examId}?passage=${second}'`);await until(`!!document.querySelector('.recite-tabs')`);await cdp.js(`location.hash='#/recite/${a.examId}?passage=${third}'`);await until(`document.querySelector('.recite-tabs .active').textContent==='仔细阅读 3'`);check('同一背诵组件的链接篇章变化也生效',await cdp.js(`document.querySelectorAll('.recite-line').length===0`));
 console.log(`阅读/背诵真实导航 ${passed}/${passed}`);
}finally{cdp?.close();await stopChild(child);session.cleanup();}

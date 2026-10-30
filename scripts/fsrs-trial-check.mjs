import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import initSqlJs from 'sql.js';
import {createTestSession,availablePort,waitForPage,connectCdp,stopChild} from './lib/test-session.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),session=createTestSession('fsrs-trial');
let child,cdp,passed=0,SQL;
const check=(name,ok)=>{if(!ok)throw Error(name);passed++;console.log('✓ '+name);};
const bytes=()=>fs.readFileSync(path.join(session.dir,'keeper.db'));
async function until(expression){const end=Date.now()+15000;while(Date.now()<end){if(await cdp.js(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('UI timeout: '+expression);}
async function api(method,...args){return cdp.js(`window.keeper[${JSON.stringify(method)}](...${JSON.stringify(args)})`);}
async function route(hash,ready){await cdp.js(`location.hash=${JSON.stringify(hash)}`);await until(ready);}
async function click(text){await cdp.js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Missing enabled button '+${JSON.stringify(text)});b.click();})()`);}
async function grade(name){await cdp.js(`(()=>{const b=[...document.querySelectorAll('.fsrs-ratings button')].find(b=>b.textContent.startsWith(${JSON.stringify(name+' ·')}));if(!b||b.disabled)throw Error('Missing enabled grade');b.click();})()`);await until("!!document.querySelector('.card-review-empty')");}
async function launch(){const port=await availablePort();child=spawn(process.env.ELECTRON_EXE||path.join(root,'node_modules/electron/dist/electron.exe'),[...(process.env.ELECTRON_EXE?[]:['.']),`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu'],{cwd:root,env:session.env,stdio:'ignore'});cdp=await connectCdp(await waitForPage(port,child));if(process.env.ELECTRON_EXE){const state=await api('updateState');if(!state.automatic?.packaged)throw Error('Expected packaged application');const saved=await api('updatePreferences',{enabled:false});if(!saved.ok)throw Error('Cannot isolate automatic checks');}await cdp.js('window.confirm=()=>true');}
async function manager(id,title){await route('#/cards?card='+id,`document.querySelector('.practice-detail h2')?.textContent===${JSON.stringify(title)}`);await until('!!document.querySelector(".practice-scheduler")');}
async function enable(){await click('预览 FSRS 试用方案');await until('!!document.querySelector(".trial-plan")');await click('备份并启用 FSRS');await until("document.querySelector('.practice-scheduler strong')?.textContent==='调度方式：FSRS 试用'");}
function inspect(file,query){const db=new SQL.Database(new Uint8Array(fs.readFileSync(file)));try{return db.exec(query)[0]?.values||[];}finally{db.close();}}
function backupValid(file,original){const relative=path.relative(path.join(session.dir,'scheduler-backups'),file);return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&fs.readFileSync(file).equals(original)&&path.basename(file).includes(createHash('sha256').update(original).digest('hex').slice(0,16));}
try{
 SQL=await initSqlJs({locateFile:f=>path.join(root,'node_modules/sql.js/dist',f)});await launch();
 const entry=(await api('kbSearch',{})).entries[0];
 const created=await api('practiceSaveBatch',{operationId:randomUUID(),enroll:true,cards:[{type:'recall',question:'Recall the trial rule.',answer:'Recall before reading.',explanation:'Use your actual recall result.',options:[],tags:['试用'],sourceKey:entry.key,origin:'manual'},{type:'choice',question:'Choose the trial answer.',answer:'A',explanation:'The first option is correct.',options:['First','Second'],tags:[],sourceKey:entry.key,origin:'manual'}]});if(!created.ok)throw Error(created.error);
 const [recall,choice]=created.created;
 await manager(recall,'Recall the trial rule.');check('新卡管理页默认原调度，提供明确的可选入口',await cdp.js("document.querySelector('.practice-scheduler strong').textContent==='调度方式：原调度'"));
 let before=bytes();await click('预览 FSRS 试用方案');await until('!!document.querySelector(".trial-plan")');check('预览显示只影响一张卡，数据库保持不变',before.equals(bytes())&&await cdp.js("document.querySelector('.trial-plan').textContent.includes('本次影响 1 张卡')"));await click('取消切换');check('取消不启用试用且不创建备份',(await api('practiceGet',recall)).trial.phase==='none'&&!fs.existsSync(path.join(session.dir,'scheduler-backups')));
 await cdp.js("(()=>{const e=document.querySelector('[aria-label=试用目标保持率]');e.value='0.95';e.dispatchEvent(new Event('change',{bubbles:true}));})()");before=bytes();await enable();let card=await api('practiceGet',recall);
 check('明确提交后仅当前卡使用指定保持率',card.trial.phase==='fsrs'&&card.trial.retention===0.95&&(await api('practiceGet',choice)).trial.phase==='none');
 check('实际备份文件完整且摘要与切换前数据库一致',backupValid(card.trial.initialBackup,before)&&inspect(card.trial.initialBackup,'SELECT COUNT(*) FROM practice_fsrs')[0][0]===0);
 check('启用后可在详情查看本机备份位置',await cdp.js("document.querySelector('.practice-scheduler details').textContent.includes('scheduler-backups')"));
 let other=await api('practiceGet',choice);await api('practiceState',{id:choice,expectedRevision:other.revision,action:'unenroll'});
 await route('#/review?tab=cards',"document.querySelector('.practice-review-question h2')?.textContent==='Recall the trial rule.'");
 check('试用卡仍先回忆，翻面前不显示评分与间隔',!await cdp.js("!!document.querySelector('.fsrs-ratings')||!!document.querySelector('.schedule-preview')"));await click('查看卡片答案');await until('document.querySelectorAll(".fsrs-ratings button").length===4');
 check('四档名称与实际间隔清楚展示，费力档要求回忆成功',await cdp.js("document.querySelector('.practice-review-answer').textContent.includes('费力想起仅用于已经回忆成功')&&[...document.querySelectorAll('.fsrs-ratings button')].every(b=>b.textContent.includes(' · '))&&document.querySelector('.schedule-preview').textContent.includes('费力想起：约 15 分钟')"));
 await cdp.js("[...document.querySelectorAll('.fsrs-ratings button')].find(b=>b.textContent.startsWith('费力想起 ·')).click()");await until("document.querySelector('.card-review-meta')?.textContent.includes('已完成 1 张')||!!document.querySelector('.card-review-empty')");
 let history=await api('practiceHistory',recall);card=await api('practiceGet',recall);check('四档原始评分和作答历史真实落盘',history.length===1&&history[0].fsrs.grade===2&&history[0].fsrs.ratingScale==='fsrs-4-v1');
 await manager(recall,'Recall the trial rule.');await until("document.querySelector('.practice-history')?.textContent.includes('费力想起 · FSRS')");check('历史显示原始四档语义',true);
 before=bytes();await click('预览退出试用方案');await until('!!document.querySelector(".trial-plan")');const plan=await api('practiceTrialPreview',{id:recall,expectedRevision:card.revision,action:'rollback'});
 check('退出预览只读，采用试用真实评分同步计算的原安排',before.equals(bytes())&&plan.proposedDue!==card.due&&new Date(plan.proposedDue)-new Date(history[0].reviewed_at)===86400000);
 await click('备份并回到原调度');await until("document.querySelector('.practice-scheduler strong')?.textContent.includes('已退出试用')");card=await api('practiceGet',recall);
 check('退出前的实际备份保留试用状态及原始四档记录',backupValid(card.trial.lastBackup,before)&&inspect(card.trial.lastBackup,"SELECT phase FROM practice_fsrs WHERE card_id='"+recall+"'")[0][0]==='fsrs'&&inspect(card.trial.lastBackup,'SELECT grade FROM practice_fsrs_review')[0][0]===2);
 check('退出接续原调度且保留全部学习历史',card.trial.phase==='legacy'&&card.due===plan.proposedDue&&card.interval_days===1&&(await api('practiceHistory',recall))[0].fsrs.grade===2);
 const edited=await api('practiceSave',{...card,expectedRevision:card.revision,question:'Relearn the trial rule.'});if(!edited.ok)throw Error(edited.error);
 await route('#/review?tab=cards',"document.querySelector('.practice-review-question h2')?.textContent==='Relearn the trial rule.'");await click('查看卡片答案');check('退出后重新学习恢复原三档评分',await cdp.js("document.querySelectorAll('.card-review-ratings button').length===3&&!document.querySelector('.fsrs-ratings')"));await click('会用 · 2 天');await until('!!document.querySelector(".card-review-empty")');history=await api('practiceHistory',recall);check('退出后的原调度记录与试用原始评分可共同查看',history.length===2&&history.some(h=>h.fsrs?.grade===2)&&history.some(h=>h.fsrs===null&&h.rating===2));
 other=await api('practiceGet',choice);await api('practiceState',{id:choice,expectedRevision:other.revision,action:'enroll'});await manager(choice,'Choose the trial answer.');await enable();
 await route('#/review?tab=cards',"document.querySelector('.practice-review-question h2')?.textContent==='Choose the trial answer.'");await cdp.js("document.querySelector('.practice-review-question input[value=B]').click()");await click('查看卡片答案');check('客观题选错时只有没想起可评分',await cdp.js("[...document.querySelectorAll('.fsrs-ratings button')].every((b,i)=>b.disabled===(i!==0))"));await grade('没想起');check('客观错误和原始失败等级同时保存',(await api('practiceHistory',choice))[0].correct===false&&(await api('practiceHistory',choice))[0].fsrs.grade===1);
 cdp.close();cdp=null;await stopChild(child);await launch();await manager(recall,'Relearn the trial rule.');check('重启保留退出状态和两种评分历史',(await api('practiceGet',recall)).trial.phase==='legacy'&&(await api('practiceHistory',recall)).length===2);await manager(choice,'Choose the trial answer.');check('重启保留另一张卡试用、参数及原始评分',(await api('practiceGet',choice)).trial.phase==='fsrs'&&(await api('practiceGet',choice)).trial.retention===0.9&&(await api('practiceHistory',choice))[0].fsrs.grade===1);
 console.log(`FSRS 试用真实界面 ${passed}/${passed} 通过；真实备份仅位于隔离临时目录，无模型调用。`);
}catch(e){console.error(e);if(cdp)console.error(await cdp.js("({hash:location.hash,alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent),text:document.body.innerText.slice(-2500)})").catch(()=>null));process.exitCode=1;}
finally{cdp?.close();try{await stopChild(child);session.cleanup();}catch(e){console.error(e);process.exitCode=1;}}

// 真实高亮、共享统计与到期定时器验收；不改设备时间或真实用户库。
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import initSqlJs from 'sql.js';
import {createTestSession,availablePort,waitForPage,connectCdp,stopChild} from './lib/test-session.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),session=createTestSession('learning');
let child,cdp,passed=0;
const check=(name,ok)=>{if(!ok)throw Error(name);passed++;console.log('✓ '+name);};
async function until(code){const end=Date.now()+15000;while(Date.now()<end){if(await cdp.js(code))return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('等待超时: '+code);}
const token=(word,cls)=>`[...document.querySelectorAll('.article .w')].some(e=>e.textContent===${JSON.stringify(word)} && e.classList.contains(${JSON.stringify(cls)}))`;
try{
 const SQL=await initSqlJs({locateFile:f=>path.join(root,'node_modules/sql.js/dist',f)}),db=new SQL.Database(new Uint8Array(fs.readFileSync(path.join(root,'data/keeper.db'))));
 const start=Date.now();
 db.run("INSERT INTO user_word(word,status,due) VALUES ('clockcase','learning',?),('futurecase','learning',?)",[new Date(start-60000).toISOString(),new Date(start+8000).toISOString()]);
 fs.writeFileSync(path.join(session.dir,'keeper.db'),Buffer.from(db.export()));db.close();
 const port=await availablePort();child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),['.',`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu'],{cwd:root,env:session.env,stdio:'ignore'});
 cdp=await connectCdp(await waitForPage(port,child));
 await until(`document.querySelector('.due-badge')?.textContent==='1' && document.querySelector('.stat-box.due .num')?.textContent==='1'`);
 check('首页与侧栏初始读取同一待复习数',true);
 await cdp.js(`window.keeper.setWordStatus('clockcase','mastered')`);
 await until(`!document.querySelector('.due-badge') && document.querySelector('.stat-box.due .num')?.textContent==='0'`);
 check('原地改状态后首页和侧栏同步刷新',true);
 await until(`document.querySelector('.due-badge')?.textContent==='1' && document.querySelector('.stat-box.due .num')?.textContent==='1'`);
 check('未来词到期后不切页也会更新徽标',true);
 await cdp.js(`window.keeper.reviewAnswer('futurecase',2,'learning-fixture-review')`);
 await until(`!document.querySelector('.due-badge') && document.querySelectorAll('.stat-box .num')[3]?.textContent==='1'`);
 check('复习保存后待复习数与今日数立即更新',true);
 const before=await cdp.js('window.keeper.stats()');await cdp.js(`window.keeper.addWord('went','They went.',null)`);
 await until(`document.querySelectorAll('.stat-box .num')[1]?.textContent===${JSON.stringify(String(before.learning+1))}`);
 check('新增变形词后首页学习中数量更新',true);
 await cdp.js(`window.keeper.setWordStatus('go','mastered')`);
 const fixture={level:'CET4',year:2095,month:6,set_no:1,passages:[
  {section:'reading',seq:1,content:'They went running and were making plans. Children don’t stop. Irrefutable risky bystanders avoid diffusions.',translation:'他们去跑步并在制定计划。孩子们不会停下来。无可辩驳的冒险旁观者避免扩散。'},
  {section:'reading',seq:2,content:'She went making decisions while running.',translation:'她在跑步时做出决定。'},
 ]};
 const imported=await cdp.js(`window.keeper.importExam(${JSON.stringify(fixture)})`);check('导入词形高亮验收材料',imported.ok);
 await until(`document.querySelectorAll('.stat-box .num')[4]?.textContent===${JSON.stringify(String(before.exams+1))}`);
 check('导入后首页真题套数更新',true);
 await cdp.js(`location.hash='#/reader/${imported.examId}'`);await until(token('went','mastered'));
 check('不规则 went 按 go 的已掌握状态高亮',true);
 await cdp.js(`[...document.querySelectorAll('.article .w')].find(e=>e.textContent==='running').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
 await until(token('running','marked'));const words=await cdp.js('window.keeper.allWords()');
 check('双击 running 以 run 入库并在原文标黄',words.run==='learning'&&!Object.hasOwn(words,'running'));
 await cdp.js(`window.keeper.setWordStatus('run','mastered')`);await until(token('running','mastered'));
 check('外部状态变更事件立即刷新阅读器高亮',true);
 await cdp.js(`[...document.querySelectorAll('.article .w')].find(e=>e.textContent==='running').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
 await until(`document.querySelector('.toast')?.textContent.includes('已在生词本')`);
 check('重复收藏已掌握的变形词不会错误变黄',await cdp.js(token('running','mastered')));
 await cdp.js(`window.keeper.addWord('DON’T','Children don’t stop.',null)`);await until(token('don’t','marked'));
 check('曲引号缩写按后端词形高亮',true);
 const raws=['Irrefutable','risky','bystanders','diffusions'];
 const mapping=await cdp.js(`window.keeper.resolveWords(${JSON.stringify(raws)})`),hard=await cdp.js(`window.keeper.scanHard(${JSON.stringify(fixture.passages[0].content)},'CET4')`);
 const raw=raws.find(w=>hard.some(h=>h.word===mapping[w]));check('验收材料包含可识别的难词',!!raw);
 await cdp.js(`document.querySelector('.tb-actions input[type=checkbox]').click()`);await until(token(raw,'hard'));
 check('难词高亮也使用后端词形结果',true);
 await cdp.js(`document.querySelectorAll('.section-tabs button')[1].click()`);await until(token('running','mastered'));
 check('切换篇章复用正确词形映射',true);
 await cdp.js(`[...document.querySelectorAll('.tb-modes button')].find(b=>b.textContent==='逐句对照').click()`);await until(`!!document.querySelector('.bi-en') && ${token('running','mastered')}`);
 check('逐句对照模式保持相同高亮',true);
 await cdp.js(`window.keeper.removeWord('go')`);await until(`![...document.querySelectorAll('.article .w')].some(e=>e.textContent==='went' && e.classList.contains('marked'))`);
 check('删除原形后变形词高亮立即消失',true);
 await cdp.js(`location.hash='#/'`);await until(`!!document.querySelector('.stat-row')`);
 const final=await cdp.js('window.keeper.stats()');
 check('回首页仍显示共享统计的最新快照',await cdp.js(`document.querySelectorAll('.stat-box .num')[1]?.textContent===${JSON.stringify(String(final.learning))}`));
 console.log(`词形与统计界面回归 ${passed}/${passed} 通过`);
}catch(error){console.error(error);process.exitCode=1;}
finally{cdp?.close();try{await stopChild(child);session.cleanup();}catch(error){console.error(error);process.exitCode=1;}}

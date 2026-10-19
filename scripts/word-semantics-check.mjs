// 真实 Electron / Vue 卡片与算法版本迁移；全部使用随机独占 userData。
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import initSqlJs from 'sql.js';
import {createTestSession,availablePort,waitForPage,connectCdp,stopChild} from './lib/test-session.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),session=createTestSession('word-semantics');
const userDb=path.join(session.dir,'keeper.db');let child,cdp,passed=0;
const check=(name,ok)=>{if(!ok)throw Error(name);passed++;console.log('✓ '+name);};
async function until(code){const end=Date.now()+15000;while(Date.now()<end){if(await cdp.js(code))return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('等待超时: '+code);}
async function start(){const port=await availablePort();child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),['.',`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu'],{cwd:root,env:session.env,stdio:'ignore'});cdp=await connectCdp(await waitForPage(port,child));await until('!!window.keeper && !!document.querySelector(".logo")');}
async function stop(){cdp?.close();cdp=null;await stopChild(child);child=null;}
try{
 const SQL=await initSqlJs({locateFile:file=>path.join(root,'node_modules/sql.js/dist',file)}),db=new SQL.Database(new Uint8Array(fs.readFileSync(path.join(root,'data/keeper.db'))));
 db.run("DELETE FROM content_sync_state WHERE source='word-frequency'");
 for(const [i,word,sentence] of [[1,'art','Art, partial and ART. <img src=x onerror="window.contextInjected=1">'],[2,'run','RUNNING runners run.'],[3,'go','They went home.'],[4,'orphanfixture','This sentence has no target.']]){
  db.run("INSERT INTO user_word(word,status,note,created_at) VALUES (?,'learning',?,?)",[word,'preserve-'+word,`2026-10-19T00:00:0${i}Z`]);db.run('INSERT INTO word_hit(word,sentence) VALUES (?,?)',[word,sentence]);
 }
 const original=Buffer.from(db.export());db.close();fs.writeFileSync(userDb,original);await start();
 const info=await cdp.js('window.keeper.info()');check('旧库执行频率版本迁移并保留原字节备份',info.contentSync.frequencyChanged&&fs.readFileSync(info.contentSync.backupPath).equals(original));
 const queue=await cdp.js('window.keeper.reviewQueue()'),cards=[...queue.due,...queue.fresh];
 check('真实 IPC 对规则、不规则和缺失目标返回正确卡片',cards.find(card=>card.word==='go').clozeHtml.includes('>went</span>')&&cards.find(card=>card.word==='orphanfixture').clozeHtml==='');
 await cdp.js(`location.hash='#/review'`);await until('!!document.querySelector(".review-wrap input[type=checkbox]") && !document.querySelector(".review-wrap button.primary").disabled');
 await cdp.js('document.querySelector(".review-wrap input[type=checkbox]").click();document.querySelector(".review-wrap button.primary").click()');await until('!!document.querySelector(".review-card .rw")');
 check('无目标旧出处在语境模式中回退普通词卡',await cdp.js('document.querySelector(".review-card .rw").textContent.trim()==="orphanfixture" && !document.querySelector(".blank")'));
 await cdp.js('document.querySelector(".review-card").click()');await until('!!document.querySelector(".rate-got")');await cdp.js('document.querySelector(".rate-got").click()');await until('document.querySelector(".blank")?.textContent==="went"');check('不规则 went 原样挖空',true);
 await cdp.js('document.querySelector(".review-card").click()');await until('!!document.querySelector(".rate-got")');check('翻面保留原始句子和收藏原形',await cdp.js('document.querySelector(".review-card .rw").textContent.includes("go") && document.querySelector(".review-card .rctx").textContent==="They went home."'));
 await cdp.js('document.querySelector(".rate-got").click()');await until('document.querySelector(".blank")?.textContent==="RUNNING"');
 check('多个同原形位置挖空，runner 独立词不受影响',await cdp.js('document.querySelectorAll(".blank").length===2 && document.querySelector(".rctx").textContent==="RUNNING runners run."'));
 await cdp.js('document.querySelector(".review-card").click()');await until('!!document.querySelector(".rate-got")');await cdp.js('document.querySelector(".rate-got").click()');await until('document.querySelector(".blank")?.textContent==="Art"');
 check('art 不遮住 partial，原句标签作为文字显示',await cdp.js('document.querySelectorAll(".blank").length===2 && document.querySelector(".rctx").textContent.includes("partial") && !document.querySelector(".rctx img") && !window.contextInjected'));
 const before=(await cdp.js(`window.keeper.lookup('run')`)).freq;
 const fixture={level:'CET4',year:2096,month:6,set_no:1,passages:[{section:'reading',seq:1,content:'RUNNING run runs running; runners.',questions:[{stem:'46',options:['A) yes','B) no'],answer:'A'}]}]};
 check('真实导入成功', (await cdp.js(`window.keeper.importExam(${JSON.stringify(fixture)})`)).ok===true);
 const after=(await cdp.js(`window.keeper.lookup('run')`)).freq;check('新增同篇多个词形只增加一篇和一套',after.total===before.total+1&&after.exams===before.exams+1);
 const output=path.join(session.dir,'anki.txt');await cdp.js(`window.keeper.exportAnki({search:'art',targetPath:${JSON.stringify(output)}})`);
 const anki=fs.readFileSync(output,'utf8');check('Anki 同步准确标记并转义原句 HTML',anki.includes('<b>Art</b>, partial and <b>ART</b>. &lt;img')&&!anki.includes('<img'));
 check('学习笔记保留', (await cdp.js(`window.keeper.wordDetail('run')`)).userWord.note==='preserve-run');
 const saved=fs.readFileSync(userDb),hash=createHash('sha256').update(saved).digest('hex');await stop();await start();
 const restarted=await cdp.js('window.keeper.info()');check('再次启动不重算词频、不创建重复迁移',restarted.contentSync.frequencyChanged===false&&restarted.contentSync.backupPath===null);
 check('重复启动不重写数据库',createHash('sha256').update(fs.readFileSync(userDb)).digest('hex')===hash);
 check('重启后导入频率结果不变',JSON.stringify((await cdp.js(`window.keeper.lookup('run')`)).freq)===JSON.stringify(after));
 console.log(`\n真实词形语境/词频 ${passed}/${passed}`);
}finally{await stop();session.cleanup();}

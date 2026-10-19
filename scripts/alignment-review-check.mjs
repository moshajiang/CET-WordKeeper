// 以五篇旧句对构造旧库，验证真实迁移、阅读/背诵内容与重启幂等。
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import initSqlJs from 'sql.js';
import contentSync from '../electron/content-sync.cjs';
import {createTestSession,availablePort,waitForPage,connectCdp,stopChild} from './lib/test-session.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),session=createTestSession('alignment-review'),userDb=path.join(session.dir,'keeper.db');
let child,cdp,passed=0;const check=(name,ok)=>{if(!ok)throw Error(name);passed++;console.log('✓ '+name);};
async function until(code){const end=Date.now()+15000;while(Date.now()<end){if(await cdp.js(code))return;await new Promise(resolve=>setTimeout(resolve,40));}throw Error('等待超时: '+code);}
async function start(){const port=await availablePort();child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),['.',`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu'],{cwd:root,env:session.env,stdio:'ignore'});cdp=await connectCdp(await waitForPage(port,child));}
async function stop(){cdp?.close();cdp=null;await stopChild(child);child=null;}
const query=(db,sql,args=[])=>{const stmt=db.prepare(sql);try{stmt.bind(args);const out=[];while(stmt.step())out.push(stmt.getAsObject());return out;}finally{stmt.free();}};
try{
 const SQL=await initSqlJs({locateFile:file=>path.join(root,'node_modules/sql.js/dist',file)}),db=new SQL.Database(new Uint8Array(fs.readFileSync(path.join(root,'data/keeper.db'))));
 const baseline=JSON.parse(fs.readFileSync(path.join(root,'scripts/fixtures/alignment-before-phase4j.json')));
 const expected=baseline.map(({id})=>query(db,'SELECT id,exam_id,rows FROM passage WHERE id=?',[id])[0]);
 db.run(fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8').match(/const SCHEMA = `([\s\S]*?)`;/)[1]);
 for(const row of baseline)db.run('UPDATE passage SET rows=? WHERE id=?',[JSON.stringify(row.rows),row.id]);contentSync.stampBuiltinContent(db);
 const examId=expected.find(row=>row.id===26).exam_id,revision=contentSync.assessmentRevision(db,examId),qid=query(db,'SELECT id FROM question WHERE passage_id=26 ORDER BY id LIMIT 1')[0].id;
 db.run("INSERT INTO user_word(word,status,note) VALUES ('run','mastered','保留对齐迁移笔记')");db.run("INSERT INTO word_hit(word,passage_id,sentence) VALUES ('run',26,'Keep learning source.')");
 db.run('INSERT INTO attempt(exam_id,total,correct,score,detail,content_revision) VALUES (?,1,1,100,?,?)',[examId,'[]',revision]);db.run('INSERT INTO user_answer(exam_id,question_id,choice,is_correct) VALUES (?,?,?,1)',[examId,qid,'A']);
 const original=Buffer.from(db.export());db.close();fs.writeFileSync(userDb,original);await start();
 const info=await cdp.js('window.keeper.info()');check('旧句对通过真实启动迁移且原字节完整备份',info.contentSync.status==='ok'&&info.contentSync.changed&&fs.readFileSync(info.contentSync.backupPath).equals(original));
 for(const row of expected){const current=await cdp.js(`window.keeper.examDetail(${row.exam_id})`);check('篇章 '+row.id+' 使用复核后句对且ID不变',JSON.stringify(current.passages.find(p=>p.id===row.id).rows)===JSON.stringify(JSON.parse(row.rows)));}
 const attempt=await cdp.js(`window.keeper.attemptGet(${examId})`);check('仅展示句对更新不使旧成绩过期或改写作答',attempt.contentChanged===false&&attempt.attempt.score===100&&attempt.answers.some(a=>a.question_id===qid&&a.choice==='A'));
 const word=await cdp.js(`window.keeper.wordDetail('run')`);check('生词掌握状态、笔记与出处关联保持',word.userWord.status==='mastered'&&word.userWord.note==='保留对齐迁移笔记'&&word.hits[0].passage_id===26);
 await cdp.js(`location.hash='#/reader/${examId}?passage=26'`);await until(`!!document.querySelector('.reader-topbar')`);await cdp.js(`[...document.querySelectorAll('.tb-modes button')].find(b=>b.textContent==='逐句对照').click()`);await until(`!!document.querySelector('.bi-en')`);
 check('阅读器150年原句对应150年译文',await cdp.js(`[...document.querySelectorAll('.bi-row')].some(e=>e.querySelector('.bi-en')?.textContent.includes('gathered 150')&&e.querySelector('.bi-zh')?.textContent.includes('150 年'))`));
 const nuclear=expected.find(row=>row.id===424);await cdp.js(`location.hash='#/recite/${nuclear.exam_id}?passage=424'`);await until(`!!document.querySelector('.recite-actions')`);await cdp.js(`[...document.querySelectorAll('.recite-actions button')].find(b=>b.textContent==='全文显示').click()`);await until(`document.querySelectorAll('.recite-line').length===12`);
 check('背诵使用复核的12个核能句对并仍按单语种呈现',await cdp.js(`document.querySelectorAll('.recite-txt').length===12 && [...document.querySelectorAll('.recite-txt')].every(e=>e.classList.contains('zh')) && !document.querySelectorAll('.recite-txt')[3].textContent.includes('可行性') && document.querySelectorAll('.recite-txt')[4].textContent.includes('可行性')`));
 const bytes=fs.readFileSync(userDb),hash=createHash('sha256').update(bytes).digest('hex');await stop();await start();const restarted=await cdp.js('window.keeper.info()');check('重复启动不重复迁移或创建备份',restarted.contentSync.changed===false&&restarted.contentSync.backupPath===null);check('重复启动数据库字节保持一致',createHash('sha256').update(fs.readFileSync(userDb)).digest('hex')===hash);
 console.log(`对齐复核真实迁移/界面 ${passed}/${passed}`);
}finally{await stop();session.cleanup();}

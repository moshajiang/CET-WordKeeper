// Real Electron startup/restore tests. Only this session's temporary userData is written.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import initSqlJs from 'sql.js';
import {createRestoreStore} from '../electron/storage.cjs';
import {createTestSession,availablePort,waitForPage,connectCdp,stopChild} from './lib/test-session.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),session=createTestSession('storage');
const schema=fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8').match(/const SCHEMA = `([\s\S]*?)`;/)[1];
let child,cdp,passed=0;
const check=(name,ok)=>{if(!ok)throw Error(name);passed++;console.log('✓ '+name);};
async function boot(){const port=await availablePort();child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),['.',`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu'],{cwd:root,env:session.env,stdio:'ignore'});cdp=await connectCdp(await waitForPage(port,child));}
async function stop(){
 if(cdp)await cdp.js('window.close()').catch(()=>{});
 const end=Date.now()+10000;while(child && child.exitCode===null && !child.signalCode && Date.now()<end)await new Promise(r=>setTimeout(r,50));
 cdp?.close();cdp=null;await stopChild(child);child=null;
}
async function until(code){const end=Date.now()+10000;while(Date.now()<end){if(await cdp.js(code))return;await new Promise(r=>setTimeout(r,50));}throw Error('等待超时：'+code);}
try{
 const SQL=await initSqlJs({locateFile:f=>path.join(root,'node_modules/sql.js/dist',f)});
 await boot();await cdp.js("window.keeper.addWord('restorefixture','first context',null)");await cdp.js("window.keeper.setSettings({api_key:'fixture-backup',api_model:'fixture-model'})");
 const exams=await cdp.js('window.keeper.listExams()'),examId=exams[0].id,detail=await cdp.js(`window.keeper.examDetail(${examId})`),question=detail.passages.filter(p=>['cloze','match','reading'].includes(p.section)).flatMap(p=>p.questions)[0];
 const draft=await cdp.js(`window.keeper.attemptGet(${examId})`);
 await cdp.js(`window.keeper.attemptSaveDraft(${examId},${JSON.stringify({revision:draft.revision,generation:draft.generation,answers:{[question.id]:'A'}})})`);
 await cdp.js(`window.keeper.essaySave(${examId},'writing','Backup essay fixture.')`);
 await cdp.js("window.keeper.saveNote('restorefixture','Backup note fixture.')");
 await cdp.js("window.keeper.reviewAnswer('restorefixture',2,'backup-review-fixture')");
 const backup=path.join(session.dir,'chosen-backup.db');const exported=await cdp.js(`window.keeper.backupExport(${JSON.stringify(backup)})`);
 check('实际 IPC 导出独立备份并通过完整性校验',exported.ok&&fs.existsSync(backup));
 const before=Buffer.from(fs.readFileSync(path.join(session.dir,'keeper.db')));
 check('备份不能覆盖当前数据库',await cdp.js(`window.keeper.backupExport(${JSON.stringify(path.join(session.dir,'keeper.db'))}).then(()=>false,()=>true)`));
 check('被拒绝的备份没有改写当前数据库',fs.readFileSync(path.join(session.dir,'keeper.db')).equals(before));
 await cdp.js("window.keeper.addWord('laterfixture','later',null)");await cdp.js("window.keeper.setSettings({api_key:'fixture-current'})");
 await cdp.js("localStorage.setItem('keeper.answer.draft:1','stale');localStorage.setItem('keeper.essay.draft:1:writing','stale');localStorage.setItem('keeper.reader.progress','stale');localStorage.setItem('keeper.lastReading','1');localStorage.setItem('keeper.theme','dark')");
 await cdp.js("location.hash='#/settings'");await until("document.body.innerText.includes('选择备份恢复…')");check('设置页提供备份恢复入口和配置敏感信息提示',await cdp.js("document.body.innerText.includes('含 Key') && document.body.innerText.includes('恢复会替换当前数据')"));
 await stop();
 const live=path.join(session.dir,'keeper.db'),previous=Buffer.from(fs.readFileSync(live));
 let store=createRestoreStore({directory:session.dir,SQL,schema}),preview=store.preview(fs.readFileSync(backup),backup),queued=store.queue(preview.token,previous);
 check('恢复排队阶段当前库未被替换，恢复前备份逐字节保真',fs.readFileSync(live).equals(previous)&&fs.readFileSync(queued.backupPath).equals(previous));
 await boot();
 let words=await cdp.js('window.keeper.allWords()'),info=await cdp.js('window.keeper.info()');
 check('真实进程启动恢复选中的生词和 AI 配置',!!words.restorefixture&&!words.laterfixture&&(await cdp.js('window.keeper.getSettings()')).api_key==='fixture-backup');
 const restoredDraft=await cdp.js(`window.keeper.attemptGet(${examId})`),restoredEssay=await cdp.js(`window.keeper.essayGet(${examId},'writing')`),restoredWord=await cdp.js("window.keeper.wordDetail('restorefixture')");
 check('恢复保留数据库草稿、作文、笔记、出处与复习记录',restoredDraft.draft?.answers[question.id]==='A'&&restoredEssay.content==='Backup essay fixture.'&&restoredWord.userWord.note==='Backup note fixture.'&&restoredWord.hits[0].sentence==='first context'&&restoredWord.logs.length===1);
 check('成功恢复公布新 epoch 和恢复前备份位置',info.restore.status==='restored'&&info.restore.epoch===preview.token&&info.restore.backupPath===queued.backupPath);

 check('应用挂载前清理旧草稿与阅读进度，保留主题',await cdp.js("localStorage.getItem('keeper.answer.draft:1')===null&&localStorage.getItem('keeper.essay.draft:1:writing')===null&&localStorage.getItem('keeper.lastReading')===null&&localStorage.getItem('keeper.reader.progress')===null&&localStorage.getItem('keeper.theme')==='dark'"));
 await cdp.js("location.hash='#/settings'");await until("document.body.innerText.includes('已恢复备份')");check('设置页显示恢复成功及回退备份',await cdp.js(`document.body.innerText.includes(${JSON.stringify(queued.backupPath)})`));
 await cdp.js("window.keeper.addWord('afterrestorefixture','new',null)");await stop();await boot();check('后续重启不重复恢复、保留恢复后的新学习记录',!!(await cdp.js('window.keeper.allWords()')).afterrestorefixture);await stop();
 store=createRestoreStore({directory:session.dir,SQL,schema});preview=store.preview(fs.readFileSync(backup),backup);const current=Buffer.from(fs.readFileSync(live));queued=store.queue(preview.token,current);fs.writeFileSync(path.join(session.dir,`restore-${preview.token}.db`),'corrupt');await boot();
 check('坏候选的真实启动自动回退，已有学习记录保留',!!(await cdp.js('window.keeper.allWords()')).afterrestorefixture&&(await cdp.js('window.keeper.info()')).restore.status==='failed');
 await cdp.js("location.hash='#/settings'");await until("document.body.innerText.includes('已退回恢复前数据')");check('失败状态和恢复前备份在界面可见',await cdp.js(`document.body.innerText.includes(${JSON.stringify(queued.backupPath)})`));await stop();
 store=createRestoreStore({directory:session.dir,SQL,schema});preview=store.preview(fs.readFileSync(backup),backup);store.queue(preview.token,Buffer.from(fs.readFileSync(live)));store.begin();await boot();check('应用在替换后异常退出，下一进程保守回退原数据',!!(await cdp.js('window.keeper.allWords()')).afterrestorefixture&&(await cdp.js('window.keeper.info()')).restore.error.includes('中断'));
 console.log(`存储真实重启回归 ${passed}/${passed} 通过`);
}catch(error){console.error(error);process.exitCode=1;}
finally{cdp?.close();try{await stopChild(child);session.cleanup();}catch(error){console.error(error);process.exitCode=1;}}

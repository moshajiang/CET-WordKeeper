// 真实控件 + 两次 Electron 启动，所有数据使用独占临时 userData。
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTestSession,availablePort,waitForPage,connectCdp,stopChild} from './lib/test-session.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const session=createTestSession('draft-restart');
let child,cdp,passed=0;
const check=(name,ok)=>{if(!ok)throw Error(name);passed++;console.log('✓ '+name);};
async function boot(){
 const port=await availablePort();child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),['.',`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu'],{cwd:root,env:session.env,stdio:'ignore'});
 cdp=await connectCdp(await waitForPage(port,child));
}
async function until(expression){
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){if(await cdp.js(expression))return;await new Promise(resolve=>setTimeout(resolve,50));}
 throw Error('等待超时: '+expression);
}
try{
 await boot();
 const fixture={level:'CET4',year:2094,month:6,set_no:1,passages:[
  {section:'reading',seq:1,content:'Reading article.',translation:'阅读文章。',questions:[{stem:'46. Pick one',options:['A) first','B) second'],answer:'B',analysis:'解析'}]},
  {section:'cloze',seq:2,content:'Fill 26 here.',translation:'填写此处。',questions:[{stem:'26',qtype:'cloze',options:['A) first','B) second'],answer:'A',analysis:'解析'}]},
  {section:'match',seq:3,content:'[A] First paragraph. [B] Second paragraph.',translation:'[A] 第一段。[B] 第二段。',questions:[{stem:'36. Match it',qtype:'match',options:['A','B'],answer:'B',analysis:'解析'}]},
 ]};
 const a=await cdp.js(`window.keeper.importExam(${JSON.stringify(fixture)})`);fixture.set_no=2;
 const b=await cdp.js(`window.keeper.importExam(${JSON.stringify(fixture)})`);
 check('导入两套隔离草稿测试材料',a.ok&&b.ok);
 const detail=await cdp.js(`window.keeper.examDetail(${a.examId})`);
 const qs=detail.passages.flatMap(p=>p.questions);
 const enter=async id=>{await cdp.js(`location.hash='#/reader/${id}'`);await until(`!!document.querySelector('.reader-topbar') && ![...document.querySelectorAll('.tb-actions button')].find(b=>b.textContent==='交卷核对')?.disabled`);};
 await enter(a.examId);
 await cdp.js(`document.querySelectorAll('.qopt.pick')[1].click();location.hash='#/reader/${b.examId}'`);
 await until(`document.querySelectorAll('.qopt.picked').length===0 && ![...document.querySelectorAll('.tb-actions button')].find(b=>b.textContent==='交卷核对')?.disabled`);
 const savedA=await cdp.js(`window.keeper.attemptGet(${a.examId})`);
 check('点选后立即切卷也保存旧卷草稿',savedA.draft?.answers[qs[0].id]==='B'&&!savedA.attempt);
 check('新试卷没有继承上一卷选项',await cdp.js(`document.querySelectorAll('.qopt.picked').length===0`));
 await enter(a.examId);await until(`document.querySelector('.qopt.picked')?.textContent.includes('second')`);
 check('返回旧卷恢复选择且仍可编辑',await cdp.js(`document.querySelectorAll('.qmark').length===0`));
 await cdp.js(`document.querySelectorAll('.section-tabs button')[1].click()`);
 await until(`!!document.querySelector('.qblock select')`);
 await cdp.js(`(()=>{const s=document.querySelector('.qblock select');s.value='A';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await until(`(async()=>{const r=await window.keeper.attemptGet(${a.examId});return r.draft?.answers[${qs[1].id}]==='A';})()`);
 await cdp.js(`document.querySelectorAll('.section-tabs button')[2].click()`);await until(`!!document.querySelector('.letter-row')`);
 await cdp.js(`[...document.querySelectorAll('.letter-row .qopt')].find(e=>e.textContent.trim()==='B').click()`);
 await until(`(async()=>{const r=await window.keeper.attemptGet(${a.examId});return r.draft?.answers[${qs[2].id}]==='B';})()`);
 check('填空与段落匹配控件都保存草稿',true);
 // 已保存到磁盘后结束进程，验证应用重启恢复，而不是组件内状态延续。
 cdp.close();cdp=null;await stopChild(child);child=null;await boot();await enter(a.examId);
 const restarted=await cdp.js(`window.keeper.attemptGet(${a.examId})`);
 check('进程重启保留三类作答且未生成成绩',Object.keys(restarted.draft?.answers||{}).length===3&&!restarted.attempt);
 await cdp.js(`document.querySelectorAll('.section-tabs button')[2].click()`);
 await until(`document.querySelector('.letter-row .picked')?.textContent.trim()==='B'`);
 check('重启后的匹配题控件恢复选择',await cdp.js(`document.querySelector('.letter-row .picked')?.textContent.trim()==='B'`));
 await cdp.js(`document.querySelectorAll('.section-tabs button')[1].click()`);await until(`!!document.querySelector('.qblock select')`);
 check('重启后填空选择可读回',await cdp.js(`document.querySelector('.qblock select').value==='A'`));
 await cdp.js(`(()=>{const s=document.querySelector('.qblock select');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));location.hash='#/knowledge';})()`);
 await until(`(async()=>{const r=await window.keeper.attemptGet(${a.examId});return r.draft && !r.draft.answers[${qs[1].id}];})()`);
 check('清空下拉选项也能保存',true);
 // 模拟关闭发生在防抖写盘之前，本地副本比数据库更新。
 const recover={examId:a.examId,revision:restarted.revision,generation:restarted.generation,answers:{[qs[0].id]:'A'}};
 await cdp.js(`localStorage.setItem('keeper.answer.draft:${a.examId}',${JSON.stringify(JSON.stringify(recover))})`);
 await enter(a.examId);await until(`(async()=>{const r=await window.keeper.attemptGet(${a.examId});return r.draft?.answers[${qs[0].id}]==='A' && localStorage.getItem('keeper.answer.draft:${a.examId}')===null;})()`);
 check('未写盘副本恢复后落库，成功才清理副本',true);
 await cdp.js(`[...document.querySelectorAll('.tb-actions button')].find(b=>b.textContent==='交卷核对').click()`);
 await until(`document.body.innerText.includes('已交卷：')`);
 const graded=await cdp.js(`window.keeper.attemptGet(${a.examId})`);
 check('交卷后只有正式成绩，草稿已清理',!!graded.attempt&&!graded.draft&&graded.generation>restarted.generation);
 await cdp.js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='重做本套').click()`);
 await until(`!document.body.innerText.includes('得分 ') && !document.querySelector('.qmark')`);
 const cleared=await cdp.js(`window.keeper.attemptGet(${a.examId})`);
 check('重做同时清理作答、成绩和草稿',!cleared.attempt&&!cleared.draft&&cleared.answers.length===0);
 await cdp.js(`localStorage.setItem('keeper.answer.draft:${a.examId}',${JSON.stringify(JSON.stringify(recover))});location.hash='#/knowledge'`);
 await until(`!document.querySelector('.reader-topbar')`);await enter(a.examId);
 check('旧代次恢复副本不能使重做前答案复活',await cdp.js(`document.querySelectorAll('.picked').length===0 && !document.querySelector('.qblock select')?.value`));
 // 正常关闭发生在 500ms 防抖之前：窗口关闭触发 flush，重启后可以继续作答。
 await cdp.js(`document.querySelectorAll('.section-tabs button')[0].click()`);await until(`!!document.querySelector('.qopt.pick') && !document.querySelector('.letter-row')`);
 await cdp.js(`document.querySelectorAll('.qopt.pick')[1].click();setTimeout(()=>window.close(),20);true`);
 const deadline=Date.now()+8000;while(child.exitCode===null&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
 check('点选后正常关闭窗口可完成退出',child.exitCode!==null);
 cdp.close();cdp=null;child=null;await boot();await enter(a.examId);
 const afterClose=await cdp.js(`window.keeper.attemptGet(${a.examId})`);
 check('防抖前关闭再启动仍保留新作答',afterClose.draft?.answers[qs[0].id]==='B'&&!afterClose.attempt);
 console.log(`作答草稿重启回归 ${passed}/${passed} 通过`);
}catch(error){console.error(error);process.exitCode=1;}
finally{cdp?.close();try{await stopChild(child);session.cleanup();}catch(error){console.error(error);process.exitCode=1;}}

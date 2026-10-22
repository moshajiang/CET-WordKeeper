// Real controls and held local HTTP responses; no external AI or real userData.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTestSession,availablePort,waitForPage,connectCdp,stopChild} from './lib/test-session.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),session=createTestSession('ai-cancel');
let child,cdp,passed=0;const requests=[],sockets=new Set();
const check=(name,ok)=>{if(!ok)throw Error(name);passed++;console.log('✓ '+name);};
const server=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 const data=JSON.parse(body),prompt=data.messages[0].content;
 const kind=prompt.includes('CET exam translator')?'translate':prompt.includes('English grammar teacher')?'grammar':prompt==='Reply with OK.'?'probe':prompt.includes('资深阅卷老师')?'essay':prompt.includes('命题与解析专家')?'analysis':'chat';
 const record={kind,res,aborted:false,taken:false};requests.push(record);
 res.on('close',()=>{if(!res.writableEnded)record.aborted=true;});
});
server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
async function until(code){const end=Date.now()+10000;while(Date.now()<end){if(await cdp.js(code))return;await new Promise(r=>setTimeout(r,30));}throw Error('界面等待超时：'+code);}
async function take(kind){const end=Date.now()+10000;while(Date.now()<end){const record=requests.find(r=>r.kind===kind&&!r.taken);if(record){record.taken=true;return record;}await new Promise(r=>setTimeout(r,20));}throw Error('请求未到达本地服务：'+kind);}
async function aborted(record){const end=Date.now()+10000;while(!record.aborted&&Date.now()<end)await new Promise(r=>setTimeout(r,20));return record.aborted;}
function finish(record,content){if(record.res.destroyed)return;record.res.setHeader('Content-Type','application/json');record.res.end(JSON.stringify({choices:[{message:{content}}]}));}
const click=text=>`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})?.click()`;
const input=(selector,value)=>`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`;
async function enter(examId){await cdp.js(`location.hash='#/reader/${examId}'`);await until("!!document.querySelector('.reader-topbar') && ![...document.querySelectorAll('button')].find(b=>b.textContent==='交卷核对')?.disabled");}
async function select(action){
 await cdp.js("(()=>{const el=document.querySelector('.article');const range=document.createRange();range.selectNodeContents(el);const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:300,clientY:300}));})()");
 await until("!!document.querySelector('.selmenu')");await cdp.js(`[...document.querySelectorAll('.selmenu button')].find(b=>b.textContent.includes(${JSON.stringify(action)})).click();window.getSelection().removeAllRanges()`);
}
async function openChat(){if(!await cdp.js("!!document.querySelector('.assistant-panel')"))await cdp.js(click('💬 问 AI'));await until("!!document.querySelector('.chat-input-row textarea')");}
async function send(text){await cdp.js(input('.chat-input-row textarea',text));await cdp.js(click('发送'));return take('chat');}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/v1`;
 const port=await availablePort();child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),['.',`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu'],{cwd:root,env:session.env,stdio:'ignore'});cdp=await connectCdp(await waitForPage(port,child));
 await cdp.js(`window.keeper.setSettings({api_base:${JSON.stringify(base)},api_key:'fixture-only',api_model:'fixture'})`);
 const fixture={level:'CET4',year:2096,month:6,set_no:1,passages:[
  {section:'reading',seq:1,content:'Alpha readers understand this sentence clearly.',translation:'读者理解句子。',questions:[{stem:'46',options:['A) first','B) second'],answer:'A',analysis:'解析'}]},
  {section:'reading',seq:2,content:'Beta readers understand another sentence.',translation:'读者理解另一句。',questions:[{stem:'51',options:['A) first','B) second'],answer:'A',analysis:'解析'}]},
  {section:'writing',seq:3,content:'Write an essay about learning.'},
 ]};
 const imported=await cdp.js(`window.keeper.importExam(${JSON.stringify(fixture)})`);check('导入取消测试材料',imported.ok);await enter(imported.examId);
 await select('整句翻译');const oldTranslation=await take('translate');await select('语法分析');const grammar=await take('grammar');check('新语法请求主动中止旧翻译的真实 HTTP 连接',await aborted(oldTranslation));finish(grammar,'Fresh grammar fixture.');await until("document.querySelector('.ai-result')?.textContent.includes('Fresh grammar fixture.')");finish(oldTranslation,'Old translation fixture.');check('旧翻译不会覆盖新语法结果',await cdp.js("!document.body.innerText.includes('Old translation fixture.')"));
 await select('整句翻译');const stopped=await take('translate');await cdp.js(click('取消请求'));check('取消整句请求会中止真实连接并恢复界面',await aborted(stopped));await until("document.querySelector('.ai-result')?.textContent.includes('已取消')");
 await select('整句翻译');const switched=await take('translate');await cdp.js("document.querySelectorAll('.section-tabs button')[1].click()");check('切篇中止原篇章的请求',await aborted(switched));check('切篇后不显示原篇章 AI 卡片',await cdp.js("!document.querySelector('.ai-result')"));
 await openChat();await until("!!document.querySelector('.chat-input-row textarea')");const initial=await send('Initial saved question.');finish(initial,'Initial saved answer.');await until("document.querySelector('.chat-msgs')?.textContent.includes('Initial saved answer.')");
 const pending=await send('Clear while waiting.');await cdp.js("document.querySelector('button[title=清空历史]').click()");check('清空中止在途聊天的真实连接',await aborted(pending));await until("document.querySelectorAll('.chat-msg').length===0");check('清空后数据库和界面历史均为空',(await cdp.js('window.keeper.chatHistory()')).length===0);
 const fresh=await send('New question after clear.');finish(fresh,'New saved answer.');await until("document.querySelector('.chat-msgs')?.textContent.includes('New saved answer.')");check('清空后新请求正常完成且只保存新一对消息',(await cdp.js('window.keeper.chatHistory()')).length===2);
 const stop=await send('Retry this question.');await cdp.js(click('停止生成'));check('停止生成中止连接并保留问题供重试',await aborted(stop)&&await cdp.js("document.querySelector('.chat-input-row textarea').value==='Retry this question.'"));check('停止生成不添加历史记录',(await cdp.js('window.keeper.chatHistory()')).length===2);
 const leaving=await send('Leave during chat.');await cdp.js("location.hash='#/library'");check('离开阅读器中止聊天',await aborted(leaving));await enter(imported.examId);await openChat();await until("document.querySelector('.chat-msgs')?.textContent.includes('New saved answer.')");check('重新进入不会恢复取消的聊天',(await cdp.js('window.keeper.chatHistory()')).length===2);
 await cdp.js("document.querySelectorAll('.section-tabs button')[2].click()");await until("!!document.querySelector('.essay-input')&&!document.querySelector('.essay-input').disabled");await cdp.js(input('.essay-input','This is a sufficiently long essay fixture about learning and practice.'));await cdp.js(click('AI 批改'));const essay=await take('essay');await cdp.js(click('取消批改'));check('取消批改中止连接且保留未评分作文',await aborted(essay));check('取消批改不写评分结果',!(await cdp.js(`window.keeper.essayGet(${imported.examId},'writing')`)).result);
 await cdp.js("location.hash='#/settings'");await until(`document.querySelector('.settings-form input')?.value===${JSON.stringify(base)}`);await cdp.js(click('测试连接'));const probe=await take('probe');await cdp.js(input('.settings-form input:nth-of-type(3)','edited-model'));check('修改连接配置会中止旧测试请求',await aborted(probe));await cdp.js(click('测试连接'));const probe2=await take('probe');finish(probe2,'OK');await until("document.body.innerText.includes('连接成功')");check('新配置可以立即重新测试',true);await cdp.js(click('测试连接'));const probe3=await take('probe');await cdp.js(click('取消测试'));check('取消连接测试中止连接并恢复按钮',await aborted(probe3)&&await cdp.js("[...document.querySelectorAll('button')].some(b=>b.textContent==='测试连接'&&!b.disabled)"));
 const partial={level:'CET4',year:2096,month:6,set_no:2,passages:[{section:'reading',seq:1,content:'First incomplete reading.',questions:[{stem:'46',options:['A) first','B) second']}]},{section:'reading',seq:2,content:'Second incomplete reading.',questions:[{stem:'51',options:['A) first','B) second']}]}]};
 const part=await cdp.js(`window.keeper.importExam(${JSON.stringify(partial)})`);await enter(part.examId);const detail=await cdp.js(`window.keeper.examDetail(${part.examId})`),qid=detail.passages[0].questions[0].id;await cdp.js("document.querySelectorAll('.qopt.pick')[1].click()");await cdp.js(click('查看解析与翻译'));const first=await take('analysis');finish(first,JSON.stringify({translation:'已完成第一篇译文。',answers:[{n:46,answer:'A',analysis:'第一篇解析。'}]}));const second=await take('analysis');await cdp.js(click('取消处理'));check('取消整卷解析会中止当前篇章请求',await aborted(second));await until("document.body.innerText.includes('已取消，已保存的篇章结果仍保留。')");await until(`(async()=>{const s=await window.keeper.attemptGet(${part.examId});return s.draft?.answers[${qid}]==='B'&&!s.draftStale;})()`);
 const state=await cdp.js(`window.keeper.attemptGet(${part.examId})`),updated=await cdp.js(`window.keeper.examDetail(${part.examId})`);check('部分生成后保留已保存结果与当前作答、重绑定草稿版本',!!updated.passages[0].translation&&!updated.passages[1].translation&&state.draft.answers[qid]==='B'&&!state.attempt);
 await cdp.js(click('交卷核对'));const submit=await take('analysis');await cdp.js(click('取消处理'));check('取消交卷期间 AI 请求可中止连接',await aborted(submit));await until("![...document.querySelectorAll('button')].find(b=>b.textContent==='交卷核对').disabled");const canceledSubmit=await cdp.js(`window.keeper.attemptGet(${part.examId})`);check('取消交卷不产生成绩，未交卷作答保留',!canceledSubmit.attempt&&canceledSubmit.draft.answers[qid]==='B');
 partial.set_no=3;partial.passages[0].content='Leave after first generated reading.';partial.passages[1].content='Leave while second reading is pending.';
 const leavingPart=await cdp.js(`window.keeper.importExam(${JSON.stringify(partial)})`);await enter(leavingPart.examId);const leavingDetail=await cdp.js(`window.keeper.examDetail(${leavingPart.examId})`),leavingQid=leavingDetail.passages[0].questions[0].id;
 await cdp.js("document.querySelectorAll('.qopt.pick')[1].click()");await cdp.js(click('查看解析与翻译'));const generated=await take('analysis');finish(generated,JSON.stringify({translation:'离开前已保存的篇章。',answers:[{n:46,answer:'A',analysis:'解析。'}]}));const unfinished=await take('analysis');await cdp.js("location.hash='#/library'");check('部分解析期间离开阅读器，中止未完成请求',await aborted(unfinished));await enter(leavingPart.examId);await until("!!document.querySelector('.qopt.picked')");const returned=await cdp.js(`window.keeper.attemptGet(${leavingPart.examId})`);check('离开后重新进入仍保留已重新绑定的未交卷作答',returned.draft?.answers[leavingQid]==='B'&&!returned.draftStale&&!returned.attempt);
 console.log(`AI 取消真实界面回归 ${passed}/${passed} 通过，本地请求 ${requests.length} 次`);
}catch(error){console.error(error);process.exitCode=1;}
finally{cdp?.close();try{await stopChild(child);session.cleanup();}catch(error){console.error(error);process.exitCode=1;}for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}

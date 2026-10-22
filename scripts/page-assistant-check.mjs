// Real Electron UI, local model responses, isolated disposable learning data.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTestSession,availablePort,waitForPage,connectCdp,stopChild} from './lib/test-session.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),session=createTestSession('page-assistant');
let child,cdp,page,passed=0,detail,hold=null;const requests=[],sockets=new Set();
const output=process.env.KEEPER_ASSISTANT_ARTIFACTS;
const check=(name,ok)=>{if(!ok)throw Error(name);passed++;console.log('✓ '+name);};
const response=(res,content)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content}}]}));};
const server=createServer(async(req,res)=>{
 try{
 let body='';for await(const chunk of req)body+=chunk;
 const data=JSON.parse(body),prompt=data.messages[0].content,text=data.messages.at(-1).content;
 requests.push({prompt,text});
 if(text==='HOLD'){hold={res,aborted:false};res.on('close',()=>{if(!res.writableEnded)hold.aborted=true;});return;}
 if(prompt.includes('CET exam translator')){response(res,'本地翻译讲解。');return;}
 let actions=[],reply='本地助手讲解。';
 if(text==='HIGHLIGHT')actions=[{type:'highlight',passageId:detail.passages[0].id,quote:'Evidence supports deliberate practice.',title:'证据句',explanation:'这里的 evidence 是主语，supports 是谓语。'},{type:'highlight',passageId:detail.passages[0].id,quote:'Alpha readers understand this sentence clearly.',title:'句子主干',explanation:'readers understand 是句子主干。'}];
 if(text==='LAYOUT')actions=[{type:'set_view',layout:'split',fontSize:19,translation:'inline'}];
 if(text==='FOCUS')actions=[{type:'focus_question',questionId:detail.passages[1].questions[0].id}];
 if(text==='CROSS')actions=[{type:'navigate_passage',passageId:detail.passages[0].id},{type:'highlight',passageId:detail.passages[0].id,quote:'Evidence supports deliberate practice.',explanation:'跨篇章定位后的讲解。'}];
 if(text==='INVALID')actions=[{type:'highlight',passageId:detail.passages[0].id,quote:'Fabricated sentence that is absent.',explanation:'不应显示'}];
 if(text==='OPEN_WORDS')actions=[{type:'navigate_page',page:'words'}];
 if(text==='OPEN_RECITE')actions=[{type:'navigate_page',page:'recite'}];
 if(text.includes('请讲解我选中的原文')){response(res,'这是一条直接返回的选文解释，界面仍应显示在原文附近。');return;}
 response(res,JSON.stringify({reply,actions}));
 }catch(error){res.statusCode=500;res.end(error.message);}
});
server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
async function until(expression){const end=Date.now()+12000;while(Date.now()<end){if(await cdp.js(expression))return;await new Promise(r=>setTimeout(r,30));}throw Error('UI timeout: '+expression);}
const click=text=>`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})?.click()`;
async function open(){if(!await cdp.js("!!document.querySelector('.assistant-panel')"))await cdp.js("document.querySelector('.assistant-launcher')?.click()");await until("!!document.querySelector('.chat-input-row textarea')");}
async function send(text){await open();await cdp.js(`(()=>{const el=document.querySelector('.chat-input-row textarea');el.value=${JSON.stringify(text)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await cdp.js(click('发送'));}
async function idle(){await until("!document.querySelector('.assistant-thinking')");}
async function protocol(method,params){
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Protocol timeout')),10000);ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1){clearTimeout(timer);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result);}};ws.send(JSON.stringify({id:1,method,params}));});}finally{ws.close();}
}
async function screenshot(file){
 if(!output)return;fs.mkdirSync(output,{recursive:true});
 const result=await protocol('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,file),Buffer.from(result.data,'base64'));
}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/v1`;
 const port=await availablePort();child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),['.',`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu'],{cwd:root,env:session.env,stdio:'ignore'});page=await waitForPage(port,child);cdp=await connectCdp(page);
 await cdp.js(`window.keeper.setSettings({api_base:${JSON.stringify(base)},api_key:'fixture-only',api_model:'fixture'})`);
 check('首页提供全局助手入口',await cdp.js("!!document.querySelector('.assistant-launcher')"));
 await open();await cdp.js("document.querySelector('button[aria-label=展开助手]').click()");check('助手可展开为宽面板',await cdp.js("document.querySelector('.assistant-panel').getBoundingClientRect().width>=700"));await screenshot('assistant-workspace.png');
 await cdp.js("document.querySelector('button[aria-label=\"收起 AI 助手\"]').click()");
 const fixture={level:'CET4',year:2097,month:6,set_no:1,passages:[{section:'reading',seq:1,content:'Alpha readers understand this sentence clearly.\n\nEvidence supports deliberate practice. Repeat this phrase. Repeat this phrase.',translation:'读者清楚地理解这个句子。\n\n证据支持刻意练习。重复这个短语。重复这个短语。',questions:[{stem:'46. Which sentence supports practice?',options:['A) Evidence','B) Other'],answer:'A',analysis:'Evidence.'}]},{section:'reading',seq:2,content:'Beta readers understand another sentence.',translation:'读者理解另一句。',questions:[{stem:'51. What do readers understand?',options:['A) Another sentence','B) Nothing'],answer:'A',analysis:'Another sentence.'}]}]};
 const imported=await cdp.js(`window.keeper.importExam(${JSON.stringify(fixture)})`);check('导入隔离测试材料',imported.ok);detail=await cdp.js(`window.keeper.examDetail(${imported.examId})`);
 await cdp.js(`location.hash='#/reader/${imported.examId}'`);await until("!!document.querySelector('[data-ai-text]')&&[...document.querySelectorAll('button')].some(b=>b.textContent==='交卷核对'&&!b.disabled)");
 await cdp.js("document.querySelectorAll('.qopt.pick')[1].click()");
 await until(`(async()=>{const s=await window.keeper.attemptGet(${imported.examId});return s.draft?.answers[${detail.passages[0].questions[0].id}]==='B';})()`);
 await send('HIGHLIGHT');await until("!!document.querySelector('.inline-explanation') && !document.querySelector('.assistant-panel')");
 check('AI 引文对应真实 DOM Range 且多处高亮',await cdp.js("CSS.highlights.get('keeper-ai-evidence')?.size===2&&[...CSS.highlights.get('keeper-ai-evidence')][0].toString()==='Evidence supports deliberate practice.'"));
 check('讲解显示在文章附近且自动收起对话面板',await cdp.js("document.querySelector('.inline-explanation').textContent.includes('supports 是谓语')&&!document.querySelector('.assistant-panel')"));
 check('讲解卡位置在窗口范围内',await cdp.js("(()=>{const r=document.querySelector('.inline-explanation').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()"));
 await cdp.js("document.querySelector('.inline-explanation footer button').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
 check('讲解卡按钮上的 Enter 不触发交卷',!(await cdp.js(`window.keeper.attemptGet(${imported.examId})`)).attempt);
 await cdp.js("(()=>{const r=[...CSS.highlights.get('keeper-ai-evidence')][0].getClientRects()[0];[...document.querySelectorAll('.tb-actions button')].find(b=>b.textContent==='A-').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+2,clientY:r.top+2}));})()");
 check('原文标注不会拦截固定工具栏点击',await cdp.js("document.querySelector('.article').style.fontSize==='15.5px'"));await cdp.js(click('A+'));
 await screenshot('assistant-inline-explanation.png');
 await cdp.js("document.querySelector('button[aria-label=下一处讲解]').click()");check('多个标注可逐一浏览',await cdp.js("document.querySelector('.inline-explanation').textContent.includes('readers understand 是句子主干')"));
 await cdp.js("document.querySelector('button[aria-label=收起原文讲解]').click()");check('收起卡片仍保留高亮',await cdp.js("!document.querySelector('.inline-explanation')&&CSS.highlights.get('keeper-ai-evidence')?.size===2"));
 await cdp.js("(()=>{const range=[...CSS.highlights.get('keeper-ai-evidence')][0],r=range.getClientRects()[0];range.startContainer.parentElement.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+2,clientY:r.top+2}));})()");
 check('点击原文高亮可重开讲解且不弹查词框',await cdp.js("!!document.querySelector('.inline-explanation')&&!document.querySelector('.popover')"));
 await cdp.js("document.querySelector('button[aria-label=下一处讲解]').click()");
 await cdp.js("[...document.querySelectorAll('.reader-ai-controls button')].find(b=>b.textContent.includes('查看讲解')).click()");
 await cdp.js(click('继续追问'));await until("!!document.querySelector('.assistant-panel')");check('追问带入对应原文',await cdp.js("document.querySelector('.chat-input-row textarea').value.includes('Alpha readers')"));
 await send('LAYOUT');await idle();await until("!!document.querySelector('.layout-split')&&!!document.querySelector('.bi-en')");
 check('AI 调整布局、对照和字号',await cdp.js("document.querySelector('.article').style.fontSize==='19px'"));
 check('切换对照排版后高亮仍对应原文',await cdp.js("CSS.highlights.get('keeper-ai-evidence')?.size===2&&[...CSS.highlights.get('keeper-ai-evidence')].every(r=>r.startContainer.isConnected)"));
 await send('FOCUS');await idle();await until(`document.activeElement?.dataset.questionId==='${detail.passages[1].questions[0].id}'`);
 check('AI 可跨篇章定位并聚焦真实题目',await cdp.js("document.querySelector('.article').textContent.includes('Beta readers')"));
 check('切篇清除旧材料高亮',await cdp.js("!CSS.highlights.has('keeper-ai-evidence')"));
 await send('CROSS');await until("document.querySelector('.inline-explanation')?.textContent.includes('跨篇章定位后的讲解')");
 check('助手主动切篇与高亮在同一批中完成',await cdp.js("document.querySelector('.article').textContent.includes('Alpha readers')&&CSS.highlights.get('keeper-ai-evidence')?.size===1"));
 const attempt=await cdp.js(`window.keeper.attemptGet(${imported.examId})`);check('页面操作保留未提交答案且不交卷',attempt.draft?.answers[detail.passages[0].questions[0].id]==='B'&&!attempt.attempt);
 await send('INVALID');await until("document.querySelector('.assistant-notice')?.textContent.includes('AI 引文未能对应原文')");check('伪造引文被拒绝，已有标注不被替换',await cdp.js("CSS.highlights.get('keeper-ai-evidence')?.size===1&&!document.body.innerText.includes('不应显示')"));
 await cdp.js("document.querySelector('button[aria-label=\"收起 AI 助手\"]').click()");
 await cdp.js("[...document.querySelectorAll('.reader-ai-controls button')].find(b=>b.textContent.includes('清除 AI 标注')).click()");
 await cdp.js("(()=>{const block=document.querySelector('[data-ai-text]'),range=document.createRange();range.selectNodeContents(block);const s=getSelection();s.removeAllRanges();s.addRange(range);block.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:350,clientY:360}));})()");await until("!!document.querySelector('.selmenu')");
 await cdp.js("[...document.querySelectorAll('.selmenu button')].find(b=>b.textContent.includes('就地讲解')).click()");
 await until("document.querySelector('.inline-explanation')?.textContent.includes('直接返回的选文解释')");check('划选可直接就地讲解，普通模型文本回答也能锚定原文',await cdp.js("CSS.highlights.get('keeper-ai-evidence')?.size===1"));
 await cdp.js("(()=>{const blocks=[...document.querySelectorAll('[data-ai-text]')].filter(el=>el.textContent==='Repeat this phrase.'),block=blocks.at(-1),range=document.createRange();range.selectNodeContents(block);const s=getSelection();s.removeAllRanges();s.addRange(range);block.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:350,clientY:360}));})()");await until("!!document.querySelector('.selmenu')");
 await cdp.js("[...document.querySelectorAll('.selmenu button')].find(b=>b.textContent.includes('就地讲解')).click()");await until("document.querySelector('.inline-explanation blockquote')?.textContent==='Repeat this phrase.'");
 check('划选第二处相同句子只高亮第二处',await cdp.js("[...CSS.highlights.get('keeper-ai-evidence')][0].startContainer.parentElement.closest('[data-ai-text]')===[...document.querySelectorAll('[data-ai-text]')].filter(el=>el.textContent==='Repeat this phrase.').at(-1)"));
 await cdp.js('getSelection().removeAllRanges()');
 await send('HOLD');await until("!!document.querySelector('.assistant-thinking')");
 while(!hold)await new Promise(r=>setTimeout(r,20));
 await cdp.js("document.querySelectorAll('.section-tabs button')[1].click()");await idle();
 const abortEnd=Date.now()+5000;while(!hold.aborted&&Date.now()<abortEnd)await new Promise(r=>setTimeout(r,20));
 check('手动切篇中止在途模型请求',hold.aborted);response(hold.res,JSON.stringify({reply:'late',actions:[]}));
 check('旧请求不污染新篇章，输入保留供重试',await cdp.js("!document.querySelector('.inline-explanation')&&document.querySelector('.chat-input-row textarea').value==='HOLD'"));
 await send('OPEN_WORDS');await until("location.hash==='#/words'");check('AI 可以打开其他软件页面',await cdp.js("document.querySelector('.page-title').textContent==='生词本'"));
 const beforeComposition=requests.length;
 await cdp.js("(()=>{const e=document.querySelector('.chat-input-row textarea');e.value='未完成输入';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,bubbles:true}));})()");
 check('中文输入法确认键不会误发消息',requests.length===beforeComposition&&await cdp.js("document.querySelector('.chat-input-row textarea').value==='未完成输入'"));
 await cdp.js(click('清空对话'));await until("document.querySelectorAll('.chat-msg').length===0");check('全局清空同步移除持久化聊天记录',(await cdp.js('window.keeper.chatHistory()')).length===0);
 await cdp.js(`location.hash='#/reader/${imported.examId}'`);await until("!!document.querySelector('[data-ai-text]')");check('重进阅读器不会重放历史页面操作',await cdp.js("!CSS.highlights.has('keeper-ai-evidence')&&!document.querySelector('.inline-explanation')"));
 await protocol('Emulation.setDeviceMetricsOverride',{width:1024,height:700,deviceScaleFactor:1,mobile:false});
 await send('HIGHLIGHT');await until("!!document.querySelector('.inline-explanation')&&!document.querySelector('.assistant-panel')");
 check('1024×700 窗口中讲解卡仍完整可见',await cdp.js("(()=>{const r=document.querySelector('.inline-explanation').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()"));
 await screenshot('assistant-inline-compact.png');
 await send('OPEN_RECITE');await until(`location.hash.startsWith('#/recite/${imported.examId}')`);
 check('AI 打开对照背诵时保留当前篇章',await cdp.js(`location.hash.includes('passage=${detail.passages[0].id}')`));
 console.log(`页面助手真实界面 ${passed}/${passed} 通过，本地模型请求 ${requests.length} 次`);
}catch(error){console.error(error);if(cdp)await screenshot('assistant-failure.png').catch(()=>{});process.exitCode=1;}
finally{cdp?.close();try{await stopChild(child);session.cleanup();}catch(error){console.error(error);process.exitCode=1;}for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}

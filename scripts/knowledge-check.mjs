import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createTestSession,availablePort,waitForPage,connectCdp,stopChild} from './lib/test-session.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),session=createTestSession('knowledge');
const output=process.env.KEEPER_KNOWLEDGE_ARTIFACTS;
let child,cdp,page,detail,passed=0,modelCalls=0;const sockets=new Set();
const server=createServer(async(req,res)=>{for await(const _ of req){}modelCalls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({reply:'这句表达练习的效果。',actions:[{type:'highlight',passageId:detail.passages[1].id,quote:'Practice makes progress.',occurrence:1,title:'真题例句：主谓宾',explanation:'**Practice** 是主语，makes 是谓语，progress 是宾语。'}]})}}]}));});
server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
const check=(name,ok)=>{if(!ok)throw Error(name);passed++;console.log('✓ '+name);};
async function until(expression){for(let i=0;i<150;i++){if(await cdp.js(expression))return;await new Promise(r=>setTimeout(r,40));}throw Error('UI timeout: '+expression);}
async function click(text){await cdp.js(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})?.click()`);}
async function input(selector,value){await cdp.js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);}
async function protocol(method,params){const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Protocol timeout')),10000);ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1){clearTimeout(timer);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result);}};ws.send(JSON.stringify({id:1,method,params}));});}finally{ws.close();}}
async function screenshot(name){if(!output)return;fs.mkdirSync(output,{recursive:true});const shot=await protocol('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name),Buffer.from(shot.data,'base64'));}
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=await availablePort();child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),['.',`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu'],{cwd:root,env:session.env,stdio:'ignore'});page=await waitForPage(port,child);cdp=await connectCdp(page);
 await protocol('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await cdp.js("location.hash='#/knowledge'");await until("!!document.querySelector('.kb-body')");
 check('内置条目可阅读全文，不再只有标题',await cdp.js("document.querySelectorAll('.kb-item').length>=12&&document.querySelector('.kb-body').textContent.length>100&&!document.querySelector('.kb-detail button.danger')"));
 await click('复制为新笔记');await until("!!document.querySelector('.kb-editor')");check('内置资料可复制为自己的可编辑草稿',await cdp.js("document.querySelector('[aria-label=笔记内容]').value.length>100&&document.querySelector('[aria-label=笔记标题]').value.includes('笔记')"));await click('取消');
 await click('＋ 新建笔记');await input('[aria-label=笔记标题]','我的非谓语整理');await input('[aria-label=笔记分类]','我的薄弱点');await input('[aria-label=笔记标签]','语法, 非谓语');await input('[aria-label=笔记内容]','普通笔记内容。'.repeat(400)+'\n\n尾部搜索词 <script>window.badKnowledge=true</script>');await click('保存笔记');
 await until("document.querySelector('.kb-title')?.textContent==='我的非谓语整理'");
 const manual=(await cdp.js("window.keeper.kbSearch({source:'user'})")).entries[0];
 check('新建保存分类标签与完整正文',await cdp.js("document.querySelector('.kb-detail-top').textContent.includes('我的薄弱点')&&document.querySelector('.kb-tags').textContent.includes('非谓语')&&document.querySelector('.kb-body').textContent.includes('尾部搜索词')"));
 check('笔记 Markdown 中的 HTML 不执行',await cdp.js("!window.badKnowledge&&!document.querySelector('.kb-body script')"));
 await input('[aria-label=搜索知识库]','尾部搜索词');await until("document.querySelectorAll('.kb-item').length===1");
 check('全文搜索能找到长笔记后部并显示命中摘要',await cdp.js("document.querySelector('.kb-item .kb-preview').textContent.includes('尾部搜索词')"));
 await input('.kb-toolbar label:nth-child(3) select','基础知识');await until("document.querySelectorAll('.kb-item').length===0");check('分类与关键词组合筛选生效',true);await click('清除筛选');await until("document.querySelectorAll('.kb-item').length>=13");
 await click('编辑');await input('[aria-label=笔记内容]','修改后的笔记正文。');await click('保存笔记');await until("document.querySelector('.kb-body')?.textContent==='修改后的笔记正文。'");check('编辑原笔记保留同一条目编号',(await cdp.js(`window.keeper.kbGet(${JSON.stringify(manual.key)})`)).id===manual.id);
 await click('删除');await click('保留笔记');check('取消删除后仍保留正文',await cdp.js("document.querySelector('.kb-body').textContent==='修改后的笔记正文。'&&!document.querySelector('.kb-delete')"));
 const fixture={level:'CET4',year:2097,month:6,set_no:1,passages:[{section:'reading',seq:1,content:'First passage for source identity.',translation:'用于来源定位的第一篇。',questions:[]},{section:'reading',seq:2,content:'A sentence before practice. Practice makes progress. Practice makes progress.',translation:'练习前的一句话。练习带来进步。练习带来进步。',questions:[]}]};
 const imported=await cdp.js(`window.keeper.importExam(${JSON.stringify(fixture)})`);if(!imported.ok)throw Error('Fixture failed');detail=await cdp.js(`window.keeper.examDetail(${imported.examId})`);
 await cdp.js(`window.keeper.setSettings({api_base:'http://127.0.0.1:${server.address().port}/v1',api_key:'fixture-only',api_model:'fixture'})`);
 await cdp.js(`location.hash='#/reader/${imported.examId}?passage=${detail.passages[1].id}'`);await until("document.querySelector('.article')?.textContent.includes('A sentence before practice')");
 await cdp.js("document.querySelector('.assistant-launcher').click()");await until("!!document.querySelector('.chat-input-row textarea')");await input('.chat-input-row textarea','讲解第二处 Practice makes progress.');await click('发送');await until("!!document.querySelector('.inline-explanation')");
 check('原文讲解提供保存笔记入口',await cdp.js("document.querySelector('.inline-explanation').textContent.includes('存入知识库')"));
 await click('存入知识库');await until("!!document.querySelector('.kb-editor')");
 check('讲解先进入草稿，不自动写入知识库',(await cdp.js("window.keeper.kbSearch({source:'user'})")).entries.length===1);
 check('AI 草稿包含原文来源、讲解与来源标记',await cdp.js("document.querySelector('.kb-editor').textContent.includes('AI 整理')&&document.querySelector('.kb-origin').textContent.includes('Practice makes progress.')&&document.querySelector('[aria-label=笔记内容]').value.includes('主语')"));
 await input('[aria-label=笔记标题]','主谓宾：我的真题实例');await input('[aria-label=笔记标签]','语法,主谓宾');await input('[aria-label=笔记内容]','**Practice** 是主语，makes 是谓语，progress 是宾语。\n\n我的补充：积累练习类表达。');await click('保存笔记');await until("document.querySelector('.kb-title')?.textContent==='主谓宾：我的真题实例'");
 check('保存后显示可点击的真实原文来源',await cdp.js("document.querySelector('.kb-origin button')?.textContent==='返回原文并高亮'&&document.querySelector('.kb-body').textContent.includes('我的补充')"));await screenshot('knowledge-library.png');
 const saved=(await cdp.js("window.keeper.kbSearch({query:'主谓宾：我的真题实例'})")).entries[0];
 await click('返回原文并高亮');await until("document.querySelector('.inline-explanation')?.textContent.includes('我的补充')");
 check('返回来源自动切到正确篇章并恢复保存后的笔记',await cdp.js(`location.hash.includes('passage=${detail.passages[1].id}')&&document.querySelector('.article').textContent.includes('A sentence before practice')&&CSS.highlights.get('keeper-ai-active')?.size===1`));
 check('重复句子恢复到第二处，未消耗新的 AI 请求',await cdp.js("(()=>{const r=[...CSS.highlights.get('keeper-ai-active')][0],block=r.startContainer.parentElement.closest('[data-ai-text]'),before=document.createRange();before.selectNodeContents(block);before.setEnd(r.startContainer,r.startOffset);return before.toString().includes('Practice makes progress.');})()")&&modelCalls===1);await screenshot('knowledge-source-highlight.png');
 await cdp.js("location.hash='#/knowledge'");await until("!!document.querySelector('.kb-body')");await cdp.js(`document.querySelector(${JSON.stringify('.kb-item')})?.click()`);
 const after=await cdp.js(`window.keeper.kbGet(${JSON.stringify(saved.key)})`);check('重进页面保留编辑内容、标签与来源身份',after.content.includes('我的补充')&&after.tags.includes('主谓宾')&&after.anchor.occurrence===1);
 await click('删除');await click('确认删除');await until("!document.querySelector('.kb-delete')");check('确认删除移除所选笔记，另一篇笔记仍保留',(await cdp.js("window.keeper.kbSearch({source:'user'})")).entries.length===1);
 console.log(`知识库真实界面 ${passed}/${passed} 通过，仅本地模型请求 ${modelCalls} 次`);
}catch(error){console.error(error);if(cdp){console.error(await cdp.js("({errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent),invalid:[...document.querySelectorAll(':invalid')].map(e=>({tag:e.tagName,label:e.getAttribute('aria-label'),message:e.validationMessage})),buttons:[...document.querySelectorAll('.kb-editor button')].map(e=>({text:e.textContent,disabled:e.disabled}))})").catch(()=>null));await screenshot('knowledge-failure.png').catch(()=>{});}process.exitCode=1;}
finally{cdp?.close();try{await stopChild(child);session.cleanup();}catch(error){console.error(error);process.exitCode=1;}for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}

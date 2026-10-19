// 真界面与本地 HTTP fixture；独占临时用户目录，无外部 AI 请求。
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTestSession,availablePort,waitForPage,connectCdp,stopChild} from './lib/test-session.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const session=createTestSession('interactions');
let child,cdp,passed=0,requests=0;
const held=[],sockets=new Set();
const server=createServer(async(req,res)=>{
 requests++;let body='';for await(const chunk of req)body+=chunk;
 const input=JSON.parse(body||'{}');res.setHeader('Content-Type','application/json');
 if(req.headers.authorization!=='Bearer fixture-good'){res.writeHead(401);res.end('{}');return;}
 const send=()=>res.end(JSON.stringify(input.model==='bad-shape'?{choices:[]}:{choices:[{message:{content:'OK'}}]}));
 if(input.model==='hold'){held.push(send);return;}
 send();
});
server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
const check=(name,ok)=>{if(!ok)throw Error(name);passed++;console.log('✓ '+name);};
async function until(code){const end=Date.now()+10000;while(Date.now()<end){if(await cdp.js(code))return;await new Promise(r=>setTimeout(r,50));}throw Error('等待超时: '+code);}
const field=(index,value)=>`(()=>{const e=document.querySelectorAll('.settings-form input')[${index}];e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`;
const clickProbe=`[...document.querySelectorAll('button')].find(b=>b.textContent==='测试连接').click()`;
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const base=`http://127.0.0.1:${server.address().port}/v1`;
 const port=await availablePort();child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),['.',`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu'],{cwd:root,env:session.env,stdio:'ignore'});
 cdp=await connectCdp(await waitForPage(port,child));
 for(const word of ['abandon','intervene','serendipity'])await cdp.js(`window.keeper.addWord(${JSON.stringify(word)},'Test sentence.',null)`);
 await cdp.js(`window.keeper.setWordStatus('intervene','mastered');location.hash='#/words'`);
 await until(`document.querySelectorAll('.wtable .wword').length===3`);
 await cdp.js(`(()=>{const s=document.querySelector('.filter-bar select');s.value='mastered';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await until(`document.querySelectorAll('.wword').length===1 && document.querySelector('.wword').textContent==='intervene'`);
 check('状态下拉立即刷新真实列表',true);
 await cdp.js(`(()=>{const s=document.querySelector('.filter-bar select');s.value='all';s.dispatchEvent(new Event('change',{bubbles:true}));const e=document.querySelector('.filter-bar input');e.value=' ABAN ';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await until(`document.querySelectorAll('.wword').length===1 && document.querySelector('.wword').textContent==='abandon'`);
 check('搜索输入自动刷新且兼容大小写和首尾空白',true);
 await cdp.js(`(()=>{const e=document.querySelector('.filter-bar input');e.value='偶然';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await until(`document.querySelector('.wword')?.textContent==='serendipity' && document.querySelectorAll('.wword').length===1`);
 check('中文释义搜索有效',true);
 const exported=await cdp.js(`window.keeper.exportAnki({search:'偶然',status:'all',sortBy:'word',targetPath:${JSON.stringify(path.join(session.dir,'filtered-anki.txt'))}})`);
 check('Anki 文件只含当前匹配词',exported.count===1&&fs.readFileSync(exported.path,'utf8').includes('serendipity')&&!fs.readFileSync(exported.path,'utf8').includes('abandon'));
 await cdp.js(`(()=>{const e=document.querySelector('.filter-bar input');e.value='no-such-word-000';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await until(`document.body.innerText.includes('没有匹配的生词')`);
 check('无匹配提示明确且禁用导出',await cdp.js(`[...document.querySelectorAll('.filter-bar button')].find(b=>b.textContent.includes('导出')).disabled`));
 await cdp.js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='清除筛选').click()`);await until(`document.querySelectorAll('.wword').length===3`);
 check('清除筛选恢复列表',true);
 await cdp.js(`document.querySelector('.wword').click()`);await until(`!!document.querySelector('.drawer .dsec')`);
 await cdp.js(`document.querySelector('.drawer-mask').click()`);check('词条详情可以关闭',await cdp.js(`!document.querySelector('.drawer')`));
 const queue=await cdp.js('window.keeper.reviewQueue()'),first=[...queue.due,...queue.fresh][0].word,second=[...queue.due,...queue.fresh][1].word;
 await cdp.js(`location.hash='#/review'`);await until(`!!document.querySelector('.review-wrap button.primary:not(:disabled)')`);
 await cdp.js(`document.querySelector('.review-wrap button.primary').click()`);await until(`!!document.querySelector('.review-card')`);
 await cdp.js(`document.querySelector('.review-card').click()`);await until(`!!document.querySelector('.rate-got')`);
 await cdp.js(`document.querySelector('.rate-got').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'3',bubbles:true}));document.querySelector('.rate-got')?.click()`);
 await until(`document.querySelector('.rw')?.textContent.trim()===${JSON.stringify(second)}`);
 const firstDetail=await cdp.js(`window.keeper.wordDetail(${JSON.stringify(first)})`);
 check('点击和按键连发只记一次评分，不跳过下一词',firstDetail.logs.length===1&&firstDetail.userWord.reps===1);
 const a=await cdp.js(`window.keeper.reviewAnswer(${JSON.stringify(second)},2,'fixture-operation')`),b=await cdp.js(`window.keeper.reviewAnswer(${JSON.stringify(second)},2,'fixture-operation')`);
 check('同一复习操作重放返回原结果',a.ok&&b.duplicate&&a.due===b.due);
 await cdp.js(`window.keeper.setSettings({api_base:${JSON.stringify(base)},api_key:'fixture-good',api_model:'fixture-model'})`);
 const cacheStart=await cdp.js(`window.keeper.translate('A cached fixture text.')`),cacheAgain=await cdp.js(`window.keeper.translate('A cached fixture text.')`);
 check('普通 AI 请求仍可使用同配置缓存',cacheStart.ok&&!cacheStart.cached&&cacheAgain.cached);
 await cdp.js(`location.hash='#/settings'`);await until(`document.querySelector('.settings-form input')?.value===${JSON.stringify(base)}`);
 let before=requests;await cdp.js(clickProbe);await until(`document.body.innerText.includes('连接成功')`);check('设置页测试确实请求接口',requests===before+1);
 before=requests;await cdp.js(clickProbe);await until(`document.body.innerText.includes('连接成功')`);check('再次测试不复用缓存',requests===before+1);
 await cdp.js(field(1,'fixture-wrong'));await cdp.js(clickProbe);await until(`document.body.innerText.includes('api_401')`);check('错误 Key 不显示缓存成功',true);
 await cdp.js(field(1,''));before=requests;await cdp.js(clickProbe);await until(`document.body.innerText.includes('请先填写 API 地址与 Key')`);check('空 Key 明确失败且不发网络请求',requests===before);
 await cdp.js(field(1,'fixture-good'));await cdp.js(field(2,'bad-shape'));await cdp.js(clickProbe);await until(`document.body.innerText.includes('bad_response')`);check('响应结构错误不会显示连接成功',true);
 await cdp.js(field(2,'hold'));await cdp.js(clickProbe);
 const heldDeadline=Date.now()+10000;while(!held.length&&Date.now()<heldDeadline)await new Promise(r=>setTimeout(r,20));
 check('在途连接测试已到达本地服务',held.length===1);
 await cdp.js(field(2,'edited-while-testing'));held.shift()();await until(`[...document.querySelectorAll('button')].some(b=>b.textContent==='测试连接'&&!b.disabled)`);
 check('修改配置后旧成功结果被忽略',await cdp.js(`!document.body.innerText.includes('连接成功')`));
 const saved=await cdp.js('window.keeper.getSettings()');check('连接测试不自动覆盖已保存设置',saved.api_model==='fixture-model'&&saved.api_key==='fixture-good');
 console.log(`交互界面回归 ${passed}/${passed} 通过，本地 HTTP 请求 ${requests} 次`);
}catch(error){console.error(error);process.exitCode=1;}
finally{cdp?.close();try{await stopChild(child);session.cleanup();}catch(error){console.error(error);process.exitCode=1;}for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}

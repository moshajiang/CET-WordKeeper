// 原生 Vue 事件、真实 IPC 和实际数据库；所有写入使用独占临时用户目录。
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTestSession,availablePort,waitForPage,connectCdp,stopChild} from './lib/test-session.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),session=createTestSession('word-popover');
let child,cdp,passed=0;
const check=(name,ok)=>{if(!ok)throw Error(name);passed++;console.log('✓ '+name);};
async function until(code){const end=Date.now()+15000;while(Date.now()<end){if(await cdp.js(code))return;await new Promise(resolve=>setTimeout(resolve,40));}throw Error('等待超时: '+code);}
const clickWord=word=>cdp.js(`(()=>{window.getSelection().removeAllRanges();[...document.querySelectorAll('.article .w')].find(e=>e.textContent===${JSON.stringify(word)}).click();})()`);
const doubleWord=word=>cdp.js(`(()=>{window.getSelection().removeAllRanges();[...document.querySelectorAll('.article .w')].find(e=>e.textContent===${JSON.stringify(word)}).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
try{
 const port=await availablePort();child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),['.',`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu'],{cwd:root,env:session.env,stdio:'ignore'});cdp=await connectCdp(await waitForPage(port,child));
 const fixture={level:'CET4',year:2099,month:6,set_no:1,passages:[1,2].map(seq=>({section:'reading',seq,content:'Running students work hard.\nFresh ideas inspire people.',translation:'跑步的学生努力学习。\n新鲜的想法启发人们。',questions:[{stem:'46',options:['A) yes','B) no'],answer:'A',analysis:'根据原文选择 A。'}]}))};
 const imported=await cdp.js(`window.keeper.importExam(${JSON.stringify(fixture)})`);check('导入同句不同篇章的隔离材料',imported.ok===true);const detail=await cdp.js(`window.keeper.examDetail(${imported.examId})`),firstId=detail.passages[0].id,secondId=detail.passages[1].id;
 await cdp.js(`location.hash='#/reader/${imported.examId}'`);await until(`!!document.querySelector('.article .w')`);
 await clickWord('Running');await until(`document.querySelector('.popover .pw')?.textContent==='run'`);check('实际气泡查词显示不规则/屈折原形',true);
 await cdp.js(`[...document.querySelectorAll('.article .w')].find(e=>e.textContent==='Running').click();[...document.querySelectorAll('.article .w')].find(e=>e.textContent==='Fresh').click()`);await until(`document.querySelector('.popover .pw')?.textContent==='fresh'`);check('连续点击最后一个词保留最新气泡',true);
 await cdp.js(`document.querySelector('.popover .acts button.primary').click()`);await until(`!!document.querySelector('.popover .acts button.danger') && !!document.querySelector('.popover .hit-sent')`);
 const saved=await cdp.js(`window.keeper.wordDetail('fresh')`);check('收藏记录保存当前词的原句与篇章',saved.hits.length===1&&saved.hits[0].sentence==='Fresh ideas inspire people.'&&saved.hits[0].passage_id===firstId);
 check('收藏成功后气泡立即展示新增出处',await cdp.js(`document.querySelector('.popover .hit-sent').textContent==='Fresh ideas inspire people.'`));
 await cdp.js(`window.keeper.setWordStatus('fresh','mastered')`);await until(`[...document.querySelectorAll('.article .w')].some(e=>e.textContent==='Fresh'&&e.classList.contains('mastered'))`);check('外部收藏状态变更同步到原文和当前气泡',await cdp.js(`!!document.querySelector('.popover .acts button.danger')`));
 await cdp.js(`document.querySelectorAll('.section-tabs button')[1].click()`);await until(`document.querySelector('.section-tabs .active').textContent.trim()==='仔细阅读 2' && !document.querySelector('.popover')`);check('切换篇章主动关闭旧气泡',true);
 await clickWord('Fresh');await until(`document.querySelector('.popover .pw')?.textContent==='fresh'`);await doubleWord('Fresh');await until(`document.querySelectorAll('.popover .hit-sent').length===2`);
 const repeated=await cdp.js(`window.keeper.wordDetail('fresh')`);check('两个篇章的相同原句均保留独立出处',repeated.hits.length===2&&new Set(repeated.hits.map(hit=>hit.passage_id)).size===2&&repeated.hits.some(hit=>hit.passage_id===secondId));
 check('追加出处保持原掌握状态',repeated.userWord.status==='mastered');await doubleWord('Fresh');await until(`!document.querySelector('.popover .acts button.danger').disabled`);check('同一词/篇章/原句重复收藏不增加记录',(await cdp.js(`window.keeper.wordDetail('fresh')`)).hits.length===2);
 await cdp.js(`document.querySelector('.popover .acts button.danger').click()`);await until(`!!document.querySelector('.popover .acts button.primary') && !document.querySelector('.popover .hit-sent')`);check('移除后气泡、出处列表及原文高亮同步',await cdp.js(`![...document.querySelectorAll('.article .w')].some(e=>e.textContent==='Fresh'&&e.classList.contains('marked'))`));
 const absent=await cdp.js(`window.keeper.addWord('fresh','Fresh ideas inspire people.',999999999)`);check('真实 IPC 拒绝不存在的篇章且不创建生词',absent.error==='invalid_passage'&&(await cdp.js(`window.keeper.wordDetail('fresh')`)).userWord===null);
 await clickWord('Running');await until(`document.querySelector('.popover .pw')?.textContent==='run'`);await cdp.js(`document.querySelector('.tb-title h1').click()`);await until(`!document.querySelector('.popover')`);check('点击气泡外关闭查词',true);
 await clickWord('Running');await until(`!!document.querySelector('.popover')`);await cdp.js(`(()=>{const e=[...document.querySelectorAll('.article .w')].find(e=>e.textContent==='Fresh');const r=document.createRange();r.selectNodeContents(e);window.getSelection().addRange(r);e.click();})()`);await until(`!document.querySelector('.popover')`);check('选择复制时不会弹出另一个查词气泡',true);
 await cdp.js(`window.getSelection().removeAllRanges();location.hash='#/words'`);await until(`!document.querySelector('.reader-topbar')`);check('离开阅读器后不残留浮层',await cdp.js(`!document.querySelector('.popover') && !document.querySelector('.selmenu')`));
 console.log(`查词气泡/出处真实界面 ${passed}/${passed}`);
}finally{cdp?.close();await stopChild(child);session.cleanup();}

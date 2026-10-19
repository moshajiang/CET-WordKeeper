// 独占临时 userData；--live-gitee 仅检查公开码云版本，不下载/安装、不打开浏览器。
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTestSession,availablePort,waitForPage,connectCdp,stopChild} from './lib/test-session.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),session=createTestSession('updates');
let child,cdp,passed=0;
const check=(name,ok)=>{if(!ok)throw Error(name);passed++;console.log('✓ '+name);};
async function until(code){const end=Date.now()+20000;while(Date.now()<end){if(await cdp.js(code))return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('等待超时: '+code);}
try{
  const port=await availablePort();
  child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),['.',`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu'],
    {cwd:root,env:{...session.env,PORTABLE_EXECUTABLE_DIR:session.dir},stdio:'ignore'});
  cdp=await connectCdp(await waitForPage(port,child));
  const state=await cdp.js('window.keeper.updateState()');
  check('真实更新 IPC 初始化为 GitHub 来源并识别便携测试环境',state.source==='github'&&state.phase==='idle'&&state.portable===true&&state.current==='0.3.1');
  check('真实 IPC 拒绝任意更新 URL',(await cdp.js(`window.keeper.updateCheck('https://example.invalid')`)).ok===false);
  check('发布页 IPC 拒绝未授权来源且不打开浏览器',(await cdp.js(`window.keeper.updateOpenReleases('invalid')`)).ok===false);
  check('未下载时真实安装 IPC 拒绝执行',(await cdp.js('window.keeper.updateInstall()')).ok===false);
  await cdp.js(`location.hash='#/settings'`);await until(`!!document.querySelector('#update-source') && !!document.querySelector('.settings-form input')`);
  check('设置页显示两个来源和 GitHub 发布页',await cdp.js(`document.querySelector('#update-source').options.length===2 && document.body.textContent.includes('打开GitHub发布页')`));
  await cdp.js(`(()=>{const select=document.querySelector('#update-source');select.value='gitee';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`localStorage.getItem('keeper.update.source')==='gitee' && document.body.textContent.includes('打开码云发布页')`);
  check('原生选择事件保存码云偏好并切换发布页文案',true);
  await cdp.js(`location.hash='#/'`);await until(`!document.querySelector('#update-source')`);await cdp.js(`location.hash='#/settings'`);
  await until(`document.querySelector('#update-source')?.value==='gitee'`);
  check('离开再进入设置仍恢复码云来源',true);
  if(process.argv.includes('--live-gitee')){
    await cdp.js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='检查更新').click()`);
    await until(`!document.querySelector('#update-source').disabled && ['检查失败','已是最新版本','发现新版本'].some(text=>document.body.textContent.includes(text))`);
    const result=await cdp.js('window.keeper.updateState()');
    check('真实 Electron 自定义 Provider 完成码云检查',result.source==='gitee'&&['error','not-available','available'].includes(result.phase));
    check('码云无发行版时明确提示而不误报最新',result.phase==='error'?result.error.includes('尚未发布'):!!result.latest);
    check('真实事件同步到设置页并允许失败后重试',await cdp.js(`document.body.textContent.includes('尚未发布') || document.body.textContent.includes('新版本') || document.body.textContent.includes('已是最新版本')`));
  }
  console.log(`更新 IPC / 设置真实界面 ${passed}/${passed}`);
}finally{cdp?.close();await stopChild(child);session.cleanup();}

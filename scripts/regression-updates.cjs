const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { createUpdates, giteeProviderClass } = require('../electron/updates.cjs');
let passed = 0;
const test = async (name, work) => { await work(); passed++; console.log('✓ '+name); };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function updater() {
  const emitter = new EventEmitter();
  let checks=0, downloads=0, installs=0, feed;
  emitter.setFeedURL = value => { feed=value; };
  emitter.checkForUpdates = async () => { checks++; emitter.emit('checking-for-update'); emitter.emit('update-available',{version:'0.3.2'}); return {isUpdateAvailable:true}; };
  emitter.downloadUpdate = async () => { downloads++; };
  emitter.quitAndInstall = () => { installs++; };
  const updates = createUpdates({updater:emitter,current:()=> '0.3.1'});
  return {emitter,updates,get checks(){return checks;},get downloads(){return downloads;},get installs(){return installs;},get feed(){return feed;}};
}
const version='0.3.2', installer=`CET-WordKeeper-${version}-setup.exe`;
const digest=createHash('sha512').update('fixture-installer').digest('base64');
const manifest=()=>`version: ${version}\nfiles:\n  - url: ${installer}\n    sha512: ${digest}\n    size: 17\n`;
const release=(tag='v0.3.2')=>({tag_name:tag,name:tag,body:'fixture',assets:[{name:'latest.yml',browser_download_url:'https://gitee.com/fixture/latest.yml'},
  {name:installer,browser_download_url:'https://gitee.com/fixture/'+installer}]});
function provider({pages=[[release()]],yaml=manifest()}={}) {
  const requests=[];
  const Provider=giteeProviderClass(), value=new Provider({}, {}, {platform:'win32',executor:{}});
  value.httpRequest=async url=>{ requests.push(url.href); return url.pathname.endsWith('latest.yml')?yaml:JSON.stringify(pages[Number(url.searchParams.get('page'))-1]||[]); };
  return {value,requests};
}
(async()=>{
  await test('码云使用 API 附件真实地址，保留安装包 SHA-512 / 大小给 updater 校验',async()=>{
    const {value}=provider(), info=await value.getLatestVersion(), files=value.resolveFiles(info);
    assert.equal(info.version,version);assert.equal(files[0].info.sha512,digest);assert.equal(files[0].info.size,17);
    assert.equal(files[0].url.href,'https://gitee.com/fixture/'+installer);assert.equal(value.isUseMultipleRangeRequest,false);
  });
  await test('码云按语义版本选最新稳定版，不接受草稿/预发布或 API 顺序',async()=>{
    const {value}=provider({pages:[[release('v0.3.1'),{...release('v99.0.0'),draft:true},{...release('v88.0.0'),prerelease:true},release('v77.0.0-beta.1'),release()]]});
    assert.equal((await value.getLatestVersion()).version,version);
  });
  await test('分页读取避免首批历史记录遮挡最新版本',async()=>{
    const {value,requests}=provider({pages:[Array.from({length:100},()=>release('v0.1.0')),[release()]]});
    assert.equal((await value.getLatestVersion()).version,version);assert.equal(requests.filter(url=>url.includes('per_page')).length,2);
  });
  await test('空码云仓库明确尚未发布，不会报告最新版本',async()=>{
    await assert.rejects(provider({pages:[[]]}).value.getLatestVersion(),/尚未发布/);
  });
  await test('拒绝格式错误的 API 和过量分页，不默默返回过期版本',async()=>{
    await assert.rejects(provider({pages:[{}]}).value.getLatestVersion(),/格式错误/);
    await assert.rejects(provider({pages:Array.from({length:20},()=>Array.from({length:100},()=>release()))}).value.getLatestVersion(),/超过检查上限/);
  });
  await test('拒绝缺失/重复清单和缺失/重复安装包',async()=>{
    for(const name of ['latest.yml',installer])for(const duplicate of [false,true]){
      const r=release();r.assets=duplicate?[...r.assets,r.assets.find(a=>a.name===name)]:r.assets.filter(a=>a.name!==name);
      await assert.rejects(provider({pages:[[r]]}).value.getLatestVersion(),/缺少或重复附件/);
    }
  });
  await test('拒绝清单标签版本不一致、缺少安装包及错误摘要或大小',async()=>{
    for(const yaml of [manifest().replace('version: 0.3.2','version: 0.3.3'),manifest().replace(installer,'wrong.exe'),manifest().replace(digest,'bad'),manifest().replace('size: 17','size: 0'),manifest().replace('size: 17','size: 1.5')]){
      await assert.rejects(provider({yaml}).value.getLatestVersion(),/版本|清单/);
    }
  });
  await test('拒绝 HTTP、file 和内嵌凭据附件',async()=>{
    for(const url of ['http://gitee.com/latest.yml','file:///tmp/latest.yml','https://name:password@gitee.com/latest.yml']){
      const r=release();r.assets[0].browser_download_url=url;
      await assert.rejects(provider({pages:[[r]]}).value.getLatestVersion(),/HTTPS/);
    }
  });
  await test('镜像清单中的原始 GitHub 路径按附件名映射到码云，不能借清单替换下载地址',async()=>{
    const {value}=provider({yaml:manifest().replace(installer,'https://example.invalid/'+installer)});
    assert.match((await value.getLatestVersion()).files[0].url,/^https:\/\/gitee.com\//);
  });
  await test('安装版检查后只下载一次，下载和待安装期间阻止切源及重复检查',async()=>{
    const h=updater();await h.updates.check('github');await tick();assert.equal(h.downloads,1);assert.equal(h.feed.provider,'github');
    assert.equal((await h.updates.check('gitee')).ok,false);assert.equal(h.checks,1);assert.equal(h.updates.install().ok,false);
    h.emitter.emit('update-downloaded',{version});assert.equal((await h.updates.check('github')).ok,false);assert.equal(h.updates.install().ok,true);assert.equal(h.installs,1);
  });
  await test('同来源在途检查共用请求，不同来源不能干扰当前链',async()=>{
    const h=updater(), pending=deferred();h.emitter.checkForUpdates=()=>pending.promise;
    const a=h.updates.check('github'),b=h.updates.check('github');assert.equal(a,b);assert.equal((await h.updates.check('gitee')).ok,false);
    pending.resolve({isUpdateAvailable:false});await a;
  });
  await test('下载拒绝被消费，记录错误后可换源码云重试',async()=>{
    const h=updater();h.emitter.downloadUpdate=async()=>{throw Error('checksum mismatch');};await h.updates.check('github');await tick();
    assert.equal(h.updates.snapshot().phase,'error');assert.match(h.updates.snapshot().error,/checksum/);
    await h.updates.check('gitee');assert.equal(h.feed.provider,'custom');assert.equal(h.updates.snapshot().source,'gitee');await tick();
  });
  await test('下载错误事件先于 Promise 结束时仍不能切换 Provider',async()=>{
    const h=updater(),pending=deferred();h.emitter.downloadUpdate=()=>pending.promise;await h.updates.check('github');await tick();
    h.emitter.emit('error',Error('early error'));assert.equal((await h.updates.check('gitee')).ok,false);assert.equal(h.feed.provider,'github');
    pending.reject(Error('download ended'));await tick();h.emitter.checkForUpdates=async()=>({isUpdateAvailable:false});assert.equal((await h.updates.check('gitee')).ok,true);
  });
  await test('检查异常写入主进程状态，清除旧版本和进度后可重试',async()=>{
    const h=updater();h.emitter.checkForUpdates=async()=>{throw Error('network failed');};const r=await h.updates.check('gitee');
    assert.equal(r.ok,false);assert.equal(h.updates.snapshot().phase,'error');assert.equal(r.latest,null);assert.equal(r.percent,0);
  });
  await test('便携版只检查，不执行安装包下载',async()=>{
    const h=updater(), u=createUpdates({updater:h.emitter,current:()=> '0.3.1',portable:true});await u.check('gitee');await tick();
    assert.equal(u.snapshot().phase,'available');assert.equal(h.downloads,0);
  });
  await test('无新版本保持来源和已安装版本，事件版本严格递增',async()=>{
    const e=new EventEmitter(),events=[];e.setFeedURL=()=>{};e.checkForUpdates=async()=>{e.emit('update-not-available',{version:'0.3.1'});return{isUpdateAvailable:false};};
    const u=createUpdates({updater:e,current:()=> '0.3.1',notify:value=>events.push(value)});const r=await u.check('gitee');
    assert.equal(r.phase,'not-available');assert.equal(r.source,'gitee');assert.equal(r.current,'0.3.1');assert.ok(events.every((value,index)=>index===0||value.revision>events[index-1].revision));
  });
  await test('IPC 来源与发布页只接受固定白名单，安装前不允许调用安装器',async()=>{
    const h=updater();assert.equal((await h.updates.check('https://evil.invalid')).ok,false);assert.equal(h.checks,0);
    assert.throws(()=>h.updates.releasesUrl('__proto__'),/未知/);assert.match(h.updates.releasesUrl('gitee'),/^https:\/\/gitee.com\/moyunyi\/cet-word-keeper\/releases$/);assert.equal(h.updates.install().ok,false);
  });
  const {pushAll}=await import(pathToFileURL(path.join(__dirname,'push-all.mjs')));
  function git({dirty=false,badRemote=false,failDryRun=false,failPush=false,badHash=false}={}){
    const calls=[];return {calls,run(args){calls.push(args);if(args[0]==='symbolic-ref')return'release/v0.3.1';if(args[0]==='status')return dirty?' M src/main.js':'';if(args[0]==='rev-parse')return'a'.repeat(40);
      if(args[0]==='remote')return badRemote?'https://wrong.invalid/repo.git':args.at(-1)==='origin'?'https://github.com/moshajiang/CET-WordKeeper.git':'https://gitee.com/moyunyi/cet-word-keeper.git';
      if(args[0]==='push'&&((args.includes('--dry-run')&&failDryRun&&args.includes('gitee'))||(!args.includes('--dry-run')&&failPush&&args.includes('gitee'))))throw Error('fixture rejection');
      if(args[0]==='ls-remote')return (badHash?'b':'a').repeat(40)+'\trefs/heads/release/v0.3.1';return'';}};
  }
  await test('双仓库推送预检两边后只推当前分支，并核对同一 SHA',()=>{
    const h=git();assert.equal(pushAll(h.run,()=>{}).length,2);const pushes=h.calls.filter(a=>a[0]==='push');assert.equal(pushes.length,4);
    assert.ok(pushes.slice(0,2).every(a=>a.includes('--dry-run')));assert.ok(pushes.every(a=>a.at(-1)==='HEAD:refs/heads/release/v0.3.1'&&!a.includes('--force')));
  });
  await test('脏工作区、错误远程或任一预检失败不会开始实际推送',()=>{
    for(const options of [{dirty:true},{badRemote:true},{failDryRun:true}]){const h=git(options);assert.throws(()=>pushAll(h.run,()=>{}));assert.equal(h.calls.filter(a=>a[0]==='push'&&!a.includes('--dry-run')).length,0);}
  });
  await test('部分推送或 SHA 校验失败明确非零失败，不掩盖部分完成',()=>{
    for(const options of [{failPush:true},{badHash:true}]){const h=git(options),logs=[];assert.throws(()=>pushAll(h.run,s=>logs.push(s)),/未全部完成/);assert.equal(logs.length,2);assert.ok(logs.some(s=>s.includes('✗')));}
  });
  const Vue=require('vue'),createAiTasks=require('./lib/load-ai-tasks.cjs')(__dirname);
  function settings({api={}}={}){
    const mount=[],unmount=[],values=new Map(),stops=[];
    const context=vm.createContext({...Vue,createAiTasks,console,window:{keeper:{cancelAi(){},...api}},
      localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},
      document:{documentElement:{classList:{toggle(){}}}},onMounted:fn=>mount.push(fn),onBeforeUnmount:fn=>unmount.push(fn),
      watch(...args){const stop=Vue.watch(...args);stops.push(stop);return stop;}});
    const code=fs.readFileSync(path.join(__dirname,'../src/views/SettingsView.vue'),'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?$/gm,'');
    vm.runInContext(code+'\nglobalThis.view={upd,updateSource,checkUpdate,changeUpdateSource,receiveUpdate,openReleases,installUpdate};',context);
    return{...context.view,mount,values,stop(){unmount.forEach(fn=>fn());stops.forEach(fn=>fn());}};
  }
  await test('设置切换持久化独立来源，检查和发布页均传递所选来源',async()=>{
    const calls=[],v=settings({api:{updateCheck:async source=>{calls.push(source);return{phase:'not-available',source,revision:1};},updateOpenReleases:async source=>{calls.push(source);return{ok:true};}}});
    try{v.updateSource.value='gitee';v.changeUpdateSource();assert.equal(v.values.get('keeper.update.source'),'gitee');await v.checkUpdate();await v.openReleases();assert.deepEqual(calls,['gitee','gitee']);}finally{v.stop();}
  });
  await test('迟到检查响应不覆盖下载进度，卸载后响应失效',async()=>{
    const pending=deferred(),v=settings({api:{updateCheck:()=>pending.promise}});const request=v.checkUpdate();v.receiveUpdate({phase:'downloaded',percent:100,revision:8});pending.resolve({phase:'downloading',percent:0,revision:7});await request;assert.equal(v.upd.value.phase,'downloaded');v.stop();v.receiveUpdate({phase:'error',revision:9});assert.equal(v.upd.value.phase,'downloaded');
  });
  await test('设置 IPC 拒绝会结束加载并显示错误，可再次重试',async()=>{
    const v=settings({api:{updateCheck:async()=>{throw Error('ipc failure');}}});try{await v.checkUpdate();assert.equal(v.upd.value.phase,'error');assert.match(v.upd.value.error,/ipc failure/);}finally{v.stop();}
  });
  await test('安装 IPC 拒绝显示错误，卸载后错误不写回页面',async()=>{
    const pending=deferred(),v=settings({api:{updateInstall:()=>pending.promise}});const request=v.installUpdate();v.stop();pending.reject(Error('old failure'));await request;assert.equal(v.upd.value.phase,'idle');
    const active=settings({api:{updateInstall:async()=>{throw Error('install failed');}}});try{await active.installUpdate();assert.equal(active.upd.value.phase,'error');assert.match(active.upd.value.error,/install failed/);}finally{active.stop();}
  });
  await test('设置加载完成前离页不会留下更新订阅',async()=>{
    const pending=deferred();let subscriptions=0;const v=settings({api:{info:()=>pending.promise,getSettings:async()=>({}),onUpdateEvent:()=>{subscriptions++;return()=>{};}}});const loading=v.mount[0]();v.stop();pending.resolve({});await loading;assert.equal(subscriptions,0);
  });
  console.log(`双来源更新与双仓库同步回归 ${passed}/${passed}`);
})().catch(error=>{console.error(error);process.exitCode=1;});

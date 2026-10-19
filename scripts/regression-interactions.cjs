const createAiTasks = require('./lib/load-ai-tasks.cjs')(__dirname);
// 真实主进程/组件脚本 + sql.js 内存库；磁盘和网络均拦截。
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),dependencies=process.env.KEEPER_DEPENDENCY_ROOT||root;
const req=createRequire(path.join(dependencies,'package.json')),Vue=req('vue');
const source=fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
let passed=0;const test=async(name,run)=>{await run();passed++;console.log('✓ '+name);};
(async()=>{
 const SQL=await req('sql.js')({locateFile:f=>path.join(dependencies,'node_modules/sql.js/dist',f)});
 function backend(){
  const handlers=new Map(),files=new Map();let fail=false,writes=0;
  const context=vm.createContext({createAiTasks,Buffer,Date,AbortSignal,console:{log(){},error(){}},process:{env:{},platform:'win32'},__dirname:path.join(root,'electron'),
   fetch:async()=>({ok:true,json:async()=>({choices:[{message:{content:'OK'}}]})}),require(name){
    if(name==='electron')return{app:{disableHardwareAcceleration(){},requestSingleInstanceLock:()=>true,on(){},whenReady:()=>({then(){}})},ipcMain:{handle:(n,f)=>handlers.set(n,f)},dialog:{},shell:{}};
    if(name==='electron-updater')return{autoUpdater:{on(){}}};
    if(name==='fs')return{...fs,writeFileSync(file,bytes){if(fail)throw Error('disk full');files.set(file,typeof bytes==='string'?bytes:Buffer.from(bytes));writes++;},renameSync(){}};
    return name.startsWith('./')?req(path.join(fs.existsSync(path.join(root,'electron',name))?root:dependencies,'electron',name)):req(name);
   }});
  vm.runInContext(source+`\nglobalThis.h={setup(SQL){sqlModule=SQL;db=new SQL.Database();db.run(SCHEMA);migrate();dbPath='memory.db';registerIpc();},q,run,aiComplete,exportDb(){return db.export();},reopen(SQL,bytes){db.close();db=new SQL.Database(new Uint8Array(bytes));}};`,context);context.h.setup(SQL);
  return{...context.h,files,context,call:(name,...args)=>handlers.get(name)(null,...args),get writes(){return writes;},set fail(value){fail=value;}};
 }
 function words(h){
  for(const [id,word,status,meaning,definition,hits] of [[1,'alpha','learning','甲','',1],[2,'beta','mastered','乙','',3],[3,'gamma','learning','','Last meaning',2],[4,'percent','learning','100%_sure','',0]]){
   h.run('INSERT INTO dict(word,translation,definition) VALUES (?,?,?)',[word,meaning,definition]);h.run('INSERT INTO user_word(id,word,status,created_at) VALUES (?,?,?,?)',[id,word,status,'2026-10-19T00:00:0'+id+'Z']);
   for(let n=0;n<hits;n++)h.run('INSERT INTO word_hit(word,sentence) VALUES (?,?)',[word,'Example '+n]);
  }
 }
 await test('生词列表组合筛选、中文/英文释义、大小写与空白搜索有效',()=>{
  const h=backend();words(h);assert.deepEqual(plain(h.call('words:list',{status:'learning',search:' ALP '})).map(r=>r.word),['alpha']);
  assert.equal(h.call('words:list',{status:'mastered',search:'甲'}).length,0);assert.equal(h.call('words:list',{search:'乙'})[0].word,'beta');assert.equal(h.call('words:list',{search:'meaning'})[0].word,'gamma');
 });
 await test('搜索按字面匹配百分号、下划线与引号，不扩展为 SQL 通配或注入',()=>{
  const h=backend();words(h);assert.equal(h.call('words:list',{search:'%_'})[0].word,'percent');assert.equal(h.call('words:list',{search:"' OR 1=1 --"}).length,0);
 });
 await test('三种排序有确定结果，Anki 导出与当前列表的筛选及顺序一致',async()=>{
  const h=backend();words(h);
  for(const sortBy of ['time','hits','word']){
   const filter={status:'learning',search:'a',sortBy},expected=h.call('words:list',filter).map(r=>r.word);
   const result=await h.call('export:anki',{...filter,targetPath:'anki.txt'});assert.equal(result.count,expected.length);
   const actual=h.files.get('anki.txt').split('\n').filter(line=>!line.startsWith('#')&&!line.startsWith('\ufeff#')).map(line=>line.split('\t')[0]);assert.deepEqual(actual,plain(expected));
  }
  assert.deepEqual(plain(h.call('words:list',{sortBy:'hits'}).map(r=>r.word)),['beta','gamma','alpha','percent']);
 });
 await test('无匹配结果的导出不创建文件，不会退回全部词汇',async()=>{
  const h=backend();words(h);assert.equal((await h.call('export:anki',{search:'missing',targetPath:'empty.txt'})).error,'empty');assert.equal(h.files.has('empty.txt'),false);
 });
 await test('复习操作 ID 重放只保存一次；同 ID 不允许换词或评分',()=>{
  const h=backend();words(h);const first=h.call('review:answer','alpha',2,'operation-1');assert.equal(first.ok,true);
  assert.equal(h.call('review:answer','alpha',2,'operation-1').duplicate,true);assert.equal(h.q('SELECT COUNT(*) n FROM review_log')[0].n,1);assert.equal(h.q("SELECT reps FROM user_word WHERE word='alpha'")[0].reps,1);
  assert.equal(h.call('review:answer','gamma',2,'operation-1').error,'operation_conflict');assert.equal(h.call('review:answer','alpha',0,'operation-1').error,'operation_conflict');
 });
 await test('操作防重信息重启后仍有效，忘记的词不被当成未学新词立即返回',()=>{
  const h=backend();words(h);h.call('review:answer','alpha',0,'forgot-1');h.reopen(SQL,h.exportDb());
  assert.equal(h.call('review:answer','alpha',0,'forgot-1').duplicate,true);assert.equal(h.call('review:queue').fresh.some(r=>r.word==='alpha'),false);
 });
 await test('复习写盘失败时调度、日志和操作 ID 全部恢复，原 ID 可以重试',()=>{
  const h=backend();words(h);h.fail=true;assert.match(h.call('review:answer','alpha',2,'retry-1').error,/disk full/);
  assert.equal(h.q('SELECT COUNT(*) n FROM review_log')[0].n,0);assert.equal(h.q('SELECT COUNT(*) n FROM review_operation')[0].n,0);assert.equal(h.q("SELECT reps FROM user_word WHERE word='alpha'")[0].reps,0);
  h.fail=false;assert.equal(h.call('review:answer','alpha',2,'retry-1').ok,true);
 });
 await test('无效评分、已掌握或已删除词不会推进调度',()=>{
  const h=backend();words(h);for(const rating of [-1,3,'2',null])assert.equal(h.call('review:answer','alpha',rating).ok,false);
  assert.equal(h.call('review:answer','beta',2).error,'word_not_learning');assert.equal(h.call('review:answer','missing',2).error,'word_missing');assert.equal(h.writes,0);
 });
 const settings={api_base:'https://example.invalid/v1',api_key:'test-only-a',api_model:'model-a'};
 const reply=content=>({ok:true,json:async()=>({choices:[{message:{content}}]})});
 await test('连接测试每次发真实请求，忽略翻译缓存且不修改设置或缓存',async()=>{
  const h=backend();let calls=0;h.context.fetch=async()=>{calls++;return reply('OK');};h.call('settings:set',settings);
  await h.call('ai:translate','Hello, this is a connection test.');const cache=h.q('SELECT * FROM ai_cache').length,stored=plain(h.call('settings:get'));
  await h.call('ai:testConnection',settings);await h.call('ai:testConnection',{...settings,api_model:'model-b'});assert.equal(calls,3);assert.equal(h.q('SELECT * FROM ai_cache').length,cache);assert.deepEqual(plain(h.call('settings:get')),stored);
 });
 await test('错 Key、空配置、坏地址、空响应都不会显示连接成功',async()=>{
  const h=backend();h.context.fetch=async()=>({ok:false,status:401});assert.equal((await h.call('ai:testConnection',settings)).error,'api_401');
  assert.equal((await h.call('ai:testConnection',{})).error,'no_key');assert.equal((await h.call('ai:testConnection',{...settings,api_base:'file:///bad'})).error,'bad_base');
  h.context.fetch=async()=>reply('');assert.equal((await h.call('ai:testConnection',settings)).error,'bad_response');
 });
 await test('超时中止真实请求，并返回明确失败',async()=>{
  const h=backend();h.context.fetch=(_url,opts)=>new Promise((_r,reject)=>opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true}));
  const keepAlive=setTimeout(()=>{},200);try{assert.equal((await h.aiComplete(settings,[{role:'user',content:'test'}],0,10)).error,'timeout');}finally{clearTimeout(keepAlive);}
 });
 await test('普通 AI 缓存按接口、模型、凭据与提示词隔离，旧缓存不会误用',async()=>{
  const h=backend();let calls=0;h.context.fetch=async()=>reply('response '+(++calls));h.call('settings:set',settings);
  assert.equal((await h.call('ai:translate','Same text')).cached,false);assert.equal((await h.call('ai:translate','Same text')).cached,true);
  for(const patch of [{api_model:'model-b'},{api_key:'test-only-b'},{api_base:'https://other.invalid/v1'}]){h.call('settings:set',patch);assert.equal((await h.call('ai:translate','Same text')).cached,false);}
  h.call('settings:set',{api_key:''});assert.equal((await h.call('ai:translate','Same text')).error,'no_key');assert.equal(calls,4);
  assert.ok(!JSON.stringify(h.q('SELECT * FROM ai_cache')).includes('test-only'));
 });
 await test('缓存损坏会重新请求；在途切换配置仍写入原请求身份',async()=>{
  const h=backend();h.call('settings:set',settings);h.context.fetch=async()=>reply('original');await h.call('ai:translate','text');h.run("UPDATE ai_cache SET response='broken'");
  let finish;h.context.fetch=()=>new Promise(resolve=>{finish=resolve;});const pending=h.call('ai:translate','text');h.call('settings:set',{api_model:'model-b'});finish(reply('old model'));
  await pending;h.context.fetch=async()=>reply('new model');assert.equal((await h.call('ai:translate','text')).response.content,'new model');
 });
 await test('旧版本不带配置身份的缓存不会覆盖新接口结果',async()=>{
  const h=backend(),hash=require('node:crypto').createHash('sha256').update('translate:legacy').digest('hex');
  h.run('INSERT INTO ai_cache(hash,response) VALUES (?,?)',[hash,JSON.stringify({content:'old cached success'})]);
  assert.equal((await h.call('ai:translate','legacy')).error,'no_key');h.call('settings:set',settings);h.context.fetch=async()=>reply('new endpoint result');
  assert.equal((await h.call('ai:translate','legacy')).response.content,'new endpoint result');
 });
 function component(file,exports,keeper,{timers=false}={}){
  const stops=[],unmount=[],scheduled=new Map();let id=0;
  const script=fs.readFileSync(path.join(root,'src/views',file),'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?$/gm,'');
  const context=vm.createContext({createAiTasks,...Vue,window:{keeper},console,Date,Math,crypto:globalThis.crypto,localStorage:{getItem:()=>null},document:{documentElement:{classList:{toggle(){}}},addEventListener(){},removeEventListener(){}},
   watch(...args){const stop=Vue.watch(...args);stops.push(stop);return stop;},onMounted(){},onBeforeUnmount:fn=>unmount.push(fn),
   setTimeout:timers?(fn=>{scheduled.set(++id,fn);return id;}):setTimeout,clearTimeout:timers?(n=>scheduled.delete(n)):clearTimeout});
  vm.runInContext(script+'\nglobalThis.view={'+exports+'};',context);
  return{...context.view,async timers(){const batch=[...scheduled.values()];scheduled.clear();for(const fn of batch)fn();await new Promise(r=>setImmediate(r));},stop(){unmount.forEach(fn=>fn());stops.forEach(fn=>fn());}};
 }
 await test('真实生词本状态切换立即查，搜索防抖合并输入，排序也会刷新',async()=>{
  const calls=[];const view=component('WordBook.vue','filter,sortBy,rows,loading,load',{listWords:async f=>{calls.push(f);return[{word:f.search||'alpha'}];}},{timers:true});
  try{await view.load();view.filter.value.status='mastered';await Vue.nextTick();assert.equal(calls.length,2);view.filter.value.search='a';view.filter.value.search='al';assert.equal(calls.length,2);await view.timers();assert.equal(calls.length,3);assert.equal(view.rows.value[0].word,'al');view.sortBy.value='hits';await Vue.nextTick();assert.equal(calls[3].sortBy,'hits');}finally{view.stop();}
 });
 await test('搜索防抖窗口内旧结果、旧错误和卸载后的返回不能覆盖新列表',async()=>{
  let finish,reject;const view=component('WordBook.vue','filter,rows,load,loadError',{listWords:()=>new Promise((r,j)=>{finish=r;reject=j;})},{timers:true});
  const first=view.load();view.filter.value.search='new';reject(Error('old error'));await first;assert.equal(view.loadError.value,'');
  const second=view.load();view.stop();finish([{word:'stale'}]);await second;assert.equal(view.rows.value.length,0);
 });
 await test('生词详情迟到返回不会串词或重新打开已经关闭的抽屉',async()=>{
  const pending=new Map();const view=component('WordBook.vue','drawer,openDetail,closeDetail',{wordDetail:w=>new Promise(r=>pending.set(w,r))});
  try{const a=view.openDetail('alpha'),b=view.openDetail('beta');pending.get('beta')({userWord:{status:'mastered'},tags:[]});await b;pending.get('alpha')({userWord:{status:'learning'}});await a;assert.equal(view.drawer.value.word,'beta');const c=view.openDetail('gamma');view.closeDetail();pending.get('gamma')({});await c;assert.equal(view.drawer.value.word,null);}finally{view.stop();}
 });
 await test('真实生词本导出捕获搜索、状态和排序；切换筛选后旧导出提示不覆盖新界面',async()=>{
  let finish,received;const view=component('WordBook.vue','filter,sortBy,load,exportAnki,ankiMsg,exporting',{
   listWords:async()=>[{word:'alpha'}],exportAnki:filter=>{received=filter;return new Promise(resolve=>{finish=resolve;});}
  },{timers:true});
  try{view.filter.value={status:'learning',search:'alp'};view.sortBy.value='hits';await view.load();const request=view.exportAnki();assert.deepEqual(plain(received),{status:'learning',search:'alp',sortBy:'hits'});view.filter.value.search='new';finish({ok:true,count:1,path:'file.txt'});await request;assert.equal(view.ankiMsg.value,'');assert.equal(view.exporting.value,false);}finally{view.stop();}
 });
 const review=(api)=>component('ReviewView.vue','list,idx,started,revealed,answering,doneCount,answer,errorMsg,onKey,load',api);
 const prepare=r=>{r.list.value=[{word:'alpha'},{word:'beta'},{word:'gamma'}];r.started.value=true;r.revealed.value=true;};
 await test('真实复习组件连点和数字键同时进入只评一次，不跳过下一词',async()=>{
  let finish,calls=0;const r=review({reviewAnswer:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});prepare(r);
  try{const first=r.answer(2);await r.answer(2);r.onKey({key:'3',target:{},preventDefault(){}});assert.equal(calls,1);assert.equal(r.answering.value,true);finish({ok:true,interval:1});await first;assert.equal(r.idx.value,1);assert.equal(r.list.value[r.idx.value].word,'beta');assert.equal(r.doneCount.value,1);}finally{r.stop();}
 });
 await test('复习请求失败不前进；回执丢失重试复用操作 ID 和原评分',async()=>{
  const calls=[];let failed=true;const r=review({reviewAnswer:async(...args)=>{calls.push(args);if(failed){failed=false;throw Error('lost reply');}return{ok:true,interval:1,duplicate:true};}});prepare(r);
  try{await r.answer(0);assert.equal(r.idx.value,0);assert.equal(r.revealed.value,true);assert.match(r.errorMsg.value,/重试/);await r.answer(2);assert.equal(calls[0][2],calls[1][2]);assert.equal(calls[1][1],0);assert.equal(r.idx.value,1);assert.equal(r.list.value.at(-1).word,'alpha');}finally{r.stop();}
 });
 await test('复习组件离开后忽略迟到结果，键盘长按和输入控件不评分',async()=>{
  let finish,calls=0;const r=review({reviewAnswer:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});prepare(r);
  r.onKey({key:'3',repeat:true,target:{}});r.onKey({key:'3',target:{tagName:'INPUT'}});assert.equal(calls,0);
  const request=r.answer(2);r.stop();finish({ok:true});await request;assert.equal(r.idx.value,0);
 });
 await test('设置组件测试当前表单，不调用缓存翻译或覆盖已保存配置',async()=>{
  let calls=0;const view=component('SettingsView.vue','form,testConn,testOk,testing',{testConnection:async config=>{calls++;assert.equal(config.api_model,'typed-model');return{ok:true,response:{content:'OK'}};}});
  try{view.form.value={...settings,api_model:'typed-model'};await view.testConn();assert.equal(view.testOk.value,true);assert.equal(view.testing.value,false);assert.equal(calls,1);}finally{view.stop();}
 });
 await test('设置修改后旧测试结果失效，失败时按钮恢复可用',async()=>{
  let finish;const api={testConnection:()=>new Promise(resolve=>{finish=resolve;})};const view=component('SettingsView.vue','form,testConn,testOk,testMsg,testing',api);
  try{view.form.value={...settings};const request=view.testConn();view.form.value.api_key='different';finish({ok:true,response:{content:'old success'}});await request;assert.equal(view.testOk.value,false);assert.equal(view.testMsg.value,'');api.testConnection=async()=>{throw Error('offline');};await view.testConn();assert.equal(view.testing.value,false);assert.match(view.testMsg.value,/offline/);}finally{view.stop();}
 });
 console.log(`筛选/复习/连接回归 ${passed}/${passed} 通过`);
})().catch(error=>{console.error(error);process.exitCode=1;});

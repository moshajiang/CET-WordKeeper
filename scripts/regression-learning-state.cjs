const createPageAssistant = require('./lib/load-page-assistant.cjs');
const createAiTasks = require('./lib/load-ai-tasks.cjs')(__dirname);
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),dependencies=process.env.KEEPER_DEPENDENCY_ROOT||root;
const req=createRequire(path.join(dependencies,'package.json')),Vue=req('vue');
const main=fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
let passed=0;const test=async(name,run)=>{await run();passed++;console.log('✓ '+name);};
function loadComposable(file,name){const code=fs.readFileSync(path.join(root,'src/composables',file),'utf8').replace(/^import .*;\r?$/gm,'').replace('const pageAssistant = usePageAssistant();', 'const pageAssistant = createPageAssistant({getApi:()=>window.keeper});').replace(/^export /gm,'');return vm.runInNewContext(code+'\n'+name+';',{...Vue,Promise,Map,Set,Date,setTimeout,clearTimeout});}
(async()=>{
 const SQL=await req('sql.js')({locateFile:f=>path.join(dependencies,'node_modules/sql.js/dist',f)});
 function backend({seed=false,clock=Date.now()}={}){
  const handlers=new Map(),events=[];let fail=false;
  class ClockDate extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
  const context=vm.createContext({createAiTasks,createPageAssistant,Buffer,Date:ClockDate,console:{log(){},error(){}},__dirname:path.join(root,'electron'),process:{env:{},platform:'win32'},require(name){
   if(name==='electron')return{app:{disableHardwareAcceleration(){},requestSingleInstanceLock:()=>true,on(){},whenReady:()=>({then(){}})},ipcMain:{handle:(n,f)=>handlers.set(n,f)},dialog:{},shell:{}};
   if(name==='electron-updater')return{autoUpdater:{on(){}}};
   if(name==='fs')return{...fs,writeFileSync(){if(fail)throw Error('disk full');},renameSync(){}};
   return name.startsWith('./')?req(path.join(fs.existsSync(path.join(root,'electron',name))?root:dependencies,'electron',name)):req(name);
  }});
  vm.runInContext(main+`\nglobalThis.h={setup(SQL,bytes){sqlModule=SQL;db=bytes?new SQL.Database(new Uint8Array(bytes)):new SQL.Database();db.run(SCHEMA);migrate();buildFormIndex();dbPath='memory.db';win={isDestroyed:()=>false,webContents:{send:(n,e)=>globalThis.emit(n,e)}};registerIpc();},q,run,buildFormIndex};`,context);
  context.emit=(name,event)=>events.push({name,event:plain(event)});
  context.h.setup(SQL,seed?fs.readFileSync(path.join(dependencies,'data/keeper.db')):null);
  return{...context.h,events,call:(n,...args)=>handlers.get(n)(null,...args),set fail(value){fail=value;},set clock(value){clock=value;}};
 }
 await test('实际分发词典中批量词形与查词逐项一致，包括不规则和缩写',()=>{
  const h=backend({seed:true}),words=['running','went','making','were','children',"DON’T",'left','constructor','unknownzzzs'];
  const result=h.call('dict:resolveBatch',words);
  for(const word of words)assert.equal(result[word],h.call('dict:lookup',word).word);
  assert.equal(result.running,'run');assert.equal(result.went,'go');assert.equal(result.making,'make');assert.equal(result.were,'be');
 });
 await test('批量查询只读、拒绝超长/非法载荷，重复词只返回一项',()=>{
  const h=backend();for(const words of [null,['ok',3],['a'.repeat(129)],Array(1001).fill('word'),['__proto__']])assert.throws(()=>h.call('dict:resolveBatch',words),/invalid_word_batch/);
  assert.deepEqual(Object.keys(h.call('dict:resolveBatch',['alpha','alpha'])),['alpha']);assert.equal(h.events.length,0);
 });
 await test('重新收藏已掌握词返回原状态，失败变更回滚且不通知界面',()=>{
  const h=backend();h.run("INSERT INTO passage(id,content) VALUES (1,'Valid source.')");h.call('words:add','alpha','sentence',1);h.call('words:setStatus','alpha','mastered');const r=h.call('words:add','alpha','other sentence',1);assert.equal(r.status,'mastered');
  const count=h.events.length;h.fail=true;assert.throws(()=>h.call('words:remove','alpha'),/disk full/);assert.equal(h.q('SELECT status FROM user_word')[0].status,'mastered');assert.equal(h.events.length,count);
 });
 await test('新增、改状态、删除和复习只在保存成功后发变更事件，重放评分不重复通知',()=>{
  const h=backend();h.call('words:add','alpha','',null);h.call('words:setStatus','alpha','learning');h.call('review:answer','alpha',2,'review-once');const count=h.events.length;
  h.call('review:answer','alpha',2,'review-once');assert.equal(h.events.length,count);h.call('words:remove','alpha');
  assert.deepEqual(h.events.map(e=>e.event.kind),['words','words','review','words']);assert.ok(h.events.every(e=>e.name==='learning:changed'));
 });
 await test('今日复习按本地午夜区间统计，包含起点并排除次日午夜和昨日',()=>{
  const now=new Date(2026,9,19,0,30).getTime(),h=backend({clock:now});const start=new Date(2026,9,19).toISOString(),end=new Date(2026,9,20).toISOString();
  for(const time of [new Date(Date.parse(start)-1).toISOString(),start,new Date(now).toISOString(),end])h.run('INSERT INTO review_log(reviewed_at) VALUES (?)',[time]);
  const stats=h.call('stats:summary');assert.equal(stats.reviewedToday,2);assert.equal(stats.dayEnd,end);h.clock=new Date(2026,9,20,0,1).getTime();assert.equal(h.call('stats:summary').reviewedToday,1);
 });
 await test('统计排除归档考次，并提供下一到期时间用于定时刷新',()=>{
  const h=backend({clock:Date.parse('2026-10-19T00:00:00Z')});h.run("INSERT INTO exam(id,retired) VALUES (1,0),(2,1)");h.run("INSERT INTO user_word(word,status,due) VALUES ('alpha','learning','2026-10-19T00:00:05.000Z'),('beta','mastered','2026-10-19T00:00:01.000Z')");
  let stats=h.call('stats:summary');assert.equal(stats.exams,1);assert.equal(stats.nextDue,'2026-10-19T00:00:05.000Z');assert.equal(stats.dueNow,0);h.clock=Date.parse(stats.nextDue);stats=h.call('stats:summary');assert.equal(stats.dueNow,1);assert.equal(stats.nextDue,null);
 });
 await test('本地日期转换兼容中国午夜，以及夏令时 23/25 小时日',()=>{
  const helper=path.join(root,'electron/local-day.cjs');
  for(const [tz,date,hours,expectedStart] of [['Asia/Shanghai',[2026,9,19],24,'2026-10-18T16:00:00.000Z'],['America/New_York',[2026,2,8],23,null],['America/New_York',[2026,10,1],25,null]]){
   const script=`const {localDayRange}=require(${JSON.stringify(helper)});console.log(JSON.stringify(localDayRange(new Date(${date.join(',')},12))));`;
   const result=spawnSync(process.execPath,['-e',script],{env:{...process.env,TZ:tz},encoding:'utf8'});assert.equal(result.status,0,result.stderr);const range=JSON.parse(result.stdout);assert.equal((Date.parse(range.end)-Date.parse(range.start))/3600000,hours);if(expectedStart)assert.equal(range.start,expectedStart);
  }
 });
 const useWordLemmas=loadComposable('useWordLemmas.js','useWordLemmas');
 await test('词形缓存去重、并发共享和曲引号规范化，不为每个 token 发 IPC',async()=>{
  let finish,calls=0;const state=useWordLemmas(words=>{calls++;assert.deepEqual(plain(words),['running',"don't"]);return new Promise(resolve=>{finish=resolve;});});
  const a=state.ensureWords(['Running','running',"DON’T"]),b=state.ensureWords(['running']);await Promise.resolve();assert.equal(calls,1);finish({running:'run',"don't":'do'});await Promise.all([a,b]);assert.equal(state.lemmaOf('Running'),'run');assert.equal(state.lemmaOf('DON’T'),'do');await state.ensureWords(['running']);assert.equal(calls,1);
 });
 await test('大篇章分批不超过 1000 个词，不重叠批次结果安全合并',async()=>{
  const calls=[];const state=useWordLemmas(async words=>{calls.push(words);return Object.fromEntries(words.map(w=>[w,w]));});const word=n=>'word'+n.toString(26).split('').map(c=>String.fromCharCode(97+parseInt(c,26))).join('');
  const words=Array.from({length:2200},(_,n)=>word(n));await state.ensureWords(words);assert.deepEqual(calls.map(c=>c.length),[1000,1000,200]);assert.equal(state.lemmas.value.size,2200);
 });
 await test('词形失败可重试，不猜后缀，constructor 键不会读取原型',async()=>{
  let calls=0;const state=useWordLemmas(async words=>{if(++calls===1)throw Error('IPC failed');return Object.fromEntries(words.map(w=>[w,w==='running'?'run':w]));});
  assert.equal(await state.ensureWords(['running']),false);assert.equal(state.lemmaOf('running'),'running');assert.equal(await state.ensureWords(['running','constructor']),true);assert.equal(state.lemmaOf('constructor'),'constructor');
 });
 const createLearningState=loadComposable('useLearningState.js','createLearningState');
 const snapshot=(patch={})=>({learning:0,mastered:0,dueNow:0,reviewedToday:0,exams:78,...patch});
 function statsHarness(load){
  const hostEvents=new Map(),docEvents=new Map(),timers=new Map();let id=0,now=Date.parse('2026-10-19T00:00:00Z'),notify,off=0;
  const host={addEventListener:(n,f)=>hostEvents.set(n,f),removeEventListener:n=>hostEvents.delete(n)};
  const doc={visibilityState:'visible',addEventListener:(n,f)=>docEvents.set(n,f),removeEventListener:n=>docEvents.delete(n)};
  const state=createLearningState({load,subscribe:callback=>{notify=callback;return()=>{off++;};},host,visibility:doc,clock:()=>now,setTimer:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimer:n=>timers.delete(n)});
  return{...state,hostEvents,docEvents,timers,doc,get notify(){return notify;},get off(){return off;},set now(value){now=value;}};
 }
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 await test('首页和侧栏共享进行中的读取，请求完成后使用同一快照',async()=>{
  let finish,calls=0;const state=statsHarness(()=>{calls++;return new Promise(r=>{finish=r;});});const first=state.start(),second=state.refresh();assert.equal(first,second);assert.equal(calls,1);finish(snapshot({dueNow:2}));await first;assert.equal(state.stats.value.dueNow,2);state.stop();
 });
 await test('变更通知使在途旧统计失效，并把多次通知合并为一次重读',async()=>{
  const pending=[];const state=statsHarness(()=>new Promise(resolve=>pending.push(resolve)));const first=state.start();state.notify({kind:'review'});state.notify({kind:'words'});pending.shift()(snapshot({dueNow:9}));await tick();assert.equal(state.stats.value.dueNow,0);assert.equal(pending.length,1);pending.shift()(snapshot({dueNow:1}));await first;assert.equal(state.stats.value.dueNow,1);state.stop();
 });
 await test('下一到期时间和午夜调度刷新；聚焦/恢复可见后也刷新',async()=>{
  let calls=0;const state=statsHarness(async()=>snapshot({dueNow:++calls,nextDue:'2026-10-19T00:00:05.000Z',dayEnd:'2026-10-19T16:00:00.000Z'}));await state.start();assert.equal([...state.timers.values()][0].delay,5000);
  state.now=Date.parse('2026-10-19T00:00:05Z');[...state.timers.values()][0].fn();await tick();assert.equal(state.stats.value.dueNow,2);state.hostEvents.get('focus')();await tick();assert.equal(calls,3);state.docEvents.get('visibilitychange')();await tick();assert.equal(calls,4);state.stop();
 });
 await test('本地午夜即使不切页也刷新今日数，错误读取保留原快照并可重试',async()=>{
  let next=snapshot({reviewedToday:4,dayEnd:'2026-10-19T00:00:00.010Z'});const state=statsHarness(async()=>{if(next instanceof Error)throw next;return next;});await state.start();assert.equal([...state.timers.values()][0].delay,10);
  state.now=Date.parse('2026-10-19T00:00:00.010Z');next=snapshot({reviewedToday:0});[...state.timers.values()][0].fn();await tick();assert.equal(state.stats.value.reviewedToday,0);next=Error('read failed');await state.invalidate();assert.equal(state.stats.value.reviewedToday,0);assert.match(state.error.value,/read failed/);next=snapshot({reviewedToday:1});await state.invalidate();assert.equal(state.error.value,'');state.stop();
 });
 await test('IPC 返回时刚好跨过到期边界会立即补读，失败时不会高速重试',async()=>{
  let finish;const state=statsHarness(()=>new Promise(resolve=>{finish=resolve;}));const request=state.start();state.now=Date.parse('2026-10-19T00:00:01Z');finish(snapshot({nextDue:'2026-10-19T00:00:00.010Z'}));await request;assert.equal([...state.timers.values()][0].delay,1);state.stop();
  const failed=statsHarness(async()=>{throw Error('offline');});await failed.start();assert.equal([...failed.timers.values()][0].delay,60000);failed.stop();
 });
 await test('停止时移除订阅和定时器，重挂载不会采用旧请求结果',async()=>{
  const pending=[];const state=statsHarness(()=>new Promise(r=>pending.push(r)));const first=state.start();state.stop();assert.equal(state.hostEvents.size,0);assert.equal(state.docEvents.size,0);assert.equal(state.timers.size,0);assert.equal(state.off,1);
  const second=state.start();pending.shift()(snapshot({dueNow:99}));await tick();assert.equal(state.stats.value.dueNow,0);pending.shift()(snapshot({dueNow:3}));await Promise.all([first,second]);assert.equal(state.stats.value.dueNow,3);state.stop();
 });
 await test('真实阅读器 computed 随后端词形结果重算，高亮与难词标记都使用原形',async()=>{
  let finish;const mapping=useWordLemmas(()=>new Promise(r=>{finish=r;}));const script=fs.readFileSync(path.join(root,'src/views/ReaderView.vue'),'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?$/gm,'').replace('const pageAssistant = usePageAssistant();', 'const pageAssistant = createPageAssistant({getApi:()=>window.keeper});');
  const context=vm.createContext({createAiTasks,createPageAssistant,...Vue,useWordLemmas:()=>mapping,useAlignmentLex:()=>({lex:Vue.ref(null),ensureLex(){}}),createEssayDrafts:()=>({flush:async()=>true}),createAnswerDrafts:()=>({flush:async()=>true}),defineProps:()=>({examId:'1'}),useRouter:()=>({}),localStorage:{},window:{keeper:{}},document:{},tokenize:()=>[],onMounted(){},onBeforeUnmount(){},onBeforeRouteLeave(){},onBeforeRouteUpdate(){},watch(){},setTimeout:()=>1,clearTimeout(){}});
  vm.runInContext(script+'\nglobalThis.r={wordClass,userWords,scanOn,hardWords,detail,activeIdx,scanHard};',context);const r=context.r;r.userWords.value={run:'learning',go:'mastered'};r.scanOn.value=true;r.hardWords.value=[{word:'run'}];const color=Vue.computed(()=>r.wordClass({t:'w',text:'running'}));assert.equal(color.value,'');const loading=mapping.ensureWords(['running','went']);await Promise.resolve();finish({running:'run',went:'go'});await loading;assert.equal(color.value,'marked hard');assert.equal(r.wordClass({t:'w',text:'went'}),'marked mastered');
  r.detail.value={exam:{level:'CET4'},passages:[{id:1,content:'old'},{id:2,content:'new'}]};let scanned;context.window.keeper.scanHard=()=>new Promise(resolve=>{scanned=resolve;});const pending=r.scanHard();r.activeIdx.value=1;r.hardWords.value=[];scanned([{word:'old'}]);await pending;assert.equal(r.hardWords.value.length,0);
 });
 console.log(`词形/日期/共享统计回归 ${passed}/${passed} 通过`);
})().catch(error=>{console.error(error);process.exitCode=1;});

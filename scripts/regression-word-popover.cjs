const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),dependencies=process.env.KEEPER_DEPENDENCY_ROOT||root,req=createRequire(path.join(dependencies,'package.json')),Vue=req('vue');
const plain=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
let passed=0;const test=async(name,work)=>{await work();passed++;console.log('✓ '+name);};
(async()=>{
 const load=async file=>import('data:text/javascript,'+encodeURIComponent(fs.readFileSync(path.join(dependencies,'src',file),'utf8')));
 const tokens=await load('utils/tokens.js'),bilingual=await load('utils/bilingual.js'),{createAiTasks}=await load('utils/ai-tasks.js');
 const source=fs.readFileSync(path.join(root,'src/views/ReaderView.vue'),'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?$/gm,'');
 const response=word=>({word,inBook:false,found:true,entry:{translation:word},tags:[]});
 async function reader(keeper={}){
  const props=Vue.reactive({examId:'1'}),stops=[],unmount=[],timers=new Map();let timer=0,selection='',now=0;
  const context=vm.createContext({...Vue,...tokens,...bilingual,createAiTasks,defineProps:()=>props,useRouter:()=>({}),localStorage:{getItem:()=>null,setItem(){}},
   window:{keeper:{allWords:async()=>({}),chatHistory:async()=>[],...keeper},getSelection:()=>selection,removeEventListener(){}},document:{querySelector:()=>null,removeEventListener(){}},
   createAnswerDrafts:()=>({flush:async()=>true}),createEssayDrafts:()=>({flush:async()=>true,recover:()=>null}),useWordLemmas:()=>({lemmaOf:keeper.lemmaOf || (word=>word.toLowerCase()==='running'?'run':word.toLowerCase()),ensureWords:async()=>{}}),useAlignmentLex:()=>({lex:Vue.ref(null),ensureLex(){}}),
   onMounted(){},onBeforeUnmount:fn=>unmount.push(fn),onBeforeRouteLeave(){},onBeforeRouteUpdate(){},watch(...args){const stop=Vue.watch(...args);stops.push(stop);return stop;},setTimeout(fn,delay){timers.set(++timer,{fn,at:now+delay});return timer;},clearTimeout:id=>timers.delete(id),renderMarkdown:String,console});
  vm.runInContext(source+'\nglobalThis.r={detail,activeIdx,popover,userWords,toast,selMenu,onWordClick,onWordDblClick,addFromPopover,removeFromPopover,quickAdd,wordBusy,retryLookup,onDocClick,onMouseUp,refreshUserWords,showToast};',context);
  const view=context.r;view.detail.value={exam:{id:1,level:'CET4'},passages:[{id:11,section:'reading',content:'Alpha running beta.'},{id:12,section:'reading',content:'Other beta.'}]};await Vue.nextTick();
  return{...view,props,timers,api:context.window.keeper,set selection(value){selection=value;},advance(ms){now+=ms;for(const [id,task] of [...timers])if(task.at<=now){timers.delete(id);task.fn();}},stop(){unmount.forEach(fn=>fn());stops.forEach(fn=>fn());}};
 }
 const click=(v,word,text=word+' sentence.')=>{const para=tokens.tokenize(text),token=para.find(t=>t.t==='w'&&t.text===word);assert.ok(token);return v.onWordClick({clientX:10,clientY:20},token,para);};
 const dbl=(v,word,text=word+' sentence.')=>{const para=tokens.tokenize(text);return v.onWordDblClick(para.find(t=>t.t==='w'&&t.text===word),para);};
 await test('连续查词逆序返回时保留最新词及它自己的原句',async()=>{
  const a=deferred(),b=deferred(),v=await reader({lookup:word=>word==='alpha'?a.promise:b.promise});try{const first=click(v,'alpha'),second=click(v,'beta');b.resolve(response('beta'));await second;a.resolve(response('alpha'));await first;assert.equal(v.popover.value.data.word,'beta');assert.equal(v.popover.value.ctx,'beta sentence.');assert.equal(v.popover.value.loading,false);}finally{v.stop();}
 });
 await test('旧请求失败不污染新气泡；当前失败可在原上下文重试',async()=>{
  const old=deferred();let fail=true;const v=await reader({lookup:word=>word==='alpha'?old.promise:fail?Promise.reject(Error('read blocked')):Promise.resolve(response(word))});try{const first=click(v,'alpha');await click(v,'beta');assert.match(v.popover.value.error,/read blocked/);old.reject(Error('obsolete'));await first;assert.doesNotMatch(v.popover.value.error,/obsolete/);fail=false;await v.retryLookup();assert.equal(v.popover.value.data.word,'beta');assert.equal(v.popover.value.ctx,'beta sentence.');assert.equal(v.popover.value.error,'');}finally{v.stop();}
 });
 await test('关闭气泡或切篇后迟到查询不能重新显示或留下可收藏的旧词',async()=>{
  for(const action of ['close','passage','exam','unmount']){const request=deferred(),v=await reader({lookup:()=>request.promise});const pending=click(v,'alpha');if(action==='close')v.onDocClick();if(action==='passage'){v.activeIdx.value=1;await Vue.nextTick();}if(action==='exam')v.props.examId='2';if(action==='unmount')v.stop();request.resolve(response('alpha'));await pending;assert.equal(v.popover.value.data,null);if(action!=='unmount')v.stop();}
 });
 await test('选择复制或点击标点会关闭气泡，不发额外查询',async()=>{
  let calls=0;const v=await reader({lookup:async word=>{calls++;return response(word);}});try{await click(v,'alpha');v.selection='selected words';await click(v,'beta');assert.equal(v.popover.value.show,false);assert.equal(calls,1);v.selection='';await v.onWordClick({}, {t:'o',text:'.'},[]);assert.equal(calls,1);}finally{v.stop();}
 });
 await test('双击收藏捕获原句及篇章，晚返回不会修改另一个词的气泡或弹旧提示',async()=>{
  const save=deferred(),calls=[];let words={};const v=await reader({lookup:async word=>response(word),addWord:(...args)=>{calls.push(args);return save.promise;},allWords:async()=>words});try{await click(v,'running');const pending=dbl(v,'running','They were running.');await click(v,'beta');words={run:'learning'};save.resolve({ok:true,word:'run',added:true,status:'learning'});await pending;assert.deepEqual(calls,[['running','They were running.',11]]);assert.equal(v.popover.value.data.word,'beta');assert.equal(v.popover.value.data.inBook,false);assert.equal(v.toast.value,'');assert.equal(v.userWords.value.run,'learning');}finally{v.stop();}
 });
 await test('同词收藏/移除在途互斥，错误返回释放锁且不乐观修改收藏状态',async()=>{
  const request=deferred();let adds=0,removes=0;const v=await reader({lookup:async()=>response('alpha'),addWord:()=>{adds++;return request.promise;},removeWord:async()=>{removes++;return{ok:true};}});try{await click(v,'alpha');const first=v.addFromPopover();await v.addFromPopover();await v.removeFromPopover();assert.equal(adds,1);assert.equal(removes,0);assert.equal(v.wordBusy('alpha'),true);request.resolve({ok:false,error:'disk full'});await first;assert.equal(v.wordBusy('alpha'),false);assert.equal(v.popover.value.data.inBook,false);assert.match(v.popover.value.error,/disk full/);}finally{v.stop();}
 });
 await test('词形映射在收藏期间就绪后，原形与屈折形式仍共享在途锁',async()=>{
  let mapped=false,calls=0;const pending=deferred(),v=await reader({lemmaOf:word=>mapped&&word==='running'?'run':word,addWord:()=>{calls++;return pending.promise;}});try{const first=dbl(v,'running');mapped=true;assert.equal(v.wordBusy('run'),true);await v.quickAdd('run');assert.equal(calls,1);pending.resolve({ok:true,word:'run',added:true});await first;assert.equal(v.wordBusy('run'),false);}finally{v.stop();}
 });
 await test('移除失败保持收藏，随后重试成功后使用真实词表更新气泡',async()=>{
  let fail=true,words={alpha:'mastered'};const v=await reader({lookup:async()=>({...response('alpha'),inBook:true}),allWords:async()=>words,removeWord:async()=>{if(fail)throw Error('write failed');words={};return{ok:true,removed:true};}});try{await click(v,'alpha');await v.removeFromPopover();assert.equal(v.popover.value.data.inBook,true);assert.match(v.popover.value.error,/write failed/);fail=false;await v.removeFromPopover();assert.equal(v.popover.value.data.inBook,false);assert.equal(v.popover.value.error,'');assert.equal(v.wordBusy('alpha'),false);}finally{v.stop();}
 });
 await test('切篇后的旧气泡不能继续收藏，已发送的收藏仍绑定原篇章',async()=>{
  const saved=deferred(),calls=[];const v=await reader({lookup:async word=>response(word),addWord:(...args)=>{calls.push(args);return saved.promise;}});try{await click(v,'alpha');const pending=v.addFromPopover();v.activeIdx.value=1;await Vue.nextTick();await v.addFromPopover();assert.equal(calls.length,1);assert.equal(calls[0][2],11);saved.resolve({ok:true,word:'alpha',added:true});await pending;assert.equal(v.popover.value.show,false);assert.equal(v.toast.value,'');}finally{v.stop();}
 });
 await test('收藏保存成功但状态刷新失败时明确区分，重新查词可恢复真实状态',async()=>{
  let saved=false;const v=await reader({lookup:async()=>({...response('alpha'),inBook:saved}),allWords:async()=>{throw Error('read failed');},addWord:async()=>{saved=true;return{ok:true,word:'alpha',added:true};}});try{await click(v,'alpha');await v.addFromPopover();assert.match(v.popover.value.error,/保存已完成/);assert.equal(v.wordBusy('alpha'),false);await v.retryLookup();assert.equal(v.popover.value.data.inBook,true);}finally{v.stop();}
 });
 await test('较新的收藏快照不会被旧查词或修改前的词表返回覆盖',async()=>{
  const lookup=deferred(),oldWords=deferred();let first=true;const v=await reader({lookup:()=>lookup.promise,allWords:()=>first?(first=false,oldWords.promise):Promise.resolve({alpha:'mastered'})});try{const old=v.refreshUserWords(),pending=click(v,'alpha');await v.refreshUserWords();lookup.resolve(response('alpha'));await pending;oldWords.resolve({});await old;assert.equal(v.popover.value.data.inBook,true);assert.equal(v.userWords.value.alpha,'mastered');}finally{v.stop();}
 });
 await test('收藏提交后刷新当前气泡的出处列表，保留点击原句身份',async()=>{
  let saved=false;const v=await reader({lookup:async()=>({...response('alpha'),hits:saved?[{sentence:'alpha sentence.',label:'current exam'}]:[]}),allWords:async()=>saved?{alpha:'learning'}:{},addWord:async()=>{saved=true;return{ok:true,word:'alpha',added:true};}});try{await click(v,'alpha');await v.addFromPopover();assert.equal(v.popover.value.data.hits.length,1);assert.equal(v.popover.value.data.inBook,true);assert.equal(v.popover.value.ctx,'alpha sentence.');assert.equal(v.popover.value.target.passageId,11);}finally{v.stop();}
 });
 await test('预扫快速收藏保持无出处语义，成功后实际词表决定掌握状态',async()=>{
  let args;const v=await reader({addWord:async(...values)=>{args=values;return{ok:true,word:'alpha',added:false,status:'mastered'};},allWords:async()=>({alpha:'mastered'})});try{await v.quickAdd('alpha');assert.deepEqual(args,['alpha','',null]);assert.equal(v.userWords.value.alpha,'mastered');}finally{v.stop();}
 });
 await test('划选延迟菜单在切篇后失效；旧提示计时器不会清掉新提示',async()=>{
  const v=await reader();try{v.selection='Alpha sentence.';v.onMouseUp({target:{closest:()=>true},clientX:1,clientY:2});v.activeIdx.value=1;await Vue.nextTick();v.advance(10);assert.equal(v.selMenu.value.show,false);v.showToast('first');v.advance(900);v.showToast('second');v.advance(900);assert.equal(v.toast.value,'second');v.advance(900);assert.equal(v.toast.value,'');}finally{v.stop();}
 });
 const SQL=await req('sql.js')({locateFile:file=>path.join(dependencies,'node_modules/sql.js/dist',file)}),main=fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8');
 function backend(){const handlers=new Map();let fail=false,writes=0;const context=vm.createContext({Buffer,Date,console:{log(){},error(){}},process:{env:{},platform:'win32'},__dirname:path.join(root,'electron'),require(name){
  if(name==='electron')return{app:{disableHardwareAcceleration(){},requestSingleInstanceLock:()=>true,on(){},whenReady:()=>({then(){}})},ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},dialog:{},shell:{}};
  if(name==='electron-updater')return{autoUpdater:{on(){}}};if(name==='fs')return{...fs,writeFileSync(){if(fail)throw Error('disk full');writes++;},renameSync(){}};
  return name.startsWith('./')?req(path.join(fs.existsSync(path.join(root,'electron',name))?root:dependencies,'electron',name)):req(name);
 }});vm.runInContext(main+'\nglobalThis.h={setup(SQL){sqlModule=SQL;db=new SQL.Database();db.run(SCHEMA);migrate();buildFormIndex();dbPath="memory.db";registerIpc();},q,run};',context);context.h.setup(SQL);return{...context.h,call:(name,...args)=>handlers.get(name)(null,...args),get writes(){return writes;},set fail(value){fail=value;}};}
 const prepare=h=>{h.run("INSERT INTO exam(id,level,year) VALUES (1,'CET4',2091),(2,'CET6',2092)");h.run("INSERT INTO passage(id,exam_id,content) VALUES (11,1,'Alpha sentence.'),(12,2,'Alpha sentence.')");};
 await test('相同原句在不同篇章保留各自出处，同篇重复与 NULL 出处仍幂等',()=>{
  const h=backend();prepare(h);for(const pid of [11,12,null]){assert.equal(h.call('words:add','alpha','Alpha sentence.',pid).hitAdded,true);const before=h.writes;assert.equal(h.call('words:add','alpha','Alpha sentence.',pid).hitAdded,false);assert.equal(h.writes,before);}
  assert.equal(h.q('SELECT COUNT(*) n FROM user_word')[0].n,1);assert.deepEqual(plain(h.call('words:detail','alpha').hits.map(hit=>hit.passage_id)),[null,12,11]);
 });
 await test('非法词/原句/篇章载荷无写入，未知或越界篇章不留下孤立出处',()=>{
  const h=backend();for(const [word,sentence,pid,error] of [[null,'',null,'invalid_word'],['bad word','',null,'invalid_word'],['alpha',[],null,'invalid_context'],['alpha','sentence','11','invalid_passage'],['alpha','sentence',-1,'invalid_passage'],['alpha','sentence',999,'invalid_passage'],['alpha','sentence',Number.MAX_SAFE_INTEGER+1,'invalid_passage']])assert.equal(h.call('words:add',word,sentence,pid).error,error);
  assert.equal(h.writes,0);assert.equal(h.q('SELECT COUNT(*) n FROM user_word')[0].n,0);assert.equal(h.q('SELECT COUNT(*) n FROM word_hit')[0].n,0);
 });
 await test('收藏入口保留词典中含点号缩写的兼容性',()=>{
  const h=backend();for(const word of ['b.c.','i.e.','p.m.']){h.run('INSERT INTO dict(word,translation) VALUES (?,?)',[word,'缩写']);assert.equal(h.call('words:add',word,'',null).ok,true);assert.equal(h.call('words:detail',word).userWord.word,word);}
 });
 await test('新增另一篇出处不改变掌握状态、笔记、调度和学习记录',()=>{
  const h=backend();prepare(h);h.call('words:add','alpha','Alpha sentence.',11);h.run("UPDATE user_word SET status='mastered',note='keep',reps=5,due='2099-01-01' WHERE word='alpha'");const before=plain(h.q('SELECT * FROM user_word'));h.call('words:add','alpha','Alpha sentence.',12);assert.deepEqual(plain(h.q('SELECT * FROM user_word')),before);assert.equal(h.q('SELECT COUNT(*) n FROM review_log')[0].n,0);
 });
 await test('新出处写盘失败回滚，原篇出处保留且重试仅追加一次',()=>{
  const h=backend();prepare(h);h.call('words:add','alpha','Alpha sentence.',11);h.fail=true;assert.throws(()=>h.call('words:add','alpha','Alpha sentence.',12),/disk full/);assert.deepEqual(plain(h.q('SELECT passage_id FROM word_hit')),[{passage_id:11}]);h.fail=false;assert.equal(h.call('words:add','alpha','Alpha sentence.',12).hitAdded,true);assert.equal(h.q('SELECT COUNT(*) n FROM word_hit')[0].n,2);
 });
 console.log(`查词气泡与收藏出处回归 ${passed}/${passed}`);
})().catch(error=>{console.error(error);process.exitCode=1;});

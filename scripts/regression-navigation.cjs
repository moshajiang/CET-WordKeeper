const createPageAssistant = require('./lib/load-page-assistant.cjs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),dependencies=process.env.KEEPER_DEPENDENCY_ROOT||root,req=createRequire(path.join(dependencies,'package.json')),Vue=req('vue');
const plain=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
let passed=0;const test=async(name,work)=>{await work();passed++;console.log('✓ '+name);};
const fixture=(id=1,ids=[11,12])=>({exam:{id,level:'CET4'},passages:ids.map((pid,index)=>({id:pid,section:'reading',seq:index+1,content:'Passage '+pid+'.',translation:'译文'+pid+'。',questions:[],rows:[{en:'Sentence '+pid+'.',zh:'译句'+pid+'。'}]}))});
const store=initial=>{const values=new Map(Object.entries(initial||{}));return{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};};
(async()=>{
 const load=async file=>import('data:text/javascript,'+encodeURIComponent(fs.readFileSync(path.join(dependencies,'src',file),'utf8')));
 const bilingual=await load('utils/bilingual.js'),tokens=await load('utils/tokens.js');
 const {createEssayDrafts}=await load('utils/essay-drafts.js'),{createAnswerDrafts}=await load('utils/answer-drafts.js'),{createAiTasks}=await load('utils/ai-tasks.js');
 function view(file,{examId='1',query={},storage=store(),keeper={},lex=Vue.ref(null)}={}){
  const props=Vue.reactive({examId}),route=Vue.ref({query}),pushes=[],hooks={leave:[],update:[],unmount:[]},stops=[],timers=new Map();let timerId=0,scrolled=0;
  const main={scrollTop:0,addEventListener(){},removeEventListener(){}},router={currentRoute:route,push:value=>pushes.push(plain(value))};
  const api={studyVisit:async()=>({ok:true}),examDetail:async id=>fixture(id),allWords:async()=>({}),attemptGet:async()=>({revision:'r',generation:0,answers:[],attempt:null}),chatHistory:async()=>[],...keeper};
  const context=vm.createContext({...Vue,...bilingual,...tokens,createAiTasks,createPageAssistant,createEssayDrafts,createAnswerDrafts,defineProps:()=>props,useRouter:()=>router,localStorage:storage,
   window:{keeper:api,addEventListener(){},removeEventListener(){}},document:{addEventListener(){},removeEventListener(){},querySelector:()=>main,querySelectorAll:()=>[{scrollIntoView(){scrolled++;}}]},useAlignmentLex:()=>({lex,ensureLex:async()=>lex.value}),useWordLemmas:()=>({lemmaOf:value=>value,ensureWords:async()=>{}}),renderMarkdown:String,
   onMounted(){},onBeforeRouteLeave:hook=>hooks.leave.push(hook),onBeforeRouteUpdate:hook=>hooks.update.push(hook),onBeforeUnmount:hook=>hooks.unmount.push(hook),
   watch(...args){const stop=Vue.watch(...args);stops.push(stop);return stop;},setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),URLSearchParams,location:{hash:''},console});
  const code=fs.readFileSync(path.join(root,'src/views',file),'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?$/gm,'').replace('const pageAssistant = usePageAssistant();', 'const pageAssistant = createPageAssistant({getApi:()=>window.keeper});');
  const names=file==='ReaderView.vue'?'loadAll,detail,activeIdx,saveProgress,fontSize,transMode,layout,revealAnalysis,readerError,openRecite,applyRequestedPassage,flushEssayOnClose':'load,detail,cur,items,active,revealed,langMap,first,next,toggle,backToReader,errorMsg,exams,scrollToLast';
  vm.runInContext(code+'\nglobalThis.view={'+names+'};',context);
  return{...context.view,props,route,router,storage,main,timers,pushes,hooks,lex,get scrolled(){return scrolled;},stop(){hooks.unmount.forEach(fn=>fn());stops.forEach(stop=>stop());}};
 }
 await test('背诵切卷后迟到请求不会覆盖当前材料，旧错误也不串页',async()=>{
  const requests=new Map();const v=view('ReciteView.vue',{keeper:{examDetail:id=>{const d=deferred();requests.set(id,d);return d.promise;}}});
  try{const first=v.load();v.props.examId='2';await Vue.nextTick();requests.get(2).resolve(fixture(2,[21,22]));await tick();requests.get(1).resolve(fixture());await first;assert.equal(v.detail.value.exam.id,2);
   v.props.examId='3';await Vue.nextTick();v.props.examId='4';await Vue.nextTick();requests.get(3).reject(Error('old failure'));requests.get(4).resolve(fixture(4,[41]));await tick();assert.equal(v.errorMsg.value,'');assert.equal(v.detail.value.exam.id,4);
  }finally{v.stop();}
 });
 await test('背诵离页后忽略返回，异步滚动不会操作新页面',async()=>{
  const request=deferred(),v=view('ReciteView.vue',{keeper:{examDetail:()=>request.promise}});const pending=v.load();v.stop();request.resolve(fixture());await pending;assert.equal(v.detail.value,null);
  const loaded=view('ReciteView.vue');await loaded.load();loaded.next();loaded.stop();await tick();assert.equal(loaded.scrolled,0);
 });
 await test('背诵加载异常可重试，缺失考次明确报错，回选择页会重新读考次',async()=>{
  let fail=true,calls=0;const v=view('ReciteView.vue',{keeper:{examDetail:async()=>{if(fail)throw Error('read failed');return fixture();},listExams:async()=>{calls++;return[{id:1}];}}});
  try{await v.load();assert.match(v.errorMsg.value,/read failed/);fail=false;await v.load();assert.equal(v.errorMsg.value,'');assert.equal(v.detail.value.exam.id,1);v.props.examId=undefined;await tick();assert.equal(calls,1);assert.equal(v.exams.value[0].id,1);}finally{v.stop();}
  const absent=view('ReciteView.vue',{keeper:{examDetail:async()=>null}});try{await absent.load();assert.match(absent.errorMsg.value,/未找到/);}finally{absent.stop();}
 });
 await test('稳定篇章链接和旧下标链接都定位到过滤译文后的正确篇章',async()=>{
  const data=fixture();data.passages[0].translation='';
  for(const query of [{passage:'12',p:'0'},{p:'1'}]){const v=view('ReciteView.vue',{query,keeper:{examDetail:async()=>data}});try{await v.load();assert.equal(v.active.value.id,12);assert.equal(v.active.value.pi,1);}finally{v.stop();}}
 });
 await test('同一背诵组件只改链接篇章也会定位，返回做题传递稳定 ID',async()=>{
  const v=view('ReciteView.vue');try{await v.load();v.next();await tick();v.route.value.query={passage:'12'};await Vue.nextTick();assert.equal(v.cur.value,1);assert.equal(v.revealed.value,0);v.backToReader();assert.deepEqual(v.pushes.at(-1),{path:'/reader/1',query:{passage:'12',p:'1'}});}finally{v.stop();}
 });
 await test('背诵词典重新对齐后清除旧句语言与呈现进度',async()=>{
  const v=view('ReciteView.vue');try{await v.load();v.next();v.toggle(0);await Vue.nextTick();v.detail.value.passages[0].rows=[{en:'Changed.',zh:'改写。'}];await Vue.nextTick();assert.equal(v.revealed.value,0);assert.deepEqual(plain(v.langMap.value),{});}finally{v.stop();}
 });
 await test('阅读先读原进度再触发展示 watcher，不在加载中覆盖目标卷快照',async()=>{
  const original={idx:1,scroll:123,trans:'inline',layout:'split',fontSize:19},storage=store({'keeper.reader.progress':JSON.stringify({1:original})}),request=deferred();
  const v=view('ReaderView.vue',{storage,keeper:{examDetail:()=>request.promise}});try{const pending=v.loadAll();v.activeIdx.value=1;await Vue.nextTick();v.saveProgress();assert.deepEqual(JSON.parse(storage.getItem('keeper.reader.progress'))[1],original);request.resolve(fixture());await pending;assert.equal(v.activeIdx.value,1);assert.equal(v.main.scrollTop,123);assert.equal(v.fontSize.value,19);assert.equal(v.layout.value,'split');}finally{v.stop();}
 });
 await test('篇章重新排序时按稳定 ID 恢复，旧下标记录会升级保存',async()=>{
  for(const saved of [{passageId:12,idx:0,scroll:222},{idx:0,scroll:222}]){
   const storage=store({'keeper.reader.progress':JSON.stringify({1:saved})}),v=view('ReaderView.vue',{storage,keeper:{examDetail:async()=>fixture(1,[12,11])}});try{await v.loadAll();assert.equal(v.activeIdx.value,0);assert.equal(v.main.scrollTop,222);assert.equal(JSON.parse(storage.getItem('keeper.reader.progress'))[1].passageId,12);}finally{v.stop();}
  }
 });
 await test('失效篇章身份不套用旧下标和滚动，非法偏好回退或限制到有效范围',async()=>{
  const storage=store({'keeper.reader.progress':JSON.stringify({1:{passageId:99,idx:1,scroll:500,trans:'bad',layout:'bad',fontSize:999}})}),v=view('ReaderView.vue',{storage});try{await v.loadAll();assert.equal(v.activeIdx.value,0);assert.equal(v.main.scrollTop,0);assert.equal(v.transMode.value,'off');assert.equal(v.layout.value,'stack');assert.equal(v.fontSize.value,22);}finally{v.stop();}
 });
 await test('破损或非对象进度不会阻塞加载，过大/负滚动安全约束',async()=>{
  for(const value of ['null','[]','broken']){const v=view('ReaderView.vue',{storage:store({'keeper.reader.progress':value})});try{await v.loadAll();assert.equal(v.detail.value.exam.id,1);assert.equal(v.readerError.value,'');assert.equal(JSON.parse(v.storage.getItem('keeper.reader.progress'))[1].passageId,11);}finally{v.stop();}}
  const v=view('ReaderView.vue',{storage:store({'keeper.reader.progress':JSON.stringify({1:{idx:0,scroll:-20,fontSize:-1}})})});try{await v.loadAll();assert.equal(v.main.scrollTop,0);assert.equal(v.fontSize.value,14);}finally{v.stop();}
 });
 await test('返回阅读的显式篇章优先于旧位置，链接没有有效目标时保留安全选择',async()=>{
  const v=view('ReaderView.vue',{query:{passage:'12',p:'0'},storage:store({'keeper.reader.progress':JSON.stringify({1:{idx:0,scroll:800}})})});try{await v.loadAll();assert.equal(v.activeIdx.value,1);assert.equal(v.main.scrollTop,0);v.openRecite();assert.deepEqual(v.pushes.at(-1),{path:'/recite/1',query:{p:'1',passage:'12'}});v.route.value.query={passage:'11'};await Vue.nextTick();assert.equal(v.activeIdx.value,0);}finally{v.stop();}
 });
 await test('阅读切卷清除解析揭示与展示偏好，旧卷延迟保存不能覆盖新卷进度',async()=>{
  const storage=store({'keeper.reader.progress':JSON.stringify({1:{idx:1,layout:'split',trans:'inline',fontSize:20},2:{idx:1,scroll:333}})}),request=deferred(),v=view('ReaderView.vue',{storage,keeper:{examDetail:id=>id===1?Promise.resolve(fixture()):request.promise}});
  try{await v.loadAll();v.revealAnalysis.value=true;await v.hooks.update[0]();v.props.examId='2';await Vue.nextTick();v.saveProgress();assert.equal(JSON.parse(storage.getItem('keeper.reader.progress'))[2].scroll,333);request.resolve(fixture(2,[21,22]));await tick();assert.equal(v.activeIdx.value,1);assert.equal(v.layout.value,'stack');assert.equal(v.fontSize.value,16.5);assert.equal(v.revealAnalysis.value,false);assert.equal(v.main.scrollTop,333);}finally{v.stop();}
 });
 await test('离开路由与直接关闭都会同步保存当前篇章和滚动位置',async()=>{
  const v=view('ReaderView.vue');try{await v.loadAll();v.activeIdx.value=1;v.main.scrollTop=444;await v.hooks.leave[0]();assert.equal(JSON.parse(v.storage.getItem('keeper.reader.progress'))[1].passageId,12);assert.equal(JSON.parse(v.storage.getItem('keeper.reader.progress'))[1].scroll,444);v.main.scrollTop=555;v.flushEssayOnClose();assert.equal(JSON.parse(v.storage.getItem('keeper.reader.progress'))[1].scroll,555);}finally{v.stop();}
 });
 await test('阅读材料异常可重试，收藏读取失败不阻塞正文及作答恢复',async()=>{
  let fail=true;const v=view('ReaderView.vue',{keeper:{examDetail:async()=>{if(fail)throw Error('offline read');return fixture();},allWords:async()=>{throw Error('word read');}}});try{await v.loadAll();assert.match(v.readerError.value,/offline read/);fail=false;await v.loadAll();assert.equal(v.detail.value.exam.id,1);assert.equal(v.readerError.value,'');}finally{v.stop();}
 });
 console.log(`阅读/背诵导航回归 ${passed}/${passed}`);
})().catch(error=>{console.error(error);process.exitCode=1;});

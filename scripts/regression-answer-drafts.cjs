const createPageAssistant = require('./lib/load-page-assistant.cjs');
const createAiTasks = require('./lib/load-ai-tasks.cjs')(__dirname);
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),dependencies=process.env.KEEPER_DEPENDENCY_ROOT||root;
const req=createRequire(path.join(dependencies,'package.json'));
const main=fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const storage=()=>{const values=new Map();return{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
const timers={setTimer:()=>1,clearTimer(){}};
let passed=0;
const test=async(name,run)=>{await run();passed++;console.log('✓ '+name);};
(async()=>{
 const SQL=await req('sql.js')({locateFile:f=>path.join(dependencies,'node_modules/sql.js/dist',f)});
 function backend(){
  const handlers=new Map();let writes=0,fail=false,disk=null;
  const context=vm.createContext({createAiTasks,createPageAssistant,Buffer,Date,console:{log(){},error(){}},__dirname:path.join(root,'electron'),process:{env:{},platform:'win32'},require(name){
   if(name==='electron')return{app:{disableHardwareAcceleration(){},requestSingleInstanceLock:()=>true,on(){},whenReady:()=>({then(){}})},ipcMain:{handle:(n,f)=>handlers.set(n,f)},dialog:{},shell:{}};
   if(name==='electron-updater')return{autoUpdater:{on(){}}};
   if(name==='fs')return{...fs,writeFileSync(_p,bytes){if(fail)throw Error('disk full');disk=Buffer.from(bytes);writes++;},renameSync(){}};
   return name.startsWith('./')?req(path.join(fs.existsSync(path.join(root,'electron',name))?root:dependencies,'electron',name)):req(name);
  }});
  vm.runInContext(main+`\nglobalThis.h={setup(SQL){sqlModule=SQL;db=new SQL.Database();db.run(SCHEMA);migrate();dbPath='memory.db';registerIpc();},q,run,reopen(SQL,bytes){db.close();db=new SQL.Database(new Uint8Array(bytes));},setAnalysis(fn){ensureExamAnalysis=fn;}};`,context);
  context.h.setup(SQL);
  for(const id of [1,2]){
   context.h.run("INSERT INTO exam(id,level,year,month,set_no) VALUES (?,'CET4',2093,6,?)",[id,id]);
   context.h.run("INSERT INTO passage(id,exam_id,section,seq,content,translation) VALUES (?,?,'reading',1,'Article.','文章。')",[id,id]);
   for(const n of [1,2])context.h.run("INSERT INTO question(id,passage_id,qtype,stem,options,answer,analysis) VALUES (?,?,'choice',?,'[\"A) yes\",\"B) no\"]','B','analysis')",[id*100+n,id,n+'. Which?']);
  }
  return{...context.h,call:(name,...args)=>handlers.get(name)(null,...args),get writes(){return writes;},get disk(){return disk;},set fail(value){fail=value;}};
 }
 const target=(h,id=1)=>{const r=h.call('attempt:get',id);return{examId:id,revision:r.revision,generation:r.generation};};
 const save=(h,t,answers)=>h.call('attempt:saveDraft',t.examId,{...t,answers});
 await test('保存未交卷作答不会创建成绩或正式作答；重新打开数据库后可读回',()=>{
  const h=backend(),t=target(h);assert.equal(save(h,t,{101:'B'}).ok,true);
  assert.equal(h.q('SELECT COUNT(*) n FROM attempt')[0].n,0);assert.equal(h.q('SELECT COUNT(*) n FROM user_answer')[0].n,0);
  h.reopen(SQL,h.disk);const r=h.call('attempt:get',1);assert.deepEqual(plain(r.draft.answers),{101:'B'});assert.equal(r.attempt,null);
 });
 await test('清空下拉选择可保存空草稿，相同草稿不重复写盘',()=>{
  const h=backend(),t=target(h);save(h,t,{101:'B'});save(h,t,{101:''});assert.deepEqual(plain(h.call('attempt:get',1).draft.answers),{});
  const writes=h.writes;save(h,t,{});assert.equal(h.writes,writes);
 });
 await test('不同试卷草稿独立，拒绝跨卷题号、非法选项和坏载荷',()=>{
  const h=backend();save(h,target(h,1),{101:'A'});save(h,target(h,2),{201:'B'});
  for(const bad of [{201:'B'},{101:'AB'},{101:5},null,[]])assert.equal(save(h,target(h),bad).ok,false);
  assert.deepEqual(plain(h.call('attempt:get',1).draft.answers),{101:'A'});
  assert.deepEqual(plain(h.call('attempt:get',2).draft.answers),{201:'B'});
 });
 await test('内容版本更新后保留旧草稿，但不把旧选项套入新内容',()=>{
  const h=backend(),t=target(h);save(h,t,{101:'A'});h.run("UPDATE question SET stem='Changed question' WHERE id=101");
  const r=h.call('attempt:get',1);assert.equal(r.draft,null);assert.equal(r.draftStale,true);assert.equal(save(h,t,{101:'B'}).error,'stale_draft');
  assert.deepEqual(JSON.parse(h.q('SELECT answers FROM answer_draft')[0].answers),{101:'A'});
 });
 await test('草稿写盘失败恢复内存旧值，重试后才提交新草稿',()=>{
  const h=backend(),t=target(h);save(h,t,{101:'A'});h.fail=true;assert.match(save(h,t,{101:'B'}).error,/disk full/);
  assert.deepEqual(plain(h.call('attempt:get',1).draft.answers),{101:'A'});h.fail=false;assert.equal(save(h,t,{101:'B'}).ok,true);
 });
 await test('交卷原子生成成绩、清理草稿并递增代次，迟到保存被拒绝',async()=>{
  const h=backend(),t=target(h);save(h,t,{101:'B'});const r=await h.call('attempt:submit',1,{101:'B'},t);assert.equal(r.ok,true);assert.equal(r.correct,1);
  const state=h.call('attempt:get',1);assert.equal(state.draft,null);assert.equal(state.generation,t.generation+1);
  assert.equal(save(h,t,{101:'A'}).error,'stale_draft');assert.equal(save(h,target(h),{101:'A'}).error,'already_graded');
 });
 await test('重做清空正式作答与草稿，恢复副本旧代次不可重新写回',async()=>{
  const h=backend(),t=target(h);save(h,t,{101:'A'});const cleared=h.call('attempt:clear',1,t);assert.equal(cleared.ok,true);
  const r=h.call('attempt:get',1);assert.equal(r.attempt,null);assert.equal(r.draft,null);assert.equal(save(h,t,{101:'A'}).error,'stale_draft');
  assert.equal(save(h,target(h),{101:'B'}).ok,true);
 });
 await test('交卷写盘失败完整保留原草稿、代次及正式记录',async()=>{
  const h=backend(),t=target(h);save(h,t,{101:'A'});h.fail=true;const r=await h.call('attempt:submit',1,{101:'A'},t);assert.match(r.error,/disk full/);
  const state=h.call('attempt:get',1);assert.equal(state.attempt,null);assert.equal(state.generation,t.generation);assert.deepEqual(plain(state.draft.answers),{101:'A'});
 });
 await test('交卷中途 SQL 失败时正式作答和草稿一起回滚',async()=>{
  const h=backend(),t=target(h);save(h,t,{101:'B'});
  h.run("CREATE TRIGGER reject_answer BEFORE INSERT ON user_answer WHEN NEW.question_id=102 BEGIN SELECT RAISE(ABORT,'reject second answer'); END");
  const before=plain(h.call('attempt:get',1));const result=await h.call('attempt:submit',1,{101:'B'},t);
  assert.match(result.error,/reject second answer/);assert.deepEqual(plain(h.call('attempt:get',1)),before);assert.equal(h.q('SELECT COUNT(*) n FROM user_answer')[0].n,0);
 });
 await test('重做写盘失败不丢成绩、正式作答或代次',async()=>{
  const h=backend();await h.call('attempt:submit',1,{101:'B'});const t=target(h),before=plain(h.call('attempt:get',1));h.fail=true;
  assert.match(h.call('attempt:clear',1,t).error,/disk full/);assert.deepEqual(plain(h.call('attempt:get',1)),before);
 });
 await test('AI 等待期间重做，迟到交卷不能复活旧成绩',async()=>{
  const h=backend();let finish;h.setAnalysis(()=>new Promise(resolve=>{finish=resolve;}));const request=h.call('attempt:submit',1,{101:'B'},target(h));
  h.call('attempt:clear',1);finish({ok:true});assert.equal((await request).error,'stale_draft');assert.equal(h.call('attempt:get',1).attempt,null);
 });
 await test('并发交卷只产生一次成绩，后到请求识别代次变化',async()=>{
  const h=backend(),t=target(h);const results=await Promise.all([h.call('attempt:submit',1,{101:'B'},t),h.call('attempt:submit',1,{101:'B'},t)]);
  assert.equal(results.filter(r=>r.ok).length,1);assert.equal(h.q('SELECT COUNT(*) n FROM attempt')[0].n,1);
 });
 const loadModule=async name=>import('data:text/javascript,'+encodeURIComponent(fs.readFileSync(path.join(root,'src/utils',name),'utf8')));
 const {createAnswerDrafts}=await loadModule('answer-drafts.js');
 const {createEssayDrafts}=await loadModule('essay-drafts.js');
 const base={examId:1,revision:'version-a',generation:0};
 await test('队列捕获考次身份并只写每套最新编辑，恢复副本即时存在',async()=>{
  const saved=[],store=storage(),drafts=createAnswerDrafts({storage:store,...timers,save:async(...args)=>{saved.push(args);return{ok:true};}});
  drafts.schedule({...base,answers:{101:'A'}});drafts.schedule({...base,answers:{101:'B'}});drafts.schedule({...base,examId:2,answers:{201:'A'}});
  assert.equal(drafts.recover(base).answers[101],'B');await drafts.flush();assert.equal(saved.length,2);assert.equal(saved[0][1].answers[101],'B');assert.equal(drafts.recover(base),null);
 });
 await test('旧请求失败不覆盖更新编辑，失败副本在成功前保留',async()=>{
  let reject;const store=storage(),saved=[];const drafts=createAnswerDrafts({storage:store,...timers,save:(_id,p)=>p.answers[101]==='A'?new Promise((_r,j)=>{reject=j;}):Promise.resolve((saved.push(p),{ok:true}))});
  drafts.schedule({...base,answers:{101:'A'}});const first=drafts.flush();await Promise.resolve();drafts.schedule({...base,answers:{101:'B'}});const second=drafts.flush();
  reject(Error('disk full'));await first;assert.equal(drafts.recover(base).answers[101],'B');await second;assert.equal(saved[0].answers[101],'B');assert.equal(drafts.recover(base),null);
 });
 await test('重启恢复校验内容版本与代次；交卷取消排队任务且旧副本不会复活',async()=>{
  const store=storage();let calls=0;const drafts=createAnswerDrafts({storage:store,...timers,save:async()=>{calls++;return{ok:true};}});
  drafts.schedule({...base,answers:{101:'A'}});assert.equal(drafts.recover({...base,revision:'new'}),null);assert.equal(drafts.recover({...base,generation:1}),null);
  drafts.discard(base);await drafts.flush();assert.equal(calls,0);assert.equal(store.getItem('keeper.answer.draft:1'),null);
 });
 const Vue=req('vue'),tokens=await loadModule('tokens.js'),bilingual=await loadModule('bilingual.js');
  const lemmaSource = fs.readFileSync(path.join(root,'src/composables/useWordLemmas.js'),'utf8').replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
  const useWordLemmas = vm.runInNewContext(lemmaSource+'\nuseWordLemmas;', { shallowRef:Vue.shallowRef });
 function reader(keeper,store=storage()){
  const props=Vue.reactive({examId:'1'});
  const script=fs.readFileSync(path.join(root,'src/views/ReaderView.vue'),'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?$/gm,'').replace('const pageAssistant = usePageAssistant();', 'const pageAssistant = createPageAssistant({getApi:()=>window.keeper});');
  const context=vm.createContext({createAiTasks,createPageAssistant,...Vue,...tokens,...bilingual,useWordLemmas,localStorage:store,defineProps:()=>props,useRouter:()=>({push(){}}),window:{keeper},document:{querySelector:()=>null},renderMarkdown:String,
   watch(){},onMounted(){},onBeforeUnmount(){},onBeforeRouteLeave(){},onBeforeRouteUpdate(){},setTimeout:()=>1,clearTimeout(){},
   createAnswerDrafts:opts=>createAnswerDrafts({...opts,...timers}),createEssayDrafts:opts=>createEssayDrafts({...opts,...timers}),useAlignmentLex:()=>({lex:Vue.ref(null),ensureLex(){}})});
  vm.runInContext(script+`\nglobalThis.reader={detail,answers,graded,result,notice,busy,answersLoading,answerDraftStatus,setAnswer,restoreAttempt,submit,clearAttempt,loadAnalysis,loadAll,answerDrafts};`,context);
  context.reader.detail.value={exam:{id:1},passages:[{id:1,section:'reading',questions:[{id:101},{id:102}]}]};
  return{...context.reader,props};
 }
 const ready=(extra={})=>({revision:'version-a',generation:0,answers:[],attempt:null,...extra});
 await test('真实阅读器未交卷选项保存并恢复为可编辑草稿，不显示分数',async()=>{
  const h=backend();const api={attemptGet:id=>h.call('attempt:get',id),attemptSaveDraft:(...args)=>h.call('attempt:saveDraft',...args)};
  const a=reader(api);await a.restoreAttempt();a.setAnswer(101,'B');await a.answerDrafts.flush();const b=reader(api);await b.restoreAttempt();
  assert.equal(b.answers.value[101],'B');assert.equal(b.graded.value,false);assert.equal(b.result.value,null);b.setAnswer(101,'A');await b.answerDrafts.flush();assert.equal(h.call('attempt:get',1).draft.answers[101],'A');
 });
 await test('真实阅读器恢复未落库副本，确认数据库成功后才移除',async()=>{
  const store=storage();store.setItem('keeper.answer.draft:1',JSON.stringify({...base,answers:{101:'B'}}));let finish;
  const r=reader({attemptGet:async()=>ready(),attemptSaveDraft:()=>new Promise(resolve=>{finish=resolve;})},store);await r.restoreAttempt();assert.equal(r.answers.value[101],'B');
  const flush=r.answerDrafts.flush();await Promise.resolve();assert.ok(store.getItem('keeper.answer.draft:1'));finish({ok:true});await flush;assert.equal(store.getItem('keeper.answer.draft:1'),null);
 });
 await test('真实阅读器忽略跨卷迟到作答加载，加载期间禁止误作答',async()=>{
  let finish;const r=reader({attemptGet:id=>id===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve(ready({draft:{answers:{201:'B'}}}))});
  const first=r.restoreAttempt();r.setAnswer(101,'A');assert.equal(Object.keys(r.answers.value).length,0);
  r.props.examId='2';await r.restoreAttempt();finish(ready({draft:{answers:{101:'A'}}}));await first;assert.deepEqual(plain(r.answers.value),{201:'B'});
 });
 await test('真实阅读器切卷后迟到交卷结果不锁定新卷或清除新草稿',async()=>{
  let finish;const r=reader({attemptGet:async()=>ready(),attemptSubmit:()=>new Promise(resolve=>{finish=resolve;})});
  await r.restoreAttempt();const request=r.submit();await new Promise(resolve=>setImmediate(resolve));r.props.examId='2';await r.restoreAttempt();
  finish({ok:true,total:2,score:100,generation:1,revision:'version-a'});await request;assert.equal(r.graded.value,false);assert.equal(r.result.value,null);
 });
 await test('内容更新后的历史成绩提示仍保留，新版本草稿可继续作答',async()=>{
  const r=reader({attemptGet:async()=>ready({contentChanged:true,attempt:{total:2,score:50},answers:[{question_id:101,choice:'A'}],draft:{answers:{102:'B'}}})});
  await r.restoreAttempt();assert.deepEqual(plain(r.answers.value),{102:'B'});assert.equal(r.graded.value,false);assert.match(r.notice.value,/历史交卷和作答已保留/);
 });
 await test('AI 部分答案已保存但交卷失败时，当前作答绑定新版并可继续落库',async()=>{
  const h=backend();h.setAnalysis(async()=>{h.run("UPDATE question SET answer='A' WHERE id=101");return{ok:false,error:'bad_json'};});
  const r=reader({attemptGet:id=>h.call('attempt:get',id),attemptSaveDraft:(...a)=>h.call('attempt:saveDraft',...a),attemptSubmit:(...a)=>h.call('attempt:submit',...a)});
  await r.restoreAttempt();r.setAnswer(101,'B');await r.submit();await r.answerDrafts.flush();
  const state=h.call('attempt:get',1);assert.equal(state.draft.answers[101],'B');assert.equal(state.attempt,null);assert.equal(r.graded.value,false);
 });
 console.log(`客观题草稿回归 ${passed}/${passed} 通过`);
})().catch(error=>{console.error(error);process.exitCode=1;});

const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),dep=process.env.KEEPER_DEPENDENCY_ROOT||root,req=createRequire(path.join(dep,'package.json'));
const {createAiRequests}=require('../electron/ai-requests.cjs'),createAiTasks=require('./lib/load-ai-tasks.cjs')(__dirname);
const main=fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8'),Vue=req('vue');
let passed=0;const test=async(name,fn)=>{await fn();passed++;console.log('✓ '+name);};
(async()=>{
 const SQL=await req('sql.js')({locateFile:f=>path.join(dep,'node_modules/sql.js/dist',f)});
 function backend(){
  const handlers=new Map(),pending=[];let fail=false;
  const context=vm.createContext({Buffer,console:{log(){},error(){}},process:{env:{},platform:'win32'},__dirname:path.join(root,'electron'),fetch:(_url,opts)=>new Promise(resolve=>pending.push({opts,finish:content=>resolve({ok:true,json:async()=>({choices:[{message:{content}}]})})})),require(name){
   if(name==='electron')return{app:{disableHardwareAcceleration(){},requestSingleInstanceLock:()=>true,on(){},whenReady:()=>({then(){}})},ipcMain:{handle:(n,f)=>handlers.set(n,f)},dialog:{},shell:{}};
   if(name==='electron-updater')return{autoUpdater:{on(){}}};
   if(name==='fs')return{...fs,writeFileSync(){if(fail)throw Error('disk full');},renameSync(){}};
   return name.startsWith('./')?req(path.join(fs.existsSync(path.join(root,'electron',name))?root:dep,'electron',name)):req(name);
  }});
  vm.runInContext(main+'\nglobalThis.h={setup(SQL){sqlModule=SQL;db=new SQL.Database();db.run(SCHEMA);migrate();dbPath="memory.db";registerIpc();},q,run,aiComplete};',context);context.h.setup(SQL);
  const call=(name,...args)=>handlers.get(name)({sender:{id:1}},...args);call('settings:set',{api_base:'http://fixture.invalid/v1',api_key:'fixture-only',api_model:'fixture'});
  return{...context.h,call,pending,context,owner:(id,name,...args)=>handlers.get(name)({sender:{id}},...args),set fail(value){fail=value;}};
 }
 const response=JSON.stringify({translation:'译文',answers:[{n:46,answer:'A',analysis:'解释'}]});
 const exam=h=>{h.run("INSERT INTO exam(id,level,retired) VALUES (1,'CET4',0)");h.run("INSERT INTO passage(id,exam_id,section,content,retired) VALUES (1,1,'reading','article one',0),(2,1,'reading','article two',0)");h.run("INSERT INTO question(id,passage_id,stem,options,retired) VALUES (1,1,'46','[\"A\",\"B\"]',0),(2,2,'46','[\"A\",\"B\"]',0)");};
 await test('主进程取消按窗口所有权隔离，相同 ID 不允许并发覆盖',()=>{
  const r=createAiRequests(),a=r.start(1,'same','chat'),b=r.start(2,'same','chat');assert.throws(()=>r.start(1,'same','chat'),/in_progress/);r.cancel(1,'same');assert.equal(a.signal.aborted,true);assert.equal(b.signal.aborted,false);a.finish();b.finish();assert.throws(()=>r.start(1,'bad id','chat'),/invalid_request_id/);
 });
 await test('窗口销毁和恢复退出可以取消所属请求；不同 AI 任务类型互不误取消',()=>{
  const r=createAiRequests(),a=r.start(1,'a','chat'),b=r.start(1,'b','essay'),c=r.start(2,'c','chat');r.cancelKind('chat');assert.equal(a.signal.aborted,true);assert.equal(b.signal.aborted,false);assert.equal(c.signal.aborted,true);r.cancelOwner(1);assert.equal(b.signal.aborted,true);const d=r.start(3,'d','probe');r.cancelAll();assert.equal(d.signal.aborted,true);
 });
 await test('取消翻译中止信号，忽略不响应 abort 的迟到响应且不写缓存',async()=>{
  const h=backend(),pending=h.call('ai:translate','late text','cancel-translation');h.call('ai:cancel','cancel-translation');assert.equal(h.pending[0].opts.signal.aborted,true);h.pending[0].finish('late');assert.equal((await pending).error,'cancelled');assert.equal(h.q('SELECT COUNT(*) c FROM ai_cache')[0].c,0);
 });
 await test('不能跨窗口取消请求；取消后新请求独立完成且可以命中缓存',async()=>{
  const h=backend(),first=h.call('ai:grammar','sentence','one');assert.equal(h.owner(2,'ai:cancel','one').cancelled,false);h.pending[0].finish('grammar');assert.equal((await first).ok,true);const next=await h.call('ai:grammar','sentence','two');assert.equal(next.cached,true);assert.equal(h.pending.length,1);
 });
 await test('响应头返回后、正文读取期间仍可取消，不将半完成响应缓存',async()=>{
  const h=backend();let finishBody;h.context.fetch=async()=>({ok:true,json:()=>new Promise(resolve=>{finishBody=resolve;})});const pending=h.call('ai:translate','body wait','body');await new Promise(resolve=>setImmediate(resolve));h.call('ai:cancel','body');finishBody({choices:[{message:{content:'late body'}}]});assert.equal((await pending).error,'cancelled');assert.equal(h.q('SELECT COUNT(*) c FROM ai_cache')[0].c,0);
 });
 await test('主动取消与超时返回不同错误；无 Key 仍可正常降级',async()=>{
  const h=backend();h.context.fetch=(_url,opts)=>new Promise((_r,reject)=>opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true}));const alive=setTimeout(()=>{},100);try{assert.equal((await h.aiComplete({api_base:'http://fixture.invalid',api_key:'fixture'},[],0,5)).error,'timeout');}finally{clearTimeout(alive);}const pending=h.call('ai:testConnection',{api_base:'http://fixture.invalid',api_key:'fixture'},'probe');h.call('ai:cancel','probe');assert.equal((await pending).error,'cancelled');h.call('settings:set',{api_key:''});assert.equal((await h.call('ai:translate','no key','empty')).error,'no_key');
 });
 await test('清空历史后取消所有旧聊天，迟到回复不能复活记录；后续聊天可用',async()=>{
  const h=backend();h.run("INSERT INTO chat_message(role,content) VALUES ('user','old')");const one=h.call('chat:send',null,null,'first','chat-one'),two=h.owner(2,'chat:send',null,null,'second','chat-two');assert.ok(h.call('chat:clear').ok);assert.equal(h.pending[0].opts.signal.aborted,true);assert.equal(h.pending[1].opts.signal.aborted,true);h.pending[0].finish('late first');h.pending[1].finish('late second');assert.equal((await one).error,'cancelled');assert.equal((await two).error,'cancelled');assert.equal(h.call('chat:history').length,0);const fresh=h.call('chat:send',null,null,'new','new-chat');h.pending[2].finish('new reply');assert.equal((await fresh).reply,'new reply');assert.equal(h.call('chat:history').length,2);
 });
 await test('聊天写入失败不留下半条对话；清空写盘失败保留历史和在途请求',async()=>{
  const h=backend(),send=h.call('chat:send',null,null,'question','send');h.fail=true;h.pending[0].finish('reply');assert.equal((await send).ok,false);assert.equal(h.call('chat:history').length,0);h.fail=false;h.run("INSERT INTO chat_message(role,content) VALUES ('assistant','retained')");const pending=h.call('chat:send',null,null,'question','held');h.fail=true;assert.throws(()=>h.call('chat:clear'),/disk full/);assert.equal(h.call('chat:history')[0].content,'retained');assert.equal(h.pending[1].opts.signal.aborted,false);h.fail=false;h.pending[1].finish('reply');assert.equal((await pending).ok,true);assert.equal(h.call('chat:history').length,3);
 });
 await test('解析取消后不发后续请求，已提交篇章保留，当前篇章不写入',async()=>{
  const h=backend();exam(h);const context=h.call('attempt:get',1);h.call('attempt:saveDraft',1,{...context,answers:{1:'B'}});const pending=h.call('exam:analysis',1,'analysis');h.pending[0].finish(response);await new Promise(resolve=>setImmediate(resolve));assert.equal(h.pending.length,2);h.call('ai:cancel','analysis');h.pending[1].finish(response);assert.equal((await pending).error,'cancelled');assert.equal(h.q('SELECT translation FROM passage WHERE id=1')[0].translation,'译文');assert.equal(h.q('SELECT translation FROM passage WHERE id=2')[0].translation,null);assert.equal(h.q('SELECT answer FROM question WHERE id=2')[0].answer,null);const draft=h.call('attempt:get',1);assert.equal(draft.draft.answers[1],'B');assert.equal(draft.draftStale,false);assert.notEqual(draft.revision,context.revision);
 });
 await test('交卷在 AI 期间取消，不创建成绩/正式作答并返回当前草稿身份',async()=>{
  const h=backend();exam(h);const state=h.call('attempt:get',1);h.call('attempt:saveDraft',1,{...state,answers:{1:'B'}});const pending=h.call('attempt:submit',1,{1:'B'},state,'submit');h.call('ai:cancel','submit');h.pending[0].finish(response);const result=await pending;assert.equal(result.error,'cancelled');assert.equal(result.generation,state.generation);assert.equal(result.revision,state.revision);assert.equal(h.q('SELECT COUNT(*) c FROM attempt')[0].c,0);assert.equal(h.q('SELECT COUNT(*) c FROM user_answer')[0].c,0);assert.equal(h.call('attempt:get',1).draft.answers[1],'B');
 });
 await test('取消作文批改不写结果；结果写盘失败恢复原结果',async()=>{
  const h=backend();exam(h);h.call('essay:save',1,'writing','A long enough writing fixture with many words.');const pending=h.call('essay:grade',1,'writing','grade');h.call('ai:cancel','grade');h.pending[0].finish('{"score":12,"band":"良好","strengths":"表达清楚","issues":[],"improved":"An improved fixture essay."}');assert.equal((await pending).error,'cancelled');assert.equal(h.call('essay:get',1,'writing').result,null);
  // Seed a cache so failure is specifically the result transaction, not cache persistence.
  const cached=h.call('essay:grade',1,'writing','cache-grade');h.pending[1].finish('{"score":12,"band":"良好","strengths":"表达清楚","issues":[],"improved":"An improved fixture essay."}');assert.ok((await cached).ok);h.run("UPDATE essay SET result='old-result'");h.fail=true;assert.equal((await h.call('essay:grade',1,'writing','fail-grade')).ok,false);assert.equal(h.q('SELECT result FROM essay')[0].result,'old-result');assert.equal(h.call('essay:get',1,'writing').resultInvalid,true);
 });
 await test('前端替换任务先失效本地身份，取消 IPC 失败也不会采用旧结果',async()=>{
  const canceled=[],tasks=createAiTasks(id=>{canceled.push(id);return Promise.reject(Error('closed'));}),a=tasks.start('selection'),b=tasks.start('selection');assert.equal(a.isCurrent(),false);assert.equal(b.isCurrent(),true);assert.equal(canceled[0],a.id);a.finish();assert.equal(b.isCurrent(),true);tasks.cancelAll();assert.equal(b.isCurrent(),false);await Promise.resolve();
 });
 function reader(api){
  const callbacks=[],watchers=[],props=Vue.reactive({examId:'1'}),code=fs.readFileSync(path.join(root,'src/views/ReaderView.vue'),'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?$/gm,'');
  const context=vm.createContext({...Vue,createAiTasks,defineProps:()=>props,useRouter:()=>({}),window:{keeper:api,removeEventListener(){}},document:{querySelector:()=>null,removeEventListener(){}},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},useWordLemmas:()=>({lemmaOf:x=>x,ensureWords:async()=>{}}),useAlignmentLex:()=>({lex:Vue.ref(null),ensureLex(){}}),createEssayDrafts:()=>({flush:async()=>true,schedule(){},recover:()=>null}),createAnswerDrafts:()=>({flush:async()=>true,schedule(){},recover:()=>null}),onMounted(){},onBeforeUnmount:fn=>callbacks.push(fn),onBeforeRouteLeave(){},onBeforeRouteUpdate(){},watch(...args){const stop=Vue.watch(...args);watchers.push(stop);return stop;},tokenize:()=>[],setTimeout:()=>0,clearTimeout(){}});
  vm.runInContext(code+'\nglobalThis.v={detail,activeIdx,selMenu,aiResult,doTranslate,doGrammar,cancelSelection,chatInput,chatMsgs,chatBusy,chatNotice,loadChat,sendChat,clearChat,chatClearing,stopChat,essayText,essayResult,essayBusy,gradeEssay,cancelGrade,loadEssay};',context);
  return{...context.v,props,stop(){callbacks.forEach(fn=>fn());watchers.forEach(fn=>fn());}};
 }
 await test('真实阅读器新语法结果不被旧翻译覆盖，切篇取消并忽略迟到结果',async()=>{
  let translate,grammar;const canceled=[],view=reader({translate:()=>new Promise(r=>{translate=r;}),grammar:()=>new Promise(r=>{grammar=r;}),cancelAi:id=>canceled.push(id),chatHistory:async()=>[]});
  view.selMenu.value.text='old sentence';const old=view.doTranslate();view.selMenu.value.text='new sentence';const fresh=view.doGrammar();grammar({ok:true,response:{content:'new grammar'}});await fresh;translate({ok:true,response:{content:'old translation'}});await old;assert.equal(view.aiResult.value.text,'new grammar');assert.equal(canceled.length,1);
  view.detail.value={exam:{id:1},passages:[{id:1,section:'reading',content:''},{id:2,section:'reading',content:''}]};await Vue.nextTick();view.selMenu.value.text='switch';const request=view.doTranslate();view.activeIdx.value=1;await Vue.nextTick();translate({ok:true,response:{content:'stale'}});await request;assert.equal(view.aiResult.value,null);view.stop();
 });
 await test('真实阅读器清空后忽略旧历史和旧发送返回，发送异常恢复按钮和输入',async()=>{
  let history,send;const api={chatHistory:()=>new Promise(r=>{history=r;}),chatSend:()=>new Promise(r=>{send=r;}),chatClear:async()=>({ok:true}),cancelAi:async()=>({ok:true})},view=reader(api);const loading=view.loadChat();view.chatInput.value='question';const pending=view.sendChat();await view.clearChat();history([{role:'assistant',content:'old history'}]);send({ok:true,reply:'late reply'});await Promise.all([loading,pending]);assert.equal(view.chatMsgs.value.length,0);assert.equal(view.chatBusy.value,false);assert.equal(view.chatClearing.value,false);api.chatSend=async()=>{throw Error('lost IPC');};view.chatInput.value='retry';await view.sendChat();assert.equal(view.chatInput.value,'retry');assert.equal(view.chatBusy.value,false);assert.match(view.chatNotice.value,/lost IPC/);view.stop();
 });
 await test('真实阅读器清空失败保留历史并显示错误，停止生成可重试',async()=>{
  let reply;const api={chatHistory:async()=>[{role:'assistant',content:'retained'}],chatClear:async()=>{throw Error('disk full');},chatSend:()=>new Promise(r=>{reply=r;}),cancelAi:async()=>({ok:true})},view=reader(api);await view.loadChat();await view.clearChat();assert.equal(view.chatMsgs.value[0].content,'retained');assert.equal(view.chatClearing.value,false);assert.match(view.chatNotice.value,/disk full/);view.chatInput.value='question';const pending=view.sendChat();view.stopChat();assert.equal(view.chatInput.value,'question');reply({ok:true,reply:'late'});await pending;assert.equal(view.chatMsgs.value.length,1);assert.equal(view.chatBusy.value,false);view.stop();
 });
 console.log(`AI 取消与聊天回归 ${passed}/${passed} 通过`);
})().catch(error=>{console.error(error);process.exitCode=1;});

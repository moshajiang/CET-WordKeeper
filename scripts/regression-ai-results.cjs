const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),dep=process.env.KEEPER_DEPENDENCY_ROOT||root,req=createRequire(path.join(dep,'package.json'));
const {parseAiJson,validateEssayResult,analysisContext,validateAnalysisResult}=require('../electron/ai-results.cjs');
const main=fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8');
const writing={score:12.5,band:'良好',strengths:'表达清楚',issues:[{quote:'a error',problem:'冠词错误',fix:'an error'}],improved:'An improved essay.'};
const translation={score:10,band:'基本准确',issues:[],reference:'A reference translation.'};
let passed=0;const test=async(name,fn)=>{await fn();passed++;console.log('✓ '+name);};
const clone=value=>JSON.parse(JSON.stringify(value));
const passage=(section='reading',extra={})=>({section,content:'Article.',translation:null,...extra});
const question=(id,n,extra={})=>({id,stem:n+'. What happened in 2020?',options:'["A) first","B) second"]',answer:'',...extra});
const analysis=(answers,extra={})=>({translation:'完整译文。',answers,...extra});
const answer=(n,letter='A')=>({n,answer:letter,analysis:'依据原文的解析。'});
(async()=>{
 const SQL=await req('sql.js')({locateFile:f=>path.join(dep,'node_modules/sql.js/dist',f)});
 function backend(){
  const handlers=new Map(),replies=[];let calls=0,writes=0,fail=false;
  const context=vm.createContext({Buffer,console:{log(){},error(){}},__dirname:path.join(root,'electron'),process:{env:{},platform:'win32'},fetch:async(_url,options)=>{
   calls++;const reply=replies.shift();if(reply===undefined)throw Error('missing fixture response');const content=typeof reply==='function'?await reply(JSON.parse(options.body)):typeof reply==='string'?reply:JSON.stringify(reply);
   return{ok:true,json:async()=>({choices:[{message:{content}}]})};
  },require(name){
   if(name==='electron')return{app:{disableHardwareAcceleration(){},requestSingleInstanceLock:()=>true,on(){},whenReady:()=>({then(){}})},ipcMain:{handle:(n,f)=>handlers.set(n,f)},dialog:{},shell:{}};
   if(name==='electron-updater')return{autoUpdater:{on(){}}};
   if(name==='fs')return{...fs,writeFileSync(){if(fail)throw Error('disk full');writes++;},renameSync(){}};
   return name.startsWith('./')?req(path.join(fs.existsSync(path.join(root,'electron',name))?root:dep,'electron',name)):req(name);
  }});
  vm.runInContext(main+'\nglobalThis.h={setup(SQL){sqlModule=SQL;db=new SQL.Database();db.run(SCHEMA);migrate();dbPath="memory.db";registerIpc();},q,run};',context);context.h.setup(SQL);
  const call=(name,...args)=>handlers.get(name)(null,...args);call('settings:set',{api_base:'http://fixture.invalid/v1',api_key:'fixture-only',api_model:'fixture'});
  return{...context.h,call,replies,get calls(){return calls;},get writes(){return writes;},set fail(value){fail=value;}};
 }
 function exam(h,{two=false,section='reading',known=false,translated=false}={}){
  h.run("INSERT INTO exam(id,level,imported,retired) VALUES (1,'CET4',1,0)");h.run('INSERT INTO passage(id,exam_id,section,content,translation,retired) VALUES (1,1,?,?,?,0)',[section,'Article.',translated?'已有译文。':null]);
  if(['reading','cloze','match'].includes(section)){
   h.run('INSERT INTO question(id,passage_id,stem,options,answer,analysis,retired) VALUES (1,1,?,?,?,?,0)',['46. What happened in 2020?','["A) first","B) second"]',known?'B':'',known?'已有解析':'']);
   if(two)h.run("INSERT INTO question(id,passage_id,stem,options,answer,analysis,retired) VALUES (2,1,'47. Why in 2021?','[\"A) first\",\"B) second\"]','','',0)");
  }
 }
 await test('只接受完整 JSON 对象或完整 JSON 代码围栏，拒绝猜测/截取多余说明',()=>{
  assert.deepEqual(parseAiJson('```json\n'+JSON.stringify(writing)+'\n```'),writing);
  for(const bad of ['[]','null','12','说明：'+JSON.stringify(writing),JSON.stringify(writing)+' trailing','{}{}','{broken','x'.repeat(2*1024*1024+1)])assert.throws(()=>parseAiJson(bad));
 });
 await test('评分必须为 0–15 的有限数值且最多一位小数，不静默转换或截断',()=>{
  for(const score of ['12',null,true,-1,15.1,1.23,NaN,Infinity])assert.throws(()=>validateEssayResult({...writing,score},'writing'),/bad_ai_result/);
  for(const score of [0,0.3,12.5,15])assert.equal(validateEssayResult({...writing,score},'writing').score,score);
 });
 await test('批改字段及每条问题均检查类型/长度，缺字段和对象冒充文本会失败',()=>{
  for(const patch of [{band:''},{band:{}},{strengths:null},{improved:''},{issues:{}},{issues:[null]},{issues:[{quote:{},problem:'x',fix:'y'}]},{issues:[{quote:'',problem:'',fix:'y'}]},{issues:Array(101).fill(writing.issues[0])}])assert.throws(()=>validateEssayResult({...writing,...patch},'writing'));
  assert.throws(()=>validateEssayResult({score:12},'writing'));assert.throws(()=>validateEssayResult({...writing,improved:'x'.repeat(100001)},'writing'));
 });
 await test('作文和翻译采用各自字段，未知字段不进入业务结果',()=>{
  assert.deepEqual(validateEssayResult(translation,'translation'),translation);assert.throws(()=>validateEssayResult(writing,'translation'));
  const valid=validateEssayResult({...writing,extra:{nested:'ignored'}},'writing');assert.deepEqual(valid,writing);assert.throws(()=>validateEssayResult(writing,'reading'));
 });
 await test('题号取明确前缀，不拼接年份；无题号/重复题号使用唯一明确标识',()=>{
  const c=analysisContext(passage(),[question(100,46),question(46,46),{id:47,stem:'Why in 2020?',answer:''},question(48,47)]);
  const nums=c.targets.map(q=>q.n);assert.equal(new Set(nums).size,4);assert.equal(nums[3],47);assert.ok(!nums.includes(462020));assert.equal(analysisContext(passage(),[question(10,46)]).targets[0].n,46);
 });
 await test('阅读答案必须为真实可选范围内的单个大写字母',()=>{
  const c=analysisContext(passage(),[question(1,46)]);assert.equal(validateAnalysisResult(analysis([answer(46,'B')]),c).answers[0].id,1);
  for(const value of ['a','AB',' A ','A)','E','Z','',{},null])assert.throws(()=>validateAnalysisResult(analysis([{...answer(46),answer:value}]),c));
  const visible=analysisContext(passage(),[question(1,46,{options:['Apple','Banana']})]);assert.deepEqual(visible.targets[0].allowed,['A','B']);assert.throws(()=>validateAnalysisResult(analysis([answer(46,'C')]),visible));
 });
 await test('完整检查题数、数字题号、重复/未知/遗漏题号和空解析',()=>{
  const c=analysisContext(passage(),[question(1,46),question(2,47)]);
  for(const answers of [[answer(46)],[answer(46),answer(46)],[answer(46),answer(99)],[{...answer(46),n:'46'},answer(47)],[{...answer(46),analysis:''},answer(47)]])assert.throws(()=>validateAnalysisResult(analysis(answers),c));
  assert.deepEqual(validateAnalysisResult(analysis([answer(47,'B'),answer(46)]),c).answers.map(q=>q.id),[2,1]);
 });
 await test('匹配题字母范围与实际阅读器按钮策略一致，允许段落重复匹配',()=>{
  const source=fs.readFileSync(path.join(dep,'src/utils/bilingual.js'),'utf8').replace(/^export /gm,'');const letters=vm.runInNewContext(source+'\nparagraphLetters;');
  for(const content of ['[A] One.\n[B] Two.\n[C] Three.\n[D] Four.','A) One.\nB）Two.\nC. Three.\nD、Four.','[A] One. [B] Two.',Array.from({length:16},(_,i)=>'['+String.fromCharCode(65+i)+'] Paragraph.').join('\n')]){
   const c=analysisContext(passage('match',{content}),[question(1,36),question(2,37)]),found=[...letters(content)];assert.deepEqual(c.targets[0].allowed,found.length>=4?found:[...'ABCDEFGHIJKLMNO']);assert.equal(validateAnalysisResult(analysis([answer(36),answer(37)]),c).answers.length,2);
  }
  const c=analysisContext(passage('match',{content:'[A] One.\n[B] Two.\n[C] Three.\n[D] Four.'}),[question(1,36)]);assert.throws(()=>validateAnalysisResult(analysis([answer(36,'E')]),c));
 });
 await test('选词填空禁止重复词和使用已有答案，且答案必须属于实际词库',()=>{
  const c=analysisContext(passage('cloze'),[question(1,26,{answer:'A',analysis:'已知解析'}),question(2,27),question(3,28)]);
  for(const answers of [[answer(27,'A'),answer(28,'B')],[answer(27,'B'),answer(28,'B')],[answer(27,'B'),answer(28,'C')]])assert.throws(()=>validateAnalysisResult(analysis(answers),c));
  const valid=analysisContext(passage('cloze'),[question(1,26),question(2,27)]);assert.equal(validateAnalysisResult(analysis([answer(26),answer(27,'B')]),valid).answers.length,2);
  const feedback=analysisContext(passage('cloze'),[question(1,26,{answer:'A',analysis:''}),question(2,27)],{includeAnalysis:true});assert.equal(validateAnalysisResult(analysis([answer(27,'B'),answer(26)]),feedback).answers.length,2);assert.throws(()=>validateAnalysisResult(analysis([answer(26,'B'),answer(27)]),feedback));
 });
 await test('只补缺失答案，纯译文请求要求空答案数组；保留已有译文',()=>{
  const c=analysisContext(passage(),[question(1,46,{answer:'B',analysis:'已知解析'})]);assert.equal(c.targets.length,0);assert.equal(validateAnalysisResult(analysis([]),c).translation,'完整译文。');assert.throws(()=>validateAnalysisResult(analysis([answer(46)]),c));
  const existing=analysisContext(passage('reading',{translation:'已有译文'}),[question(1,46)]);assert.equal(validateAnalysisResult({answers:[answer(46)]},existing).translation,null);assert.throws(()=>validateAnalysisResult({translation:{},answers:[answer(46)]},existing));assert.throws(()=>validateAnalysisResult({answers:[]},c));
 });
 await test('异常新评分不入缓存/结果，修正服务响应后同一草稿可以重试',async()=>{
  const h=backend();exam(h,{section:'writing'});h.call('essay:save',1,'writing','A sufficiently long essay with enough words.');const writes=h.writes;
  h.replies.push({...writing,score:'12'});const bad=await h.call('essay:grade',1,'writing');assert.equal(bad.error,'bad_ai_result');assert.equal(bad.detail,'score');assert.equal(h.writes,writes);assert.equal(h.q('SELECT COUNT(*) c FROM ai_cache')[0].c,0);assert.equal(h.call('essay:get',1,'writing').result,null);
  h.replies.push(writing);assert.ok((await h.call('essay:grade',1,'writing')).ok);assert.equal(h.calls,2);assert.equal(JSON.parse(h.call('essay:get',1,'writing').result).score,12.5);
 });
 await test('语法正确但字段无效的缓存会重新请求，坏新响应不替换旧缓存',async()=>{
  const h=backend();exam(h,{section:'writing'});h.call('essay:save',1,'writing','A sufficiently long essay with enough words.');h.replies.push(writing);await h.call('essay:grade',1,'writing');const bad=JSON.stringify({content:JSON.stringify({...writing,issues:{}})});h.run('UPDATE ai_cache SET response=?',[bad]);h.run('UPDATE essay SET result=NULL');h.replies.push('not JSON');assert.equal((await h.call('essay:grade',1,'writing')).error,'bad_json');assert.equal(h.q('SELECT response FROM ai_cache')[0].response,bad);assert.equal(h.call('essay:get',1,'writing').result,null);
  h.replies.push({...writing,score:13});const fixed=await h.call('essay:grade',1,'writing');assert.ok(fixed.ok&&!fixed.cached);const count=h.calls;assert.ok((await h.call('essay:grade',1,'writing')).cached);assert.equal(h.calls,count);assert.equal(JSON.parse(JSON.parse(h.q('SELECT response FROM ai_cache')[0].response).content).score,13);
 });
 await test('损坏缓存包壳和空内容会被忽略，不反复复用失败结果',async()=>{
  const h=backend();exam(h,{section:'writing'});h.call('essay:save',1,'writing','A sufficiently long essay with enough words.');h.replies.push(writing);await h.call('essay:grade',1,'writing');
  for(const bad of ['broken','null','{}','{"content":""}']){h.run('UPDATE ai_cache SET response=?',[bad]);h.replies.push(writing);assert.ok((await h.call('essay:grade',1,'writing')).ok);}assert.equal(h.calls,5);
 });
 await test('整篇先验证全部答案，一条非法答案也不保存译文或前面的合法答案',async()=>{
  const h=backend();exam(h,{two:true});const before=h.call('attempt:get',1);h.call('attempt:saveDraft',1,{...before,answers:{1:'B'}});const writes=h.writes;h.replies.push(analysis([answer(46),answer(47,'E')]));assert.equal((await h.call('exam:analysis',1)).error,'bad_ai_result');assert.equal(h.q('SELECT translation FROM passage')[0].translation,null);assert.ok(h.q('SELECT answer FROM question').every(q=>!q.answer));assert.equal(h.q('SELECT COUNT(*) c FROM ai_cache')[0].c,0);assert.equal(h.writes,writes);assert.equal(h.call('attempt:get',1).draft.answers[1],'B');
 });
 await test('带年份的题干和逆序响应按明确题号写回，不按数组位置回填',async()=>{
  const h=backend();exam(h,{two:true});h.replies.push(body=>{const prompt=body.messages[0].content;assert.ok(prompt.includes('【题号 n=46】'));assert.ok(!prompt.includes('n=462020'));return JSON.stringify(analysis([answer(47,'B'),answer(46)]));});assert.ok((await h.call('exam:analysis',1)).ok);assert.deepEqual(clone(h.q('SELECT id,answer FROM question ORDER BY id').map(q=>[q.id,q.answer])),[[1,'A'],[2,'B']]);
 });
 await test('无题号/重复题号的导入题通过明确提示标识正确回填',async()=>{
  const h=backend();exam(h,{two:true});h.run("UPDATE question SET stem='In 2020, why?' WHERE id=1");h.run("UPDATE question SET stem='Another unnumbered question' WHERE id=2");h.replies.push(body=>{const nums=[...body.messages[0].content.matchAll(/【题号 n=(\d+)】/g)].map(m=>+m[1]);assert.equal(new Set(nums).size,2);return JSON.stringify(analysis([answer(nums[1],'B'),answer(nums[0])]));});assert.ok((await h.call('exam:analysis',1)).ok);assert.deepEqual(clone(h.q('SELECT answer FROM question ORDER BY id').map(q=>q.answer)),['A','B']);
 });
 await test('已有答案/解析只补译文，已有译文只补答案，不被生成结果覆盖',async()=>{
  const h=backend();exam(h,{known:true});h.replies.push(analysis([]));assert.ok((await h.call('exam:analysis',1)).ok);assert.equal(h.q('SELECT answer,analysis FROM question')[0].answer,'B');assert.equal(h.q('SELECT answer,analysis FROM question')[0].analysis,'已有解析');
  const other=backend();exam(other,{translated:true});other.replies.push(analysis([answer(46)]));assert.ok((await other.call('exam:analysis',1)).ok);assert.equal(other.q('SELECT translation FROM passage')[0].translation,'已有译文。');
 });
 await test('显式补解析可处理已有答案但不能改写；答案齐全时交卷仍可离线完成',async()=>{
  const h=backend();exam(h,{known:true,translated:true});h.run("UPDATE question SET analysis=''");h.replies.push({answers:[answer(46,'A')]});assert.equal((await h.call('exam:analysis',1)).error,'bad_ai_result');assert.equal(h.q('SELECT answer FROM question')[0].answer,'B');h.replies.push({answers:[answer(46,'B')]});assert.ok((await h.call('exam:analysis',1)).ok);assert.equal(h.q('SELECT analysis FROM question')[0].analysis,'依据原文的解析。');
  const offline=backend();exam(offline,{known:true,translated:false});offline.run("UPDATE question SET analysis=''");const scored=await offline.call('attempt:submit',1,{1:'B'});assert.ok(scored.ok);assert.equal(scored.correct,1);assert.equal(offline.calls,0);assert.equal(offline.q('SELECT translation FROM passage')[0].translation,null);
 });
 await test('并发旧响应不能覆盖另一个请求先保存的答案/译文',async()=>{
  const h=backend();exam(h);let first,second;h.replies.push(()=>new Promise(r=>{first=r;}),()=>new Promise(r=>{second=r;}));const a=h.call('exam:analysis',1,'one'),b=h.call('exam:analysis',1,'two');first(JSON.stringify(analysis([answer(46)],{translation:'先保存的译文。'})));await a;second(JSON.stringify(analysis([answer(46,'B')],{translation:'旧响应译文。'})));await b;assert.equal(h.q('SELECT answer FROM question')[0].answer,'A');assert.equal(h.q('SELECT translation FROM passage')[0].translation,'先保存的译文。');
 });
 await test('部分篇章成功后下一篇格式异常，保留已完成结果和当前草稿，不创建成绩',async()=>{
  const h=backend();exam(h);h.run("INSERT INTO passage(id,exam_id,section,content,retired) VALUES (2,1,'reading','Second article.',0)");h.run("INSERT INTO question(id,passage_id,stem,options,answer,analysis,retired) VALUES (2,2,'51. Second','[\"A\",\"B\"]','','',0)");const t=h.call('attempt:get',1);h.call('attempt:saveDraft',1,{...t,answers:{1:'B',2:'B'}});h.replies.push(analysis([answer(46)]),analysis([answer(51,'Z')]));const result=await h.call('attempt:submit',1,{1:'B',2:'B'},t);assert.equal(result.error,'bad_ai_result');assert.notEqual(result.revision,t.revision);assert.equal(h.call('attempt:get',1).draft.answers[1],'B');assert.equal(h.q('SELECT answer FROM question WHERE id=2')[0].answer,'');assert.equal(h.q('SELECT COUNT(*) c FROM attempt')[0].c,0);assert.equal(h.q('SELECT COUNT(*) c FROM ai_cache')[0].c,1);
 });
 await test('历史异常评分只标记不可展示，不删除草稿或改写数据库原值',()=>{
  const h=backend();exam(h,{section:'writing'});h.call('essay:save',1,'writing','Stored draft content.');
  for(const raw of ['broken','{"score":12}',JSON.stringify({...writing,score:{}})]){h.run('UPDATE essay SET result=?',[raw]);const count=h.writes,r=h.call('essay:get',1,'writing');assert.equal(r.result,null);assert.equal(r.resultInvalid,true);assert.equal(r.content,'Stored draft content.');assert.equal(h.q('SELECT result FROM essay')[0].result,raw);assert.equal(h.writes,count);}
  h.run('UPDATE essay SET result=?',[JSON.stringify({...writing,extra:'ignored'})]);assert.deepEqual(JSON.parse(h.call('essay:get',1,'writing').result),writing);
 });
 await test('非法批改章节不调用服务；合法新结果保存失败仍回滚',async()=>{
  const h=backend();assert.equal((await h.call('essay:grade',1,'reading')).error,'invalid_section');assert.equal(h.calls,0);exam(h,{section:'writing'});h.call('essay:save',1,'writing','A sufficiently long essay with enough words.');h.replies.push(writing);h.fail=true;assert.equal((await h.call('essay:grade',1,'writing')).ok,false);assert.equal(h.q('SELECT COUNT(*) c FROM ai_cache')[0].c,0);assert.equal(h.call('essay:get',1,'writing').result,null);
 });
 await test('真实阅读器不展示异常历史评分，重试失败提示清楚并恢复按钮',async()=>{
  const Vue=req('vue'),createAiTasks=req(path.join(dep,'scripts/lib/load-ai-tasks.cjs'))(path.join(dep,'scripts'));
  const code=fs.readFileSync(path.join(root,'src/views/ReaderView.vue'),'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?$/gm,'');
  const ctx=vm.createContext({...Vue,createAiTasks,defineProps:()=>({examId:'1'}),useRouter:()=>({}),useWordLemmas:()=>({lemmaOf:x=>x,ensureWords:async()=>{}}),useAlignmentLex:()=>({lex:Vue.ref(null),ensureLex(){}}),createAnswerDrafts:()=>({flush:async()=>true}),createEssayDrafts:()=>({flush:async()=>true,recover:()=>null,schedule(){}}),window:{keeper:{essayGet:async()=>({content:'A sufficiently long essay fixture for grading.',result:null,resultInvalid:true}),essayGrade:async()=>({ok:false,error:'bad_ai_result',detail:'score'})}},document:{},localStorage:{},onMounted(){},onBeforeUnmount(){},onBeforeRouteLeave(){},onBeforeRouteUpdate(){},watch(){},setTimeout:()=>0,clearTimeout(){},tokenize:()=>[]});
  vm.runInContext(code+'\nglobalThis.v={detail,loadEssay,gradeEssay,essayText,essayResult,essayNotice,essayBusy};',ctx);const v=ctx.v;v.detail.value={exam:{id:1},passages:[{id:1,section:'writing'}]};await v.loadEssay();assert.equal(v.essayResult.value,null);assert.match(v.essayNotice.value,/历史批改结果格式异常/);assert.ok(v.essayText.value.includes('fixture'));await v.gradeEssay();assert.equal(v.essayBusy.value,false);assert.equal(v.essayResult.value,null);assert.match(v.essayNotice.value,/未保存评分/);
 });
 console.log(`AI 结构化结果回归 ${passed}/${passed} 通过`);
})().catch(error=>{console.error(error);process.exitCode=1;});

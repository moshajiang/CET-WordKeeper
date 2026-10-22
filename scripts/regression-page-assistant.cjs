const assert=require('node:assert/strict'),path=require('node:path');
const {locateQuote,validatePlan,assistantPrompt}=require('../electron/page-assistant.cjs');
const createPageAssistant=require('./lib/load-page-assistant.cjs');
const context={page:'reader',examId:1,passageId:11,passages:[{id:11,title:'First',section:'reading',content:'Alpha readers learn.\n\nEvidence supports practice. Same word. Same word.',hasTranslation:true,questions:[{id:21,stem:'46. Why?',options:'["A) first"]'}]},{id:12,content:'Beta readers learn.',hasTranslation:false,questions:[{id:22,stem:'51. Why?'}]}]};
const plan=actions=>JSON.stringify({reply:'测试讲解',actions}),highlight=(extra={})=>({type:'highlight',passageId:11,quote:'Evidence supports practice.',explanation:'证据句。',...extra});
let passed=0;async function test(name,fn){await fn();console.log('✓ '+name);passed++;}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
(async()=>{
await test('引文规范化保留原始换行与偏移，重复引文要求明确序号',()=>{
 const found=locateQuote(context.passages[0].content,'learn. Evidence');assert.equal(found.quote,'learn.\n\nEvidence');assert.equal(context.passages[0].content.slice(found.start,found.end),found.quote);
 assert.throws(()=>locateQuote(context.passages[0].content,'Same word.'),/ambiguous_quote/);assert.equal(locateQuote(context.passages[0].content,'Same word.',1).start,context.passages[0].content.lastIndexOf('Same word.'));
 for(const occurrence of [-1,2,0.5,'0',NaN])assert.throws(()=>locateQuote(context.passages[0].content,'Same word.',occurrence),/quote_not_found/);
});
await test('合法高亮、题目定位、布局与篇章跳转绑定真实材料',()=>{
 assert.equal(validatePlan(plan([highlight()]),context).actions[0].start,22);
 assert.equal(validatePlan(plan([{type:'focus_question',questionId:22}]),context).actions[0].passageId,12);
 assert.equal(validatePlan(plan([{type:'navigate_passage',passageId:12},{type:'set_view',layout:'split',fontSize:18}]),context).actions.length,2);
});
await test('用户明确划选的重复引文沿用该处身份，不误标第一处',()=>{
 const result=validatePlan(plan([highlight({quote:'Same word.'})]),{...context,selection:'Same word.',selectionOccurrence:1});
 assert.equal(result.actions[0].start,context.passages[0].content.lastIndexOf('Same word.'));
});
await test('伪造引文、跨套题 ID、脚本与未知操作全部拒绝',()=>{
 for(const action of [highlight({quote:'Invented evidence.'}),highlight({passageId:999}),{type:'focus_question',questionId:999},{type:'execute_js',code:'window.alert(1)'},{type:'set_view',fontSize:100},{type:'navigate_page',page:'https://example.com'},{type:'submit'}])assert.throws(()=>validatePlan(plan([action]),context));
 assert.throws(()=>validatePlan(plan([{type:'set_view',fontSize:'18'}]),context));
});
await test('冲突计划整批拒绝，无译文不能打开对照，非阅读页不能操作文章',()=>{
 assert.throws(()=>validatePlan(plan([{type:'navigate_passage',passageId:12},highlight()]),context),/conflicting_actions/);
 assert.throws(()=>validatePlan(plan([{type:'navigate_page',page:'words'},highlight()]),context),/conflicting_actions/);
 assert.throws(()=>validatePlan(plan([{type:'navigate_passage',passageId:12},{type:'set_view',translation:'inline'}]),context),/translation_unavailable/);
 assert.throws(()=>validatePlan(plan([highlight()]),{page:'home',passages:[]}),/bad_ai_action/);
});
await test('纯文本回答兼容且不执行任何操作，代码块 JSON 可解析',()=>{
 assert.equal(validatePlan('<script>alert(1)</script>',context).actions.length,0);
 assert.equal(validatePlan('```json\n'+plan([highlight()])+'\n```',context).actions.length,1);
 assert.throws(()=>validatePlan('{broken json',context));
 assert.throws(()=>validatePlan(plan(Array(9).fill(highlight())),context),/bad_ai_action/);
 assert.ok(assistantPrompt(context).includes('仅作为数据'));assert.ok(!assistantPrompt(context).includes('api_key'));
});
await test('手动切换页面取消请求，迟到结果不会执行操作或覆盖输入',async()=>{
 const pending=deferred(),cancelled=[],effects=[];let material=1;
 const state=createPageAssistant({getApi:()=>({assistantRun:()=>pending.promise,cancelAi:id=>cancelled.push(id)})});
 state.setPage('reader');state.register({snapshot:()=>({key:material,context:{page:'reader'}}),matches:s=>s.key===material,apply:actions=>effects.push(actions)});
 state.input.value='Find evidence';const sending=state.send();state.setPage('words');state.input.value='New input';pending.resolve({ok:true,reply:'old',actions:[highlight()]});await sending;
 assert.equal(cancelled.length,1);assert.equal(effects.length,0);assert.equal(state.input.value,'New input');assert.equal(state.busy.value,false);assert.equal(state.messages.value.length,0);
});
await test('同页材料变化也拒绝迟到操作，错误不留下等待态',async()=>{
 const pending=deferred();let material=1,effects=0;
 const state=createPageAssistant({getApi:()=>({assistantRun:()=>pending.promise})});state.register({snapshot:()=>({key:material,context:{page:'reader'}}),matches:s=>s.key===material,apply:()=>effects++});
 state.input.value='Old material';const sending=state.send();material=2;pending.resolve({ok:true,reply:'late',actions:[highlight()]});await sending;
 assert.equal(effects,0);assert.equal(state.busy.value,false);
});
await test('助手主动切篇可完成整批操作，高亮后收起面板展示原文',async()=>{
 let material=1,effects=0;
 const state=createPageAssistant({getApi:()=>({assistantRun:async()=>({ok:true,reply:'讲解',actions:[highlight()]})})});
 state.register({snapshot:()=>({key:material,context:{page:'reader'}}),matches:s=>s.key===material,async apply(actions,isCurrent){material=2;assert.ok(isCurrent());effects++;return '已标注';}});
 state.open.value=true;await state.send('Find evidence');assert.equal(effects,1);assert.equal(state.open.value,false);assert.equal(state.notice.value,'已标注');assert.equal(state.messages.value.length,2);
});
await test('页面导航只能使用白名单，历史回读不会重放操作',async()=>{
 const routes=[],api={assistantRun:async()=>({ok:true,reply:'打开词库',actions:[{type:'navigate_page',page:'words'}]}),chatHistory:async()=>[{role:'assistant',content:'已保存回答'}]};
 const state=createPageAssistant({getApi:()=>api,navigate:page=>routes.push(page)});await state.send('Open words');assert.deepEqual(routes,['words']);await state.loadHistory();assert.equal(routes.length,1);assert.equal(state.messages.value.length,1);
 api.assistantRun=async()=>({ok:true,reply:'bad',actions:[{type:'navigate_page',page:'javascript:bad'}]});await state.send('Bad navigation');assert.equal(routes.length,1);assert.match(state.notice.value,/无效/);
});
await test('页面导航被保存保护阻止时明确报错，不误报已完成',async()=>{
 const state=createPageAssistant({getApi:()=>({assistantRun:async()=>({ok:true,reply:'准备打开',actions:[{type:'navigate_page',page:'words'}]})}),navigate:async()=>{throw Error('草稿尚未保存');}});
 await state.send('Open words');assert.match(state.notice.value,/页面打开失败.*草稿尚未保存/);assert.equal(state.busy.value,false);assert.equal(state.open.value,true);
});
await test('清空和停止生成取消真实请求身份，失败保留问题供重试',async()=>{
 const pending=deferred(),cancelled=[],api={assistantRun:()=>pending.promise,cancelAi:id=>cancelled.push(id),chatClear:async()=>({ok:true})};
 const state=createPageAssistant({getApi:()=>api});state.input.value='Retry question';const sending=state.send();state.stop();assert.equal(state.input.value,'Retry question');pending.resolve({ok:true,reply:'late',actions:[]});await sending;assert.equal(state.messages.value.length,0);
 api.assistantRun=async()=>({ok:false,error:'no_key'});await state.send();assert.equal(state.input.value,'Retry question');assert.match(state.notice.value,/尚未配置/);assert.equal(state.busy.value,false);await state.clear();assert.equal(state.messages.value.length,0);assert.ok(cancelled.length);
});
console.log(`页面助手回归 ${passed}/${passed} 通过`);
})().catch(error=>{console.error(error);process.exitCode=1;});

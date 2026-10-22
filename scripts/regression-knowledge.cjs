const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),main=fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8');
const {inspectBackup}=require('../electron/storage.cjs');
const {ensureKnowledgeSchema}=require('../electron/knowledge.cjs');
const handlers=new Map();let fail=false,writes=0,passed=0;
const context=vm.createContext({Buffer,console:{log(){},error(){}},__dirname:path.join(root,'electron'),process:{env:{},platform:'win32'},setTimeout,clearTimeout,AbortController,require(name){
 if(name==='electron')return {app:{disableHardwareAcceleration(){},requestSingleInstanceLock:()=>true,on(){},whenReady:()=>({then(){}})},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{},shell:{}};
 if(name==='electron-updater')return {autoUpdater:{on(){}}};
 if(name==='fs')return {...fs,writeFileSync(){if(fail)throw Error('disk full');writes++;},renameSync(){}};
 return name.startsWith('./')?require(path.join(root,'electron',name)):require(name);
}});
vm.runInContext(main+`\nglobalThis.h={setup(SQL){sqlModule=SQL;db=new SQL.Database();db.run(SCHEMA);db.run("INSERT INTO kb_entry(title,content,source,created_at) VALUES ('旧笔记','完整旧正文','user','2025-01-01')");migrate();dbPath='memory.db';registerIpc();},q,run,bytes:()=>Buffer.from(db.export()),schema:SCHEMA,reopen(SQL,bytes){db.close();db=new SQL.Database(bytes);migrate();},db:()=>db};`,context);
const call=(name,...args)=>handlers.get(name)(null,...args),plain=value=>JSON.parse(JSON.stringify(value));
const test=async(name,fn)=>{await fn();passed++;console.log('✓ '+name);};
(async()=>{
 const SQL=await require('sql.js')({locateFile:f=>path.join(root,'node_modules/sql.js/dist',f)});context.h.setup(SQL);const h=context.h;
 await test('旧知识库迁移保留正文，重复迁移不改变数据，旧版备份仍兼容',()=>{
  assert.equal(call('kb:get','user:1').content,'完整旧正文');assert.equal(call('kb:get','user:1').category,'未分类');
  const before=h.bytes();ensureKnowledgeSchema(h.db());assert.deepEqual(h.bytes(),before);
  const old=new SQL.Database();old.run(h.schema);assert.ok(inspectBackup(SQL,Buffer.from(old.export()),h.schema));old.close();
 });
 await test('扩充的内置资料经真实加载器完整读取，标题不重复且按主题检索',()=>{
  const entries=call('kb:search',{source:'builtin'}).entries;
  assert.ok(entries.length>=36);assert.equal(new Set(entries.map(e=>e.key)).size,entries.length);
  for(const tag of ['语法','阅读','词汇','写作','翻译','学习方法']) {
   const group=call('kb:search',{source:'builtin',tag}).entries;assert.ok(group.length>=3,tag);
   for(const entry of group)assert.ok(call('kb:get',entry.key).content.length>100);
  }
  for(const [query,title] of [['百分点','翻译 · 数字、倍数与百分比'],['look forward to','词汇 · 高频搭配与介词 to'],['推断题','阅读 · 推断题、相关关系与因果关系']]) {
   assert.ok(call('kb:search',{source:'builtin',query}).entries.some(e=>e.title===title),query);
  }
  const legacy=call('kb:search',{source:'builtin',tag:'题型方法'}).entries;assert.equal(legacy.length,5);
 });
 await test('AI 关键词上下文可以召回新增知识，旧条目标题与稳定 key 保持兼容',()=>{
  const contextText=vm.runInContext("buildChatContext(null,null,'百分比和百分点')",context);
  assert.ok(contextText.includes('【知识库 · 翻译 · 数字、倍数与百分比】'));assert.ok(contextText.includes('10 percentage points'));
  const old=call('kb:search',{source:'builtin',query:'三大从句'}).entries.find(e=>e.title==='语法 · 三大从句（名词性/定语/状语）');assert.ok(old);
  const expected='builtin:'+require('node:crypto').createHash('sha256').update(old.title).digest('hex').slice(0,20);assert.equal(old.key,expected);
  assert.ok(call('kb:get',old.key).content.includes('非限制性从句'));
 });
 const built=call('kb:search',{source:'builtin'}).entries[0];
 await test('内置资料可读取完整正文，保持只读，旧列表接口兼容',()=>{
  const full=call('kb:get',built.key);assert.ok(full.content.length>60);assert.equal(call('kb:save',{...full,title:'篡改'}).ok,false);assert.ok(call('kb:list').builtin.includes(full.title));assert.equal(call('kb:list').user[0].preview,'完整旧正文');
 });
 let key;
 await test('长笔记正文尾部可检索，标签分类筛选不丢失全文',()=>{
  const saved=call('kb:save',{title:'非谓语实例',content:'前文。'.repeat(1500)+'末尾定位词',category:'真题笔记',tags:['语法','doing','语法']});assert.equal(saved.ok,true);key=saved.key;
  const result=call('kb:search',{query:'末尾定位词',category:'真题笔记',tag:'doing',source:'user'});assert.equal(result.entries.length,1);assert.equal(result.entries[0].key,key);assert.ok(result.entries[0].preview.includes('末尾定位词'));assert.deepEqual(plain(call('kb:get',key).tags),['语法','doing']);
 });
 await test('修改已有笔记保持 ID 与创建时间，过期版本不能覆盖新内容',()=>{
  const before=call('kb:get',key);h.run('UPDATE kb_entry SET updated_at=? WHERE id=?',['changed',before.id]);assert.equal(call('kb:save',{...before,expectedUpdatedAt:before.updated_at,content:'旧视图覆盖'}).ok,false);
  const updated=call('kb:get',key);assert.equal(call('kb:save',{...updated,expectedUpdatedAt:updated.updated_at,content:'修改后的完整内容'}).ok,true);assert.equal(call('kb:get',key).created_at,before.created_at);assert.equal(call('kb:get',key).id,before.id);
 });
 await test('空内容、超长标题、无效标签和伪造内置 ID 均不能写入',()=>{
  const count=call('kb:search').total,oldWrites=writes;
  for(const payload of [{title:'',content:'text'},{title:'x'.repeat(161),content:'text'},{title:'x',content:'text',category:'任意分类'},{title:'x',content:'text',tags:['a'.repeat(31)]},{key:built.key,title:'x',content:'text'},{title:'x',content:'text',tags:'tag'}])assert.equal(call('kb:save',payload).ok,false);
  assert.equal(call('kb:search').total,count);assert.equal(writes,oldWrites);
 });
 await test('保存和删除写盘失败均回滚，不将失败结果带入之后的保存',()=>{
  const before=h.bytes();fail=true;assert.equal(call('kb:save',{title:'不能落盘',content:'text'}).ok,false);assert.deepEqual(h.bytes(),before);assert.equal(call('kb:remove',1).ok,false);assert.deepEqual(h.bytes(),before);fail=false;
 });
 h.run("INSERT INTO exam(id,level,year,month,set_no,retired) VALUES (9001,'CET4',2097,6,1,0)");h.run("INSERT INTO passage(id,exam_id,section,seq,content,retired) VALUES (9002,9001,'reading',1,'Same sentence. Same sentence.',0)");
 let anchored;
 await test('AI 笔记保留第二处重复引文身份，原文定位不依赖模型',()=>{
  const result=call('kb:save',{title:'重复句讲解',content:'保留的解释',category:'真题笔记',origin:'ai',anchor:{examId:9001,passageId:9002,quote:'Same sentence.',occurrence:1}});assert.equal(result.ok,true);anchored=result.key;
  const found=call('kb:source',anchored);assert.equal(found.occurrence,1);assert.equal(found.quote,'Same sentence.');assert.equal(found.explanation,'保留的解释');assert.equal(call('kb:get',anchored).origin,'ai');
 });
 await test('无效套题、伪造引文和未指定重复位置被拒绝',()=>{
  for(const anchor of [{examId:9000,passageId:9002,quote:'Same sentence.'},{examId:9001,passageId:9002,quote:'Fabricated.'},{examId:9001,passageId:9002,quote:'Same sentence.'}])assert.equal(call('kb:save',{title:'坏来源',content:'text',anchor}).ok,false);
 });
 await test('来源被移除时禁止误跳，笔记正文完整保留',()=>{
  h.run('UPDATE passage SET retired=1 WHERE id=9002');assert.throws(()=>call('kb:source',anchored),/来源篇章已移除/);assert.equal(call('kb:get',anchored).content,'保留的解释');h.run('UPDATE passage SET retired=0 WHERE id=9002');
 });
 await test('来源文字更新不误定位，原文发生变化也不删除笔记',()=>{
  h.run("UPDATE passage SET content='Changed content.' WHERE id=9002");assert.throws(()=>call('kb:source',anchored),/来源原文已变化/);assert.equal(call('kb:get',anchored).content,'保留的解释');
 });
 await test('重启后保留分类标签和来源；删除只影响目标用户条目',()=>{
  const bytes=h.bytes();h.reopen(SQL,bytes);assert.equal(call('kb:get',anchored).anchor.occurrence,1);assert.deepEqual(plain(call('kb:get',key).tags),['语法','doing']);
  assert.equal(call('kb:remove',1).ok,true);assert.throws(()=>call('kb:get','user:1'),/不存在/);assert.equal(call('kb:get',anchored).content,'保留的解释');assert.ok(call('kb:get',built.key).content);
 });
 console.log(`知识库回归 ${passed}/${passed} 通过`);
})().catch(error=>{console.error(error);process.exitCode=1;});

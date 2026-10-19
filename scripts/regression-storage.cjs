const createAiTasks = require('./lib/load-ai-tasks.cjs')(__dirname);
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),dep=process.env.KEEPER_DEPENDENCY_ROOT||root,req=createRequire(path.join(dep,'package.json'));
const {createRestoreStore,inspectBackup,ensureStorageIndexes}=require('../electron/storage.cjs');
const main=fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8'),schema=main.match(/const SCHEMA = `([\s\S]*?)`;/)[1];
let passed=0;const test=async(name,fn)=>{await fn();console.log('✓ '+name);passed++;};
(async()=>{
 const SQL=await req('sql.js')({locateFile:f=>path.join(dep,'node_modules/sql.js/dist',f)});
 const parent=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(parent,'cet-wordkeeper-storage-'));
 const make=word=>{const db=new SQL.Database();db.run(schema);db.run('INSERT INTO user_word(word,note) VALUES (?,?)',[word,word+' note']);const bytes=Buffer.from(db.export());db.close();return bytes;};
 const old=make('previous'),selected=make('selected'),live=path.join(dir,'keeper.db');let counter=0;
 function fixture(io=fs){const own=path.join(dir,String(++counter));fs.mkdirSync(own);fs.writeFileSync(path.join(own,'keeper.db'),old);const store=createRestoreStore({directory:own,SQL,schema,io}),preview=store.preview(selected,'selected.db');return{own,store,preview,live:path.join(own,'keeper.db')};}
 const value=bytes=>{const db=new SQL.Database(new Uint8Array(bytes));try{return db.exec('SELECT word FROM user_word')[0].values[0][0];}finally{db.close();}};
 try{
 await test('校验完整旧版备份，允许缺少新增表；只读不改变输入字节',()=>{
  const db=new SQL.Database(new Uint8Array(old));db.run('DROP TABLE answer_draft; DROP TABLE review_operation');const bytes=Buffer.from(db.export()),copy=Buffer.from(bytes);db.close();assert.equal(inspectBackup(SQL,bytes,schema).counts.user_word,1);assert.deepEqual(bytes,copy);
 });
 await test('拒绝非数据库、截断数据库、其他 SQLite 库和缺列伪装表',()=>{
  const other=new SQL.Database();other.run('CREATE TABLE user_word(word TEXT)');const bytes=Buffer.from(other.export());other.close();for(const bad of [Buffer.from('bad'),old.subarray(0,1024),bytes])assert.throws(()=>inspectBackup(SQL,bad,schema));
  const db=new SQL.Database(new Uint8Array(old));db.run('ALTER TABLE essay RENAME TO missing_essay; CREATE TABLE essay(id INTEGER)');assert.throws(()=>inspectBackup(SQL,Buffer.from(db.export()),schema),/essay/);db.close();
 });
 await test('拒绝未来版本和可执行触发器/视图',()=>{
  for(const sql of ['PRAGMA user_version=99','CREATE TRIGGER unsafe AFTER INSERT ON settings BEGIN DELETE FROM user_word; END','CREATE VIEW unsafe AS SELECT * FROM settings']){const db=new SQL.Database(new Uint8Array(old));db.run(sql);assert.throws(()=>inspectBackup(SQL,Buffer.from(db.export()),schema));db.close();}
 });
 await test('预览/取消/错误令牌均不改变当前数据库，失效预览不能提交',()=>{
  const f=fixture();assert.equal(f.preview.counts.user_word,1);assert.throws(()=>f.store.queue('wrong',old),/失效/);f.store.cancel();assert.throws(()=>f.store.queue(f.preview.token,old),/失效/);assert.deepEqual(fs.readFileSync(f.live),old);
 });
 await test('预览绑定已校验字节，选中文件后变化不会替换预览内容',()=>{
  const f=fixture(),input=Buffer.from(selected);const p=f.store.preview(input,'mutable-selected.db');f.preview=p;input.fill(0);const queued=f.store.queue(f.preview.token,old);assert.deepEqual(fs.readFileSync(queued.backupPath),old);assert.deepEqual(fs.readFileSync(f.live),old);const job=f.store.begin();assert.equal(value(fs.readFileSync(f.live)),'selected');f.store.finish(job);assert.equal(f.store.state().epoch,f.preview.token);assert.equal(f.store.state().status,'restored');assert.equal(f.store.begin(),null);
 });
 await test('恢复前备份写入失败不发布任务、不替换当前库',()=>{
  const io={...fs,writeFileSync(file,...args){if(typeof file==='string'&&file.includes('pre-restore-'))throw Error('disk full');return fs.writeFileSync(file,...args);}};const f=fixture(io);assert.throws(()=>f.store.queue(f.preview.token,old),/disk full/);assert.deepEqual(fs.readFileSync(f.live),old);assert.ok(!fs.existsSync(path.join(f.own,'restore-pending.json')));
 });
 await test('候选写入失败不发布任务、不替换当前库，保留可用恢复前备份',()=>{
  const io={...fs,writeFileSync(file,...args){if(typeof file==='string'&&path.basename(file).startsWith('restore-'))throw Error('candidate full');return fs.writeFileSync(file,...args);}};const f=fixture(io);assert.throws(()=>f.store.queue(f.preview.token,old),/candidate full/);assert.deepEqual(fs.readFileSync(f.live),old);assert.ok(fs.readdirSync(f.own).some(n=>n.startsWith('keeper.pre-restore-')));
 });
 await test('候选被篡改则启动回退，当前库与恢复前备份逐字节一致',()=>{
  const f=fixture();f.store.queue(f.preview.token,old);const candidate=path.join(f.own,`restore-${f.preview.token}.db`);fs.writeFileSync(candidate,'corrupt');assert.equal(f.store.begin(),null);assert.deepEqual(fs.readFileSync(f.live),old);assert.equal(f.store.state().status,'failed');
 });
 await test('原子替换失败回退原库，失败状态可供界面显示',()=>{
  let fail=true;const io={...fs,renameSync(from,to){if(fail&&path.basename(to)==='keeper.db'){fail=false;throw Error('replace failed');}fs.renameSync(from,to);}};const f=fixture(io);f.store.queue(f.preview.token,old);assert.equal(f.store.begin(),null);assert.deepEqual(fs.readFileSync(f.live),old);assert.match(f.store.state().error,/replace failed/);
 });
 await test('迁移失败可以回退，中断恢复的下次启动也保守回退',()=>{
  const f=fixture();f.store.queue(f.preview.token,old);const job=f.store.begin();assert.equal(value(fs.readFileSync(f.live)),'selected');f.store.rollback(job,Error('migration failed'));assert.deepEqual(fs.readFileSync(f.live),old);
  const g=fixture();g.store.queue(g.preview.token,old);g.store.begin();const restarted=createRestoreStore({directory:g.own,SQL,schema});assert.equal(restarted.begin(),null);assert.deepEqual(fs.readFileSync(g.live),old);assert.match(restarted.state().error,/中断/);
 });
 await test('完成后清理任务失败，下一次启动只补全状态、不重复回退',()=>{
  const io={...fs,unlinkSync(file){if(path.basename(file)==='restore-pending.json')throw Error('locked');fs.unlinkSync(file);}};const f=fixture(io);f.store.queue(f.preview.token,old);f.store.finish(f.store.begin());const restarted=createRestoreStore({directory:f.own,SQL,schema});assert.equal(restarted.begin(),null);assert.equal(value(fs.readFileSync(f.live)),'selected');assert.equal(restarted.state().status,'restored');
 });
 await test('篡改任务路径/版本或损坏恢复前备份时停止，不以空库覆盖',()=>{
  const f=fixture(),r=f.store.queue(f.preview.token,old),journal=path.join(f.own,'restore-pending.json');const job=JSON.parse(fs.readFileSync(journal));fs.writeFileSync(journal,JSON.stringify({...job,token:'../../outside'}));assert.throws(()=>f.store.begin(),/任务文件无效/);assert.deepEqual(fs.readFileSync(f.live),old);fs.writeFileSync(journal,JSON.stringify(job));fs.writeFileSync(r.backupPath,'bad');assert.throws(()=>f.store.begin(),/校验值/);assert.deepEqual(fs.readFileSync(f.live),old);
 });
 await test('索引幂等、不改变业务记录，相关查询使用命中索引',()=>{
  const db=new SQL.Database(new Uint8Array(old));ensureStorageIndexes(db);const bytes=Buffer.from(db.export());ensureStorageIndexes(db);assert.deepEqual(Buffer.from(db.export()),bytes);assert.equal(db.exec('SELECT word,note FROM user_word')[0].values[0][0],'previous');const plan=db.exec("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM word_hit WHERE word='previous'")[0].values.flat().join(' ');assert.match(plan,/idx_word_hit_word/);db.close();
 });
 const events=[],timers=[];let writes=0,fail=false,completeAi;
 const handlers=new Map(),context=vm.createContext({createAiTasks,Buffer,console:{log(){},error(){}},__dirname:path.join(root,'electron'),process:{env:{},platform:'win32'},setTimeout:fn=>timers.push(fn),AbortController,fetch:()=>new Promise(resolve=>{completeAi=()=>resolve({ok:true,json:async()=>({choices:[{message:{content:'{"translation":"late"}'}}]})});}),clearTimeout(){},require(name){
  if(name==='electron')return{app:{disableHardwareAcceleration(){},requestSingleInstanceLock:()=>true,on(){},whenReady:()=>({then(){}})},ipcMain:{handle:(n,f)=>handlers.set(n,f)},dialog:{},shell:{}};
  if(name==='electron-updater')return{autoUpdater:{on(){}}};
  if(name==='fs')return{...fs,writeFileSync(){if(fail)throw Error('disk full');writes++;},renameSync(){}};
  return name.startsWith('./')?req(path.join(fs.existsSync(path.join(root,'electron',name))?root:dep,'electron',name)):req(name);
 }});
 vm.runInContext(main+'\nglobalThis.h={setup(SQL){sqlModule=SQL;db=new SQL.Database();db.run(SCHEMA);migrate();buildFormIndex();dbPath="memory.db";registerIpc();restoreStore={queue:()=>({ok:true,backupPath:"safe.db"})};},q,run};',context);context.h.setup(SQL);const h={...context.h,call:(n,...args)=>handlers.get(n)(null,...args)};
 await test('重复收藏、相同状态/笔记/设置不写整库，新增出处仍持久化',()=>{
  h.call('words:add','alpha','sentence',null);const initial=writes;h.call('words:add','alpha','sentence',null);h.call('words:setStatus','alpha','learning');h.call('words:saveNote','alpha','');assert.equal(writes,initial);h.call('words:add','alpha','different',null);assert.equal(writes,initial+1);h.call('settings:set',{api_key:'fixture'});const settingsWrites=writes;h.call('settings:set',{api_key:'fixture'});assert.equal(writes,settingsWrites);
 });
 await test('笔记/配置写盘失败恢复内存，下一次保存不夹带失败数据',()=>{
  fail=true;assert.throws(()=>h.call('words:saveNote','alpha','failed'),/disk full/);assert.equal(h.q("SELECT note FROM user_word WHERE word='alpha'")[0].note,'');assert.throws(()=>h.call('settings:set',{api_key:'failed'}),/disk full/);assert.equal(h.q("SELECT value FROM settings WHERE key='api_key'")[0].value,'fixture');fail=false;
 });
 await test('恢复排队后拒绝新写入，迟到 AI 结果不能写缓存或污染恢复前库',async()=>{
  h.call('settings:set',{api_base:'http://localhost/v1',api_model:'fixture'});const request=h.call('ai:translate','held text');await Promise.resolve();const before=writes;assert.ok(h.call('backup:restoreCommit','fixture').ok);assert.throws(()=>h.call('words:add','beta','',null),/重启恢复/);assert.throws(()=>h.call('settings:set',{api_key:'new'}),/重启恢复/);completeAi();const result=await request;assert.equal(result.ok,false);assert.equal(h.q('SELECT COUNT(*) c FROM ai_cache')[0].c,0);assert.equal(writes,before);
 });
 await test('恢复 epoch 在挂载阅读器前清理旧草稿与进度，保留外观及其他应用键',()=>{
  const code=fs.readFileSync(path.join(root,'src/utils/storage-epoch.js'),'utf8').replace('export function','function');const sync=vm.runInNewContext(code+'\nsyncStorageEpoch;');const map=new Map([['keeper.answer.draft:1','old'],['keeper.essay.draft:1:writing','old'],['keeper.reader.progress','old'],['keeper.lastReading','1'],['keeper.theme','dark'],['other','keep']]);const storage={get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};sync(storage,'original');assert.ok(map.has('keeper.answer.draft:1'));sync(storage,'restored-token');assert.deepEqual([...map.keys()].sort(),['keeper.storage.epoch','keeper.theme','other']);map.set('keeper.answer.draft:1','new');sync(storage,'restored-token');assert.equal(map.get('keeper.answer.draft:1'),'new');
 });
 function settings(api){
  const Vue=req('vue'),code=fs.readFileSync(path.join(root,'src/views/SettingsView.vue'),'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?$/gm,'');
  let unmount;
  const ctx=vm.createContext({createAiTasks,...Vue,window:{keeper:api},localStorage:{},document:{},onMounted(){},onBeforeUnmount:fn=>{unmount=fn;},setTimeout,clearTimeout});
  vm.runInContext(code+'\nglobalThis.view={backup,previewRestore,confirmRestore,cancelRestore,restorePreview,dataBusy,restarting,backupMsg,backupOk};',ctx);
  return {...ctx.view,stop:()=>unmount()};
 }
 await test('设置页预览不触发恢复，只有明确确认才提交绑定令牌',async()=>{
  let commits=0,received;const view=settings({restorePreview:async()=>({ok:true,token:'reviewed',counts:{user_word:1}}),restoreCommit:async token=>{commits++;received=token;return{ok:true,backupPath:'before.db'};}});
  await view.previewRestore();assert.equal(commits,0);assert.equal(view.restorePreview.value.token,'reviewed');await view.confirmRestore();assert.equal(commits,1);assert.equal(received,'reviewed');assert.equal(view.restarting.value,true);assert.match(view.backupMsg.value,/before.db/);view.stop();
 });
 await test('备份/恢复失败明确展示错误并释放忙碌状态，取消使预览失效',async()=>{
  let canceled=0;const view=settings({backupDialog:async()=>{throw Error('permission denied');},restorePreview:async()=>({ok:true,token:'preview'}),restoreCommit:async()=>({ok:false,error:'disk full'}),restoreCancel:async()=>{canceled++;}});
  await view.backup();assert.equal(view.dataBusy.value,false);assert.equal(view.backupOk.value,false);assert.match(view.backupMsg.value,/permission denied/);await view.previewRestore();await view.confirmRestore();assert.equal(view.restarting.value,false);assert.match(view.backupMsg.value,/disk full/);await view.cancelRestore();assert.equal(view.restorePreview.value,null);assert.equal(canceled,1);view.stop();
 });
 await test('预览选择期间离开设置页，迟到的选择被取消而不能重新打开确认',async()=>{
  let finish,canceled=0;const view=settings({restorePreview:()=>new Promise(r=>{finish=r;}),restoreCancel:async()=>{canceled++;}});const pending=view.previewRestore();view.stop();finish({ok:true,token:'late'});await pending;assert.equal(view.restorePreview.value,null);assert.equal(canceled,1);assert.equal(view.dataBusy.value,false);
 });
 console.log(`存储定向回归 ${passed}/${passed} 通过`);
 }finally{if(path.dirname(dir)!==parent||fs.realpathSync(dir)!==dir||fs.lstatSync(dir).isSymbolicLink())throw Error('unowned temp directory');fs.rmSync(dir,{recursive:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});

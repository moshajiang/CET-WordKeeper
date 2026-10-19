const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),dependencies=process.env.KEEPER_DEPENDENCY_ROOT||root;
const req=createRequire(path.join(dependencies,'package.json'));
const {FREQUENCY_REVISION,buildWordIndex,createWordResolver,markContext,countWordFrequency}=require('../electron/word-semantics.cjs');
const forms=require('../electron/word-forms.json'),extra={...forms.irregular_verbs,...forms.irregular_plurals,...forms.contractions};
const source=fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
let passed=0;const test=async(name,run)=>{await run();passed++;console.log('✓ '+name);};
(async()=>{
 const SQL=await req('sql.js')({locateFile:file=>path.join(dependencies,'node_modules/sql.js/dist',file)});
 const seedBytes=fs.readFileSync(path.join(dependencies,'data/keeper.db'));
 function harness(bytes=null){
  const files=new Map([['memory.db',bytes], [path.join(root,'data/keeper.db'),seedBytes]]),handlers=new Map();let failBackup=false,failWrite=false;
  const context=vm.createContext({Buffer,Date,console:{log(){},error(){}},process:{env:{},platform:'win32'},__dirname:path.join(root,'electron'),require(name){
   if(name==='electron')return{app:{disableHardwareAcceleration(){},requestSingleInstanceLock:()=>true,on(){},whenReady:()=>({then(){}})},ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},dialog:{},shell:{}};
   if(name==='electron-updater')return{autoUpdater:{on(){}}};
   if(name==='fs')return{...fs,existsSync:file=>files.has(file),readFileSync:file=>Buffer.from(files.get(file)),writeFileSync(file,data){if(failBackup&&file.includes('.bak'))throw Error('backup blocked');if(failWrite&&!file.includes('.bak'))throw Error('disk full');files.set(file,typeof data==='string'?data:Buffer.from(data));},renameSync(from,to){files.set(to,files.get(from));files.delete(from);}};
   return name.startsWith('./')?req(path.join(fs.existsSync(path.join(root,'electron',name))?root:dependencies,'electron',name)):req(name);
  }});
  vm.runInContext(source+`\nglobalThis.h={setup(SQL,bytes){sqlModule=SQL;db=bytes?new SQL.Database(new Uint8Array(bytes)):new SQL.Database();db.run(SCHEMA);migrate();buildFormIndex();dbPath='memory.db';registerIpc();},q,run,resolveWord,buildFormIndex,rebuildWordFreq,syncSeedExams,snapshot:()=>Buffer.from(db.export()),state:()=>contentSyncState};`,context);
  context.h.setup(SQL,bytes);
  return{...context.h,files,call:(name,...args)=>handlers.get(name)(null,...args),set failBackup(value){failBackup=value;},set failWrite(value){failWrite=value;}};
 }
 const h=harness(seedBytes),rows=plain(h.q('SELECT word,exchange FROM dict'));
 const words=new Set(rows.map(row=>row.word)),resolve=createWordResolver(word=>words.has(word),buildWordIndex(rows),extra);
 await test('共享解析器与真实词典 IPC 对全部正文词形一致',()=>{
  const tokens=new Set(h.q('SELECT content FROM passage').flatMap(row=>String(row.content).match(/[A-Za-z][A-Za-z’'\-]*/g)||[]));
  for(const token of tokens)assert.deepEqual(resolve(token),plain(h.resolveWord(token)));
  console.log('  正文词形 '+tokens.size+' 项一致');
 });
 await test('字典显式原形优先、逆向兜底且保留独立歧义条目',()=>{
  const sample=[{word:'run',exchange:'i:running'},{word:'running',exchange:'0:run'},{word:'left',exchange:''},{word:'leave',exchange:''}];
  const set=new Set(sample.map(row=>row.word)),lookup=createWordResolver(word=>set.has(word),buildWordIndex(sample),extra);
  assert.equal(lookup('RUNNING').word,'run');assert.equal(lookup('left').word,'left');assert.equal(lookup('constructor').exact,false);
 });
 await test('语境只匹配完整词，子串、连字符复合词和无目标原句不会挖空',()=>{
  const result=markContext('Art is part of partial art-school. ART!', 'art',resolve);
  assert.equal(result.count,2);assert.match(result.html,/partial art-school/);assert.equal(markContext('A partial start.','art',resolve).count,0);
  assert.equal(markContext('123art art123 _art art_ caféart','art',resolve).count,0);
 });
 await test('不规则与屈折形式按原位置挖空，重复词保留大小写和原始表面形式',()=>{
  const sentence='RUNNING runners run; Running!';const marked=markContext(sentence,'run',resolve);
  assert.equal(marked.count,3);assert.equal(marked.html,'<span class="blank">RUNNING</span> runners <span class="blank">run</span>; <span class="blank">Running</span>!');
  assert.match(markContext('They went home.','go',resolve).html,/>went<\/span>/);
 });
 await test('曲撇号缩写与词典同义归并保持一致，不对原句做字符串归一化',()=>{
  const target=resolve('don’t').word,marked=markContext('DON’T, don’t, don\'t.',target,resolve);
  assert.equal(marked.count,3);assert.match(marked.html,/DON’T<\/span>/);assert.match(marked.html,/don&#39;t/);
 });
 await test('HTML、实体、引号与换行只转义原文，不把标签或属性注入卡片',()=>{
  const marked=markContext('<img src=x onerror="evil()"> & art\nArt','art',resolve);
  assert.equal(marked.count,2);assert.match(marked.html,/&lt;img src=x onerror=&quot;evil\(\)&quot;&gt; &amp;/);assert.equal(marked.html.includes('<img'),false);
 });
 await test('同篇重复原词与不同屈折形式只记一篇，不同篇和考次分别累计',()=>{
  const passages=[{exam_id:1,content:'running run RUNNING runners'},{exam_id:1,content:'runs run'},{exam_id:2,content:'running'}];
  const counts=countWordFrequency(passages,rows,extra);assert.deepEqual(counts.find(row=>row.word==='run'),{word:'run',total:3,exams:2});
 });
 await test('停用词和长度按归并后的原形再过滤，未知词不进入统计',()=>{
  const sample=[{word:'having',exchange:'0:have'},{word:'have',exchange:''},{word:'goes',exchange:'0:go'},{word:'go',exchange:''},{word:'run',exchange:''}];
  assert.deepEqual(countWordFrequency([{exam_id:1,content:'having goes nonexistentzz run'}],sample,extra),[{word:'run',total:1,exams:1}]);
 });
 await test('复习队列选择有效原句，旧空句和最新错误子串会回退到较早有效出处',()=>{
  const local=harness();local.run("INSERT INTO dict(word,exchange) VALUES ('art',''),('partial','')");local.buildFormIndex();
  local.run("INSERT INTO user_word(word,status) VALUES ('art','learning')");
  for(const sentence of ['Art & ART.','','A partial start.'])local.run('INSERT INTO word_hit(word,sentence) VALUES (?,?)',['art',sentence]);
  const card=local.call('review:queue').fresh[0];assert.equal(card.sentence,'Art & ART.');assert.equal((card.clozeHtml.match(/class="blank"/g)||[]).length,2);
 });
 await test('缺目标词的复习卡返回空挖空内容，真实 Vue 组件回退普通词卡',()=>{
  const local=harness();local.run("INSERT INTO user_word(word,status) VALUES ('art','learning')");local.run("INSERT INTO word_hit(word,sentence) VALUES ('art','A partial start.')");
  const card=local.call('review:queue').fresh[0];assert.equal(card.clozeHtml,'');
  const vue=req('vue'),file=fs.readFileSync(path.join(root,'src/views/ReviewView.vue'),'utf8');
  const script=file.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?$/gm,'');
  const component=vm.runInNewContext(script+'\n({list,clozeHtml});',{...vue,onMounted(){},onBeforeUnmount(){}});component.list.value=[card];assert.equal(component.clozeHtml.value,'');assert.match(file,/clozeMode && clozeHtml/);
 });
 await test('Anki 原句按相同词形定位，保留原句并转义字段里的 HTML 与制表符',async()=>{
  const local=harness(seedBytes);local.run("INSERT INTO user_word(word,status,note) VALUES ('run','learning',?)",['<b>note</b>\tend']);local.run("INSERT INTO word_hit(word,sentence) VALUES ('run',?)",['Running runners run <img src=x>.']);
  await local.call('export:anki',{targetPath:'anki.txt'});const output=local.files.get('anki.txt');assert.match(output,/<b>Running<\/b> runners <b>run<\/b> &lt;img src=x&gt;/);assert.match(output,/&lt;b&gt;note&lt;\/b&gt; end/);
  assert.equal(output.split('\n').find(line=>line.startsWith('run')).split('\t').length,5);
 });
 await test('运行时重算与构建调用同一纯计数函数，停用篇章/考次不计入',()=>{
  const local=harness(seedBytes);local.run('UPDATE passage SET retired=1 WHERE id=(SELECT MIN(id) FROM passage)');local.run('UPDATE exam SET retired=1 WHERE id=(SELECT MAX(id) FROM exam)');
  const expected=countWordFrequency(plain(local.q('SELECT p.* FROM passage p JOIN exam e ON e.id=p.exam_id WHERE p.retired=0 AND e.retired=0')),rows,extra);
  local.rebuildWordFreq();const actual=plain(local.q('SELECT * FROM word_freq')).sort((a,b)=>a.word.localeCompare(b.word));assert.deepEqual(actual,expected);
  const build=fs.readFileSync(path.join(root,'scripts/build-db.mjs'),'utf8');assert.match(build,/wordSemantics\.countWordFrequency\(rows,wordRows,EXTRA_FORMS\)/);assert.equal(build.includes('function reduce('),false);
 });
 await test('真实语料频率差异审计：篇数不超过正文数，明确列出新旧差异',()=>{
  const old=new Map(h.q('SELECT * FROM word_freq').map(row=>[row.word,row]));
  const passages=plain(h.q('SELECT p.* FROM passage p JOIN exam e ON e.id=p.exam_id WHERE p.retired=0 AND e.retired=0'));
  const computed=countWordFrequency(passages,rows,extra),current=new Map(computed.map(row=>[row.word,row]));
  let changed=0,removed=0,added=0;
  for(const [word,row] of current){assert.ok(row.exams>0&&row.exams<=row.total&&row.total<=passages.length);if(!old.has(word))added++;else if(row.total!==old.get(word).total||row.exams!==old.get(word).exams)changed++;}
  for(const word of old.keys())if(!current.has(word))removed++;
  console.log(JSON.stringify({old:old.size,current:current.size,changed,removed,added,samples:['run','make','work','have','go'].map(word=>({word,before:old.get(word),after:current.get(word)}))},null,2));
 });
 function migratedFixture(){const local=harness(seedBytes);local.run("DELETE FROM content_sync_state WHERE source='word-frequency'");local.run("INSERT INTO user_word(word,status,note) VALUES ('run','learning','keep me')");local.run("INSERT INTO word_hit(word,sentence) VALUES ('run','Running.')");local.run("INSERT INTO review_log(word_id,rating) VALUES ((SELECT id FROM user_word WHERE word='run'),2)");const bytes=local.snapshot();return{local:harness(bytes),bytes};}
 await test('旧库算法版本迁移创建原字节备份，学习记录及内容身份完全保留',()=>{
  const {local,bytes}=migratedFixture(),tables=['user_word','word_hit','review_log','exam','passage','question'];const before=tables.map(table=>plain(local.q('SELECT * FROM '+table)));
  local.syncSeedExams(bytes);assert.equal(local.state().status,'ok');assert.equal(local.state().frequencyChanged,true);assert.equal(local.q("SELECT revision FROM content_sync_state WHERE source='word-frequency'")[0].revision,FREQUENCY_REVISION);
  assert.deepEqual(local.files.get(local.state().backupPath),bytes);assert.deepEqual(tables.map(table=>plain(local.q('SELECT * FROM '+table))),before);
 });
 await test('频率迁移二次启动不重新备份、不重算，数据库字节保持不变',()=>{
  const {local,bytes}=migratedFixture();local.syncSeedExams(bytes);const saved=Buffer.from(local.files.get('memory.db')),restarted=harness(saved);restarted.syncSeedExams(saved);
  assert.equal(restarted.state().status,'ok');assert.equal(restarted.state().frequencyChanged,false);assert.equal(restarted.state().backupPath,null);assert.deepEqual(restarted.snapshot(),saved);
 });
 await test('迁移备份失败不修改计数或版本，写盘失败恢复旧内存和磁盘',()=>{
  for(const fault of ['failBackup','failWrite']){const {local,bytes}=migratedFixture(),before=plain(local.q('SELECT * FROM word_freq'));local[fault]=true;local.syncSeedExams(bytes);assert.equal(local.state().status,'error');assert.deepEqual(plain(local.q('SELECT * FROM word_freq')),before);assert.equal(local.q("SELECT * FROM content_sync_state WHERE source='word-frequency'").length,0);assert.deepEqual(local.files.get('memory.db'),bytes);}
 });
 await test('重算中途 SQL 故障回滚旧计数和版本，导入外层事务也可完整回退',()=>{
  const local=harness(seedBytes),before=plain(local.q('SELECT * FROM word_freq')),marker=plain(local.q("SELECT * FROM content_sync_state WHERE source='word-frequency'"));
  local.run("CREATE TRIGGER reject_frequency BEFORE INSERT ON word_freq BEGIN SELECT RAISE(ABORT,'frequency blocked'); END");assert.throws(()=>local.rebuildWordFreq(),/frequency blocked/);assert.deepEqual(plain(local.q('SELECT * FROM word_freq')),before);assert.deepEqual(plain(local.q("SELECT * FROM content_sync_state WHERE source='word-frequency'")),marker);
  local.run('DROP TRIGGER reject_frequency');local.run('BEGIN');local.rebuildWordFreq();local.run('ROLLBACK');assert.deepEqual(plain(local.q('SELECT * FROM word_freq')),before);
 });
 console.log(`\n词形语境与词频回归 ${passed}/${passed}`);
})().catch(error=>{console.error(error);process.exitCode=1;});

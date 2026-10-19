// 真实 sql.js + 内存库；禁止读取或写入真实用户目录。
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname,'..'), dependencies = process.env.KEEPER_DEPENDENCY_ROOT || root;
const req = createRequire(path.join(dependencies,'package.json'));
const { ensureContentSchema, syncBuiltinContent, stampBuiltinContent, assessmentRevision } = require('../electron/content-sync.cjs');
const main = fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8');
const schema = main.match(/const SCHEMA = `([\s\S]*?)`;/)[1];
let passed = 0;
function test(name, run) { run(); passed++; console.log('✓ ' + name); }
(async () => {
  const SQL = await req('sql.js')({ locateFile:f => path.join(dependencies,'node_modules/sql.js/dist',f) });
  const q = (db,sql,params=[]) => { const s=db.prepare(sql); try { s.bind(params); const a=[]; while(s.step())a.push(s.getAsObject()); return a; } finally{s.free();} };
  function fixture(legacy = false) {
    const db = new SQL.Database(); db.run(schema);
    for (const name of ['translation','reference','rows']) db.run(`ALTER TABLE passage ADD COLUMN ${name} TEXT`);
    db.run("INSERT INTO exam(id,level,year,month,set_no,title) VALUES (1,'CET4',2020,6,1,'test')");
    db.run("INSERT INTO passage(id,exam_id,section,seq,title,content,translation,rows) VALUES (1,1,'reading',1,'title','Original article.','原文','[{\"en\":\"Original article.\",\"zh\":\"原文\"}]')");
    for (const [id,answer] of [[46,'A'],[47,'B'],[48,'C']]) db.run("INSERT INTO question(id,passage_id,qtype,stem,options,answer,analysis) VALUES (?,1,'choice',?,'[\"A yes\",\"B no\"]',?,'original analysis')",[id,id+'. Question',answer]);
    if (!legacy) ensureContentSchema(db); return db;
  }
  const clone = db => new SQL.Database(db.export());
  const rows = db => q(db,'SELECT id,stem,answer FROM question WHERE retired=0 ORDER BY source_order,id');
  const records = (db,table) => JSON.stringify(q(db,`SELECT * FROM ${table} ORDER BY id`));
  test('缺中间题只补缺题，后续题 ID 与答案不串位，显示顺序恢复', () => {
    const seed=fixture(), local=clone(seed); local.run('DELETE FROM question WHERE id=47'); local.run("UPDATE question SET answer='' WHERE id=48");
    syncBuiltinContent(local,seed); assert.deepEqual(rows(local).map(x=>[x.stem,x.answer]),rows(seed).map(x=>[x.stem,x.answer]));
    assert.equal(q(local,'SELECT answer FROM question WHERE id=48')[0].answer,'C');
  });
  test('非空错误正文、答案、翻译和 rows 更新；旧内容有归档', () => {
    const seed=fixture(), local=clone(seed); local.run("UPDATE passage SET content='wrong',translation='wrong',rows='[]'"); local.run("UPDATE question SET answer='Z'");
    syncBuiltinContent(local,seed); assert.equal(q(local,'SELECT content FROM passage')[0].content,'Original article.');
    assert.equal(rows(local)[0].answer,'A'); assert.ok(q(local,'SELECT * FROM content_history').length>=4);
    assert.equal(JSON.parse(q(local,"SELECT payload FROM content_history WHERE entity='question' AND local_id=46")[0].payload).answer,'Z');
  });
  test('删除或新增题目不删除旧作答、生词、出处、笔记、复习、错题和作文', () => {
    const seed=fixture(), local=clone(seed);
    local.run("INSERT INTO user_word(id,word,note) VALUES (1,'original','private'); INSERT INTO word_hit VALUES(1,'original',1,'Old sentence.'); INSERT INTO review_log(id,word_id,rating) VALUES (1,1,3); INSERT INTO user_answer(exam_id,question_id,choice) VALUES(1,46,'A'); INSERT INTO mistake(question_id,user_answer) VALUES(46,'A'); INSERT INTO essay(exam_id,section,content) VALUES(1,'writing','draft'); INSERT INTO chat_message(role,content) VALUES('user','private'); INSERT INTO settings VALUES('api_key','private');");
    const tables=['user_word','word_hit','review_log','user_answer','mistake','essay','chat_message']; const before=tables.map(t=>records(local,t));
    seed.run('DELETE FROM question WHERE id=46'); syncBuiltinContent(local,seed);
    assert.equal(q(local,'SELECT retired FROM question WHERE id=46')[0].retired,1);
    assert.deepEqual(tables.map(t=>records(local,t)),before); assert.equal(q(local,'SELECT value FROM settings')[0].value,'private');
  });
  test('导入同名考次不会匹配、更新或归档；内置考次可独立补入', () => {
    const seed=fixture(), local=clone(seed); local.run("UPDATE exam SET imported=1; UPDATE passage SET content='My article'; UPDATE question SET answer='D'");
    const before=['exam','passage','question'].map(t=>records(local,t)); syncBuiltinContent(local,seed);
    assert.equal(q(local,'SELECT COUNT(*) n FROM exam')[0].n,2);
    for(const [i,t] of ['exam','passage','question'].entries())assert.deepEqual(q(local,`SELECT * FROM ${t} WHERE id IN (${t==='question'?'46,47,48':'1'})`),JSON.parse(before[i]));
    assert.equal(q(local,'SELECT COUNT(*) n FROM content_history')[0].n,0);
  });
  test('重复身份旧题归档保留引用，建立唯一新题并报告冲突', () => {
    const seed=fixture(),local=clone(seed); local.run("INSERT INTO question(passage_id,qtype,stem,options,answer) SELECT passage_id,qtype,stem,options,'D' FROM question WHERE id=47");
    local.run("INSERT INTO user_answer(exam_id,question_id,choice) VALUES(1,47,'B')"); const summary=syncBuiltinContent(local,seed);
    assert.equal(summary.issues,1); assert.equal(q(local,'SELECT retired FROM question WHERE id=47')[0].retired,1);
    assert.equal(q(local,'SELECT question_id FROM user_answer')[0].question_id,47); assert.equal(rows(local).length,3);
    assert.equal(syncBuiltinContent(local,seed).changed,false);
  });
  test('已建立身份后，题号或篇章序号调整仍保留行 ID', () => {
    const seed=fixture(),local=clone(seed); stampBuiltinContent(seed); syncBuiltinContent(local,seed);
    seed.run("UPDATE question SET stem='49. Corrected question' WHERE id=47; UPDATE passage SET seq=2");
    syncBuiltinContent(local,seed); assert.equal(q(local,'SELECT stem FROM question WHERE id=47')[0].stem,'49. Corrected question');
    assert.equal(q(local,'SELECT seq FROM passage WHERE id=1')[0].seq,2);
  });
  test('旧题 ID 顺序颠倒仍按身份修正并保留原作答引用', () => {
    const seed=fixture(),local=fixture(); const previous=q(local,'SELECT * FROM question'); local.run('DELETE FROM question');
    for (const item of previous) local.run('INSERT INTO question(id,passage_id,qtype,stem,options,answer,analysis) VALUES (?,1,?,?,?,?,?)', [500-item.id,item.qtype,item.stem,item.options,'Z',item.analysis]);
    local.run("INSERT INTO user_answer(exam_id,question_id,choice) VALUES (1,452,'C')"); syncBuiltinContent(local,seed);
    assert.deepEqual(rows(local).map(x=>[x.id,x.answer]),[[454,'A'],[453,'B'],[452,'C']]);
    assert.equal(q(local,'SELECT question_id FROM user_answer')[0].question_id,452);
  });
  test('无题号题目按题干和选项身份匹配，不按数组下标', () => {
    const seed=fixture(),local=fixture(); seed.run("UPDATE question SET stem=substr(stem,5)"); local.run("UPDATE question SET stem=substr(stem,5)");
    // 未编号且完全相同的题干/选项本身就是歧义，载荷必须拒绝。
    assert.throws(()=>syncBuiltinContent(local,seed),/身份重复/);
    seed.run("UPDATE question SET stem='Unique '||id"); local.run("UPDATE question SET stem='Unique '||id"); local.run('DELETE FROM question WHERE id=47');
    syncBuiltinContent(local,seed); assert.equal(q(local,'SELECT answer FROM question WHERE id=48')[0].answer,'C');
  });
  test('种子身份冲突在任何内容写入前失败', () => {
    const seed=fixture(),local=fixture(); seed.run('UPDATE question SET source_id=?',['cwk:v1/exam/CET4/2020/6/1/passage/reading/1/question/duplicate']);
    const before=Buffer.from(local.export()); assert.throws(()=>syncBuiltinContent(local,seed),/身份重复/); assert.deepEqual(Buffer.from(local.export()),before);
  });
  test('事务中途出错时正文、归档、成绩版本和迁移状态全部回滚', () => {
    const seed=fixture(),local=fixture(); local.run("UPDATE question SET answer='Z'; INSERT INTO attempt(exam_id,total,correct,detail) VALUES(1,3,0,'[]')");
    local.run("CREATE TRIGGER reject_update BEFORE UPDATE ON question BEGIN SELECT RAISE(ABORT,'reject migration'); END");
    const before=Buffer.from(local.export()); assert.throws(()=>syncBuiltinContent(local,seed),/reject migration/); assert.deepEqual(Buffer.from(local.export()),before);
  });
  test('答案变更只给旧成绩标记版本，不改历史分数、选项和解析快照', () => {
    const seed=fixture(),local=fixture(); local.run("UPDATE question SET answer='Z' WHERE id=47; INSERT INTO attempt(exam_id,total,correct,score,detail) VALUES(1,3,1,33.3,'historical detail')");
    const oldRevision=assessmentRevision(local,1); syncBuiltinContent(local,seed); const attempt=q(local,'SELECT * FROM attempt')[0];
    assert.equal(attempt.content_revision,oldRevision); assert.notEqual(attempt.content_revision,assessmentRevision(local,1));
    assert.equal(attempt.detail,'historical detail'); assert.equal(attempt.score,33.3);
  });
  test('仅翻译、rows 和解析修正不使成绩过期', () => {
    const seed=fixture(),local=fixture(); local.run("UPDATE passage SET translation='old translation',rows='[]'; UPDATE question SET analysis='old'; INSERT INTO attempt(exam_id,total,score) VALUES(1,3,100)");
    syncBuiltinContent(local,seed); assert.equal(q(local,'SELECT content_revision FROM attempt')[0].content_revision,assessmentRevision(local,1));
  });
  test('种子缺省可选内容保留本地 AI 内容', () => {
    const seed=fixture(),local=fixture(); seed.run("UPDATE passage SET translation=NULL,rows=NULL; UPDATE question SET analysis='',answer=''");
    syncBuiltinContent(local,seed); assert.equal(q(local,'SELECT translation FROM passage')[0].translation,'原文'); assert.equal(rows(local)[0].answer,'A');
  });
  test('重启后的重复迁移不写记录，数据库字节也不变', () => {
    const seed=fixture(),local=fixture(); syncBuiltinContent(local,seed); const before=Buffer.from(local.export()); const reopened=new SQL.Database(new Uint8Array(before));
    assert.equal(syncBuiltinContent(reopened,seed).changed,false); assert.deepEqual(Buffer.from(reopened.export()),before);
  });
  function mainHarness() {
    const seed=fixture(), original=fixture(true); original.run("UPDATE question SET answer='Z'"); const bytes=Buffer.from(original.export());
    const files=new Map([['memory.db',bytes], [path.join(root,'data/keeper.db'),Buffer.from(seed.export())]]); let failRename=false,failBackup=false;
    const handlers=new Map();
    const context=vm.createContext({ Buffer,Date,console:{log(){},error(){}},process:{env:{},platform:'win32'},__dirname:path.join(root,'electron'),require(name){
      if(name==='electron')return {app:{disableHardwareAcceleration(){},requestSingleInstanceLock:()=>true,on(){},whenReady:()=>({then(){}}),getVersion:()=> 'test'},ipcMain:{handle:(n,f)=>handlers.set(n,f)},dialog:{},shell:{}};
      if(name==='electron-updater')return {autoUpdater:{on(){}}};
      if(name==='fs')return {...fs,existsSync:p=>files.has(p),readFileSync:p=>Buffer.from(files.get(p)),writeFileSync(p,b){if(failBackup&&p.includes('.bak'))throw Error('backup blocked');files.set(p,Buffer.from(b));},renameSync(a,b){if(failRename)throw Error('disk rename failed');files.set(b,files.get(a));files.delete(a);}};
      return name.startsWith('./') ? req(path.join(fs.existsSync(path.join(root,'electron',name))?root:dependencies,'electron',name)) : req(name);
    }});
    vm.runInContext(main+`\nglobalThis.h={ setup(SQL,bytes){sqlModule=SQL;db=new SQL.Database(new Uint8Array(bytes));db.run(SCHEMA);migrate();dbPath='memory.db';buildFormIndex();registerIpc();},syncSeedExams,q,run,persist,gradeExam,state:()=>contentSyncState };`,context);
    context.h.setup(SQL,bytes); return {...context.h,files,bytes,call:(n,...a)=>handlers.get(n)(null,...a), failRename:()=>{failRename=true;},failBackup:()=>{failBackup=true;}};
  }
  test('迁移写盘失败恢复内存和磁盘，后续普通保存不夹带失败内容', () => {
    const h=mainHarness(); h.failRename(); h.syncSeedExams(h.bytes); assert.equal(h.state().status,'error'); assert.equal(h.q('SELECT answer FROM question WHERE id=46')[0].answer,'Z');
    assert.deepEqual(h.files.get('memory.db'),h.bytes); assert.ok([...h.files.keys()].some(p=>p.includes('.bak')));
    assert.throws(()=>h.persist(),/disk rename failed/); assert.equal(h.q('SELECT answer FROM question WHERE id=46')[0].answer,'Z');
  });
  test('备份失败禁止持久化；备份原字节可重新打开并保留旧内容', () => {
    const h=mainHarness();h.failBackup();h.syncSeedExams(h.bytes);assert.equal(h.state().status,'error'); assert.deepEqual(h.files.get('memory.db'),h.bytes);
    const ok=mainHarness();ok.syncSeedExams(ok.bytes);const backup=[...ok.files.entries()].find(([p])=>p.includes('.bak'))[1];assert.deepEqual(backup,ok.bytes);
    assert.equal(q(new SQL.Database(new Uint8Array(backup)),'SELECT answer FROM question WHERE id=46')[0].answer,'Z');
  });
  test('实际 IPC 隐藏归档题、按题序显示补题并标记旧成绩', () => {
    const h=mainHarness(); h.run("INSERT INTO attempt(exam_id,total,score) VALUES(1,3,0)"); h.syncSeedExams(h.bytes);
    const detail=h.call('exam:detail',1); assert.equal(detail.passages[0].questions.length,3); assert.equal(h.call('attempt:get',1).contentChanged,true);
    h.run('UPDATE question SET retired=1 WHERE id=47'); assert.equal(h.call('exam:detail',1).passages[0].questions.length,2);
    assert.equal(h.gradeExam(1,{}).total,2); assert.equal(h.call('attempt:get',1).contentChanged,false);
  });
  test('全量种子迁移可重复执行且保留现有所有篇章/题目 ID', () => {
    const bytes=fs.readFileSync(path.join(dependencies,'data/keeper.db')); const seed=new SQL.Database(new Uint8Array(bytes)), local=new SQL.Database(new Uint8Array(bytes));
    const before=['exam','passage','question'].map(t=>q(local,`SELECT id FROM ${t} ORDER BY id`));
    ensureContentSchema(local);syncBuiltinContent(local,seed);assert.deepEqual(['exam','passage','question'].map(t=>q(local,`SELECT id FROM ${t} WHERE retired=0 ORDER BY id`)),before);
    assert.equal(syncBuiltinContent(local,seed).changed,false);
  });
  console.log(`内容迁移回归 ${passed}/${passed} 通过`);
})().catch(error=>{console.error(error);process.exitCode=1;});

// 增量同步验证：模拟「老用户库」（少几套真题 + 已有学习记录），
// 启动应用后应当补齐新考次，同时完整保留用户的学习记录。
// 用法: node scripts/sync-check.mjs
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';
import { createHash } from 'node:crypto';
import { createTestSession, availablePort, waitForPage, connectCdp, stopChild } from './lib/test-session.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedPath = path.join(root, 'data', 'keeper.db');
const session = createTestSession('sync');
const userDataDir = session.dir;
const userDb = path.join(userDataDir, 'keeper.db');
let el;
let cdp;

try {
const SQL = await initSqlJs({ locateFile: (f) => path.join(root, 'node_modules', 'sql.js', 'dist', f) });

// ---- 1) 构造「老用户库」：删掉最新的 CET4 考次，并留下学习记录 ----
fs.mkdirSync(userDataDir, { recursive: true });
const old = new SQL.Database(fs.readFileSync(seedPath));
const totalSeed = old.exec('SELECT COUNT(*) FROM exam')[0].values[0][0];

// 删掉最新的若干套 CET4（不看年份，确保一定有可删的）
const recent = old.exec('SELECT id, title FROM exam WHERE level=? ORDER BY year DESC, month DESC, set_no DESC', ['CET4'])[0].values;
const removedIds = recent.slice(0, 3).map((r) => r[0]);
const removedTitles = recent.slice(0, 3).map((r) => r[1]);
const importedExam = old.exec('SELECT level,year,month,set_no FROM exam WHERE id=?', [removedIds[0]])[0].values[0];
for (const id of removedIds) {
  for (const pid of old.exec('SELECT id FROM passage WHERE exam_id=?', [id])[0].values.map((v) => v[0])) {
    old.run('DELETE FROM question WHERE passage_id=?', [pid]);
  }
  old.run('DELETE FROM passage WHERE exam_id=?', [id]);
  old.run('DELETE FROM exam WHERE id=?', [id]);
}
const afterDelete = old.exec('SELECT COUNT(*) FROM exam')[0].values[0][0];
// 模拟一个早于内置内容加入的同名导入，不能拿它冒充内置试卷。
old.run('INSERT INTO exam(level,year,month,set_no,title,imported) VALUES (?,?,?,?,?,1)', [...importedExam,'Private material']);
const importedId = old.exec('SELECT last_insert_rowid()')[0].values[0][0];
old.run("INSERT INTO passage(exam_id,section,seq,content) VALUES (?,'reading',1,'Private imported article.')", [importedId]);

// 留下一条学习记录，验证同步不会误伤
const pid = old.exec('SELECT id FROM passage LIMIT 1')[0].values[0][0];
old.run("INSERT INTO user_word(word, status, note, created_at) VALUES ('intervene','learning','同步测试笔记',?)", [new Date().toISOString()]);
old.run('INSERT INTO word_hit(word, passage_id, sentence) VALUES (?,?,?)', ['intervene', pid, 'They intervened quickly.']);
const marks = {
  words: old.exec('SELECT COUNT(*) FROM user_word')[0].values[0][0],
  hits: old.exec('SELECT COUNT(*) FROM word_hit')[0].values[0][0],
  note: old.exec("SELECT note FROM user_word WHERE word='intervene'")[0].values[0][0],
};
// ---- 1b) 再模拟「老用户库还没有预置内容」----
// 老用户库里这批考次早就存在，所以「补缺考次」逻辑不会碰它们；
// 内容回填（backfillContent）必须把答案/解析/翻译补进这些空字段，并把新补出的题目加回来。
const tgt = old.exec(`SELECT p.exam_id AS id, COUNT(*) AS n FROM question q JOIN passage p ON p.id = q.passage_id
  WHERE q.answer IS NOT NULL AND TRIM(q.answer) <> '' GROUP BY p.exam_id ORDER BY n DESC LIMIT 1`);
let backfill = null;
if (tgt.length && tgt[0].values.length) {
  const tgtId = tgt[0].values[0][0];
  const qRows = old.exec('SELECT q.id,q.answer FROM question q JOIN passage p ON p.id=q.passage_id WHERE p.exam_id=? ORDER BY q.id', [tgtId]);
  const qIds = qRows.length ? qRows[0].values.map((v) => v[0]) : [];
  const expectedAnswers = new Map(qRows.length ? qRows[0].values : []);
  const pRows = old.exec('SELECT id FROM passage WHERE exam_id=? ORDER BY id', [tgtId]);
  const pIds = pRows.length ? pRows[0].values.map((v) => v[0]) : [];
  const blankQ = qIds.slice(0, Math.max(1, Math.floor(qIds.length / 2)));
  for (const id of blankQ) old.run("UPDATE question SET answer='', analysis='' WHERE id=?", [id]);
  for (const id of pIds) old.run('UPDATE passage SET translation=NULL WHERE id=?', [id]);
  // 必须挑「确实有题目的篇章」来删，否则这条断言是空转的
  const pWithQ = pIds.filter((id) => old.exec('SELECT COUNT(*) FROM question WHERE passage_id=?', [id])[0].values[0][0] > 0);
  const delPid = pWithQ[pWithQ.length - 1];
  const delCount = delPid ? old.exec('SELECT COUNT(*) FROM question WHERE passage_id=?', [delPid])[0].values[0][0] : 0;
  const middlePid = pWithQ[0];
  const middleQs = old.exec('SELECT id,stem,answer FROM question WHERE passage_id=? ORDER BY id', [middlePid])[0].values;
  const deletedMiddle = middleQs[1][0];
  const followingId = middleQs[2][0];
  const correctAnswer = expectedAnswers.get(followingId);
  const expectedRows = old.exec('SELECT rows FROM passage WHERE id=?', [middlePid])[0].values[0][0];
  old.run('DELETE FROM question WHERE id=?', [deletedMiddle]);
  old.run("UPDATE question SET answer='Z',analysis='wrong nonempty answer' WHERE id=?", [followingId]);
  old.run("UPDATE passage SET rows='[]' WHERE id=?", [middlePid]);
  // 历史成绩与作答保留原含义，不用新版答案重新计算过去的分数。
  old.run("INSERT INTO attempt(exam_id,total,correct,score,detail) VALUES (?,30,10,33.3,'historical scoring detail')", [tgtId]);
  old.run(`CREATE TABLE IF NOT EXISTS user_answer(id INTEGER PRIMARY KEY AUTOINCREMENT,exam_id INTEGER,question_id INTEGER,choice TEXT,is_correct INTEGER,updated_at TEXT,UNIQUE(exam_id,question_id));
    CREATE TABLE IF NOT EXISTS essay(id INTEGER PRIMARY KEY AUTOINCREMENT,exam_id INTEGER,section TEXT,content TEXT,result TEXT,updated_at TEXT,UNIQUE(exam_id,section));`);
  old.run("INSERT INTO user_answer(exam_id,question_id,choice,is_correct) VALUES (?,?,'Z',1)", [tgtId,followingId]);
  old.run("INSERT INTO essay(exam_id,section,content) VALUES (?,'writing','Private essay draft')", [tgtId]);
  old.run("INSERT INTO review_log(word_id,mode,rating) SELECT id,'flashcard',3 FROM user_word WHERE word='intervene'");
  if (delPid) old.run('DELETE FROM question WHERE passage_id=?', [delPid]);
  backfill = { examId: tgtId, qTotal: qIds.length, blankQ: blankQ.length, pTotal: pIds.length, delCount, middlePid, deletedMiddle, followingId, correctAnswer, expectedRows, expectedStems: middleQs.map(x=>x[1]) };
  console.log(`已模拟无预置内容: 考次#${tgtId} 清空 ${blankQ.length} 题答案/解析、${pIds.length} 篇翻译，并删掉 ${delCount} 题`);
} else {
  console.log('种子库暂无预置内容，跳过回填模拟');
}

// 模拟尚未拥有身份元数据的旧版本；不允许用状态表作为跳过内容校验的理由。
for (const table of ['exam','passage','question']) old.run(`UPDATE ${table} SET source_id=NULL,content_revision=NULL`);
old.run('DELETE FROM content_sync_state; DELETE FROM content_history; DELETE FROM content_sync_issue;');
const originalBytes = Buffer.from(old.export());
fs.writeFileSync(userDb, originalBytes);
old.close();
console.log(`老用户库已构造: 真题 ${afterDelete} 套（种子 ${totalSeed}），学习记录 ${marks.words} 词 / ${marks.hits} 出处`);

// ---- 2) 启动应用 ----
const env = session.env;
const port = await availablePort();
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
el = spawn(electronExe, ['.', `--remote-debugging-port=${port}`, '--no-sandbox', '--disable-gpu',
  '--disable-gpu-compositing', '--disable-software-rasterizer'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
let appErr = '';
el.stderr.on('data', (d) => { appErr += d.toString(); });
const page = await waitForPage(port, el);
cdp = await connectCdp(page);
const { js } = cdp;

const exams = await js('window.keeper.listExams()');
const stats = await js('window.keeper.stats()');
const words = await js('window.keeper.listWords({})');
const detail = await js(`window.keeper.wordDetail('intervene')`);

// ---- 3) 断言 ----
const results = [];
const check = (name, ok, detailTxt) => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name}${detailTxt ? ' — ' + detailTxt : ''}`); };
check('新考次已补齐且同名导入独立保留', exams.length === totalSeed + 1, `同步后 ${exams.length}（内置 ${totalSeed} + 导入 1）`);
const backTitles = exams.map((e) => e.title);
check('被删的考次都回来了', removedTitles.every((t) => backTitles.includes(t)), removedTitles.join(', '));
check('学习记录完整保留', words.length === marks.words && stats.learning + stats.mastered === marks.words, `${words.length} 词`);
check('私人笔记未被覆盖', words[0] && words[0].note === marks.note, `note="${words[0] ? words[0].note : ''}"`);
check('出处句未被破坏', detail.hits.length === marks.hits, `${detail.hits.length} 条`);

// ---- 4) 预置内容回填断言 ----
if (backfill) {
  const td = await js(`window.keeper.examDetail(${backfill.examId})`);
  const tqs = td.passages.flatMap((p) => p.questions || []);
  const objP = td.passages.filter((p) => ['cloze', 'match', 'reading'].includes(p.section));
  check('预置答案已回填进老用户库', tqs.length === backfill.qTotal && tqs.every((q) => (q.answer || '').trim()),
    `${tqs.filter((q) => (q.answer || '').trim()).length}/${tqs.length} 题有答案（原本 ${backfill.qTotal - backfill.blankQ - backfill.delCount} 题有）`);
  check('预置中文解析已回填', tqs.every((q) => (q.analysis || '').length > 8),
    '最短解析 ' + Math.min(...tqs.map((q) => (q.analysis || '').length)) + ' 字');
  check('预置全文翻译已回填', objP.length > 0 && objP.every((p) => (p.translation || '').length > 50),
    `${objP.filter((p) => (p.translation || '').length > 50).length}/${objP.length} 篇`);
  check('被删的题目已补回', tqs.length === backfill.qTotal, `补回后 ${tqs.length} 题（删过 ${backfill.delCount} 题）`);
  const stillOk = await js(`window.keeper.listWords({})`);
  check('回填未触碰学习记录', stillOk.length === marks.words, `${stillOk.length} 词`);
  const repaired = td.passages.find(p=>p.id === backfill.middlePid);
  check('缺中间题恢复正确顺序', JSON.stringify(repaired.questions.map(q=>q.stem)) === JSON.stringify(backfill.expectedStems));
  check('后续题 ID 不变且非空错误答案修正', repaired.questions.find(q=>q.id === backfill.followingId)?.answer === backfill.correctAnswer);
  check('第二批修正的 rows 已同步', JSON.stringify(repaired.rows) === backfill.expectedRows);
  const savedAttempt = await js(`window.keeper.attemptGet(${backfill.examId})`);
  check('旧成绩保留且标记内容已更新', savedAttempt.contentChanged && savedAttempt.attempt.score === 33.3 && savedAttempt.attempt.detail === 'historical scoring detail');
  check('旧作答未改写', savedAttempt.answers.some(a=>a.question_id === backfill.followingId && a.choice === 'Z' && a.is_correct === 1));
  const draft = await js(`window.keeper.essayGet(${backfill.examId},'writing')`);
  check('作文草稿保留', draft.content === 'Private essay draft');
  await js(`location.hash='/reader/${backfill.examId}'`);
  let changedNotice = false;
  for (let tries=0;tries<40;tries++) {
    changedNotice = await js(`document.body.innerText.includes('历史交卷和作答已保留')`);
    if (changedNotice) break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  check('实际阅读器展示旧成绩更新提示', changedNotice);
}
const importedDetail = await js(`window.keeper.examDetail(${importedId})`);
check('同名导入内容未覆盖', importedDetail.exam.imported === 1 && importedDetail.passages[0].content === 'Private imported article.');
const info = await js('window.keeper.info()');
check('迁移前完整备份字节一致', info.contentSync.status === 'ok' && !!info.contentSync.backupPath && fs.readFileSync(info.contentSync.backupPath).equals(originalBytes));
cdp.close(); cdp = null; await stopChild(el); el = null;
const persisted = fs.readFileSync(userDb), snapshotHash = createHash('sha256').update(persisted).digest('hex');
const migrated = new SQL.Database(new Uint8Array(persisted));
check('复习记录仍然保留', migrated.exec('SELECT COUNT(*) FROM review_log')[0].values[0][0] === 1);
check('旧内容已归档可追溯', migrated.exec('SELECT COUNT(*) FROM content_history')[0].values[0][0] > 0); migrated.close();
// 再启动一次验证磁盘层幂等，不能每次启动都重写用户库。
const nextPort = await availablePort();
el = spawn(electronExe, ['.',`--remote-debugging-port=${nextPort}`,'--no-sandbox','--disable-gpu'], {cwd:root,env,stdio:['ignore','ignore','pipe']});
el.stderr.on('data',()=>{});
cdp = await connectCdp(await waitForPage(nextPort,el));
const restarted = await cdp.js('window.keeper.info()');
check('重启后不重复迁移', restarted.contentSync.status === 'ok' && !restarted.contentSync.changed);
check('重启后数据库字节保持一致', createHash('sha256').update(fs.readFileSync(userDb)).digest('hex') === snapshotHash);
if (appErr.trim()) { console.log('\n--- 应用 stderr ---'); console.log(appErr.trim().slice(0, 800)); }

const fail = results.filter((r) => !r.ok);
console.log(`\n===== 结果：${results.length - fail.length}/${results.length} 通过 =====`);
process.exitCode = fail.length ? 1 : 0;
} catch (error) {
  console.error('增量同步验证失败：', error.message);
  process.exitCode = 1;
} finally {
  cdp?.close();
  try { await stopChild(el); session.cleanup(); }
  catch (error) { console.error('测试清理失败：', error.message); process.exitCode = 1; }
}

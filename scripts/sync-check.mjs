// 增量同步验证：模拟「老用户库」（少几套真题 + 已有学习记录），
// 启动应用后应当补齐新考次，同时完整保留用户的学习记录。
// 用法: node scripts/sync-check.mjs
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedPath = path.join(root, 'data', 'keeper.db');
const userDataDir = path.join(process.env.APPDATA || '', 'cet-wordkeeper');
const userDb = path.join(userDataDir, 'keeper.db');

const SQL = await initSqlJs({ locateFile: (f) => path.join(root, 'node_modules', 'sql.js', 'dist', f) });

// ---- 1) 构造「老用户库」：删掉最新的 CET4 考次，并留下学习记录 ----
fs.mkdirSync(userDataDir, { recursive: true });
const old = new SQL.Database(fs.readFileSync(seedPath));
const totalSeed = old.exec('SELECT COUNT(*) FROM exam')[0].values[0][0];

// 删掉最新的若干套 CET4（不看年份，确保一定有可删的）
const recent = old.exec('SELECT id, title FROM exam WHERE level=? ORDER BY year DESC, month DESC, set_no DESC', ['CET4'])[0].values;
const removedIds = recent.slice(0, 3).map((r) => r[0]);
const removedTitles = recent.slice(0, 3).map((r) => r[1]);
for (const id of removedIds) {
  for (const pid of old.exec('SELECT id FROM passage WHERE exam_id=?', [id])[0].values.map((v) => v[0])) {
    old.run('DELETE FROM question WHERE passage_id=?', [pid]);
  }
  old.run('DELETE FROM passage WHERE exam_id=?', [id]);
  old.run('DELETE FROM exam WHERE id=?', [id]);
}
const afterDelete = old.exec('SELECT COUNT(*) FROM exam')[0].values[0][0];

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
  const qRows = old.exec('SELECT q.id FROM question q JOIN passage p ON p.id=q.passage_id WHERE p.exam_id=? ORDER BY q.id', [tgtId]);
  const qIds = qRows.length ? qRows[0].values.map((v) => v[0]) : [];
  const pRows = old.exec('SELECT id FROM passage WHERE exam_id=? ORDER BY id', [tgtId]);
  const pIds = pRows.length ? pRows[0].values.map((v) => v[0]) : [];
  const blankQ = qIds.slice(0, Math.max(1, Math.floor(qIds.length / 2)));
  for (const id of blankQ) old.run("UPDATE question SET answer='', analysis='' WHERE id=?", [id]);
  for (const id of pIds) old.run('UPDATE passage SET translation=NULL WHERE id=?', [id]);
  // 必须挑「确实有题目的篇章」来删，否则这条断言是空转的
  const pWithQ = pIds.filter((id) => old.exec('SELECT COUNT(*) FROM question WHERE passage_id=?', [id])[0].values[0][0] > 0);
  const delPid = pWithQ[pWithQ.length - 1];
  const delCount = delPid ? old.exec('SELECT COUNT(*) FROM question WHERE passage_id=?', [delPid])[0].values[0][0] : 0;
  if (delPid) old.run('DELETE FROM question WHERE passage_id=?', [delPid]);
  backfill = { examId: tgtId, qTotal: qIds.length, blankQ: blankQ.length, pTotal: pIds.length, delCount };
  console.log(`已模拟无预置内容: 考次#${tgtId} 清空 ${blankQ.length} 题答案/解析、${pIds.length} 篇翻译，并删掉 ${delCount} 题`);
} else {
  console.log('种子库暂无预置内容，跳过回填模拟');
}

fs.writeFileSync(userDb, Buffer.from(old.export()));
old.close();
console.log(`老用户库已构造: 真题 ${afterDelete} 套（种子 ${totalSeed}），学习记录 ${marks.words} 词 / ${marks.hits} 出处`);

// ---- 2) 启动应用 ----
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const el = spawn(electronExe, ['.', '--remote-debugging-port=9225', '--no-sandbox', '--disable-gpu',
  '--disable-gpu-compositing', '--disable-software-rasterizer'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
let appErr = '';
el.stderr.on('data', (d) => { appErr += d.toString(); });
await new Promise((r) => setTimeout(r, 9000));

const targets = await (await fetch('http://127.0.0.1:9225/json')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise((res) => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;

const exams = await js('window.keeper.listExams()');
const stats = await js('window.keeper.stats()');
const words = await js('window.keeper.listWords({})');
const detail = await js(`window.keeper.wordDetail('intervene')`);

// ---- 3) 断言 ----
const results = [];
const check = (name, ok, detailTxt) => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name}${detailTxt ? ' — ' + detailTxt : ''}`); };
check('新考次已补齐', exams.length === totalSeed, `同步前 ${afterDelete} → 同步后 ${exams.length}（种子 ${totalSeed}）`);
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
}
if (appErr.trim()) { console.log('\n--- 应用 stderr ---'); console.log(appErr.trim().slice(0, 800)); }

ws.close();
try { execSync(`taskkill /F /T /PID ${el.pid}`, { stdio: 'ignore' }); } catch { /* 已退出 */ }
try { fs.unlinkSync(userDb); console.log('已清理测试用户库'); } catch { /* 忽略 */ }

const fail = results.filter((r) => !r.ok);
console.log(`\n===== 结果：${results.length - fail.length}/${results.length} 通过 =====`);
process.exit(fail.length ? 1 : 0);

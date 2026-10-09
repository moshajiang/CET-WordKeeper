// 把 data/ai-answers/*.json（AI 预生成覆盖层）应用到 data/keeper.db
// 幂等：重复执行结果一致；按「套 → 篇章(section,seq) → 题目顺序」对齐，不依赖题干文本
// 用法: node scripts/apply-answers.mjs [--dry]
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const DB = path.join(root, 'data', 'keeper.db');
const AI_DIR = path.join(root, 'data', 'ai-answers');

const SQL = await initSqlJs({ locateFile: (f) => path.join(root, 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(fs.readFileSync(DB));
const all = (s, p = []) => { const st = db.prepare(s); st.bind(p || []); const o = []; while (st.step()) o.push(st.getAsObject()); st.free(); return o; };

const cols = all('PRAGMA table_info(passage)').map((c) => c.name);
if (!cols.includes('translation')) db.run('ALTER TABLE passage ADD COLUMN translation TEXT');

let nExam = 0, nTrans = 0, nAns = 0, nMiss = 0;
const files = fs.existsSync(AI_DIR) ? fs.readdirSync(AI_DIR).filter((f) => f.endsWith('.json')).sort() : [];
for (const f of files) {
  const ov = JSON.parse(fs.readFileSync(path.join(AI_DIR, f), 'utf8'));
  const ex = all('SELECT id FROM exam WHERE level=? AND year=? AND month=? AND set_no=?',
    [ov.level, ov.year, ov.month, ov.set_no])[0];
  if (!ex) { console.log(`  跳过 ${f}：库中找不到对应套题`); nMiss++; continue; }
  for (const op of ov.passages || []) {
    const p = all('SELECT id FROM passage WHERE exam_id=? AND section=? AND seq=?', [ex.id, op.section, op.seq])[0];
    if (!p) { console.log(`  跳过 ${f} ${op.section}#${op.seq}：库中无此篇章`); nMiss++; continue; }
    if (op.translation && op.translation.trim()) {
      const cur = all('SELECT translation FROM passage WHERE id=?', [p.id])[0];
      if (!cur || !cur.translation) nTrans++;
      if (!DRY) db.run('UPDATE passage SET translation=? WHERE id=?', [op.translation, p.id]);
    }
    const qs = all('SELECT id, stem FROM question WHERE passage_id=? ORDER BY id', [p.id]);
    (op.questions || []).forEach((oq, i) => {
      const q = qs[i];
      if (!q || !oq.answer) return;
      if (!DRY) db.run('UPDATE question SET answer=?, analysis=? WHERE id=?', [oq.answer, oq.analysis || '', q.id]);
      nAns++;
      // 题干文本与生成时不一致（例如解析器修好了题号）只提示，不影响按位置对齐
    });
    if ((op.questions || []).length !== qs.length) {
      console.log(`  ⚠ ${f} ${op.section}#${op.seq}：覆盖层 ${(op.questions || []).length} 题 ≠ 库中 ${qs.length} 题（按前 ${Math.min((op.questions || []).length, qs.length)} 题对齐）`);
    }
  }
  nExam++;
}
if (!DRY) fs.writeFileSync(DB, Buffer.from(db.export()));
console.log(`应用覆盖层：${nExam} 套 ｜ 新增翻译 ${nTrans} 篇 ｜ 写入答案 ${nAns} 题 ｜ 跳过 ${nMiss}${DRY ? '（dry-run，未写盘）' : ''}`);

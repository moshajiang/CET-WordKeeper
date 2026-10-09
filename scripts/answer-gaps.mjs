// 统计真题的「答案 / 解析 / 翻译」缺口，供批量生成前评估工作量
// 用法: node scripts/answer-gaps.mjs
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL = await initSqlJs({ locateFile: (f) => path.join(root, 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(fs.readFileSync(path.join(root, 'data', 'keeper.db')));

const one = (sql, p = []) => { const s = db.prepare(sql); s.bind(p); const ok = s.step(); const v = ok ? s.getAsObject() : null; s.free(); return v; };
const all = (sql, p = []) => { const s = db.prepare(sql); s.bind(p); const out = []; while (s.step()) out.push(s.getAsObject()); s.free(); return out; };

const cols = all('PRAGMA table_info(passage)').map((c) => c.name);
const hasTranslation = cols.includes('translation');
console.log('passage 列:', cols.join(', '));

const examCount = one('SELECT COUNT(*) n FROM exam').n;
const qTotal = one('SELECT COUNT(*) n FROM question').n;
const qNoAnswer = one("SELECT COUNT(*) n FROM question WHERE answer IS NULL OR TRIM(answer)=''").n;
const qNoAnalysis = one("SELECT COUNT(*) n FROM question WHERE analysis IS NULL OR TRIM(analysis)=''").n;
const pTotal = one('SELECT COUNT(*) n FROM passage').n;
const pNoTranslation = hasTranslation
  ? one("SELECT COUNT(*) n FROM passage WHERE translation IS NULL OR TRIM(translation)=''").n
  : pTotal;

console.log(`\n=== 总览 ===`);
console.log(`真题 ${examCount} 套 / 篇章 ${pTotal} / 题目 ${qTotal}`);
console.log(`缺答案的题: ${qNoAnswer}`);
console.log(`缺解析的题: ${qNoAnalysis}`);
console.log(`缺翻译的篇章: ${pNoTranslation}`);

console.log(`\n=== 按题型（缺答案）===`);
for (const r of all(`SELECT p.section, COUNT(*) total,
    SUM(CASE WHEN q.answer IS NULL OR TRIM(q.answer)='' THEN 1 ELSE 0 END) noans,
    SUM(CASE WHEN q.analysis IS NULL OR TRIM(q.analysis)='' THEN 1 ELSE 0 END) noanalysis
  FROM question q JOIN passage p ON p.id=q.passage_id GROUP BY p.section ORDER BY total DESC`)) {
  console.log(`  ${(r.section || '?').padEnd(12)} 共 ${String(r.total).padStart(4)}  缺答案 ${String(r.noans).padStart(4)}  缺解析 ${String(r.noanalysis).padStart(4)}`);
}

console.log(`\n=== 有答案/解析的套数 ===`);
const withAns = one(`SELECT COUNT(DISTINCT p.exam_id) n FROM question q JOIN passage p ON p.id=q.passage_id
  WHERE q.answer IS NOT NULL AND TRIM(q.answer)<>''`).n;
const withAna = one(`SELECT COUNT(DISTINCT p.exam_id) n FROM question q JOIN passage p ON p.id=q.passage_id
  WHERE q.analysis IS NOT NULL AND TRIM(q.analysis)<>''`).n;
const withTr = hasTranslation ? one(`SELECT COUNT(DISTINCT exam_id) n FROM passage
  WHERE translation IS NOT NULL AND TRIM(translation)<>''`).n : 0;
console.log(`  有答案: ${withAns}/${examCount}   有解析: ${withAna}/${examCount}   有翻译: ${withTr}/${examCount}`);

console.log(`\n=== 无答案题量最多的 8 套 ===`);
for (const r of all(`SELECT e.id, e.level, e.year, e.month, e.set_no,
    SUM(CASE WHEN q.answer IS NULL OR TRIM(q.answer)='' THEN 1 ELSE 0 END) noans,
    COUNT(q.id) total
  FROM exam e JOIN passage p ON p.exam_id=e.id JOIN question q ON q.passage_id=p.id
  GROUP BY e.id HAVING noans>0 ORDER BY noans DESC LIMIT 8`)) {
  console.log(`  #${r.id} ${r.level} ${r.year}.${r.month} 第${r.set_no}套  缺 ${r.noans}/${r.total}`);
}

console.log(`\n=== 无翻译篇章最多的 5 套 ===`);
if (hasTranslation) {
  for (const r of all(`SELECT e.id, e.level, e.year, e.month, e.set_no, COUNT(p.id) noch
    FROM exam e JOIN passage p ON p.exam_id=e.id
    WHERE p.translation IS NULL OR TRIM(p.translation)=''
    GROUP BY e.id ORDER BY noch DESC LIMIT 5`)) {
    console.log(`  #${r.id} ${r.level} ${r.year}.${r.month} 第${r.set_no}套  缺 ${r.noch} 篇`);
  }
}

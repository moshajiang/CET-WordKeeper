// 预置答案/解析/翻译的质检报告：覆盖率 + 结构校验 + 复核分歧清单
// 用法: node scripts/answer-audit.mjs [--min 99] [--list 25]
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const MIN = Number(opt('min', 99));
const LIST = Number(opt('list', 25));

const SQL = await initSqlJs({ locateFile: (f) => path.join(root, 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(fs.readFileSync(path.join(root, 'data', 'keeper.db')));
const one = (s, p = []) => { const st = db.prepare(s); st.bind(p || []); const ok = st.step(); const v = ok ? st.getAsObject() : null; st.free(); return v; };
const all = (s, p = []) => { const st = db.prepare(s); st.bind(p || []); const o = []; while (st.step()) o.push(st.getAsObject()); st.free(); return o; };

const OBJ = ['cloze', 'match', 'reading'];
const cols = new Set(all('PRAGMA table_info(passage)').map((c) => c.name));
let fail = 0;
const line = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fail++; };

console.log('===== 覆盖率 =====');
const qTotal = one(`SELECT COUNT(*) n FROM question q JOIN passage p ON p.id=q.passage_id
  WHERE p.section IN ('cloze','match','reading')`).n;
const qAns = one(`SELECT COUNT(*) n FROM question q JOIN passage p ON p.id=q.passage_id
  WHERE p.section IN ('cloze','match','reading') AND answer IS NOT NULL AND TRIM(answer)<>''`).n;
const qAna = one(`SELECT COUNT(*) n FROM question q JOIN passage p ON p.id=q.passage_id
  WHERE p.section IN ('cloze','match','reading') AND analysis IS NOT NULL AND LENGTH(TRIM(analysis))>10`).n;
const pTotal = one(`SELECT COUNT(*) n FROM passage WHERE section IN ('cloze','match','reading')`).n;
const pTr = one(`SELECT COUNT(*) n FROM passage WHERE section IN ('cloze','match','reading')
  AND translation IS NOT NULL AND LENGTH(TRIM(translation))>50`).n;
const pct = (a, b) => b ? (a / b * 100).toFixed(1) : '0.0';

line(Number(pct(qAns, qTotal)) >= MIN, `客观题答案覆盖 ${qAns}/${qTotal} = ${pct(qAns, qTotal)}%（门槛 ${MIN}%）`);
line(Number(pct(qAna, qTotal)) >= MIN, `客观题解析覆盖 ${qAna}/${qTotal} = ${pct(qAna, qTotal)}%）`);
line(Number(pct(pTr, pTotal)) >= MIN, `客观篇章翻译覆盖 ${pTr}/${pTotal} = ${pct(pTr, pTotal)}%）`);

// 主观题：写作范文 / 翻译参考译文
const hasRef = cols.has('reference');
const rTotal = hasRef ? one(`SELECT COUNT(*) n FROM passage WHERE section IN ('writing','translation')`).n : 0;
const rDone = hasRef ? one(`SELECT COUNT(*) n FROM passage WHERE section IN ('writing','translation')
  AND reference IS NOT NULL AND LENGTH(TRIM(reference))>50`).n : 0;
if (rTotal) line(Number(pct(rDone, rTotal)) >= MIN, `写作范文/翻译参考译文覆盖 ${rDone}/${rTotal} = ${pct(rDone, rTotal)}%）`);

console.log('\n===== 结构校验 =====');
const badLetter = all(`SELECT p.section, q.id, q.stem, q.answer FROM question q JOIN passage p ON p.id=q.passage_id
  WHERE p.section IN ('cloze','match','reading') AND q.answer IS NOT NULL AND TRIM(q.answer)<>''
    AND q.answer NOT GLOB '[A-Z]'`);
line(badLetter.length === 0, `答案均为单个大写字母（异常 ${badLetter.length} 条）`);

const readBad = all(`SELECT q.id, q.answer FROM question q JOIN passage p ON p.id=q.passage_id
  WHERE p.section='reading' AND TRIM(IFNULL(q.answer,''))<>'' AND q.answer NOT IN ('A','B','C','D')`);
line(readBad.length === 0, `阅读答案均落在 A–D（异常 ${readBad.length} 条）`);

// 选词填空：答案字母必须在该篇词库内，且 10 个空不应重复用同一字母
const clozeBad = [];
for (const p of all(`SELECT id, content FROM passage WHERE section='cloze'`)) {
  const qs = all(`SELECT id, answer, options FROM question WHERE passage_id=? ORDER BY id`, [p.id]);
  if (!qs.length) continue;
  const bank = new Set([...(qs[0].options || '').matchAll(/([A-Z])\)/g)].map((m) => m[1]));
  const letters = qs.map((q) => (q.answer || '').trim()).filter(Boolean);
  const outside = letters.filter((l) => !bank.has(l));
  const dup = letters.filter((l, i) => letters.indexOf(l) !== i);
  if (outside.length || (dup.length && letters.length === qs.length)) {
    clozeBad.push({ id: p.id, outside: outside.join(','), dup: [...new Set(dup)].join(','), n: qs.length });
  }
}
line(clozeBad.length === 0, `选词填空答案都在词库内且不重复（异常 ${clozeBad.length} 篇）`);
if (clozeBad.length) for (const x of clozeBad.slice(0, 8)) console.log(`    passage#${x.id} 越界[${x.outside}] 重复[${x.dup}] 共${x.n}空`);

// 段落匹配：答案字母应在该篇出现的段落字母范围内
const matchBad = [];
for (const p of all(`SELECT id, content FROM passage WHERE section='match'`)) {
  const letters = new Set([...String(p.content).matchAll(/(?:^|\n)([A-Z])[\)\.]/g)].map((m) => m[1]));
  if (!letters.size) continue;
  const qs = all(`SELECT id, answer FROM question WHERE passage_id=? ORDER BY id`, [p.id]);
  const bad = qs.filter((q) => (q.answer || '').trim() && !letters.has(q.answer.trim()));
  if (bad.length) matchBad.push({ id: p.id, bad: bad.map((b) => `${b.id}:${b.answer}`).join(','), paras: letters.size });
}
line(matchBad.length === 0, `段落匹配答案都在段落字母范围内（异常 ${matchBad.length} 篇）`);
if (matchBad.length) for (const x of matchBad.slice(0, 8)) console.log(`    passage#${x.id} 段落${x.paras}段 越界 ${x.bad}`);

const shortAna = one(`SELECT COUNT(*) n FROM question q JOIN passage p ON p.id=q.passage_id
  WHERE p.section IN ('cloze','match','reading') AND LENGTH(TRIM(IFNULL(q.analysis,'')))<=10`).n;
line(shortAna === 0, `不存在空/超短解析（异常 ${shortAna} 条）`);

console.log('\n===== 复核结果（人工抽查清单）=====');
const overlayDir = path.join(root, 'data', 'ai-answers');
let verified = 0, unverified = 0, dissents = [];
if (fs.existsSync(overlayDir)) {
  for (const f of fs.readdirSync(overlayDir).filter((x) => x.endsWith('.json'))) {
    const o = JSON.parse(fs.readFileSync(path.join(overlayDir, f), 'utf8'));
    for (const p of o.passages || []) {
      for (const q of p.questions || []) {
        if (!q.answer) continue;
        if (q.verified) verified++;
        else { unverified++; dissents.push({ key: f.replace('.json', ''), section: p.section, n: q.stem, answer: q.answer, dissent: q.dissent }); }
      }
    }
  }
}
const tot = verified + unverified;
console.log(`复核通过 ${verified} 题 ｜ 未通过/未复核 ${unverified} 题 ｜ 一致率 ${tot ? (verified / tot * 100).toFixed(1) : '-'}%`);
if (dissents.length) {
  console.log(`\n以下 ${Math.min(LIST, dissents.length)} 题两次作答不一致（已按第三方仲裁定稿，建议人工抽查）：`);
  for (const d of dissents.slice(0, LIST)) {
    console.log(`  [${d.key} ${d.section}] 定稿 ${d.answer}（另一候选 ${d.dissent || '-'}）  ${String(d.n).slice(0, 60)}`);
  }
}
line(dissents.length / Math.max(tot, 1) < 0.05, `复核不一致率 ${tot ? (dissents.length / tot * 100).toFixed(1) : '0'}% < 5%`);

console.log(`\n===== 结论：${fail === 0 ? '全部通过' : fail + ' 项未达标'} =====`);
process.exit(fail === 0 ? 0 : 1);

// 逐篇对齐质量审查脚本 v4（逐锚点、数值单位与复核证据）
// 审计对象：入库的 passage.rows（写死绑定结果）
// 锚点匹配：千分位逗号归一、万进制展开、中文数字转阿拉伯、Directions 行排除、本篇选词填空空号排除
// 评级（证据分级）：C = 字母错位 / 漂移≥2 / 覆盖<90% / 归一化后锚点命中<20%；B = 漂移1 / 命中<45%；A = 其余
// 输出：docs/align-audit-report.md
import fs from 'fs';
import {auditPairs} from './lib/alignment-audit.mjs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dependencyRoot = process.env.KEEPER_DEPENDENCY_ROOT || root;
const initSqlJs = (await import('file:///' + dependencyRoot.replace(/\\/g, '/') + '/node_modules/sql.js/dist/sql-wasm.js')).default;
const SQL = await initSqlJs({ locateFile: (f) => path.join(dependencyRoot, 'node_modules', 'sql.js', 'dist', f) });
function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw new Error(`${name} requires a path`);
  return path.resolve(process.argv[index + 1]);
}
const dbPath = argument('--db', path.join(root, 'data', 'keeper.db'));
const reportPath = argument('--out', path.join(root, 'docs', 'align-audit-report.md'));
const jsonPath = argument('--json', null);
const db = new SQL.Database(fs.readFileSync(dbPath));
const rows = db.exec(`SELECT e.level, e.year, e.month, e.set_no, p.section, p.seq, p.translation, p.rows,
  (SELECT GROUP_CONCAT(CAST(REPLACE(REPLACE(q.stem,'.',''),'.','') AS INTEGER)) FROM question q WHERE q.passage_id = p.id AND q.qtype = 'cloze') AS clozeStems
  , p.id FROM passage p JOIN exam e ON e.id = p.exam_id WHERE p.translation != ''`)[0].values;

const zhChars = (s) => (String(s).match(/[\u4e00-\u9fff]/g) || []).length;
const enWords = (s) => (String(s).match(/[A-Za-z']+/g) || []).length;

let A = [], B = [], C = [];
for (const [level, year, month, set, section, seq, translation, rowsRaw, clozeStems, passageId] of rows) {
  const parts = section.split(' ');
  const sec = parts[0];
  const seqN = Number(parts[1] || seq || 1);
  const tag = `${level} ${year}.${month} set${set} ${sec}${seqN > 1 ? ' ' + seqN : ''}`;
  if (!rowsRaw) { C.push({ tag, why: 'rows 缺失' }); continue; }
  const pairs = JSON.parse(rowsRaw);
  const exclude = new Set(String(clozeStems || '').split(',').map(Number).filter((x) => !isNaN(x)));
  const {anT,anHit,anDrift,anLost,anAmbiguous,anUnitMismatch,rate,missSamples,details} = auditPairs(pairs,{exclude});
  let letterBad = 0;
  if (sec === 'match') {
    for (const r of pairs) {
      const em = String(r.en).match(/\b([A-O])\s*[)．.]/) || String(r.en).match(/^\[([A-O])\]/);
      const zm = String(r.zh).match(/\[([A-O])\]/) || String(r.zh).match(/(?:^|\s)([A-O])\s*[)．.、]/);
      if (em && zm && em[1] !== zm[1]) letterBad++;
    }
  }
  const zhTotal = zhChars(translation);
  const zhRows = pairs.reduce((a, r) => a + zhChars(r.zh), 0);
  const cover = zhTotal ? zhRows / zhTotal : 1;
  let grade = 'A', why = [];
  if (anUnitMismatch) { grade=anUnitMismatch>=2?'C':'B';why.push('原文/译文同值单位差异 '+anUnitMismatch+' 处'); }
  if (letterBad > 0) { grade = 'C'; why.push(`字母错位 ${letterBad}`); }
  if (anDrift >= 2) { grade = 'C'; why.push(`漂移 ${anDrift} 次`); }
  else if (anDrift === 1) { if (grade === 'A') grade = 'B'; why.push('漂移 1 次'); }
  if (cover < 0.9) { grade = 'C'; why.push(`译文覆盖 ${Math.round(cover * 100)}%`); }
  else if (cover < 0.97) { if (grade === 'A') grade = 'B'; why.push(`译文覆盖 ${Math.round(cover * 100)}%`); }
  if (anT >= 4 && rate !== null && rate < 0.2) { grade = 'C'; why.push(`锚点命中 ${Math.round(rate * 100)}%（归一化后）`); }
  else if (anT >= 3 && rate !== null && rate < 0.45) { if (grade === 'A') grade = 'B'; why.push(`锚点命中 ${Math.round(rate * 100)}%`); }
  const rec = { passageId, tag, grade, why: why.join(' / ') || (rate === null ? '无锚点' : `命中 ${Math.round(rate * 100)}%`), rate, anT, anHit, anDrift, anLost, anAmbiguous, anUnitMismatch, details, cover: Math.round(cover * 100), missSamples, section: sec };
  (grade === 'A' ? A : grade === 'B' ? B : C).push(rec);
}

const byGrade = { A, B, C };
const md = [];
md.push('# 逐篇对齐质量审查报告（v0.3.1，逐锚点口径）');
md.push('');
md.push(`- 审计对象：入库的 passage.rows（写死绑定结果），${A.length + B.length + C.length} 篇带译文篇章`);
md.push(`- 风险分级：**A（可信）${A.length} 篇 · B（待观察）${B.length} 篇 · C（需复核）${C.length} 篇**`);
md.push('- 锚点按数值与单位完整匹配：千分位、万/亿与 million/billion、百分比、世纪/年代表达归一化；Directions 与本篇裸空号不计。命中数与分母均为逐个锚点计数');
md.push('- 评级为证据分级：字母错位/漂移≥2/覆盖<90%/归一化后命中<20%/同值单位差异≥2 → C；漂移1/命中<45%/覆盖<97% → B；其余 → A');
md.push('');
md.push('## C 级（建议人工复核）');
if (!C.length) md.push('（无）');
for (const r of C) {
  md.push(`- **${r.tag}** — ${r.why}`);
  for (const m of r.missSamples || []) {
    md.push(`  - #${m.k} 锚点[${m.ds}]｜EN: ${m.en}…`);
    md.push(`    ZH: ${m.zh}…`);
  }
}
md.push('');
md.push('## B 级（待观察）');
if (!B.length) md.push('（无）');
for (const r of B) md.push(`- ${r.tag} — ${r.why}`);
md.push('');
md.push('## A 级明细');
md.push('');
md.push('| 篇章 | 锚点命中 | 备注 |');
md.push('|---|---|---|');
for (const r of A) md.push(`| ${r.tag} | ${r.rate === null ? '无锚点' : Math.round(r.rate * 100) + '%'} | ${r.why} |`);
md.push('');
md.push('## 判定方法说明');
md.push('');
md.push('- 锚点：原文句中的年份/百分比/金额等数字（译文中通常原样保留）；命中率按锚点逐个统计');
md.push('- 邻行候选：未命中锚点仅在 ±3 行内某一行出现才计提示，多处出现单独列为歧义；提示须人工复核，不是语义结论。覆盖率：各行中文字数合计 / 译文总字数');
md.push('- 仅排除本篇题号的裸数字，35 percent 等明确百分比仍计入；Directions 行不计入锚点');
fs.writeFileSync(reportPath, md.join('\n') + '\n', 'utf8');
if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify({ database: dbPath, counts: { A: A.length, B: B.length, C: C.length }, passages: [...A, ...B, ...C] }, null, 2));
console.log(`审计完成：A ${A.length} / B ${B.length} / C ${C.length}（共 ${A.length + B.length + C.length} 篇）`);
console.log('报告:', reportPath);
console.log('\nC 级篇章:');
C.forEach((r) => console.log('  ✗', r.tag, '—', r.why));
console.log('\nB 级篇章:');
B.forEach((r) => console.log('  ◆', r.tag, '—', r.why));

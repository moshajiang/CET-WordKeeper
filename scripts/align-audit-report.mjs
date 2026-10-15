// 逐篇对齐质量审查脚本 v3（最终口径）
// 审计对象：入库的 passage.rows（写死绑定结果）
// 锚点匹配：千分位逗号归一、万进制展开、中文数字转阿拉伯、Directions 行排除、本篇选词填空空号排除
// 评级（证据分级）：C = 字母错位 / 漂移≥2 / 覆盖<90% / 归一化后锚点命中<20%；B = 漂移1 / 命中<45%；A = 其余
// 输出：docs/align-audit-report.md
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const initSqlJs = (await import('file:///' + root.replace(/\\/g, '/') + '/node_modules/sql.js/dist/sql-wasm.js')).default;
const SQL = await initSqlJs({ locateFile: (f) => path.join(root, 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(fs.readFileSync(path.join(root, 'data', 'keeper.db')));
const rows = db.exec(`SELECT e.level, e.year, e.month, e.set_no, p.section, p.seq, p.translation, p.rows,
  (SELECT GROUP_CONCAT(CAST(REPLACE(REPLACE(q.stem,'.',''),'.','') AS INTEGER)) FROM question q WHERE q.passage_id = p.id AND q.qtype = 'cloze') AS clozeStems
  FROM passage p JOIN exam e ON e.id = p.exam_id WHERE p.translation != ''`)[0].values;

const DIG = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cjkToNum(s) {
  if (/^\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);
  let total = 0, section = 0, num = 0, any = false;
  for (const ch of s) {
    if (DIG[ch] !== undefined) { num = DIG[ch]; any = true; }
    else if (ch === '十') { section += (num || 1) * 10; num = 0; any = true; }
    else if (ch === '百') { section += (num || 1) * 100; num = 0; any = true; }
    else if (ch === '千') { section += (num || 1) * 1000; num = 0; any = true; }
    else return null;
  }
  if (!any) return null;
  return total + section + num;
}
function normZh(text) {
  let out = String(text);
  out = out.replace(/(\d+(?:\.\d+)?)\s*万/g, (m, n) => String(parseFloat(n) * 10000));
  out = out.replace(/百分之\s*([零一二两三四五六七八九十百]+|\d+(?:\.\d+)?)/g, (m, num) => { const v = cjkToNum(num); return v === null ? m : v + '%'; });
  out = out.replace(/[零一二两三四五六七八九十百千]{2,}/g, (m) => { const v = cjkToNum(m); return v === null ? m : String(v); });
  return out;
}
const normEn = (s) => String(s).replace(/(\d),(?=\d{3}\b)/g, '$1');
const isDirections = (s) => /Questions?\s+\d+\s+(?:and\s+\d+\s+|to\s+)?(?:are|is)\s+based/.test(s) || /^Directions?\b/.test(s);
const zhChars = (s) => (String(s).match(/[\u4e00-\u9fff]/g) || []).length;
const enWords = (s) => (String(s).match(/[A-Za-z']+/g) || []).length;

let A = [], B = [], C = [];
for (const [level, year, month, set, section, seq, translation, rowsRaw, clozeStems] of rows) {
  const parts = section.split(' ');
  const sec = parts[0];
  const seqN = Number(parts[1] || 1);
  const tag = `${level} ${year}.${month} set${set} ${sec}${seqN > 1 ? ' ' + seqN : ''}`;
  if (!rowsRaw) { C.push({ tag, why: 'rows 缺失' }); continue; }
  const pairs = JSON.parse(rowsRaw);
  const exclude = new Set(String(clozeStems || '').split(',').map(Number).filter((x) => !isNaN(x)));
  function anchorsOf(text) {
    return [...new Set((normEn(text).match(/\d+(?:[,.]\d+)*/g) || [])
      .filter((d) => { const n = parseInt(d.replace(/\D/g, ''), 10); return !exclude.has(n) && !(n >= 26 && n <= 35) && (String(n).length >= 2 || d.length >= 3); }))];
  }
  let anT = 0, anHit = 0, anDrift = 0, anLost = 0;
  const missSamples = [];
  const zhAll = pairs.map((x) => normZh(String(x.zh || '')));
  for (const [k, r] of pairs.entries()) {
    if (isDirections(r.en)) continue;
    const ds = anchorsOf(r.en);
    if (!ds.length) continue;
    anT += ds.length;
    const zhN = normZh(String(r.zh || ''));
    if (ds.every((d) => zhN.includes(d))) { anHit++; continue; }
    let found = null;
    for (let off = -3; off <= 3; off++) {
      if (!off) continue;
      const i = k + off;
      if (i < 0 || i >= pairs.length) continue;
      if (ds.every((d) => zhAll[i].includes(d))) { found = off; break; }
    }
    if (found !== null) anDrift++;
    else {
      anLost++;
      if (missSamples.length < 3) missSamples.push({ k: k + 1, en: String(r.en).slice(0, 70), zh: String(r.zh).slice(0, 62), ds: ds.join(',') });
    }
  }
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
  const rate = anT ? anHit / anT : null;
  let grade = 'A', why = [];
  if (letterBad > 0) { grade = 'C'; why.push(`字母错位 ${letterBad}`); }
  if (anDrift >= 2) { grade = 'C'; why.push(`漂移 ${anDrift} 次`); }
  else if (anDrift === 1) { if (grade === 'A') grade = 'B'; why.push('漂移 1 次'); }
  if (cover < 0.9) { grade = 'C'; why.push(`译文覆盖 ${Math.round(cover * 100)}%`); }
  else if (cover < 0.97) { if (grade === 'A') grade = 'B'; why.push(`译文覆盖 ${Math.round(cover * 100)}%`); }
  if (anT >= 4 && rate !== null && rate < 0.2) { grade = 'C'; why.push(`锚点命中 ${Math.round(rate * 100)}%（归一化后）`); }
  else if (anT >= 3 && rate !== null && rate < 0.45) { if (grade === 'A') grade = 'B'; why.push(`锚点命中 ${Math.round(rate * 100)}%`); }
  const rec = { tag, grade, why: why.join(' / ') || (rate === null ? '无锚点' : `命中 ${Math.round(rate * 100)}%`), rate, anT, anHit, anDrift, anLost, cover: Math.round(cover * 100), missSamples, section: sec };
  (grade === 'A' ? A : grade === 'B' ? B : C).push(rec);
}

const byGrade = { A, B, C };
const md = [];
md.push('# 逐篇对齐质量审查报告（v0.3.1，最终口径）');
md.push('');
md.push(`- 审计对象：入库的 passage.rows（写死绑定结果），${A.length + B.length + C.length} 篇带译文篇章`);
md.push(`- 风险分级：**A（可信）${A.length} 篇 · B（待观察）${B.length} 篇 · C（真可疑）${C.length} 篇**`);
md.push('- 锚点匹配已归一化：千分位逗号（1,000=1000）、万进制（4.4万=44000）、中文数字（二十世纪=20世纪、百分之六十二=62%）；Directions 行与选词填空空号不计');
md.push('- 评级为证据分级：字母错位/漂移≥2/覆盖<90%/归一化后命中<20% → C；漂移1/命中<45%/覆盖<97% → B；其余 → A');
md.push('');
md.push('## C 级（真可疑，建议人工复核）');
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
md.push('- 漂移：锚点出现在相邻 ±3 行（对应错位的直接证据）；覆盖率：各行中文字数合计 / 译文总字数');
md.push('- 选词填空空号（26–35 或本篇题号）与 Directions 行不计入锚点');
fs.writeFileSync(path.join(root, 'docs', 'align-audit-report.md'), md.join('\n') + '\n', 'utf8');
console.log(`审计完成：A ${A.length} / B ${B.length} / C ${C.length}（共 ${A.length + B.length + C.length} 篇）`);
console.log('报告: docs/align-audit-report.md');
console.log('\nC 级篇章:');
C.forEach((r) => console.log('  ✗', r.tag, '—', r.why));
console.log('\nB 级篇章:');
B.forEach((r) => console.log('  ◆', r.tag, '—', r.why));

// 对照背诵/逐句对照的对齐质量审计（全库 311 篇）：
// ① 长篇阅读段落级对齐：EN 行首字母必须与 ZH 行内字母一致（错位即失败，exit 1）
// ② 句子级配对：每行「中文字数/英文词数」比例偏离该篇中位数过大的行仅提示（信息性）
// 用法：node scripts/align-quality.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const initSqlJs = (await import('file:///' + root.replace(/\\/g, '/') + '/node_modules/sql.js/dist/sql-wasm.js')).default;
const SQL = await initSqlJs({ locateFile: (f) => path.join(root, 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(fs.readFileSync(path.join(root, 'data', 'keeper.db')));
const { alignBilingual } = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(fs.readFileSync(path.join(root, 'src', 'utils', 'bilingual.js'), 'utf8')));

const rows = db.exec(`SELECT e.level, e.year, e.month, e.set_no, p.section, p.seq, p.content, p.translation
  FROM passage p JOIN exam e ON e.id = p.exam_id WHERE p.translation != ''`)[0].values;

const enWords = (s) => (String(s).match(/[A-Za-z']+/g) || []).length;
const zhChars = (s) => (String(s).match(/[\u4e00-\u9fff]/g) || []).length;

let total = 0, matchOk = 0, letterBad = [], suspect = [];
for (const [level, year, month, set, section, seq, content, translation] of rows) {
  total++;
  const tag = `${level} ${year}.${month} set${set} ${section}${seq > 1 ? ' ' + seq : ''}`;
  const pairs = alignBilingual(content, translation);
  let bad = [];

  // ① 长篇阅读：段落级对齐的字母必须一一对应
  if (section === 'match') {
    for (const [k, r] of pairs.entries()) {
      const em = String(r.en).match(/\b([A-O])\s*[)．.]\s/);
      const zm = String(r.zh).match(/\[([A-O])\]/) || String(r.zh).match(/(?:^|\s)([A-O])\s*[)．.、]/);
      if (em && zm && em[1] !== zm[1]) bad.push(`#${k + 1} 英${em[1]}/中${zm[1]}`);
    }
    if (bad.length) letterBad.push({ tag, bad });
    else matchOk++;
  }

  // ② 句子级比例检查（信息性）
  const ratios = pairs.map((r) => zhChars(r.zh) / Math.max(1, enWords(r.en)));
  const sorted = [...ratios].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  pairs.forEach((r, i) => {
    const dev = ratios[i] / median;
    if (dev > 3 || dev < 0.3) bad.push(`#${i + 1} (${dev.toFixed(2)}x)`);
  });
  if (bad.length) suspect.push({ tag, count: bad.length });
}

console.log('篇章总数:', total);
console.log('长篇阅读：字母对应全部正确', matchOk, '篇 / 存在字母错位', letterBad.length, '篇');
letterBad.slice(0, 8).forEach((x) => console.log('  ✗', x.tag, ':', x.bad.join(' , ')));
console.log('句子级存在比例异常行的篇章:', suspect.length, '篇（比例异常 = 译文颗粒度与原文不同，非错位）');
suspect.sort((a, b) => b.count - a.count);
suspect.slice(0, 8).forEach((x) => console.log('  ◆', x.tag, `(${x.count} 行)`));
if (letterBad.length) {
  console.error('\n存在字母错位（段落级对齐失效），判为失败');
  process.exit(1);
}
console.log('\n段落级对齐全部通过。');

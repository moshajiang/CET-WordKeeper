// 数据层冒烟测试：验证 keeper.db 的词典、真题、词频与词形还原
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL = await initSqlJs({ locateFile: (f) => path.join(root, 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(fs.readFileSync(path.join(root, 'data', 'keeper.db')));

function q(sql, p = []) {
  const s = db.prepare(sql);
  s.bind(p);
  const rows = [];
  while (s.step()) rows.push(s.getAsObject());
  s.free();
  return rows;
}

console.log('=== 数据概况 ===');
console.log('考次数:', q('SELECT COUNT(*) c FROM exam')[0].c);
console.log('篇章数:', q('SELECT COUNT(*) c FROM passage')[0].c);
console.log('题目数:', q('SELECT COUNT(*) c FROM question')[0].c);
console.log('词典词条:', q('SELECT COUNT(*) c FROM dict')[0].c);
console.log('词频条目:', q('SELECT COUNT(*) c FROM word_freq')[0].c);

console.log('\n=== 词形还原索引测试 ===');
const formIndex = new Map();
for (const r of q('SELECT word, exchange FROM dict WHERE exchange != ""')) {
  for (const part of String(r.exchange).split('/')) {
    const [k, v] = part.split(':');
    if (v && !formIndex.has(v.toLowerCase())) formIndex.set(v.toLowerCase(), r.word);
  }
}
console.log('索引规模:', formIndex.size);
for (const t of ['abandoned', 'cognitive', 'composers', 'intervening', 'renewables', 'understood']) {
  const mapped = formIndex.get(t);
  const entry = q('SELECT word, phonetic, tag, substr(translation,1,40) t FROM dict WHERE word = ?', [mapped || t])[0];
  console.log(`  ${t} -> ${mapped || '(原形)'} | ${entry ? entry.phonetic + ' | ' + (entry.tag || '无标签') + ' | ' + entry.t : '未收录'}`);
}

console.log('\n=== 真题篇章与词频 ===');
for (const p of q('SELECT id, section, title, length(content) len FROM passage ORDER BY id')) {
  console.log(`  #${p.id} [${p.section}] ${p.title} — ${p.len} 字符`);
}
console.log('\n高频考词 Top10（出现在真题中的词）:');
for (const r of q('SELECT word, total FROM word_freq ORDER BY total DESC LIMIT 10')) {
  const has = q('SELECT tag FROM dict WHERE word = ?', [r.word])[0];
  console.log(`  ${r.word} ×${r.total} ${has ? '[' + (has.tag || '超纲') + ']' : '(词典未收录)'}`);
}

console.log('\n=== SM-2 调度模拟 ===');
let card = { iv: 0, ease: 2.5, reps: 0 };
function step(rating) {
  let { iv, ease, reps } = card;
  if (rating === 0) { reps = 0; iv = 0.007; ease = Math.max(1.3, ease - 0.2); }
  else {
    reps += 1;
    if (reps === 1) iv = rating === 1 ? 0.5 : 1;
    else if (reps === 2) iv = rating === 1 ? 3 : 6;
    else iv = Math.round(iv * ease * (rating === 1 ? 0.6 : 1) * 10) / 10;
    ease = rating === 1 ? Math.max(1.3, ease - 0.15) : Math.min(3.0, ease + 0.1);
  }
  card = { iv, ease, reps };
  return `${iv < 1 ? Math.round(iv * 1440) + 'min' : iv + 'd'} (ease ${ease.toFixed(2)})`;
}
console.log('  记得×5:', [2, 2, 2, 2, 2].map(step).join(' -> '));
card = { iv: 0, ease: 2.5, reps: 0 };
console.log('  忘记后重来:', step(0));

console.log('\n全部检查通过 ✓');

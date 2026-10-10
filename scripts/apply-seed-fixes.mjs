// seed 数据修复工具：应用 data/seed/_fixes/*.json 的修复（词库/空选项）。
// 背景：reparse 会从源文件重新生成 seed，人工修复会丢失——所以修复数据单独存档，
// 重解析后必须重跑本脚本。用法：node scripts/apply-seed-fixes.mjs [--dry]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXES = path.join(root, 'data', 'seed', '_fixes');
const SEED = path.join(root, 'data', 'seed');
const DRY = process.argv.includes('--dry');

const files = fs.readdirSync(FIXES).filter((f) => f.endsWith('.json')).sort();
let applied = 0;

for (const f of files) {
  const fix = JSON.parse(fs.readFileSync(path.join(FIXES, f), 'utf8'));
  const key = fix.key;
  const seedPath = path.join(SEED, key + '.json');
  if (!fs.existsSync(seedPath)) { console.error('✗ 缺 seed:', key); process.exit(1); }
  const s = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  let changed = false;

  // 词库修复：bank 恰好 15 词 → cloze 每题 options 重写为 A)-O)；并剔除 content 里的词库残留行
  if (fix.bank) {
    if (fix.bank.length !== 15) { console.error(`✗ ${key}: bank 词数 ${fix.bank.length} ≠ 15`); process.exit(1); }
    const cz = s.passages.find((p) => p.section === 'cloze');
    if (!cz) { console.error(`✗ ${key}: 无 cloze 篇章`); process.exit(1); }
    const letters = 'ABCDEFGHIJKLMNO';
    const bankOptions = fix.bank.map((w, i) => `${letters[i]}) ${w}`);
    for (const q of cz.questions) {
      if (JSON.stringify(q.options) !== JSON.stringify(bankOptions)) { q.options = bankOptions.slice(); changed = true; }
    }
    for (const line of fix.contentRemoveLines || []) {
      if (cz.content.includes(line)) { cz.content = cz.content.replace(line, ''); changed = true; }
    }
    cz.content = cz.content.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  }

  // 空选项修复：按题号定位，重写 4 个选项
  for (const fx of fix.fixes || []) {
    const p = s.passages.find((x) => x.section === fx.section && x.seq === fx.seq);
    if (!p) { console.error(`✗ ${key}: 无篇章 ${fx.section}#${fx.seq}`); process.exit(1); }
    const q = (fx.pos != null ? p.questions[fx.pos] : null) || p.questions.find((x) => String(x.stem).startsWith(fx.qnum + '.'));
    if (!q) { console.error(`✗ ${key}: 无第 ${fx.qnum} 题`); process.exit(1); }
    if (JSON.stringify(q.options) !== JSON.stringify(fx.options)) { q.options = fx.options.slice(); changed = true; }
  }

  if (changed && !DRY) fs.writeFileSync(seedPath, JSON.stringify(s, null, 2), 'utf8');
  console.log(`${DRY ? '[dry] ' : ''}${changed ? '✓ 已修复' : '· 无需变更'} ${key} (${f})`);
  if (changed) applied++;
}
console.log(DRY ? `[dry] 将修复 ${applied} 个 seed` : `完成：修复 ${applied} 个 seed`);

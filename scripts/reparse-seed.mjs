// 解析器改动后，用「seed 里记录的原始来源」离线重跑解析。
// 不下载、不靠命名猜套号 —— 每条记录都从它原本的来源文件重跑，因此不会出现
// 多套撞名互相覆盖（fetch-pdf-exams.mjs 里踩过的坑）。
//
// 用法:
//   node scripts/reparse-seed.mjs                 # 全部
//   node scripts/reparse-seed.mjs cet4-2014 cet6-2023   # 只跑文件名以这些前缀开头的
//
// 只写 data/seed/*.json，绝不碰 data/keeper.db。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedDir = path.join(root, 'data', 'seed');
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const countQs = (o) => (o.passages || []).reduce((a, p) => a + (p.questions || []).length, 0);

let ok = 0, same = 0, fail = 0, skip = 0;
const changes = [];

for (const f of fs.readdirSync(seedDir).filter((x) => x.endsWith('.json')).sort()) {
  if (only.length && !only.some((k) => f.startsWith(k))) continue;
  const outPath = path.join(seedDir, f);
  let before;
  try { before = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch { skip++; console.log('  ✗ 无法读取', f); continue; }
  const src = before.source || '';
  const args = [before.level, String(before.year), String(before.month), String(before.set_no)];

  let r = null, script = null, srcPath = null;
  if (/\.docx$/i.test(src)) {
    script = 'parse-docx.mjs';
    srcPath = path.join(root, 'data', 'raw', 'exams', src);
  } else if (/\.pdf$/i.test(src)) {
    script = 'parse-pdf.mjs';
    srcPath = path.join(root, 'data', 'raw', 'pdf', src.replace(/\s+/g, '_').replace(/\.pdf$/i, '.txt'));
  }
  if (!script) { skip++; console.log('  – 跳过（来源非 docx/pdf）:', f, src || '(空)'); continue; }
  if (!fs.existsSync(srcPath)) { skip++; console.log('  – 跳过（缺源文件）:', f, path.basename(srcPath)); continue; }

  r = spawnSync(process.execPath,
    [path.join(root, 'scripts', script), srcPath, ...args, ...(script === 'parse-pdf.mjs' ? [src] : [])],
    { cwd: root, encoding: 'utf8' });

  if (r.status !== 0) {
    fail++;
    console.log(`  ✗ ${f}  ${(r.stderr || r.stdout || '').trim().split('\n').slice(-1)[0].slice(0, 80)}`);
    continue;
  }
  const after = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const bq = countQs(before), aq = countQs(after);
  if (bq === aq) { same++; }
  else { ok++; changes.push({ f, bq, aq }); console.log(`  ✓ ${f}  题数 ${bq} → ${aq}  (${aq - bq > 0 ? '+' : ''}${aq - bq})`); }
}

console.log(`\n重跑完成：有变化 ${ok} ｜ 无变化 ${same} ｜ 失败 ${fail} ｜ 跳过 ${skip}`);
if (changes.length) {
  console.log('变化明细：');
  for (const c of changes) console.log(`  ${c.f}  ${c.bq} → ${c.aq}`);
}

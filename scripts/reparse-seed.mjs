// 解析器改动后，用「seed 里记录的原始来源」离线重跑解析。
// 不下载、不靠命名猜套号 —— 每条记录都从它原本的来源文件重跑，因此不会出现
// 多套撞名互相覆盖（fetch-pdf-exams.mjs 里踩过的坑）。
//
// 用法:
//   node scripts/reparse-seed.mjs                 # 全部重跑并报告差异
//   node scripts/reparse-seed.mjs cet4-2014 cet6-2023   # 只跑文件名以这些前缀开头的
//   node scripts/reparse-seed.mjs --check         # 只比对不落盘；有实质差异时退出码 1
//
// 差异分两级报告：
//   · 结构级 —— 题数变化（旧版只比这个，会漏掉「题数不变但文本变」）
//   · 字段级 —— 文本变化，再分「纯空白差异」（healGlued / 排版所致，通常无害）
//              与「实质差异」（必须人工确认，--check 下退出码 1）
//
// 只写 data/seed/*.json（--check 除外），绝不碰 data/keeper.db。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedDir = path.join(root, 'data', 'seed');
const CHECK = process.argv.includes('--check');
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const countQs = (o) => (o.passages || []).reduce((a, p) => a + (p.questions || []).length, 0);

// ---- 字段级 diff ----
const noWs = (s) => String(s).replace(/\s+/g, '');
function diffFields(a, b, p, out) {
  if (typeof a === 'string' && typeof b === 'string') {
    if (a !== b) out.push({ p, kind: noWs(a) === noWs(b) ? 'ws' : 'sub', a, b });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push({ p: p + '.length', kind: 'struct', a: a.length, b: b.length });
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) diffFields(a[i], b[i], `${p}[${i}]`, out);
    return;
  }
  if (a && b && typeof a === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffFields(a[k], b[k], `${p}.${k}`, out);
    return;
  }
  if (a !== b) out.push({ p, kind: 'sub', a, b });
}

let ok = 0, same = 0, fail = 0, skip = 0;
const changes = [];
let substantiveFiles = 0;

for (const f of fs.readdirSync(seedDir).filter((x) => x.endsWith('.json')).sort()) {
  if (only.length && !only.some((k) => f.startsWith(k))) continue;
  const outPath = path.join(seedDir, f);
  let before;
  try { before = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch { skip++; console.log('  ✗ 无法读取', f); continue; }
  const beforeText = fs.readFileSync(outPath, 'utf8');
  const src = before.source || '';
  const args = [before.level, String(before.year), String(before.month), String(before.set_no)];

  let script = null, srcPath = null;
  if (/\.docx$/i.test(src)) {
    script = 'parse-docx.mjs';
    srcPath = path.join(root, 'data', 'raw', 'exams', src);
  } else if (/\.pdf$/i.test(src)) {
    script = 'parse-pdf.mjs';
    srcPath = path.join(root, 'data', 'raw', 'pdf', src.replace(/\s+/g, '_').replace(/\.pdf$/i, '.txt'));
  }
  if (!script) { skip++; console.log('  – 跳过（来源非 docx/pdf）:', f, src || '(空)'); continue; }
  if (!fs.existsSync(srcPath)) { skip++; console.log('  – 跳过（缺源文件）:', f, path.basename(srcPath)); continue; }

  const r = spawnSync(process.execPath,
    [path.join(root, 'scripts', script), srcPath, ...args, ...(script === 'parse-pdf.mjs' ? [src] : [])],
    { cwd: root, encoding: 'utf8' });

  if (r.status !== 0) {
    fail++;
    console.log(`  ✗ ${f}  ${(r.stderr || r.stdout || '').trim().split('\n').slice(-1)[0].slice(0, 80)}`);
    continue;
  }

  // --check 模式下还原原文件，不落盘
  if (CHECK) fs.writeFileSync(outPath, beforeText, 'utf8');
  const after = JSON.parse(fs.readFileSync(outPath, 'utf8'));

  const bq = countQs(before), aq = countQs(after);
  const diffs = [];
  diffFields(before, after, '', diffs);
  const sub = diffs.filter((d) => d.kind === 'sub');
  const ws = diffs.filter((d) => d.kind === 'ws').length;
  const st = diffs.filter((d) => d.kind === 'struct').length;

  if (bq !== aq || sub.length || st) {
    ok++;
    changes.push({ f, bq, aq });
    const tag = bq !== aq ? `题数 ${bq} → ${aq}` : '题数不变';
    console.log(`  △ ${f}  ${tag} ｜ 实质 ${sub.length} ｜ 纯空白 ${ws} ｜ 结构 ${st}`);
    if (sub.length) substantiveFiles++;
    for (const d of sub.slice(0, 3)) {
      console.log(`      ${d.p}`);
      console.log(`        新: ${JSON.stringify(String(d.a).slice(0, 90))}`);
      console.log(`        旧: ${JSON.stringify(String(d.b).slice(0, 90))}`);
    }
  } else {
    same++;
    if (ws) console.log(`  ✓ ${f}  题数与文本一致（仅空白差异 ${ws} 处）`);
  }
}

console.log(`\n重跑完成：有变化 ${ok} ｜ 无变化 ${same} ｜ 失败 ${fail} ｜ 跳过 ${skip}`);
if (changes.length) {
  console.log('变化明细：');
  for (const c of changes) console.log(`  ${c.f}  ${c.bq} → ${c.aq}`);
}
if (CHECK && substantiveFiles) {
  console.error(`\n✗ ${substantiveFiles} 个文件存在实质（非空白）差异，请人工确认后再落盘。`);
  process.exit(1);
}

// 批量抓取「只有 PDF」的近年真题并解析为结构化 JSON
// 用法: node scripts/fetch-pdf-exams.mjs [起始年份，默认 2022]
//
// 背景：源仓库 2020 年起的四级真题只有 PDF。这些 PDF 质量参差——
//   有的带完整文本层（可直接提文本），有的是纯扫描件（提取出来只有十几个字符）。
// 因此这里不做「按命名猜」的假设，而是逐个尝试：提取文本 → 解析 → 由质量门禁判定，
// 失败即自动换下一个同名候选（同一考次常有多种命名的 PDF）。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, execFileSync, spawnSync } from 'child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pdfDir = path.join(root, 'data', 'raw', 'pdf');
fs.mkdirSync(pdfDir, { recursive: true });
const repoDir = path.join(root, 'data', 'raw', 'repo');
const fromYear = Number(process.argv.find((a) => /^\d{4}$/.test(a))) || 2022;
// --force: 即使已解析过也重跑（改了 parse-pdf.mjs 后需要）
const force = process.argv.includes('--force');
const PY = process.env.PDF_PYTHON || 'C:/Users/35695/.workbuddy/binaries/python/envs/default/Scripts/python.exe';

if (!fs.existsSync(path.join(repoDir, '.git'))) {
  console.error('未找到本地仓库 data/raw/repo，请先执行 fetch-exams.mjs 里说明的 clone 命令');
  process.exit(1);
}
const tree = execSync('git -c core.quotepath=false -C "' + repoDir + '" ls-tree -r --name-only HEAD', {
  encoding: 'utf8', maxBuffer: 100 * 1024 * 1024,
}).split('\n').map((s) => s.trim()).filter(Boolean);

const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 };
const toNum = (s) => (/^\d+$/.test(s) ? Number(s) : CN[s] || 1);

function extractSetNo(name) {
  const cands = [];
  let m;
  if ((m = name.match(/第\s*([0-9一二三四五]+)\s*[套卷]/))) cands.push(m[1]);
  if ((m = name.match(/([0-9一二三四五]+)\s*套/))) cands.push(m[1]);
  if ((m = name.match(/[（(]\s*([一二三四五])\s*[)）]/))) cands.push(m[1]);
  if ((m = name.match(/_(\d)(?:-\d)?\.pdf$/))) cands.push(m[1]);
  for (const c of cands) { const v = toNum(c); if (v >= 1 && v <= 9) return v; }
  return 1;
}

// 从路径里取出 四级真题/YYYY.MM/真题PDF/xxx.pdf
const cands = [];
for (const f of tree) {
  const m = f.match(/(四级|六级)真题\/(\d{4})\.(\d{2})\/真题PDF\/(.+)\.pdf$/);
  if (!m) continue;
  const [, lv, year, month, name] = m;
  if (Number(year) < fromYear) continue;
  if (/答案|解析/.test(f)) continue;
  cands.push({
    path: f, level: lv === '四级' ? 'CET4' : 'CET6',
    year: Number(year), month: Number(month), setNo: extractSetNo(name), name,
    // 中文命名的通常是重排版（带文本层），优先尝试
    prefer: /^cet[46]_/i.test(name) ? 1 : 0,
  });
}

// 按考次分组，组内按优先度排序
const groups = new Map();
for (const c of cands) {
  const k = `${c.level}-${c.year}.${String(c.month).padStart(2, '0')}-set${c.setNo}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(c);
}
for (const v of groups.values()) v.sort((a, b) => a.prefer - b.prefer || a.name.length - b.name.length);

console.log(`${fromYear} 年起共 ${groups.size} 个考次待处理（候选 PDF ${cands.length} 个）`);

let ok = 0, skipped = 0, noText = 0;
for (const [key, list] of groups) {
  const outJson = path.join(root, 'data', 'seed', `${key.replace(/^(\w+)-/, (s, p) => p.toLowerCase() + '-')}.json`);
  if (fs.existsSync(outJson) && !force) { skipped++; continue; }

  let done = false;
  for (const c of list) {
    const local = path.join(pdfDir, path.basename(c.path).replace(/\s+/g, '_'));
    try {
      if (!fs.existsSync(local) || fs.statSync(local).size < 5000) {
        const url = 'https://raw.githubusercontent.com/0609x/CET46-Resources/main/' + encodeURI(c.path);
        const r = await fetch(url);
        if (!r.ok) continue;
        fs.writeFileSync(local, Buffer.from(await r.arrayBuffer()));
      }
      const txt = local.replace(/\.pdf$/i, '.txt');
      execFileSync(PY, [path.join(root, 'scripts', 'pdf-extract.py'), local, txt], { encoding: 'utf8' });

      const r = spawnSync(process.execPath, [
        path.join(root, 'scripts', 'parse-pdf.mjs'), txt, c.level, String(c.year), String(c.month), String(c.setNo), path.basename(c.path),
      ], { cwd: root, encoding: 'utf8' });
      if (r.status === 0) {
        ok++;
        console.log(`  ✓ ${key}  ← ${path.basename(c.path)}`);
        done = true;
        break;
      }
    } catch { /* 换下一个候选 */ }
  }
  if (!done) { noText++; console.log(`  ✗ ${key}  （${list.length} 个候选均无可用文本层）`); }
}
console.log(`\n完成: 新增 ${ok} / 已有 ${skipped} / 未能提取 ${noText}`);

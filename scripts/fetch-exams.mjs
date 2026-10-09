// 批量抓取历年四六级真题 Word 版并解析为结构化 JSON
// 用法: node scripts/fetch-exams.mjs [起始年份]
// 文件清单来源：本地 git 仓库（data/raw/repo，无 blob 克隆），规避 GitHub API 限流
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync, execSync } from 'child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = path.join(root, 'data', 'raw', 'exams');
const repoDir = path.join(root, 'data', 'raw', 'repo');
fs.mkdirSync(rawDir, { recursive: true });

const fromYear = Number(process.argv[2]) || 2020;

let fileList = [];
if (fs.existsSync(path.join(repoDir, '.git'))) {
  const out = execSync('git -c core.quotepath=false -C "' + repoDir + '" ls-tree -r --name-only HEAD', {
    encoding: 'utf8', maxBuffer: 100 * 1024 * 1024,
  });
  fileList = out.split('\n').map((s) => s.trim()).filter(Boolean);
} else {
  console.error('未找到本地仓库 data/raw/repo，请先执行：');
  console.error('  git clone --filter=blob:none --no-checkout --depth 1 https://github.com/0609x/CET46-Resources.git data/raw/repo');
  process.exit(1);
}

const docx = fileList.filter((f) => f.includes('真题Word') && f.endsWith('.docx'));
console.log('仓库内真题 docx 总数:', docx.length);

const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 };
const targets = [];
for (const f of docx) {
  const m = f.match(/(四级|六级)真题\/(\d{4})\.(\d{2})\/真题Word\/(.+)\.docx/);
  if (!m) continue;
  const [, lv, year, month, name] = m;
  if (Number(year) < fromYear) continue;
  let setNo = 1;
  const s1 = name.match(/第(\d)套/);
  const s2 = name.match(/[（(]([一二三四五])[)）]/);
  if (s1) setNo = Number(s1[1]);
  else if (s2) setNo = CN_NUM[s2[1]] || 1;
  targets.push({
    path: f,
    level: lv === '四级' ? 'CET4' : 'CET6',
    year: Number(year),
    month: Number(month),
    setNo,
    local: path.join(rawDir, `${lv === '四级' ? 'cet4' : 'cet6'}-${year}.${String(month).padStart(2, '0')}-set${setNo}.docx`),
  });
}
console.log(`待抓取 ${fromYear} 年起共 ${targets.length} 套真题`);

let downloaded = 0, skipped = 0, failed = 0;
const queue = [...targets];
async function worker() {
  while (queue.length) {
    const t = queue.shift();
    if (fs.existsSync(t.local) && fs.statSync(t.local).size > 10000) { skipped++; continue; }
    try {
      const url = encodeURI('https://raw.githubusercontent.com/0609x/CET46-Resources/main/' + t.path);
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(t.local, buf);
      downloaded++;
      if (downloaded % 5 === 0) console.log(`  已下载 ${downloaded} 套…`);
    } catch (e) {
      failed++;
      console.log('  失败:', t.path.slice(-40), e.message);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}
await Promise.all([worker(), worker(), worker()]);
console.log(`下载完成: 新增 ${downloaded} / 已存在 ${skipped} / 失败 ${failed}`);

console.log('\n解析为结构化 JSON…');
let parsed = 0, parseFailed = 0;
for (const t of targets) {
  if (!fs.existsSync(t.local)) continue;
  const r = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'parse-docx.mjs'), t.local, t.level, String(t.year), String(t.month), String(t.setNo),
  ], { cwd: root, encoding: 'utf8' });
  if (r.status === 0) parsed++;
  else {
    parseFailed++;
    console.log('  解析失败:', path.basename(t.local), ((r.stdout || '') + (r.stderr || '')).slice(-100));
  }
}
console.log(`解析完成: 成功 ${parsed} / 失败 ${parseFailed} -> data/seed/`);

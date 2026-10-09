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

// 注意：排除「答案解析」目录——那是答案与解析，不是试卷正文，
// 早期版本误收过它并与真题撞名。
const docx = fileList.filter(
  (f) => f.includes('真题Word') && f.endsWith('.docx') && !/答案及解析|答案解析/.test(f)
);
console.log('仓库内真题 docx 总数:', docx.length);

// 套号提取：源仓库的命名极不统一，以下形式都出现过
//   第1套 / 第1卷 / 第一套 / 卷二 / （全1套）/ 真题1 / 真题2 / （一）/ （第三套)
// 早期只认「第N套」和「（汉字）」两种，导致「第一套/第二套/第三套」全被当成第 1 套，
// 互相覆盖、静默丢题（四级因此少了 9 套）。
const CN_DIGIT = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const toNum = (s) => (/^\d+$/.test(s) ? Number(s) : CN_DIGIT[s] || 1);
const NUM = '[0-9一二三四五六七八九十]+';

function extractSetNo(name) {
  const cands = [];
  let m;
  if ((m = name.match(new RegExp(`第\\s*(${NUM})\\s*[套卷]`)))) cands.push(m[1]);
  if ((m = name.match(new RegExp(`卷\\s*(${NUM})`)))) cands.push(m[1]);
  if ((m = name.match(new RegExp(`(${NUM})\\s*套`)))) cands.push(m[1]);
  if ((m = name.match(/[（(]\s*([一二三四五六七八九十])\s*[)）]/))) cands.push(m[1]);
  if ((m = name.replace(/\.docx?$/i, '').match(/([1-9])\s*$/))) cands.push(m[1]);
  for (const c of cands) {
    const v = toNum(c);
    if (v >= 1 && v <= 9) return v;
  }
  return 1;
}

const targets = [];
for (const f of docx) {
  const m = f.match(/(四级|六级)真题\/(\d{4})\.(\d{2})\/真题Word\/(.+)\.docx/);
  if (!m) continue;
  const [, lv, year, month, name] = m;
  if (Number(year) < fromYear) continue;
  targets.push({
    path: f,
    level: lv === '四级' ? 'CET4' : 'CET6',
    year: Number(year),
    month: Number(month),
    setNo: extractSetNo(name),
    local: path.join(rawDir, `${lv === '四级' ? 'cet4' : 'cet6'}-${year}.${String(month).padStart(2, '0')}-set${extractSetNo(name)}.docx`),
  });
}
console.log(`待抓取 ${fromYear} 年起共 ${targets.length} 套真题`);

// 撞名检查：不同源文件映射到同一考次会导致静默覆盖丢题，这里显式暴露出来
const seen = new Map();
for (const t of targets) {
  const k = `${t.level}-${t.year}.${String(t.month).padStart(2, '0')}-set${t.setNo}`;
  if (!seen.has(k)) seen.set(k, []);
  seen.get(k).push(path.basename(t.path));
}
const collisions = [...seen.entries()].filter(([, v]) => v.length > 1);
if (collisions.length) {
  console.log(`⚠ 检测到 ${collisions.length} 组考次冲突（后者会覆盖前者）：`);
  for (const [k, v] of collisions) console.log('   ', k, '←', v.join(' | '));
}
console.log('去重后考次数:', seen.size);

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

// 清掉「上一次运行留下的、本次不再产出」的 JSON。
// 为什么需要：早期套号解析有 bug 时，「第二套/第三套」会被写进 set1 的文件名里，
// 修好后 set1 不再产出，但这些旧文件仍留在 seed 目录 —— 它们文件名标着「第1套」，
// 内容其实是别的套，会以错误标签进入数据库。
const seedDirOut = path.join(root, 'data', 'seed');
const expected = new Set(
  targets.map((t) => `${t.level.toLowerCase()}-${t.year}.${String(t.month).padStart(2, '0')}-set${t.setNo}.json`)
);
const existing = fs.existsSync(seedDirOut) ? fs.readdirSync(seedDirOut).filter((f) => f.endsWith('.json')) : [];
const stale = existing.filter((f) => !expected.has(f));
if (stale.length) {
  const staleDir = path.join(seedDirOut, '_stale');
  fs.mkdirSync(staleDir, { recursive: true });
  for (const f of stale) {
    try {
      fs.renameSync(path.join(seedDirOut, f), path.join(staleDir, f));
      console.log('  移出失效文件:', f);
    } catch (e) {
      console.log('  移出失败（可忽略）:', f, e.message);
    }
  }
}
console.log(`seed 目录有效 JSON 数: ${existing.length - stale.length}`);

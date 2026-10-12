// 密钥泄漏闸门：扫描所有被 git 跟踪的文件，发现疑似 API Key 立即失败。
// 除了通用模式（sk-xxx / api_key=xxx），还会把「本机真实使用的 Key」做一次精确匹配。
// 用法: node scripts/check-secrets.mjs
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// 1) 通用模式
const PATTERNS = [
  { name: 'sk- 风格密钥', re: /sk-[A-Za-z0-9_-]{16,}/g },
  { name: 'api_key 直赋值', re: /(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*["']([A-Za-z0-9_\-]{20,})["']/gi },
  { name: 'Bearer 硬编码', re: /Bearer\s+[A-Za-z0-9_\-\.]{24,}/g },
];

// 2) 本机真实 Key（环境变量优先，其次用户库 settings）——只用于比对，不会被打印
const realKeys = [];
if (process.env.KEEPER_AI_KEY) realKeys.push(process.env.KEEPER_AI_KEY);
try {
  const SQL = await initSqlJs({ locateFile: (f) => path.join(root, 'node_modules', 'sql.js', 'dist', f) });
  const dir = path.join(process.env.APPDATA || '', 'cet-wordkeeper');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => /^keeper\.db/.test(x))) {
      try {
        const db = new SQL.Database(fs.readFileSync(path.join(dir, f)));
        const r = db.exec('SELECT key,value FROM settings');
        if (r.length) for (const row of r[0].values) if (/^api_?key$/i.test(row[0]) && String(row[1] || '').length > 16) realKeys.push(String(row[1]));
        db.close();
      } catch { /* 忽略坏文件 */ }
    }
  }
} catch { /* sql.js 不可用时只做模式扫描 */ }

const mask = (s) => (s.length > 10 ? s.slice(0, 6) + '***' + s.slice(-3) : '***');

// 不走 shell（execSync 会派生 cmd.exe，部分环境会拦截）：直接 git 直调
// 沙箱偶发 EBUSY（进程瞬时拉起失败）→ 自动重试
let ls = null;
for (let i = 0; i < 5; i++) {
  ls = spawnSync('git', ['ls-files'], { cwd: root, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' });
  if (!ls.error) break;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000 * (i + 1));
}
if (ls.error || ls.status !== 0) {
  // 兜底：读取 Bash 预生成的文件清单（.verify-filelist），避免环境派生受阻时闸门失效
  const listFile = path.join(root, '.verify-filelist');
  if (fs.existsSync(listFile)) {
    console.warn('git ls-files 派生失败，使用预生成清单兜底');
    ls = { stdout: fs.readFileSync(listFile, 'utf8'), status: 0, error: null };
  } else {
    console.error('git ls-files 执行失败:', ls.error ? ls.error.message : 'exit ' + ls.status);
    process.exit(1);
  }
}
const files = ls.stdout.split('\n').map((s) => s.trim()).filter(Boolean);

const findings = [];
let scanned = 0;
for (const rel of files) {
  const abs = path.join(root, rel);
  let buf;
  try { buf = fs.readFileSync(abs); } catch { continue; }
  scanned++;
  // 二进制也照扫：latin1 是字节 1:1 映射，能稳定做子串匹配
  const text = buf.toString('latin1');

  for (const rk of realKeys) {
    if (rk && text.includes(rk)) findings.push({ file: rel, kind: '真实 Key 精确命中', sample: mask(rk) });
  }
  for (const p of PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      // 允许测试用占位值（sk-test / sk-xxx / 明显的假值）
      const hit = m[0];
      if (/sk-(test|xxx+|your|dummy|placeholder|fake)/i.test(hit)) continue;
      findings.push({ file: rel, kind: p.name, sample: mask(hit) });
      if (findings.length > 40) break;
    }
  }
}

console.log(`扫描 ${scanned} 个被跟踪文件（含 data/keeper.db 等二进制）`);
if (!findings.length) {
  console.log('✓ 未发现任何密钥泄漏迹象');
  process.exit(0);
}
console.log(`\n✗ 发现 ${findings.length} 处疑似密钥：`);
for (const f of findings.slice(0, 40)) console.log(`  ${f.file}  [${f.kind}]  ${f.sample}`);
console.log('\n请立刻移除并从 git 历史中清理（仅从最新提交删除不够，历史里仍能取到）。');
process.exit(1);

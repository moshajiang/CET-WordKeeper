// 编排：启动应用 -> 等待就绪 -> 运行 CDP 端到端验证 -> 清理
// 用途：在无法持久保留 GUI 进程的环境里完成一次完整验证
import { spawn, spawnSync, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// ELECTRON_EXE 可指向打包后的可执行文件，用于验证发布产物（默认用开发态 electron）
const packaged = !!process.env.ELECTRON_EXE;
const electronExe = process.env.ELECTRON_EXE || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

// 验证必须使用「隔离的用户数据目录」：
// ⚠️ 此前直接用 %APPDATA%\cet-wordkeeper（与正式安装的应用同一路径），每次验证
// 都会把用户真实数据（生词本/API Key/复习记录）删掉——已造成过真实数据丢失，禁止回退。
// 应用侧由 KEEPER_USER_DATA 环境变量把 userData 指到隔离目录（见 main.cjs）。
const realUserDataDir = path.join(process.env.APPDATA || '', 'cet-wordkeeper');
const userDataDir = path.join(root, '.verify-user-data');
process.env.KEEPER_USER_DATA = userDataDir;

function cleanUserDb(tag) {
  // 双保险：清理目标绝不允许是真实安装应用的数据目录
  if (path.resolve(userDataDir) === path.resolve(realUserDataDir)) {
    console.error('安全中止：清理目标指向了真实用户数据目录！', realUserDataDir);
    process.exit(1);
  }
  if (!fs.existsSync(userDataDir)) return;
  for (const f of fs.readdirSync(userDataDir)) {
    const p = path.join(userDataDir, f);
    if (fs.statSync(p).isDirectory()) continue;
    // 某些沙箱/杀软环境会拦删除或占用文件；清理失败不应影响验证结论
    try { fs.rmSync(p, { force: true }); console.log(`已清理${tag}用户数据:`, f); }
    catch (e) { console.warn(`清理${tag}用户数据失败（可忽略）:`, f, e.message); }
  }
}
cleanUserDb('残留');

// spawnSync 重试：沙箱/系统偶发 EBUSY（进程瞬时拉起失败），重试通常可恢复
function spawnRetry(cmd, args, opts) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const r = spawnSync(cmd, args, opts);
      if (r.error && r.error.code === 'EBUSY' && i < 2) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000 * (i + 1));
        continue;
      }
      return r;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('spawnRetry 失败');
}

// 密钥闸门：每次验证都先确认「没有任何 Key 进入被跟踪文件」。
// Key 只应存在于本机用户库（%APPDATA%）或环境变量里，绝不进仓库。
// 跳过开关：系统级进程派生故障时（cmd.exe EBUSY），由调用方先在 shell 里跑完这两项
// 再设 SKIP_AUX_GATE=1 走主流程（辅助闸门本身已在 shell 中通过）。
const skipAux = !!process.env.SKIP_AUX_GATE;
if (!skipAux) {
  console.log('扫描密钥泄漏…');
  const secretScan = spawnRetry(process.execPath, ['scripts/check-secrets.mjs'], { cwd: root, stdio: 'inherit' });
  if (secretScan.status !== 0) {
    console.error('\n发现疑似密钥泄漏，已中止验证。请先从文件中移除并清理 git 历史，再重新运行。');
    process.exit(1);
  }

  // 对齐质量闸门：长篇阅读段落级对齐的字母必须一一对应（错位即失败）
  console.log('对齐质量审计…');
  const alignScan = spawnRetry(process.execPath, ['scripts/align-quality.mjs'], { cwd: root, stdio: 'inherit' });
  if (alignScan.status !== 0) {
    console.error('\n对齐质量审计未通过（段落字母错位），已中止验证。');
    process.exit(1);
  }
} else {
  console.log('（SKIP_AUX_GATE=1：密钥扫描与对齐审计由调用方另行执行）');
}

const env = { ...process.env, KEEPER_USER_DATA: userDataDir };
delete env.ELECTRON_RUN_AS_NODE;

const flags = [
  '--remote-debugging-port=9222', '--no-sandbox',
  '--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer', '--disable-dev-shm-usage',
];
const el = spawn(
  electronExe,
  packaged ? flags : ['.', ...flags],
  { cwd: root, env, stdio: 'ignore' }
);

console.log('应用进程已启动 pid=' + el.pid + '，等待就绪…');
// 轮询 CDP 直到页面 target 出现（首次启动含 dict_lex 迁移，可能超过固定等待）
{
  const deadline = Date.now() + 45000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const tg = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      ready = Array.isArray(tg) && tg.some((x) => x.type === 'page' && (x.url.includes('index.html') || x.url.startsWith('http')));
      if (ready) console.log('页面 target 已就绪（' + Math.round((45000 - (deadline - Date.now())) / 1000) + 's）');
    } catch { /* 应用尚未监听 */ }
  }
  if (!ready) console.warn('⚠ 45s 内未检测到页面 target，仍尝试运行断言');
}

let code = 1;
try {
  const r = spawnRetry(process.execPath, ['scripts/e2e-check.mjs'], { cwd: root, stdio: 'inherit' });
  code = r.status === null ? 1 : r.status;
} catch (e) {
  console.error('验证脚本执行失败:', e.message);
}

try { execSync(`taskkill /F /T /PID ${el.pid}`, { stdio: 'ignore' }); } catch (e) { /* already exited */ }

// 清理验证过程写入的用户数据，保证用户首次打开是干净状态
cleanUserDb('验证');

console.log(code === 0 ? '\n验证全部通过，应用已就绪。' : '\n验证存在失败项。');
process.exit(code);

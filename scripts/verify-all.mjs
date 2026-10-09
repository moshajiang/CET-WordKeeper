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

// 验证前必须先清空用户数据里的库，否则会拿上一次遗留的数据跑断言
// （应用只在用户库不存在时才从种子库初始化）
const userDataDir = path.join(process.env.APPDATA || '', 'cet-wordkeeper');
function cleanUserDb(tag) {
  if (!fs.existsSync(userDataDir)) return;
  for (const f of fs.readdirSync(userDataDir)) {
    if (f.endsWith('.db')) {
      // 某些沙箱/杀软环境会拦删除或占用文件；清理失败不应影响验证结论
      try { fs.unlinkSync(path.join(userDataDir, f)); console.log(`已清理${tag}用户数据:`, f); }
      catch (e) { console.warn(`清理${tag}用户数据失败（可忽略）:`, f, e.message); }
    }
  }
}
cleanUserDb('残留');

const env = { ...process.env };
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
await new Promise((r) => setTimeout(r, 9000));

let code = 1;
try {
  const r = spawnSync(process.execPath, ['scripts/e2e-check.mjs'], { cwd: root, stdio: 'inherit' });
  code = r.status === null ? 1 : r.status;
} catch (e) {
  console.error('验证脚本执行失败:', e.message);
}

try { execSync(`taskkill /F /T /PID ${el.pid}`, { stdio: 'ignore' }); } catch (e) { /* already exited */ }

// 清理验证过程写入的用户数据，保证用户首次打开是干净状态
cleanUserDb('验证');

console.log(code === 0 ? '\n验证全部通过，应用已就绪。' : '\n验证存在失败项。');
process.exit(code);

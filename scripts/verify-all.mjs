// 所有应用写入均使用本轮独占临时目录；异常、超时也终止进程并清理。
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestSession, availablePort, waitForPage, stopChild, connectCdp } from './lib/test-session.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const packaged = !!process.env.ELECTRON_EXE;
const electronExe = process.env.ELECTRON_EXE || path.join(root, 'node_modules/electron/dist/electron.exe');
function runScript(script, env = process.env) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = spawnSync(process.execPath, [script], { cwd: root, stdio: 'inherit', env, timeout: 10 * 60 * 1000 });
    if (result.error?.code === 'EBUSY' && attempt < 2) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000 * (attempt + 1));
      continue;
    }
    if (result.error) throw result.error;
    return result.status ?? 1;
  }
}

let code = 1;
let session;
let child;
try {
  if (!process.env.SKIP_AUX_GATE) {
    for (const script of ['scripts/check-secrets.mjs', 'scripts/align-quality.mjs']) {
      if (runScript(script) !== 0) throw new Error(`${script} 未通过`);
    }
  } else console.log('辅助闸门由调用方先行执行（SKIP_AUX_GATE=1）');
  session = createTestSession('verify');
  const port = await availablePort();
  const env = { ...session.env, KEEPER_CDP_PORT: String(port) };
  const flags = [`--remote-debugging-port=${port}`, '--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer', '--disable-dev-shm-usage'];
  child = spawn(electronExe, packaged ? flags : ['.', ...flags], { cwd: root, env, stdio: 'ignore' });
  console.log(`应用 pid=${child.pid}，隔离目录=${session.dir}`);
  const page = await waitForPage(port, child);
  const cdp = await connectCdp(page);
  cdp.close();
  console.log('应用和界面已就绪，运行端到端断言…');
  code = runScript('scripts/e2e-check.mjs', env);
} catch (error) {
  console.error('验证失败：', error.message);
} finally {
  try { await stopChild(child); session?.cleanup(); }
  catch (error) { code = 1; console.error('测试清理失败：', error.message); }
}
console.log(code === 0 ? '验证全部通过。' : '验证存在失败项。');
process.exitCode = code;

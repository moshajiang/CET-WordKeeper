import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export function createTestSession(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid test session name');
  const parent = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(parent, `cet-wordkeeper-${name}-`));
  const token = randomUUID();
  const marker = path.join(dir, '.keeper-test-session');
  fs.writeFileSync(marker, token);
  const env = { ...process.env, KEEPER_USER_DATA: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  return {
    dir, env,
    cleanup() {
      if (!fs.existsSync(dir)) return;
      // 删除前核对绝对路径、父目录和本次随机标记；不接受外部传入的清理目标。
      if (fs.lstatSync(dir).isSymbolicLink() || fs.realpathSync(dir) !== dir || path.dirname(dir) !== parent
        || !path.basename(dir).startsWith(`cet-wordkeeper-${name}-`) || fs.readFileSync(marker, 'utf8') !== token) {
        throw new Error(`Refusing to clean unowned test directory: ${dir}`);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function waitForPage(port, child, timeout = 45000) {
  let spawnError = null;
  const onError = error => { spawnError = error; };
  child.on('error', onError);
  try {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode) throw new Error(`应用提前退出：${child.exitCode ?? child.signalCode}`);
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1500) })).json();
        const page = targets.find(t => t.type === 'page' && (t.url.includes('index.html') || t.url.startsWith('http')));
        if (page) return page;
      } catch { /* CDP 端口或页面尚未就绪 */ }
      await delay(250);
    }
    throw new Error(`应用在 ${timeout}ms 内未就绪`);
  } finally { child.removeListener('error', onError); }
}

export async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    if (result.error) throw result.error;
  } else child.kill('SIGTERM');
  const deadline = Date.now() + 5000;
  while (child.exitCode === null && !child.signalCode && Date.now() < deadline) await delay(100);
  if (child.exitCode === null && !child.signalCode) throw new Error('测试进程未退出，保留隔离目录供检查');
}

export async function connectCdp(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('CDP connection timeout')); }, 10000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP connection failed')); };
  });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error || message.result?.exceptionDetails) request.reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
    else request.resolve(message.result?.result?.value);
  };
  ws.onclose = () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('CDP disconnected')); }
    pending.clear();
  };
  const js = expression => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP evaluation timeout')); }, 15000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await js('!!(window.keeper && document.querySelector(".logo"))')) return { js, close: () => ws.close() };
      await delay(100);
    }
    throw new Error('应用界面未完成初始化');
  } catch (error) { ws.close(); throw error; }
}

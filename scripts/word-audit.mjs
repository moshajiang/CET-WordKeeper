// 词典查得率审计：对语料中出现的高频词逐一走真实的 lookup 链路，报告解析失败（查不到释义）的词
// 用途: 调整词典裁剪策略后，量化验证覆盖率是否提升
// 用法: node scripts/word-audit.mjs [抽样词数，默认300]
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOP_N = Number(process.argv[2]) || 300;

const electronExe = process.env.ELECTRON_EXE || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const packaged = !!process.env.ELECTRON_EXE;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// 用独立的 user-data-dir，绝不触碰用户真实数据
const sandboxData = path.join(root, '.tmp-audit-data');
try { fs.rmSync(sandboxData, { recursive: true, force: true }); } catch { /* 忽略 */ }
fs.mkdirSync(sandboxData, { recursive: true });

const flags = [
  '--remote-debugging-port=9224', '--no-sandbox',
  '--user-data-dir=' + sandboxData,
  '--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer', '--disable-dev-shm-usage',
];
const el = spawn(electronExe, packaged ? flags : ['.', ...flags], { cwd: root, env, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 9000));

const targets = await (await fetch('http://127.0.0.1:9224/json')).json();
const page = targets.find((t) => t.type === 'page');
if (!page) { console.error('未找到页面'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params) => new Promise((res) => {
  const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
const js = async (expr) => (await send('Runtime.evaluate',
  { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;

// 取语料高频词（按真题出现次数排序）
const words = await js(`(async () => {
  const ex = await window.keeper.listExams();
  const tally = new Map();
  for (const e of ex) {
    const d = await window.keeper.examDetail(e.id);
    for (const p of d.passages) {
      for (const t of new Set(String(p.content).toLowerCase().match(/[a-z][a-z'-]*/g) || [])) {
        if (t.length < 3) continue;
        tally.set(t, (tally.get(t) || 0) + 1);
      }
    }
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, ${TOP_N}).map(x => x[0]);
})()`);
console.log(`审计语料高频词 Top ${words.length}…`);

// 逐一走真实 lookup
const failed = [];
let ok = 0;
for (const w of words) {
  const r = await js(`window.keeper.lookup(${JSON.stringify(w)})`);
  if (r.found) ok++;
  else failed.push(w);
}
ws.close();
try { execSync(`taskkill /F /T /PID ${el.pid}`, { stdio: 'ignore' }); } catch { /* 已退出 */ }
try { fs.rmSync(sandboxData, { recursive: true, force: true }); } catch { /* 已 gitignore，忽略 */ }

const rate = ((ok / words.length) * 100).toFixed(1);
console.log(`\n查得率: ${ok}/${words.length} = ${rate}%`);
if (failed.length) {
  console.log(`\n查不到释义的词（${failed.length} 个）:`);
  console.log(failed.join(', '));
}
process.exit(0);

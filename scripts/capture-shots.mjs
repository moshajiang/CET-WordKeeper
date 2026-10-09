// 通过 CDP 截取各页面截图，用于 README 展示
// 用法:
//   node scripts/capture-shots.mjs            # 截全部
//   node scripts/capture-shots.mjs 04-words   # 只截指定页面（该环境的 captureScreenshot 会随会话时长变不稳定，
//                                             #  单独重截某一张时每次都是全新会话，成功率最高）
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });
const only = process.argv[2] || null;

const electronExe = process.env.ELECTRON_EXE || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const packaged = !!process.env.ELECTRON_EXE;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// 用独立的 user-data-dir，绝不触碰用户真实数据（即使脚本被中途杀掉）
const sandboxData = path.join(root, '.tmp-shots-data');
try { fs.rmSync(sandboxData, { recursive: true, force: true }); } catch { /* 忽略 */ }
fs.mkdirSync(sandboxData, { recursive: true });

const flags = [
  '--remote-debugging-port=9223', '--no-sandbox', '--window-size=1360,900',
  '--user-data-dir=' + sandboxData,
  '--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer', '--disable-dev-shm-usage',
];
const el = spawn(electronExe, packaged ? flags : ['.', ...flags], { cwd: root, env, stdio: 'ignore' });
console.log('应用已启动 pid=' + el.pid + '，等待就绪…');
await new Promise((r) => setTimeout(r, 9000));

const targets = await (await fetch('http://127.0.0.1:9223/json')).json();
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
const send = (method, params) => new Promise((res, rej) => {
  const i = ++seq;
  const timer = setTimeout(() => { pending.delete(i); rej(new Error(method + ' 超时')); }, 20000);
  pending.set(i, (m) => { clearTimeout(timer); res(m); });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const js = async (expr) => (await send('Runtime.evaluate',
  { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;

// 找一套内容完整的真题用于阅读器截图
const exams = await js('window.keeper.listExams()');
const anchor = exams.find((e) => e.level === 'CET6' && e.year === 2024) || exams[0];
console.log('截图用真题:', anchor.title);

async function shot(name, hash, waitMs = 1600, prep = null) {
  if (only && name !== only) return;
  // 该环境的 Page.captureScreenshot 偶发超时，重试即可恢复
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await js(`location.hash = ${JSON.stringify(hash)}`);
      await new Promise((r) => setTimeout(r, waitMs));
      if (prep) {
        await js(prep);
        await new Promise((r) => setTimeout(r, 1400));
      }
      // 无显示器的软件渲染环境里合成器可能卡住，强制一次度量覆盖会触发重绘
      await send('Emulation.setDeviceMetricsOverride', {
        width: 1360, height: 900, deviceScaleFactor: 1, mobile: false,
      });
      await new Promise((r) => setTimeout(r, 600));
      const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const buf = Buffer.from(r.result.data, 'base64');
      fs.writeFileSync(path.join(outDir, name + '.png'), buf);
      console.log('  已截图', name + '.png', (buf.length / 1024).toFixed(0) + 'KB');
      return;
    } catch (e) {
      console.warn(`  第 ${attempt} 次尝试失败（${name}）—`, e.message);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  console.warn('  跳过', name);
}

// 阅读器截图前：切到「仔细阅读」并点开一个词，展示查词浮层（README 的核心卖点）
// 注意必须包在同一个 IIFE 里：两个 IIFE 直接拼接会被解析成调用，导致 TypeError
const PREP_READER_POPOVER = `(() => {
  const tabs = [...document.querySelectorAll('.section-tabs button')];
  const t = tabs.find(b => /仔细阅读/.test(b.textContent));
  if (t) t.click();
  return new Promise((resolve) => setTimeout(() => {
    const spans = [...document.querySelectorAll('.w')];
    const el = spans.find(s => s.textContent.trim().length >= 7) || spans[0];
    if (!el) return resolve('no-word');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    }));
    resolve(el.textContent.trim());
  }, 900));
})()`;

// 造一点学习数据，让生词本/复习页有内容
await js(`(async () => {
  const d = await window.keeper.examDetail(${anchor.id});
  const p = d.passages.find(x => x.section === 'reading');
  await window.keeper.addWord('intervene', 'They intervened quickly to stop the unsafe act.', p.id);
  await window.keeper.addWord('irrefutable', 'The evidence was irrefutable.', p.id);
  await window.keeper.addWord('exhibit', 'The museum will exhibit the painting.', p.id);
  await window.keeper.setWordStatus('exhibit', 'mastered');
  await window.keeper.reviewAnswer('intervene', 2);
})()`);
await new Promise((r) => setTimeout(r, 1200));

// 演示数据必须确实写入，否则生词本会是空页面
const demoCount = await js('(async () => (await window.keeper.listWords({})).length)()');
console.log('演示生词数:', demoCount);
if (demoCount < 3) console.warn('警告：演示数据不足，生词本截图可能为空');

// 复习截图前：点「开始」，展示 SM-2 卡片本体而不是开始页
const PREP_REVIEW_START = `(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '开始');
  if (btn) btn.click();
})()`;

await send('Page.enable');
await shot('01-home', '#/');
await shot('02-library', '#/library');
await shot('03-reader', `#/reader/${anchor.id}`, 2200, PREP_READER_POPOVER);
await shot('04-words', '#/words', 2600);
await shot('05-review', '#/review', 2200, PREP_REVIEW_START);
await shot('06-settings', '#/settings');

try { execSync(`taskkill /F /T /PID ${el.pid}`, { stdio: 'ignore' }); } catch { /* 已退出 */ }

// 清理隔离的演示数据（目录已 gitignore；删除是尽力而为，失败不影响结果）
try { fs.rmSync(sandboxData, { recursive: true, force: true }); } catch { /* 目录已 gitignore，忽略 */ }
console.log('\n截图完成 ->', outDir);
process.exit(0);

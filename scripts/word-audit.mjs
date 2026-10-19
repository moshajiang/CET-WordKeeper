// 词典覆盖率与批量词形一致性审计；使用自有临时会话，失败也清理。
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTestSession,availablePort,waitForPage,connectCdp,stopChild} from './lib/test-session.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const TOP_N=Number(process.argv[2] || 300);
if (!Number.isSafeInteger(TOP_N) || TOP_N<1 || TOP_N>5000) throw new Error('抽样词数必须为 1–5000');
const session=createTestSession('word-audit');
let child,cdp;
try {
 const port=await availablePort();
 const electronExe=process.env.ELECTRON_EXE || path.join(root,'node_modules/electron/dist/electron.exe');
 const flags=[`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu'];
 child=spawn(electronExe,process.env.ELECTRON_EXE ? flags : ['.',...flags],{cwd:root,env:session.env,stdio:'ignore'});
 cdp=await connectCdp(await waitForPage(port,child));
 const {js}=cdp;
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

// 批量原形必须与原有 lookup 完全一致。
const mapping = {};
for (let i=0;i<words.length;i+=1000) Object.assign(mapping,await js('window.keeper.resolveWords(' + JSON.stringify(words.slice(i,i+1000)) + ')'));
const mismatches = [];
// 逐一走真实 lookup
const failed = [];
let ok = 0;
for (const w of words) {
  const r = await js(`window.keeper.lookup(${JSON.stringify(w)})`);
  if (mapping[w] !== r.word) mismatches.push(w);
  if (r.found) ok++;
  else failed.push(w);
}

if (!words.length) throw new Error('语料为空');
console.log(`查得率: ${ok}/${words.length} = ${((ok/words.length)*100).toFixed(1)}%`);
console.log(`批量词形与查词一致: ${words.length-mismatches.length}/${words.length}`);
if (failed.length) console.log('查不到释义的词: '+failed.join(', '));
if (mismatches.length) { console.error('词形不一致: '+mismatches.join(', '));process.exitCode=1; }
} catch(error) {console.error(error);process.exitCode=1;}
finally {cdp?.close();try {await stopChild(child);session.cleanup();} catch(error) {console.error(error);process.exitCode=1;}}

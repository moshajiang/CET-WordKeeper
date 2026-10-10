// 端到端验证：通过 CDP 连接运行中的应用，走通 查词→标注→生词本→复习 全链路
// 前置：应用需以 --remote-debugging-port=9222 启动
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = 9222;
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html')) || targets.find((t) => t.type === 'page');
if (!page) {
  console.error('未找到页面 target:', JSON.stringify(targets.map((t) => ({ type: t.type, url: t.url })), null, 1));
  process.exit(1);
}
console.log('连接页面:', page.url.slice(0, 80));

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params) {
  return new Promise((res) => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
}
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
  return r.result && r.result.result ? r.result.result.value : undefined;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

console.log('\n===== 界面渲染 =====');
const title = await js('document.querySelector(".logo") ? document.querySelector(".logo").textContent.trim() : ""');
check('应用标题渲染', title.includes('CET WordKeeper'), title.slice(0, 30));
const navCount = await js('document.querySelectorAll(".nav-item").length');
check('侧边导航项', navCount >= 5, navCount + ' 项');

console.log('\n===== 应用信息 =====');
const info = await js('window.keeper.info()');
check('应用信息 IPC', !!info && info.dbReady === true, JSON.stringify(info));

console.log('\n===== 真题库 =====');
const exams = await js('window.keeper.listExams()');
check('真题列表', exams.length >= 10, exams.length + ' 套，最早 ' + exams[exams.length - 1].year + '.' + exams[exams.length - 1].month);
// 防止「用旧数据打包」：这个坑踩过两次（exe 里的 keeper.db 早于上一次数据扩充）。
// 期望值在测试运行时从 data/seed 现算 —— 扩充考次后测试自动跟随，无需改测试；
// 精确比对套数与题量，比旧版的「下限 70」更能抓住缺题/短题的旧包。
const seedDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'seed');
let expExams = 0, expQs = 0;
for (const f of fs.readdirSync(seedDir).filter((x) => x.endsWith('.json'))) {
  const s = JSON.parse(fs.readFileSync(path.join(seedDir, f), 'utf8'));
  expExams++;
  expQs += (s.passages || []).reduce((a, p) => a + (p.questions || []).length, 0);
}
check('数据为最新版（套数与 seed 一致）', exams.length === expExams, `库中 ${exams.length} 套 / seed ${expExams} 套`);
let dbQs = 0;
for (const e of exams) {
  const d = await js(`window.keeper.examDetail(${e.id})`);
  dbQs += (d.passages || []).reduce((a, p) => a + p.questions.length, 0);
}
check('数据为最新版（题量与 seed 一致）', dbQs === expQs, `库中 ${dbQs} 题 / seed ${expQs} 题`);
// 用内容最完整的一套做后续验证（2024.06 六级第 1 套）
const anchor = exams.find((e) => e.level === 'CET6' && e.year === 2024 && e.month === 6 && e.set_no === 1) || exams[0];
const detail = await js(`window.keeper.examDetail(${anchor.id})`);
check('真题详情（篇章）', detail.passages.length >= 5, detail.passages.length + ' 篇章: ' + detail.passages.map((p) => p.section).join(','));
const qTotal = detail.passages.reduce((a, p) => a + p.questions.length, 0);
check('题目解析', qTotal >= 30, qTotal + ' 题');
const readPassages = detail.passages.filter((p) => p.section === 'reading');
check('仔细阅读双篇完整', readPassages.length >= 2 && readPassages.every((p) => p.content.length > 1500), readPassages.map((p) => p.title + '(' + p.content.length + '字)').join(' / '));
// 源 docx 普遍存在「标点后丢空格」瑕疵，解析阶段已修补
const gluedPunct = detail.passages.map((p) => p.content).join('\n').match(/[,;:][A-Za-z]/g) || [];
check('标点后空格已修补', gluedPunct.length === 0, '残留 ' + gluedPunct.length + ' 处' + (gluedPunct.length ? ': ' + gluedPunct.slice(0, 5).join(' ') : ''));
// 源 docx 偶发「两词粘连」（of / the 开头），构建阶段已修补。
// 用真实词典判定：候选中仍有查不到释义的才算残留（office / often 这类合法词会被正常收录）
const contentAll = detail.passages.map((p) => p.content).join('\n');
const glueCand = [...new Set(contentAll.match(/\b(?:of[a-z]{4,}|the[a-z]{5,}|their[a-z]{3,})\b/g) || [])];
const residualGlue = [];
for (const t of glueCand) {
  const r = await js(`window.keeper.lookup(${JSON.stringify(t)})`);
  if (r.found !== true) residualGlue.push(t);
}
check('粘连词已修补', residualGlue.length === 0, '候选 ' + glueCand.length + ' 个，其中未收录 ' + residualGlue.length + (residualGlue.length ? ': ' + residualGlue.slice(0, 5).join(' ') : ''));

console.log('\n===== 词典查询与词形还原 =====');
const lk = await js('window.keeper.lookup("abandoned")');
check('词形还原 abandoned→abandon', lk.word === 'abandon', lk.word + ' / ' + (lk.entry ? lk.entry.translation.slice(0, 24) : '无释义'));
check('考纲分级标签', lk.tags.includes('cet4') || lk.tags.includes('cet6'), lk.tags.join(' '));
const lk2 = await js('window.keeper.lookup("understood")');
check('不规则变形 understood→understand', lk2.word === 'understand', lk2.word);
const lk3 = await js('window.keeper.lookup("intervening")');
check('现在分词 intervening→intervene', lk3.word === 'intervene', lk3.word);
// ECDICT 的 exchange 未覆盖的部分不规则形式 / 缩写，由兜底词形映射处理
const lk4 = await js('window.keeper.lookup("are")');
check('不规则形式 are→be 且能查到释义', lk4.word === 'be' && lk4.found === true, lk4.word + ' found=' + lk4.found);
const lk5 = await js('window.keeper.lookup("were")');
check('不规则形式 were→be 且能查到释义', lk5.word === 'be' && lk5.found === true, lk5.word + ' found=' + lk5.found);
const lk6 = await js(`window.keeper.lookup(${JSON.stringify("don't")})`);
check('缩写 don\'t→do 且能查到释义', lk6.word === 'do' && lk6.found === true, lk6.word + ' found=' + lk6.found);

console.log('\n===== 标注入库 =====');
const anchorPassage = detail.passages.find((p) => p.section === 'reading');
const pid = anchorPassage.id;
const add = await js(`window.keeper.addWord("intervened", "They intervened quickly to stop the unsafe act.", ${pid})`);
check('加入生词本（自动归原形）', add.ok && add.added === true && add.word === 'intervene', 'word=' + add.word);
const dup = await js(`window.keeper.addWord("intervene", "A second sentence about intervene.", ${pid})`);
check('重复添加幂等', dup.ok && dup.added === false, 'added=' + dup.added);
const words = await js('window.keeper.listWords({})');
check('生词本列表', words.length === 1, words.map((w) => w.word + '(' + w.hits + '处)').join(','));
const wd = await js('window.keeper.wordDetail("intervene")');
check('生词详情含真题出处', wd.hits.length === 2, (wd.hits[0] ? wd.hits[0].sentence.slice(0, 40) : '') + '…');
check('真题词频统计（按原形归并）', !!wd.freq && wd.freq.total >= 1, JSON.stringify(wd.freq));

console.log('\n===== 难词预扫 =====');
const hard = await js('window.keeper.scanHard(' + JSON.stringify(anchorPassage.content) + ', "CET6")');
check('难词预扫返回列表', Array.isArray(hard), '扫出 ' + hard.length + ' 个: ' + hard.slice(0, 6).map((h) => h.word).join(', '));

console.log('\n===== SM-2 复习 =====');
const queue = await js('window.keeper.reviewQueue()');
check('复习队列', queue.due.length + queue.fresh.length >= 1, '到期 ' + queue.due.length + ' / 新词 ' + queue.fresh.length);
const ans1 = await js('window.keeper.reviewAnswer("intervene", 2)');
check('评分"记得"→间隔1天', ans1.ok && Math.abs(ans1.interval - 1) < 0.01, 'interval=' + ans1.interval + '天');
const ans2 = await js('window.keeper.reviewAnswer("intervene", 2)');
check('连续记得→间隔6天', Math.abs(ans2.interval - 6) < 0.01, 'interval=' + ans2.interval + '天');
const ans3 = await js('window.keeper.reviewAnswer("intervene", 0)');
check('评分"忘记"→10分钟重置', ans3.interval < 0.01, 'interval=' + (ans3.interval * 1440).toFixed(1) + '分钟');
await js('window.keeper.reviewAnswer("intervene", 2)');

console.log('\n===== 状态与统计 =====');
await js('window.keeper.setWordStatus("intervene", "mastered")');
const st = await js('window.keeper.stats()');
check('标记已掌握', st.mastered === 1, JSON.stringify(st));
await js('window.keeper.setWordStatus("intervene", "learning")');
const all = await js('window.keeper.allWords()');
check('阅读器高亮词表', all['intervene'] === 'learning', JSON.stringify(all));

console.log('\n===== AI 网关降级（未配置 Key）=====');
const ai = await js('window.keeper.translate("Hello world")');
check('未配置时优雅降级', ai.ok === false && ai.error === 'no_key', 'error=' + ai.error);

console.log('\n===== 设置持久化 =====');
await js('window.keeper.setSettings({api_base: "https://api.deepseek.com/v1", api_model: "deepseek-chat"})');
const s = await js('window.keeper.getSettings()');
check('设置写入与读取', s.api_base === 'https://api.deepseek.com/v1' && s.api_model === 'deepseek-chat', JSON.stringify(s));

console.log('\n===== Anki 导出 =====');
// fs / path 已在文件顶部 import（「数据为最新版」断言用到），这里不再重复声明
const tmp = process.env.TEMP || process.env.TMP || '.';
const ankiPath = path.join(tmp, 'cet-anki-e2e.txt');
const anki = await js(`window.keeper.exportAnki({ status: 'all', targetPath: ${JSON.stringify(ankiPath)} })`);
const ankiText = anki.ok && fs.existsSync(ankiPath) ? fs.readFileSync(ankiPath, 'utf8') : '';
check('Anki 导出文件生成', anki.ok && anki.count === 1, 'count=' + anki.count + ' → ' + ankiPath);
check('Anki 文件格式（表头+制表符）', ankiText.includes('#separator:tab') && ankiText.includes('#html:true') && ankiText.includes('\t'), '长度 ' + ankiText.length);
check('Anki 卡片含例句与出处', /例句：/.test(ankiText) && /出处：/.test(ankiText), '含 <b> 高亮: ' + /<b>/.test(ankiText));
if (anki.ok && fs.existsSync(ankiPath)) fs.unlinkSync(ankiPath);

console.log('\n===== 真题自导入（扩展）=====');
const synthetic = {
  level: 'CET6', year: 2030, month: 6, set_no: 9, title: '自导入测试套题',
  passages: [{ section: 'reading', seq: 1, title: '自定义篇章', content: 'The quick brown fox jumps over the lazy dog. '.repeat(40), questions: [] }],
};
const imp1 = await js(`window.keeper.importExam(${JSON.stringify(JSON.stringify(synthetic))})`);
check('导入自定义真题', imp1.ok === true && imp1.examId > 0, 'examId=' + imp1.examId);
const examsAfter = await js('window.keeper.listExams()');
check('导入后真题数 +1', examsAfter.length === exams.length + 1, exams.length + ' → ' + examsAfter.length);
const imp2 = await js(`window.keeper.importExam(${JSON.stringify(JSON.stringify(synthetic))})`);
check('重复导入被拦截', imp2.ok === false && imp2.error === 'duplicate', 'error=' + imp2.error);

console.log('\n===== 备份 =====');
const bakPath = path.join(tmp, 'cet-backup-e2e.db');
const bak = await js(`window.keeper.backupExport(${JSON.stringify(bakPath)})`);
check('数据库备份导出', bak.ok === true && fs.existsSync(bakPath) && fs.statSync(bakPath).size > 100000, bak.ok ? (fs.statSync(bakPath).size / 1048576).toFixed(1) + 'MB' : '失败');
if (bak.ok && fs.existsSync(bakPath)) fs.unlinkSync(bakPath);

console.log('\n===== 界面级回归（走真实 UI 路径，而非直接调 IPC）=====');
// 这一组专门防「IPC 层测试通过、但页面调不通」的 bug：
// 曾出现 WordBook / Settings 把 Vue 响应式代理直接传给 IPC，
// 结构化克隆失败（"An object could not be cloned."）导致页面永远空白，
// 而当时只测 window.keeper.* 的 e2e 完全测不出来。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 生词本页面应真实渲染出已加入的词
await js(`location.hash = '#/words'`);
await sleep(2500);
const wordRows = await js('document.querySelectorAll(".wtable tr").length');
const emptyState = await js('!!document.querySelector(".empty-state")');
check('生词本页面渲染出词条', wordRows >= 2 && !emptyState, wordRows - 1 + ' 行数据（含表头 ' + wordRows + ' 行）');
const tableWord = await js('(() => { const c = document.querySelector(".wword"); return c ? c.textContent.trim() : ""; })()');
check('生词本表格含目标词 intervene', tableWord === 'intervene', '首行=' + tableWord);

// 设置页「保存」必须真的落库（曾经的响应式代理 bug 会让保存静默失败）
await js(`location.hash = '#/settings'`);
await sleep(2000);
const uiSaved = await js(`(async () => {
  const inputs = [...document.querySelectorAll('.settings-form input')].filter(i => i.type !== 'file');
  const setVal = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  if (inputs[0]) setVal(inputs[0], 'https://api.example.com/v1');
  if (inputs[2]) setVal(inputs[2], 'ui-test-model');
  await new Promise(r => setTimeout(r, 300));
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存');
  if (!btn) return 'no-button';
  btn.click();
  await new Promise(r => setTimeout(r, 900));
  return JSON.stringify(await window.keeper.getSettings());
})()`);
let uiSettings = null;
try { uiSettings = JSON.parse(uiSaved); } catch { /* 保留原始字符串 */ }
check('设置页「保存」真正落库',
  !!uiSettings && uiSettings.api_base === 'https://api.example.com/v1' && uiSettings.api_model === 'ui-test-model',
  uiSaved);

console.log('\n===== 做题 / 交卷 / 解析与翻译 =====');
// 选词填空的正确模型是「10 个空共享一份词库」，不是「一个词对应一道题」
const cloze = detail.passages.find((p) => p.section === 'cloze');
const clozeQ = cloze ? cloze.questions : [];
const clozeOpts = clozeQ.length ? JSON.parse(clozeQ[0].options) : [];
check('选词填空每个空携带完整词库',
  clozeQ.length >= 10 && clozeOpts.length >= 10 && clozeOpts.every((o) => /^[A-O]\)\s*\w/.test(o))
    && clozeQ.every((q) => q.options === clozeQ[0].options),
  `${clozeQ.length} 个空 × 每个 ${clozeOpts.length} 备选（${clozeOpts.slice(0, 3).join(' / ')}）`);

// 预置答案与解析：内置真题的答案/解析/翻译已提前生成烘进种子库，
// 因此「未配置 Key」也应当能直接交卷核对 —— 这正是预置数据的意义
const anchorQs = detail.passages.flatMap((p) => p.questions || []);
const withAnswer = anchorQs.filter((q) => q.answer && String(q.answer).trim()).length;
const objPassages = detail.passages.filter((p) => ['cloze', 'match', 'reading'].includes(p.section));
const withTrans = objPassages.filter((p) => p.translation && p.translation.length > 100).length;
check('内置真题已预置答案', anchorQs.length >= 20 && withAnswer === anchorQs.length,
  `${withAnswer}/${anchorQs.length} 题有答案`);
check('内置真题已预置中文解析', anchorQs.every((q) => (q.analysis || '').length > 8),
  '最短解析 ' + Math.min(...anchorQs.map((q) => (q.analysis || '').length)) + ' 字');
check('内置真题已预置全文翻译', objPassages.length > 0 && withTrans === objPassages.length,
  `${withTrans}/${objPassages.length} 篇有翻译`);

const ensPre = await js(`window.keeper.examAnalysis(${anchor.id})`);
check('预置数据下解析不再触发 AI', ensPre.ok === true && ensPre.cached === true && ensPre.pending === 0, JSON.stringify(ensPre));

// 未配置 Key 也能离线交卷计分：前 6 题答对、其余故意答错，验证确实按预置答案判定
const preUa = {};
anchorQs.forEach((q, i) => {
  const correct = String(q.answer || 'A').toUpperCase();
  const wrong = ['A', 'B', 'C', 'D', 'E'].find((L) => L !== correct) || 'A';
  preUa[q.id] = i < 6 ? correct : wrong;
});
const subPre = await js(`window.keeper.attemptSubmit(${anchor.id}, ${JSON.stringify(preUa)})`);
check('未配置 Key 也能交卷核对（预置答案）',
  subPre.ok === true && subPre.correct === 6 && subPre.total >= 6,
  subPre.ok ? `对 ${subPre.correct}/${subPre.total}，得分 ${subPre.score}` : 'error=' + subPre.error);
await js(`window.keeper.attemptClear(${anchor.id})`);

// 离线判分整链路：导入一套自带答案与翻译的题，全程不需要 AI
const fullExam = {
  level: 'CET6', year: 2031, month: 6, set_no: 8, title: '离线判分测试卷',
  passages: [{
    section: 'reading', seq: 1, title: '测试篇章',
    content: 'The quick brown fox jumps over the lazy dog. '.repeat(40).trim(),
    translation: '敏捷的棕色狐狸跳过了那只懒狗。',
    questions: [
      { qtype: 'choice', stem: '46. 测试题一', options: ['A) 甲', 'B) 乙', 'C) 丙', 'D) 丁'], answer: 'B', analysis: '解析一' },
      { qtype: 'choice', stem: '47. 测试题二', options: ['A) 甲', 'B) 乙', 'C) 丙', 'D) 丁'], answer: 'D', analysis: '解析二' },
    ],
  }],
};
const impFull = await js(`window.keeper.importExam(${JSON.stringify(JSON.stringify(fullExam))})`);
check('导入自带答案与翻译的测试卷', impFull.ok === true, 'examId=' + impFull.examId);
const fullDetail = await js(`window.keeper.examDetail(${impFull.examId})`);
const fqs = fullDetail.passages[0].questions;
const ens = await js(`window.keeper.examAnalysis(${impFull.examId})`);
check('自带解析与翻译时不触发 AI', ens.ok === true && ens.cached === true, JSON.stringify(ens));
check('全文翻译可读取', fullDetail.passages[0].translation === '敏捷的棕色狐狸跳过了那只懒狗。',
  String(fullDetail.passages[0].translation).slice(0, 24));
const subOk = await js(`window.keeper.attemptSubmit(${impFull.examId}, ${JSON.stringify({ [fqs[0].id]: 'B', [fqs[1].id]: 'A' })})`);
check('交卷自动核对并计分', subOk.ok === true && subOk.total === 2 && subOk.correct === 1 && Math.abs(subOk.score - 50) < 0.01,
  `${subOk.correct}/${subOk.total} 得分 ${subOk.score}`);
const gotAttempt = await js(`window.keeper.attemptGet(${impFull.examId})`);
check('作答记录可读回', gotAttempt.answers.length === 2 && !!gotAttempt.attempt,
  `${gotAttempt.answers.length} 条记录，得分 ${gotAttempt.attempt && gotAttempt.attempt.score}`);
await js(`window.keeper.attemptClear(${impFull.examId})`);
const cleared = await js(`window.keeper.attemptGet(${impFull.examId})`);
check('重做可清空作答', cleared.answers.length === 0, `${cleared.answers.length} 条`);

// 阅读器做题界面：切到选词填空，词库与每个空的下拉都应真实渲染
await js(`location.hash = '#/reader/${anchor.id}'`);
await sleep(2600);
const clozeTabFound = await js(`(() => {
  const b = [...document.querySelectorAll('.section-tabs button')].find(x => /选词填空/.test(x.textContent));
  if (b) b.click();
  return !!b;
})()`);
await sleep(900);
const bankChips = await js('document.querySelectorAll(".bank-chip").length');
const blankSelects = await js('document.querySelectorAll(".qblock select").length');
check('阅读器渲染选词填空词库与选项', clozeTabFound && bankChips >= 15 && blankSelects >= 10,
  `词库 ${bankChips} 项 / 下拉 ${blankSelects} 个`);
const submitBtn = await js(`(() => [...document.querySelectorAll('button')].some(b => /交卷/.test(b.textContent)))()`);
check('交卷按钮已渲染', submitBtn === true);

console.log('\n===== 知识库 / AI 聊天 / 作文批改 =====');
// 内置知识库必须真实加载（打包产物里 data/knowledge 漏配会在这里暴露）
const kb = await js('window.keeper.kbList()');
check('内置知识库条目加载', Array.isArray(kb.builtin) && kb.builtin.length >= 10,
  (kb.builtin || []).length + ' 条: ' + (kb.builtin || []).slice(0, 3).join('、'));

// 用户知识条目：增 → 列表读回 → 删
const kbAdd = await js('window.keeper.kbAdd("测试条目", "虚拟语气表示与事实相反的假设，从句用过去式。")');
check('知识条目可添加', kbAdd.ok === true, JSON.stringify(kbAdd));
const kb2 = await js('window.keeper.kbList()');
const mine = (kb2.user || []).find((e) => e.title === '测试条目');
check('知识条目列表读回', !!mine, JSON.stringify(kb2.user || []));
const kbDel = await js(`window.keeper.kbRemove(${mine ? mine.id : 0})`);
check('知识条目可删除', kbDel.ok === true, JSON.stringify(kbDel));

// 未配置 Key 时聊天必须明确 no_key（且不写入历史）
const chatNoKey = await js(`window.keeper.chatSend(${anchor.id}, null, '虚拟语气怎么用？')`);
check('未配置 AI 时聊天优雅降级', chatNoKey.ok === false && chatNoKey.error === 'no_key', 'error=' + chatNoKey.error);
await js('window.keeper.chatClear()');
const histEmpty = await js('window.keeper.chatHistory()');
check('聊天历史可清空', Array.isArray(histEmpty) && histEmpty.length === 0, histEmpty.length + ' 条');

// 作文草稿：保存 → 读回 → 批改降级
const wr = detail.passages.find((p) => p.section === 'writing');
check('真题含写作篇章', !!wr, wr ? '有' : '无');
if (wr) {
  const sv = await js(`window.keeper.essaySave(${anchor.id}, 'writing', 'With the rapid development of technology, our life has changed greatly in recent years.')`);
  check('作文草稿保存', sv.ok === true, JSON.stringify(sv));
  const gt = await js(`window.keeper.essayGet(${anchor.id}, 'writing')`);
  check('作文草稿读回', (gt.content || '').includes('rapid development'), String(gt.content || '').slice(0, 30));
  const gr = await js(`window.keeper.essayGrade(${anchor.id}, 'writing')`);
  check('未配置 AI 时批改优雅降级', gr.ok === false && gr.error === 'no_key', 'error=' + gr.error);
}

console.log('\n===== 知识库与聊天界面级回归 =====');
// 知识库页面真实渲染内置条目
await js(`location.hash = '#/knowledge'`);
await sleep(2000);
const kbChips = await js('document.querySelectorAll(".kb-grid .tagchip").length');
check('知识库页面渲染内置条目', kbChips >= 10, kbChips + ' 条');

// 阅读器：头部「问 AI」按钮展开聊天面板
await js(`location.hash = '#/reader/${anchor.id}'`);
await sleep(2600);
const chatOpened = await js(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('问 AI'));
  if (b) b.click();
  return !!b;
})()`);
await sleep(700);
const chatCard = await js('!!document.querySelector(".chat-card")');
const chatTa = await js('!!document.querySelector(".chat-card textarea")');
check('阅读器聊天面板可展开', chatOpened && chatCard && chatTa, '按钮=' + chatOpened + ' 面板=' + chatCard + ' 输入框=' + chatTa);

// 切到写作页签：作答区 textarea 与「AI 批改」按钮真实渲染
const writeTab = await js(`(() => {
  const b = [...document.querySelectorAll('.section-tabs button')].find(x => x.textContent.includes('写作'));
  if (b) b.click();
  return !!b;
})()`);
await sleep(900);
const essayTa = await js('!!document.querySelector(".essay-input")');
const gradeBtn = await js(`(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('AI 批改')))()`);
check('写作作答区渲染', !!writeTab && essayTa && gradeBtn, 'tab=' + writeTab + ' 输入框=' + essayTa + ' 按钮=' + gradeBtn);
// 草稿读回后 textarea 应恢复已保存内容
const essayVal = await js(`(() => { const t = document.querySelector('.essay-input'); return t ? t.value.slice(0, 30) : ''; })()`);
check('写作草稿在界面恢复', essayVal.includes('rapid development'), essayVal);

console.log('\n===== 主观题预置（范文 / 参考译文）=====');
// 通过导入路径验证：自带 reference 的材料能被完整存取并离线展示
const refExam = {
  level: 'CET6', year: 2032, month: 6, set_no: 9, title: '预置范文测试卷',
  passages: [{
    section: 'writing', seq: 1, title: '写作',
    content: 'Directions: For this part, you are allowed 30 minutes to write an essay on digital literacy.',
    reference: 'Digital literacy has become indispensable in modern life. People who can evaluate online information make better decisions.',
    questions: [],
  }],
};
const impRef = await js(`window.keeper.importExam(${JSON.stringify(JSON.stringify(refExam))})`);
check('导入含预置范文的主观题', impRef.ok === true, 'examId=' + (impRef.examId || impRef.error));
const refDetail = await js(`window.keeper.examDetail(${impRef.examId})`);
check('范文可随篇章存取', ((refDetail.passages[0] || {}).reference || '').includes('indispensable'),
  String((refDetail.passages[0] || {}).reference || '').slice(0, 40));

// 界面级：切到该套的写作页签，「查看范文」按钮应存在且能展开
// （先绕开 reader 再进入：hash 路由同组件复用，绕一下确保是干净挂载）
await js(`location.hash = '#/knowledge'`);
await sleep(600);
await js(`location.hash = '#/reader/${impRef.examId}'`);
await sleep(2600);
const refBtn = await js(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('查看范文'));
  if (b) b.click();
  return !!b;
})()`);
await sleep(500);
const refShown = await js(`(() => { const el = document.querySelector('.er-ref-text'); return el ? el.textContent.slice(0, 30) : ''; })()`);
check('写作范文可离线展开查看', refBtn && refShown.includes('Digital literacy'), '按钮=' + refBtn + ' 内容="' + refShown + '"');

{
  // ① 生词笔记：写入 → 读回 → 覆盖更新（API 契约：saveNote/removeWord 收「单词字符串」而非 id）
  const wl0 = await js('window.keeper.listWords()');
  const target = (wl0 && wl0[0]) ? wl0[0] : null;
  if (target) {
    const note1 = await js(`window.keeper.saveNote(${JSON.stringify(target.word)}, 'e2e 笔记：注意与 intervene 拼写相近')`);
    const wd1 = await js(`window.keeper.wordDetail(${JSON.stringify(target.word)})`);
    check('生词笔记写入并读回', note1.ok === true && note1.updated === true && String((wd1.userWord || {}).note || '').includes('e2e 笔记'), 'note=' + String((wd1.userWord || {}).note || '').slice(0, 30));
    const note2 = await js(`window.keeper.saveNote(${JSON.stringify(target.word)}, 'e2e 笔记（更新）')`);
    const wd2 = await js(`window.keeper.wordDetail(${JSON.stringify(target.word)})`);
    check('生词笔记可覆盖更新', note2.ok === true && note2.updated === true && String((wd2.userWord || {}).note || '').includes('更新'), 'note=' + String((wd2.userWord || {}).note || '').slice(0, 30));
  } else {
    check('生词笔记写入并读回', false, '生词本为空，前置用例未建立数据');
  }

  // ② 删除生词：删除 → 列表不再包含 → 重复删除不改动
  if (target) {
    const del = await js(`window.keeper.removeWord(${JSON.stringify(target.word)})`);
    const wl1 = await js('window.keeper.listWords()');
    check('生词可从生词本删除', del.ok === true && del.removed === true && !wl1.some((w) => w.word === target.word), '剩余 ' + wl1.length + ' 条');
    const del2 = await js(`window.keeper.removeWord(${JSON.stringify(target.word)})`);
    check('重复删除幂等（不报错且不改动）', del2.ok === true && del2.removed === false, 'removed=' + del2.removed);
    // 恢复状态，避免影响后续断言
    await js(`window.keeper.addWord(${JSON.stringify(target.word)})`);
  }

  // ③ AI 语法分析：未配置 Key 时必须优雅降级
  const gr = await js(`window.keeper.grammar('The quick brown fox jumps over the lazy dog.')`);
  check('未配置 AI 时语法分析优雅降级', gr.ok === false && gr.error === 'no_key', 'error=' + gr.error);

  // ④ 三个页面渲染冒烟（此前只测了生词本/知识库/设置/阅读器）
  await js(`location.hash = '#/library'`); await sleep(1200);
  const libCards = await js(`document.querySelectorAll('.exam-grid .exam-card').length`);
  check('真题库页面渲染出套题卡片', libCards >= 10, libCards + ' 张卡片');

  await js(`location.hash = '#/'`); await sleep(1200);
  const homeStat = await js(`document.querySelectorAll('.stat-row .stat-box').length`);
  check('首页渲染统计区', homeStat >= 1, homeStat + ' 个统计块');

  await js(`location.hash = '#/review'`); await sleep(1500);
  const revTitle = await js(`(() => { const el = document.querySelector('.review-wrap .page-title, .page-title'); return el ? el.textContent.trim() : ''; })()`);
  check('复习页面渲染', revTitle.length > 0, '标题="' + revTitle + '"');
}

// ===== 阅读器交互：各题型作答 / 解析揭示 / 常驻顶栏 / 逐句对照与背诵 / 左右分栏 =====
// 注意顺序：作答类断言必须在「查看解析与翻译」之前——一旦揭示答案，选项渲染的是
// ✓正确/✗错误（right/wrong）而非 picked，就不是「作答态」了。
{
  const clickText = (label, sel = 'button') => js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.includes(${JSON.stringify(label)})); if (b) { b.click(); return true; } return false; })()`);
  const gotoTab = async (label) => {
    const ok = await js(`(() => { const t = [...document.querySelectorAll('.section-tabs button')].find(x => x.textContent.includes(${JSON.stringify(label)})); if (t) { t.click(); return true; } return false; })()`);
    await sleep(1100);
    return ok;
  };
  const visZh = () => js(`[...document.querySelectorAll('.bi-zh')].filter(e => e.offsetParent !== null).length`);

  // 从「未交卷」态开始：清掉本套作答记录（否则答案锁死、解析强制显示）
  await js(`window.keeper.attemptClear(${anchor.id})`); await sleep(300);
  await js(`location.hash = '#/library'`); await sleep(600);
  await js(`location.hash = '#/reader/${anchor.id}'`); await sleep(2800);

  // 基底：切到「仔细阅读」（有客观题 + 全文翻译）
  const baseOk = await gotoTab('仔细阅读');

  // ① 仔细阅读：A/B/C/D 选项可点选作答
  const opts = await js(`document.querySelectorAll('.qblock .qopt').length`);
  await js(`(() => { const el = document.querySelector('.qblock .qopt'); if (el) el.click(); return !!el; })()`);
  await sleep(500);
  const pickedRd = await js(`document.querySelectorAll('.qopt.picked').length`);
  const cntRd = await js(`(() => { const el = document.querySelector('.qpanel-head span'); return el ? el.textContent.trim() : ''; })()`);
  check('仔细阅读可点选作答', baseOk && opts >= 4 && pickedRd >= 1, `选项 ${opts} 个 / 已选中 ${pickedRd} 个 / ${cntRd}`);

  // ② 长篇阅读（段落匹配）：可点选段落字母作答（历史 bug：无可点选项 → 无法作答）
  const tabOk = await gotoTab('长篇阅读');
  const letters = await js(`document.querySelectorAll('.qopt.letter').length`);
  await js(`(() => { const el = document.querySelector('.qopt.letter'); if (el) el.click(); return !!el; })()`);
  await sleep(600);
  const picked = await js(`document.querySelectorAll('.qopt.letter.picked').length`);
  check('长篇阅读可点选作答', tabOk && letters >= 10 && picked >= 1, `字母按钮 ${letters} 个 / 已选中 ${picked} 个`);

  // ③ 选词填空：词库 + 下拉框作答
  await gotoTab('选词填空');
  const bank = await js(`document.querySelectorAll('.bank-chip').length`);
  const sel = await js(`document.querySelectorAll('.qblock select').length`);
  const ans = await js(`(() => { const s = document.querySelector('.qblock select'); if (!s || !s.options[1]) return ''; const o = s.options[1]; s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return o.value; })()`);
  await sleep(500);
  check('选词填空词库与下拉作答', bank >= 10 && sel >= 10 && ans.length === 1, `词库 ${bank} 词 / 下拉 ${sel} 个 / 选 ${ans}`);

  // 回到「仔细阅读」做解析 / 翻译类断言
  await gotoTab('仔细阅读');

  // ④ 「查看解析与翻译」应当直接揭示答案与解析（历史 bug：只加载不显示 → 点了没反应）
  const before = await js(`document.querySelectorAll('.qanalysis').length`);
  const clicked = await clickText('查看解析与翻译');
  await sleep(3500);
  const after = await js(`document.querySelectorAll('.qanalysis').length`);
  const marks = await js(`document.querySelectorAll('.qmark').length`);
  check('查看解析与翻译可揭示答案解析', clicked && before === 0 && after > 0 && marks > 0, `点击前 ${before} 条 / 点击后 ${after} 条 / 判定标记 ${marks} 个`);

  // ④b 再点一次应收起（开关），避免「只看答案后无法回到作答态」
  const hideOk = await clickText('隐藏解析');
  await sleep(800);
  const afterHide = await js(`document.querySelectorAll('.qanalysis').length`);
  check('解析可再次隐藏（开关）', hideOk && afterHide === 0, `隐藏后 ${afterHide} 条`);
  await clickText('查看解析与翻译');   // 复原，供后续断言使用
  await sleep(1200);

  // ⑤ 顶栏常驻：滚动容器是 .main（overflow:auto），滚动后仍贴在内容区顶部
  const pos = await js(`getComputedStyle(document.querySelector('.reader-topbar')).position`);
  await js(`(() => { const m = document.querySelector('.main'); if (m) m.scrollTop = 900; })()`); await sleep(600);
  const scrolled = await js(`(document.querySelector('.main') || {}).scrollTop || 0`);
  const topAfter = await js(`Math.round(document.querySelector('.reader-topbar').getBoundingClientRect().top)`);
  check('顶栏常驻（下翻后仍可点）', pos === 'sticky' && scrolled > 500 && topAfter >= 0 && topAfter <= 60, `position=${pos} 已滚动 ${scrolled}px 顶栏 top=${topAfter}`);
  await js(`(() => { const m = document.querySelector('.main'); if (m) m.scrollTop = 0; })()`); await sleep(400);

  // ⑥ 逐句对照：译文逐句插在原文下方；点句子切换中/英文
  const trOk = await clickText('逐句对照', '.tb-modes button');
  await sleep(900);
  const rows = await js(`document.querySelectorAll('.bi-row').length`);
  const zh0 = await visZh();
  check('逐句对照：译文逐句插入', trOk && rows >= 5 && zh0 >= 5, `句子 ${rows} 行 / 可见译文 ${zh0} 条`);
  await js(`(() => { const el = document.querySelector('.bi-row'); if (el) el.click(); return !!el; })()`);
  await sleep(500);
  const zh1 = await visZh();
  check('点击句子可切换中/英文', zh1 === zh0 - 1, `切换后可见译文 ${zh1} 条`);

  // ⑦ 对照背诵：点「下一句」逐句呈现译文
  await clickText('对照背诵', '.tb-modes button');
  await sleep(900);
  const z0 = await visZh();
  const nextStep = async () => { await clickText('下一句', '.bi-actions button'); await sleep(500); return visZh(); };
  const z1 = await nextStep();
  const z2 = await nextStep();
  check('对照背诵：下一句逐句呈现译文', z0 === 0 && z1 === 1 && z2 === 2, `初始 ${z0} → ${z1} → ${z2}`);

  // ⑧ 左右分栏：题目与原文同时在左右两侧
  await clickText('左右', '.tb-modes button');
  await sleep(900);
  const splitOk = await js(`(() => { const q = document.querySelector('.question-pane .qpanel'); const inPassage = document.querySelector('.passage-pane .qpanel'); return !!q && !inPassage; })()`);
  check('左右分栏：题目与原文并排', splitOk === true, '题目面板移入右侧栏');
  await clickText('上下', '.tb-modes button');
  await sleep(500);

  // ⑨ 重做本套必须真正清空作答记录
  // 历史 bug：attempt:clear 只删 user_answer、不删 attempt → 重做后 attempt 残留，
  // 再进阅读器被判定「已交卷」→ 答案锁死、解析强制显示（即用户反馈的「作答不了」）
  await js(`window.keeper.attemptSubmit(${anchor.id}, {})`); await sleep(400);
  const g1 = await js(`(async () => { const r = await window.keeper.attemptGet(${anchor.id}); return !!r.attempt; })()`);
  const cl = await js(`window.keeper.attemptClear(${anchor.id})`); await sleep(300);
  const g2 = await js(`(async () => { const r = await window.keeper.attemptGet(${anchor.id}); return !!r.attempt; })()`);
  check('重做本套真正清空作答记录', g1 === true && cl.ok === true && cl.cleared >= 1 && g2 === false, `交卷后 attempt=${g1} / 清理后 attempt=${g2} / cleared=${cl.cleared}`);
}

// ===== 数据完整性断言（把历史上踩过的坑固化为闸门）=====
// 这些坑都真实出现过：词库字母错位/缺词、选项空占位、答案字母不在词库内、翻译正文被答案页污染。
// 直接读 seed + 覆盖层（不依赖 UI），任何一类回归都会立刻失败。
{
const dRootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dSeedDir = path.join(dRootDir, 'data', 'seed');
const dOvDir = path.join(dRootDir, 'data', 'ai-answers');
const bankBad = [], optBad = [], refBad = [], pollBad = [], ansOutOfBank = [];
let seedCount = 0, qCount = 0, ansCount = 0, ansMissing = 0;
for (const f of fs.readdirSync(dSeedDir).filter((x) => x.endsWith('.json'))) {
  const key = f.replace('.json', '');
  const s = JSON.parse(fs.readFileSync(path.join(dSeedDir, f), 'utf8'));
  seedCount++;
  const ovPath = path.join(dOvDir, key + '.json');
  const ov = fs.existsSync(ovPath) ? JSON.parse(fs.readFileSync(ovPath, 'utf8')) : null;
  for (const p of s.passages || []) {
    for (const q of p.questions || []) {
      qCount++;
      if ((q.options || []).some((o) => String(o).trim().length <= 3)) optBad.push(key + '/' + p.section + '#' + p.seq);
    }
    if (p.section === 'translation' && /参考答案|作文范文|Part\s*[ⅠⅡⅢⅣIVX]/.test(p.content || '')) pollBad.push(key);
    if (p.section === 'cloze' && (p.questions || []).length) {
      const opts = p.questions[0].options || [];
      const letters = opts.map((o) => (String(o).match(/^([A-O])\)/) || [])[1]).join('');
      if (opts.length !== 15 || letters !== 'ABCDEFGHIJKLMNO') bankBad.push(key + ':' + opts.length);
    }
    const e = ov && (ov.passages || []).find((x) => x.section === p.section && x.seq === p.seq);
    if (!e) continue;
    if ((p.questions || []).length) {
      const bank = p.section === 'cloze' && p.questions[0].options
        ? p.questions[0].options.map((o) => (String(o).match(/^([A-O])\)/) || [])[1]).filter(Boolean) : null;
      e.questions.forEach((qq, i) => {
        ansCount++;
        if (!qq.answer || !(qq.analysis || '').length) ansMissing++;
        if (bank && qq.answer && !bank.includes(qq.answer)) ansOutOfBank.push(key + '/' + (p.questions[i] ? p.questions[i].stem : i + 1));
      });
    }
    if (e.translation && e.translation.length < 80) refBad.push(key + '/' + p.section + '#' + p.seq);
    if (e.reference && e.reference.length < 80) refBad.push(key + '/' + p.section + '#' + p.seq);
  }
}
check('数据完整性·词库为 15 词 A-O', bankBad.length === 0, bankBad.slice(0, 3).join('、') || `${seedCount} 套全部合规`);
check('数据完整性·无空占位选项', optBad.length === 0, optBad.slice(0, 3).join('、') || `${qCount} 题全部有选项文本`);
check('数据完整性·答案与解析齐全', ansMissing === 0, ansMissing ? `${ansMissing}/${ansCount} 题缺答案或解析` : `${ansCount} 题齐全`);
check('数据完整性·cloze 答案在词库内', ansOutOfBank.length === 0, ansOutOfBank.slice(0, 3).join('、') || '全部命中');
check('数据完整性·翻译/范文非空且达标', refBad.length === 0, refBad.slice(0, 3).join('、') || '全部达标');
check('数据完整性·翻译正文无答案页污染', pollBad.length === 0, pollBad.slice(0, 3).join('、') || seedCount + ' 套干净');
}

const fail = results.filter((r) => !r.ok);
console.log(`\n===== 结果：${results.length - fail.length}/${results.length} 通过 =====`);
if (fail.length) { console.log('失败项:', fail.map((f) => f.name).join('、')); process.exit(1); }
ws.close();
process.exit(0);

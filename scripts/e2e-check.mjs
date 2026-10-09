// 端到端验证：通过 CDP 连接运行中的应用，走通 查词→标注→生词本→复习 全链路
// 前置：应用需以 --remote-debugging-port=9222 启动
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
// 下限用 70 而不是精确值，既能抓住明显的旧包，又不会因为补考次而频繁改动测试。
check('数据为最新版（非旧包）', exams.length >= 70 && exams.some((e) => e.year >= 2025),
  exams.length + ' 套，最新 ' + exams[0].title);
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
const fs = await import('node:fs');
const path = await import('node:path');
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

// 未配置 AI 时，交卷必须明确返回 no_key，而不是静默失败
const subNoKey = await js(`window.keeper.attemptSubmit(${anchor.id}, {})`);
check('未配置 AI 时交卷优雅降级', subNoKey.ok === false && subNoKey.error === 'no_key', 'error=' + subNoKey.error);

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

const fail = results.filter((r) => !r.ok);
console.log(`\n===== 结果：${results.length - fail.length}/${results.length} 通过 =====`);
if (fail.length) { console.log('失败项:', fail.map((f) => f.name).join('、')); process.exit(1); }
ws.close();
process.exit(0);

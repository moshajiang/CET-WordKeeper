const createPageAssistant = require('./lib/load-page-assistant.cjs');
const createAiTasks = require('./lib/load-ai-tasks.cjs')(__dirname);
// 定向回归：原主进程代码在内存 DB 上运行，所有写盘均拦截，不读取真实用户库。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const dependencies = process.env.KEEPER_DEPENDENCY_ROOT || root;
const req = createRequire(path.join(dependencies, 'package.json'));
const source = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log(`✓ ${name}`); };

(async () => {
  const SQL = await req('sql.js')({ locateFile: f => path.join(dependencies, 'node_modules/sql.js/dist', f) });
  function harness({ lock = true } = {}) {
    const handlers = new Map(), events = new Map();
    let readyCalls = 0, quitCalls = 0, writes = 0, failWrite = false;
    const context = vm.createContext({createAiTasks,createPageAssistant,
      require(name) {
        if (name === 'electron') return {
          app: { disableHardwareAcceleration() {}, setPath() {}, requestSingleInstanceLock: () => lock,
            quit() { quitCalls++; }, on: (event, callback) => events.set(event, callback),
            whenReady() { readyCalls++; return { then() {} }; } },
          ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, dialog: {}, shell: {}, BrowserWindow: class {}
        };
        if (name === 'electron-updater') return { autoUpdater: { on() {} } };
        if (name === 'fs') return { ...fs, writeFileSync() { if (failWrite) throw new Error('disk full'); writes++; }, renameSync() {} };
        return name.startsWith('./') ? req(path.join(fs.existsSync(path.join(root, 'electron', name)) ? root : dependencies, 'electron', name)) : req(name);
      },
      __dirname: path.join(root, 'electron'), process: { env: {}, platform: 'win32' }, Buffer, Date,
      console: { log() {}, error() {} },
      fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"score":12,"band":"良好","strengths":"表达清楚","issues":[],"improved":"An improved fixture essay."}' } }] }) })
    });
    vm.runInContext(source + '\nglobalThis.audit = { setup(SQL) {sqlModule=SQL; db=new SQL.Database(); db.run(SCHEMA); migrate(); buildFormIndex(); dbPath="memory.db"; registerIpc();}, q, run, setWin(value){win=value;} };', context);
    if (lock) context.audit.setup(SQL);
    return { ...context.audit, events, context, call: (name, ...args) => handlers.get(name)(null, ...args),
      get readyCalls() { return readyCalls; }, get quitCalls() { return quitCalls; }, get writes() { return writes; },
      set failWrite(value) { failWrite = value; } };
  }
  const valid = () => ({ level: 'CET6', year: 2091, passages: [{ section: 'reading', content: 'A valid article.', questions: [{ stem: '46', options: ['A) yes', 'B) no'], answer: 'A' }] }] });
  await test('第二实例在初始化数据库之前退出；首实例聚焦现有窗口', () => {
    const second = harness({ lock: false });
    assert.equal(second.readyCalls, 0); assert.equal(second.quitCalls, 1);
    const first = harness(); const calls = [];
    first.setWin({ isDestroyed: () => false, isMinimized: () => true, restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus') });
    first.events.get('second-instance')(); assert.deepEqual(calls, ['restore', 'show', 'focus']);
  });
  await test('坏 JSON 结构不留半套题，修正后可以重新导入', () => {
    const h = harness(), bad = valid(); bad.passages.push(null);
    assert.equal(h.call('import:exam', bad).ok, false);
    assert.equal(h.q('SELECT COUNT(*) n FROM exam')[0].n, 0);
    assert.equal(h.call('import:exam', valid()).ok, true);
    assert.equal(h.q('SELECT COUNT(*) n FROM question')[0].n, 1);
    const writes = h.writes;
    assert.equal(h.call('import:exam', valid()).error, 'duplicate'); assert.equal(h.writes, writes);
  });
  await test('题目写入中途失败时，exam/passage/question 和原词频一起回滚', () => {
    const h = harness(); h.run("INSERT INTO word_freq VALUES ('original', 3, 1)");
    h.run("CREATE TRIGGER reject_question BEFORE INSERT ON question BEGIN SELECT RAISE(ABORT,'test failure'); END");
    assert.equal(h.call('import:exam', valid()).ok, false);
    for (const table of ['exam', 'passage', 'question']) assert.equal(h.q(`SELECT COUNT(*) n FROM ${table}`)[0].n, 0);
    assert.equal(h.q('SELECT total FROM word_freq')[0].total, 3); assert.equal(h.writes, 0);
  });
  await test('导出写盘失败时恢复内存快照，后续保存不会夹带失败导入', () => {
    const h = harness(); h.failWrite = true;
    assert.match(h.call('import:exam', valid()).error, /disk full/);
    assert.equal(h.q('SELECT COUNT(*) n FROM exam')[0].n, 0);
    h.failWrite = false; assert.equal(h.call('import:exam', valid()).ok, true);
  });
  await test('导入拒绝无效月份、非数组选项和超限载荷', () => {
    const h = harness(), badMonth = valid(), badOptions = valid(), tooLarge = valid();
    badMonth.month = 13; badOptions.passages[0].questions[0].options = {}; tooLarge.passages[0].content = 'x'.repeat(500001);
    for (const payload of [null, [], badMonth, badOptions, tooLarge]) assert.equal(h.call('import:exam', payload).ok, false);
    assert.equal(h.q('SELECT COUNT(*) n FROM exam')[0].n, 0);
  });
  await test('修改草稿清除旧评分，保存相同内容保留评分', () => {
    const h = harness(); h.call('essay:save', 1, 'writing', 'draft A'); h.run('UPDATE essay SET result=?', ['{"score":12,"band":"良好","strengths":"表达清楚","issues":[],"improved":"An improved fixture essay."}']);
    h.call('essay:save', 1, 'writing', 'draft A'); assert.ok(h.call('essay:get', 1, 'writing').result);
    h.call('essay:save', 1, 'writing', 'draft B'); assert.equal(h.call('essay:get', 1, 'writing').result, null);
  });
  await test('在途批改返回后不能给已经修改的草稿写旧评分', async () => {
    const h = harness(); let resolve;
    h.call('settings:set', { api_base: 'https://example.invalid', api_key: 'test-only' });
    h.call('essay:save', 1, 'writing', 'Draft A contains enough text for the grading request.');
    h.context.fetch = () => new Promise(done => { resolve = done; });
    const request = h.call('essay:grade', 1, 'writing');
    h.call('essay:save', 1, 'writing', 'Draft B contains different text after another edit.');
    resolve({ ok: true, json: async () => ({ choices: [{ message: { content: '{"score":12,"band":"良好","strengths":"表达清楚","issues":[],"improved":"An improved fixture essay."}' } }] }) });
    assert.equal((await request).error, 'stale_draft'); assert.equal(h.call('essay:get', 1, 'writing').result, null);
  });

  const { createEssayDrafts } = await import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(root, 'src/utils/essay-drafts.js'), 'utf8')));
  const storage = () => { const data = new Map(); return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; };
  const fakeTimers = { setTimer: () => 1, clearTimer() {} };
  await test('不同章节的待存草稿分别捕获身份，切换后也不会漏存或串写', async () => {
    const saved = [], store = storage();
    const drafts = createEssayDrafts({ storage: store, ...fakeTimers, save: async (...args) => { saved.push(args); return { ok: true }; } });
    drafts.schedule({ examId: 1, section: 'writing', content: 'A' });
    drafts.schedule({ examId: 2, section: 'translation', content: '' });
    assert.equal(await drafts.flush(), true);
    assert.deepEqual(saved, [[1, 'writing', 'A'], [2, 'translation', '']]);
    assert.equal(drafts.recover({ examId: 1, section: 'writing' }), null);
  });
  await test('关闭前未写盘的草稿可恢复，空草稿也能恢复', () => {
    const store = storage(), target = { examId: 1, section: 'writing', content: '' };
    const drafts = createEssayDrafts({ storage: store, ...fakeTimers, save: async () => ({ ok: true }) });
    drafts.schedule(target);
    const reopened = createEssayDrafts({ storage: store, ...fakeTimers, save: async () => ({ ok: true }) });
    assert.deepEqual(reopened.recover(target), target);
  });
  await test('旧保存失败不能重新排队覆盖已经提交的新编辑', async () => {
    const store = storage(), saved = []; let rejectOld;
    const drafts = createEssayDrafts({ storage: store, ...fakeTimers, save: (_id, _section, content) => {
      if (content === 'old') return new Promise((_resolve, reject) => { rejectOld = reject; });
      saved.push(content); return Promise.resolve({ ok: true });
    } });
    drafts.schedule({ examId: 1, section: 'writing', content: 'old' }); const first = drafts.flush();
    await Promise.resolve();
    drafts.schedule({ examId: 1, section: 'writing', content: 'new' }); const second = drafts.flush();
    rejectOld(new Error('disk full')); assert.equal(await first, false); assert.equal(await second, true);
    await drafts.flush(); assert.deepEqual(saved, ['new']);
  });

  const { createAnswerDrafts } = await import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(root, 'src/utils/answer-drafts.js'), 'utf8')));
  const Vue = req('vue');
  const tokens = await import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(dependencies, 'src/utils/tokens.js'), 'utf8')));
  const bilingualPath = fs.existsSync(path.join(root, 'src/utils/bilingual.js')) ? path.join(root, 'src/utils/bilingual.js') : path.join(dependencies, 'src/utils/bilingual.js');
  const bilingual = await import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(bilingualPath, 'utf8')));
  const lexSource = fs.readFileSync(path.join(root, 'src/composables/useAlignmentLex.js'), 'utf8').replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
  const useAlignmentLex = vm.runInNewContext(lexSource + '\nuseAlignmentLex;', { shallowRef: Vue.shallowRef });
  const lemmaSource = fs.readFileSync(path.join(root,'src/composables/useWordLemmas.js'),'utf8').replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
  const useWordLemmas = vm.runInNewContext(lemmaSource+'\nuseWordLemmas;', { shallowRef:Vue.shallowRef });
  function readerHarness(keeper) {
    const stops = [];
    const script = fs.readFileSync(path.join(root, 'src/views/ReaderView.vue'), 'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?$/gm, '').replace('const pageAssistant = usePageAssistant();', 'const pageAssistant = createPageAssistant({getApi:()=>window.keeper});');
    const context = vm.createContext({createAiTasks,createPageAssistant, ...Vue, ...tokens, ...bilingual, createAnswerDrafts, useWordLemmas, localStorage: storage(),
      watch(...args) { const stop = Vue.watch(...args); stops.push(stop); return stop; },
      onMounted() {}, onBeforeUnmount() {}, onBeforeRouteLeave() {}, onBeforeRouteUpdate() {},
      defineProps: () => ({ examId: '1' }), useRouter: () => ({ push() {} }), window: { keeper }, renderMarkdown: String,
      document: { querySelector: () => null }, setTimeout: () => 1, clearTimeout() {},
      createEssayDrafts: options => createEssayDrafts({ ...options, ...fakeTimers }),
      useAlignmentLex: () => useAlignmentLex(async () => ({}))
    });
    vm.runInContext(script + '\nglobalThis.reader={ detail, activeIdx, essayText, essayLoading, essayNotice, loadEssay, essayDrafts, restoreAttempt, answers, graded, result, notice };', context);
    context.reader.detail.value = { passages: [{ id: 1, section: 'writing' }, { id: 2, section: 'translation' }, { id: 3, section: 'reading' }] };
    return { ...context.reader, stop: () => stops.forEach(stop => stop()) };
  }
  const tick = () => new Promise(resolve => setImmediate(resolve));
  await test('题目更新后阅读器提示历史成绩已保留，并解除旧成绩锁定', async () => {
    const reader = readerHarness({ attemptGet: async () => ({ contentChanged: true, answers: [{ question_id: 46, choice: 'Z' }], attempt: { total: 3, score: 0 } }) });
    try {
      await reader.restoreAttempt(); assert.equal(reader.graded.value, false); assert.equal(reader.result.value, null);
      assert.equal(Object.keys(reader.answers.value).length, 0); assert.match(reader.notice.value, /历史交卷和作答已保留/);
    } finally { reader.stop(); }
  });
  await test('真实阅读器脚本切章节前保存编辑，不把加载内容当成编辑写回', async () => {
    const saved = [];
    const reader = readerHarness({ essayGet: async () => ({ content: 'Existing draft', result: null }), essaySave: async (...args) => { saved.push(args); return { ok: true }; } });
    try {
      await reader.loadEssay(); assert.equal(saved.length, 0);
      reader.essayText.value = 'Edited draft'; reader.activeIdx.value = 2;
      await Vue.nextTick(); await tick();
      assert.deepEqual(saved, [[1, 'writing', 'Edited draft']]);
    } finally { await reader.essayDrafts.flush(); reader.stop(); }
  });
  await test('阅读器忽略已经离开章节的迟到加载结果', async () => {
    const requests = new Map();
    const reader = readerHarness({ essayGet: (_id, section) => new Promise(resolve => requests.set(section, resolve)), essaySave: async () => ({ ok: true }) });
    try {
      const first = reader.loadEssay(); await tick(); reader.activeIdx.value = 1;
      await Vue.nextTick(); await tick();
      requests.get('translation')({ content: 'Translation draft' }); await tick();
      requests.get('writing')({ content: 'Late writing draft' }); await first;
      assert.equal(reader.essayText.value, 'Translation draft'); assert.equal(reader.essayLoading.value, false);
    } finally { await reader.essayDrafts.flush(); reader.stop(); }
  });
  await test('旧章节加载失败不会污染当前章节的提示', async () => {
    let rejectWriting;
    const reader = readerHarness({ essayGet: (_id, section) => section === 'writing'
      ? new Promise((_resolve, reject) => { rejectWriting = reject; }) : Promise.resolve({ content: 'Translation draft' }),
      essaySave: async () => ({ ok: true }) });
    try {
      const first = reader.loadEssay(); await tick(); reader.activeIdx.value = 1;
      await Vue.nextTick(); await tick(); rejectWriting(new Error('late failure')); await first;
      assert.equal(reader.essayText.value, 'Translation draft'); assert.equal(reader.essayNotice.value, '');
    } finally { await reader.essayDrafts.flush(); reader.stop(); }
  });

  const helper = await import(pathToFileURL(path.join(root, 'scripts/lib/test-session.mjs')));
  await test('同步/整体验证使用独占临时目录，清理不接受错误所有权', () => {
    const a = helper.createTestSession('unit'), b = helper.createTestSession('unit');
    try {
      assert.notEqual(a.dir, b.dir); assert.equal(a.env.KEEPER_USER_DATA, a.dir);
      assert.equal(a.env.ELECTRON_RUN_AS_NODE, undefined);
      const marker = path.join(a.dir, '.keeper-test-session'), original = fs.readFileSync(marker);
      fs.writeFileSync(marker, 'not-owner'); assert.throws(() => a.cleanup(), /unowned/); fs.writeFileSync(marker, original);
    } finally { a.cleanup(); b.cleanup(); }
    assert.equal(fs.existsSync(a.dir), false); assert.equal(fs.existsSync(b.dir), false);
  });
  await test('启动失败立即报告，不再吞错误固定等待 45 秒', async () => {
    const { EventEmitter } = require('node:events'); const child = new EventEmitter(); child.exitCode = 1;
    await assert.rejects(helper.waitForPage(1, child), /提前退出/);
  });
  console.log(`\n数据安全回归：${passed}/${passed} 通过`);
})().catch(error => { console.error(error); process.exitCode = 1; });

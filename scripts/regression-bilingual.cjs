const createPageAssistant = require('./lib/load-page-assistant.cjs');
const createAiTasks = require('./lib/load-ai-tasks.cjs')(__dirname);
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), dependencies = process.env.KEEPER_DEPENDENCY_ROOT || root;
const requireDependency = createRequire(path.join(dependencies, 'package.json'));
let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log(`✓ ${name}`); };
const moduleFrom = file => import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(root, file), 'utf8')));

(async () => {
  const bilingual = await moduleFrom('src/utils/bilingual.js');
  const { alignBilingual, stripParagraphMarkers, paragraphLetters, blankNumbers, clozeWords, fillClozeText } = bilingual;
  const compact = value => String(value).replace(/\s/g, '');
  const assertConserved = (en, zh, rows) => {
    assert.equal(compact(rows.map(row => row.en).join('')), compact(en));
    assert.equal(compact(rows.map(row => row.zh).join('')), compact(zh));
  };
  await test('普通英文首字母、代词和标题保持原样', () => {
    for (const text of ['Are these correct?', 'How to Eat Well', 'I believe in science.', 'Joy: A Subject Schools Lack', 'Better days.', 'No escape as snow falls']) assert.equal(stripParagraphMarkers(text), text);
  });
  await test('只删除明确的段落标记，兼容全角括号和无空格格式', () => {
    for (const marker of ['A)', '[A]', 'A）', 'A.', 'A．', 'A、']) assert.equal(stripParagraphMarkers(marker + 'Apple trees.'), 'Apple trees.');
    assert.equal(stripParagraphMarkers('A) First paragraph.\nI believe it.\nB）Second paragraph.'), 'First paragraph.\nI believe it.\nSecond paragraph.');
    assert.equal(stripParagraphMarkers('P) Outside marker range.'), 'P) Outside marker range.');
    assert.deepEqual(paragraphLetters('[A]First\nB）Second\nC.Third\nD)Fourth'), ['A', 'B', 'C', 'D']);
    assert.deepEqual(paragraphLetters('A person lives here.\nB people live there.'), []);
  });
  await test('空号来自本篇题目，支持 36–45、下划线和紧贴单词', () => {
    const passage = { section: 'cloze', content: 'He chose __36__ over 37stress in 2036, but 38 _reduces costs.', questions: [
      { stem: '36', answer: 'A', options: ['A) clarity'] }, { stem: '37', answer: 'B', options: '["B）lasting"]' }, { stem: '38', answer: 'C', options: ['C. sharply'] }
    ] };
    assert.deepEqual([...blankNumbers(passage)], [36, 37, 38]);
    assert.equal(fillClozeText(passage.content, clozeWords(passage)), 'He chose clarity over lasting stress in 2036, but sharply reduces costs.');
    assert.deepEqual([...blankNumbers({ ...passage, section: 'reading' })], []);
  });
  await test('歧义数字和未作答空号保持原文，不误补答案', () => {
    assert.equal(fillClozeText('Age 36 and blank 36.', new Map([[36, 'word']])), 'Age 36 and blank 36.');
    const passage = { section: 'cloze', questions: [{ stem: '26', answer: '', options: ['A) word'] }] };
    assert.equal(clozeWords(passage).size, 0);
    assert.equal(fillClozeText('2036 and 36stress.', new Map([[36, 'lasting']])), '2036 and lasting stress.');
  });
  const enFixture = 'Apples Apples Apples. Birds Birds Birds.';
  const zhFixture = '甲甲甲甲甲甲。乙乙乙乙乙乙。丙丙丙丙丙丙。';
  const lexFixture = { apples: ['乙'], birds: ['丙'] };
  await test('词典中文确实改变 DP 配对，关闭词典时结果不同', () => {
    const plain = alignBilingual(enFixture, zhFixture);
    const scored = alignBilingual(enFixture, zhFixture, lexFixture);
    assert.notDeepEqual(scored, plain);
    assert.equal(plain[0].zh, '甲甲甲甲甲甲。');
    assert.equal(scored[0].zh, '甲甲甲甲甲甲。乙乙乙乙乙乙。');
    assert.equal(scored[1].zh, '丙丙丙丙丙丙。');
    assertConserved(enFixture, zhFixture, scored);
  });
  await test('未收录 constructor 或损坏的词典候选不会令自导入对齐崩溃', () => {
    const en = 'A constructor builds a new object. Apples grow on tall trees.';
    const zh = '构造函数创建一个新对象。苹果生长在高大的树上。';
    assertConserved(en, zh, alignBilingual(en, zh, {}));
    assertConserved(en, zh, alignBilingual(en, zh, { apples: { invalid: true }, trees: [null, 1, '树'] }));
  });
  await test('重复 A 标题只配一次译文；缩写 U.N. 和人名 J. 不拆段落', () => {
    const en = 'A) A heading\nA) The U.N. report quotes J. Smith.\nB) Second paragraph.\nC) Third paragraph.\nD) Fourth paragraph.';
    const zh = '[A] 第一段正文。\n[B] 第二段正文。\n[C] 第三段正文。\n[D] 第四段正文。';
    const rows = alignBilingual(en, zh);
    assert.equal(rows.length, 4); assert.equal(rows[0].zh, '[A] 第一段正文。'); assertConserved(en, zh, rows);
  });
  await test('行内译文标记、全角标记按字母匹配，双侧文本不重复不遗漏', () => {
    const en = 'A）Apple paragraph.\nB）Bird paragraph.\nC）Cat paragraph.\nD）Dog paragraph.';
    const zh = 'A)苹果段落。 B)鸟类段落。 C)猫咪段落。 D)小狗段落。';
    const rows = alignBilingual(en, zh);
    assert.equal(rows.length, 4); assert.equal(rows[2].zh, 'C)猫咪段落。'); assertConserved(en, zh, rows);
  });
  await test('译文存在未匹配段落时回退，不能静默丢掉尾段', () => {
    const en = 'A) Apple paragraph.\nB) Bird paragraph.\nC) Cat paragraph.\nD) Dog paragraph.';
    const zh = '[A] 苹果段落。\n[B] 鸟类段落。\n[C] 猫咪段落。\n[D] 小狗段落。\n[E] 必须保留的额外尾段。';
    assertConserved(en, zh, alignBilingual(en, zh));
  });

  const Vue = requireDependency('vue');
  const lexSource = fs.readFileSync(path.join(root, 'src/composables/useAlignmentLex.js'), 'utf8').replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
  const useAlignmentLex = vm.runInNewContext(lexSource + '\nuseAlignmentLex;', { shallowRef: Vue.shallowRef });
  await test('异步词典就绪会重新计算，重复调用只发一次 IPC', async () => {
    let resolve, calls = 0;
    const state = useAlignmentLex(() => { calls++; return new Promise(done => { resolve = done; }); });
    const rows = Vue.computed(() => alignBilingual(enFixture, zhFixture, state.lex.value));
    const before = rows.value;
    const first = state.ensureLex(), second = state.ensureLex(); assert.equal(first, second);
    await Promise.resolve(); resolve(lexFixture); await first;
    assert.equal(calls, 1); assert.notDeepEqual(rows.value, before);
    await state.ensureLex(); assert.equal(calls, 1);
  });
  await test('词典加载失败后允许重试，不永久缓存空结果', async () => {
    let calls = 0;
    const state = useAlignmentLex(async () => { if (++calls === 1) throw new Error('IPC unavailable'); return lexFixture; });
    assert.equal(await state.ensureLex(), null); assert.equal(state.lex.value, null);
    assert.equal(await state.ensureLex(), lexFixture); assert.equal(calls, 2);
  });

  const tokensPath = path.join(dependencies, 'src/utils/tokens.js');
  const tokens = await import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(tokensPath, 'utf8')));
  const draftsPath = fs.existsSync(path.join(root, 'src/utils/essay-drafts.js')) ? path.join(root, 'src/utils/essay-drafts.js') : path.join(dependencies, 'src/utils/essay-drafts.js');
  const { createEssayDrafts } = await import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(draftsPath, 'utf8')));
  const { createAnswerDrafts } = await import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(root, 'src/utils/answer-drafts.js'), 'utf8')));
  const lemmaSource = fs.readFileSync(path.join(root,'src/composables/useWordLemmas.js'),'utf8').replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
  const useWordLemmas = vm.runInNewContext(lemmaSource+'\nuseWordLemmas;', { shallowRef:Vue.shallowRef });
  function view(file, exports, load = async () => ({})) {
    const script = fs.readFileSync(path.join(root, 'src/views', file), 'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?$/gm, '').replace('const pageAssistant = usePageAssistant();', 'const pageAssistant = createPageAssistant({getApi:()=>window.keeper});');
    const context = vm.createContext({createAiTasks,createPageAssistant, ...Vue, ...tokens, ...bilingual, useWordLemmas, createEssayDrafts, createAnswerDrafts,
      useAlignmentLex: () => useAlignmentLex(load), onMounted() {}, onBeforeUnmount() {},
      watch() {}, onBeforeRouteLeave() {}, onBeforeRouteUpdate() {},
      defineProps: () => ({ examId: '1' }), useRouter: () => ({ push() {} }),
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, window: { keeper: {} }, renderMarkdown: String,
      setTimeout: () => 1, clearTimeout() {}, document: { querySelector: () => null }
    });
    vm.runInContext(script + '\nglobalThis.view={' + exports + '};', context);
    return context.view;
  }
  await test('阅读器切换相同 para/i 的篇章后显示新英文，不复用旧 token', () => {
    const reader = view('ReaderView.vue', 'detail, activeIdx, bilingual, rowTokens');
    reader.detail.value = { passages: [{ id: 1, rows: [{ para: 0, en: 'Alpha passage.', zh: '甲。' }] }, { id: 2, rows: [{ para: 0, en: 'Different article.', zh: '乙。' }] }] };
    assert.equal(reader.rowTokens(reader.bilingual.value[0]).map(t => t.text).join(''), 'Alpha passage.');
    reader.activeIdx.value = 1;
    assert.equal(reader.rowTokens(reader.bilingual.value[0]).map(t => t.text).join(''), 'Different article.');
  });
  await test('阅读器和背诵页的实际 computed 均响应词典就绪', async () => {
    for (const [file, result] of [['ReaderView.vue', 'bilingual'], ['ReciteView.vue', 'items']]) {
      let resolve;
      const page = view(file, `detail, ${result}, ensureLex`, () => new Promise(done => { resolve = done; }));
      page.detail.value = { passages: [{ id: 1, section: 'reading', seq: 1, content: enFixture, translation: zhFixture, questions: [] }] };
      const read = () => result === 'items' ? page.items.value[0].rows : page.bilingual.value;
      const before = read(); const loading = page.ensureLex(); await Promise.resolve(); resolve(lexFixture); await loading;
      assert.notDeepEqual(read(), before);
    }
  });

  const SQL = await requireDependency('sql.js')({ locateFile: file => path.join(dependencies, 'node_modules/sql.js/dist', file) });
  const databasePath = process.env.KEEPER_ALIGNMENT_DB || path.join(fs.existsSync(path.join(root, 'data/keeper.db')) ? root : dependencies, 'data/keeper.db');
  const db = new SQL.Database(fs.readFileSync(databasePath));
  const query = sql => { const statement = db.prepare(sql); const rows = []; try { while (statement.step()) rows.push(statement.getAsObject()); return rows; } finally { statement.free(); } };
  const passages = query("SELECT * FROM passage WHERE translation IS NOT NULL AND translation != ''");
  await test('全库预置 rows 的英文和中文逐字符保真，既不多也不少', () => {
    assert.ok(passages.length > 0);
    for (const passage of passages) assertConserved(passage.content, passage.translation, JSON.parse(passage.rows));
  });
  await test('全库背诵展示转换只删除明确标记，保留普通英文首字母', () => {
    const recite = view('ReciteView.vue', 'detail, items');
    for (const passage of passages.filter(p => p.section === 'match')) {
      recite.detail.value = { passages: [{ ...passage, rows: JSON.parse(passage.rows) }] };
      const rows = recite.items.value[0].rows, original = JSON.parse(passage.rows);
      assert.equal(rows.length, original.length);
      for (let index = 0; index < rows.length; index++) assert.equal(rows[index].en, stripParagraphMarkers(original[index].en));
    }
  });
  db.close();
  console.log(`\n双语显示/对齐回归：${passed}/${passed} 通过；全库 ${passages.length} 篇已检查。`);
})().catch(error => { console.error(error); process.exitCode = 1; });

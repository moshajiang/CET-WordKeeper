// 构建种子数据库: ECDICT 裁剪 + 真题 JSON -> data/keeper.db
// 用法: node --max-old-space-size=8192 scripts/build-db.mjs
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDbPath = path.join(root, 'data', 'raw', 'ecdict-sqlite', 'stardict.db');
const seedDir = path.join(root, 'data', 'seed');
const outPath = path.join(root, 'data', 'keeper.db');

// 与主进程 resolveWord 共用的兜底词形映射，保证词频归并与查词行为一致
const WORD_FORMS = JSON.parse(fs.readFileSync(path.join(root, 'electron', 'word-forms.json'), 'utf8'));
const EXTRA_FORMS = {
  ...WORD_FORMS.irregular_verbs,
  ...WORD_FORMS.irregular_plurals,
  ...WORD_FORMS.contractions,
};

const SQL = await initSqlJs({
  locateFile: (f) => path.join(root, 'node_modules', 'sql.js', 'dist', f),
});

console.log('加载 ECDICT 源库（812MB，需要一些时间）…');
const t0 = Date.now();
const src = new SQL.Database(fs.readFileSync(srcDbPath));
console.log('源库加载完成', ((Date.now() - t0) / 1000).toFixed(0) + 's');

const tables = [];
src.each('SELECT name FROM sqlite_master WHERE type="table"', (r) => tables.push(r.name));
console.log('源表:', tables.join(', '));
const mainTable = tables.includes('stardict') ? 'stardict' : tables[0];

const db = new SQL.Database();
db.run(`
CREATE TABLE exam(id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT, year INTEGER, month INTEGER,
  set_no INTEGER, title TEXT, imported INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE passage(id INTEGER PRIMARY KEY AUTOINCREMENT, exam_id INTEGER, section TEXT,
  seq INTEGER, title TEXT, content TEXT, translation TEXT, reference TEXT);
CREATE TABLE question(id INTEGER PRIMARY KEY AUTOINCREMENT, passage_id INTEGER, qtype TEXT,
  stem TEXT, options TEXT, answer TEXT, analysis TEXT);
CREATE TABLE dict(word TEXT PRIMARY KEY, phonetic TEXT, translation TEXT, definition TEXT,
  tag TEXT, bnc INTEGER, frq INTEGER, exchange TEXT, collins INTEGER, oxford INTEGER);
CREATE TABLE user_word(id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE, status TEXT DEFAULT 'learning',
  note TEXT DEFAULT '', created_at TEXT, mastered_at TEXT,
  interval_days REAL DEFAULT 0, ease REAL DEFAULT 2.5, reps INTEGER DEFAULT 0,
  lapses INTEGER DEFAULT 0, due TEXT);
CREATE TABLE word_hit(id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT, passage_id INTEGER, sentence TEXT);
CREATE TABLE review_log(id INTEGER PRIMARY KEY AUTOINCREMENT, word_id INTEGER, mode TEXT, rating INTEGER,
  reviewed_at TEXT, interval_days REAL, ease REAL, due TEXT);
CREATE TABLE mistake(id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER, user_answer TEXT,
  ai_analysis TEXT, created_at TEXT, redone INTEGER DEFAULT 0);
CREATE TABLE ai_cache(hash TEXT PRIMARY KEY, kind TEXT, response TEXT, created_at TEXT);
CREATE TABLE word_freq(word TEXT PRIMARY KEY, total INTEGER, exams INTEGER);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
`);

// 1. 裁剪词典
console.log('裁剪词典（考纲词 + 高频词）…');
let dictCount = 0;
const ins = db.prepare('INSERT INTO dict VALUES (?,?,?,?,?,?,?,?,?,?)');
const stmt = src.prepare(`
  SELECT word, phonetic, translation, definition, tag, bnc, frq, exchange, collins, oxford
  FROM ${mainTable}
  WHERE tag LIKE '%cet4%' OR tag LIKE '%cet6%' OR tag LIKE '%ky%' OR tag LIKE '%gaozhong%'
     OR tag LIKE '%zhongkao%' OR (bnc > 0 AND bnc <= 25000) OR (frq > 0 AND frq <= 25000)
`);
while (stmt.step()) {
  const r = stmt.getAsObject();
  if (!r.word) continue;
  ins.run([
    String(r.word).toLowerCase(), r.phonetic || '', r.translation || '', r.definition || '',
    r.tag || '', r.bnc || 0, r.frq || 0, r.exchange || '', r.collins || 0, r.oxford || 0,
  ]);
  dictCount++;
}
stmt.free();
ins.free();
console.log('词典词条:', dictCount);
src.close();

// 词形索引：0: 字段是原形指针（最高可信），其余字段是变形列表（反向兜底）
// 提前构建，供后面的「粘连词修补」与「词频归并」共用
const dictWords = new Set();
const formIndex = new Map();
const reverse = new Map();
db.each('SELECT word, exchange FROM dict', (r) => {
  dictWords.add(r.word);
  if (!r.exchange) return;
  const head = String(r.word).toLowerCase();
  for (const part of String(r.exchange).split('/')) {
    const [k, v] = part.split(':');
    if (!v) continue;
    const form = v.toLowerCase();
    if (form === head) continue;
    if (k === '0') formIndex.set(head, form);
    else if (!reverse.has(form)) reverse.set(form, head);
  }
});
for (const [form, head] of reverse) {
  if (!formIndex.has(form)) formIndex.set(form, head);
}

// 源 docx 偶发「两词粘连」（如 ofdigital、thepassage、theirjob）。
// 这类瑕疵与合法复合词（smartphone / chatbot / byproduct）无法通用区分，故只修补高精度子集：
// 以「不可能是复合词前缀」的词开头，且剩余部分恰为词典收录的词。
// 每个前缀带一个最小剩余长度：
//   of    ≥4 —— 否则 "often" 会被切成 "of ten"
//   the   ≥5 —— 排除 "therein"→"the rein" 之类的边缘情况
//   their ≥3 —— "their" 开头除 "theirs" 外无其他英文词，故可放宽
// 全库实测命中 17 处，全部为真瑕疵，无误伤。
const GLUE_PREFIX = [['of', 4], ['the', 5], ['their', 3]];
function healGlued(text) {
  let out = String(text || '');
  for (const [pre, min] of GLUE_PREFIX) {
    out = out.replace(new RegExp('\\b' + pre + '([a-z]{' + min + ',})\\b', 'gi'), (m, rest) => {
      if (dictWords.has((pre + rest).toLowerCase())) return m;   // 整体已是词典词，不动
      return dictWords.has(rest.toLowerCase()) ? pre + ' ' + rest : m;
    });
  }
  return out;
}
let glueFixed = 0;
function healPassage(text) {
  const fixed = healGlued(text);
  if (fixed !== text) glueFixed++;
  return fixed;
}

// 2. 导入真题
// 覆盖层 data/ai-answers/*.json：AI 预生成的答案 / 中文解析 / 全文翻译（由 scripts/gen-answers.mjs 产出）。
// 与 seed JSON 分离，这样重新解析源文档不会覆盖已生成的解析内容。
const aiDir = path.join(root, 'data', 'ai-answers');
const aiOverlay = new Map();
if (fs.existsSync(aiDir)) {
  for (const f of fs.readdirSync(aiDir).filter((x) => x.endsWith('.json'))) {
    try {
      const o = JSON.parse(fs.readFileSync(path.join(aiDir, f), 'utf8'));
      aiOverlay.set(`${o.level}-${o.year}.${String(o.month).padStart(2, '0')}-set${o.set_no}`, o);
    } catch { /* 忽略坏文件 */ }
  }
}
console.log('AI 覆盖层:', aiOverlay.size, '套');

const files = fs.existsSync(seedDir) ? fs.readdirSync(seedDir).filter((f) => f.endsWith('.json')) : [];
let examCount = 0, aiPassages = 0, aiAnswers = 0, aiReferences = 0, aiStemMismatch = 0;
for (const f of files) {
  const data = JSON.parse(fs.readFileSync(path.join(seedDir, f), 'utf8'));
  const ov = aiOverlay.get(`${data.level}-${data.year}.${String(data.month).padStart(2, '0')}-set${data.set_no}`);
  db.run('INSERT INTO exam(level, year, month, set_no, title, imported, created_at) VALUES (?,?,?,?,?,0,?)',
    [data.level, data.year, data.month, data.set_no, data.title || f, new Date().toISOString()]);
  const examId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  for (const p of data.passages || []) {
    const ovP = ov && (ov.passages || []).find((x) => x.section === p.section && x.seq === p.seq);
    db.run('INSERT INTO passage(exam_id, section, seq, title, content, translation, reference) VALUES (?,?,?,?,?,?,?)',
      [examId, p.section, p.seq, p.title, healPassage(p.content), (ovP && ovP.translation) || null, (ovP && ovP.reference) || null]);
    if (ovP && ovP.translation) aiPassages++;
    if (ovP && ovP.reference) aiReferences++;
    const pid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    const qlist = p.questions || [];
    qlist.forEach((qs, qi) => {
      const opts = (qs.options || []).slice().sort((a, b) => (a || '')[0]?.localeCompare(b?.[0] || '')).filter(Boolean);
      // 覆盖层按「篇章内题目顺序」对齐（与 apply-answers.mjs 一致）；题干变了只记数，不丢答案
      const ovQ = ovP && (ovP.questions || [])[qi];
      const useOv = !!(ovQ && ovQ.answer);
      // 只统计「实质不同」：题号前缀 / 空白差异不影响按位置对齐的答案，且空白差异多半来自
      // 本文件的 healGlued（覆盖层存修补后的文本、seed 存原始文本），不能算题干变了。
      const normStem = (s) => String(s || '').trim().replace(/^\d{1,2}\s*[.．]?\s*/, '').replace(/\s+/g, '');
      if (useOv && ovQ.stem && normStem(ovQ.stem) !== normStem(healGlued(qs.stem))) aiStemMismatch++;
      if (useOv) aiAnswers++;
      db.run('INSERT INTO question(passage_id, qtype, stem, options, answer, analysis) VALUES (?,?,?,?,?,?)',
        [pid, qs.qtype, healGlued(qs.stem), JSON.stringify(opts),
          (useOv && ovQ.answer) || qs.answer || '', (useOv && ovQ.analysis) || qs.analysis || '']);
    });
  }
  examCount++;
}
console.log('真题套数:', examCount, '｜ 预置翻译篇章:', aiPassages, '｜ 预置范文/参考译文:', aiReferences, '｜ 预置答案题数:', aiAnswers,
  aiStemMismatch ? `（其中 ${aiStemMismatch} 题题干与生成时不同，已按顺序对齐）` : '');
console.log('修补粘连词篇章数:', glueFixed);

// 3. 全局词频表（过滤停用词，只统计词典收录的实词）
console.log('构建真题词频表…');
const STOP = new Set(('a an the this that these those it its is are was were be been being am do does did done ' +
  'have has had having will would shall should can could may might must to of in on at by for with from as and or but if ' +
  'not no nor so than then there here when where which who whom whose what how why all any both each few more most other ' +
  'some such only own same too very just also into over under again further once during before after above below up down out ' +
  'off about against between through i you he she we they me him her us them my your his their our their one two three ' +
  's t d ll re ve m').split(' '));

function reduce(w) {
  const lower = w.toLowerCase();
  const m = formIndex.get(lower);
  if (m && dictWords.has(m)) return m;
  if (dictWords.has(lower)) return lower;
  for (const suf of ['ies', 'ing', 'ed', 'es', 'ly', 'er', 'est', 's', 'd']) {
    if (lower.length > suf.length + 2 && lower.endsWith(suf)) {
      let base = lower.slice(0, -suf.length);
      if (suf === 'ies') base += 'y';
      for (const cand of [base, base + 'e', base.slice(0, -1)]) {
        if (cand && dictWords.has(cand)) return cand;
        const mm = cand && formIndex.get(cand);
        if (mm && dictWords.has(mm)) return mm;
      }
    }
  }
  const extra = EXTRA_FORMS[lower];
  if (extra && dictWords.has(extra)) return extra;
  return lower;
}
console.log('词形索引规模:', formIndex.size);

const rows = [];
db.each('SELECT id, content, exam_id FROM passage', (r) => rows.push(r));
const freq = new Map();
for (const p of rows) {
  const words = new Set(String(p.content).toLowerCase().match(/[a-z][a-z'-]*/g) || []);
  for (const raw of words) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    const w = reduce(raw);
    if (!dictWords.has(w)) continue;
    if (!freq.has(w)) freq.set(w, { total: 0, exams: new Set() });
    freq.get(w).total += 1;
    freq.get(w).exams.add(p.exam_id);
  }
}
const freqIns = db.prepare('INSERT INTO word_freq VALUES (?,?,?)');
for (const [w, v] of freq) freqIns.run([w, v.total, v.exams.size]);
freqIns.free();
console.log('词频条目:', freq.size);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.from(db.export()));
console.log('完成 ->', outPath, (fs.statSync(outPath).size / 1048576).toFixed(1) + 'MB');

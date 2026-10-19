// 构建种子数据库: ECDICT 裁剪 + 真题 JSON -> data/keeper.db
// 用法: node --max-old-space-size=8192 scripts/build-db.mjs
import initSqlJs from 'sql.js';
import contentSync from '../electron/content-sync.cjs';
import wordSemantics from '../electron/word-semantics.cjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { alignBilingual, blankNumbers } from '../src/utils/bilingual.js';
import { buildAlignmentLex } from './lib/alignment-lex.mjs';
import { applyReviewedAlignment } from './lib/reviewed-alignment.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDbPath = path.join(root, 'data', 'raw', 'ecdict-sqlite', 'stardict.db');
const seedDir = path.join(root, 'data', 'seed');
const outputIndex = process.argv.indexOf('--out');
if (outputIndex >= 0 && (!process.argv[outputIndex + 1] || process.argv[outputIndex + 1].startsWith('--'))) throw new Error('--out 必须指定新候选文件');
const outPath = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : path.join(root, 'data', 'keeper.db');
if (outputIndex >= 0 && fs.existsSync(outPath)) throw new Error('候选文件已存在，拒绝覆盖');

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
  seq INTEGER, title TEXT, content TEXT, translation TEXT, reference TEXT, rows TEXT);
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

contentSync.ensureContentSchema(db);

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

// 词典评分映射：英词/屈折形式 → 中文候选串（对齐 DP 的词典评分用）
const dictionaryRows = [];
db.each('SELECT word, translation, exchange FROM dict WHERE translation != \'\'', row => dictionaryRows.push(row));
const lexMap = buildAlignmentLex(dictionaryRows);
console.log('词典评分映射键数:', Object.keys(lexMap).length);

// 词形索引：0: 字段是原形指针（最高可信），其余字段是变形列表（反向兜底）
// 提前构建，供后面的「粘连词修补」与「词频归并」共用
const dictWords = new Set();
const wordRows = [];
db.each('SELECT word, exchange FROM dict', row => { dictWords.add(row.word); wordRows.push(row); });

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

// 页眉页脚 / 水印行清理：源 PDF/DOCX 的页眉（「2026 年 6 月大学英语四级考试真题(第 1 套) 4」）、
// 页脚（「2022年 6 月英语六级真题第1套 第 1 页 共 1 0页 b y :新一文化」）、翻译标题行、作答说明。
// 逐行判断，仅删除独立成行且满足「年份开头 + 四级/六级 + 真题或考试+第几套/页码」的行，正文零误伤。
// 行首页眉粘连正文时：剥掉页眉部分保留正文（页码+断字年份+套号后跟英文内容）
function cleanHeaderLine(line) {
  const m = String(line).match(/^(.{0,50}?(?:四级|六级)[^。！？]{0,30}?套[\s)）·•・«»\u00AD]*\d{0,3}\s*)(\S.*)$/);
  if (m && /(真题|考试)/.test(m[1]) && /套/.test(m[1]) && m[2].length > 15) return m[2];
  return line;
}
function isExamJunkLine(line) {
  const s = String(line).trim();
  if (!s || s.length > 95) return false;
  // 资源站水印 / 说明行
  if (/^(微信公众号|本资源|说明：|来源：)/.test(s) && /(四级|六级|真题|听力)/.test(s)) return true;
  if (/^注意[:：]\s*此部分试题请在答题卡/.test(s)) return true;
  if (/^(b\s*)?y\s*[:：]\s*新一文化/.test(s)) return true;
  // 通配：去除空格/项目符号/连字符后，仍含「年份 + 四级/六级 + 真题/考试」的行
  //（覆盖：年份开头的经典页眉、页码开头「13 •2 023年…」、年份断字「2 023年」、日式中点等全部变体）
  const compact = s.replace(/[\s•·・\-—_\u00AD]/g, '');
  if (compact.length <= 70 && /(19|20)\d{2}年/.test(compact) && /(四级|六级)/.test(compact) && /(真题|考试)/.test(compact)) return true;
  return false;
}
function stripExamJunkLines(text) {
  const t = String(text || '');
  if (!/\n/.test(t)) {
    // 无换行的短文本：只清粘连的水印碎片
    return t.replace(/\s*b\s*y\s*[:：]\s*新一文化\s*/g, '');
  }
  const kept = t.split(/\r?\n/).map((l) => cleanHeaderLine(l)).filter((l) => {
    const s = l.trim();
    return s && !isExamJunkLine(s);
  });
  let out = kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s*b\s*y\s*[:：]\s*新一文化\s*/g, '');
  return out.replace(/^\n+/, '').replace(/\s+$/, '');
}

function startsBlockMarker(s) {
  // ⚠️ 板块关键词必须大小写敏感：正文里小写开头的 question / part / direction 开头的
  // 普通句子，若用 /i 会误判为板块标记而拒绝拼接（已踩坑）
  return /^[A-O]\s*[)．.、]\s*\S/.test(s) || /^\[[A-O]\]/.test(s)
    || /^(Section|Part|Directions?|Question|Paragraph)\b/.test(s)
    || /^(19|20)\d{2}\s*年/.test(s);
}
function mergeWrappedLines(text) {
  const src = String(text || '').replace(/\r/g, '');
  if (!src.includes('\n')) return src;
  const paras = [];
  let cur = null;
  for (const raw of src.split('\n')) {
    const s = raw.trim();
    if (!s) { if (cur !== null) { paras.push(cur); cur = null; } continue; }
    if (cur === null) {
      // 空行后的续行：以小写字母开头则并回上一段（源文档段内空行折行）
      if (paras.length && /^[a-z]/.test(s)) { paras[paras.length - 1] += ' ' + s; continue; }
      cur = s; continue;
    }
    if (startsBlockMarker(s)) { paras.push(cur); cur = s; continue; }
    // 判定续行：下一行以小写字母开头（英文句中折行几乎都是这样），或当前行以中文逗号/顿号/冒号收尾
    const joinNext = /^[a-z]/.test(s) || /[，、：]$/.test(cur);
    if (!joinNext) { paras.push(cur); cur = s; continue; }
    // 硬折拼接：行尾是英文字母且下行以字母开头时补空格，中文直接连
    const needSpace = /[A-Za-z]$/.test(cur) && /^[A-Za-z]/.test(s);
    cur = cur + (needSpace ? ' ' : '') + s;
  }
  if (cur !== null) paras.push(cur);
  return paras.join('\n');
}
let junkFixed = 0;
let glueFixed = 0;
function healPassage(text, section) {
  const stripped = stripExamJunkLines(text);
  const merged = mergeWrappedLines(stripped);   // 全题型应用：作文题干的 Directions 同样有句中折行
  if (merged !== text) junkFixed++;
  const fixed = healGlued(merged);
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
  if (data.source_id) db.run('UPDATE exam SET source_id=? WHERE id=?', [data.source_id, examId]);
  for (const p of data.passages || []) {
    const ovP = ov && (ov.passages || []).find((x) => x.section === p.section && x.seq === p.seq);
    const contentFinal = healPassage(p.content, p.section);
    const trFinal = (ovP && ovP.translation) ? healPassage(ovP.translation, p.section) : null;
    // 对齐结果写死绑定：构建期一次性算好每篇的中英句对应（锚点审计见 align-quality）
    let rowsJson = null;
    if (trFinal) {
      try {
        const blankNums = blankNumbers(p);
        rowsJson = JSON.stringify(alignBilingual(contentFinal, trFinal, lexMap, { blankNums }));
      } catch (e) { console.warn('rows 生成失败:', e.message); }
      rowsJson = JSON.stringify(applyReviewedAlignment({...p,level:data.level,year:data.year,month:data.month,set_no:data.set_no,content:contentFinal,translation:trFinal},rowsJson ? JSON.parse(rowsJson) : []));
    }
    db.run('INSERT INTO passage(exam_id, section, seq, title, content, translation, reference, rows) VALUES (?,?,?,?,?,?,?,?)',
      [examId, p.section, p.seq, p.title, contentFinal, trFinal, (ovP && ovP.reference) || null, rowsJson]);
    if (ovP && ovP.translation) aiPassages++;
    if (ovP && ovP.reference) aiReferences++;
    const pid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    if (p.source_id) db.run('UPDATE passage SET source_id=? WHERE id=?', [p.source_id, pid]);
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
      if (qs.source_id) db.run('UPDATE question SET source_id=? WHERE id=last_insert_rowid()', [qs.source_id]);
    });
  }
  examCount++;
}
console.log('真题套数:', examCount, '｜ 预置翻译篇章:', aiPassages, '｜ 预置范文/参考译文:', aiReferences, '｜ 预置答案题数:', aiAnswers,
  aiStemMismatch ? `（其中 ${aiStemMismatch} 题题干与生成时不同，已按顺序对齐）` : '');
console.log('修补粘连词篇章数:', glueFixed);

// 3. 全局词频表（过滤停用词，只统计词典收录的实词）
console.log('构建真题词频表…');
const rows = [];
db.each('SELECT id,content,exam_id FROM passage', row => rows.push(row));
const frequencies = wordSemantics.countWordFrequency(rows,wordRows,EXTRA_FORMS);
const freqIns = db.prepare('INSERT INTO word_freq VALUES (?,?,?)');
try { for (const row of frequencies) freqIns.run([row.word,row.total,row.exams]); }
finally { freqIns.free(); }
console.log('词频条目:', frequencies.length);

contentSync.stampBuiltinContent(db);
db.run("INSERT OR REPLACE INTO content_sync_state VALUES ('word-frequency',?,1,?)",[wordSemantics.FREQUENCY_REVISION,new Date().toISOString()]);
db.run('VACUUM');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.from(db.export()), outputIndex >= 0 ? { flag: 'wx' } : {});
console.log('完成 ->', outPath, (fs.statSync(outPath).size / 1048576).toFixed(1) + 'MB');

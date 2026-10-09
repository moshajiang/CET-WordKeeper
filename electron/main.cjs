const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

// 阅读类应用不需要 GPU 加速；同时避免部分环境下 GPU 进程崩溃
app.disableHardwareAcceleration();

// 兜底词形映射（不规则变形 / 不规则复数 / 常见缩写）。
// ECDICT 的 exchange 字段并未覆盖全部不规则形式（例如 be 的 exchange 里没有 are / were），
// 语料实测仍有个别高频词查不到释义，这里做最后一道兜底。
const WORD_FORMS = require('./word-forms.json');
const EXTRA_FORMS = {
  ...WORD_FORMS.irregular_verbs,
  ...WORD_FORMS.irregular_plurals,
  ...WORD_FORMS.contractions,
};

let win = null;
let db = null;
let dbPath = null;
let formIndex = null;
let sqlModule = null; // initDb 里拿到，供 syncSeedExams 复用（打开种子库用）

const SCHEMA = `
CREATE TABLE IF NOT EXISTS exam(
  id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT, year INTEGER, month INTEGER,
  set_no INTEGER, title TEXT, imported INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS passage(
  id INTEGER PRIMARY KEY AUTOINCREMENT, exam_id INTEGER, section TEXT,
  seq INTEGER, title TEXT, content TEXT);
CREATE TABLE IF NOT EXISTS question(
  id INTEGER PRIMARY KEY AUTOINCREMENT, passage_id INTEGER, qtype TEXT,
  stem TEXT, options TEXT, answer TEXT, analysis TEXT);
CREATE TABLE IF NOT EXISTS dict(
  word TEXT PRIMARY KEY, phonetic TEXT, translation TEXT, definition TEXT,
  tag TEXT, bnc INTEGER, frq INTEGER, exchange TEXT, collins INTEGER, oxford INTEGER);
CREATE TABLE IF NOT EXISTS user_word(
  id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE, status TEXT DEFAULT 'learning',
  note TEXT DEFAULT '', created_at TEXT, mastered_at TEXT,
  interval_days REAL DEFAULT 0, ease REAL DEFAULT 2.5, reps INTEGER DEFAULT 0,
  lapses INTEGER DEFAULT 0, due TEXT);
CREATE TABLE IF NOT EXISTS word_hit(
  id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT, passage_id INTEGER, sentence TEXT);
CREATE TABLE IF NOT EXISTS review_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, word_id INTEGER, mode TEXT, rating INTEGER,
  reviewed_at TEXT, interval_days REAL, ease REAL, due TEXT);
CREATE TABLE IF NOT EXISTS mistake(
  id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER, user_answer TEXT,
  ai_analysis TEXT, created_at TEXT, redone INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS ai_cache(
  hash TEXT PRIMARY KEY, kind TEXT, response TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS word_freq(
  word TEXT PRIMARY KEY, total INTEGER, exams INTEGER);
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS user_answer(
  id INTEGER PRIMARY KEY AUTOINCREMENT, exam_id INTEGER, question_id INTEGER,
  choice TEXT, is_correct INTEGER, updated_at TEXT, UNIQUE(exam_id, question_id));
CREATE TABLE IF NOT EXISTS attempt(
  id INTEGER PRIMARY KEY AUTOINCREMENT, exam_id INTEGER, submitted_at TEXT,
  total INTEGER, correct INTEGER, score REAL, detail TEXT);
`;

// 给已存在的用户库补列（CREATE TABLE IF NOT EXISTS 不会修改既有表结构）
function migrate() {
  const cols = q('PRAGMA table_info(passage)').map((c) => c.name);
  if (!cols.includes('translation')) run('ALTER TABLE passage ADD COLUMN translation TEXT');
  const qcols = q('PRAGMA table_info(question)').map((c) => c.name);
  if (!qcols.includes('bank')) run('ALTER TABLE question ADD COLUMN bank TEXT');
}

function q(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function run(sql, params = []) {
  db.run(sql, params);
}
function persist() {
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}
function now() {
  return new Date().toISOString();
}

async function initDb() {
  const SQL = await initSqlJs({
    locateFile: (f) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', f),
  });
  sqlModule = SQL;
  const userDb = path.join(app.getPath('userData'), 'keeper.db');
  if (!fs.existsSync(userDb)) {
    const seed = path.join(__dirname, '..', 'data', 'keeper.db');
    if (fs.existsSync(seed)) {
      fs.mkdirSync(path.dirname(userDb), { recursive: true });
      fs.copyFileSync(seed, userDb);
    }
  }
  dbPath = userDb;
  db = fs.existsSync(userDb) ? new SQL.Database(fs.readFileSync(userDb)) : new SQL.Database();
  db.run(SCHEMA);
  migrate();
  buildFormIndex();
  const added = syncSeedExams();
  if (added) console.log(`已从内置数据同步 ${added} 套新真题`);
}

// 内置真题数据会随版本更新（例如补充新考次）。
// 用户库只在「首次启动」时从种子库拷贝，所以老用户不会自动拿到新真题 —— 这里做一次增量同步：
// 把种子库里「用户库还没有的考次」补进来。
// 判定键 = 级别 + 年 + 月 + 套号；只新增、不删除、不覆盖，
// 绝不触碰 user_word / word_hit / review_log，用户的学习记录始终安全。
function syncSeedExams() {
  const seedPath = path.join(__dirname, '..', 'data', 'keeper.db');
  if (!fs.existsSync(seedPath) || !sqlModule) return 0;
  let seed = null;
  try {
    seed = new sqlModule.Database(fs.readFileSync(seedPath));
    const keyOf = (r) => `${r.level}|${r.year}|${r.month}|${r.set_no}`;
    const mine = new Set(q('SELECT level, year, month, set_no FROM exam').map(keyOf));
    const seedExams = [];
    seed.each('SELECT * FROM exam', (r) => seedExams.push(r));

    let added = 0;
    for (const e of seedExams) {
      if (mine.has(keyOf(e))) continue;
      run('INSERT INTO exam(level, year, month, set_no, title, imported, created_at) VALUES (?,?,?,?,?,0,?)',
        [e.level, e.year, e.month, e.set_no, e.title, now()]);
      const examId = q('SELECT last_insert_rowid() AS id')[0].id;

      const pList = [];
      seed.each('SELECT * FROM passage WHERE exam_id = ?', [e.id], (p) => pList.push(p));
      for (const p of pList) {
        run('INSERT INTO passage(exam_id, section, seq, title, content) VALUES (?,?,?,?,?)',
          [examId, p.section, p.seq, p.title, p.content]);
        const pid = q('SELECT last_insert_rowid() AS id')[0].id;
        const qList = [];
        seed.each('SELECT * FROM question WHERE passage_id = ?', [p.id], (x) => qList.push(x));
        for (const x of qList) {
          run('INSERT INTO question(passage_id, qtype, stem, options, answer, analysis) VALUES (?,?,?,?,?,?)',
            [pid, x.qtype, x.stem, x.options, x.answer, x.analysis]);
        }
      }
      added++;
    }
    if (added) { rebuildWordFreq(); persist(); }
    return added;
  } catch (err) {
    // 同步失败不能影响应用启动，用户原有的数据仍然可用
    console.error('同步内置真题失败（不影响使用）:', err.message);
    return 0;
  } finally {
    try { if (seed) seed.close(); } catch { /* 忽略 */ }
  }
}

// ECDICT exchange 字段说明：
//   0:xxx  —— 本词的原形（lemma），可信度最高
//   p/d/i/3/s/... —— 本词的各类变形
// 因此正向（变形 -> 原形）以 0: 为准，反向（原形 -> 变形）用其余字段兜底
function buildFormIndex() {
  formIndex = new Map();
  const reverse = new Map();
  const rows = q('SELECT word, exchange FROM dict WHERE exchange IS NOT NULL AND exchange != ""');
  for (const r of rows) {
    const head = String(r.word).toLowerCase();
    for (const part of String(r.exchange).split('/')) {
      const [k, v] = part.split(':');
      if (!v) continue;
      const form = v.toLowerCase();
      if (form === head) continue;
      if (k === '0') formIndex.set(head, form);
      else if (!reverse.has(form)) reverse.set(form, head);
    }
  }
  for (const [form, head] of reverse) {
    if (!formIndex.has(form)) formIndex.set(form, head);
  }
}

function simpleNorm(w) {
  let s = w.toLowerCase().replace(/’/g, "'");
  for (const suf of ['ies', 'ing', 'ed', 'es', 'ly', 'er', 'est', 's', 'd']) {
    if (s.length > suf.length + 2 && s.endsWith(suf)) {
      let base = s.slice(0, -suf.length);
      if (suf === 'ies') base += 'y';
      if (base.length > 2) {
        for (const cand of [base, base + 'e', base.slice(0, -1)]) {
          if (cand && q('SELECT 1 FROM dict WHERE word = ? LIMIT 1', [cand]).length) return cand;
        }
        const mapped = formIndex.get(base);
        if (mapped && q('SELECT 1 FROM dict WHERE word = ? LIMIT 1', [mapped]).length) return mapped;
      }
    }
  }
  return s;
}

// 变形优先：先看是否是某词条的变形（动词/名词变化），再退到精确匹配
function resolveWord(raw) {
  const lower = String(raw || '').toLowerCase().replace(/’/g, "'");
  const mapped = formIndex.get(lower);
  if (mapped && q('SELECT 1 FROM dict WHERE word = ? LIMIT 1', [mapped]).length) {
    return { word: mapped, exact: true };
  }
  if (q('SELECT 1 FROM dict WHERE word = ? LIMIT 1', [lower]).length) return { word: lower, exact: true };
  const sn = simpleNorm(lower);
  if (sn !== lower) {
    const m2 = formIndex.get(sn);
    if (m2 && q('SELECT 1 FROM dict WHERE word = ? LIMIT 1', [m2]).length) return { word: m2, exact: true };
    if (q('SELECT 1 FROM dict WHERE word = ? LIMIT 1', [sn]).length) return { word: sn, exact: true };
  }
  // 最后兜底：不规则变形 / 缩写。放在词典精确匹配之后，故不会覆盖词典自身释义
  // （left、found 这类本身是独立词的，前面已经返回，不会走到这里）
  const extra = EXTRA_FORMS[lower] || EXTRA_FORMS[sn];
  if (extra && q('SELECT 1 FROM dict WHERE word = ? LIMIT 1', [extra]).length) return { word: extra, exact: true };
  return { word: sn, exact: false };
}

function lookupEntry(word) {
  const rows = q('SELECT * FROM dict WHERE word = ?', [word]);
  return rows[0] || null;
}

function parseTags(tag) {
  if (!tag) return [];
  return String(tag).split(' ').filter((t) => t && t !== '');
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    name: 'CET WordKeeper',
    version: app.getVersion(),
    dbReady: !!db,
  }));

  ipcMain.handle('dict:lookup', (_e, raw) => {
    const r = resolveWord(raw);
    const entry = lookupEntry(r.word);
    const tags = entry ? parseTags(entry.tag) : [];
    const inBook = !!q('SELECT 1 FROM user_word WHERE word = ?', [r.word]).length;
    const freq = q('SELECT total, exams FROM word_freq WHERE word = ?', [r.word])[0] || null;
    return { raw, word: r.word, found: !!entry, entry, tags, inBook, freq };
  });

  ipcMain.handle('exams:list', () =>
    q('SELECT e.*, (SELECT COUNT(*) FROM passage p WHERE p.exam_id = e.id) AS passage_count FROM exam e ORDER BY e.level, e.year DESC, e.month DESC, e.set_no')
  );

  ipcMain.handle('exam:detail', (_e, examId) => {
    const exam = q('SELECT * FROM exam WHERE id = ?', [examId])[0];
    if (!exam) return null;
    const passages = q('SELECT * FROM passage WHERE exam_id = ? ORDER BY seq', [examId]);
    for (const p of passages) {
      p.questions = q('SELECT * FROM question WHERE passage_id = ? ORDER BY id', [p.id]);
    }
    return { exam, passages };
  });

  ipcMain.handle('words:add', (_e, word, sentence, passageId) => {
    const r = resolveWord(word);
    const existing = q('SELECT id FROM user_word WHERE word = ?', [r.word]);
    let added = false;
    if (!existing.length) {
      run(
        'INSERT INTO user_word(word, status, created_at, due) VALUES (?, "learning", ?, ?)',
        [r.word, now(), new Date(Date.now() + 10 * 60 * 1000).toISOString()]
      );
      added = true;
    }
    // 词已在生词本时，仍要累计新的出处句（同一词在不同真题中的语境都要保留）
    let hitAdded = false;
    if (sentence && sentence.trim()) {
      const pid = passageId || null;
      const dup = q('SELECT 1 FROM word_hit WHERE word = ? AND sentence = ?', [r.word, sentence]);
      if (!dup.length) {
        run('INSERT INTO word_hit(word, passage_id, sentence) VALUES (?,?,?)', [r.word, pid, sentence]);
        hitAdded = true;
      }
    }
    persist();
    return { ok: true, word: r.word, added, hitAdded };
  });

  ipcMain.handle('words:remove', (_e, word) => {
    run('DELETE FROM user_word WHERE word = ?', [word]);
    run('DELETE FROM word_hit WHERE word = ?', [word]);
    persist();
    return { ok: true };
  });

  ipcMain.handle('words:setStatus', (_e, word, status) => {
    run('UPDATE user_word SET status = ?, mastered_at = ? WHERE word = ?', [
      status, status === 'mastered' ? now() : null, word,
    ]);
    persist();
    return { ok: true };
  });

  ipcMain.handle('words:saveNote', (_e, word, note) => {
    run('UPDATE user_word SET note = ? WHERE word = ?', [note, word]);
    persist();
    return { ok: true };
  });

  ipcMain.handle('words:all', () => {
    const rows = q('SELECT word, status FROM user_word');
    const map = {};
    for (const r of rows) map[r.word] = r.status;
    return map;
  });

  ipcMain.handle('words:list', (_e, filter) => {
    const f = filter || {};
    let sql = `SELECT u.*, d.phonetic, d.translation, d.tag,
      (SELECT COUNT(*) FROM word_hit h WHERE h.word = u.word) AS hits
      FROM user_word u LEFT JOIN dict d ON d.word = u.word`;
    const where = [];
    const params = [];
    if (f.status && f.status !== 'all') where.push('u.status = ?'), params.push(f.status);
    if (f.search) where.push('(u.word LIKE ? OR d.translation LIKE ?)'), params.push(`%${f.search}%`, `%${f.search}%`);
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ` ORDER BY CASE u.status WHEN 'learning' THEN 0 ELSE 1 END, u.created_at DESC`;
    return q(sql, params);
  });

  ipcMain.handle('words:detail', (_e, word) => {
    const uw = q('SELECT * FROM user_word WHERE word = ?', [word])[0] || null;
    const entry = lookupEntry(word);
    const hits = q(
      `SELECT h.sentence, h.passage_id, p.title AS ptitle, e.level, e.year, e.month, e.set_no
       FROM word_hit h LEFT JOIN passage p ON p.id = h.passage_id
       LEFT JOIN exam e ON e.id = p.exam_id WHERE h.word = ? ORDER BY h.id DESC`, [word]);
    const logs = q('SELECT * FROM review_log l JOIN user_word u ON u.id = l.word_id WHERE u.word = ? ORDER BY l.id DESC LIMIT 20', [word]);
    const freq = q('SELECT total, exams FROM word_freq WHERE word = ?', [word])[0] || null;
    return { word, userWord: uw, entry, tags: entry ? parseTags(entry.tag) : [], hits, logs, freq };
  });

  ipcMain.handle('review:queue', () => {
    const nowStr = now();
    const due = q(
      `SELECT u.word, d.phonetic, d.translation, u.reps, u.due,
        (SELECT sentence FROM word_hit h WHERE h.word = u.word LIMIT 1) AS sentence
       FROM user_word u LEFT JOIN dict d ON d.word = u.word
       WHERE u.status = 'learning' AND u.due <= ? ORDER BY u.due LIMIT 100`, [nowStr]);
    const fresh = q(
      `SELECT u.word, d.phonetic, d.translation, u.reps, u.due,
        (SELECT sentence FROM word_hit h WHERE h.word = u.word LIMIT 1) AS sentence
       FROM user_word u LEFT JOIN dict d ON d.word = u.word
       WHERE u.status = 'learning' AND (u.due IS NULL OR u.reps = 0) AND u.word NOT IN (SELECT word FROM (SELECT word FROM user_word WHERE status='learning' AND due <= ?)) ORDER BY u.created_at DESC LIMIT 20`, [nowStr]);
    return { due, fresh };
  });

  ipcMain.handle('review:answer', (_e, word, rating) => {
    const uw = q('SELECT * FROM user_word WHERE word = ?', [word])[0];
    if (!uw) return { ok: false };
    let { interval_days: iv, ease, reps, lapses } = uw;
    iv = iv || 0; ease = ease || 2.5; reps = reps || 0; lapses = lapses || 0;
    if (rating === 0) {
      reps = 0; lapses += 1; iv = 0.007; ease = Math.max(1.3, ease - 0.2);
    } else {
      reps += 1;
      if (reps === 1) iv = rating === 1 ? 0.5 : 1;
      else if (reps === 2) iv = rating === 1 ? 3 : 6;
      else iv = Math.round(iv * ease * (rating === 1 ? 0.6 : 1) * 10) / 10;
      ease = rating === 1 ? Math.max(1.3, ease - 0.15) : Math.min(3.0, ease + 0.1);
    }
    const due = new Date(Date.now() + iv * 86400000).toISOString();
    run('UPDATE user_word SET interval_days=?, ease=?, reps=?, lapses=?, due=? WHERE word=?', [iv, ease, reps, lapses, due, word]);
    run('INSERT INTO review_log(word_id, mode, rating, reviewed_at, interval_days, ease, due) VALUES (?,?,?,?,?,?,?)',
      [uw.id, 'recognize', rating, now(), iv, ease, due]);
    persist();
    return { ok: true, interval: iv, due };
  });

  ipcMain.handle('stats:summary', () => {
    const learning = q(`SELECT COUNT(*) c FROM user_word WHERE status='learning'`)[0].c;
    const mastered = q(`SELECT COUNT(*) c FROM user_word WHERE status='mastered'`)[0].c;
    const dueNow = q(`SELECT COUNT(*) c FROM user_word WHERE status='learning' AND due <= ?`, [now()])[0].c;
    const today = new Date().toISOString().slice(0, 10);
    const reviewedToday = q(`SELECT COUNT(*) c FROM review_log WHERE reviewed_at LIKE ?`, [today + '%'])[0].c;
    const exams = q('SELECT COUNT(*) c FROM exam')[0].c;
    return { learning, mastered, dueNow, reviewedToday, exams };
  });

  ipcMain.handle('settings:get', () => {
    const rows = q('SELECT key, value FROM settings');
    const s = {};
    for (const r of rows) s[r.key] = r.value;
    return s;
  });

  ipcMain.handle('settings:set', (_e, obj) => {
    for (const [k, v] of Object.entries(obj)) {
      run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, String(v)]);
    }
    persist();
    return { ok: true };
  });

  ipcMain.handle('ai:translate', (_e, text) => aiCall('translate', text));
  ipcMain.handle('ai:grammar', (_e, text) => aiCall('grammar', text));

  ipcMain.handle('scan:hard', (_e, content, level) => {
    const words = [...new Set(String(content || '').toLowerCase().match(/[a-z][a-z'-]*/g) || [])];
    const seen = new Set();
    const out = [];
    for (const w of words) {
      if (w.length < 4) continue;
      const r = resolveWord(w);
      if (seen.has(r.word)) continue;
      const entry = lookupEntry(r.word);
      if (!entry) continue;
      const tags = parseTags(entry.tag);
      const has = (k) => tags.includes(k);
      let label = null;
      if (has('gre') || has('toefl') || has('ielts')) label = 'GRE/出国级';
      else if (level === 'CET4' && (has('cet6') || has('ky'))) label = '六级/考研级';
      else if (!tags.length && entry.frq > 8000 && !entry.collins) label = '低频生僻';
      if (label) {
        seen.add(r.word);
        out.push({ word: r.word, label });
      }
    }
    return out.slice(0, 80);
  });

  ipcMain.handle('export:anki', async (_e, filter) => {
    const f = filter || {};
    const rows = q(
      `SELECT u.word, u.status, u.note, d.phonetic, d.translation, d.definition, d.tag,
        (SELECT COUNT(*) FROM word_hit h WHERE h.word = u.word) AS hits
       FROM user_word u LEFT JOIN dict d ON d.word = u.word
       ${f.status && f.status !== 'all' ? 'WHERE u.status = ?' : ''}
       ORDER BY u.created_at DESC`,
      f.status && f.status !== 'all' ? [f.status] : []
    );
    if (!rows.length) return { ok: false, error: 'empty' };
    const clean = (s) => String(s || '').replace(/\r?\n/g, '<br>').replace(/\t/g, ' ').trim();
    const mark = (sentence, word) => {
      const re = new RegExp('\\b(\\w*' + String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*)\\b', 'gi');
      return clean(sentence).replace(re, '<b>$1</b>');
    };
    const lines = [];
    for (const r of rows) {
      const hit = q('SELECT h.sentence, e.level, e.year, e.month, e.set_no FROM word_hit h LEFT JOIN passage p ON p.id = h.passage_id LEFT JOIN exam e ON e.id = p.exam_id WHERE h.word = ? LIMIT 1', [r.word])[0];
      const source = hit && hit.year ? `${hit.level} ${hit.year}.${hit.month} 第${hit.set_no}套` : '';
      const front = `${r.word}${r.phonetic ? '  /' + r.phonetic + '/' : ''}`;
      const back = [
        clean(r.translation || r.definition || ''),
        hit ? `例句：${mark(hit.sentence, r.word)}` : '',
        source ? `出处：${source}` : '',
        r.note ? `笔记：${clean(r.note)}` : '',
      ].filter(Boolean).join('<br><br>');
      const tags = ['CETWordKeeper', r.status === 'mastered' ? 'mastered' : 'learning', ...parseTags(r.tag)];
      lines.push([front, back, clean(hit ? hit.sentence : ''), source, tags.join(' ')].join('\t'));
    }
    const header = '#separator:tab\n#html:true\n#columns:Front\tBack\tContext\tSource\tTags\n#tags column:5\n';
    const content = header + lines.join('\n');
    // targetPath 允许脚本化导出（跳过弹窗），UI 调用时不传则走保存对话框
    let target = f.targetPath;
    if (!target) {
      const r = await dialog.showSaveDialog(win, {
        defaultPath: `cet-wordkeeper-anki-${new Date().toISOString().slice(0, 10)}.txt`,
        filters: [{ name: 'Anki 导入文本', extensions: ['txt', 'tsv'] }],
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      target = r.filePath;
    }
    fs.writeFileSync(target, '\ufeff' + content, 'utf8');
    return { ok: true, count: rows.length, path: target };
  });

  ipcMain.handle('backup:dialog', async () => {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: 'keeper-backup.db',
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    persist();
    fs.copyFileSync(dbPath, r.filePath);
    return { ok: true, path: r.filePath };
  });

  ipcMain.handle('import:exam', (_e, payload) => {
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      const r = runInsertExam(data);
      persist();
      return r;
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('backup:export', async (_e, targetPath) => {
    persist();
    fs.copyFileSync(dbPath, targetPath);
    return { ok: true, path: targetPath };
  });

  // ---- 做题 / 交卷 / 解析 ----
  ipcMain.handle('exam:analysis', async (_e, examId) => ensureExamAnalysis(examId));

  ipcMain.handle('attempt:get', (_e, examId) => {
    const answers = q('SELECT question_id, choice, is_correct FROM user_answer WHERE exam_id = ?', [examId]);
    const attempt = q('SELECT * FROM attempt WHERE exam_id = ? ORDER BY id DESC LIMIT 1', [examId])[0] || null;
    return { answers, attempt };
  });

  ipcMain.handle('attempt:submit', async (_e, examId, userAnswers) => {
    // 客观题判分依赖正确答案；本地没有就先让 AI 生成并落库（未配置 Key 时明确返回 no_key）
    const ens = await ensureExamAnalysis(examId);
    if (!ens.ok) return { ok: false, error: ens.error };
    return gradeExam(examId, userAnswers);
  });

  ipcMain.handle('attempt:clear', (_e, examId) => {
    run('DELETE FROM user_answer WHERE exam_id = ?', [examId]);
    persist();
    return { ok: true };
  });
}

function runInsertExam(data) {
  const { level, year, month, set_no, title, passages } = data;
  if (!level || !year || !passages || !passages.length) throw new Error('缺少必要字段 level/year/passages');
  const m = month || 6;
  const s = set_no || 1;
  // 去重：同一 level+年月+套号 视为同一套题，重复导入直接提示，避免「我的导入」里堆积重复副本
  const dup = q('SELECT id FROM exam WHERE level = ? AND year = ? AND month = ? AND set_no = ?', [level, year, m, s])[0];
  if (dup) return { ok: false, error: 'duplicate', existingId: dup.id };
  run('INSERT INTO exam(level, year, month, set_no, title, imported, created_at) VALUES (?,?,?,?,?,1,?)',
    [level, year, m, s, title || `${level} ${year}.${m}`, now()]);
  const examId = q('SELECT last_insert_rowid() id')[0].id;
  for (const p of passages) {
    run('INSERT INTO passage(exam_id, section, seq, title, content, translation) VALUES (?,?,?,?,?,?)',
      [examId, p.section || 'reading', p.seq || 1, p.title || '', p.content || '', p.translation || null]);
    const pid = q('SELECT last_insert_rowid() id')[0].id;
    for (const qs of p.questions || []) {
      run('INSERT INTO question(passage_id, qtype, stem, options, answer, analysis) VALUES (?,?,?,?,?,?)',
        [pid, qs.qtype || '', qs.stem || '', JSON.stringify(qs.options || []), qs.answer || '', qs.analysis || '']);
    }
  }
  rebuildWordFreq();
  return { ok: true, examId };
}

const STOP_WORDS = new Set(('a an the this that these those it its is are was were be been being am do does did done ' +
  'have has had having will would shall should can could may might must to of in on at by for with from as and or but if ' +
  'not no nor so than then there here when where which who whom whose what how why all any both each few more most other ' +
  'some such only own same too very just also into over under again further once during before after above below up down out ' +
  'off about against between through i you he she we they me him her us them my your his their our one two three ' +
  's t d ll re ve m').split(' '));

function rebuildWordFreq() {
  run('DELETE FROM word_freq');
  const dictWords = new Set();
  for (const r of q('SELECT word FROM dict')) dictWords.add(r.word);
  const passages = q('SELECT id, content, exam_id FROM passage');
  const freq = new Map();
  for (const p of passages) {
    const words = new Set(String(p.content).toLowerCase().match(/[a-z][a-z'-]*/g) || []);
    for (const raw of words) {
      if (raw.length < 3 || STOP_WORDS.has(raw)) continue;
      const r = resolveWord(raw);
      if (!dictWords.has(r.word)) continue;
      if (!freq.has(r.word)) freq.set(r.word, { total: 0, exams: new Set() });
      freq.get(r.word).total += 1;
      freq.get(r.word).exams.add(p.exam_id);
    }
  }
  const stmt = db.prepare('INSERT INTO word_freq(word, total, exams) VALUES (?,?,?)');
  for (const [w, v] of freq) {
    stmt.run([w, v.total, v.exams.size]);
  }
  stmt.free();
}

async function aiCall(kind, text) {
  if (!text || !text.trim()) return { ok: false, error: 'empty' };
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(kind + ':' + text).digest('hex');
  const cached = q('SELECT response FROM ai_cache WHERE hash = ?', [hash]);
  if (cached.length) return { ok: true, kind, text, response: JSON.parse(cached[0].response), cached: true };

  const s = {};
  for (const r of q('SELECT key, value FROM settings')) s[r.key] = r.value;
  if (!s.api_key || !s.api_base) return { ok: false, error: 'no_key' };

  const prompts = {
    translate: `You are a professional CET exam translator. Translate the following English into natural Chinese. Output ONLY the translation.\n\n${text}`,
    grammar: `You are an English grammar teacher for Chinese CET students. Analyze the sentence below. Output in this exact format (plain text, no markdown):\n主干: <subject-verb-object core>\n从句/结构: <clause types and layers, one per line; write "无" if none>\n语法要点: <2-4 key grammar points with brief explanation in Chinese>\n\nSentence: ${text}`,
    // 真题解析：调用方已组装完整提示词（需要文章、词库与题号上下文）
    examAnalysis: text,
  };
  try {
    const resp = await fetch(s.api_base.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.api_key },
      body: JSON.stringify({
        model: s.api_model || 'deepseek-chat',
        messages: [{ role: 'user', content: prompts[kind] }],
        temperature: 0.3,
      }),
    });
    if (!resp.ok) return { ok: false, error: 'api_' + resp.status };
    const data = await resp.json();
    const content = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
    const payload = { content };
    run('INSERT OR REPLACE INTO ai_cache(hash, kind, response, created_at) VALUES (?,?,?,?)', [hash, kind, JSON.stringify(payload), now()]);
    persist();
    return { ok: true, kind, text, response: payload, cached: false };
  } catch (err) {
    return { ok: false, error: 'network: ' + err.message };
  }
}

// ---- 真题解析与全文翻译：首次由 AI 生成，随后永久离线复用 ----
// 存进 passage.translation 与 question.answer / question.analysis，
// 所以第二次打开是纯本地读取，不再产生任何请求。
const OBJECTIVE_SECTIONS = ['cloze', 'match', 'reading'];

function buildAnalysisPrompt(passage, questions) {
  const list = questions
    .filter((x) => x.stem)
    .map((x) => {
      let opts = [];
      try { opts = JSON.parse(x.options || '[]'); } catch { opts = []; }
      return `${x.stem}.${opts.length ? ' 选项: ' + opts.join(' | ') : ''}`;
    })
    .join('\n');
  const isChineseSource = passage.section === 'translation';
  return [
    '你是中国大学英语四六级（CET）命题与解析专家。下面是一篇真题材料及其题目。',
    '只返回一个 JSON 对象（不要 markdown 代码块、不要任何多余文字），结构严格如下：',
    '{"translation":"...","answers":[{"n":26,"answer":"A","analysis":"..."}]}',
    '',
    '要求：',
    isChineseSource
      ? '- translation：正文是中文，请给出对应的英文参考译文。'
      : '- translation：把正文完整、通顺地译成中文，并保留原有分段。',
    '- answer：只填一个大写字母。仔细阅读题是 A–D；选词填空与长篇阅读是 A–O。',
    '- 选词填空：从 A–O 词库中为每个空挑一个词，每个词最多使用一次。',
    '- analysis：60–150 字中文解析，说明为什么选它，并指出最有迷惑性的干扰项错在哪。',
    '- 题号必须与下面给出的题号完全一致，不要增删题目。',
    '',
    `【题型】${passage.section}`,
    `【正文】\n${passage.content}`,
    list ? `\n【题目】\n${list}` : '',
  ].join('\n');
}

function parseAiJson(content) {
  let s = String(content || '').trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  return JSON.parse(s);
}

async function ensureExamAnalysis(examId) {
  const passages = q('SELECT * FROM passage WHERE exam_id = ? ORDER BY id', [examId]);
  const todo = [];
  for (const p of passages) {
    const qs = q('SELECT * FROM question WHERE passage_id = ? ORDER BY id', [p.id]);
    const needTranslation = !p.translation && OBJECTIVE_SECTIONS.includes(p.section);
    const needAnswers = qs.some((x) => !x.answer && x.stem);
    if (needTranslation || needAnswers) todo.push({ p, qs });
  }
  if (!todo.length) return { ok: true, cached: true, pending: 0 };

  const s = {};
  for (const r of q('SELECT key, value FROM settings')) s[r.key] = r.value;
  if (!s.api_key || !s.api_base) return { ok: false, error: 'no_key', pending: todo.length };

  let generated = 0;
  for (const { p, qs } of todo) {
    const r = await aiCall('examAnalysis', buildAnalysisPrompt(p, qs));
    if (!r.ok) return { ok: false, error: r.error, pending: todo.length - generated };
    let data;
    try {
      data = parseAiJson(r.response.content);
    } catch {
      return { ok: false, error: 'bad_json', pending: todo.length - generated };
    }
    if (data.translation) run('UPDATE passage SET translation = ? WHERE id = ?', [String(data.translation), p.id]);
    for (const a of data.answers || []) {
      const key = String(a.n).replace(/\D/g, '');
      const hit = qs.find((x) => String(x.stem).replace(/\D/g, '') === key);
      if (!hit) continue;
      run('UPDATE question SET answer = ?, analysis = ? WHERE id = ?',
        [String(a.answer || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2), String(a.analysis || ''), hit.id]);
    }
    generated++;
    persist();
  }
  return { ok: true, cached: false, pending: 0, generated };
}

function gradeExam(examId, userAnswers) {
  const ua = userAnswers || {};
  const questions = q(
    `SELECT q.id, q.stem, q.answer FROM question q JOIN passage p ON p.id = q.passage_id
     WHERE p.exam_id = ? AND p.section IN ('cloze','match','reading')`,
    [examId]
  );
  let correct = 0;
  const detail = [];
  run('DELETE FROM user_answer WHERE exam_id = ?', [examId]);
  for (const x of questions) {
    const choice = String(ua[x.id] || '').toUpperCase().replace(/[^A-Z]/g, '');
    const right = String(x.answer || '').toUpperCase().replace(/[^A-Z]/g, '');
    const isCorrect = !!choice && !!right && choice === right;
    if (isCorrect) correct++;
    run('INSERT INTO user_answer(exam_id, question_id, choice, is_correct, updated_at) VALUES (?,?,?,?,?)',
      [examId, x.id, choice, isCorrect ? 1 : 0, now()]);
    detail.push({ question_id: x.id, stem: x.stem, choice, answer: right, correct: isCorrect });
  }
  const total = questions.length;
  const score = total ? Math.round((correct / total) * 1000) / 10 : 0;
  run('INSERT INTO attempt(exam_id, submitted_at, total, correct, score, detail) VALUES (?,?,?,?,?,?)',
    [examId, now(), total, correct, score, JSON.stringify(detail)]);
  persist();
  return { ok: true, total, correct, score, detail };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#f7f6f3',
    title: 'CET WordKeeper',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  const devUrl = process.env.KEEPER_DEV_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(async () => {
  await initDb();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

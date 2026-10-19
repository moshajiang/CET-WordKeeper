// 内置内容迁移。只操作传入的数据库；调用者负责备份、持久化和写盘失败恢复。
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function query(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try { stmt.bind(params); const out = []; while (stmt.step()) out.push(stmt.getAsObject()); return out; }
  finally { stmt.free(); }
}
const fields = {
  exam: ['level', 'year', 'month', 'set_no', 'title'],
  passage: ['section', 'seq', 'title', 'content', 'translation', 'reference', 'rows', 'source_order'],
  question: ['qtype', 'stem', 'options', 'answer', 'analysis', 'source_order'],
};
const pick = (row, names) => names.map(name => row[name] ?? null);
const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
const examKey = row => `cwk:v1/exam/${[row.level, row.year, row.month, row.set_no].map(x => encodeURIComponent(x ?? '')).join('/')}`;
const passageKey = (parent, row) => `${parent}/passage/${encodeURIComponent(row.section || '')}/${row.seq ?? ''}`;
function questionKey(parent, row) {
  const number = norm(row.stem).match(/^(\d{1,3})(?=\D|$)/);
  return `${parent}/question/${number ? 'n:' + Number(number[1]) : 'h:' + hash([norm(row.qtype), norm(row.stem), norm(row.options)])}`;
}
function identity(parent, row, fallback) {
  const key = row.source_id || fallback;
  if (typeof key !== 'string' || !key.startsWith(parent) || key.length > 500) throw new Error('无效内置内容身份');
  return key;
}
function ensureContentSchema(db) {
  db.run(`CREATE TABLE IF NOT EXISTS attempt(id INTEGER PRIMARY KEY AUTOINCREMENT, exam_id INTEGER, submitted_at TEXT,
    total INTEGER, correct INTEGER, score REAL, detail TEXT)`);
  for (const table of ['exam', 'passage', 'question']) {
    const columns = new Set(query(db, `PRAGMA table_info(${table})`).map(x => x.name));
    for (const [name, type] of [['source_id','TEXT'], ['content_revision','TEXT'], ['retired','INTEGER NOT NULL DEFAULT 0'],
      ...(table === 'exam' ? [['assessment_revision','TEXT']] : [['source_order','INTEGER NOT NULL DEFAULT 0']])]) {
      if (!columns.has(name)) db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
  if (!query(db, 'PRAGMA table_info(attempt)').some(x => x.name === 'content_revision')) db.run('ALTER TABLE attempt ADD COLUMN content_revision TEXT');
  db.run(`CREATE TABLE IF NOT EXISTS content_sync_state(source TEXT PRIMARY KEY, revision TEXT, schema_version INTEGER, applied_at TEXT);
    CREATE TABLE IF NOT EXISTS content_history(entity TEXT, local_id INTEGER, source_id TEXT, revision TEXT, payload TEXT, recorded_at TEXT,
      UNIQUE(entity, local_id, revision));
    CREATE TABLE IF NOT EXISTS content_sync_issue(issue_key TEXT PRIMARY KEY, source_id TEXT, details TEXT, recorded_at TEXT);`);
}
function catalog(seed) {
  const ids = new Set();
  const unique = key => { if (ids.has(key)) throw new Error('种子库身份重复: ' + key); ids.add(key); return key; };
  return query(seed, 'SELECT * FROM exam WHERE COALESCE(imported,0)=0 ORDER BY id').filter(e => !e.retired).map(e => {
    const eid = unique(identity('cwk:v1/exam/', e, examKey(e)));
    const passages = query(seed, 'SELECT * FROM passage WHERE exam_id=? ORDER BY id', [e.id]).filter(p => !p.retired).map((p, pi) => {
      const pid = unique(identity(eid + '/passage/', p, passageKey(eid, p)));
      const questions = query(seed, 'SELECT * FROM question WHERE passage_id=? ORDER BY id', [p.id]).filter(q => !q.retired).map((q, qi) =>
        ({ ...q, source_id: unique(identity(pid + '/question/', q, questionKey(pid, q))), source_order: qi }));
      return { ...p, source_id: pid, source_order: pi, questions };
    });
    return { ...e, source_id: eid, passages };
  });
}
// 不含翻译/解析/rows。仅显示层修正不会让成绩过期；题干、正文、选项、答案变动会。
function assessmentRevision(db, examId) {
  const exam = query(db, 'SELECT * FROM exam WHERE id=?', [examId])[0];
  if (!exam) return null;
  const eid = exam.source_id || examKey(exam);
  const parts = query(db, "SELECT * FROM passage WHERE exam_id=? AND retired=0 AND section IN ('cloze','match','reading')", [examId]).map(p => {
    const pid = p.source_id || passageKey(eid, p);
    const questions = query(db, 'SELECT * FROM question WHERE passage_id=? AND retired=0', [p.id]).map(q =>
      [q.source_id || questionKey(pid, q), ...pick(q, ['qtype','stem','options','answer'])]).sort((a,b) => a[0].localeCompare(b[0]));
    return [pid, p.content, questions];
  }).sort((a,b) => a[0].localeCompare(b[0]));
  return hash(parts);
}
function syncBuiltinContent(db, seed, { recordHistory = true } = {}) {
  const exams = catalog(seed); // 先验证整个载荷，禁止按数组下标匹配题目。
  const revision = hash(exams.map(e => [e.source_id, pick(e, fields.exam), e.passages.map(p =>
    [p.source_id, pick(p, fields.passage), p.questions.map(q => [q.source_id, pick(q, fields.question)])])]));
  const summary = { added: 0, updated: 0, retired: 0, issues: 0, changed: false, revision };
  const timestamp = new Date().toISOString();
  function write(sql, params) { db.run(sql, params); summary.changed = true; }
  function archive(table, row) {
    if (!recordHistory) return;
    db.run('INSERT OR IGNORE INTO content_history VALUES (?,?,?,?,?,?)', [table, row.id, row.source_id || null, hash(row), JSON.stringify(row), timestamp]);
  }
  function retire(table, row) {
    if (row.retired) return;
    archive(table, row); write(`UPDATE ${table} SET retired=1 WHERE id=?`, [row.id]); summary.retired++;
  }
  function resolve(table, source, candidates) {
    const owned = candidates.filter(x => x.source_id === source.source_id);
    if (owned.length > 1) throw new Error('用户库身份重复: ' + source.source_id);
    if (owned.length) return owned[0];
    const legacy = candidates.filter(x => !x.source_id && !x.retired);
    if (legacy.length <= 1) return legacy[0];
    // 身份冲突不猜测，保留原行及其学习引用，再建立新的规范内容。
    for (const row of legacy) retire(table, row);
    const details = JSON.stringify({ entity: table, legacyIds: legacy.map(x => x.id) });
    write('INSERT OR IGNORE INTO content_sync_issue VALUES (?,?,?,?)', [hash([source.source_id, details]), source.source_id, details, timestamp]);
    summary.issues++;
    return null;
  }
  function upsert(table, source, current, parentName, parentId) {
    const desired = { ...source };
    // 种子没有提供的可选内容不抹掉用户本地生成的解析、翻译或范文。
    for (const name of table === 'passage' ? ['translation','reference','rows'] : table === 'question' ? ['answer','analysis'] : []) {
      if (!desired[name] && current?.[name]) desired[name] = current[name];
    }
    const values = pick(desired, fields[table]);
    const contentRevision = hash(values);
    if (!current) {
      const columns = [...fields[table], 'source_id','content_revision','retired'];
      const params = [...values, source.source_id, contentRevision, 0];
      if (parentName) { columns.push(parentName); params.push(parentId); }
      if (table === 'exam') { columns.push('imported','created_at'); params.push(0,timestamp); summary.added++; }
      write(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, params);
      return query(db, 'SELECT last_insert_rowid() id')[0].id;
    }
    const contentChanged = JSON.stringify(pick(current, fields[table])) !== JSON.stringify(values);
    if (contentChanged || current.retired) { archive(table, current); summary.updated++; }
    if (contentChanged || current.retired || current.source_id !== source.source_id || current.content_revision !== contentRevision) {
      write(`UPDATE ${table} SET ${fields[table].map(n => n + '=?').join(',')}, source_id=?,content_revision=?,retired=0 WHERE id=?`,
        [...values, source.source_id, contentRevision, current.id]);
    }
    return current.id;
  }
  db.run('BEGIN');
  try {
    for (const source of exams) {
      // 只在内置考次中寻找；导入同名考次拥有独立的学习记录和内容。
      const candidates = query(db, 'SELECT * FROM exam WHERE COALESCE(imported,0)=0').filter(e =>
        e.source_id === source.source_id || !e.source_id && examKey(e) === examKey(source));
      // 在任何退休/覆盖发生之前标记历史成绩使用的答案版本。
      for (const e of candidates) {
        if (query(db, 'SELECT id FROM attempt WHERE exam_id=? AND content_revision IS NULL LIMIT 1', [e.id]).length)
          write('UPDATE attempt SET content_revision=? WHERE exam_id=? AND content_revision IS NULL', [assessmentRevision(db,e.id), e.id]);
      }
      const examId = upsert('exam', source, resolve('exam', source, candidates));
      const usedPassages = new Set();
      for (const sp of source.passages) {
        const all = query(db, 'SELECT * FROM passage WHERE exam_id=?', [examId]);
        const match = resolve('passage', sp, all.filter(p => p.source_id === sp.source_id || !p.source_id && p.section === sp.section && p.seq === sp.seq));
        const pid = upsert('passage', sp, match, 'exam_id', examId); usedPassages.add(pid);
        const usedQuestions = new Set();
        for (const sq of sp.questions) {
          const allQuestions = query(db, 'SELECT * FROM question WHERE passage_id=?', [pid]);
          const mq = resolve('question', sq, allQuestions.filter(q => q.source_id === sq.source_id || !q.source_id && questionKey(sp.source_id,q) === questionKey(sp.source_id,sq)));
          usedQuestions.add(upsert('question', sq, mq, 'passage_id', pid));
        }
        for (const q of query(db, 'SELECT * FROM question WHERE passage_id=? AND retired=0', [pid])) if (!usedQuestions.has(q.id)) retire('question',q);
      }
      for (const p of query(db, 'SELECT * FROM passage WHERE exam_id=? AND retired=0', [examId])) if (!usedPassages.has(p.id)) retire('passage',p);
      const assessment = assessmentRevision(db, examId);
      if (query(db, 'SELECT assessment_revision FROM exam WHERE id=?', [examId])[0].assessment_revision !== assessment)
        write('UPDATE exam SET assessment_revision=? WHERE id=?', [assessment, examId]);
    }
    const previous = query(db, "SELECT revision FROM content_sync_state WHERE source='builtin:v1'")[0];
    if (summary.changed || previous?.revision !== revision)
      write("INSERT OR REPLACE INTO content_sync_state VALUES ('builtin:v1',?,1,?)", [revision,timestamp]);
    // 约束的建立与内容写入处于同一事务。
    for (const table of ['exam','passage','question']) db.run(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_source_identity ON ${table}(source_id) WHERE source_id IS NOT NULL`);
    db.run('COMMIT');
    return summary;
  } catch (error) { db.run('ROLLBACK'); throw error; }
}
function stampBuiltinContent(db) { ensureContentSchema(db); return syncBuiltinContent(db, db, { recordHistory: false }); }
module.exports = { ensureContentSchema, syncBuiltinContent, stampBuiltinContent, assessmentRevision };

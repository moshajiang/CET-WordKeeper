// 只在指定目录生成候选库和逐篇差异，不就地修改分发库或用户库。
import fs from 'node:fs';
import contentSync from '../electron/content-sync.cjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { alignBilingual, blankNumbers } from '../src/utils/bilingual.js';
import { buildAlignmentLex } from './lib/alignment-lex.mjs';
import { applyReviewedAlignment } from './lib/reviewed-alignment.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dependencies = process.env.KEEPER_DEPENDENCY_ROOT || root;
const require = createRequire(path.join(dependencies, 'package.json'));
const option = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const input = path.resolve(option('--db') || path.join(root, 'data/keeper.db'));
if (!option('--out') || option('--out').startsWith('--')) throw new Error('必须显式指定 --out 候选输出目录');
const directory = path.resolve(option('--out'));
const output = path.join(directory, 'keeper.candidate.db');
if (input.toLowerCase() === output.toLowerCase()) throw new Error('候选输出不能覆盖输入库');
if (fs.existsSync(output)) throw new Error('候选库已存在，请使用新的输出目录');
const bytes = fs.readFileSync(input);
const hash = data => createHash('sha256').update(data).digest('hex');
const SQL = await require('sql.js')({ locateFile: file => path.join(dependencies, 'node_modules/sql.js/dist', file) });
const db = new SQL.Database(new Uint8Array(bytes));
const query = (sql, params = []) => { const statement = db.prepare(sql); try { statement.bind(params); const result = []; while (statement.step()) result.push(statement.getAsObject()); return result; } finally { statement.free(); } };
function unchangedDataHash() {
  const tables = query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return hash(JSON.stringify(tables.map(({ name }) => {
    const columns = query(`PRAGMA table_info("${name}")`).map(row => row.name).filter(column => name !== 'passage' || column !== 'rows');
    return { name, columns, rows: query(`SELECT ${columns.map(column => '"' + column + '"').join(',')} FROM "${name}" ORDER BY rowid`) };
  })));
}
const unchangedBefore = unchangedDataHash();
const lex = buildAlignmentLex(query("SELECT word, translation, exchange FROM dict WHERE translation != ''"));
const passages = query("SELECT p.*, e.level, e.year, e.month, e.set_no, e.imported FROM passage p JOIN exam e ON e.id=p.exam_id WHERE p.translation IS NOT NULL AND p.translation != '' ORDER BY p.id");
const compact = value => String(value || '').replace(/\s/g, '');
function coverage(source, rows, language) {
  const expected = compact(source), actual = compact(rows.map(row => row[language] || '').join(''));
  const balance = new Map();
  for (const char of expected) balance.set(char, (balance.get(char) || 0) + 1);
  for (const char of actual) balance.set(char, (balance.get(char) || 0) - 1);
  let missing = 0, extra = 0;
  for (const count of balance.values()) { if (count > 0) missing += count; else extra -= count; }
  return { ordered: expected === actual, missing, extra };
}
const changed = [], regressions = [], legacyCoverage = [];
db.run('BEGIN');
try {
  for (const passage of passages) {
    passage.questions = query('SELECT * FROM question WHERE passage_id=? ORDER BY id', [passage.id]);
    const previous = passage.rows ? JSON.parse(passage.rows) : [];
    const rows = applyReviewedAlignment(passage,alignBilingual(passage.content, passage.translation, lex, { blankNums: blankNumbers(passage) }));
    const previousCoverage = { en: coverage(passage.content, previous, 'en'), zh: coverage(passage.translation, previous, 'zh') };
    const nextCoverage = { en: coverage(passage.content, rows, 'en'), zh: coverage(passage.translation, rows, 'zh') };
    const tag = `${passage.level} ${passage.year}.${passage.month} set${passage.set_no} ${passage.section}#${passage.seq}`;
    for (const language of ['en', 'zh']) {
      const before = previousCoverage[language], after = nextCoverage[language];
      if (before.missing || before.extra || !before.ordered) legacyCoverage.push({ id: passage.id, tag, language, coverage: before });
      if (after.missing > before.missing || after.extra > before.extra || before.ordered && !after.ordered) regressions.push({ id: passage.id, tag, language, before, after });
    }
    if (JSON.stringify(previous) !== JSON.stringify(rows)) changed.push({ id: passage.id, tag, previousCoverage, nextCoverage, previous, next: rows });
    db.run('UPDATE passage SET rows=? WHERE id=?', [JSON.stringify(rows), passage.id]);
  }
  db.run('COMMIT');
} catch (error) { db.run('ROLLBACK'); throw error; }
const unchangedAfter = unchangedDataHash();
if (unchangedBefore !== unchangedAfter) throw new Error('除 rows 之外的数据库记录发生变更');
if (hash(fs.readFileSync(input)) !== hash(bytes)) throw new Error('输入库在候选生成期间被修改');
fs.mkdirSync(directory, { recursive: true });
const report = { input, inputSha256: hash(bytes), unchangedDataSha256: unchangedBefore, total: passages.length, changed: changed.length,
  coverageRegressions: regressions, legacyCoverage, passages: changed };
fs.writeFileSync(path.join(directory, 'alignment-diff.json'), JSON.stringify(report, null, 2));
if (regressions.length) { console.error(`发现 ${regressions.length} 处文本保真退步，未输出候选数据库`); process.exitCode = 1; }
else { contentSync.stampBuiltinContent(db); db.run('VACUUM'); fs.writeFileSync(output, Buffer.from(db.export())); console.log(`候选已生成：${output}\n篇章 ${passages.length}，变化 ${changed.length}，保真退步 0；非 rows 数据保持一致。`); }
db.close();

// 给现有种子库生成带身份/版本元数据的候选，保持所有业务数据。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import contentSync from '../electron/content-sync.cjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dependencies = process.env.KEEPER_DEPENDENCY_ROOT || root;
const require = createRequire(path.join(dependencies,'package.json'));
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i+1]; };
if (!option('--db') || !option('--out')) throw new Error('必须显式指定 --db 输入库和 --out 新候选文件');
const input = path.resolve(option('--db')), output = path.resolve(option('--out'));
if (input.toLowerCase() === output.toLowerCase() || fs.existsSync(output)) throw new Error('候选不得覆盖输入或已有文件');
const bytes = fs.readFileSync(input);
const SQL = await require('sql.js')({ locateFile: f => path.join(dependencies,'node_modules/sql.js/dist',f) });
const db = new SQL.Database(new Uint8Array(bytes));
function query(sql) { const stmt = db.prepare(sql); try { const out=[]; while(stmt.step())out.push(stmt.getAsObject()); return out; } finally { stmt.free(); } }
const managed = new Set(['source_id','content_revision','assessment_revision','retired','source_order']);
const tables = query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(x => x.name);
const columns = new Map(tables.map(t => [t,query(`PRAGMA table_info(${t})`).map(x => x.name).filter(c => !managed.has(c))]));
const snapshot = () => JSON.stringify(tables.map(t => [t, query(`SELECT ${columns.get(t).join(',')} FROM ${t} ORDER BY rowid`)]));
const before = snapshot();
const summary = contentSync.stampBuiltinContent(db);
if (snapshot() !== before) throw new Error('业务数据发生变化，拒绝输出');
// 发布种子无需携带从空元数据升级时产生的归档；用户迁移会自行归档真实旧内容。
db.run('DELETE FROM content_history; DELETE FROM content_sync_issue;');
db.run('VACUUM'); // 仅分发候选压实，避免 ALTER/更新遗留空页增加安装载荷。
if (!fs.readFileSync(input).equals(bytes)) throw new Error('输入文件发生变化');
fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,Buffer.from(db.export()),{flag:'wx'});
console.log(JSON.stringify({ output, revision:summary.revision, businessDataUnchanged:true })); db.close();

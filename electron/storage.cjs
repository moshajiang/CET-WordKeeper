const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_word_hit_word ON word_hit(word)',
  'CREATE INDEX IF NOT EXISTS idx_review_log_word ON review_log(word_id)',
  'CREATE INDEX IF NOT EXISTS idx_review_log_day ON review_log(reviewed_at)',
  'CREATE INDEX IF NOT EXISTS idx_user_word_due ON user_word(status,due)',
];
function ensureStorageIndexes(db) { for (const sql of INDEXES) db.run(sql); }
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function rows(db, sql) {
  const statement = db.prepare(sql), result = [];
  try { while (statement.step()) result.push(statement.getAsObject()); return result; }
  finally { statement.free(); }
}

// Backups from 0.3.1 predate answer_draft/review_operation and content metadata.
// Require the complete original application schema, while permitting additive migrations.
function inspectBackup(SQL, bytes, schema) {
  if (bytes.length < 512 || bytes.length > 256 * 1024 * 1024 || bytes.subarray(0,16).toString() !== 'SQLite format 3\0') throw Error('请选择有效的 WordKeeper 数据库（最大 256 MB）');
  let candidate;
  try {
    candidate = new SQL.Database(new Uint8Array(bytes));
    if (rows(candidate,'PRAGMA integrity_check').some(row => Object.values(row)[0] !== 'ok')) throw Error('数据库完整性校验失败');
    if (rows(candidate,'PRAGMA user_version')[0].user_version > 1) throw Error('备份格式版本较新，请使用对应版本的软件恢复');
    if (rows(candidate,"SELECT name FROM sqlite_master WHERE type IN ('trigger','view')").length) throw Error('备份包含不支持的触发器或视图');
    for (const match of schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\(([\s\S]*?)\);/g)) {
      const [, table, definition] = match;
      const columns = rows(candidate,`PRAGMA table_info(${table})`).map(row => row.name);
      if (!columns.length && ['answer_draft','review_operation'].includes(table)) continue;
      const required = [...definition.matchAll(/(?:^|,)\s*(\w+)\s+(?:INTEGER|TEXT|REAL)\b/g)].map(m => m[1]);
      if (required.some(column => !columns.includes(column))) throw Error('备份缺少 WordKeeper 数据表或字段：'+table);
    }
    const versionTable = rows(candidate,"SELECT name FROM sqlite_master WHERE name='content_sync_state' AND type='table'");
    if (versionTable.length && rows(candidate,'SELECT schema_version FROM content_sync_state').some(row => row.schema_version > 1)) throw Error('内容格式版本较新，请升级软件后恢复');
    const counts = {};
    for (const table of ['exam','user_word','review_log','attempt','essay']) counts[table] = rows(candidate,`SELECT COUNT(*) count FROM ${table}`)[0].count;
    return { bytes:bytes.length, sha256:hash(bytes), counts };
  } catch (error) { throw Error('备份校验失败：'+error.message); }
  finally { candidate?.close(); }
}

function atomicWrite(file, bytes, io = fs) {
  const temp = file+'.write-'+randomUUID();
  try {
    const fd = io.openSync(temp,'wx');
    try { io.writeFileSync(fd,bytes); io.fsyncSync(fd); } finally { io.closeSync(fd); }
    if (hash(io.readFileSync(temp)) !== hash(bytes)) throw Error('文件写入校验失败');
    io.renameSync(temp,file);
  } finally { if (io.existsSync(temp)) io.unlinkSync(temp); }
}

// Never replace the live database in the process that still owns renderer/AI work.
// A durable journal fences shutdown and lets the next process apply or roll back.
function createRestoreStore({ directory, SQL, schema, io = fs }) {
  const database = path.join(directory,'keeper.db'), journal = path.join(directory,'restore-pending.json'), stateFile = path.join(directory,'restore-state.json');
  let preview = null;
  const json = (file,value) => atomicWrite(file,Buffer.from(JSON.stringify(value)),io);
  const state = () => io.existsSync(stateFile) ? JSON.parse(io.readFileSync(stateFile,'utf8')) : {epoch:'original'};
  const paths = token => ({ candidate:path.join(directory,`restore-${token}.db`), backup:path.join(directory,`keeper.pre-restore-${token}.db`) });
  const verified = (file,expected) => { const bytes = io.readFileSync(file); if (hash(bytes) !== expected) throw Error('恢复文件校验值不匹配'); return bytes; };
  function readJob() {
    const job = JSON.parse(io.readFileSync(journal,'utf8'));
    if (job.version !== 1 || !/^[a-f0-9-]{36}$/.test(job.token) || !['queued','applying','completed'].includes(job.phase) || !/^[a-f0-9]{64}$/.test(job.beforeHash) || !/^[a-f0-9]{64}$/.test(job.afterHash)) throw Error('恢复任务文件无效，请保留文件并联系维护者');
    return job;
  }
  function finalize(job) {
    json(stateFile,{epoch:job.token,status:'restored',backupPath:paths(job.token).backup,time:new Date().toISOString()});
    try { io.unlinkSync(journal); } catch { /* completed journal is safe to finalize again */ }
  }
  function rollback(job,error) {
    const backup = paths(job.token).backup;
    atomicWrite(database,verified(backup,job.beforeHash),io);
    json(stateFile,{...state(),status:'failed',error:String(error.message||error),backupPath:backup,time:new Date().toISOString()});
    io.unlinkSync(journal);
  }
  return {
    state,
    preview(bytes,filePath) {
      preview = null;
      const summary = inspectBackup(SQL,bytes,schema);
      preview = { token:randomUUID(), bytes:Buffer.from(bytes), summary, filePath, expires:Date.now()+10*60*1000 };
      return {ok:true,token:preview.token,path:filePath,...summary};
    },
    cancel() { preview = null; },
    queue(token,currentBytes) {
      if (!preview || preview.token !== token || preview.expires < Date.now()) throw Error('恢复预览已失效，请重新选择备份');
      if (io.existsSync(journal)) throw Error('已有待处理恢复任务，请先重启软件');
      const current = Buffer.from(currentBytes), selected = preview, files = paths(token);
      inspectBackup(SQL,current,schema);
      // Exclusive names, exact byte copies and verification; a failed preparation never touches keeper.db.
      io.writeFileSync(files.backup,current,{flag:'wx'});
      verified(files.backup,hash(current));
      io.writeFileSync(files.candidate,selected.bytes,{flag:'wx'});
      verified(files.candidate,selected.summary.sha256);
      // Flush both files before publishing the journal.
      for (const file of [files.backup,files.candidate]) { const fd=io.openSync(file,'r+');try{io.fsyncSync(fd);}finally{io.closeSync(fd);} }
      json(journal,{version:1,token,phase:'queued',beforeHash:hash(current),afterHash:selected.summary.sha256});
      preview = null;
      return {ok:true,backupPath:files.backup};
    },
    begin() {
      if (!io.existsSync(journal)) return null;
      const job = readJob();
      if (job.phase === 'completed') { finalize(job); return null; }
      if (job.phase === 'applying') { rollback(job,Error('上次恢复被中断，已退回恢复前数据')); return null; }
      try {
        const bytes = verified(paths(job.token).candidate,job.afterHash);
        verified(paths(job.token).backup,job.beforeHash);
        inspectBackup(SQL,bytes,schema);
        json(journal,{...job,phase:'applying'});
        atomicWrite(database,bytes,io);
        return job;
      } catch (error) { rollback(job,error); return null; }
    },
    finish(job) {
      json(stateFile,{epoch:job.token,status:'restored',backupPath:paths(job.token).backup,time:new Date().toISOString()});
      json(journal,{...job,phase:'completed'});
      try { io.unlinkSync(journal); } catch { /* completed journal finalizes on next startup */ }
    },
    rollback,
  };
}
module.exports = { ensureStorageIndexes, inspectBackup, atomicWrite, createRestoreStore };

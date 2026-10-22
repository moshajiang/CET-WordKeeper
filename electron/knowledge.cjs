const {createHash} = require('node:crypto');
const {locateQuote} = require('./page-assistant.cjs');
const CATEGORIES = ['基础知识', '真题笔记', '我的薄弱点', '未分类'];
// Additive migration: keep the original SCHEMA so backups from earlier versions still pass inspection.
function ensureKnowledgeSchema(db) {
  const columns = new Set(db.exec('PRAGMA table_info(kb_entry)')[0].values.map(row => row[1]));
  for (const [name, definition] of Object.entries({category:"TEXT DEFAULT '未分类'",tags:"TEXT DEFAULT '[]'",updated_at:'TEXT',origin:"TEXT DEFAULT 'manual'",anchor:'TEXT'})) {
    if (!columns.has(name)) db.run(`ALTER TABLE kb_entry ADD COLUMN ${name} ${definition}`);
  }
}
function parse(value, fallback) { try { return JSON.parse(value) ?? fallback; } catch { return fallback; } }
function field(value, max, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`${name}不能为空，且不能超过 ${max} 字`);
  return value.trim();
}
// Derive browse tags from the existing heading convention; titles remain stable entry IDs.
function builtinTags(title) {
  const [section, subject=''] = title.split(' · ');
  const topic = subject.replace(/（.*$/, '').trim();
  const group = section === '题型套路' ? (subject.includes('写作') ? '写作' : subject.includes('翻译') ? '翻译' : '阅读') : section;
  return [...new Set([...(section === '题型套路' ? ['题型方法'] : []), group, topic].filter(Boolean))];
}
function createKnowledgeStore({q,run,persistTransaction,now,builtin}) {
  const builtinEntries = () => builtin().map(e => ({...e,key:'builtin:'+createHash('sha256').update(e.title).digest('hex').slice(0,20),source:'builtin',category:'基础知识',tags:builtinTags(e.title),origin:'builtin',anchor:null}));
  const userEntry = e => ({...e,key:'user:'+e.id,category:e.category||'未分类',tags:parse(e.tags,[]),origin:e.origin||'manual',anchor:parse(e.anchor,null),updated_at:e.updated_at||e.created_at});
  function get(key) {
    if (typeof key !== 'string') throw Error('条目不存在');
    if (key.startsWith('builtin:')) { const e=builtinEntries().find(e=>e.key===key);if(e)return e; }
    else if (/^user:[1-9]\d*$/.test(key)) { const e=q("SELECT * FROM kb_entry WHERE source='user' AND id=?",[Number(key.slice(5))])[0];if(e)return userEntry(e); }
    throw Error('条目不存在或已删除');
  }
  function list(filters={}) {
    const query=String(filters.query||'').trim().toLowerCase().slice(0,200),terms=query.split(/\s+/).filter(Boolean);
    const all=[...q("SELECT * FROM kb_entry WHERE source='user' ORDER BY COALESCE(updated_at,created_at) DESC,id DESC").map(userEntry),...builtinEntries()];
    const entries=all.filter(e=>(!filters.source||e.source===filters.source)&&(!filters.category||e.category===filters.category)&&(!filters.tag||e.tags.includes(filters.tag))&&terms.every(t=>(e.title+'\n'+e.content+'\n'+e.tags.join(' ')).toLowerCase().includes(t)))
      .map(({content,...e})=>{const index=query?content.toLowerCase().indexOf(terms[0]):-1;return {...e,preview:content.slice(Math.max(0,index-25),Math.max(0,index-25)+110),length:content.length};});
    return {entries,total:all.length,categories:CATEGORIES,tags:[...new Set(all.flatMap(e=>e.tags))].sort()};
  }
  function resolveAnchor(anchor) {
    if (!anchor || !Number.isSafeInteger(anchor.examId)||!Number.isSafeInteger(anchor.passageId)||typeof anchor.quote!=='string'||anchor.quote.length>4000) throw Error('原文来源无效');
    const source=q('SELECT p.content,p.title,p.section,e.level,e.year,e.month,e.set_no FROM passage p JOIN exam e ON e.id=p.exam_id WHERE p.id=? AND e.id=? AND p.retired=0 AND e.retired=0',[anchor.passageId,anchor.examId])[0];
    if(!source)throw Error('来源篇章已移除，笔记正文仍然保留');
    let located;try {located=locateQuote(source.content,anchor.quote,anchor.occurrence);} catch {throw Error('来源原文已变化，无法准确定位，笔记正文仍然保留');}
    return {examId:anchor.examId,passageId:anchor.passageId,quote:located.quote,occurrence:located.occurrence,label:`${source.level} · ${source.year} 年 ${source.month} 月 · 第 ${source.set_no} 套 · ${source.title||source.section}`};
  }
  function save(payload) {
    if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('条目数据无效');
    const existing=payload.key?get(payload.key):null;
    if(existing?.source==='builtin')throw Error('内置资料只读，可复制为我的笔记');
    if(existing&&payload.expectedUpdatedAt!==undefined&&payload.expectedUpdatedAt!==existing.updated_at)throw Error('条目已更新，请重新打开后再编辑');
    const title=field(payload.title,160,'标题'),content=field(payload.content,100000,'内容'),category=payload.category||'未分类';
    if(!CATEGORIES.includes(category))throw Error('分类无效');
    if(!Array.isArray(payload.tags||[])||(payload.tags||[]).length>12)throw Error('标签最多 12 个');
    const tags=[...new Set((payload.tags||[]).map(t=>field(t,30,'标签')))];
    const anchor=existing?.anchor||(payload.anchor?resolveAnchor(payload.anchor):null);
    const origin=existing?.origin||(anchor&&payload.origin==='ai'?'ai':'manual');
    return persistTransaction(()=>{
      const timestamp=now();let id=existing?.id;
      if(existing)run("UPDATE kb_entry SET title=?,content=?,category=?,tags=?,updated_at=? WHERE id=? AND source='user'",[title,content,category,JSON.stringify(tags),timestamp,id]);
      else {run("INSERT INTO kb_entry(title,content,source,created_at,category,tags,updated_at,origin,anchor) VALUES (?,?,'user',?,?,?,?,?,?)",[title,content,timestamp,category,JSON.stringify(tags),timestamp,origin,anchor?JSON.stringify(anchor):null]);id=q('SELECT last_insert_rowid() id')[0].id;}
      return {ok:true,id,key:'user:'+id};
    });
  }
  function remove(id) {
    if(!Number.isSafeInteger(id)||id<=0)throw Error('条目编号无效');
    if(!q("SELECT id FROM kb_entry WHERE source='user' AND id=?",[id]).length)throw Error('条目不存在或已删除');
    return persistTransaction(()=>{run("DELETE FROM kb_entry WHERE id=? AND source='user'",[id]);return {ok:true};});
  }
  function source(key) {const entry=get(key);if(!entry.anchor)throw Error('此条目没有关联原文');return {...resolveAnchor(entry.anchor),title:entry.title,explanation:entry.content,key:entry.key};}
  return {get,list,save,remove,source};
}
module.exports={ensureKnowledgeSchema,createKnowledgeStore,CATEGORIES};

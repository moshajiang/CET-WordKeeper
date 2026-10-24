const {createHash,randomUUID}=require('node:crypto');
const {locateQuote}=require('./page-assistant.cjs');
const digest=value=>createHash('sha256').update(value).digest('hex');
const identity=value=>{if(typeof value!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))throw Error('短语或操作编号无效');return value;};
const text=(value,max,name,empty=false)=>{if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw Error(name+'无效');return value.trim();};
function ensurePhraseSchema(db){db.run(`CREATE TABLE IF NOT EXISTS phrase_item(
 id TEXT PRIMARY KEY,exam_id INTEGER NOT NULL,passage_id INTEGER NOT NULL,quote TEXT NOT NULL,occurrence INTEGER NOT NULL,
 start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,content_hash TEXT NOT NULL,context TEXT NOT NULL,source_label TEXT NOT NULL,
 meaning TEXT NOT NULL,note TEXT NOT NULL,tags TEXT NOT NULL,fingerprint TEXT NOT NULL UNIQUE,revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
 CREATE INDEX IF NOT EXISTS idx_phrase_passage ON phrase_item(passage_id);
 CREATE TABLE IF NOT EXISTS phrase_operation(id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,result TEXT NOT NULL);`);}
function createPhraseStore({q,run,persistTransaction,now}){
 function passage(examId,passageId){if(!Number.isSafeInteger(examId)||!Number.isSafeInteger(passageId))throw Error('篇章编号无效');return q('SELECT p.*,e.level,e.year,e.month,e.set_no FROM passage p JOIN exam e ON p.exam_id=e.id WHERE e.id=? AND p.id=? AND p.retired=0 AND e.retired=0',[examId,passageId])[0]||null;}
 function raw(id){identity(id);const row=q('SELECT * FROM phrase_item WHERE id=?',[id])[0];if(!row)throw Error('短语不存在');return row;}
 function decode(row,sourceStatus){if(sourceStatus===undefined){const p=passage(row.exam_id,row.passage_id);sourceStatus=!p?'unavailable':digest(p.content)===row.content_hash?'current':'changed';}return {...row,tags:JSON.parse(row.tags),sourceStatus};}
 function get(id){return decode(raw(id));}
 function fields(payload){const meaning=text(payload.meaning,2000,'释义'),note=text(payload.note??'',5000,'备注',true);if(!Array.isArray(payload.tags??[])||(payload.tags??[]).length>12)throw Error('标签最多 12 个');return {meaning,note,tags:[...new Set((payload.tags??[]).map(t=>text(t,30,'标签')))]};}
 function prepare(payload){
  const p=passage(payload?.examId,payload?.passageId);if(!p)throw Error('来源篇章已移除');
  const quote=text(payload.quote,240,'划选短语'),located=locateQuote(p.content,quote,payload.occurrence),words=quote.match(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g)||[];
  if(words.length<2||words.length>12||/[^A-Za-z0-9\s’'“”".,;:!?()\-–—]/u.test(quote))throw Error('请选择 2 至 12 个英文单词的短语');
  if((located.start>0&&/[A-Za-z’'\-]/.test(p.content[located.start-1])&&/^[A-Za-z]/.test(located.quote))||(/[A-Za-z]$/.test(located.quote)&&/[A-Za-z’'\-]/.test(p.content[located.end]||'')))throw Error('请完整划选单词');
  const sourceLabel=[p.level,p.year+' 年 '+p.month+' 月','第 '+p.set_no+' 套',p.title||p.section].join(' · ');
  return {examId:p.exam_id,passageId:p.id,quote:located.quote,occurrence:located.occurrence,start:located.start,end:located.end,contentHash:digest(p.content),context:p.content.slice(Math.max(0,located.start-180),Math.min(p.content.length,located.end+180)).trim(),sourceLabel};
 }
 function save(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('短语数据无效');identity(payload.operationId);const f=fields(payload);
  const payloadHash=digest(JSON.stringify([payload.examId,payload.passageId,payload.quote,payload.occurrence,payload.contentHash,f])),cached=q('SELECT * FROM phrase_operation WHERE id=?',[payload.operationId])[0];
  if(cached){if(cached.payload_hash!==payloadHash)throw Error('保存内容与原操作不一致');return JSON.parse(cached.result);}
  const anchor=prepare(payload);if(anchor.contentHash!==payload.contentHash)throw Error('原文已变化，请重新划选短语');
  const fingerprint=digest(JSON.stringify([anchor.examId,anchor.passageId,anchor.contentHash,anchor.start,anchor.end])),old=q('SELECT id,deleted_at FROM phrase_item WHERE fingerprint=?',[fingerprint])[0];
  if(old?.deleted_at)throw Error('这处短语已在回收站，请到短语收藏恢复');
  return persistTransaction(()=>{
   const id=old?.id||randomUUID(),at=now();
   if(!old)run('INSERT INTO phrase_item VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,NULL)',[id,anchor.examId,anchor.passageId,anchor.quote,anchor.occurrence,anchor.start,anchor.end,anchor.contentHash,anchor.context,anchor.sourceLabel,f.meaning,f.note,JSON.stringify(f.tags),fingerprint,at,at]);
   const result={ok:true,id,duplicate:!!old};run('INSERT INTO phrase_operation VALUES(?,?,?)',[payload.operationId,payloadHash,JSON.stringify(result)]);return result;
  });
 }
 function list(filters={}){if(!filters||typeof filters!=='object'||Array.isArray(filters)||(filters.deleted!==undefined&&typeof filters.deleted!=='boolean'))throw Error('筛选参数无效');const query=String(filters.query||'').toLowerCase().slice(0,200),terms=query.split(/\s+/).filter(Boolean),hashes=new Map(q('SELECT p.id,p.content FROM passage p JOIN exam e ON p.exam_id=e.id WHERE p.retired=0 AND e.retired=0 AND p.id IN (SELECT passage_id FROM phrase_item)').map(p=>[p.id,digest(p.content)])),all=q(`SELECT * FROM phrase_item WHERE deleted_at IS ${filters.deleted?'NOT ':''}NULL ORDER BY updated_at DESC,id DESC`).map(row=>decode(row,!hashes.has(row.passage_id)?'unavailable':hashes.get(row.passage_id)===row.content_hash?'current':'changed')),entries=all.filter(e=>(!filters.tag||e.tags.includes(filters.tag))&&terms.every(t=>(e.quote+'\n'+e.meaning+'\n'+e.context+'\n'+e.note+'\n'+e.source_label+'\n'+e.tags.join(' ')).toLowerCase().includes(t)));return {entries,total:all.length,tags:[...new Set(all.flatMap(e=>e.tags))].sort()};}
 function checked(payload){const row=raw(payload?.id);if(!Number.isSafeInteger(payload.expectedRevision)||row.revision!==payload.expectedRevision)throw Error('短语已更新，请重新打开');return row;}
 function edit(payload){const row=checked(payload);if(row.deleted_at)throw Error('请先恢复短语');const f=fields(payload);return persistTransaction(()=>{run('UPDATE phrase_item SET meaning=?,note=?,tags=?,revision=revision+1,updated_at=? WHERE id=?',[f.meaning,f.note,JSON.stringify(f.tags),now(),row.id]);return {ok:true,id:row.id};});}
 function state(payload){const row=checked(payload);if(!['remove','restore'].includes(payload.action)||!!row.deleted_at!==(payload.action==='restore'))throw Error('短语状态已变化，请重新加载');return persistTransaction(()=>{const at=now();run('UPDATE phrase_item SET deleted_at=?,revision=revision+1,updated_at=? WHERE id=?',[payload.action==='remove'?at:null,at,row.id]);return {ok:true,id:row.id};});}
 function anchor(id){const row=get(id);if(row.deleted_at)throw Error('请先恢复短语');if(row.sourceStatus!=='current')throw Error(row.sourceStatus==='changed'?'原文已变化，请阅读保存的上下文':'来源篇章已移除，请阅读保存的上下文');return {examId:row.exam_id,passageId:row.passage_id,quote:row.quote,occurrence:row.occurrence,title:row.quote,explanation:row.meaning+(row.note?'\n\n'+row.note:'')};}
 function source(key){const row=get(typeof key==='string'&&key.startsWith('phrase:')?key.slice(7):key);if(row.deleted_at)throw Error('短语已移入回收站');return {key:'phrase:'+row.id,title:'短语 · '+row.quote,content:['短语：'+row.quote,'原文上下文：\n'+row.context,'此处释义：'+row.meaning,row.note?'备注：'+row.note:'','出处：'+row.source_label].filter(Boolean).join('\n\n'),tags:[...new Set(['短语',...row.tags])],source:'phrase',phrase:row};}
 return {prepare,save,get,list,edit,state,anchor,source};
}
module.exports={ensurePhraseSchema,createPhraseStore};

const {createHash,randomUUID}=require('node:crypto');
const {locateQuote}=require('./page-assistant.cjs');
const digest=value=>createHash('sha256').update(value).digest('hex');
const identity=value=>{if(typeof value!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))throw Error('收藏或操作编号无效');return value;};
const text=(value,max,name,empty=false)=>{if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw Error(name+'无效');return value.trim();};
function ensurePhraseSchema(db){db.run(`CREATE TABLE IF NOT EXISTS phrase_item(
 id TEXT PRIMARY KEY,exam_id INTEGER NOT NULL,passage_id INTEGER NOT NULL,quote TEXT NOT NULL,occurrence INTEGER NOT NULL,
 start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,content_hash TEXT NOT NULL,context TEXT NOT NULL,source_label TEXT NOT NULL,
 meaning TEXT NOT NULL,note TEXT NOT NULL,tags TEXT NOT NULL,fingerprint TEXT NOT NULL UNIQUE,revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
 CREATE INDEX IF NOT EXISTS idx_phrase_passage ON phrase_item(passage_id);
 CREATE TABLE IF NOT EXISTS phrase_operation(id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,result TEXT NOT NULL);`);

 const columns=new Set(db.exec('PRAGMA table_info(phrase_item)')[0].values.map(r=>r[1]));
 if(!columns.has('kind'))db.run("ALTER TABLE phrase_item ADD COLUMN kind TEXT NOT NULL DEFAULT 'phrase'");
 if(!columns.has('lemma'))db.run("ALTER TABLE phrase_item ADD COLUMN lemma TEXT NOT NULL DEFAULT ''");
 if(!columns.has('context_offset'))db.run('ALTER TABLE phrase_item ADD COLUMN context_offset INTEGER');
 db.run('CREATE INDEX IF NOT EXISTS idx_context_kind_lemma ON phrase_item(kind,lemma,deleted_at)');
}
function createPhraseStore({q,run,persistTransaction,now,resolveWord=raw=>({word:raw,exact:false})}){
 const marked=(context,quote,offset)=>Number.isSafeInteger(offset)&&offset>=0&&context.slice(offset,offset+quote.length)===quote?context.slice(0,offset)+'【'+quote+'】'+context.slice(offset+quote.length):null;
 const kindOf=value=>{const kind=value===undefined?'phrase':value;if(!['phrase','sense'].includes(kind))throw Error('收藏类型无效');return kind;};
 const lemmaOf=raw=>{const surface=raw.toLowerCase().replace(/’/g,"'"),resolved=resolveWord(surface);return resolved.exact?resolved.word:surface;};
 function passage(examId,passageId){if(!Number.isSafeInteger(examId)||!Number.isSafeInteger(passageId))throw Error('篇章编号无效');return q('SELECT p.*,e.level,e.year,e.month,e.set_no FROM passage p JOIN exam e ON p.exam_id=e.id WHERE e.id=? AND p.id=? AND p.retired=0 AND e.retired=0',[examId,passageId])[0]||null;}
 function raw(id){identity(id);const row=q('SELECT * FROM phrase_item WHERE id=?',[id])[0];if(!row)throw Error('收藏不存在');return row;}
 function decode(row,sourceStatus){if(sourceStatus===undefined){const p=passage(row.exam_id,row.passage_id);sourceStatus=!p?'unavailable':digest(p.content)===row.content_hash?'current':'changed';}return {...row,tags:JSON.parse(row.tags),sourceStatus,markedContext:marked(row.context,row.quote,row.context_offset)};}
 function get(id){const row=decode(raw(id));if(row.context_offset===null&&row.sourceStatus==='current'){const p=passage(row.exam_id,row.passage_id),start=Math.max(0,row.start_offset-180),fragment=p.content.slice(start,Math.min(p.content.length,row.end_offset+180));if(fragment.trim()===row.context){row.context_offset=row.start_offset-start-(fragment.length-fragment.trimStart().length);row.markedContext=marked(row.context,row.quote,row.context_offset);}}if(row.kind==='sense')row.related=q("SELECT id,quote,meaning,context,source_label FROM phrase_item WHERE kind='sense' AND lemma=? AND deleted_at IS NULL AND id!=? ORDER BY updated_at DESC,id LIMIT 20",[row.lemma,row.id]);return row;}
 function fields(payload){const meaning=text(payload.meaning,2000,'释义'),note=text(payload.note??'',5000,'备注',true);if(!Array.isArray(payload.tags??[])||(payload.tags??[]).length>12)throw Error('标签最多 12 个');return {meaning,note,tags:[...new Set((payload.tags??[]).map(t=>text(t,30,'标签')))]};}
 function prepare(payload){
  const kind=kindOf(payload?.kind),p=passage(payload?.examId,payload?.passageId);if(!p)throw Error('来源篇章已移除');
  const quote=text(payload.quote,240,'划选短语'),located=locateQuote(p.content,quote,payload.occurrence),words=quote.match(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g)||[];
  if(kind==='sense'){if(!/^[A-Za-z]+(?:['’\-][A-Za-z]+)*$/.test(quote))throw Error('请完整选择一个英文单词来保存语境义');}
  else if(words.length<2||words.length>12||/[^A-Za-z0-9\s’'“”".,;:!?()\-–—]/u.test(quote))throw Error('请选择 2 至 12 个英文单词的短语');
  if((located.start>0&&/[\p{L}\p{N}_’'\-]/u.test(p.content[located.start-1])&&/^[A-Za-z]/.test(located.quote))||(/[A-Za-z]$/.test(located.quote)&&/[\p{L}\p{N}_’'\-]/u.test(p.content[located.end]||'')))throw Error('请完整划选单词');
  const windowStart=Math.max(0,located.start-180),fragment=p.content.slice(windowStart,Math.min(p.content.length,located.end+180)),context=fragment.trim(),contextOffset=located.start-windowStart-(fragment.length-fragment.trimStart().length);
  const sourceLabel=[p.level,p.year+' 年 '+p.month+' 月','第 '+p.set_no+' 套',p.title||p.section].join(' · ');
  return {kind,lemma:kind==='sense'?lemmaOf(located.quote):'',examId:p.exam_id,passageId:p.id,quote:located.quote,occurrence:located.occurrence,start:located.start,end:located.end,contentHash:digest(p.content),context,contextOffset,markedContext:marked(context,located.quote,contextOffset),sourceLabel};
 }
 function save(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('收藏数据无效');identity(payload.operationId);const f=fields(payload),kind=kindOf(payload.kind);
  const payloadHash=digest(JSON.stringify([payload.examId,payload.passageId,payload.quote,payload.occurrence,payload.contentHash,f,...(kind==='sense'?['sense']:[])])),cached=q('SELECT * FROM phrase_operation WHERE id=?',[payload.operationId])[0];
  if(cached){if(cached.payload_hash!==payloadHash)throw Error('保存内容与原操作不一致');return JSON.parse(cached.result);}
  const anchor=prepare(payload);if(anchor.contentHash!==payload.contentHash)throw Error('原文已变化，请重新划选短语');
  const fingerprint=digest(JSON.stringify([anchor.examId,anchor.passageId,anchor.contentHash,anchor.start,anchor.end,...(kind==='sense'?['sense']:[])])),old=q('SELECT id,deleted_at FROM phrase_item WHERE fingerprint=?',[fingerprint])[0];
  if(old?.deleted_at)throw Error('这处收藏已在回收站，请先恢复');
  return persistTransaction(()=>{
   const id=old?.id||randomUUID(),at=now();
   if(!old)run('INSERT INTO phrase_item(id,exam_id,passage_id,quote,occurrence,start_offset,end_offset,content_hash,context,source_label,meaning,note,tags,fingerprint,revision,created_at,updated_at,deleted_at,kind,lemma,context_offset) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,NULL,?,?,?)',[id,anchor.examId,anchor.passageId,anchor.quote,anchor.occurrence,anchor.start,anchor.end,anchor.contentHash,anchor.context,anchor.sourceLabel,f.meaning,f.note,JSON.stringify(f.tags),fingerprint,at,at,kind,anchor.lemma,anchor.contextOffset]);
   const result={ok:true,id,duplicate:!!old};run('INSERT INTO phrase_operation VALUES(?,?,?)',[payload.operationId,payloadHash,JSON.stringify(result)]);return result;
  });
 }
 function list(filters={}){if(!filters||typeof filters!=='object'||Array.isArray(filters)||(filters.deleted!==undefined&&typeof filters.deleted!=='boolean'))throw Error('筛选参数无效');const kind=kindOf(filters.kind),lemma=filters.lemma?lemmaOf(text(filters.lemma,240,'词形')):'',query=String(filters.query||'').toLowerCase().slice(0,200),terms=query.split(/\s+/).filter(Boolean),hashes=new Map(q('SELECT p.id,p.content FROM passage p JOIN exam e ON p.exam_id=e.id WHERE p.retired=0 AND e.retired=0 AND p.id IN (SELECT passage_id FROM phrase_item)').map(p=>[p.id,digest(p.content)])),all=q(`SELECT * FROM phrase_item WHERE kind=? AND deleted_at IS ${filters.deleted?'NOT ':''}NULL ORDER BY updated_at DESC,id DESC`,[kind]).map(row=>decode(row,!hashes.has(row.passage_id)?'unavailable':hashes.get(row.passage_id)===row.content_hash?'current':'changed')),entries=all.filter(e=>(!lemma||e.lemma===lemma)&&(!filters.tag||e.tags.includes(filters.tag))&&terms.every(t=>(e.quote+'\n'+e.lemma+'\n'+e.meaning+'\n'+e.context+'\n'+e.note+'\n'+e.source_label+'\n'+e.tags.join(' ')).toLowerCase().includes(t)));return {entries,total:all.length,tags:[...new Set(all.flatMap(e=>e.tags))].sort()};}
 function checked(payload){const row=raw(payload?.id);if(!Number.isSafeInteger(payload.expectedRevision)||row.revision!==payload.expectedRevision)throw Error('收藏已更新，请重新打开');return row;}
 function edit(payload){const row=checked(payload);if(row.deleted_at)throw Error('请先恢复收藏');const f=fields(payload);return persistTransaction(()=>{run('UPDATE phrase_item SET meaning=?,note=?,tags=?,revision=revision+1,updated_at=? WHERE id=?',[f.meaning,f.note,JSON.stringify(f.tags),now(),row.id]);return {ok:true,id:row.id};});}
 function state(payload){const row=checked(payload);if(!['remove','restore'].includes(payload.action)||!!row.deleted_at!==(payload.action==='restore'))throw Error('收藏状态已变化，请重新加载');return persistTransaction(()=>{const at=now();run('UPDATE phrase_item SET deleted_at=?,revision=revision+1,updated_at=? WHERE id=?',[payload.action==='remove'?at:null,at,row.id]);return {ok:true,id:row.id};});}
 function anchor(id){const row=get(id);if(row.deleted_at)throw Error('请先恢复短语');if(row.sourceStatus!=='current')throw Error(row.sourceStatus==='changed'?'原文已变化，请阅读保存的上下文':'来源篇章已移除，请阅读保存的上下文');return {examId:row.exam_id,passageId:row.passage_id,quote:row.quote,occurrence:row.occurrence,title:row.quote,kind:row.kind,lemma:row.lemma,explanation:row.meaning+(row.note?'\n\n'+row.note:'')};}
 function source(key){
  if(typeof key!=='string'||! /^(phrase|sense):/.test(key))throw Error('收藏来源无效');
  const parts=key.split(':');if(parts.length!==2)throw Error('收藏来源无效');const [prefix,id]=parts,row=get(id);if(row.kind!==(prefix==='sense'?'sense':'phrase'))throw Error('收藏来源类型不匹配');if(row.deleted_at)throw Error('收藏已移入回收站');
  const label=row.kind==='sense'?'语境义':'短语',autoTag=label,tags=row.tags.includes(autoTag)||row.tags.length===12?row.tags:[autoTag,...row.tags];
  return {key:prefix+':'+row.id,title:label+' · '+(row.lemma||row.quote),content:[label+'：'+row.quote,row.kind==='sense'?'归一词形：'+row.lemma:'','原文上下文：\n'+(row.kind==='sense'?row.markedContext||row.context:row.context),'此处释义：'+row.meaning,row.note?'备注：'+row.note:'','出处：'+row.source_label].filter(Boolean).join('\n\n'),tags,source:prefix,...(row.kind==='sense'?{sense:row}:{phrase:row})};
 }

 return {prepare,save,get,list,edit,state,anchor,source};
}
module.exports={ensurePhraseSchema,createPhraseStore};

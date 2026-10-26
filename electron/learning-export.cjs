const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {atomicWrite}=require('./storage.cjs'),{escapeHtml}=require('./word-semantics.cjs'),{captureSourceAnchor}=require('./source-provenance.cjs');
const TYPES=['recall','translation','judgment','choice','spelling','cloze'],MAX_ITEMS=5000,MAX_REVIEWS=50000,MAX_BYTES=32*1024*1024,MAX_TEXT=4*1024*1024,TTL=10*60*1000;
const sha=value=>createHash('sha256').update(value).digest('hex');
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
function parse(value,fallback=null){if(value==null)return fallback;if(typeof value==='object')return value;try{return JSON.parse(value);}catch{throw Error('记录格式损坏，请先检查资料');}}
const sourceHash=s=>sha(JSON.stringify([s.title,s.content]));
const html=value=>escapeHtml(value??'').replace(/\r\n?|\n/g,'<br>').replace(/\t/g,'&#9;');
const tsv=value=>/[\t\n\r"]/.test(value)?'"'+value.replace(/"/g,'""')+'"':value;
const within=(file,base)=>{const rel=path.relative(base.toLowerCase(),file.toLowerCase());return rel===''||!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};
function validateExportTarget(file,format,{userData,appDir,database},io=fs){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0'))throw Error('请选择绝对文件路径');
 const target=path.resolve(file),ext=path.extname(target).toLowerCase();if(!(format==='json'?['.json']:['.txt','.tsv']).includes(ext))throw Error(format==='json'?'JSON 档案请保存为 .json':'Anki 文本请保存为 .txt 或 .tsv');
 const resolved=path.join(io.realpathSync(path.dirname(target)),path.basename(target)),canonical=dir=>io.existsSync(dir)?io.realpathSync(dir):path.resolve(dir),user=canonical(userData),app=canonical(appDir);
 if(within(resolved,app)||within(target,path.resolve(appDir))||(within(resolved,user)&&!within(resolved,path.join(user,'exports')))||(within(target,path.resolve(userData))&&!within(target,path.join(path.resolve(userData),'exports')))||resolved.toLowerCase()===path.resolve(database).toLowerCase())throw Error('请选择应用和用户数据目录以外的位置，或用户数据目录中的 exports 文件夹');
 if(io.existsSync(target)){const stat=io.lstatSync(target);if(stat.isSymbolicLink()||stat.isDirectory()||stat.nlink>1)throw Error('不能导出到链接或文件夹，请选择普通文件');}
 return target;
}
function createLearningExport({q,phrases,practice,source,now,getPaths,io=fs,clock=()=>Date.parse(now())}){
 const pending=new Map();
 function validate(payload){
  if(!object(payload)||Object.keys(payload).some(k=>!['scope','format','filters','includeHistory'].includes(k))||!['phrase','sense','cards'].includes(payload.scope)||!['json','anki'].includes(payload.format)||!object(payload.filters??{}))throw Error('导出选项无效');
  if(payload.includeHistory!==undefined&&typeof payload.includeHistory!=='boolean')throw Error('学习记录选项无效');
  if(payload.includeHistory&&(payload.scope!=='cards'||payload.format!=='json'))throw Error('完整学习记录仅供练习卡 JSON 档案使用');
  const f=payload.filters??{},limits=payload.scope==='cards'?{query:200,status:20,type:20,tag:30,sourceKey:160}:{query:200,tag:30,lemma:240,deleted:'boolean'};
  if(Object.keys(f).some(k=>!Object.hasOwn(limits,k)))throw Error('导出筛选条件无效');
  for(const [k,v]of Object.entries(f))if(limits[k]==='boolean'?typeof v!=='boolean':typeof v!=='string'||v.length>limits[k])throw Error('导出筛选条件无效');
  if(payload.scope==='cards'&&((f.status&&!['active','paused','archived','all'].includes(f.status))||(f.type&&!TYPES.includes(f.type))))throw Error('卡片状态或题型无效');
  return {scope:payload.scope,format:payload.format,filters:payload.scope==='cards'?{...f,status:f.status||'active'}:{...f,deleted:f.deleted??false},includeHistory:!!payload.includeHistory};
 }
 function anchorFor(card){
  const saved=parse(card.source_anchor??card.sourceAnchor);if(saved)return {anchor:saved,basis:'saved-with-card'};
  try{const current=source(card.source_key);if(sourceHash(current)===card.source_hash){const anchor=captureSourceAnchor(current);return {anchor,basis:anchor?'matching-source':'none'};}}catch{}
  return {anchor:null,basis:'unavailable'};
 }
 function cardData(row){
  const provenance=anchorFor(row);let status='unavailable';try{status=sourceHash(source(row.source_key))===row.source_hash?'current':'changed';}catch{}
  return {id:row.id,type:row.type,question:row.question,answer:row.answer,explanation:row.explanation,options:parse(row.options,[]),tags:parse(row.tags,[]),origin:row.origin,status:row.status,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,sourceSnapshot:{key:row.source_key,title:row.source_title,content:row.source_content,hash:row.source_hash,anchor:provenance.anchor,anchorBasis:provenance.basis},sourceStatus:status};
 }
 function collectionData(e){return {id:e.id,kind:e.kind,quote:e.quote,lemma:e.lemma,meaning:e.meaning,note:e.note,tags:e.tags,context:e.context,markedContext:e.markedContext,anchor:captureSourceAnchor({[e.kind==='sense'?'sense':'phrase']:e}),sourceStatus:e.sourceStatus,revision:e.revision,createdAt:e.created_at,updatedAt:e.updated_at,deletedAt:e.deleted_at};}
 function historyFor(ids,availableText){
  const placeholders=ids.map(()=>'?').join(','),estimate=q(`SELECT COUNT(*) n,COALESCE(SUM(length(snapshot)+length(response)),0) chars FROM practice_attempt WHERE card_id IN (${placeholders})`,ids)[0];
  const extra=q(`SELECT COALESCE(SUM(length(memory_before)+length(memory_after)+length(official_log)+length(shadow_before)+length(shadow_after)),0) chars FROM practice_fsrs_review WHERE card_id IN (${placeholders})`,ids)[0].chars+q(`SELECT COALESCE(SUM(length(c.normalized_answer)+length(c.normalized_response)),0) chars FROM practice_answer_check c JOIN practice_attempt a ON a.id=c.attempt_id WHERE a.card_id IN (${placeholders})`,ids)[0].chars;
  if(estimate.n>MAX_REVIEWS||estimate.chars+extra>availableText)throw Error('学习记录过多，请缩小筛选范围或关闭附带记录');
  const checks=new Map(q(`SELECT c.* FROM practice_answer_check c JOIN practice_attempt a ON a.id=c.attempt_id WHERE a.card_id IN (${placeholders})`,ids).map(r=>[r.attempt_id,r])),fsrs=new Map(q(`SELECT r.* FROM practice_fsrs_review r WHERE r.card_id IN (${placeholders})`,ids).map(r=>[r.attempt_id,r])),histories=new Map();
  for(const a of q(`SELECT * FROM practice_attempt WHERE card_id IN (${placeholders}) ORDER BY reviewed_at,card_revision,id`,ids)){
   const c=checks.get(a.id),f=fsrs.get(a.id),snapshot=parse(a.snapshot,{}),item={id:a.id,cardRevision:a.card_revision,response:a.response,rating:a.rating,correct:a.correct===null?null:!!a.correct,reviewedAt:a.reviewed_at,due:a.due,snapshot:cardData(snapshot),answerCheck:c?{version:c.version,correct:!!c.correct,normalizedAnswer:c.normalized_answer,normalizedResponse:c.normalized_response}:null,fsrs:f?{grade:f.grade,mappedRating:f.mapped_rating,ratingScale:f.rating_scale,libraryVersion:f.library_version,parameterVersion:f.parameter_version,epoch:f.epoch,reviewedAt:f.reviewed_at,contentKey:f.content_key,memoryBefore:parse(f.memory_before),memoryAfter:parse(f.memory_after),shadowBefore:parse(f.shadow_before),shadowAfter:parse(f.shadow_after),officialLog:parse(f.official_log)}:null};
   if(!histories.has(a.card_id))histories.set(a.card_id,[]);histories.get(a.card_id).push(item);
  }
  return {histories,count:estimate.n};
 }
 function scheduleFor(row){const t=q('SELECT * FROM practice_fsrs WHERE card_id=?',[row.id])[0];return {engine:t?.phase==='fsrs'?'fsrs-card':'legacy-card',due:row.due,intervalDays:row.interval_days,reps:row.reps,fsrsTrial:t?{phase:t.phase,libraryVersion:t.library_version,parameterVersion:t.parameter_version,parameters:parse(t.parameters),memory:parse(t.memory),shadow:parse(t.shadow),baseline:parse(t.baseline),contentKey:t.content_key,epoch:t.epoch,startedAt:t.started_at,updatedAt:t.updated_at}:null};}
 function note(item,scope){
  if(scope!=='cards')return {id:'CETWordKeeper:'+scope+':'+item.id,front:'<div>解释原文中的表达：<b>'+html(item.quote)+'</b></div><br>'+html(item.markedContext||item.context),back:'<b>此处释义</b><br>'+html(item.meaning)+(item.note?'<br><br><b>备注</b><br>'+html(item.note):'')+'<br><br><b>原文与出处</b><br>'+html(item.context)+'<br>'+html(item.anchor.label)+'<br>'+html(item.sourceStatus==='current'?'保存时的原文':item.sourceStatus==='changed'?'原文已变化，以上为收藏快照':'来源暂不可用，以上为收藏快照'),tags:item.tags};
  const front='<div>'+html(item.question)+'</div>'+item.options.map((v,i)=>'<div>'+String.fromCharCode(65+i)+'. '+html(v)+'</div>').join(''),answer=item.type==='choice'?item.answer+'. '+(item.options[item.answer.charCodeAt(0)-65]||''):item.answer,a=item.sourceSnapshot.anchor;
  return {id:'CETWordKeeper:card:'+item.id,front,back:'<b>参考答案</b><br>'+html(answer)+'<br><br><b>解析</b><br>'+html(item.explanation)+'<br><br><b>制作时的来源快照</b><br>'+html(item.sourceSnapshot.title)+'<br>'+html(item.sourceSnapshot.content)+(a?'<br><br><b>出处</b><br>'+html(a.label)+'<br>'+html(a.quote):'')+'<br>'+html(item.sourceStatus==='changed'?'来源已变化，卡片使用制作时的版本':item.sourceStatus==='unavailable'?'来源暂不可用，卡片保留原快照':'')+(item.type==='spelling'||item.type==='cloze'?'<br>此导出使用普通正反面卡，按参考拼写自行核对。':''),tags:[...item.tags,item.type,item.status]};
 }
 function preview(owner,payload){
  for(const [key,s]of pending)if(s.expires<=clock())pending.delete(key);pending.delete(owner);
  const options=validate(payload),selection=options.scope==='cards'?practice.list(options.filters).entries:phrases.list({...options.filters,kind:options.scope}).entries;
  if(!selection.length)throw Error('当前筛选没有可导出的记录');if(selection.length>MAX_ITEMS)throw Error('每次最多导出 5000 条，请缩小筛选范围');if(pending.size>=8)throw Error('同时导出的窗口过多，请关闭旧预览');
  const rows=options.scope==='cards'?selection.map(e=>q('SELECT * FROM practice_card WHERE id=?',[e.id])[0]):selection;
  const textSize=rows.reduce((n,row)=>n+Object.values(row).reduce((m,v)=>m+(typeof v==='string'?v.length:0),0),0);if(textSize>MAX_TEXT)throw Error('资料正文过多，请缩小筛选范围');
  const entries=rows.map(e=>options.scope==='cards'?cardData(e):collectionData(e));let reviewCount=0;
  if(options.includeHistory){const history=historyFor(rows.map(r=>r.id),MAX_TEXT-textSize);reviewCount=history.count;for(let i=0;i<entries.length;i++){entries[i].schedule=scheduleFor(rows[i]);entries[i].reviews=history.histories.get(entries[i].id)||[];}}
  const exportedAt=now(),archive={format:'cet-wordkeeper-learning-export',version:1,exportedAt,selection:options,count:entries.length,reviewCount,notice:'内容与可选学习记录档案；不是数据库备份，不提供直接恢复。',entries};
  let content;
  if(options.format==='json')content=JSON.stringify(archive,null,2)+'\n';
  else{const lines=entries.map(e=>{const n=note(e,options.scope),tags=['CETWordKeeper',options.scope,...n.tags].map(t=>String(t).replace(/\s/g,'_')).join(' ');return [n.id,n.front,n.back,tags].map(tsv).join('\t');});content='#separator:tab\n#html:true\n#columns:ID\tFront\tBack\tTags\n#tags column:4\n'+lines.join('\n')+'\n';}
  const bytes=Buffer.from(content,'utf8');if(bytes.length>MAX_BYTES)throw Error('导出超过 32 MB，请缩小筛选范围');
  const token=randomUUID(),slot={token,options,bytes,count:entries.length,reviewCount,digest:sha(bytes),expires:clock()+TTL,defaultName:'wordkeeper-'+options.scope+'-'+exportedAt.slice(0,10)+(options.format==='json'?'.json':'.txt'),sample:entries.slice(0,3).map(e=>({id:e.id,title:e.question||e.quote,source:e.sourceSnapshot?.title||e.anchor?.label||'',type:e.type||e.kind})),result:null};pending.set(owner,slot);return {ok:true,...describe(owner,token)};
 }
 function selected(owner,token){const s=pending.get(owner);if(!s||s.token!==token||s.expires<=clock()){if(s?.token===token)pending.delete(owner);throw Error('导出预览已失效，请重新预览');}return s;}
 function describe(owner,token){const s=selected(owner,token);return {token:s.token,count:s.count,reviewCount:s.reviewCount,bytes:s.bytes?.length??s.result.bytes,sha256:s.digest,expiresAt:new Date(s.expires).toISOString(),scope:s.options.scope,format:s.options.format,includeHistory:s.options.includeHistory,filters:s.options.filters,defaultName:s.defaultName,sample:s.sample,saved:s.result};}
 function save(owner,token,file,overwrite=false){const s=selected(owner,token);if(s.result){if(file&&path.resolve(file)!==s.result.path)throw Error('这份预览已保存，请重新预览后导出到其他位置');if(!io.existsSync(s.result.path)||sha(io.readFileSync(s.result.path))!==s.result.sha256)throw Error('已导出的文件已变化，请重新预览后保存');return {...s.result,duplicate:true};}const target=validateExportTarget(file,s.options.format,getPaths(),io);if(io.existsSync(target)&&!overwrite)throw Error('文件已存在，请重新选择文件名');atomicWrite(target,s.bytes,io);if(sha(io.readFileSync(target))!==s.digest)throw Error('导出文件校验失败，请重新导出');s.result={ok:true,path:target,count:s.count,reviewCount:s.reviewCount,bytes:s.bytes.length,sha256:s.digest};s.bytes=null;return s.result;}
 function cancel(owner,token){const s=pending.get(owner);if(s&&(!token||s.token===token))pending.delete(owner);return {ok:true};}
 return {preview,describe,save,cancel};
}
module.exports={createLearningExport,validateExportTarget,MAX_ITEMS,MAX_REVIEWS,MAX_BYTES};

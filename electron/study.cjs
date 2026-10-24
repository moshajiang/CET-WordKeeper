const {createHash}=require('node:crypto');
const {locateQuote}=require('./page-assistant.cjs');
const CAUSES=['词义','句法','逻辑关系','否定范围','指代','同义替换','定位','审题','其他'];
const digest=text=>createHash('sha256').update(text).digest('hex');
function ensureStudySchema(db){
 db.run(`CREATE TABLE IF NOT EXISTS study_visit(exam_id INTEGER PRIMARY KEY,passage_id INTEGER,visited_at TEXT);
 CREATE TABLE IF NOT EXISTS reader_annotation(id INTEGER PRIMARY KEY AUTOINCREMENT,exam_id INTEGER,passage_id INTEGER,quote TEXT,occurrence INTEGER,content_hash TEXT,title TEXT,explanation TEXT,note TEXT,color TEXT,updated_at TEXT);
 CREATE INDEX IF NOT EXISTS idx_annotation_passage ON reader_annotation(passage_id);
 CREATE TABLE IF NOT EXISTS knowledge_review(entry_key TEXT PRIMARY KEY,due TEXT,reps INTEGER DEFAULT 0,rating INTEGER,updated_at TEXT);
 CREATE TABLE IF NOT EXISTS knowledge_review_operation(operation_id TEXT PRIMARY KEY,entry_key TEXT,rating INTEGER,result TEXT);
 CREATE TABLE IF NOT EXISTS mistake_note(question_id INTEGER PRIMARY KEY,cause TEXT,entry_key TEXT,note TEXT,updated_at TEXT);`);
 const columns=db.exec('PRAGMA table_info(chat_message)')[0].values.map(r=>r[1]);
 if(!columns.includes('sources'))db.run("ALTER TABLE chat_message ADD COLUMN sources TEXT DEFAULT '[]'");
}
function createStudyStore({q,run,persistTransaction,now,kb,cardDue=()=>0}){
 const text=(value,max,name,empty=false)=>{if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw Error(name+'无效');return value.trim();};
 function passage(examId,passageId){
  if(!Number.isSafeInteger(examId)||!Number.isSafeInteger(passageId))throw Error('篇章编号无效');
  const p=q('SELECT p.* FROM passage p JOIN exam e ON e.id=p.exam_id WHERE p.id=? AND e.id=? AND p.retired=0 AND e.retired=0',[passageId,examId])[0];
  if(!p)throw Error('来源篇章已移除');return p;
 }
 function visit(examId,passageId){passage(examId,passageId);return persistTransaction(()=>{run('INSERT INTO study_visit VALUES(?,?,?) ON CONFLICT(exam_id) DO UPDATE SET passage_id=excluded.passage_id,visited_at=excluded.visited_at',[examId,passageId,now()]);return {ok:true};});}
 function summary(){
  const recent=q(`SELECT e.id,e.level,e.year,e.month,e.set_no,p.id passageId,p.title,p.section,v.visited_at FROM study_visit v JOIN exam e ON e.id=v.exam_id JOIN passage p ON p.id=v.passage_id AND p.exam_id=e.id WHERE e.retired=0 AND p.retired=0 ORDER BY v.visited_at DESC,e.id DESC LIMIT 4`);
  for(const e of recent){const draft=q('SELECT answers FROM answer_draft WHERE exam_id=?',[e.id])[0];let answers={};try{answers=JSON.parse(draft?.answers||'{}');}catch{}
   e.draftCount=Object.values(answers||{}).filter(Boolean).length;
   e.essays=q("SELECT section,updated_at FROM essay WHERE exam_id=? AND trim(content)!='' ORDER BY updated_at DESC",[e.id]);
  }
  return {recent,cardDue:cardDue(),reviewDue:reviewList().filter(e=>e.due<=now()).length};
 }
 function annotations(examId,passageId){const p=passage(examId,passageId);return q('SELECT * FROM reader_annotation WHERE exam_id=? AND passage_id=? ORDER BY id',[examId,passageId]).map(e=>({...e,stale:e.content_hash!==digest(p.content)}));}
 function saveAnnotation(value){
  const p=passage(value?.examId,value?.passageId),quote=text(value.quote,4000,'引文'),located=locateQuote(p.content,quote,value.occurrence);
  const title=text(value.title||'原文批注',160,'标题'),explanation=text(value.explanation||'',20000,'讲解',true),note=text(value.note||'',5000,'备注',true),color=value.color||'yellow';
  if(!['yellow','green','purple'].includes(color))throw Error('颜色无效');
  if(value.id!==undefined&&!Number.isSafeInteger(value.id))throw Error('批注编号无效');
  const existing=value.id?q('SELECT * FROM reader_annotation WHERE id=? AND exam_id=? AND passage_id=?',[value.id,p.exam_id,p.id])[0]:null;
  if(value.id&&!existing)throw Error('批注不存在');
  if(existing&&(existing.content_hash!==digest(p.content)||existing.updated_at!==value.expectedUpdatedAt))throw Error('批注已更新，请重新打开');
  if(!existing&&q('SELECT COUNT(*) n FROM reader_annotation WHERE passage_id=?',[p.id])[0].n>=1000)throw Error('本篇批注已达上限');
  return persistTransaction(()=>{
   const timestamp=now();let id=existing?.id;
   if(existing)run('UPDATE reader_annotation SET title=?,explanation=?,note=?,color=?,updated_at=? WHERE id=?',[title,explanation,note,color,timestamp,id]);
   else{run('INSERT INTO reader_annotation(exam_id,passage_id,quote,occurrence,content_hash,title,explanation,note,color,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[p.exam_id,p.id,located.quote,located.occurrence,digest(p.content),title,explanation,note,color,timestamp]);id=q('SELECT last_insert_rowid() id')[0].id;}
   return {ok:true,id};
  });
 }
 function removeAnnotation(id){if(!Number.isSafeInteger(id)||!q('SELECT id FROM reader_annotation WHERE id=?',[id]).length)throw Error('批注不存在');return persistTransaction(()=>{run('DELETE FROM reader_annotation WHERE id=?',[id]);return {ok:true};});}
 function reviewList(){return q('SELECT * FROM knowledge_review ORDER BY due,entry_key').flatMap(r=>{try{const entry=kb.get(r.entry_key);return [{...r,title:entry.title,tags:entry.tags}];}catch{return [];}});}
 function addReview(key){kb.get(key);return persistTransaction(()=>{run('INSERT OR IGNORE INTO knowledge_review(entry_key,due,reps,updated_at) VALUES(?,?,0,?)',[key,now(),now()]);return {ok:true};});}
 function rateReview(key,rating,operationId){
  if(![0,1,2].includes(rating)||typeof operationId!=='string'||! /^[\w-]{8,100}$/.test(operationId))throw Error('复习评分无效');
  const cached=q('SELECT * FROM knowledge_review_operation WHERE operation_id=?',[operationId])[0];
  if(cached){if(cached.entry_key!==key||cached.rating!==rating)throw Error('评分操作冲突');return JSON.parse(cached.result);}
  kb.get(key);const old=q('SELECT * FROM knowledge_review WHERE entry_key=?',[key])[0];if(!old)throw Error('请先加入复习');
  const reps=rating===0?0:old.reps+1,days=rating===0?0:rating===1?1:Math.min(30,2**Math.min(5,reps));
  const due=new Date(Date.parse(now())+(days?days*86400000:600000)).toISOString();
  return persistTransaction(()=>{const result={ok:true,due,reps};run('UPDATE knowledge_review SET due=?,reps=?,rating=?,updated_at=? WHERE entry_key=?',[due,reps,rating,now(),key]);run('INSERT INTO knowledge_review_operation VALUES(?,?,?,?)',[operationId,key,rating,JSON.stringify(result)]);return result;});
 }
 function removeReview(key){return persistTransaction(()=>{run('DELETE FROM knowledge_review WHERE entry_key=?',[key]);return {ok:true};});}
 function question(id){if(!Number.isSafeInteger(id))throw Error('题目编号无效');const r=q('SELECT q.*,p.exam_id,p.content FROM question q JOIN passage p ON p.id=q.passage_id JOIN exam e ON e.id=p.exam_id WHERE q.id=? AND q.retired=0 AND p.retired=0 AND e.retired=0',[id])[0];if(!r)throw Error('题目已移除');return r;}
 function mistakeGet(id){question(id);return {causes:CAUSES,note:q('SELECT * FROM mistake_note WHERE question_id=?',[id])[0]||null};}
 function mistakeSave(value){question(value?.questionId);if(!CAUSES.includes(value.cause))throw Error('错因无效');if(value.entryKey)kb.get(value.entryKey);const note=text(value.note||'',5000,'复盘',true);return persistTransaction(()=>{run('INSERT INTO mistake_note VALUES(?,?,?,?,?) ON CONFLICT(question_id) DO UPDATE SET cause=excluded.cause,entry_key=excluded.entry_key,note=excluded.note,updated_at=excluded.updated_at',[value.questionId,value.cause,value.entryKey||null,note,now()]);return {ok:true};});}
 function mistakeList(){return q(`SELECT n.*,q.stem,q.passage_id,p.exam_id FROM mistake_note n JOIN question q ON q.id=n.question_id JOIN passage p ON p.id=q.passage_id JOIN exam e ON e.id=p.exam_id WHERE q.retired=0 AND p.retired=0 AND e.retired=0 ORDER BY n.updated_at DESC LIMIT 100`);}
 return {visit,summary,annotations,saveAnnotation,removeAnnotation,reviewList,addReview,rateReview,removeReview,mistakeGet,mistakeSave,mistakeList};
}
module.exports={ensureStudySchema,createStudyStore,CAUSES};

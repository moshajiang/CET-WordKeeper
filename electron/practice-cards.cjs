const {createHash,randomUUID}=require('node:crypto');
const {schedule,preview:previewSchedule,recordSchedule,contentKey}=require('./review-scheduler.cjs');
const {NEW_CARD}=require('./review-budget.cjs');
const {TYPED_TYPES,validateTyped,checkAnswer,ensureAnswerCheckSchema,savedCheck,recordCheck}=require('./practice-exercises.cjs');
const TYPES=['recall','translation','judgment','choice',...TYPED_TYPES];
const hash=value=>createHash('sha256').update(value).digest('hex');
const sourceHash=entry=>hash(JSON.stringify([entry.title,entry.content]));
const parse=(value,fallback)=>{try{return JSON.parse(value);}catch{return fallback;}};
function text(value,max,name,empty=false){
 if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw Error(name+'无效');
 return value.trim();
}
function validateCard(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!TYPES.includes(value.type))throw Error('练习题型无效');
 const question=text(value.question,6000,'题目'),answer=text(value.answer,6000,'答案'),explanation=text(value.explanation??'',12000,'解析',true);
 const options=value.options??[];
 if(!Array.isArray(options)||options.length>6)throw Error('选项无效');
 const choices=options.map(option=>text(option,1000,'选项'));
 if(value.type==='choice'){
  if(choices.length<2||new Set(choices).size!==choices.length||! /^[A-F]$/.test(answer)||answer.charCodeAt(0)-65>=choices.length)throw Error('选择题需要至少两项不同选项及有效答案字母');
 }else if(choices.length)throw Error('此题型不应包含选项');
 if(value.type==='judgment'&&!['正确','错误'].includes(answer))throw Error('判断题答案应为正确或错误');
 validateTyped(value.type,question,answer);
 const tags=value.tags??[];
 if(!Array.isArray(tags)||tags.length>12)throw Error('标签最多 12 个');
 return {type:value.type,question,answer,explanation,options:choices,tags:[...new Set(tags.map(tag=>text(tag,30,'标签')))]};
}
function validateGeneratedCards(value,count){
 if(!value||!Array.isArray(value.cards)||value.cards.length<1||value.cards.length>count)throw Error('候选题数量无效');
 return value.cards.map(validateCard);
}
function ensurePracticeSchema(db){
 db.run(`CREATE TABLE IF NOT EXISTS practice_card(
  id TEXT PRIMARY KEY,source_key TEXT NOT NULL,source_title TEXT NOT NULL,source_content TEXT NOT NULL,source_hash TEXT NOT NULL,
  type TEXT NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL,explanation TEXT NOT NULL,options TEXT NOT NULL,tags TEXT NOT NULL,
  origin TEXT NOT NULL,fingerprint TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'active',due TEXT,reps INTEGER NOT NULL DEFAULT 0,
  interval_days REAL NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_practice_due ON practice_card(status,due);
 CREATE INDEX IF NOT EXISTS idx_practice_source ON practice_card(source_key);
 CREATE TABLE IF NOT EXISTS practice_card_batch(id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,result TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS practice_attempt(id TEXT PRIMARY KEY,card_id TEXT NOT NULL,card_revision INTEGER NOT NULL,snapshot TEXT NOT NULL,
  response TEXT NOT NULL,rating INTEGER NOT NULL,correct INTEGER,reviewed_at TEXT NOT NULL,due TEXT NOT NULL,payload_hash TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_practice_history ON practice_attempt(card_id,reviewed_at);`);
 ensureAnswerCheckSchema(db);
}
function createPracticeStore({q,run,persistTransaction,now,kb,budget,trials}){
 function identity(id){if(typeof id!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw Error('卡片或操作编号无效');return id;}
 function raw(id){identity(id);const row=q('SELECT * FROM practice_card WHERE id=?',[id])[0];if(!row)throw Error('卡片不存在');return row;}
 function decode(row,withSource=false){
  const entry={...row,options:parse(row.options,[]),tags:parse(row.tags,[])};
  if(withSource&&trials)entry.trial=trials.summary(row);
  if(withSource){try{const current=kb.get(row.source_key);entry.sourceStatus=sourceHash(current)===row.source_hash?'current':'changed';}catch{entry.sourceStatus='unavailable';}}
  else delete entry.source_content;
  delete entry.fingerprint;return entry;
 }
 function get(id){return decode(raw(id),true);}
 const fingerprint=(key,card)=>hash(JSON.stringify([key,card.type,card.question.replace(/\s+/g,' ').toLowerCase(),card.options]));
 function dueCount(){return q("SELECT COUNT(*) AS n FROM practice_card WHERE status='active' AND due IS NOT NULL AND due<=?",[now()])[0].n;}
 function list(filters={}){
  const status=['active','paused','archived','all'].includes(filters.status)?filters.status:'active';
  const query=String(filters.query||'').trim().toLowerCase().slice(0,200),terms=query.split(/\s+/).filter(Boolean);
  const all=q('SELECT id,source_key,source_title,source_hash,type,question,answer,explanation,options,tags,origin,status,due,reps,interval_days,revision,created_at,updated_at FROM practice_card ORDER BY created_at DESC,id DESC').map(row=>decode(row));
  const entries=all.filter(e=>(status==='all'||e.status===status)&&(!filters.sourceKey||e.source_key===filters.sourceKey)&&(!filters.type||e.type===filters.type)&&(!filters.tag||e.tags.includes(filters.tag))&&terms.every(t=>(e.question+'\n'+e.answer+'\n'+e.explanation+'\n'+e.source_title+'\n'+e.tags.join(' ')).toLowerCase().includes(t)));
  return {entries,total:all.length,tags:[...new Set(all.flatMap(e=>e.tags))].sort(),due:dueCount()};
 }
 function saveBatch(payload){
  if(!payload||!Array.isArray(payload.cards)||payload.cards.length<1||payload.cards.length>20)throw Error('每批保存 1 至 20 张卡片');
  identity(payload.operationId);
  if(payload.enroll!==undefined&&typeof payload.enroll!=='boolean')throw Error('加入复习选项无效');
  const normalized=payload.cards.map(value=>({card:validateCard(value),sourceKey:text(value.sourceKey,160,'来源'),sourceHash:value.sourceHash??null,origin:['manual','builtin','ai'].includes(value.origin)?value.origin:'manual'}));
  const payloadHash=hash(JSON.stringify([normalized,!!payload.enroll]));
  const old=q('SELECT * FROM practice_card_batch WHERE id=?',[payload.operationId])[0];
  if(old){if(old.payload_hash!==payloadHash)throw Error('保存批次内容与原操作不一致');return parse(old.result,null);}
  const prepared=normalized.map(value=>{const source=kb.get(value.sourceKey),revision=sourceHash(source);if(value.sourceHash&&value.sourceHash!==revision)throw Error('来源资料已更新，请核对候选题后重新制作');return {...value,source,revision,fingerprint:fingerprint(value.sourceKey,value.card)};});
  return persistTransaction(()=>{
   const result={ok:true,created:[],duplicates:[]};
   for(const item of prepared){
    const existing=q('SELECT id,status FROM practice_card WHERE fingerprint=?',[item.fingerprint])[0];
    if(existing){result.duplicates.push(existing);continue;}
    const id=randomUUID(),time=now(),card=item.card;
    run('INSERT INTO practice_card(id,source_key,source_title,source_content,source_hash,type,question,answer,explanation,options,tags,origin,fingerprint,status,due,reps,interval_days,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
     [id,item.sourceKey,item.source.title,item.source.content,item.revision,card.type,card.question,card.answer,card.explanation,JSON.stringify(card.options),JSON.stringify(card.tags),item.origin,item.fingerprint,'active',payload.enroll?time:null,0,0,1,time,time]);
    result.created.push(id);
   }
   run('INSERT INTO practice_card_batch VALUES(?,?,?)',[payload.operationId,payloadHash,JSON.stringify(result)]);return result;
  });
 }
 function save(payload){
  const row=raw(payload?.id),card=validateCard(payload);
  if(row.revision!==payload.expectedRevision)throw Error('卡片已更新，请重新打开后编辑');
  const idHash=fingerprint(row.source_key,card),duplicate=q('SELECT id FROM practice_card WHERE fingerprint=? AND id!=?',[idHash,row.id])[0];
  if(duplicate)throw Error('已存在同题卡片，请编辑原卡片');
  const changed=row.type!==card.type||row.question!==card.question||row.answer!==card.answer||row.options!==JSON.stringify(card.options),editedAt=now();
  return persistTransaction(()=>{
   if(changed)trials?.onEdit(row,card,editedAt);
   run('UPDATE practice_card SET type=?,question=?,answer=?,explanation=?,options=?,tags=?,fingerprint=?,reps=?,interval_days=?,due=?,revision=revision+1,updated_at=? WHERE id=?',
    [card.type,card.question,card.answer,card.explanation,JSON.stringify(card.options),JSON.stringify(card.tags),idHash,changed?0:row.reps,changed?0:row.interval_days,changed&&row.due?editedAt:row.due,editedAt,row.id]);
   return {ok:true,id:row.id,relearning:changed&&!!row.due};
  });
 }
 function state(payload){
  const row=raw(payload?.id);if(row.revision!==payload.expectedRevision)throw Error('卡片状态已更新，请重新加载');
  let status=row.status,due=row.due;
  if(payload.action==='enroll'){if(status==='archived')throw Error('请先恢复归档卡片');status='active';due??=trials?.enrollmentDue(row,now())??now();}
  else if(payload.action==='pause'){if(status==='archived')throw Error('归档卡片不能暂停');status='paused';}
  else if(payload.action==='resume'){if(status!=='paused')throw Error('当前卡片没有暂停');status='active';}
  else if(payload.action==='archive')status='archived';
  else if(payload.action==='restore'){if(status!=='archived')throw Error('卡片没有归档');status='paused';}
  else if(payload.action==='unenroll')due=null;
  else throw Error('卡片状态操作无效');
  return persistTransaction(()=>{run('UPDATE practice_card SET status=?,due=?,revision=revision+1,updated_at=? WHERE id=?',[status,due,now(),row.id]);return {ok:true,id:row.id};});
 }
 function session(options){
  const instant=now();
  if(!budget)return {cards:q("SELECT * FROM practice_card WHERE status='active' AND due IS NOT NULL AND due<=? ORDER BY due,created_at,id LIMIT 30",[instant]).map(row=>decode(row,true)),budget:null};
  const plan=budget.plan('cards',options,instant),select=(fresh,limit)=>q(`SELECT c.* FROM practice_card c WHERE c.status='active' AND c.due IS NOT NULL AND c.due<=? AND ${fresh?'':'NOT'}(${NEW_CARD}) ORDER BY c.due,c.created_at,c.id LIMIT ?`,[instant,limit]);
  return {cards:[...select(false,plan.plannedDue),...select(true,plan.plannedNew)].map(row=>({...decode(row,true),schedule:trials?.isActive(row.id)?trials.preview(row,instant):previewSchedule('cards',row,instant)})),budget:plan};
 }
 function queue(options){return session(options).cards;}
 function check(payload){const row=raw(payload?.id);if(row.revision!==payload.expectedRevision)throw Error('卡片已修改，请重新加载后作答');if(!TYPED_TYPES.includes(row.type))throw Error('此卡不使用拼写核对');const response=text(payload.response??'',10000,'作答',true);return {ok:true,check:checkAnswer(row.answer,response)};}
 function rate(payload){
  identity(payload?.operationId);identity(payload?.id);const response=text(payload.response??'',10000,'作答',true),isFsrsRequest=payload.ratingScale==='fsrs-4-v1';
  if(payload.ratingScale!==undefined&&!isFsrsRequest)throw Error('评分语义版本无效');
  if(!(isFsrsRequest?[1,2,3,4]:[0,1,2]).includes(payload.rating)||!Number.isSafeInteger(payload.expectedRevision))throw Error('评分无效');
  const identityFields=[payload.id,payload.expectedRevision,response,payload.rating];if(isFsrsRequest)identityFields.push(payload.ratingScale);const payloadHash=hash(JSON.stringify(identityFields));
  const cached=q('SELECT * FROM practice_attempt WHERE id=?',[payload.operationId])[0];
  if(cached){if(cached.payload_hash!==payloadHash)throw Error('评分请求与原操作不一致');const comparison=savedCheck(q,payload.operationId);return {ok:true,due:cached.due,correct:cached.correct===null?null:!!cached.correct,duplicate:true,...(comparison?{answerCheck:comparison}:{})};}
  const row=raw(payload.id),reviewedAt=now(),activeFsrs=!!trials?.isActive(row.id);
  if(row.revision!==payload.expectedRevision)throw Error('卡片已修改或已经评分，请重新开始这张卡');
  if(isFsrsRequest!==activeFsrs)throw Error('卡片调度已切换，请重新加载后按当前评分方式作答');
  if(row.status!=='active'||!row.due||row.due>reviewedAt)throw Error('这张卡当前不在到期复习队列');
  budget?.assertIntroduction('cards',row.id,reviewedAt);let correct=null;const answerCheck=TYPED_TYPES.includes(row.type)?checkAnswer(row.answer,response):null;
  if(answerCheck){correct=answerCheck.correct;if(!correct&&payload.rating!==(activeFsrs?1:0))throw Error('拼写与参考答案不一致，未回忆成功请选择不会或没想起');}
  if(['judgment','choice'].includes(row.type)){
   const allowed=row.type==='judgment'?['正确','错误']:parse(row.options,[]).map((_,i)=>String.fromCharCode(65+i));
   if(!allowed.includes(response))throw Error('请先选择你的答案');correct=response===row.answer;
   if(!correct&&(activeFsrs?payload.rating!==1:payload.rating===2))throw Error(activeFsrs?'答案不匹配；未回忆成功请选择没想起':'答案不匹配，请如实选择不会或模糊');
  }
  const fsrsResult=activeFsrs?trials.step(row,payload.rating,reviewedAt):null,mappedRating=fsrsResult?.mapped??payload.rating,next=fsrsResult?.actual??schedule('cards',row,payload.rating,reviewedAt),{reps,due}=next;
  return persistTransaction(()=>{
   budget?.recordIntroduction('cards',row.id,reviewedAt);
   run('UPDATE practice_card SET due=?,reps=?,interval_days=?,revision=revision+1,updated_at=? WHERE id=?',[due,reps,next.interval_days,reviewedAt,row.id]);
   run('INSERT INTO practice_attempt VALUES(?,?,?,?,?,?,?,?,?,?)',[payload.operationId,row.id,row.revision,JSON.stringify(decode(row,true)),response,mappedRating,correct===null?null:Number(correct),reviewedAt,due,payloadHash]);
   if(answerCheck)recordCheck(run,payload.operationId,answerCheck);
   if(fsrsResult)trials.persistReview(row,payload.operationId,fsrsResult);else recordSchedule(run,{kind:'cards',id:row.id,logId:payload.operationId,rating:payload.rating,at:reviewedAt,before:row,after:next,key:contentKey(row)});
   return {ok:true,due,correct,...(answerCheck?{answerCheck}:{})};
  });
 }
 function history(id){raw(id);return q('SELECT * FROM practice_attempt WHERE card_id=? ORDER BY reviewed_at DESC,id DESC LIMIT 50',[id]).map(row=>({...row,snapshot:parse(row.snapshot,{}),fsrs:trials?.reviewInfo(row.id)||null,answerCheck:savedCheck(q,row.id),correct:row.correct===null?null:!!row.correct}));}
 return {get,list,dueCount,saveBatch,save,state,queue,session,check,rate,history};
}
module.exports={ensurePracticeSchema,createPracticeStore,validateCard,validateGeneratedCards,sourceHash,TYPES};

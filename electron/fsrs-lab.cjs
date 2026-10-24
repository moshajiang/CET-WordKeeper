const {createHash}=require('node:crypto');
const {ENGINES,VERSION,instant,stateOf,schedule,contentKey}=require('./review-scheduler.cjs');
const LIBRARY_VERSION='5.4.2',MAX_ITEMS=20,MAX_HISTORY=200;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function parse(value){try{return JSON.parse(value);}catch{throw Error('invalid_history');}}
function validateHistory(kind,current,logs,events,at){
 if(logs.length>MAX_HISTORY)throw Error('too_long');
 if(logs.some(log=>![0,1,2].includes(log.rating)))throw Error('invalid_history');
 if(logs.some(log=>log.rating===1))throw Error('ambiguous');
 if(logs.length!==events.length)throw Error('missing_events');
 const byLog=new Map(events.map(event=>[event.log_id,event]));let previous=null,lastTime=-Infinity;
 for(const log of logs){
  const time=instant(log.reviewed_at);if(time<lastTime||time>instant(at))throw Error('invalid_history');lastTime=time;
  const event=byLog.get(String(log.id));if(!event||event.item_id!==String(current.id)||event.engine!==ENGINES[kind]||event.version!==VERSION||event.rating!==log.rating||event.reviewed_at!==log.reviewed_at)throw Error('invalid_history');
  const before=stateOf(kind,parse(event.before_state)),after=stateOf(kind,parse(event.after_state));
  if(kind==='cards'&&event.content_key!==contentKey(current))throw Error('changed_content');
  if(previous&&!same(previous,before))throw Error('state_changed');
  if(!previous&&(before.reps!==0||before.interval_days!==0||(kind==='words'&&(before.lapses!==0||before.ease!==2.5))))throw Error('not_new_start');
  if(!same(after,schedule(kind,before,log.rating,log.reviewed_at))||after.due!==log.due||(kind==='words'&&(after.interval_days!==log.interval_days||after.ease!==log.ease)))throw Error('invalid_history');
  previous=after;
 }
 if(!previous||!same(previous,stateOf(kind,current)))throw Error('state_changed');
 return logs;
}
function compareFsrs({q,now},options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='retention')||![0.8,0.9,0.95].includes(options.retention??0.9))throw Error('对照参数无效');
 const retention=options.retention??0.9,at=now();instant(at);
 // Load the optional comparison engine only on an explicit local request.
 const {fsrs,createEmptyCard,Rating}=require('ts-fsrs'),engine=fsrs({request_retention:retention,maximum_interval:365,enable_fuzz:false,enable_short_term:true,learning_steps:['10m'],relearning_steps:['10m']});
 const sources={words:{table:'user_word',logs:'review_log',column:'word_id',active:"status='learning'",title:'word',fields:'c.id,c.word,c.interval_days,c.ease,c.reps,c.lapses,c.due'},cards:{table:'practice_card',logs:'practice_attempt',column:'card_id',active:"status='active' AND due IS NOT NULL",title:'question',fields:'c.id,c.type,c.question,c.answer,c.options,c.interval_days,c.reps,c.due'}};
 const candidates=[],scope={};
 for(const [kind,s]of Object.entries(sources)){
  const condition=`${s.active} AND EXISTS(SELECT 1 FROM ${s.logs} l WHERE l.${s.column}=c.id)`;
  scope[kind]={withHistory:q(`SELECT COUNT(*) n FROM ${s.table} c WHERE ${condition}`)[0].n,withoutHistory:q(`SELECT COUNT(*) n FROM ${s.table} c WHERE ${s.active} AND NOT EXISTS(SELECT 1 FROM ${s.logs} l WHERE l.${s.column}=c.id)`)[0].n};
  for(const row of q(`SELECT ${s.fields},(SELECT MAX(reviewed_at) FROM ${s.logs} l WHERE l.${s.column}=c.id) last_at FROM ${s.table} c WHERE ${condition} ORDER BY last_at DESC,c.id LIMIT ?`,[MAX_ITEMS]))candidates.push({kind,row,last:row.last_at,title:String(row[s.title]).slice(0,120)});
 }
 candidates.sort((a,b)=>String(b.last).localeCompare(String(a.last))||a.kind.localeCompare(b.kind)||String(a.row.id).localeCompare(String(b.row.id)));
 const reasons={ambiguous:0,missing_events:0,invalid_history:0,changed_content:0,state_changed:0,too_long:0,not_new_start:0,trial_history:0},examples=[],skipped=[];
 for(const item of candidates.slice(0,MAX_ITEMS)){
  const {kind,row,title}=item,s=sources[kind];
  try{
   if(kind==='cards'&&q('SELECT 1 FROM practice_fsrs WHERE card_id=?',[row.id]).length)throw Error('trial_history');
   const count=q(`SELECT COUNT(*) n FROM ${s.logs} WHERE ${s.column}=?`,[row.id])[0].n;if(count>MAX_HISTORY)throw Error('too_long');
   const logs=q(`SELECT id,rating,reviewed_at,due${kind==='words'?',interval_days,ease':''} FROM ${s.logs} WHERE ${s.column}=? ORDER BY ${kind==='words'?'id':'card_revision,id'} LIMIT ?`,[row.id,MAX_HISTORY]);
   const events=q('SELECT * FROM review_schedule_event WHERE kind=? AND item_id=? LIMIT ?',[kind,String(row.id),MAX_HISTORY+1]);
   validateHistory(kind,row,logs,events,at);
   let memory=createEmptyCard(new Date(logs[0].reviewed_at));for(const log of logs)memory=engine.next(memory,new Date(log.reviewed_at),log.rating===0?Rating.Again:Rating.Good).card;
   const due=memory.due.toISOString();instant(due);examples.push({kind,id:row.id,title,reviews:logs.length,lastReviewedAt:logs.at(-1).reviewed_at,legacyDue:row.due,fsrsDue:due,differenceDays:(Date.parse(due)-Date.parse(row.due))/86400000});
  }catch(error){const reason=Object.hasOwn(reasons,error.message)?error.message:'invalid_history';reasons[reason]++;skipped.push({kind,id:row.id,title,reason});}
 }
 return {at,library:'ts-fsrs',libraryVersion:LIBRARY_VERSION,fsrsVersion:6,retention,maximumInterval:365,parameterHash:createHash('sha256').update(JSON.stringify(engine.parameters)).digest('hex'),defaultWeights:true,enableFuzz:false,learningSteps:['10m'],relearningSteps:['10m'],scope,sampleLimit:MAX_ITEMS,historyLimit:MAX_HISTORY,checked:Math.min(candidates.length,MAX_ITEMS),eligible:examples.length,reasons,examples,skipped};
}
module.exports={compareFsrs,validateHistory,LIBRARY_VERSION,MAX_ITEMS,MAX_HISTORY};

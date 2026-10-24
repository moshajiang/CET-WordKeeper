const {createHash}=require('node:crypto');
const ENGINES={words:'legacy-word',cards:'legacy-card'},VERSION=1;
function instant(value){const date=new Date(value);if(typeof value!=='string'||!Number.isFinite(date.getTime())||date.toISOString()!==value)throw Error('复习时间无效');return date.getTime();}
function stateOf(kind,value){
 if(!Object.hasOwn(ENGINES,kind)||!value)throw Error('调度状态无效');
 const state={interval_days:value.interval_days??0,reps:value.reps??0,due:value.due??null};
 if(kind==='words'){state.ease=value.ease||2.5;state.lapses=value.lapses??0;}
 if(!Number.isFinite(state.interval_days)||state.interval_days<0||!Number.isSafeInteger(state.reps)||state.reps<0||(kind==='words'&&(!Number.isFinite(state.ease)||state.ease<=0||!Number.isSafeInteger(state.lapses)||state.lapses<0)))throw Error('调度状态无效');
 if(state.due!==null)instant(state.due);return state;
}
function schedule(kind,source,rating,reviewedAt){
 if(![0,1,2].includes(rating))throw Error('评分无效');const start=instant(reviewedAt),state=stateOf(kind,source);let interval,reps=state.reps,ease=state.ease,lapses=state.lapses;
 if(kind==='words'){
  if(rating===0){reps=0;lapses++;interval=0.007;ease=Math.max(1.3,ease-0.2);}
  else{reps++;interval=reps===1?(rating===1?0.5:1):reps===2?(rating===1?3:6):Math.max(1,Math.round(state.interval_days*ease*(rating===1?0.6:1)*10)/10);ease=rating===1?Math.max(1.3,ease-0.15):Math.min(3,ease+0.1);}
 }else{reps=rating===0?0:reps+1;interval=rating===0?10/1440:rating===1?1:Math.min(30,2**Math.min(5,reps));}
 return {...state,interval_days:interval,reps,...(kind==='words'?{ease,lapses}:{}),due:new Date(start+interval*86400000).toISOString()};
}
function intervalLabel(days){const minutes=days*1440;if(minutes<60)return Math.max(1,Math.round(minutes))+' 分钟';if(days<1)return Math.round(days*24*10)/10+' 小时';return Math.round(days*10)/10+' 天';}
function preview(kind,state,at){return {engine:ENGINES[kind],version:VERSION,at,options:[0,1,2].map(rating=>{const result=schedule(kind,state,rating,at);return {rating,intervalDays:result.interval_days,due:result.due,label:intervalLabel(result.interval_days)};})};}
function contentKey(card){return createHash('sha256').update(JSON.stringify([card.type,card.question,card.answer,typeof card.options==='string'?JSON.parse(card.options):card.options])).digest('hex');}
function ensureSchedulerSchema(db){db.run(`CREATE TABLE IF NOT EXISTS review_schedule_event(
 kind TEXT NOT NULL,item_id TEXT NOT NULL,log_id TEXT NOT NULL,engine TEXT NOT NULL,version INTEGER NOT NULL,rating INTEGER NOT NULL,
 reviewed_at TEXT NOT NULL,before_state TEXT NOT NULL,after_state TEXT NOT NULL,content_key TEXT,PRIMARY KEY(kind,log_id));
 CREATE INDEX IF NOT EXISTS idx_schedule_event_item ON review_schedule_event(kind,item_id);`);}
function recordSchedule(run,{kind,id,logId,rating,at,before,after,key=null}){
 run('INSERT INTO review_schedule_event VALUES(?,?,?,?,?,?,?,?,?,?)',[kind,String(id),String(logId),ENGINES[kind],VERSION,rating,at,JSON.stringify(stateOf(kind,before)),JSON.stringify(stateOf(kind,after)),key]);
}
module.exports={ENGINES,VERSION,instant,stateOf,schedule,preview,intervalLabel,contentKey,ensureSchedulerSchema,recordSchedule};

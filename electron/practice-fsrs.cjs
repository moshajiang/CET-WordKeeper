const {createHash,randomUUID}=require('node:crypto');
const {instant,stateOf,schedule,intervalLabel,contentKey}=require('./review-scheduler.cjs');
const LIBRARY_VERSION='5.4.2',RATING_SCALE='fsrs-4-v1',MAX_TRIALS=10;
const gradeNames=['没想起','费力想起','正常想起','很轻松'];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
function identity(value){if(typeof value!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))throw Error('卡片或操作编号无效');return value;}
function parse(value){try{return JSON.parse(value);}catch{throw Error('试用状态损坏，请保留备份并退出试用');}}
function parameters(retention){if(![0.8,0.9,0.95].includes(retention))throw Error('试用保持率无效');return require('ts-fsrs').generatorParameters({request_retention:retention,maximum_interval:365,enable_fuzz:false,enable_short_term:true,learning_steps:['10m'],relearning_steps:['10m']});}
function memoryOf(value){
 const m=typeof value==='string'?parse(value):clone(value);
 if(!m||!Number.isFinite(m.stability)||m.stability<0||!Number.isFinite(m.difficulty)||m.difficulty<0||m.difficulty>10||![0,1,2,3].includes(m.state)||['elapsed_days','scheduled_days','learning_steps','reps','lapses'].some(key=>!Number.isSafeInteger(m[key])||m[key]<0))throw Error('FSRS 记忆状态无效');
 instant(m.due);if(m.last_review!=null)instant(m.last_review);else if(m.reps!==0||m.state!==0)throw Error('FSRS 上次评分时间缺失');return m;
}
function ensurePracticeFsrsSchema(db){db.run(`CREATE TABLE IF NOT EXISTS practice_fsrs(
 card_id TEXT PRIMARY KEY,phase TEXT NOT NULL,library_version TEXT NOT NULL,parameter_version TEXT NOT NULL,parameters TEXT NOT NULL,
 memory TEXT NOT NULL,shadow TEXT NOT NULL,baseline TEXT NOT NULL,content_key TEXT NOT NULL,epoch INTEGER NOT NULL DEFAULT 0,
 started_at TEXT NOT NULL,updated_at TEXT NOT NULL,initial_backup TEXT NOT NULL,last_backup TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS practice_fsrs_operation(id TEXT PRIMARY KEY,card_id TEXT NOT NULL,action TEXT NOT NULL,payload_hash TEXT NOT NULL,result TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS practice_fsrs_review(attempt_id TEXT PRIMARY KEY,card_id TEXT NOT NULL,grade INTEGER NOT NULL,mapped_rating INTEGER NOT NULL,
 rating_scale TEXT NOT NULL,library_version TEXT NOT NULL,parameter_version TEXT NOT NULL,epoch INTEGER NOT NULL,
 memory_before TEXT NOT NULL,memory_after TEXT NOT NULL,official_log TEXT NOT NULL,shadow_before TEXT NOT NULL,shadow_after TEXT NOT NULL,content_key TEXT NOT NULL,reviewed_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_fsrs_review_card ON practice_fsrs_review(card_id);
 CREATE TABLE IF NOT EXISTS practice_fsrs_event(id TEXT PRIMARY KEY,card_id TEXT NOT NULL,action TEXT NOT NULL,operation_id TEXT,
 card_revision INTEGER NOT NULL,at TEXT NOT NULL,before_state TEXT,after_state TEXT NOT NULL,backup_path TEXT);
 CREATE INDEX IF NOT EXISTS idx_fsrs_event_card ON practice_fsrs_event(card_id);`);}
function createPracticeFsrs({q,run,now,persistTransaction,backup}){
 const trial=id=>q('SELECT * FROM practice_fsrs WHERE card_id=?',[id])[0]||null;
 function card(id){identity(id);const row=q('SELECT * FROM practice_card WHERE id=?',[id])[0];if(!row)throw Error('卡片不存在');return row;}
 function activeCount(){return q("SELECT COUNT(*) n FROM practice_fsrs WHERE phase='fsrs'")[0].n;}
 function reason(row){
  if(trial(row.id))return '这张卡已参加过试用，本批不重复开启';
  if(row.status==='archived')return '请先恢复归档卡片';
  if(row.reps!==0||row.interval_days!==0||q('SELECT 1 FROM practice_attempt WHERE card_id=? LIMIT 1',[row.id]).length||q("SELECT 1 FROM review_introduction WHERE kind='cards' AND item_id=?",[row.id]).length)return '本批仅支持从未作答的新卡';
  if(activeCount()>=MAX_TRIALS)return '当前试用已达 10 张上限，可先退出部分试用';return '';
 }
 function summary(row){const t=trial(row.id),why=t?null:reason(row);return {phase:t?.phase||'none',engine:t?.phase==='fsrs'?'fsrs-card':'legacy-card',eligible:!t&&!why,reason:why,activeTrials:activeCount(),maxTrials:MAX_TRIALS,libraryVersion:t?.library_version||LIBRARY_VERSION,parameterVersion:t?.parameter_version||null,retention:t?(()=>{try{return parse(t.parameters).request_retention;}catch{return null;}})():null,epoch:t?.epoch||0,initialBackup:t?.initial_backup||null,lastBackup:t?.last_backup||null};}
 function checkedTrial(row,at){const t=trial(row.id);if(t?.phase!=='fsrs')throw Error('这张卡当前未使用 FSRS');if(t.library_version!==LIBRARY_VERSION)throw Error('FSRS 版本不兼容，可退出试用保留记录');const params=parse(t.parameters);if(hash(params)!==t.parameter_version||hash(parameters(params.request_retention))!==t.parameter_version)throw Error('FSRS 参数版本校验失败');if(t.content_key!==contentKey(row))throw Error('卡片内容与试用状态不一致');const memory=memoryOf(t.memory);if(memory.last_review&&instant(at)<instant(memory.last_review))throw Error('当前时间早于上次评分，请检查设备时间');return {t,params,memory,shadow:stateOf('cards',parse(t.shadow))};}
 function preview(row,at){const {t,params,memory}=checkedTrial(row,at),engine=require('ts-fsrs').fsrs(params);return {engine:'fsrs-card',version:LIBRARY_VERSION,ratingScale:RATING_SCALE,parameterVersion:t.parameter_version,at,options:[1,2,3,4].map(rating=>{const result=engine.next(memory,at,rating).card,intervalDays=(result.due.getTime()-instant(at))/86400000;return {rating,name:gradeNames[rating-1],intervalDays,due:result.due.toISOString(),label:intervalLabel(intervalDays)};})};}
 function step(row,grade,at){if(![1,2,3,4].includes(grade))throw Error('FSRS 评分无效');const {t,params,memory,shadow}=checkedTrial(row,at),result=require('ts-fsrs').fsrs(params).next(memory,at,grade),after=memoryOf(clone(result.card)),mapped=[0,0,1,2,2][grade],shadowAfter=schedule('cards',shadow,mapped,at);return {t,grade,mapped,at,memoryBefore:memory,memoryAfter:after,officialLog:clone(result.log),shadowBefore:shadow,shadowAfter,actual:{interval_days:(instant(after.due)-instant(at))/86400000,reps:shadowAfter.reps,due:after.due}};}
 function persistReview(row,operationId,result){const r=result;run('UPDATE practice_fsrs SET memory=?,shadow=?,updated_at=? WHERE card_id=?',[JSON.stringify(r.memoryAfter),JSON.stringify(r.shadowAfter),r.at,row.id]);run('INSERT INTO practice_fsrs_review VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[operationId,row.id,r.grade,r.mapped,RATING_SCALE,LIBRARY_VERSION,r.t.parameter_version,r.t.epoch,JSON.stringify(r.memoryBefore),JSON.stringify(r.memoryAfter),JSON.stringify(r.officialLog),JSON.stringify(r.shadowBefore),JSON.stringify(r.shadowAfter),r.t.content_key,r.at]);}
 function addEvent(row,action,before,after,at,operationId=null,backupPath=null){run('INSERT INTO practice_fsrs_event VALUES(?,?,?,?,?,?,?,?,?)',[randomUUID(),row.id,action,operationId,row.revision,at,before?JSON.stringify(before):null,JSON.stringify(after),backupPath]);}
 function onEdit(row,next,at){const t=trial(row.id);if(t?.phase!=='fsrs')return;checkedTrial(row,at);const memory=clone(require('ts-fsrs').createEmptyCard(at)),shadow={interval_days:0,reps:0,due:row.due?at:null},after={...t,memory:JSON.stringify(memory),shadow:JSON.stringify(shadow),content_key:contentKey(next),epoch:t.epoch+1,updated_at:at};run('UPDATE practice_fsrs SET memory=?,shadow=?,content_key=?,epoch=?,updated_at=? WHERE card_id=?',[after.memory,after.shadow,after.content_key,after.epoch,at,row.id]);addEvent(row,'content_reset',t,after,at);}
 function enrollmentDue(row,at){const t=trial(row.id);return t?.phase==='fsrs'?memoryOf(t.memory).due:at;}
 function makePlan(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>!['id','expectedRevision','action','retention','previewToken','operationId'].includes(key))||!['enable','rollback'].includes(payload.action)||!Number.isSafeInteger(payload.expectedRevision))throw Error('试用切换参数无效');
  const row=card(payload.id);if(row.revision!==payload.expectedRevision)throw Error('卡片已更新，请重新预览切换方案');let proposedDue=row.due,params=null,t=trial(row.id);
  if(payload.action==='enable'){const why=reason(row);if(why)throw Error(why);params=parameters(payload.retention===undefined?0.9:payload.retention);}
  else{if(payload.retention!==undefined)throw Error('退出试用无需指定保持率');if(t?.phase!=='fsrs')throw Error('这张卡当前没有 FSRS 试用');const shadow=stateOf('cards',parse(t.shadow));proposedDue=row.due===null?null:(shadow.due??row.due);}
  const plan={id:row.id,expectedRevision:row.revision,action:payload.action,retention:params?.request_retention??null,parameterVersion:params?hash(params):t.parameter_version,currentDue:row.due,proposedDue,status:row.status,activeTrials:activeCount(),maxTrials:MAX_TRIALS,epoch:t?.epoch??0,contentKey:contentKey(row),shadow:t?.shadow??null};return {row,t,params,plan,token:hash(plan)};
 }
 function plan(payload){const p=makePlan(payload);return {ok:true,...p.plan,previewToken:p.token};}
 function commit(payload){
  identity(payload?.operationId);const requestHash=hash([payload.id,payload.expectedRevision,payload.action,payload.retention??null,payload.previewToken]),cached=q('SELECT * FROM practice_fsrs_operation WHERE id=?',[payload.operationId])[0];
  if(cached){if(cached.payload_hash!==requestHash)throw Error('切换请求与原操作不一致');return parse(cached.result);}
  const p=makePlan(payload);if(p.token!==payload.previewToken)throw Error('切换方案已变化，请重新预览');const at=now();instant(at);const savedBackup=backup(payload.operationId);
  if(!savedBackup?.path||! /^[a-f0-9]{64}$/.test(savedBackup.sha256))throw Error('调度备份未通过校验');
  return persistTransaction(()=>{
   if(payload.action==='enable'){
    const memory=clone(require('ts-fsrs').createEmptyCard(p.row.due||at)),shadow=stateOf('cards',p.row),after={phase:'fsrs',memory,shadow,parameters:p.params,parameterVersion:p.plan.parameterVersion,epoch:0};
    run('INSERT INTO practice_fsrs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[p.row.id,'fsrs',LIBRARY_VERSION,p.plan.parameterVersion,JSON.stringify(p.params),JSON.stringify(memory),JSON.stringify(shadow),JSON.stringify(shadow),contentKey(p.row),0,at,at,savedBackup.path,savedBackup.path]);addEvent(p.row,'enable',null,after,at,payload.operationId,savedBackup.path);
   }else{
    const shadow=stateOf('cards',parse(p.t.shadow)),after={...shadow,due:p.plan.proposedDue};run("UPDATE practice_fsrs SET phase='legacy',updated_at=?,last_backup=? WHERE card_id=?",[at,savedBackup.path,p.row.id]);run('UPDATE practice_card SET interval_days=?,reps=?,due=? WHERE id=?',[after.interval_days,after.reps,after.due,p.row.id]);addEvent(p.row,'rollback',p.t,after,at,payload.operationId,savedBackup.path);
   }
   run('UPDATE practice_card SET revision=revision+1,updated_at=? WHERE id=?',[at,p.row.id]);const result={ok:true,id:p.row.id,action:payload.action,revision:p.row.revision+1,backupPath:savedBackup.path,backupSha256:savedBackup.sha256};run('INSERT INTO practice_fsrs_operation VALUES(?,?,?,?,?)',[payload.operationId,p.row.id,payload.action,requestHash,JSON.stringify(result)]);return result;
  });
 }
 function reviewInfo(id){const r=q('SELECT grade,rating_scale,library_version,parameter_version,epoch FROM practice_fsrs_review WHERE attempt_id=?',[id])[0];return r?{grade:r.grade,ratingScale:r.rating_scale,libraryVersion:r.library_version,parameterVersion:r.parameter_version,epoch:r.epoch}:null;}
 return {summary,preview,step,persistReview,onEdit,enrollmentDue,plan,commit,reviewInfo,isActive:id=>trial(id)?.phase==='fsrs'};
}
module.exports={LIBRARY_VERSION,RATING_SCALE,MAX_TRIALS,gradeNames,parameters,memoryOf,ensurePracticeFsrsSchema,createPracticeFsrs};

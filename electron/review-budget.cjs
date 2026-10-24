const {localDayRange}=require('./local-day.cjs');
const RULES={
 review_daily_new_words:{label:'每日新词',min:0,max:500,default:20},
 review_daily_new_cards:{label:'每日新卡',min:0,max:200,default:10},
 review_batch_size:{label:'每轮数量',min:1,max:100,default:30},
 review_target_minutes:{label:'目标时长',min:1,max:120,default:10},
};
const NEW_WORD="(COALESCE(u.reps,0)=0 AND COALESCE(u.lapses,0)=0 AND NOT EXISTS(SELECT 1 FROM review_log l WHERE l.word_id=u.id) AND NOT EXISTS(SELECT 1 FROM review_introduction i WHERE i.kind='words' AND i.item_id=CAST(u.id AS TEXT)))";
const NEW_CARD="(NOT EXISTS(SELECT 1 FROM practice_attempt a WHERE a.card_id=c.id) AND NOT EXISTS(SELECT 1 FROM review_introduction i WHERE i.kind='cards' AND i.item_id=c.id))";
function valueFor(key,value){const rule=RULES[key];if(!rule)throw Error('复习设置无效');if(!['number','string'].includes(typeof value)||!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)<rule.min||Number(value)>rule.max)throw Error(rule.label+'应为 '+rule.min+' 至 '+rule.max+' 的整数');return Number(value);}
function validateReviewSettings(settings){if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error('设置格式无效');for(const [key,value]of Object.entries(settings))if(Object.hasOwn(RULES,key))valueFor(key,value);}
function ensureReviewBudgetSchema(db){db.run(`CREATE INDEX IF NOT EXISTS idx_review_word_time ON review_log(word_id,reviewed_at);
 CREATE TABLE IF NOT EXISTS review_introduction(kind TEXT NOT NULL,item_id TEXT NOT NULL,introduced_at TEXT,PRIMARY KEY(kind,item_id));
 CREATE INDEX IF NOT EXISTS idx_review_introduction_day ON review_introduction(kind,introduced_at);
 INSERT OR IGNORE INTO review_introduction SELECT 'words',CAST(word_id AS TEXT),MIN(reviewed_at) FROM review_log WHERE word_id IS NOT NULL GROUP BY word_id;
 INSERT OR IGNORE INTO review_introduction SELECT 'cards',card_id,MIN(reviewed_at) FROM practice_attempt GROUP BY card_id;
 INSERT OR IGNORE INTO review_introduction SELECT 'words',CAST(id AS TEXT),NULL FROM user_word WHERE COALESCE(reps,0)>0 OR COALESCE(lapses,0)>0;`);}
function createReviewBudget({q,run,now}){
 function preferences(){const saved=Object.fromEntries(q('SELECT key,value FROM settings').map(row=>[row.key,row.value]));return Object.fromEntries(Object.entries(RULES).map(([key,rule])=>{try{return [key,valueFor(key,saved[key])];}catch{return [key,rule.default];}}));}
 function counts(kind,range){
  const table=kind==='words'?'review_log':'practice_attempt',identity=kind==='words'?'word_id':'card_id';
  const introduced=q('SELECT COUNT(*) AS n FROM review_introduction WHERE kind=? AND introduced_at>=? AND introduced_at<?',[kind,range.start,range.end])[0].n;
  const today=q(`SELECT COUNT(*) AS attempts,COUNT(DISTINCT ${identity}) AS items FROM ${table} WHERE ${identity} IS NOT NULL AND reviewed_at>=? AND reviewed_at<?`,[range.start,range.end])[0];
  return {introducedToday:introduced,reviewedToday:today.attempts,itemsToday:today.items};
 }
 function plan(kind,options={},instant=now()){
  if(!['words','cards'].includes(kind)||!options||typeof options!=='object'||Array.isArray(options)||(options.dueOnly!==undefined&&typeof options.dueOnly!=='boolean'))throw Error('复习计划参数无效');
  const range=localDayRange(new Date(instant)),prefs=preferences(),isWords=kind==='words',fresh=isWords?NEW_WORD:NEW_CARD,table=isWords?'user_word u':'practice_card c',alias=isWords?'u':'c',active=isWords?"u.status='learning'":"c.status='active' AND c.due IS NOT NULL";
  const ready=isWords?`(${NEW_WORD} OR ${alias}.due IS NULL OR ${alias}.due<=?)`:`${alias}.due<=?`;
  const available=q(`SELECT COALESCE(SUM(CASE WHEN ${fresh} THEN 1 ELSE 0 END),0) AS fresh,COALESCE(SUM(CASE WHEN NOT(${fresh}) THEN 1 ELSE 0 END),0) AS due,COALESCE(SUM(CASE WHEN NOT(${fresh}) AND ${alias}.due<? THEN 1 ELSE 0 END),0) AS overdue FROM ${table} WHERE ${active} AND ${ready}`,[range.start,instant])[0];
  const daily=counts(kind,range),newLimit=prefs[isWords?'review_daily_new_words':'review_daily_new_cards'],remainingNew=Math.max(0,newLimit-daily.introducedToday),secondsEach=isWords?20:60,capacity=Math.min(prefs.review_batch_size,Math.max(1,Math.floor(prefs.review_target_minutes*60/secondsEach)));
  const plannedDue=Math.min(available.due,capacity),plannedNew=options.dueOnly?0:Math.min(available.fresh,remainingNew,capacity-plannedDue),total=plannedDue+plannedNew;
  return {kind,...available,...daily,newLimit,remainingNew,plannedDue,plannedNew,total,capacity,deferredDue:available.due-plannedDue,deferredNew:available.fresh-plannedNew,estimatedMinutes:Math.ceil(total*secondsEach/60),targetMinutes:prefs.review_target_minutes,dueOnly:!!options.dueOnly,dayEnd:range.end};
 }
 function isNew(kind,id){return kind==='words'?q(`SELECT id FROM user_word u WHERE id=? AND ${NEW_WORD}`,[id]).length:q(`SELECT id FROM practice_card c WHERE id=? AND ${NEW_CARD}`,[id]).length;}
 function assertIntroduction(kind,id,instant=now()){
  if(isNew(kind,id)&&plan(kind,{},instant).remainingNew===0)throw Error('今日新'+(kind==='words'?'词':'卡')+'额度已用完，可继续复习已学内容或在设置调整额度');
 }
 function recordIntroduction(kind,id,instant=now()){const first=isNew(kind,id);run('INSERT OR IGNORE INTO review_introduction(kind,item_id,introduced_at) VALUES(?,?,?)',[kind,String(id),first?instant:null]);}
 function workload(){const current=now(),words=plan('words',{},current),cards=plan('cards',{},current);const nextDue=q("SELECT MIN(due) AS value FROM (SELECT due FROM user_word WHERE status='learning' AND due>? UNION ALL SELECT due FROM practice_card WHERE status='active' AND due>?)",[current,current])[0].value;return {preferences:preferences(),words,cards,dayEnd:words.dayEnd,nextDue};}
 return {preferences,plan,assertIntroduction,recordIntroduction,workload};
}
module.exports={RULES,NEW_WORD,NEW_CARD,valueFor,validateReviewSettings,ensureReviewBudgetSchema,createReviewBudget};

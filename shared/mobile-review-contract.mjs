// Transport-independent P4 prototype. No IPC, authentication, storage, or scoring writes.
export const VERSION=1,MAX_CARDS=30,MAX_OUTBOX=200,MAX_BATCH_MS=24*60*60*1000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const fail=code=>{throw Error(code);},record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
function shape(v,keys){if(!record(v))fail('invalid_shape');const actual=Object.keys(v);if(actual.length!==keys.length||actual.some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(v,k)))fail('invalid_shape');}
function id(v){if(typeof v!=='string'||!UUID.test(v))fail('invalid_identity');return v;}
function hash(v){if(typeof v!=='string'||!HASH.test(v))fail('invalid_content_key');return v;}
function integer(v,min=1){if(!Number.isSafeInteger(v)||v<min)fail('invalid_integer');return v;}
export function instant(v){if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)fail('invalid_time');return Date.parse(v);}
function list(v,max){if(!Array.isArray(v)||v.length>max)fail('invalid_list');for(let i=0;i<v.length;i++)if(!Object.hasOwn(v,i))fail('invalid_list');return v;}
export function scheduler(v){
 shape(v,['engine','version','parameterVersion','epoch']);
 if(v.engine==='legacy-card'){if(v.version!=='1'||v.parameterVersion!==null||v.epoch!==0)fail('invalid_scheduler');}
 else if(v.engine==='fsrs-card'){if(v.version!=='5.4.2')fail('unsupported_scheduler');hash(v.parameterVersion);integer(v.epoch,0);}
 else fail('invalid_scheduler');
 return {engine:v.engine,version:v.version,parameterVersion:v.parameterVersion,epoch:v.epoch};
}
export function operation(v){
 shape(v,['v','operationId','libraryId','libraryEpoch','deviceId','batchId','cardId','expectedRevision','contentKey','scheduler','response','ratingScale','rating','answeredAt','sequence']);
 if(v.v!==VERSION)fail('unsupported_version');const s=scheduler(v.scheduler),scale=s.engine==='fsrs-card'?'fsrs-4-v1':'legacy-3-v1';
 if(v.ratingScale!==scale||!(s.engine==='fsrs-card'?[1,2,3,4]:[0,1,2]).includes(v.rating))fail('invalid_rating');
 if(typeof v.response!=='string'||v.response.length>10000)fail('invalid_response');instant(v.answeredAt);
 return {v:VERSION,operationId:id(v.operationId),libraryId:id(v.libraryId),libraryEpoch:id(v.libraryEpoch),deviceId:id(v.deviceId),batchId:id(v.batchId),cardId:id(v.cardId),expectedRevision:integer(v.expectedRevision),contentKey:hash(v.contentKey),scheduler:s,response:v.response,ratingScale:scale,rating:v.rating,answeredAt:v.answeredAt,sequence:integer(v.sequence)};
}
// Stable JS JSON field order for protocol v1, not a signature, hash, or authorization token.
export const operationKey=v=>JSON.stringify(operation(v));
export function ticket(v){
 shape(v,['v','batchId','libraryId','libraryEpoch','deviceId','issuedAt','expiresAt','cards']);if(v.v!==VERSION)fail('unsupported_version');
 const duration=instant(v.expiresAt)-instant(v.issuedAt);if(duration<=0||duration>MAX_BATCH_MS)fail('invalid_batch_duration');
 const seen=new Set(),cards=list(v.cards,MAX_CARDS).map(c=>{shape(c,['id','revision','contentKey','scheduler']);id(c.id);if(seen.has(c.id))fail('duplicate_card');seen.add(c.id);return {id:c.id,revision:integer(c.revision),contentKey:hash(c.contentKey),scheduler:scheduler(c.scheduler)};});if(!cards.length)fail('empty_batch');
 return {v:VERSION,batchId:id(v.batchId),libraryId:id(v.libraryId),libraryEpoch:id(v.libraryEpoch),deviceId:id(v.deviceId),issuedAt:v.issuedAt,expiresAt:v.expiresAt,cards};
}
export const CONFLICTS=Object.freeze(['device-revoked','wrong-library','wrong-device','library-reset','operation-reused','wrong-batch','batch-not-started','batch-expired','card-not-in-batch','base-changed','scheduler-changed','card-unavailable','new-card','not-due']);
function conflict(code){return {kind:'conflict',code};}
export function receipt(v){
 shape(v,['v','request','kind','code','reviewedAt','due']);if(v.v!==VERSION)fail('unsupported_version');const request=operation(v.request);
 if(v.kind==='applied'){if(v.code!==null)fail('invalid_receipt');instant(v.reviewedAt);instant(v.due);if(instant(v.due)<=instant(v.reviewedAt))fail('invalid_receipt');}
 else if(v.kind==='conflict'){if(!CONFLICTS.includes(v.code)||v.reviewedAt!==null||v.due!==null)fail('invalid_receipt');}
 else fail('invalid_receipt');
 return {v:VERSION,request,kind:v.kind,code:v.code,reviewedAt:v.reviewedAt,due:v.due};
}
// Read-only base comparison. Trusted device/ticket/receipt must come from a verified adapter.
// A base-match does NOT authenticate a device or authorize a database write.
export function classify({request,batch,device,current,previous=null,at}){
 const op=operation(request);instant(at);shape(device,['id','libraryId','libraryEpoch','active']);id(device.id);id(device.libraryId);id(device.libraryEpoch);if(typeof device.active!=='boolean')fail('invalid_device');
 if(!device.active)return conflict('device-revoked');
 if(op.deviceId!==device.id)return conflict('wrong-device');if(op.libraryId!==device.libraryId)return conflict('wrong-library');if(op.libraryEpoch!==device.libraryEpoch)return conflict('library-reset');
 if(previous){const p=receipt(previous);return operationKey(p.request)===operationKey(op)?{kind:'duplicate',receipt:p}:conflict('operation-reused');}
 if(!batch)return conflict('wrong-batch');const t=ticket(batch);
 if(t.deviceId!==op.deviceId||t.libraryId!==op.libraryId||t.libraryEpoch!==op.libraryEpoch||t.batchId!==op.batchId)return conflict('wrong-batch');
 if(instant(at)<instant(t.issuedAt))return conflict('batch-not-started');if(instant(at)>=instant(t.expiresAt))return conflict('batch-expired');
 const base=t.cards.find(c=>c.id===op.cardId);if(!base)return conflict('card-not-in-batch');
 if(base.revision!==op.expectedRevision||base.contentKey!==op.contentKey)return conflict('base-changed');if(JSON.stringify(base.scheduler)!==JSON.stringify(op.scheduler))return conflict('scheduler-changed');
 if(!current)return conflict('card-unavailable');shape(current,['id','revision','contentKey','scheduler','status','due','introduced']);id(current.id);integer(current.revision);hash(current.contentKey);const s=scheduler(current.scheduler);if(typeof current.introduced!=='boolean'||!['active','paused','archived'].includes(current.status))fail('invalid_current');if(current.due!==null)instant(current.due);
 if(current.id!==op.cardId||current.status!=='active'||current.due===null)return conflict('card-unavailable');
 if(current.revision!==op.expectedRevision||current.contentKey!==op.contentKey)return conflict('base-changed');if(JSON.stringify(s)!==JSON.stringify(op.scheduler))return conflict('scheduler-changed');
 if(!current.introduced)return conflict('new-card');if(instant(current.due)>instant(at))return conflict('not-due');
 return {kind:'base-match',clockWarning:instant(op.answeredAt)<instant(t.issuedAt)-5*60000||instant(op.answeredAt)>instant(at)+5*60000};
}
export function emptyOutbox({libraryId,libraryEpoch,deviceId}){return {v:VERSION,libraryId:id(libraryId),libraryEpoch:id(libraryEpoch),deviceId:id(deviceId),nextSequence:1,entries:[]};}
function outbox(value){
 shape(value,['v','libraryId','libraryEpoch','deviceId','nextSequence','entries']);if(value.v!==VERSION)fail('unsupported_version');const result=emptyOutbox(value);result.nextSequence=integer(value.nextSequence);const seen=new Set(),seq=new Set(),open=new Set();
 result.entries=list(value.entries,MAX_OUTBOX).map(e=>{shape(e,['request','confirmation']);const request=operation(e.request);if(request.libraryId!==result.libraryId||request.libraryEpoch!==result.libraryEpoch||request.deviceId!==result.deviceId||seen.has(request.operationId)||seq.has(request.sequence)||request.sequence>=result.nextSequence)fail('invalid_outbox');seen.add(request.operationId);seq.add(request.sequence);const confirmation=e.confirmation===null?null:receipt(e.confirmation);if(confirmation&&operationKey(confirmation.request)!==operationKey(request))fail('mismatched_receipt');if(!confirmation){if(open.has(request.cardId))fail('card_already_pending');open.add(request.cardId);}return {request,confirmation};});return result;
}
export const restoreOutbox=value=>outbox(value);
export function enqueue(value,request){
 const box=outbox(value),op=operation(request),old=box.entries.find(e=>e.request.operationId===op.operationId);
 if(old){if(operationKey(old.request)!==operationKey(op))fail('operation_reused');return {outbox:box,duplicate:true};}
 if(box.entries.length>=MAX_OUTBOX)fail('outbox_full');if(op.libraryId!==box.libraryId||op.libraryEpoch!==box.libraryEpoch||op.deviceId!==box.deviceId||op.sequence!==box.nextSequence)fail('wrong_queue_identity');
 if(box.entries.some(e=>e.request.cardId===op.cardId&&e.confirmation===null))fail('card_already_pending');
 if(box.nextSequence===Number.MAX_SAFE_INTEGER)fail('sequence_exhausted');box.entries.push({request:op,confirmation:null});box.nextSequence++;return {outbox:box,duplicate:false};
}
export function confirm(value,confirmations){
 const box=outbox(value);for(const raw of list(confirmations,MAX_OUTBOX)){const r=receipt(raw),e=box.entries.find(e=>e.request.operationId===r.request.operationId);if(!e||operationKey(e.request)!==operationKey(r.request))fail('mismatched_receipt');if(e.confirmation&&JSON.stringify(e.confirmation)!==JSON.stringify(r))fail('confirmation_changed');e.confirmation=r;}return box;
}
export const pendingOperations=value=>outbox(value).entries.filter(e=>!e.confirmation).map(e=>e.request);

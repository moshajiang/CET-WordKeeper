const {SOURCES}=require('./updates.cjs');
const INTERVAL=6*60*60*1000,START_DELAY=15000,RETRY=30*60*1000,SNOOZE=24*60*60*1000;
const defaults=()=>({version:1,enabled:true,source:'github',lastAttemptAt:null,lastSuccessAt:null,nextCheckAt:null,lastSource:null,failures:0,skippedVersion:null,snoozedVersion:null,snoozeUntil:null});
const version=value=>typeof value==='string'&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)&&value.length<100;
const date=value=>value===null||typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function validate(value){const d=defaults();if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==Object.keys(d).length||Object.keys(value).some(k=>!Object.hasOwn(d,k))||value.version!==1||typeof value.enabled!=='boolean'||!Object.hasOwn(SOURCES,value.source)||!['lastAttemptAt','lastSuccessAt','nextCheckAt','snoozeUntil'].every(k=>date(value[k]))||value.lastSource!==null&&!Object.hasOwn(SOURCES,value.lastSource)||!Number.isSafeInteger(value.failures)||value.failures<0||value.failures>100||!['skippedVersion','snoozedVersion'].every(k=>value[k]===null||version(value[k])))throw Error('自动更新设置格式无效');return {...value};}
function createAutomaticUpdates({updates,read=()=>null,write=()=>{},notify=()=>{},packaged=true,clock=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout,canRun=()=>true}){
 let prefs=defaults(),configured=false,error=null,running=false,timer=null,pending=null,revision=0,startedAt=null;
 try{const value=read();if(value!==null){prefs=validate(value);configured=true;}}catch(e){configured=true;prefs.enabled=false;error='自动更新设置读取失败，请在设置中重新保存。';}
 if(!error&&prefs.nextCheckAt&&Date.parse(prefs.nextCheckAt)>clock()+INTERVAL)prefs.nextCheckAt=new Date(clock()+START_DELAY).toISOString();
 const iso=time=>new Date(time).toISOString(),snapshot=()=>({...prefs,configured,error,revision,active:running&&packaged&&prefs.enabled&&!error,packaged});
 const publish=()=>{revision++;notify();};
 function commit(next){write(validate(next));prefs=next;configured=true;error=null;publish();}
 function schedule(){clearTimer(timer);timer=null;if(!running||!packaged||!prefs.enabled||error||!canRun())return;let due=prefs.nextCheckAt?Date.parse(prefs.nextCheckAt):startedAt+START_DELAY;if(due>clock()+INTERVAL)due=clock()+INTERVAL;const wait=Math.min(60000,Math.max(1,due-clock()));timer=setTimer(()=>{timer=null;void tick();},wait);timer?.unref?.();}
 function shouldRemind(s=updates.snapshot()){
  if(!['available','downloaded','downloading'].includes(s.phase)&&!(s.phase==='error'&&s.canDownload))return false;
  if(s.trigger==='automatic'&&!prefs.enabled)return false;
  if(!version(s.latest))return false;if(s.trigger!=='automatic'||['downloading','downloaded'].includes(s.phase))return !(prefs.snoozedVersion===s.latest&&prefs.snoozeUntil&&Date.parse(prefs.snoozeUntil)>clock());
  return prefs.skippedVersion!==s.latest&&!(prefs.snoozedVersion===s.latest&&prefs.snoozeUntil&&Date.parse(prefs.snoozeUntil)>clock());
 }
 async function tick(){
  if(!running||!packaged||!prefs.enabled||error||!canRun()){schedule();return;}
  const now=clock();let due=prefs.nextCheckAt?Date.parse(prefs.nextCheckAt):startedAt+START_DELAY;
  if(due>now+INTERVAL){prefs={...prefs,nextCheckAt:iso(now+START_DELAY)};publish();schedule();return;}
  if(now<due){publish();schedule();return;}
  if(pending)return pending;
  if(['checking','downloading','downloaded'].includes(updates.snapshot().phase)){publish();timer=setTimer(()=>{timer=null;void tick();},60000);timer?.unref?.();return;}
  pending=(async()=>{
   try{
    commit({...prefs,lastAttemptAt:iso(clock()),nextCheckAt:iso(clock()+RETRY)});
    const selected=prefs.source;let result=await updates.check(selected,{download:false,trigger:'automatic'});
    // Preference changes invalidate the old automatic chain; never fall back after disabling it.
    if(!running||!prefs.enabled||prefs.source!==selected||!canRun())return result;
    if(!result.ok&&result.phase==='error')result=await updates.check(selected==='github'?'gitee':'github',{download:false,trigger:'automatic'});
    if(!running||!canRun())return result;
    const success=!!result.ok,failures=success?0:Math.min(100,prefs.failures+1),delay=success?INTERVAL:Math.min(INTERVAL,RETRY*2**Math.min(4,failures-1));
    commit({...prefs,lastSuccessAt:success?iso(clock()):prefs.lastSuccessAt,lastSource:result.source||selected,failures,nextCheckAt:iso(clock()+delay)});return result;
   }catch(e){error='自动更新检查或设置保存失败，可在设置中重试：'+String(e.message||e).slice(0,180);publish();}
  })().finally(()=>{pending=null;schedule();});return pending;
 }
 function configure(patch){
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['enabled','source'].includes(k))||patch.enabled!==undefined&&typeof patch.enabled!=='boolean'||patch.source!==undefined&&!Object.hasOwn(SOURCES,patch.source))throw Error('自动更新选项无效');
  const sourceChanged=patch.source!==undefined&&patch.source!==prefs.source;if(sourceChanged&&(updates.isBusy?.()||['checking','downloading','downloaded'].includes(updates.snapshot().phase)))throw Error('请等待当前更新完成后切换来源');
  const reenabled=patch.enabled===true&&!prefs.enabled,next={...prefs,...patch,...(sourceChanged||reenabled||error?{nextCheckAt:iso(clock()+START_DELAY),failures:0}:{})};commit(next);if(sourceChanged)updates.selectSource?.(next.source);schedule();return snapshot();
 }
 function dismiss(action){const s=updates.snapshot();if(!version(s.latest)||!['available','downloaded','downloading','error'].includes(s.phase)||!['later','skip'].includes(action)||action==='skip'&&s.phase!=='available')throw Error('当前更新不支持此提醒操作');commit({...prefs,...(action==='skip'?{skippedVersion:s.latest}:{snoozedVersion:s.latest,snoozeUntil:iso(clock()+SNOOZE)})});schedule();return snapshot();}
 return {snapshot,configure,dismiss,shouldRemind,tick,start(){if(running)return;running=true;startedAt=clock();publish();schedule();},stop(){running=false;clearTimer(timer);timer=null;},wake(){if(running){clearTimer(timer);timer=null;void tick();}},};
}
module.exports={createAutomaticUpdates,defaults,validate,INTERVAL,START_DELAY,RETRY,SNOOZE};

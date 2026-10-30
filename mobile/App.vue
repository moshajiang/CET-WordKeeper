<template>
 <main class="mobile-shell">
  <header class="masthead"><div><span class="brand">WORDKEEPER</span><h1>随身复习</h1></div><span class="demo-badge">演示预览</span></header>
  <p class="demo-note">原创示例练习 · 不连接桌面学习库，也不会改变正式学习进度。</p>
  <nav class="tabs" aria-label="移动复习导航"><button :aria-current="tab==='review'?'page':undefined" @click="tab='review'">复习</button><button :aria-current="tab==='records'?'page':undefined" @click="tab='records'">本地记录 <span>{{ entries.length }}</span></button></nav>
  <p class="connection-note">{{ online?'本页可离线记录；重新打开离线页面的能力将在后续加入。':'当前离线，已打开页面仍可记录作答。' }}</p>
  <p v-if="external" class="notice" role="status">其他页面更新了演示记录，当前输入已保留。<button @click="reload" :disabled="busy">重新读取</button></p>
  <p v-if="error" class="error" role="alert">{{ error }} <button v-if="!pending" @click="reload" :disabled="busy">重新读取</button></p>
  <p v-if="notice" class="notice" role="status">{{ notice }}</p>
  <p v-if="loading" role="status">正在读取本地记录…</p>
  <section v-else-if="!data&&!error" class="surface welcome"><span class="eyebrow">从六张卡开始</span><h2>把一次回忆，<br>留在手边。</h2><p>体验问答、翻译、判断、选择、拼写与填空。评分后记录保存在当前浏览器，关闭再打开仍可查看。</p><button class="primary" @click="start" :disabled="busy">开始六题演示</button><p class="muted">本阶段只提供演示包，设备配对与正式同步尚未开放。</p></section>
  <template v-else-if="data&&!loading">
   <template v-if="tab==='review'">
    <section class="round-meta"><span>第 {{ data.round }} 轮演示</span><strong>本轮已记录 {{ roundCount }} / {{ data.session.cards.length }}</strong></section>
    <div class="progress" role="progressbar" aria-label="本轮已记录" :aria-valuenow="roundCount" :aria-valuemax="data.session.cards.length" aria-valuemin="0"><span v-for="(c,index) in data.session.cards" :key="c.id" :class="{done:roundRecorded(c.id)}" /></div>
    <section v-if="current&&!ended" class="surface review-card">
     <p class="eyebrow">{{ LABELS[current.type] }} <span>{{ fsrs?'四档回忆难度':'三档自评' }}</span></p>
     <h2 ref="questionHeading" tabindex="-1" class="question">{{ current.question }}</h2>
     <p v-if="alreadyRecorded" class="notice">这道题已在本地记录，当前草稿不会覆盖它。<button @click="nextCard" :disabled="busy">继续其他题</button></p>
     <fieldset v-if="objective" :disabled="revealed||busy||!!pending||alreadyRecorded"><legend>选择你的答案</legend><label v-for="option in choices(current)" :key="option.value" class="choice"><input v-model="response" :value="option.value" type="radio" name="mobile-answer" /> <span>{{ option.label }}</span></label></fieldset>
     <form v-else-if="typed" @submit.prevent="reveal(false)"><label class="answer-label">原文表达<input v-model="response" aria-label="移动拼写作答" maxlength="10000" autocomplete="off" autocapitalize="none" spellcheck="false" :disabled="revealed||busy||!!pending||alreadyRecorded" placeholder="保持原词形" /></label><p class="muted">忽略大小写与多余空白，不替换词形或同义词。</p></form>
     <label v-else class="answer-label">我的作答<textarea v-model="response" aria-label="移动文字作答" rows="4" maxlength="10000" :disabled="revealed||busy||!!pending||alreadyRecorded" placeholder="可以在心中作答，也可记下关键词" /></label>
     <div v-if="!revealed" class="reveal-actions"><button class="primary" :disabled="busy||alreadyRecorded||!canReveal(current,response)" @click="reveal(false)">{{ typed?'核对参考拼写':'查看参考答案' }}</button><button v-if="typed" :disabled="busy||alreadyRecorded" @click="reveal(true)">没想起，查看答案</button></div>
     <section v-if="revealed" class="reference" aria-label="参考答案"><h3 ref="answerHeading" tabindex="-1">参考答案</h3><p class="reference-answer">{{ answerLabel(current) }}</p><p v-if="objective||typed" :class="check.correct?'match':'mismatch'">{{ check.correct?'与参考答案一致':'与参考答案不一致，请如实评分' }}</p><p v-else class="muted">这类回答由你对照后自评，不自动判分。</p><p class="explanation">{{ current.explanation }}</p><details><summary>原文与出处</summary><p>{{ current.sourceTitle }}</p><blockquote>{{ current.sourceContent }}</blockquote><p class="muted">{{ current.sourceLabel }}</p></details><p class="muted">选择回忆难度后仅记录在本浏览器，不计算正式复习间隔。</p><div class="rating-actions" :class="{four:fsrs}"><button v-for="grade in grades(current)" :key="grade.value" :disabled="busy||!!pending||alreadyRecorded||!canRate(current,response,grade.value)" @click="submit(grade.value)">{{ grade.label }}</button></div></section>
     <div v-if="pending" class="retry-actions"><button class="primary" @click="submit()" :disabled="busy">重试本次记录</button><button @click="pending=null;revealed=false" :disabled="busy">保留输入，重新作答</button></div>
     <button class="quiet" @click="endRound" :disabled="busy">稍后继续</button>
    </section>
    <section v-else class="surface round-empty"><h2>{{ ended?'本轮暂告一段落':'本轮六题已记录' }}</h2><p>{{ ended?'已记录的作答保留，未评分内容可继续。':'所有作答仅保存在本机，尚未连接桌面确认。' }}</p><div class="actions"><button v-if="available.length" class="primary" @click="resume" :disabled="busy">继续未记录的题</button><button @click="tab='records'">查看本地记录</button></div></section>
   </template>
   <section v-else class="record-section">
    <div class="records-heading"><h2>本地记录</h2><button @click="exportArchive" :disabled="busy||!entries.length">导出演示副本</button></div>
    <p class="muted">待确认表示已在本机记录。下方模拟按钮只演示回执状态，不代表桌面已入账。</p>
    <div class="record-filters" role="group" aria-label="记录状态筛选"><button v-for="filter in filters" :key="filter.key" :aria-pressed="recordFilter===filter.key" @click="recordFilter=filter.key">{{ filter.label }} {{ count(filter.key) }}</button></div>
    <article v-for="e in filteredEntries" :key="e.request.operationId" class="surface history-entry"><p class="eyebrow">{{ LABELS[snapshot(e).type] }} · 第 {{ e.request.sequence }} 条 <span>{{ statusLabel(e) }}</span></p><h3>{{ snapshot(e).question }}</h3><p class="raw-response"><b>我的作答</b>{{ e.request.response||'（心中作答，未填写文字）' }}</p><p class="muted">{{ gradeLabel(e) }} · {{ date(e.request.answeredAt) }}</p><p v-if="e.confirmation?.kind==='conflict'" class="mismatch">冲突示例：桌面版本已变化。原作答保留，不能覆盖新版本。</p><details><summary>参考答案与原始出处</summary><p>{{ answerLabel(snapshot(e)) }}</p><blockquote>{{ snapshot(e).sourceContent }}</blockquote><p class="muted">{{ snapshot(e).sourceLabel }}</p></details><div v-if="!e.confirmation" class="simulation-actions"><button @click="simulate(e,'applied')" :disabled="busy">模拟确认此条</button><button @click="simulate(e,'conflict')" :disabled="busy">模拟版本冲突</button></div></article>
    <p v-if="!filteredEntries.length" class="empty-note">当前筛选没有记录。</p>
    <section class="surface demo-tools"><h3>演示管理</h3><p class="muted">新一轮会保留旧记录；尚有待确认项时，请先模拟处理。清理与重新开始只影响当前浏览器的演示数据。</p><div class="actions"><button @click="start" :disabled="busy||hasPending">开始新一轮演示</button><button @click="clearConfirmed" :disabled="busy||!count('applied')">清理确认示例</button><button class="danger" @click="reset" :disabled="busy">清空演示数据</button></div></section>
   </section>
  </template>
  <footer>本地演示原型 · 尚未开放正式复习包导入或设备配对</footer>
 </main>
</template>
<script setup>
import {ref,computed,onMounted,onBeforeUnmount,nextTick} from 'vue';
import {createDemoStore,describeStorageError} from './lib/store.mjs';
import {LABELS,compare,choices,grades,canReveal,canRate,answerLabel} from './lib/review-model.mjs';
const store=createDemoStore(),data=ref(null),loading=ref(true),busy=ref(false),error=ref(''),notice=ref(''),external=ref(false),online=ref(navigator.onLine),tab=ref('review'),recordFilter=ref('all'),cardId=ref(null),response=ref(''),revealed=ref(false),pending=ref(null),ended=ref(false),questionHeading=ref(null),answerHeading=ref(null);let disposed=false,unsubscribe;
const entries=computed(()=>data.value?.outbox.entries||[]),current=computed(()=>data.value?.session.cards.find(c=>c.id===cardId.value)),objective=computed(()=>['choice','judgment'].includes(current.value?.type)),typed=computed(()=>['spelling','cloze'].includes(current.value?.type)),fsrs=computed(()=>current.value?.scheduler.engine==='fsrs-card'),check=computed(()=>current.value?compare(current.value,response.value):{correct:null}),hasPending=computed(()=>entries.value.some(e=>!e.confirmation));
const roundRecorded=id=>entries.value.some(e=>e.request.batchId===data.value?.session.ticket.batchId&&e.request.cardId===id),roundCount=computed(()=>data.value?.session.cards.filter(c=>roundRecorded(c.id)).length||0),available=computed(()=>data.value?.session.cards.filter(c=>!roundRecorded(c.id))||[]),alreadyRecorded=computed(()=>current.value&&roundRecorded(current.value.id));
const filters=[{key:'all',label:'全部'},{key:'pending',label:'待确认'},{key:'applied',label:'确认示例'},{key:'conflict',label:'冲突示例'}],status=e=>e.confirmation?.kind||'pending',count=key=>entries.value.filter(e=>key==='all'||status(e)===key).length,filteredEntries=computed(()=>[...entries.value].reverse().filter(e=>recordFilter.value==='all'||status(e)===recordFilter.value)),snapshot=e=>data.value.snapshots[e.request.operationId].card,statusLabel=e=>({pending:'本机待确认 · 演示',applied:'已模拟确认',conflict:'冲突示例'})[status(e)],gradeLabel=e=>grades(snapshot(e)).find(g=>g.value===e.request.rating)?.label,date=value=>new Date(value).toLocaleString();
function clearDraft(){response.value='';revealed.value=false;pending.value=null;}
async function nextCard(){if((response.value||pending.value)&&alreadyRecorded.value&&!window.confirm('本题已有本地记录，继续会放弃当前未保存草稿，确定继续？'))return;clearDraft();cardId.value=available.value[0]?.id||null;await nextTick();questionHeading.value?.focus();}
function canDiscard(){return !(response.value||revealed.value||pending.value)||window.confirm('当前未记录的作答会放弃，已经记录的内容保留。继续吗？');}
async function reload(){if(busy.value||!canDiscard())return;loading.value=true;error.value='';try{const value=await store.load();if(disposed)return;data.value=value;clearDraft();cardId.value=available.value[0]?.id||null;external.value=false;ended.value=false;}catch(e){if(!disposed)error.value=describeStorageError(e);}finally{if(!disposed)loading.value=false;}}
async function action(work){if(busy.value)return;busy.value=true;error.value='';try{const value=await work();if(!disposed){data.value=value;external.value=false;}return value;}catch(e){if(!disposed)error.value=describeStorageError(e);}finally{if(!disposed)busy.value=false;}}
async function start(){if(!canDiscard())return;const value=await action(()=>store.startRound());if(value&&!disposed){clearDraft();cardId.value=available.value[0]?.id||null;ended.value=false;tab.value='review';notice.value='六张原创演示卡已准备好。';await nextTick();questionHeading.value?.focus();}}
async function reveal(forgot=false){if(!current.value||busy.value||alreadyRecorded.value||!canReveal(current.value,response.value,forgot))return;revealed.value=true;await nextTick();answerHeading.value?.focus();}
async function submit(rating){if(busy.value||!current.value||!revealed.value||alreadyRecorded.value)return;if(!pending.value){if(!canRate(current.value,response.value,rating))return;pending.value={operationId:crypto.randomUUID(),batchId:data.value.session.ticket.batchId,cardId:current.value.id,response:response.value,rating,answeredAt:new Date().toISOString()};}const value=await action(()=>store.record(JSON.parse(JSON.stringify(pending.value))));if(value&&!disposed){clearDraft();cardId.value=available.value[0]?.id||null;notice.value='已在本机记录（演示），待确认。关闭页面后仍可查看。';await nextTick();questionHeading.value?.focus();}}
function endRound(){if(!canDiscard())return;clearDraft();ended.value=true;notice.value='本轮暂告一段落，已记录内容保留。';}
async function resume(){ended.value=false;cardId.value=available.value[0]?.id||null;await nextTick();questionHeading.value?.focus();}
async function simulate(e,kind){if(!canDiscard())return;const value=await action(()=>store.simulate(e.request.operationId,kind));if(value){clearDraft();notice.value=kind==='applied'?'已模拟确认，仅为演示状态。':'已保存版本冲突示例，原作答保留。';}}
async function clearConfirmed(){if(!window.confirm('清理 '+count('applied')+' 条确认示例？待确认与冲突示例会保留。'))return;const value=await action(()=>store.clearConfirmed());if(value)notice.value='确认示例已清理，其他记录保留。';}
async function reset(){if(!window.confirm('清空当前浏览器全部演示数据（'+entries.value.length+' 条），包括待确认与冲突示例？建议先导出演示副本。'))return;if(busy.value)return;busy.value=true;try{await store.reset();if(!disposed){data.value=null;clearDraft();cardId.value=null;error.value='';notice.value='演示数据已清空。';}}catch(e){error.value=describeStorageError(e);}finally{if(!disposed)busy.value=false;}}
async function exportArchive(){if(busy.value)return;busy.value=true;try{const archive=await store.archive(),url=URL.createObjectURL(new Blob([JSON.stringify(archive,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='wordkeeper-mobile-demo-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice.value='已生成演示副本下载，不是可导入桌面的正式作答包。';}catch(e){error.value=describeStorageError(e);}finally{if(!disposed)busy.value=false;}}
function connectivity(){online.value=navigator.onLine;}
function beforeLeave(event){if(response.value||pending.value){event.preventDefault();event.returnValue='';}}
onMounted(()=>{reload();unsubscribe=store.subscribe(()=>{external.value=true;});window.addEventListener('online',connectivity);window.addEventListener('offline',connectivity);window.addEventListener('beforeunload',beforeLeave);});onBeforeUnmount(()=>{disposed=true;unsubscribe?.();store.close();window.removeEventListener('online',connectivity);window.removeEventListener('offline',connectivity);window.removeEventListener('beforeunload',beforeLeave);});
</script>

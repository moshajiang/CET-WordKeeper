<template>
 <section class="card review-workload" aria-label="今日复习安排"><h2>按自己的节奏复习</h2>
  <p v-if="error" role="alert">{{ error }} <button @click="load">重新读取</button></p>
  <div v-if="summary" class="workload-columns"><div v-for="kind in ['words','cards']" :key="kind" :data-kind="kind"><strong>{{ kind==='words'?'生词':'练习卡' }}</strong><p>已学待复习 {{ summary[kind].due }}，其中 {{ summary[kind].overdue }} 早于今天到期；待新学 {{ summary[kind].fresh }}。</p><p>今日首次学习 {{ summary[kind].introducedToday }} / {{ summary[kind].newLimit }}，已作答 {{ summary[kind].reviewedToday }} 次。</p><button @click="$router.push({path:'/review',query:kind==='cards'?{tab:'cards'}:{}})">下一轮 {{ summary[kind].total }} {{ kind==='words'?'个':'张' }} · 约 {{ summary[kind].estimatedMinutes }} 分钟</button></div></div>
  <button @click="$router.push('/settings')">调整每日学习量</button>
 </section>
</template>
<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue';
const summary=ref(null),error=ref('');let disposed=false,sequence=0,timer,off;
async function load(){const version=++sequence;try{const result=await window.keeper.reviewWorkload();if(disposed||version!==sequence)return;summary.value=result;error.value='';clearTimeout(timer);const future=[result.dayEnd,result.nextDue].map(Date.parse).filter(Number.isFinite);timer=setTimeout(load,Math.max(100,Math.min(60000,...future.map(t=>t-Date.now()))));}catch(e){if(!disposed&&version===sequence){error.value='复习安排读取失败：'+e.message;clearTimeout(timer);timer=setTimeout(load,60000);}}}
function visible(){if(!document.hidden)load();}
onMounted(()=>{load();window.addEventListener('focus',load);document.addEventListener('visibilitychange',visible);off=window.keeper.onLearningChanged?.(load);});
onBeforeUnmount(()=>{disposed=true;++sequence;clearTimeout(timer);off?.();window.removeEventListener('focus',load);document.removeEventListener('visibilitychange',visible);});
</script>
<style scoped>
.review-workload{padding:22px;margin-bottom:22px}.review-workload h2{font-size:17px;margin:0 0 15px}.workload-columns{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:15px}.workload-columns p{font-size:12px;color:var(--muted);line-height:1.8}.review-workload button{font-size:12px}@media(max-width:900px){.workload-columns{grid-template-columns:1fr}}
</style>

<template>
 <section class="card review-preferences">
  <h3>复习节奏</h3><p>已学内容优先。每日新内容按本地日期计算，首次评分就计入额度；保存和收藏不会消耗额度。</p>
  <p v-if="error" role="alert">{{ error }} <button @click="load" :disabled="saving">重新读取</button></p>
  <form @submit.prevent="save"><fieldset :disabled="loading||saving||!loaded"><div class="review-preference-fields">
   <label>每日新词<input type="number" min="0" max="500" step="1" v-model="draft.review_daily_new_words" aria-label="每日新词" required /></label>
   <label>每日新练习卡<input type="number" min="0" max="200" step="1" v-model="draft.review_daily_new_cards" aria-label="每日新练习卡" required /></label>
   <label>每轮最多数量<input type="number" min="1" max="100" step="1" v-model="draft.review_batch_size" aria-label="每轮最多数量" required /></label>
   <label>每轮目标分钟<input type="number" min="1" max="120" step="1" v-model="draft.review_target_minutes" aria-label="每轮目标分钟" required /></label>
  </div><p>新内容设为 0 可暂缓引入。目标时长用于估算本轮数量，实际用时因题目和作答速度而异；不会强制中断作答。</p><button class="primary" type="submit">{{ saving?'保存中…':'保存复习节奏' }}</button></fieldset></form>
  <p v-if="notice" role="status">{{ notice }}</p>
 </section>
</template>
<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue';
const draft=ref({review_daily_new_words:20,review_daily_new_cards:10,review_batch_size:30,review_target_minutes:10}),loaded=ref(false),loading=ref(true),saving=ref(false),error=ref(''),notice=ref('');let disposed=false,version=0;
async function load(){if(saving.value)return;const sequence=++version;loading.value=true;error.value='';try{const result=await window.keeper.reviewWorkload();if(disposed||sequence!==version)return;draft.value=result.preferences;loaded.value=true;}catch(e){if(!disposed&&sequence===version)error.value='复习设置读取失败：'+e.message;}finally{if(!disposed&&sequence===version)loading.value=false;}}
async function save(){if(saving.value||loading.value)return;saving.value=true;error.value='';notice.value='';try{const result=await window.keeper.setSettings(JSON.parse(JSON.stringify(draft.value)));if(disposed)return;if(!result.ok)throw Error(result.error);notice.value='复习节奏已保存，重新加载下一轮时生效。';}catch(e){if(!disposed)error.value='保存未完成：'+e.message;}finally{if(!disposed)saving.value=false;}}
onMounted(load);onBeforeUnmount(()=>{disposed=true;++version;});
</script>
<style scoped>
.review-preferences{padding:22px;margin-bottom:20px}.review-preferences h3{font-size:16px}.review-preferences p{color:var(--muted);font-size:12px;line-height:1.8}.review-preferences [role=alert]{color:var(--red)}.review-preferences fieldset{border:0;padding:0;min-width:0}.review-preference-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.review-preference-fields label{font-size:13px}.review-preference-fields input{display:block;width:100%;box-sizing:border-box;background:var(--card);color:var(--text);font:inherit;border:1px solid var(--border);border-radius:7px;padding:9px;margin-top:7px}@media(max-width:800px){.review-preference-fields{grid-template-columns:1fr}}
</style>

<template>
 <section v-if="budget" class="card review-plan" :data-kind="budget.kind">
  <strong>本轮安排 {{ budget.plannedDue }} {{ unit }}已学内容 + {{ budget.plannedNew }} {{ unit }}新内容 · 预计 {{ budget.estimatedMinutes }} 分钟</strong>
  <p>待复习已学内容 {{ budget.due }} {{ unit }}，其中 {{ budget.overdue }} {{ unit }}早于今天到期；可新学 {{ budget.fresh }} {{ unit }}。</p>
  <p>今日已作答 {{ budget.reviewedToday }} 次，涉及 {{ budget.itemsToday }} {{ unit }}；首次学习 {{ budget.introducedToday }} / {{ budget.newLimit }} {{ unit }}，今日新内容剩余额度 {{ budget.remainingNew }} {{ unit }}。</p>
  <p v-if="budget.deferredDue||budget.deferredNew">本轮外还有 {{ budget.deferredDue }} {{ unit }}已学内容、{{ budget.deferredNew }} {{ unit }}新内容。未安排的内容保留原到期时间。</p>
  <p v-if="!budget.total&&budget.fresh" class="review-plan-limit">{{ budget.dueOnly?'本轮只复习已学内容，未安排新内容。':budget.remainingNew===0?'今日新内容额度已用完，可明天继续或调整设置。':'当前没有可安排的内容。' }}</p>
  <label><input type="checkbox" :checked="dueOnly" :disabled="disabled" @change="$emit('change',$event)" :aria-label="budget.kind==='words'?'生词只复习已学内容':'练习卡只复习已学内容'" /> 本轮只复习已学内容，暂缓新内容</label>
  <button @click="$router.push('/settings')" :disabled="disabled">调整复习节奏</button>
 </section>
</template>
<script setup>
import {computed} from 'vue';const props=defineProps({budget:Object,dueOnly:Boolean,disabled:Boolean});defineEmits(['change']);const unit=computed(()=>props.budget?.kind==='words'?'个':'张');
</script>
<style scoped>
.review-plan{padding:18px;margin:14px 0;font-size:13px;line-height:1.8}.review-plan p{font-size:12px;color:var(--muted);margin:7px 0}.review-plan label{display:inline-flex;align-items:center;gap:6px;margin:8px 12px 5px 0}.review-plan button{font-size:12px}.review-plan .review-plan-limit{color:var(--accent)}
</style>

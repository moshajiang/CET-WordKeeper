<template>
 <aside v-if="schedule?.options?.length===3||schedule?.options?.length===4" class="schedule-preview" aria-label="评分间隔预览"><strong>评分后的预计间隔{{ schedule.ratingScale==='fsrs-4-v1'?' · FSRS':'' }}</strong><span v-for="option in schedule.options" :key="option.rating">{{ option.name||['不会 / 忘记','模糊','会用 / 记得'][option.rating] }}：约 {{ option.label }}</span><small>以保存评分时的状态为准。</small></aside>
</template>
<script setup>defineProps({schedule:Object});</script>
<style scoped>.schedule-preview{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;font-size:12px;line-height:1.8;padding:14px;margin:15px 0;border:1px solid var(--border);border-radius:9px;color:var(--muted)}.schedule-preview strong{color:var(--text)}.schedule-preview small{flex-basis:100%;text-align:center}</style>

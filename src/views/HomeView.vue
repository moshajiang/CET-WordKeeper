<template>
 <div>
  <h1 class="page-title">今日学习</h1><p class="page-sub">从上次停下的地方继续，或完成一轮复习</p>
  <p v-if="error" role="alert">{{ error }} <button @click="load">重新加载</button></p>
  <section v-if="recent.length" class="card continue-learning">
   <h2>继续学习</h2><strong>{{ label(recent[0]) }}</strong><p>{{ recent[0].title||sectionLabel(recent[0].section) }}</p>
   <p class="page-sub">{{ draftLabel(recent[0]) }}</p><button class="primary" @click="resume(recent[0])">继续上次篇章</button>
   <button v-for="draft in recent[0].essays" :key="draft.section" @click="resumeEssay(recent[0],draft.section)">继续{{ draft.section==='writing'?'作文':'翻译' }}草稿</button>
  </section>
  <section class="card study-next">
   <div><strong>{{ stats.dueNow>0?`有 ${stats.dueNow} 个生词已到复习时间`:'当前没有到期的生词' }}</strong><p class="page-sub">{{ stats.dueNow>0?'按自己的节奏完成一轮复习。':'可以继续阅读，积累新词和笔记。' }}</p></div>
   <button class="primary" @click="primaryAction">{{ stats.dueNow>0?'开始复习':recent.length?'继续阅读':'选择真题' }}</button>
   <button v-if="reviewDue" @click="$router.push({path:'/review',query:{tab:'knowledge'}})">复习 {{ reviewDue }} 个知识点</button>
   <button v-if="cardDue" @click="$router.push({path:'/review',query:{tab:'cards'}})">复习 {{ cardDue }} 张练习卡</button>
  </section>
  <div class="stat-row" aria-label="学习概况">
   <div class="stat-box due"><div class="num">{{ stats.dueNow }}</div><div class="lbl">待复习</div></div>
   <div class="stat-box"><div class="num">{{ stats.learning }}</div><div class="lbl">学习中的生词</div></div>
   <div class="stat-box"><div class="num">{{ stats.mastered }}</div><div class="lbl">已掌握</div></div>
   <div class="stat-box"><div class="num">{{ stats.reviewedToday }}</div><div class="lbl">今日已复习</div></div>
   <div class="stat-box"><div class="num">{{ stats.exams }}</div><div class="lbl">真题套数</div></div>
  </div>
  <h2 class="page-title" style="font-size:16px">{{ recent.length?'最近学习':'选择一套真题开始' }}</h2>
  <div class="exam-grid"><button v-for="e in recent.length?recent:recommendations" :key="e.id" class="exam-card" @click="resume(e)"><span class="lv" :class="e.level==='CET4'?'cet4':'cet6'">{{ e.level }}</span><div class="name">{{ label(e) }}</div><div class="meta">{{ e.visited_at?draftLabel(e):e.passage_count+' 个篇章' }}</div></button></div>
 </div>
</template>
<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue';import {useRouter} from 'vue-router';import {useLearningState} from '../composables/useLearningState.js';
const router=useRouter(),learning=useLearningState(),stats=learning.stats,recent=ref([]),recommendations=ref([]),reviewDue=ref(0),cardDue=ref(0),error=ref('');let disposed=false,sequence=0;
const label=e=>`${e.level} · ${e.year} 年 ${e.month} 月 · 第 ${e.set_no} 套`;
const sectionLabel=s=>({writing:'写作',translation:'翻译',reading:'仔细阅读',match:'长篇阅读',cloze:'选词填空'})[s]||'阅读';
const draftLabel=e=>[e.draftCount?'未交卷作答 '+e.draftCount+' 题':'',e.essays?.length?'有写作/翻译草稿':'',e.visited_at?'上次学习 '+new Date(e.visited_at).toLocaleString():''].filter(Boolean).join(' · ');
function resume(e){router.push('/reader/'+e.id);}
async function resumeEssay(e,section){try{const detail=await window.keeper.examDetail(e.id),p=detail?.passages.find(p=>p.section===section);if(!p)throw Error('该草稿对应的篇章已移除');router.push({path:'/reader/'+e.id,query:{passage:String(p.id)}});}catch(cause){error.value=cause.message;}}
function primaryAction(){stats.value.dueNow>0?router.push('/review'):recent.value.length?resume(recent.value[0]):router.push('/library');}
async function load(){const version=++sequence;error.value='';try{const [summary,exams]=await Promise.all([window.keeper.studySummary(),window.keeper.listExams(),learning.refresh()]);if(disposed||version!==sequence)return;recent.value=summary.recent;reviewDue.value=summary.reviewDue;cardDue.value=summary.cardDue||0;recommendations.value=exams.slice(0,4);
 // Older releases kept visit order only in local preferences. Import the last valid visit once.
 if(!recent.value.length){let old;try{old=Number(localStorage.getItem('keeper.lastReading'));}catch{}if(exams.some(e=>e.id===old)){const detail=await window.keeper.examDetail(old);if(disposed||version!==sequence)return;const p=detail?.passages[0];if(p){const r=await window.keeper.studyVisit(old,p.id);if(!r.ok)throw Error(r.error);const migrated=await window.keeper.studySummary();if(!disposed&&version===sequence)recent.value=migrated.recent;}}}
 }catch(cause){if(!disposed&&version===sequence)error.value='学习记录加载失败：'+cause.message;}}
onMounted(load);onBeforeUnmount(()=>{disposed=true;++sequence;});
</script>
<style scoped>.continue-learning{padding:22px;margin:18px 0}.continue-learning h2{font-size:18px;margin:0 0 14px}.continue-learning button{margin:8px 8px 0 0}.study-next{display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:space-between;padding:20px;margin-bottom:22px}.study-next p{margin:6px 0 0}.exam-card{text-align:left;color:var(--text)}</style>

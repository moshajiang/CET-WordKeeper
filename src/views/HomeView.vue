<template>
  <div>
    <h1 class="page-title">今日学习</h1>
    <p class="page-sub">在真题里遇见的词，才记得最牢</p>

    <div class="stat-row">
      <div class="stat-box due"><div class="num">{{ stats.dueNow }}</div><div class="lbl">待复习</div></div>
      <div class="stat-box"><div class="num">{{ stats.learning }}</div><div class="lbl">学习中的生词</div></div>
      <div class="stat-box done"><div class="num">{{ stats.mastered }}</div><div class="lbl">已掌握</div></div>
      <div class="stat-box"><div class="num">{{ stats.reviewedToday }}</div><div class="lbl">今日已复习</div></div>
      <div class="stat-box"><div class="num">{{ stats.exams }}</div><div class="lbl">真题套数</div></div>
    </div>

    <div class="card">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div>
          <div style="font-weight: 700; font-size: 15px;">{{ stats.dueNow > 0 ? '有 ' + stats.dueNow + ' 个生词到了遗忘临界点' : '当前没有到期的复习任务' }}</div>
          <div style="color: var(--muted); font-size: 13px; margin-top: 4px;">
            {{ stats.dueNow > 0 ? '现在复习，记忆效率最高' : '去真题库读一篇新文章，标注几个新词吧' }}
          </div>
        </div>
        <button class="primary" style="font-size: 15px; padding: 10px 28px;" @click="$router.push('/review')">
          开始复习
        </button>
      </div>
    </div>

    <h1 class="page-title" style="font-size: 16px;">最近真题</h1>
    <div class="exam-grid">
      <div v-for="e in recent" :key="e.id" class="exam-card" @click="$router.push('/reader/' + e.id)">
        <span class="lv" :class="e.level === 'CET4' ? 'cet4' : 'cet6'">{{ e.level }}</span>
        <div class="name">{{ e.year }} 年 {{ e.month }} 月 · 第{{ e.set_no }}套</div>
        <div class="meta">{{ e.passage_count }} 个篇章</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const stats = ref({ learning: 0, mastered: 0, dueNow: 0, reviewedToday: 0, exams: 0 });
const recent = ref([]);

onMounted(async () => {
  stats.value = await window.keeper.stats();
  const exams = await window.keeper.listExams();
  recent.value = exams.slice(0, 4);
});
</script>

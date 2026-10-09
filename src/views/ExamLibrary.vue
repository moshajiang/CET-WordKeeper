<template>
  <div>
    <h1 class="page-title">真题库</h1>
    <p class="page-sub">点开真题 → 阅读时点词标注 → 自动进入生词本</p>

    <div class="filter-bar">
      <select v-model="levelFilter">
        <option value="all">全部级别</option>
        <option value="CET4">四级 CET4</option>
        <option value="CET6">六级 CET6</option>
        <option value="imported">我的导入</option>
      </select>
      <span style="color: var(--muted); font-size: 12.5px;">共 {{ filtered.length }} 套</span>
    </div>

    <div class="exam-grid">
      <div v-for="e in filtered" :key="e.id" class="exam-card" @click="$router.push('/reader/' + e.id)">
        <span class="lv" :class="e.imported ? 'import' : e.level === 'CET4' ? 'cet4' : 'cet6'">
          {{ e.imported ? '导入' : e.level }}
        </span>
        <div class="name">{{ e.year }} 年 {{ e.month }} 月 · 第{{ e.set_no }}套</div>
        <div class="meta">{{ e.passage_count }} 个篇章{{ e.imported ? ' · 用户导入' : '' }}</div>
      </div>
    </div>

    <div v-if="!filtered.length" class="card empty-state">
      <div class="big">📭</div>
      暂无真题数据。请先运行数据工程脚本生成 keeper.db，或到
      <a @click="$router.push('/settings')">设置页</a> 导入自定义真题 JSON。
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';

const exams = ref([]);
const levelFilter = ref('all');

const filtered = computed(() => {
  if (levelFilter.value === 'all') return exams.value;
  if (levelFilter.value === 'imported') return exams.value.filter((e) => e.imported);
  return exams.value.filter((e) => e.level === levelFilter.value && !e.imported);
});

onMounted(async () => {
  exams.value = await window.keeper.listExams();
});
</script>

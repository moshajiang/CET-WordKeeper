<template>
  <nav class="sidebar">
    <div class="logo">CET WordKeeper<small>真题驱动 · 语境记词</small></div>
    <div
      v-for="n in navs"
      :key="n.path"
      class="nav-item"
      :class="{ active: $route.path === n.path || (n.path !== '/' && $route.path.startsWith(n.path)) }"
      @click="$router.push(n.path)"
    >
      <span class="ico">{{ n.ico }}</span>
      <span>{{ n.label }}</span>
      <span v-if="n.key === 'review' && dueCount > 0" class="due-badge">{{ dueCount }}</span>
    </div>
    <div class="nav-spacer"></div>
    <div class="nav-item" @click="$router.push('/settings')">
      <span class="ico">⚙</span><span>设置</span>
    </div>
  </nav>
  <router-view class="main" :class="{ narrow: isNarrow }" />
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const dueCount = ref(0);

const navs = [
  { path: '/', label: '今日', ico: '🏠' },
  { path: '/library', label: '真题库', ico: '📚' },
  { path: '/recite', label: '对照背诵', ico: '🗣' },
  { path: '/words', label: '生词本', ico: '📖' },
  { path: '/review', label: '复习', ico: '🔁', key: 'review' },
  { path: '/knowledge', label: '知识库', ico: '🧠' },
];

const isNarrow = computed(() => !route.path.startsWith('/reader'));

onMounted(async () => {
  try {
    const s = await window.keeper.stats();
    dueCount.value = s.dueNow;
  } catch (e) { /* db not ready */ }
});
</script>

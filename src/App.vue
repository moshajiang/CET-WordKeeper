<template>
  <nav class="sidebar">
    <div class="logo">CET WordKeeper<small>真题驱动 · 语境记词</small></div>
    <div
      v-for="n in navs"
      :key="n.path"
      class="nav-item"
      :class="{ active: isNavActive(n) }"
      @click="onNav(n)"
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
import { computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useLearningState } from './composables/useLearningState.js';

const route = useRoute();
const router = useRouter();
const learning = useLearningState();
const dueCount = computed(() => learning.stats.value.dueNow);

const navs = [
  { path: '/', label: '今日', ico: '🏠' },
  { path: '/library', label: '真题库', ico: '📚' },
  { path: '/recite', label: '对照背诵', ico: '🗣' },
  { path: '/words', label: '生词本', ico: '📖' },
  { path: '/review', label: '复习', ico: '🔁', key: 'review' },
  { path: '/knowledge', label: '知识库', ico: '🧠' },
];

const isNarrow = computed(() => !route.path.startsWith('/reader'));

// 夜间模式：localStorage 持久化，启动即应用
function applyTheme() {
  document.documentElement.classList.toggle('dark', localStorage.getItem('keeper.theme') === 'dark');
}

// 真题库把阅读器当作自己的子页面：在读的卷子高亮该栏
function isNavActive(n) {
  if (n.path === '/library') return route.path.startsWith('/library') || route.path.startsWith('/reader');
  return route.path === n.path || (n.path !== '/' && route.path.startsWith(n.path));
}

// 点侧栏「真题库」：刚在读某套卷子 → 回到那套卷子（进度自动恢复）；
// 正在读它 → 进真题库列表换一套；没读过 → 进列表
function onNav(n) {
  if (n.path === '/library') {
    const last = localStorage.getItem('keeper.lastReading');
    const reading = !!last && route.path === '/reader/' + last;
    if (last && !reading) { router.push('/reader/' + last); return; }
    router.push('/library');
    return;
  }
  router.push(n.path);
}

onMounted(() => {
  applyTheme();
  void learning.start();
});
onBeforeUnmount(() => learning.stop());
</script>

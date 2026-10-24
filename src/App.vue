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
  <PageAssistant />
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, watch } from 'vue';
import PageAssistant from './components/PageAssistant.vue';
import { usePageAssistant } from './composables/usePageAssistant.js';
import { useRoute, useRouter } from 'vue-router';
import { useLearningState } from './composables/useLearningState.js';

const route = useRoute();
const router = useRouter();
const assistant = usePageAssistant();
const pagePaths = { home:'/',library:'/library',words:'/words',review:'/review',knowledge:'/knowledge',settings:'/settings',recite:'/recite' };
assistant.setNavigate(async (page,context) => {
  const target=page === 'recite' && context?.examId && context?.passageId ? {path:'/recite/'+context.examId,query:{passage:String(context.passageId)}} : pagePaths[page];
  await router.push(target);
  if(router.currentRoute.value.fullPath !== router.resolve(target).fullPath) throw Error('页面未切换，请先处理当前页面的保存提示。');
});
watch(() => route.name, name => assistant.setPage(({home:'home',library:'library',words:'words',review:'review',knowledge:'knowledge',cards:'knowledge',settings:'settings',recite:'recite',reader:'reader'})[name] || 'home'), {immediate:true});
const learning = useLearningState();
const dueCount = computed(() => learning.stats.value.dueNow);

const navs = [
  { path: '/', label: '今日', ico: '🏠' },
  { path: '/library', label: '真题库', ico: '📚' },
  { path: '/recite', label: '对照背诵', ico: '🗣' },
  { path: '/words', label: '生词本', ico: '📖' },
  { path: '/review', label: '复习', ico: '🔁', key: 'review' },
  { path: '/knowledge', label: '知识库', ico: '🧠' },
  { path: '/cards', label: '练习卡', ico: '🗂' },
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

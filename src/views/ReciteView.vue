<template>
  <div>
    <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap;">
      <div>
        <h1 class="page-title" style="margin-bottom: 2px;">🗣 对照背诵</h1>
        <p class="page-sub" style="margin-bottom: 0;">点「下一句」逐句呈现 · 每句只显示一种语言 · 点句子切换中/英</p>
      </div>
      <div v-if="exam" style="font-size: 13px; color: var(--muted);">
        {{ exam.level }} · {{ exam.year }} 年 {{ exam.month }} 月 · 第{{ exam.set_no }}套
      </div>
    </div>

    <!-- 未指定考次：先选一套 -->
    <div v-if="!examId" class="card">
      <h3 style="font-size: 15px; margin-bottom: 10px;">选择一套真题开始</h3>
      <select :value="''" @change="pick($event.target.value)" style="min-width: 300px;">
        <option value="" disabled>请选择考次…</option>
        <option v-for="e in exams" :key="e.id" :value="e.id">{{ label(e) }}</option>
      </select>
      <div style="font-size: 12.5px; color: var(--muted); margin-top: 10px;">
        也可以直接在「真题库」打开某套试卷，用顶部工具栏的「对照背诵」进入。
      </div>
    </div>

    <template v-else>
      <div v-if="!detail" class="empty-state"><div class="big">⏳</div>加载中…</div>

      <div v-else-if="!items.length" class="card" style="font-size: 13.5px; color: var(--muted);">
        本篇暂无可用于背诵的译文。
      </div>

      <template v-else>
        <div class="recite-bar card">
          <div class="recite-tabs">
            <button
              v-for="(it, i) in items"
              :key="it.pi"
              :class="{ active: i === cur }"
              @click="cur = i; reset()"
            >{{ it.name }}</button>
          </div>
          <div class="recite-actions">
            <span class="recite-progress">{{ revealed }} / {{ total }}</span>
            <button class="primary" @click="next" :disabled="revealed >= total">下一句 ▶</button>
            <button @click="showAll" :disabled="revealed >= total">全文显示</button>
            <button @click="reset" :disabled="revealed === 0">重来</button>
            <span class="recite-first">
              <span class="tb-label">先显示</span>
              <button :class="{ active: first === 'zh' }" @click="setFirst('zh')">中文</button>
              <button :class="{ active: first === 'en' }" @click="setFirst('en')">英文</button>
            </span>
          </div>
        </div>

        <div class="recite-list">
          <div v-for="(s, i) in shown" :key="i" class="recite-line" @click="toggle(i)">
            <span class="recite-no">{{ i + 1 }}</span>
            <span class="recite-txt" :class="shownLang(i)">{{ shownText(s, i) }}</span>
            <span class="recite-swap">点击切换</span>
          </div>
          <div v-if="revealed === 0" class="recite-empty">点「下一句」开始逐句背诵</div>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { alignBilingual } from '../utils/bilingual.js';

const props = defineProps({ examId: String });
const router = useRouter();

const exams = ref([]);
const detail = ref(null);
const cur = ref(0);              // 当前篇章（items 下标）
const revealed = ref(0);         // 已呈现的句子数（初始 0 → 页面空白）
const first = ref('zh');         // 每句率先显示的语言：zh=先中文（回忆英文）/ en=先英文
const langMap = ref({});         // 句子下标 -> 'en' | 'zh'（点击切换后的覆盖值）

const exam = computed(() => (detail.value && detail.value.exam) || null);

// 可背诵的篇章：有译文、且能切出句子
const items = computed(() => {
  const d = detail.value;
  if (!d) return [];
  const out = [];
  d.passages.forEach((p, pi) => {
    if (!p.translation) return;
    const rows = alignBilingual(p.content, p.translation);
    if (!rows.length) return;
    out.push({ pi, name: sectionName(p.section, p.seq), rows });
  });
  return out;
});
const active = computed(() => items.value[cur.value] || null);
const total = computed(() => (active.value ? active.value.rows.length : 0));
const shown = computed(() => (active.value ? active.value.rows.slice(0, revealed.value) : []));

function shownLang(i) { return langMap.value[i] || first.value; }
function shownText(s, i) {
  return shownLang(i) === 'en' ? (s.en || '（本句原文缺失）') : (s.zh || '（本句译文缺失）');
}
function toggle(i) {
  const now = shownLang(i);
  langMap.value = { ...langMap.value, [i]: now === 'en' ? 'zh' : 'en' };
}
function next() {
  if (revealed.value >= total.value) return;
  revealed.value++;
  scrollToLast();
}
function showAll() { revealed.value = total.value; }
function reset() { revealed.value = 0; langMap.value = {}; }
function setFirst(l) { first.value = l; langMap.value = {}; }

function scrollToLast() {
  setTimeout(() => {
    const els = document.querySelectorAll('.recite-line');
    const el = els[els.length - 1];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 60);
}

function label(e) { return `${e.level} · ${e.year}年${e.month}月 · 第${e.set_no}套`; }
function pick(id) { if (id) router.push('/recite/' + id); }
function sectionName(section, seq) {
  const map = { listening: '听力原文', reading: '仔细阅读', cloze: '选词填空', match: '长篇阅读', translation: '翻译', writing: '写作' };
  return (map[section] || section || '篇章') + (seq > 1 ? ' ' + seq : '');
}

async function load() {
  reset();
  cur.value = 0;
  detail.value = null;
  if (!props.examId) return;
  const d = await window.keeper.examDetail(Number(props.examId));
  detail.value = d;
  // 从阅读器跳转过来时带 ?p=<passages 下标>，直接定位到同一篇
  const q = new URLSearchParams(String(location.hash).split('?')[1] || '').get('p');
  const n = Number(q);
  if (Number.isFinite(n)) {
    const idx = items.value.findIndex((it) => it.pi === n);
    if (idx >= 0) cur.value = idx;
  }
}

watch(() => props.examId, load);
onMounted(async () => {
  if (!props.examId) {
    try { exams.value = (await window.keeper.listExams()) || []; } catch (e) { /* 忽略 */ }
  }
  await load();
});
</script>

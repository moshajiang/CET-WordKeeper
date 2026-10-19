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

    <div v-if="errorMsg" class="card" role="alert">{{ errorMsg }} <button @click="load">重试</button> <button v-if="examId" @click="pickOther">选择其他真题</button></div>

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
      <div v-if="!detail && !errorMsg" class="empty-state"><div class="big">⏳</div>加载中…</div>

      <div v-else-if="detail && !items.length" class="card" style="font-size: 13.5px; color: var(--muted);">
        本篇暂无可用于背诵的译文。
      </div>

      <template v-else-if="detail">
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
            <button @click="backToReader" title="回到阅读器做题">⮐ 返回做题</button>
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
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { alignBilingual, blankNumbers, clozeWords, fillClozeText, stripParagraphMarkers } from '../utils/bilingual.js';
import { useAlignmentLex } from '../composables/useAlignmentLex.js';

// 词典评分映射（ECDICT 英→中候选），一次加载全 view 复用
const { lex, ensureLex } = useAlignmentLex();

const props = defineProps({ examId: String });
const router = useRouter();

const exams = ref([]);
const detail = ref(null);
const errorMsg = ref('');
let loadSequence = 0, disposed = false;
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
    const words = clozeWords(p);
    // 先对齐原文，再做展示转换；回退路径也保留段落标记作为对齐证据。
    const sourceRows = Array.isArray(p.rows) && p.rows.length ? p.rows
      : alignBilingual(p.content, p.translation, lex.value, { blankNums: blankNumbers(p) });
    const rows = sourceRows.map((r, i) => {
      let en = String(r.en || '');
      if (p.section === 'cloze') en = fillClozeText(en, words, p.content);
      if (p.section === 'match') en = stripParagraphMarkers(en);
      return { para: r.para ?? 0, i, en, zh: String(r.zh || '') };
    });
    if (!rows.length) return;
    out.push({ pi, id: p.id, name: sectionName(p.section, p.seq), rows });
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
function backToReader() { router.push({path:'/reader/' + Number(props.examId),query:{passage:String(active.value.id),p:String(active.value.pi)}}); }
function setFirst(l) { first.value = l; langMap.value = {}; }

async function scrollToLast() {
  const sequence = loadSequence, passageId = active.value?.id;
  await nextTick();
  if (disposed || sequence !== loadSequence || passageId !== active.value?.id) return;
  const els = document.querySelectorAll('.recite-line');
  els[els.length - 1]?.scrollIntoView?.({block:'center',behavior:'smooth'});
}

function label(e) { return `${e.level} · ${e.year}年${e.month}月 · 第${e.set_no}套`; }
function pick(id) { if (id) router.push('/recite/' + id); }
function sectionName(section, seq) {
  const map = { listening: '听力原文', reading: '仔细阅读', cloze: '选词填空', match: '长篇阅读', translation: '翻译', writing: '写作' };
  return (map[section] || section || '篇章') + (seq > 1 ? ' ' + seq : '');
}

function pickOther() { router.push('/recite'); }
function locateRequestedPassage() {
  const query = router.currentRoute?.value?.query || {};
  let index = -1;
  if (typeof query.passage === 'string' && /^[1-9]\d*$/.test(query.passage)) index = items.value.findIndex(item => String(item.id) === query.passage);
  else if (typeof query.p === 'string' && /^\d+$/.test(query.p)) index = items.value.findIndex(item => item.pi === Number(query.p));
  if (index >= 0 && index !== cur.value) { cur.value = index; reset(); }
}
async function load() {
  const sequence = ++loadSequence, examId = props.examId;
  reset(); cur.value = 0; detail.value = null; errorMsg.value = '';
  ensureLex();
  try {
    if (!examId) {
      const value = await window.keeper.listExams();
      if (!disposed && sequence === loadSequence) exams.value = value || [];
      return;
    }
    const value = await window.keeper.examDetail(Number(examId));
    if (disposed || sequence !== loadSequence || examId !== props.examId) return;
    if (!value) { errorMsg.value = '未找到该套真题，请选择其他真题。'; return; }
    detail.value = value;
    locateRequestedPassage();
  } catch (error) {
    if (!disposed && sequence === loadSequence) errorMsg.value = '背诵材料加载失败：' + error.message;
  }
}

watch(() => props.examId, load);
watch(() => [router.currentRoute?.value?.query?.passage,router.currentRoute?.value?.query?.p], locateRequestedPassage);
// 词典异步就绪时可能重新对齐句子，清理原句下标上的语言覆盖与呈现进度。
watch(() => JSON.stringify(active.value?.rows || []), reset);
onMounted(load);
onBeforeUnmount(() => { disposed = true; ++loadSequence; });

</script>

<template>
  <div v-if="detail" @scroll.passive="saveProgressSoon">
    <div class="reader-topbar">
      <div class="reader-topbar-row">
        <div class="tb-title">
          <a class="back-lib" @click="router.push('/library')">← 返回真题库</a>
          <h1 class="page-title" style="margin-bottom: 2px;">
            {{ detail.exam.level }} · {{ detail.exam.year }} 年 {{ detail.exam.month }} 月 · 第{{ detail.exam.set_no }}套
          </h1>
          <p class="page-sub" style="margin-bottom: 0;">单击查词 · 双击加入生词本 · 划选句子可翻译与语法分析</p>
        </div>
        <div class="tb-actions">
          <label style="font-size: 12.5px; color: var(--muted); display: flex; align-items: center; gap: 5px; cursor: pointer;">
            <input type="checkbox" v-model="scanOn" /> 难词预扫
          </label>
          <button @click="chatOpen = !chatOpen">💬 问 AI</button>
          <button @click="openRecite" :disabled="!hasTranslation" title="打开独立页面，逐句背诵本篇">🗣 对照背诵</button>
          <button class="primary" @click="submit" :disabled="busy || answersLoading || graded">交卷核对</button>
          <button class="reveal-btn" @click="toggleAnalysis" :disabled="busy">
            {{ busy ? '处理中…' : (revealAnalysis && !graded ? '隐藏解析' : '查看解析与翻译') }}
          </button>
          <button v-if="busy" @click="cancelAssessment" :disabled="assessmentCancelling">{{ assessmentCancelling ? '取消中…' : '取消处理' }}</button>
          <button @click="fontSize = Math.max(14, fontSize - 1)">A-</button>
          <button @click="fontSize = Math.min(22, fontSize + 1)">A+</button>
        </div>
      </div>

      <!-- 展示模式：翻译呈现方式 + 题目布局 -->
      <div class="study-modes" aria-label="阅读模式"><button v-for="(label,mode) in {practice:'练题',intensive:'精读',review:'复盘'}" :key="mode" :class="{active:readerMode===mode}" @click="setReaderMode(mode)">{{ label }}</button><span>{{ readerMode==='practice'?'先作答，再核对依据':readerMode==='intensive'?'原文、译文与词句理解':'结合答案整理错因与知识点' }}</span></div>
      <details class="reader-settings"><summary>阅读设置 · 翻译、布局与字号</summary>
      <div class="reader-topbar-row tb-modes">
        <span class="tb-label">翻译</span>
        <button :class="{ active: transMode === 'off' }" @click="setTransMode('off')">关闭</button>
        <button
          :class="{ active: transMode === 'inline' }"
          :disabled="!hasTranslation"
          @click="setTransMode('inline')"
        >逐句对照</button>
        <span class="tb-label" style="margin-left: 10px;">布局</span>
        <button :class="{ active: layout === 'stack' }" @click="layout = 'stack'">上下</button>
        <button :class="{ active: layout === 'split' }" @click="layout = 'split'">左右（题目并排）</button>
      </div>
      </details>
    </div>

    <div v-if="answerDraftStatus && !graded" class="answer-draft-status" role="status" style="font-size: 12.5px; color: var(--muted); margin-bottom: 10px;">{{ answerDraftStatus }}</div>
    <div v-if="result" class="card" style="margin-bottom: 12px; padding: 12px 18px;">
      <div style="display: flex; align-items: center; gap: 14px;">
        <span style="font-size: 15px; font-weight: 500;">
          得分 {{ result.score }} 分 · 客观题 {{ result.correct }} / {{ result.total }} 正确
        </span>
        <button @click="clearAttempt">重做本套</button>
      </div>
    </div>
    <div v-if="notice" class="card" style="margin-bottom: 12px; padding: 10px 16px; font-size: 13px;"
         :style="{ color: noticeOk ? 'var(--ok)' : 'var(--red)' }">{{ notice }}</div>

    <div class="section-tabs">
      <button
        v-for="(p, i) in detail.passages"
        :key="p.id"
        :class="{ active: i === activeIdx }"
        @click="activeIdx = i"
      >
        {{ sectionName(p.section, p.seq) }}
      </button>
    </div>

    <ReaderAssistant ref="readerAssistant" :detail="detail" :passage-id="activePassage?.id" :layout="layout" :translation="transMode" :font-size="fontSize" :result="aiResult" :draft="isEssaySection?essayText:''"
      @passage="selectAssistantPassage" @view="applyAssistantView" @cancel="cancelSelection" @close-result="aiResult = null" />

    <div class="reader-layout" :class="layout === 'split' && hasQuestions ? 'layout-split' : 'layout-stack'">
      <div class="passage-pane">
        <div class="article" :style="{ fontSize: fontSize + 'px' }">
          <template v-if="transMode !== 'inline' || !hasTranslation">
            <div v-for="(para, pi) in activeParas" :key="pi" class="para" data-ai-text>
              <span
                v-for="(tk, ti) in para"
                :key="ti"
                class="w"
                :class="wordClass(tk)"
                @click.stop="onWordClick($event, tk, para, pi)"
                @dblclick.stop="onWordDblClick(tk, para, pi)"
              >{{ tk.text }}</span>
            </div>
          </template>
          <template v-else>
            <!-- 逐句对照：直接替换原文显示，点句子切换中/英 -->
            <div
              v-for="(s, si) in bilingual"
              :key="si"
              class="bi-row"
              :class="{ open: zhOpen(s) }"
              @click="toggleRow(s)"
            >
              <div class="bi-en" data-ai-text :style="{ fontSize: Math.max(13, fontSize - 2) + 'px' }">
                <span
                  v-for="(tk, ti) in rowTokens(s)"
                  :key="ti"
                  class="w"
                  :class="wordClass(tk)"
                  @click.stop="onWordClick($event, tk, rowTokens(s), s.para)"
                  @dblclick.stop="onWordDblClick(tk, rowTokens(s), s.para)"
                >{{ tk.text }}</span>
              </div>
              <div v-show="zhOpen(s)" class="bi-zh">{{ s.zh || '（本句译文缺失）' }}</div>
              <button class="bi-quote" title="把这句原文引用到 AI 问答" @click.stop="quoteToAI(s.en)">❝ 引用</button>
            </div>
            <div v-if="!bilingual.length" class="bi-tip">本篇暂无可用译文。</div>
          </template>
        </div>

        <div v-if="activePassage && isEssaySection" class="card essay-card" style="margin-top: 16px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <h3 style="font-size: 15px; margin: 0;">
              {{ activePassage.section === 'writing' ? '✍️ 在此作答作文' : '🌐 在此作答翻译' }}
              <span style="font-size: 11.5px; color: var(--muted); font-weight: 400;">草稿自动保存{{ essaySavedAt ? ' · ' + essaySavedAt : '' }}</span>
            </h3>
            <span style="font-size: 12.5px; color: var(--muted);">{{ essayWordCount }} 词 · {{ essayText.length }} 字符</span>
          </div>
          <textarea v-model="essayText" class="essay-input" rows="10" :disabled="essayLoading"
            :placeholder="activePassage.section === 'writing' ? '在此写作，草稿会自动保存到本地…' : '在此输入你的英文译文，草稿会自动保存到本地…'"></textarea>
          <div style="margin-top: 10px; display: flex; gap: 10px; align-items: center;">
            <button class="primary" @click="gradeEssay" :disabled="essayBusy">{{ essayBusy ? '批改中…' : 'AI 批改' }}</button>
            <button v-if="essayBusy" @click="cancelGrade">取消批改</button>
            <button v-if="activePassage.reference" @click="showReference = !showReference">
              {{ (showReference ? '隐藏' : '查看') + (activePassage.section === 'writing' ? '范文' : '参考译文') }}
              <span style="font-size: 11px; color: var(--muted);">（预置，离线可看）</span>
            </button>
            <span v-if="essayNotice" style="font-size: 12.5px;" :style="{ color: essayNoticeOk ? 'var(--ok)' : 'var(--red)' }">{{ essayNotice }}</span>
          </div>

          <div v-if="activePassage.reference && showReference" class="er-ref-box">
            <h4 style="font-size: 13.5px; margin: 0 0 6px;">{{ activePassage.section === 'writing' ? '✍️ 考场范文' : '🌐 英文参考译文' }}
              <span style="font-size: 11.5px; color: var(--muted); font-weight: 400;">预置内容，未配置 AI 也能看</span>
            </h4>
            <div class="er-ref-text">{{ activePassage.reference }}</div>
          </div>

          <EssayRevisions :key="props.examId+':'+activePassage.section" :result="essayResult" :text="essayText" :section="activePassage.section" @update="essayText=$event" />
          <div v-if="essayResult" class="essay-result">
            <div class="er-score">
              <span class="er-num">{{ essayResult.score }}</span>
              <span class="er-denom">/ 15</span>
              <span class="er-conv">≈ 折算 {{ (essayResult.score / 15 * 106.5).toFixed(1) }} 分</span>
            </div>
            <div class="er-band">{{ essayResult.band }}</div>
            <div v-if="essayResult.strengths" class="er-strengths">亮点：{{ essayResult.strengths }}</div>
            <div v-if="essayResult.issues && essayResult.issues.length" class="er-issues">
              <div v-for="(it, i) in essayResult.issues" :key="i" class="er-issue">
                <div class="er-quote">“{{ it.quote }}”</div>
                <div>{{ it.problem }}</div>
                <div class="er-fix">→ {{ it.fix }}</div>
              </div>
            </div>
            <div v-if="essayResult.improved" class="er-ref">
              <b>改进版全文</b>
              <div style="white-space: pre-wrap;">{{ essayResult.improved }}</div>
            </div>
            <div v-if="essayResult.reference" class="er-ref">
              <b>参考译文</b>
              <div style="white-space: pre-wrap;">{{ essayResult.reference }}</div>
            </div>
          </div>
        </div>

        <QuestionPanel
          v-if="layout === 'stack' && hasQuestions"
          :passage="activePassage"
          :answers="answers"
          :graded="graded"
          :disabled="busy || answersLoading"
          :reveal="revealAnalysis" :mode="readerMode"
          :letters="matchLetters"
          @pick="setAnswer"
          @quote="quoteToAI"
          style="margin-top: 16px;"
        />
      </div>

      <div v-if="layout === 'split' && hasQuestions" class="question-pane">
        <QuestionPanel
          :passage="activePassage"
          :answers="answers"
          :graded="graded"
          :disabled="busy || answersLoading"
          :reveal="revealAnalysis" :mode="readerMode"
          :letters="matchLetters"
          @pick="setAnswer"
          @quote="quoteToAI"
        />
      </div>

      <div v-if="scanOn" class="side-pane">
        <div class="card">
          <h3 style="font-size: 14px; margin-bottom: 10px;">难词预扫 <span style="font-size: 11.5px; color: var(--muted); font-weight: 400;">本篇超纲/高级词</span></h3>
          <div v-if="hardWords.length" class="hardword-list">
            <div v-for="h in hardWords" :key="h.word" class="hw-item" @click="quickAdd(h.word)">
              <span>{{ h.word }}</span>
              <span style="color: var(--muted); font-size: 11px;">{{ h.label }} · 点击加入</span>
            </div>
          </div>
          <div v-else style="color: var(--muted); font-size: 13px;">本篇没有发现超纲词 👍</div>
        </div>


      </div>
    </div>

    <div v-if="popover.show" class="popover" :style="popoverStyle" @click.stop>
      <template v-if="popover.loading">
        <div class="ai-loading">查询中…</div>
      </template>
      <template v-else-if="popover.data">
        <div>
          <span class="pw">{{ popover.data.word }}</span>
          <span class="speak" style="margin-left: 6px;" @click="speak(popover.data.word)">🔊</span>
          <span v-if="popover.data.entry && popover.data.entry.phonetic" class="ph">/{{ popover.data.entry.phonetic }}/</span>
        </div>
        <div class="tags">
          <span v-for="t in levelTags" :key="t.name" class="tagchip" :class="t.cls">{{ t.name }}</span>
        </div>
        <div class="trans">{{ popover.data.entry ? (popover.data.entry.translation || popover.data.entry.definition || '（词典暂无释义）') : '词典未收录，可手动加入生词本' }}</div>
        <div v-if="popover.data.freq" class="freq">历年真题中出现约 {{ popover.data.freq.total }} 篇 / {{ popover.data.freq.exams }} 套</div>
        <div v-if="popover.data.hits && popover.data.hits.length" class="hits">
          <div class="hits-title">你收藏过它的真题原句</div>
          <div v-for="(h, hi) in popover.data.hits" :key="hi" class="hit">
            <div class="hit-sent">{{ h.sentence }}</div>
            <div v-if="h.label" class="hit-label">— {{ h.label }}</div>
          </div>
        </div>
        <div class="acts">
          <button v-if="!popover.data.inBook" class="primary" :disabled="wordBusy(popover.data.word)" @click="addFromPopover">★ 加入生词本</button>
          <button v-else class="danger" :disabled="wordBusy(popover.data.word)" @click="removeFromPopover">移出生词本</button>
          <button @click="speak(popover.data.word)">🔊 朗读</button>
        </div>
      </template>
      <div v-if="popover.error" role="alert" style="font-size: 12.5px; color: var(--red); margin-top: 8px;">{{ popover.error }} <button @click="retryLookup" :disabled="popover.loading">重新查询</button></div>
    </div>

    <div v-if="selMenu.show" class="selmenu" :style="selMenuStyle" @mousedown.prevent @click.stop>
      <button @click="readerAssistant?.collectPhrase();selMenu.show=false">收藏短语</button>
      <button @click="explainSelection">✦ 就地讲解</button>
      <button @click="doTranslate">🌐 整句翻译</button>
      <button @click="doGrammar">🧩 语法分析</button>
      <button @click="askAboutSel">💬 问 AI</button>
    </div>

    <button v-if="transMode === 'inline' && layout === 'stack' && hasQuestions" class="back-to-q" @click="backToQuestions" title="回到本篇的题目作答区">⮐ 回到做题区</button>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
  <div v-else-if="readerError" class="card" role="alert">{{ readerError }} <button @click="loadAll">重试</button></div>
  <div v-else class="empty-state"><div class="big">⏳</div>加载真题中…</div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { createAiTasks } from '../utils/ai-tasks.js';
import { useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { tokenize, sentenceOf } from '../utils/tokens.js';
import { useWordLemmas } from '../composables/useWordLemmas.js';
import { alignBilingual, paragraphLetters, blankNumbers } from '../utils/bilingual.js';
import { useAlignmentLex } from '../composables/useAlignmentLex.js';
import QuestionPanel from '../components/QuestionPanel.vue';
import ReaderAssistant from '../components/ReaderAssistant.vue';
import EssayRevisions from '../components/EssayRevisions.vue';
import { usePageAssistant } from '../composables/usePageAssistant.js';
import { createEssayDrafts } from '../utils/essay-drafts.js';
import { createAnswerDrafts } from '../utils/answer-drafts.js';

const props = defineProps({ examId: String });
const router = useRouter();
const pageAssistant = usePageAssistant();
const readerAssistant = ref(null);
function selectAssistantPassage(id) { const index = detail.value?.passages.findIndex(p => p.id === id); if (index >= 0) activeIdx.value = index; }
function applyAssistantView(view) { if (view.layout) layout.value = view.layout; if (view.translation) setTransMode(view.translation); if (view.fontSize) fontSize.value = view.fontSize; }
function explainSelection() { selMenu.value.show = false; readerAssistant.value?.explainSelection(); }

const detail = ref(null);
const readerError = ref('');
let progressExamId = null, progressReady = false;
const activeIdx = ref(0);
const userWords = ref({});
const { lemmaOf,ensureWords } = useWordLemmas();
let wordsSequence = 0, wordSnapshotVersion = 0, offLearning = null;
async function refreshUserWords() {
  const sequence = ++wordsSequence;
  const words = await window.keeper.allWords();
  if (!readerDisposed && sequence === wordsSequence) {
    userWords.value = words; ++wordSnapshotVersion;
    if (popover.value.show && popover.value.data) popover.value.data.inBook = Object.hasOwn(words,popover.value.data.word);
  }
}
const fontSize = ref(16.5);
const scanOn = ref(false);
const hardWords = ref([]);
const toast = ref('');
const aiResult = ref(null);
const aiTasks = createAiTasks(id => window.keeper.cancelAi?.(id));
const assessmentCancelling = ref(false);

// ---- 做题 / 交卷 / 解析与翻译 ----
const answers = ref({});        // questionId -> 所选字母
const graded = ref(false);      // 是否已交卷
const result = ref(null);       // { total, correct, score }
const notice = ref('');
const noticeOk = ref(false);
const busy = ref(false);
const revealAnalysis = ref(false);   // 「查看解析与翻译」直接揭示答案与解析（不必先交卷）
const answersLoading = ref(true);
const answerDraftStatus = ref('');
let loadedAnswer = null;
let readerLoadSequence = 0;
let answerLoadSequence = 0;
let readerDisposed = false;
const answerIsCurrent = target => !readerDisposed && target?.examId === Number(props.examId) && loadedAnswer?.examId === target.examId && loadedAnswer?.revision === target.revision && loadedAnswer?.generation === target.generation;
const answerDrafts = createAnswerDrafts({
  storage: localStorage,
  save: (examId, draft) => window.keeper.attemptSaveDraft(examId,draft),
  onState(state,target,error) {
    if (!answerIsCurrent(target)) return;
    answerDraftStatus.value = state === 'saved' ? '作答草稿已保存' : state === 'saving' ? '正在保存作答…'
      : '作答保存未完成，请重试或稍后返回：' + error.message;
  },
});

// 展示模式：翻译呈现方式（closing / 逐句对照）与布局（上下 / 左右）
// 「对照背诵」已独立成页（见 ReciteView），此处只保留入口按钮
const transMode = ref('off');
const layout = ref('stack');
const readerMode=ref('practice');
function setReaderMode(mode){readerMode.value=mode;setTransMode(mode==='practice'?'off':hasTranslation.value?'inline':'off');layout.value=mode==='intensive'?'stack':'split';revealAnalysis.value=mode==='review';saveProgress();}
function recordVisit(){if(!progressReady||!activePassage.value)return;window.keeper.studyVisit(Number(props.examId),activePassage.value.id).then(r=>{if(!r.ok)throw Error(r.error);}).catch(error=>{readerError.value='学习位置未能保存：'+error.message;});}
const rowToggle = ref({});           // 句子下标 -> 是否显示译文（点击句子切换）

const hasTranslation = computed(() => !!(activePassage.value && activePassage.value.translation));
// 词典评分映射（ECDICT 英→中候选），一次加载全 view 复用
const { lex, ensureLex } = useAlignmentLex();
const hasQuestions = computed(() => !!(activePassage.value && activePassage.value.questions && activePassage.value.questions.length));
const bilingual = computed(() => {
  const p = activePassage.value;
  if (!p) return [];
  // 写死绑定优先：构建期预置的对齐结果直接渲染，零运行时计算
  if (Array.isArray(p.rows) && p.rows.length) {
    return p.rows.map((r, i) => ({ para: r.para ?? 0, i, en: String(r.en || ''), zh: String(r.zh || '') }));
  }
  return alignBilingual(p.content, p.translation || '', lex.value, { blankNums: blankNumbers(p) });
});
const rowTokenCache = computed(() => new Map(bilingual.value.map(row => [row, tokenize(row.en)])));
// 匹配题可用的段落字母：从正文段落标记提取；提取不到时回退 A-O，保证永远可作答
const matchLetters = computed(() => {
  const p = activePassage.value;
  if (!p || p.section !== 'match') return [];
  const found = paragraphLetters(p.content);
  if (found.length >= 4) return found;
  return 'ABCDEFGHIJKLMNO'.split('');
});

function rowTokens(s) {
  return rowTokenCache.value.get(s) || tokenize(s.en);
}
function zhOpen(s) {
  const key = s.para + '|' + s.i;
  if (key in rowToggle.value) return !!rowToggle.value[key];
  return true;                                        // 逐句对照：默认显示译文
}
function toggleRow(s) {
  const key = s.para + '|' + s.i;
  rowToggle.value = { ...rowToggle.value, [key]: !zhOpen(s) };
}
const PROGRESS_KEY = 'keeper.reader.progress';

function saveProgress() {
  try {
    if (!progressReady || progressExamId !== Number(props.examId) || detail.value?.exam?.id !== progressExamId) return;
    let parsed;
    try { parsed = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); } catch { parsed = {}; }
    const all = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    const m = document.querySelector('.main');
    all[String(progressExamId)] = {
      idx: activeIdx.value,
      passageId: activePassage.value?.id,
      scroll: m ? m.scrollTop : 0,
      trans: transMode.value,
      layout: layout.value,
      fontSize: fontSize.value,
      mode: readerMode.value,
      updatedAt: Date.now(),
    };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch (e) { /* 忽略 */ }
}

function loadProgress() {
  try {
    const value = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}')?.[String(props.examId)];
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (e) { return null; }
}

// 新链接按稳定篇章 ID 定位；保留旧 ?p=<下标> 链接兼容。
function requestedPassageIndex() {
  const query = router.currentRoute?.value?.query || {};
  const passages = detail.value?.passages || [];
  if (typeof query.passage === 'string' && /^[1-9]\d*$/.test(query.passage)) return passages.findIndex(p => String(p.id) === query.passage);
  if (typeof query.p === 'string' && /^\d+$/.test(query.p)) {
    const index = Number(query.p); if (Number.isSafeInteger(index) && passages[index]) return index;
  }
  return -1;
}
async function focusRequestedQuestion(){await nextTick();const id=Number(router.currentRoute.value.query.question);if(!activePassage.value?.questions.some(q=>q.id===id))return;const block=document.querySelector('[data-question-id="'+id+'"]');block?.scrollIntoView({block:'center'});block?.focus({preventScroll:true});}
function applyRequestedPassage() {
  if (!progressReady || progressExamId !== Number(props.examId)) return;
  const index = requestedPassageIndex();
  if (index >= 0 && index !== activeIdx.value) { activeIdx.value = index; const main = document.querySelector('.main'); if (main) main.scrollTop = 0; }
  focusRequestedQuestion();
}

let saveTimer = null;
function saveProgressSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveProgress, 400); }

function setTransMode(m) {
  transMode.value = m;
  rowToggle.value = {};
  saveProgress();
}
// 打开独立的「对照背诵」页面，并带上当前篇章下标，进去就停在同篇
// 把原文句子 / 题干选项引用到 AI 问答（自动打开聊天并带入输入框）
function quoteToAI(text) {
  if (!text || !String(text).trim()) return;
  if (readerAssistant.value) readerAssistant.value.quote(String(text).trim());
  else pageAssistant.compose(String(text).trim());
}

// 从逐句对照快速回到本篇的题目作答区（上下布局滚下去很远，一键直达）
function backToQuestions() {
  const el = document.querySelector('.question-pane .qpanel') || document.querySelector('.passage-pane .qpanel');
  if (el) el.scrollIntoView({ block: 'start' });   // 瞬时定位：平滑滚动长距离时反而显得慢
}

function openRecite() {
  router.push({ path: '/recite/' + Number(props.examId), query: { p: String(activeIdx.value), passage: String(activePassage.value.id) } });
}
function setAnswer(qid, letter) {
  if (graded.value || busy.value || answersLoading.value || !answerIsCurrent(loadedAnswer)) return;
  answers.value = { ...answers.value, [qid]: letter };
  answerDrafts.schedule({ ...loadedAnswer, answers: answers.value });
}

async function reloadDetail() {
  const examId = Number(props.examId), sequence = readerLoadSequence;
  const value = await window.keeper.examDetail(examId);
  if (!readerDisposed && sequence === readerLoadSequence && examId === Number(props.examId)) detail.value = value;
}

async function restoreAttempt() {
  const examId = Number(props.examId), sequence = ++answerLoadSequence;
  loadedAnswer = null; answersLoading.value = true;
  const r = await window.keeper.attemptGet(examId);
  if (readerDisposed || sequence !== answerLoadSequence || examId !== Number(props.examId)) return;
  loadedAnswer = typeof r.revision === 'string' ? { examId,revision:r.revision,generation:r.generation } : null;
  answersLoading.value = false;
  answerDraftStatus.value = '';
  graded.value = false; result.value = null;
  if (r.attempt?.total && !r.contentChanged) {
    const map = {};
    for (const a of r.answers || []) map[a.question_id] = a.choice;
    answers.value = map;
    result.value = { total:r.attempt.total,correct:r.attempt.correct,score:r.attempt.score };
    graded.value = true;
    return;
  }
  const recovery = loadedAnswer && answerDrafts.recover(loadedAnswer);
  answers.value = { ...(recovery?.answers || r.draft?.answers || {}) };
  if (r.contentChanged) {
    noticeOk.value = true;
    notice.value = '本套题目或答案已更新，历史交卷和作答已保留，请重新核对并交卷。';
  }
  if (recovery) {
    answerDrafts.schedule(recovery);
  } else if (r.draft) {
    answerDraftStatus.value = '已恢复未交卷作答，可继续答题';
  } else if (r.draftStale || loadedAnswer && answerDrafts.peek(loadedAnswer)) {
    answerDraftStatus.value = '试题或作答状态已更新，旧草稿未套用，请重新作答';
  }
}

async function loadAnalysis() {
  if (busy.value || answersLoading.value) return;
  const target = loadedAnswer, sequence = readerLoadSequence;
  const task = aiTasks.start('assessment');
  assessmentCancelling.value = false;
  busy.value = true;
  notice.value = '';
  let r;
  try {
    if (!(await answerDrafts.flush())) throw new Error('作答草稿尚未保存');
    if (!task.isCurrent()) return;
    r = await window.keeper.examAnalysis(target.examId,task.id);
    if (!task.isCurrent()) return;
    if (!answerIsCurrent(target) || sequence !== readerLoadSequence) return;
    // AI 补全答案会改变内容版本，原选项身份不变，继续保存当前作答。
    const state = await window.keeper.attemptGet(target.examId);
    if (!answerIsCurrent(target) || sequence !== readerLoadSequence) return;
    if (!graded.value && state.generation === target.generation && state.revision !== target.revision) {
      answerDrafts.discard(target);
      loadedAnswer = { ...target,revision:state.revision };
      answerDrafts.schedule({ ...loadedAnswer,answers:answers.value });
    }
  } catch (error) { r = { ok:false,error:error.message }; }
  finally { if (task.isCurrent() && sequence === readerLoadSequence) { busy.value = false; assessmentCancelling.value = false; } }
  if (!task.isCurrent()) return;
  if (readerDisposed || sequence !== readerLoadSequence) return;
  if (!r.ok) {
    task.finish();
    noticeOk.value = false;
    notice.value = badAiResult(r) ? 'AI 返回数据格式异常，未保存当前篇章，请重试；此前已完成的篇章仍保留。' : r.error === 'cancelled' ? '已取消，已保存的篇章结果仍保留。' : r.error === 'no_key'
      ? '中文解析与全文翻译由 AI 按需生成（首次），请先在「设置」里填写 API 地址与 Key；生成后会保存到本地，之后永久离线可看。'
      : '生成失败：' + r.error;
    return;
  }
  await reloadDetail();
  if (!task.isCurrent() || readerDisposed || sequence !== readerLoadSequence) return;
  task.finish();
  readerMode.value='review';
  revealAnalysis.value = true;   // 关键：点了就直接展示答案与解析（此前只加载不改状态，点了没反应）
  noticeOk.value = true;
  notice.value = r.cached ? '已显示本地缓存的解析与全文翻译（点「逐句对照」可左右/上下对照阅读）。' : `已生成 ${r.generated} 个篇章的解析与翻译，并已保存到本地。`;
}

function cancelAssessment() { assessmentCancelling.value = true; aiTasks.requestCancel('assessment'); }

// 「查看解析与翻译」按钮做成开关：揭示后可再点一次收起，回到纯作答态
async function toggleAnalysis() {
  if (revealAnalysis.value) {
    if (graded.value) return;          // 已交卷时答案常显，没有隐藏的必要
    revealAnalysis.value = false;
    notice.value = '';
    return;
  }
  await loadAnalysis();
}

async function submit() {
  if (busy.value || answersLoading.value || graded.value || !answerIsCurrent(loadedAnswer)) return;
  const target = { ...loadedAnswer }, sequence = readerLoadSequence, choices = { ...answers.value };
  const task = aiTasks.start('assessment');
  assessmentCancelling.value = false;
  busy.value = true;
  notice.value = '';
  let r;
  try {
    if (!(await answerDrafts.flush())) throw new Error('作答草稿尚未保存，请稍后重试');
    if (!task.isCurrent()) return;
    r = await window.keeper.attemptSubmit(target.examId,choices,target,task.id);
    if (!task.isCurrent()) return;
    if (r.ok) answerDrafts.discard(target);
  } catch (error) { r = { ok:false,error:error.message }; }
  finally { if (task.isCurrent() && sequence === readerLoadSequence) { busy.value = false; assessmentCancelling.value = false; } }
  if (!task.isCurrent()) return;
  task.finish();
  if (!answerIsCurrent(target) || sequence !== readerLoadSequence) return;
  if (!r.ok) {
    if (r.revision && r.revision !== target.revision && r.generation === target.generation) {
      // AI 已保存部分答案后失败，当前选项仍有效，换新版本继续保存。
      answerDrafts.discard(target);
      loadedAnswer = { ...target,revision:r.revision };
      answerDrafts.schedule({ ...loadedAnswer,answers:choices });
    }
    noticeOk.value = false;
    notice.value = badAiResult(r) ? 'AI 返回数据格式异常，未交卷作答已保留，请重试。' : r.error === 'cancelled' ? '已取消交卷，未交卷作答已保留。' : r.error === 'no_key'
      ? '自动核对需要正确答案：首次由 AI 生成（请在「设置」里配置 Key），生成后永久离线可用。'
      : '交卷失败：' + r.error;
    return;
  }
  graded.value = true;
  await reloadDetail();
  if (!answerIsCurrent(target) || sequence !== readerLoadSequence) return;
  loadedAnswer = { examId:target.examId,revision:r.revision,generation:r.generation };
  readerMode.value='review';
  result.value = r;
  noticeOk.value = true;
  notice.value = `已交卷：客观题 ${r.correct} / ${r.total} 正确，得分 ${r.score} 分。`;
}

async function clearAttempt() {
  if (busy.value || answersLoading.value || !answerIsCurrent(loadedAnswer)) return;
  const target = { ...loadedAnswer }, sequence = readerLoadSequence;
  busy.value = true;
  try {
    if (!(await answerDrafts.flush())) throw new Error('作答草稿尚未保存');
    const r = await window.keeper.attemptClear(target.examId,target);
    if (!r.ok) throw new Error(r.error);
    answerDrafts.discard(target);
    if (!answerIsCurrent(target) || sequence !== readerLoadSequence) return;
    loadedAnswer = { examId:target.examId,revision:r.revision,generation:r.generation };
  } catch (error) {
    if (answerIsCurrent(target)) { noticeOk.value = false; notice.value = '重做失败：' + error.message; }
    return;
  } finally { if (sequence === readerLoadSequence) busy.value = false; }
  graded.value = false;
  result.value = null;
  notice.value = '';
  answers.value = {};
  answerDraftStatus.value = '';
  revealAnalysis.value = false;   // 重做时收起答案解析，重新进入作答状态
  await reloadDetail();
}

// Shared conversation follows the user across pages; effects are owned by ReaderAssistant.
const {open:chatOpen,messages:chatMsgs,input:chatInput,busy:chatBusy,notice:chatNotice,clearing:chatClearing}=pageAssistant;
const loadChat=pageAssistant.loadHistory,clearChat=pageAssistant.clear,stopChat=pageAssistant.stop;
const sendChat=()=>pageAssistant.send();
function askAboutSel() { const text=selMenu.value.text; selMenu.value.show=false; quoteToAI(text); }

// ---- 作文 / 翻译：作答草稿自动保存 + AI 批改 ----
const isEssaySection = computed(() => {
  const s = activePassage.value && activePassage.value.section;
  return s === 'writing' || s === 'translation';
});
const essayText = ref('');
const essayWordCount=computed(()=>(essayText.value.match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g)||[]).length);
const essayResult = ref(null);
const essayBusy = ref(false);
const essayNotice = ref('');
const essayNoticeOk = ref(false);
const essaySavedAt = ref('');
const showReference = ref(false);   // 是否展开预置范文 / 参考译文（离线可看）
const essayLoading = ref(false);
let loadedEssay = null;
let essayLoadSequence = 0;
const essayKey = () => isEssaySection.value && activePassage.value ? `${props.examId}:${activePassage.value.section}` : '';
const essayDrafts = createEssayDrafts({
  save: (...args) => window.keeper.essaySave(...args), storage: localStorage,
  onSaved(draft) {
    if (essayKey() !== `${draft.examId}:${draft.section}` || essayText.value !== draft.content) return;
    const d = new Date();
    essaySavedAt.value = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  },
  onError(error) {
    essayNoticeOk.value = false;
    essayNotice.value = '草稿保存失败，请重试：' + error.message;
  },
});

async function loadEssay() {
  const sequence = ++essayLoadSequence;
  const key = essayKey();
  if (loadedEssay && key === `${loadedEssay.examId}:${loadedEssay.section}`) return;
  const target = key ? { examId: Number(props.examId), section: activePassage.value.section } : null;
  loadedEssay = null;
  essayLoading.value = !!target;
  await essayDrafts.flush();
  if (!target || sequence !== essayLoadSequence || key !== essayKey()) return;
  try {
    const r = await window.keeper.essayGet(target.examId, target.section);
    if (sequence !== essayLoadSequence || key !== essayKey()) return;
    const recovery = essayDrafts.recover(target);
    essayText.value = recovery ? recovery.content : r.content || '';
    essayNotice.value = r.resultInvalid ? '历史批改结果格式异常，已保留草稿，请重新批改。' : '';
    essayNoticeOk.value = false;
    try { essayResult.value = r.result && (!recovery || recovery.content === r.content) ? JSON.parse(r.result) : null; } catch { essayResult.value = null; }
    essaySavedAt.value = '';
    showReference.value = false;
    loadedEssay = target;
    if (recovery && recovery.content !== r.content) essayDrafts.schedule(recovery);
  } catch (error) {
    if (sequence === essayLoadSequence && key === essayKey()) {
      essayNotice.value = '草稿加载失败：' + error.message;
      essayNoticeOk.value = false;
    }
  } finally {
    if (sequence === essayLoadSequence) essayLoading.value = false;
  }
}

function scheduleSave() {
  if (!loadedEssay || essayLoading.value) return;
  if (essayBusy.value) cancelGrade();
  essaySavedAt.value = '';
  essayResult.value = null;
  essayDrafts.schedule({ ...loadedEssay, content: essayText.value });
}

watch(essayText, scheduleSave, { flush: 'sync' });
async function flushReaderDrafts() { return (await Promise.all([essayDrafts.flush(),answerDrafts.flush()])).every(Boolean); }
async function leaveReader() { saveProgress(); const saved = await flushReaderDrafts(); if (saved) { cancelReaderAi(); invalidateWordContext(); } return saved; }
onBeforeRouteLeave(leaveReader);
onBeforeRouteUpdate(leaveReader);
function flushEssayOnClose() { saveProgress(); void flushReaderDrafts(); }

async function gradeEssay() {
  if (!loadedEssay || essayLoading.value || essayBusy.value) return;
  const target = { ...loadedEssay, content: essayText.value };
  const task = aiTasks.start('essay');
  essayBusy.value = true;
  essayNotice.value = '';
  let r;
  try {
    if (!(await essayDrafts.flush())) { r = {ok:false,error:'草稿尚未保存'}; }
    else if (task.isCurrent()) r = await window.keeper.essayGrade(target.examId,target.section,task.id);
  } catch (error) {
    r = { ok: false, error: error.message };
  } finally { if (task.isCurrent()) essayBusy.value = false; }
  if (!task.isCurrent() || readerDisposed) return;
  task.finish();
  if (essayKey() !== `${target.examId}:${target.section}` || essayText.value !== target.content) return;
  if (r.ok) {
    essayResult.value = r.result;
    essayNoticeOk.value = true;
    essayNotice.value = r.cached ? '已显示缓存的批改结果（修改后再批改会重新请求）。' : '批改完成，结果已保存到本地。';
  } else if (r.error === 'no_key') {
    essayNoticeOk.value = false;
    essayNotice.value = 'AI 批改需要在「设置」页填写 API 地址与 Key。';
  } else if (r.error === 'too_short') {
    essayNoticeOk.value = false;
    essayNotice.value = '内容太短，先写一点再来批改吧。';
  } else if (r.error === 'stale_draft') {
    essayNoticeOk.value = false;
    essayNotice.value = '草稿已修改，请重新批改。';
  } else {
    essayNoticeOk.value = false;
    essayNotice.value = badAiResult(r) ? 'AI 返回批改格式异常，未保存评分，请重试。' : r.error === 'cancelled' ? '已取消批改。' : '批改失败：' + r.error;
  }
}

function badAiResult(result) { return ['bad_json','bad_ai_result','bad_response'].includes(result.error); }

function cancelGrade() { aiTasks.cancel('essay'); essayBusy.value = false; essayNoticeOk.value = true; essayNotice.value = '已取消批改。'; }

const popover = ref({ show:false,loading:false,data:null,error:'',x:0,y:0,ctx:'' });
const wordOperations = ref(new Set());
let lookupSequence = 0, selectionSequence = 0;
const selMenu = ref({ show: false, x: 0, y: 0, text: '' });

const activePassage = computed(() => (detail.value && detail.value.passages[activeIdx.value]) || null);

const activeParas = computed(() => {
  if (!activePassage.value) return [];
  return String(activePassage.value.content)
    .split(/\n+/)
    .filter((p) => p.trim())
    .map((p) => tokenize(p));
});

const popoverStyle = computed(() => {
  const p = popover.value;
  const x = Math.min(p.x, window.innerWidth - 370);
  const y = p.y + 300 > window.innerHeight ? Math.max(10, p.y - 290) : p.y + 14;
  return { left: x + 'px', top: y + 'px' };
});

const selMenuStyle = computed(() => {
  const m = selMenu.value;
  return { left: Math.max(8, Math.min(m.x, window.innerWidth - 390)) + 'px', top: Math.max(8, m.y - 44) + 'px' };
});

const levelTags = computed(() => {
  const tags = (popover.value.data && popover.value.data.tags) || [];
  const out = [];
  const has = (k) => tags.includes(k);
  if (has('cet4')) out.push({ name: '四级考纲', cls: 'lvl4' });
  if (has('cet6')) out.push({ name: '六级考纲', cls: 'lvl6' });
  if (has('zk') || has('gk')) out.push({ name: '高中考纲', cls: 'lvl4' });
  if (has('ky')) out.push({ name: '考研', cls: '' });
  if (has('toefl') || has('ielts')) out.push({ name: '托福/雅思', cls: 'beyond' });
  if (has('gre')) out.push({ name: 'GRE', cls: 'beyond' });
  if (!out.length && (popover.value.data || {}).found) out.push({ name: '超纲词', cls: 'beyond' });
  return out;
});

function sectionName(section, seq) {
  const map = { listening: '听力原文', reading: '仔细阅读', cloze: '选词填空', match: '长篇阅读', translation: '翻译', writing: '写作' };
  return (map[section] || section || '篇章') + (seq > 1 ? ' ' + seq : '');
}

function wordClass(tk) {
  let cls = '';
  if (tk.t !== 'w') return cls;
  const n = lemmaOf(tk.text);
  const st = userWords.value[n];
  if (st === 'learning') cls = 'marked';
  if (st === 'mastered') cls = 'marked mastered';
  if (scanOn.value && hardSet.value.has(n)) cls += ' hard';
  // 选词填空的空位编号（26–35）：渲染为高亮下划线空位，而非普通数字
  if (activePassage.value && activePassage.value.section === 'cloze' && /^(2[6-9]|3[0-5])$/.test(tk.text)) cls += ' blank-num';
  return cls.trim();
}

const hardSet = computed(() => new Set(hardWords.value.map((h) => h.word)));

let toastTimer = null;
function showToast(msg) {
  clearTimeout(toastTimer); toast.value = msg;
  toastTimer = setTimeout(() => (toast.value = ''), 1800);
}

async function loadAll() {
  const examId = Number(props.examId), sequence = ++readerLoadSequence;
  progressReady = false; progressExamId = null; clearTimeout(saveTimer);
  readerError.value = ''; cancelReaderAi();
  ++answerLoadSequence; loadedAnswer = null; answersLoading.value = true; busy.value = false;
  answers.value = {}; graded.value = false; result.value = null; notice.value = ''; answerDraftStatus.value = '';
  detail.value = null; activeIdx.value = 0;
  transMode.value = 'off'; layout.value = 'stack'; fontSize.value = 16.5; readerMode.value='practice';
  revealAnalysis.value = false; rowToggle.value = {};
  ensureLex();
  invalidateWordContext();
  let loadedDetail;
  try { loadedDetail = await window.keeper.examDetail(examId); }
  catch (error) {
    if (!readerDisposed && sequence === readerLoadSequence) readerError.value = '真题加载失败：' + error.message;
    return;
  }
  if (readerDisposed || sequence !== readerLoadSequence || examId !== Number(props.examId)) return;
  if (!loadedDetail) {
    try { if (localStorage.getItem('keeper.lastReading') === String(examId)) localStorage.removeItem('keeper.lastReading'); } catch { /* 阅读偏好不是作答 */ }
    router.push('/library'); return;
  }
  const saved = loadProgress(); // 在任何展示 watcher 保存前读取原快照。
  detail.value = loadedDetail; progressExamId = examId;
  try { localStorage.setItem('keeper.lastReading',String(examId)); } catch { /* 不阻止离线阅读 */ }
  let savedIndex = -1;
  if (saved) {
    if (Number.isSafeInteger(saved.passageId) && saved.passageId > 0) savedIndex = detail.value.passages.findIndex(p => p.id === saved.passageId);
    else if (Number.isSafeInteger(saved.idx) && saved.idx >= 0 && detail.value.passages[saved.idx]) savedIndex = saved.idx;
    if (['inline','off'].includes(saved.trans)) transMode.value = saved.trans;
    if (['split','stack'].includes(saved.layout)) layout.value = saved.layout;
    if (['practice','intensive','review'].includes(saved.mode)) {readerMode.value=saved.mode;revealAnalysis.value=saved.mode==='review';}
    if (Number.isFinite(saved.fontSize)) fontSize.value = Math.max(14,Math.min(22,saved.fontSize));
  }
  const requested = requestedPassageIndex();
  activeIdx.value = requested >= 0 ? requested : savedIndex >= 0 ? savedIndex : 0;
  const initialIndex = activeIdx.value;
  // 渲染完成即恢复，替换会覆盖用户操作的固定 500ms 延迟。
  await nextTick();
  if (readerDisposed || sequence !== readerLoadSequence || examId !== Number(props.examId)) return;
  const main = document.querySelector('.main');
  if (main && activeIdx.value === initialIndex) main.scrollTop = requested < 0 && savedIndex >= 0 && Number.isFinite(saved?.scroll) ? Math.max(0,Math.min(10000000,saved.scroll)) : 0;
  progressReady = true;
  saveProgress();recordVisit();
  if (!detail.value.passages.length) showToast('该套真题没有结构化篇章数据');
  try { await refreshUserWords(); } catch { /* 收藏高亮读取失败不阻止正文与作答恢复 */ }
  if (readerDisposed || sequence !== readerLoadSequence) return;
  try { await restoreAttempt(); } catch (error) {
    if (sequence === readerLoadSequence) answerDraftStatus.value = '作答加载失败，请重新打开试卷：' + error.message;
  }
  if (readerDisposed || sequence !== readerLoadSequence) return;
  await loadEssay();
  if(graded.value&&readerMode.value==='practice')readerMode.value='review';
  focusRequestedQuestion();
}

function wordContext() {
  return {examId:Number(props.examId),passageId:activePassage.value?.id ?? null,loadSequence:readerLoadSequence};
}
function wordContextCurrent(target) {
  return !readerDisposed && target.examId === Number(props.examId) && target.passageId === (activePassage.value?.id ?? null) && target.loadSequence === readerLoadSequence;
}
function closePopover() { ++lookupSequence; popover.value.show = false; }
function invalidateWordContext() {
  closePopover(); ++selectionSequence; selMenu.value.show = false;
  clearTimeout(toastTimer); toast.value = '';
}
function lookupCurrent(target) { return wordContextCurrent(target) && target.sequence === lookupSequence && popover.value.show; }
async function lookupWord(raw,sentence,x,y) {
  const target = {...wordContext(),sequence:++lookupSequence}, snapshotVersion = wordSnapshotVersion;
  popover.value = {show:true,loading:true,data:null,error:'',raw,ctx:sentence,x,y,target};
  try {
    const data = await window.keeper.lookup(raw);
    if (!lookupCurrent(target)) return;
    if (!data || typeof data.word !== 'string') throw new Error('无效查词结果');
    if (snapshotVersion !== wordSnapshotVersion) data.inBook = Object.hasOwn(userWords.value,data.word);
    popover.value.data = data;
  } catch (error) {
    if (lookupCurrent(target)) popover.value.error = '查词失败：' + error.message;
  } finally { if (lookupCurrent(target)) popover.value.loading = false; }
}
function retryLookup() {
  const view = popover.value;
  if (view.loading || !view.target || !lookupCurrent(view.target)) return;
  return lookupWord(view.raw,view.ctx,view.x,view.y);
}
async function onWordClick(ev,tk,para) {
  if (tk.t !== 'w') { closePopover(); return; }
  const selection = window.getSelection();
  if (selection && String(selection).trim()) { closePopover(); return; }
  return lookupWord(tk.text,sentenceOf(para,para.indexOf(tk)),ev.clientX,ev.clientY);
}
const wordOperationKey = word => lemmaOf(word);
function wordBusy(word) { const key = wordOperationKey(word); return [...wordOperations.value].some(pending => wordOperationKey(pending) === key); }
async function changeWord(action,word,sentence,target,popupSequence = lookupSequence) {
  if (!wordContextCurrent(target)) return;
  const key = wordOperationKey(word);
  if (wordBusy(word)) return;
  wordOperations.value = new Set([...wordOperations.value,key]);
  ++wordsSequence; // 使修改前正在读取的收藏快照失效。
  const feedbackCurrent = () => wordContextCurrent(target) && popupSequence === lookupSequence;
  if (feedbackCurrent()) popover.value.error = '';
  try {
    const result = action === 'add' ? await window.keeper.addWord(word,sentence,sentence ? target.passageId : null) : await window.keeper.removeWord(word);
    if (!result?.ok) throw new Error(result?.error === 'invalid_passage' ? '原句所属篇章已失效，请重新打开后收藏' : result?.error || '保存失败');
    if (readerDisposed) return;
    let refreshed = true;
    try { await refreshUserWords(); } catch { refreshed = false; }
    const view = popover.value;
    if (feedbackCurrent() && view.show && view.data && wordOperationKey(view.data.word) === wordOperationKey(word)) {
      try {
        const data = await window.keeper.lookup(view.raw);
        if (!data || typeof data.word !== 'string') throw new Error('无效查词结果');
        if (feedbackCurrent()) {
          if (refreshed) data.inBook = Object.hasOwn(userWords.value,data.word);
          popover.value.data = data; // 同步最新出处与收藏状态，不改变当前原句身份。
        }
      } catch { refreshed = false; }
    }
    if (feedbackCurrent()) {
      if (!refreshed) {
        popover.value.error = '保存已完成，状态刷新失败，请重新查询。';
        showToast('保存已完成，请重新查询收藏状态');
      } else showToast(action === 'remove' ? `「${word}」已移出` : result.added ? `「${result.word}」已加入生词本` : `「${result.word}」已在生词本中`);
    }
  } catch (error) {
    if (feedbackCurrent()) {
      const message = (action === 'remove' ? '移除失败：' : '收藏失败：') + error.message;
      if (popover.value.show) popover.value.error = message;
      else showToast(message);
    }
  } finally {
    const pending = new Set(wordOperations.value); pending.delete(key); wordOperations.value = pending;
  }
}
function onWordDblClick(tk,para) {
  if (tk.t !== 'w') return;
  return changeWord('add',tk.text,sentenceOf(para,para.indexOf(tk)),wordContext());
}
function addFromPopover() {
  const view = popover.value;
  if (!view.data || !view.target || !lookupCurrent(view.target)) return;
  return changeWord('add',view.data.word,view.ctx,view.target,view.target.sequence);
}
function removeFromPopover() {
  const view = popover.value;
  if (!view.data || !view.target || !lookupCurrent(view.target)) return;
  return changeWord('remove',view.data.word,'',view.target,view.target.sequence);
}
function quickAdd(word) { return changeWord('add',word,'',wordContext()); }

function speak(word) {
  try {
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) { /* no tts */ }
}

function onDocClick(event) {
  if (event?.target?.closest?.('.inline-explanation,.assistant-panel')) return;
  closePopover();
  selMenu.value.show = false;
}

function onMouseUp(ev) {
  const target = wordContext(), sequence = ++selectionSequence;
  setTimeout(() => {
    if (!wordContextCurrent(target) || sequence !== selectionSequence || ev.target.isConnected === false) return;
    const sel = window.getSelection();
    const text = sel ? String(sel).trim() : '';
    if (text && text.length > 3 && /^[A-Za-z]/.test(text) && ev.target.closest && ev.target.closest('.article')) {
      selMenu.value = { show: true, x: ev.clientX, y: ev.clientY, text };
    } else {
      selMenu.value.show = false;
    }
  }, 10);
}

function cancelSelection() {
  aiTasks.cancel('selection');
  if (aiResult.value?.loading) aiResult.value = {...aiResult.value,loading:false,text:'已取消。'};
}
async function runSelection(kind) {
  if (pageAssistant.busy.value) pageAssistant.stop(false);
  const text = selMenu.value.text, task = aiTasks.start('selection');
  selMenu.value.show = false;
  aiResult.value = {kind,text:kind === 'translate' ? '翻译中…（需在设置页配置 AI）' : '分析中…（需在设置页配置 AI）',source:text,loading:true};
  try {
    const r = await window.keeper[kind === 'translate' ? 'translate' : 'grammar'](text,task.id);
    if (!task.isCurrent() || readerDisposed) return;
    aiResult.value = {kind,source:text,loading:false,text:r.ok ? r.response.content
      : r.error === 'no_key' ? '尚未配置 AI 服务。请到「设置」页填写 API 地址与 Key 后重试。'
      : r.error === 'cancelled' ? '已取消。' : '请求失败：'+r.error,cached:r.cached};
  } catch (error) {
    if (task.isCurrent() && !readerDisposed) aiResult.value = {kind,source:text,loading:false,text:'请求失败：'+error.message};
  } finally { task.finish(); }
}
function doTranslate() { return runSelection('translate'); }
function doGrammar() { return runSelection('grammar'); }
function cancelReaderAi() {
  aiTasks.cancelAll();
  stopChat(false); chatClearing.value = false;
  busy.value = false; assessmentCancelling.value = false; essayBusy.value = false; aiResult.value = null;
}

async function scanHard() {
  if (!scanOn.value || !activePassage.value) return;
  const passage = activePassage.value, sequence = readerLoadSequence;
  try {
    const r = await window.keeper.scanHard(passage.content, detail.value.exam.level);
    if (!readerDisposed && sequence === readerLoadSequence && scanOn.value && activePassage.value?.id === passage.id) hardWords.value = r || [];
  } catch { /* 预扫失败不影响正文和离线查词 */ }
}

watch(activeIdx, () => { aiResult.value = null; scanHard(); loadEssay(); saveProgress(); recordVisit(); });
watch(() => activePassage.value && activePassage.value.id, () => { invalidateWordContext(); cancelSelection(); aiResult.value = null; if (essayBusy.value) cancelGrade();  rowToggle.value = {}; hardWords.value = []; });
watch(() => activePassage.value?.content, text => {
  const words = tokenize(text || '').filter(token => token.t === 'w').map(token => token.text);
  void ensureWords(words);
}, {immediate:true});
watch(layout, () => saveProgress());
watch(fontSize, () => saveProgressSoon());
watch(scanOn, () => scanHard());
// 同一个组件实例切换考次（hash 路由参数变化时 Vue 会复用实例）必须重新加载，
// 否则页面上仍是上一套的篇章与作答
watch(() => props.examId, () => { loadAll(); loadChat(); });
watch(() => [router.currentRoute?.value?.query?.passage,router.currentRoute?.value?.query?.p,router.currentRoute?.value?.query?.question], applyRequestedPassage);

function movePassage(d) {
  const total = detail.value ? detail.value.passages.length : 0;
  if (!total) return;
  activeIdx.value = Math.min(total - 1, Math.max(0, activeIdx.value + d));
}

function onReaderKey(ev) {
  if (ev.isComposing || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const tag = (ev.target && ev.target.tagName) || '';
  if (ev.target?.isContentEditable || ev.target?.closest?.('.assistant-panel,.inline-explanation')) return;
  if (/INPUT|TEXTAREA|SELECT|BUTTON|A/.test(tag)) return;               // 输入框内不打架
  if (popover.value.show || selMenu.value.show) return;
  if (ev.key === ']' || ev.key === '[') {
    movePassage(ev.key === ']' ? 1 : -1);
    ev.preventDefault();
  } else if (ev.key === 't' || ev.key === 'T') {
    setTransMode(transMode.value === 'inline' ? 'off' : 'inline');
  } else if (ev.key === 'l' || ev.key === 'L') {
    layout.value = layout.value === 'stack' ? 'split' : 'stack';
  } else if (ev.key === 'Enter') {
    const hasQ = activePassage.value && activePassage.value.questions && activePassage.value.questions.length;
    if (hasQ && !graded.value && !busy.value) submit();
  }
}

onMounted(() => {
  offLearning = window.keeper.onLearningChanged(event => {
    if (event.kind === 'words') void refreshUserWords().catch(() => {});
  });
  loadAll();
  loadChat();
  loadEssay();
  document.addEventListener('click', onDocClick);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keydown', onReaderKey);
  window.addEventListener('beforeunload', flushEssayOnClose);
});
onBeforeUnmount(() => {
  ++wordsSequence;
  offLearning?.();
  readerDisposed = true;
  invalidateWordContext();
  cancelReaderAi();
  readerLoadSequence++;
  answerLoadSequence++;
  void answerDrafts.flush();
  essayLoadSequence++;
  void essayDrafts.flush();
  clearTimeout(saveTimer);
  window.removeEventListener('beforeunload', flushEssayOnClose);
  saveProgress();
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('mouseup', onMouseUp);
  document.removeEventListener('keydown', onReaderKey);
});
</script>

<style scoped>
.chat-card { display: flex; flex-direction: column; }
.mini-btn {
  font-size: 11.5px; padding: 3px 10px; border: 1px solid var(--border, #ddd);
  border-radius: 6px; background: transparent; cursor: pointer; color: var(--muted, #888);
}
.chat-msgs {
  height: 300px; overflow-y: auto; padding: 8px;
  background: var(--bg, #f7f6f3); border-radius: 8px;
  display: flex; flex-direction: column; gap: 8px;
}
.chat-empty { font-size: 12.5px; color: var(--muted, #999); line-height: 2; padding: 10px; }
.chat-msg { display: flex; }
.chat-msg.user { justify-content: flex-end; }
.chat-msg .bubble {
  max-width: 86%; padding: 7px 10px; border-radius: 10px; font-size: 13px;
  line-height: 1.65; white-space: pre-wrap; word-break: break-word;
}
.chat-msg.user .bubble { background: var(--accent); color: #fff; border-bottom-right-radius: 3px; }
.chat-msg.assistant .bubble { background: var(--card); border: 1px solid var(--border, #e5e2da); border-bottom-left-radius: 3px; }
.chat-msg .bubble.typing { color: var(--muted, #999); }
.chat-input-row { display: flex; gap: 8px; margin-top: 8px; align-items: flex-end; }
.chat-input-row textarea {
  flex: 1; resize: vertical; min-height: 44px; font-size: 13px; font-family: inherit;
  padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border, #ddd);
}
.essay-input {
  width: 100%; font-size: 14.5px; font-family: Georgia, serif; line-height: 1.9;
  padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border, #ddd); resize: vertical;
}
.essay-result { margin-top: 14px; border-top: 1px dashed var(--border, #e5e2da); padding-top: 12px; }
.er-score { display: flex; align-items: baseline; gap: 6px; }
.er-num { font-size: 30px; font-weight: 700; color: var(--red); }
.er-denom { font-size: 15px; color: var(--muted, #999); }
.er-conv { font-size: 12.5px; color: var(--muted, #999); margin-left: 8px; }
.er-band { font-size: 13.5px; margin-top: 4px; color: var(--ok); }
.er-strengths { font-size: 13px; margin-top: 8px; color: var(--ok); }
.er-issues { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.er-issue {
  font-size: 13px; line-height: 1.7; background: var(--bg, #faf8f4);
  border-radius: 8px; padding: 8px 12px;
}
.er-quote { font-family: Georgia, serif; color: var(--red); }
.er-fix { color: var(--ok); }
.er-ref { margin-top: 12px; font-size: 13.5px; line-height: 1.9; white-space: normal; }
.er-ref b { display: block; margin-bottom: 4px; font-size: 13px; }
.er-ref-box {
  margin-top: 12px; border-left: 3px solid var(--accent, #5b7cfa);
  background: var(--bg, #faf8f4); border-radius: 0 8px 8px 0; padding: 10px 14px;
}
.er-ref-text {
  font-family: Georgia, serif; font-size: 14px; line-height: 1.9;
  white-space: pre-wrap; word-break: break-word;
}
</style>

<style scoped>.study-modes{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}.study-modes span{font-size:12px;color:var(--muted)}.study-modes .active{background:var(--accent);color:white}.reader-settings summary{cursor:pointer;font-size:12px;color:var(--muted);padding:8px 0}</style>

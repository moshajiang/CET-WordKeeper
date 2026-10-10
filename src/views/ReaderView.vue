<template>
  <div v-if="detail">
    <div class="reader-topbar">
      <div class="reader-topbar-row">
        <div class="tb-title">
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
          <button class="primary" @click="submit" :disabled="busy">交卷核对</button>
          <button class="reveal-btn" @click="toggleAnalysis" :disabled="busy">
            {{ busy ? '处理中…' : (revealAnalysis && !graded ? '隐藏解析' : '查看解析与翻译') }}
          </button>
          <button @click="fontSize = Math.max(14, fontSize - 1)">A-</button>
          <button @click="fontSize = Math.min(22, fontSize + 1)">A+</button>
        </div>
      </div>

      <!-- 展示模式：翻译呈现方式 + 题目布局 -->
      <div class="reader-topbar-row tb-modes">
        <span class="tb-label">翻译</span>
        <button :class="{ active: transMode === 'off' }" @click="setTransMode('off')">关闭</button>
        <button
          :class="{ active: transMode === 'inline' }"
          :disabled="!hasTranslation"
          @click="setTransMode('inline')"
        >逐句对照</button>
        <button
          :class="{ active: transMode === 'recite' }"
          :disabled="!hasTranslation"
          @click="setTransMode('recite')"
        >对照背诵</button>
        <span class="tb-label" style="margin-left: 10px;">布局</span>
        <button :class="{ active: layout === 'stack' }" @click="layout = 'stack'">上下</button>
        <button :class="{ active: layout === 'split' }" @click="layout = 'split'">左右（题目并排）</button>
      </div>
    </div>

    <div v-if="result" class="card" style="margin-bottom: 12px; padding: 12px 18px;">
      <div style="display: flex; align-items: center; gap: 14px;">
        <span style="font-size: 15px; font-weight: 500;">
          得分 {{ result.score }} 分 · 客观题 {{ result.correct }} / {{ result.total }} 正确
        </span>
        <button @click="clearAttempt">重做本套</button>
      </div>
    </div>
    <div v-if="notice" class="card" style="margin-bottom: 12px; padding: 10px 16px; font-size: 13px;"
         :style="{ color: noticeOk ? '#2e7d4f' : 'var(--red)' }">{{ notice }}</div>

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

    <div class="reader-layout" :class="layout === 'split' ? 'layout-split' : 'layout-stack'">
      <div class="passage-pane">
        <div class="article" :style="{ fontSize: fontSize + 'px' }">
          <div v-for="(para, pi) in activeParas" :key="pi" class="para">
            <span
              v-for="(tk, ti) in para"
              :key="ti"
              class="w"
              :class="wordClass(tk)"
              @click.stop="onWordClick($event, tk, para, pi)"
              @dblclick.stop="onWordDblClick(tk, para, pi)"
            >{{ tk.text }}</span>
          </div>
        </div>

        <!-- 逐句对照 / 对照背诵：译文插在每句原文下方 -->
        <div v-if="transMode !== 'off' && hasTranslation" class="card bi-card">
          <div class="bi-head">
            <h3 style="font-size: 14px; margin: 0;">
              {{ transMode === 'recite' ? '对照背诵' : '逐句对照' }}
              <span style="font-size: 11.5px; color: var(--muted); font-weight: 400;">（本地缓存，离线可看；点句子切换中/英文）</span>
            </h3>
            <div class="bi-actions">
              <span v-if="transMode === 'recite'" class="bi-progress">已呈现 {{ revealedCount }} / {{ bilingual.length }}</span>
              <template v-if="transMode === 'recite'">
                <button class="mini-btn" @click="revealNext" :disabled="revealedCount >= bilingual.length">下一句 ▶</button>
                <button class="mini-btn" @click="revealedCount = bilingual.length">全部显示</button>
                <button class="mini-btn" @click="resetReveal">重置</button>
              </template>
            </div>
          </div>
          <div class="bi-list">
            <div
              v-for="(s, si) in visibleBilingual"
              :key="s.para + '-' + s.i"
              class="bi-row"
              :class="{ open: zhOpen(s) }"
              :data-bi-index="si"
              @click="toggleRow(s)"
            >
              <div class="bi-en" :style="{ fontSize: Math.max(13, fontSize - 2) + 'px' }">
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
            </div>
            <div v-if="!bilingual.length" class="bi-tip">本篇暂无可用译文。</div>
          </div>
          <div class="bi-tip">
            {{ transMode === 'recite' ? '点「下一句」逐句呈现译文；点任意句子可来回切换中/英文' : '每句原文下方即对应译文；点句子可隐藏/显示译文（切换中/英文）' }}
          </div>
        </div>

        <div v-if="activePassage && isEssaySection" class="card essay-card" style="margin-top: 16px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <h3 style="font-size: 15px; margin: 0;">
              {{ activePassage.section === 'writing' ? '✍️ 在此作答作文' : '🌐 在此作答翻译' }}
              <span style="font-size: 11.5px; color: var(--muted); font-weight: 400;">草稿自动保存{{ essaySavedAt ? ' · ' + essaySavedAt : '' }}</span>
            </h3>
            <span style="font-size: 12.5px; color: var(--muted);">{{ essayText.length }} 词</span>
          </div>
          <textarea v-model="essayText" class="essay-input" rows="10"
            :placeholder="activePassage.section === 'writing' ? '在此写作，草稿会自动保存到本地…' : '在此输入你的英文译文，草稿会自动保存到本地…'"></textarea>
          <div style="margin-top: 10px; display: flex; gap: 10px; align-items: center;">
            <button class="primary" @click="gradeEssay" :disabled="essayBusy">{{ essayBusy ? '批改中…' : 'AI 批改' }}</button>
            <button v-if="activePassage.reference" @click="showReference = !showReference">
              {{ (showReference ? '隐藏' : '查看') + (activePassage.section === 'writing' ? '范文' : '参考译文') }}
              <span style="font-size: 11px; color: var(--muted);">（预置，离线可看）</span>
            </button>
            <span v-if="essayNotice" style="font-size: 12.5px;" :style="{ color: essayNoticeOk ? '#2e7d4f' : 'var(--red)' }">{{ essayNotice }}</span>
          </div>

          <div v-if="activePassage.reference && showReference" class="er-ref-box">
            <h4 style="font-size: 13.5px; margin: 0 0 6px;">{{ activePassage.section === 'writing' ? '✍️ 考场范文' : '🌐 英文参考译文' }}
              <span style="font-size: 11.5px; color: var(--muted); font-weight: 400;">预置内容，未配置 AI 也能看</span>
            </h4>
            <div class="er-ref-text">{{ activePassage.reference }}</div>
          </div>

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
          v-if="layout === 'stack'"
          :passage="activePassage"
          :answers="answers"
          :graded="graded"
          :reveal="revealAnalysis"
          :letters="matchLetters"
          @pick="setAnswer"
          style="margin-top: 16px;"
        />
      </div>

      <div v-if="layout === 'split'" class="question-pane">
        <QuestionPanel
          :passage="activePassage"
          :answers="answers"
          :graded="graded"
          :reveal="revealAnalysis"
          :letters="matchLetters"
          @pick="setAnswer"
        />
      </div>

      <div class="side-pane">
        <div v-if="chatOpen" class="card chat-card">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <h3 style="font-size: 14px; margin: 0;">💬 AI 助手
              <span style="font-size: 11px; color: var(--muted); font-weight: 400;">知识库 + 当前文章作上下文</span>
            </h3>
            <button class="mini-btn" @click="clearChat" title="清空历史">清空</button>
          </div>
          <div class="chat-msgs" ref="chatMsgsEl">
            <div v-if="!chatMsgs.length" class="chat-empty">
              问点什么吧，例如：<br>
              · 虚拟语气怎么用？<br>
              · 选词填空有什么套路？<br>
              · 这篇文章的主旨是什么？
            </div>
            <div v-for="(m, i) in chatMsgs" :key="i" class="chat-msg" :class="m.role">
              <div class="bubble">{{ m.content }}</div>
            </div>
            <div v-if="chatBusy" class="chat-msg assistant"><div class="bubble typing">思考中…</div></div>
          </div>
          <div class="chat-input-row">
            <textarea v-model="chatInput" rows="2" placeholder="输入问题，Enter 发送，Shift+Enter 换行"
              @keydown.enter.exact.prevent="sendChat"></textarea>
            <button class="primary" @click="sendChat" :disabled="chatBusy || !chatInput.trim()">发送</button>
          </div>
          <div v-if="chatNotice" style="font-size: 12px; color: var(--red); margin-top: 6px;">{{ chatNotice }}</div>
        </div>

        <div v-if="aiResult" class="card">
          <h3 style="font-size: 14px; margin-bottom: 8px;">
            {{ aiResult.kind === 'translate' ? '整句翻译' : '语法结构分析' }}
            <span v-if="aiResult.cached" style="font-size: 11px; color: var(--muted); font-weight: 400;">（缓存）</span>
          </h3>
          <div class="ai-result" style="margin-top: 0;">{{ aiResult.text }}</div>
          <div v-if="aiResult.source" style="font-size: 12px; color: var(--muted); margin-top: 8px; font-family: Georgia, serif;">{{ aiResult.source }}</div>
        </div>

        <div v-if="scanOn" class="card">
          <h3 style="font-size: 14px; margin-bottom: 10px;">难词预扫 <span style="font-size: 11.5px; color: var(--muted); font-weight: 400;">本篇超纲/高级词</span></h3>
          <div v-if="hardWords.length" class="hardword-list">
            <div v-for="h in hardWords" :key="h.word" class="hw-item" @click="quickAdd(h.word)">
              <span>{{ h.word }}</span>
              <span style="color: var(--muted); font-size: 11px;">{{ h.label }} · 点击加入</span>
            </div>
          </div>
          <div v-else style="color: var(--muted); font-size: 13px;">本篇没有发现超纲词 👍</div>
        </div>

        <div class="card">
          <h3 style="font-size: 14px; margin-bottom: 8px;">使用小贴士</h3>
          <div style="font-size: 12.5px; color: var(--muted); line-height: 1.8;">
            · 单击单词：查看释义与分级<br>
            · 双击单词：直接加入生词本<br>
            · 划选句子：翻译 / 语法分析<br>
            · 黄色 = 生词 · 绿色 = 已掌握<br>
            · 紫色虚线 = 预扫出的难词
          </div>
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
        <div class="acts">
          <button v-if="!popover.data.inBook" class="primary" @click="addFromPopover">★ 加入生词本</button>
          <button v-else class="danger" @click="removeFromPopover">移出生词本</button>
          <button @click="speak(popover.data.word)">🔊 朗读</button>
        </div>
      </template>
    </div>

    <div v-if="selMenu.show" class="selmenu" :style="selMenuStyle">
      <button @click="doTranslate">🌐 整句翻译</button>
      <button @click="doGrammar">🧩 语法分析</button>
      <button @click="askAboutSel">💬 问 AI</button>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
  <div v-else class="empty-state"><div class="big">⏳</div>加载真题中…</div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { tokenize, simpleNorm, sentenceOf } from '../utils/tokens.js';
import { alignBilingual, paragraphLetters } from '../utils/bilingual.js';
import QuestionPanel from '../components/QuestionPanel.vue';

const props = defineProps({ examId: String });

const detail = ref(null);
const activeIdx = ref(0);
const userWords = ref({});
const fontSize = ref(16.5);
const scanOn = ref(false);
const hardWords = ref([]);
const toast = ref('');
const aiResult = ref(null);

// ---- 做题 / 交卷 / 解析与翻译 ----
const answers = ref({});        // questionId -> 所选字母
const graded = ref(false);      // 是否已交卷
const result = ref(null);       // { total, correct, score }
const notice = ref('');
const noticeOk = ref(false);
const busy = ref(false);
const revealAnalysis = ref(false);   // 「查看解析与翻译」直接揭示答案与解析（不必先交卷）

// 展示模式：翻译呈现方式（off / 逐句对照 / 对照背诵）与布局（上下 / 左右）
const transMode = ref('off');
const layout = ref('stack');
const revealedCount = ref(0);        // 背诵模式：已呈现译文的句数
const rowToggle = ref({});           // 句子下标 -> 是否显示译文（点击句子切换）
const tokenCache = new Map();

const hasTranslation = computed(() => !!(activePassage.value && activePassage.value.translation));
const bilingual = computed(() => {
  const p = activePassage.value;
  if (!p) return [];
  return alignBilingual(p.content, p.translation || '');
});
// 背诵模式也始终显示全部原文句；译文按 revealedCount 逐句出现（点击句子可手动切换）
const visibleBilingual = computed(() => bilingual.value);
// 匹配题可用的段落字母：从正文段落标记提取；提取不到时回退 A-O，保证永远可作答
const matchLetters = computed(() => {
  const p = activePassage.value;
  if (!p || p.section !== 'match') return [];
  const found = paragraphLetters(p.content);
  if (found.length >= 4) return found;
  return 'ABCDEFGHIJKLMNO'.split('');
});

function rowTokens(s) {
  const key = s.para + '|' + s.i;
  if (!tokenCache.has(key)) tokenCache.set(key, tokenize(s.en));
  return tokenCache.get(key);
}
function zhOpen(s) {
  const key = s.para + '|' + s.i;
  if (key in rowToggle.value) return !!rowToggle.value[key];
  if (transMode.value === 'inline') return true;      // 对照模式：默认显示译文
  return s.i < revealedCount.value;                   // 背诵模式：已呈现的句子显示译文
}
function toggleRow(s) {
  const key = s.para + '|' + s.i;
  rowToggle.value = { ...rowToggle.value, [key]: !zhOpen(s) };
}
function setTransMode(m) {
  transMode.value = m;
  revealedCount.value = 0;
  rowToggle.value = {};
}
function revealNext() {
  const total = bilingual.value.length;
  if (revealedCount.value < total) revealedCount.value++;
  const el = document.querySelector(`[data-bi-index="${Math.max(0, revealedCount.value - 1)}"]`);
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function resetReveal() {
  revealedCount.value = 0;
  rowToggle.value = {};
}
function setAnswer(qid, letter) {
  if (graded.value) return;   // 已交卷锁定；「查看解析」只是临时揭示，不锁作答
  answers.value = { ...answers.value, [qid]: letter };
}

async function reloadDetail() {
  detail.value = await window.keeper.examDetail(Number(props.examId));
}

async function restoreAttempt() {
  const r = await window.keeper.attemptGet(Number(props.examId));
  const map = {};
  for (const a of r.answers || []) map[a.question_id] = a.choice;
  answers.value = map;
  if (r.attempt && r.attempt.total) {
    result.value = { total: r.attempt.total, correct: r.attempt.correct, score: r.attempt.score };
    graded.value = true;
  }
}

async function loadAnalysis() {
  busy.value = true;
  notice.value = '';
  const r = await window.keeper.examAnalysis(Number(props.examId));
  busy.value = false;
  if (!r.ok) {
    noticeOk.value = false;
    notice.value = r.error === 'no_key'
      ? '中文解析与全文翻译由 AI 按需生成（首次），请先在「设置」里填写 API 地址与 Key；生成后会保存到本地，之后永久离线可看。'
      : '生成失败：' + r.error;
    return;
  }
  await reloadDetail();
  revealAnalysis.value = true;   // 关键：点了就直接展示答案与解析（此前只加载不改状态，点了没反应）
  noticeOk.value = true;
  notice.value = r.cached ? '已显示本地缓存的解析与全文翻译（点「逐句对照」可左右/上下对照阅读）。' : `已生成 ${r.generated} 个篇章的解析与翻译，并已保存到本地。`;
}

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
  busy.value = true;
  notice.value = '';
  const r = await window.keeper.attemptSubmit(Number(props.examId), { ...answers.value });
  busy.value = false;
  if (!r.ok) {
    noticeOk.value = false;
    notice.value = r.error === 'no_key'
      ? '自动核对需要正确答案：首次由 AI 生成（请在「设置」里配置 Key），生成后永久离线可用。'
      : '交卷失败：' + r.error;
    return;
  }
  await reloadDetail();
  graded.value = true;
  result.value = r;
  noticeOk.value = true;
  notice.value = `已交卷：客观题 ${r.correct} / ${r.total} 正确，得分 ${r.score} 分。`;
}

async function clearAttempt() {
  await window.keeper.attemptClear(Number(props.examId));
  graded.value = false;
  result.value = null;
  notice.value = '';
  answers.value = {};
  revealAnalysis.value = false;   // 重做时收起答案解析，重新进入作答状态
  await reloadDetail();
}

// ---- 右侧 AI 聊天（知识库 + 当前文章上下文，历史持久化）----
const chatOpen = ref(false);
const chatMsgs = ref([]);
const chatInput = ref('');
const chatBusy = ref(false);
const chatNotice = ref('');
const chatMsgsEl = ref(null);

async function loadChat() {
  try { chatMsgs.value = (await window.keeper.chatHistory()) || []; } catch (e) { /* 忽略 */ }
}

function scrollChat() {
  setTimeout(() => {
    const el = chatMsgsEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  }, 50);
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text || chatBusy.value) return;
  chatInput.value = '';
  chatNotice.value = '';
  chatMsgs.value.push({ role: 'user', content: text });
  chatBusy.value = true;
  const pid = activePassage.value ? activePassage.value.id : null;
  const r = await window.keeper.chatSend(Number(props.examId), pid, text);
  chatBusy.value = false;
  if (r.ok) {
    chatMsgs.value.push({ role: 'assistant', content: r.reply });
  } else if (r.error === 'no_key') {
    chatNotice.value = '尚未配置 AI 服务：请到「设置」页填写 API 地址与 Key 后重试。';
  } else {
    chatNotice.value = '发送失败：' + r.error;
  }
  scrollChat();
}

async function clearChat() {
  await window.keeper.chatClear();
  chatMsgs.value = [];
}

// 划选句子 → 打开聊天并带入原文
function askAboutSel() {
  const text = selMenu.value.text;
  selMenu.value.show = false;
  chatOpen.value = true;
  chatInput.value = (chatInput.value ? chatInput.value + '\n' : '') + text;
}

// ---- 作文 / 翻译：作答草稿自动保存 + AI 批改 ----
const isEssaySection = computed(() => {
  const s = activePassage.value && activePassage.value.section;
  return s === 'writing' || s === 'translation';
});
const essayText = ref('');
const essayResult = ref(null);
const essayBusy = ref(false);
const essayNotice = ref('');
const essayNoticeOk = ref(false);
const essaySavedAt = ref('');
const showReference = ref(false);   // 是否展开预置范文 / 参考译文（离线可看）
let essayTimer = null;
let essayLoadedKey = '';

async function loadEssay() {
  if (!activePassage.value || !isEssaySection.value) return;
  const key = props.examId + ':' + activePassage.value.section;
  if (key === essayLoadedKey) return;
  essayLoadedKey = key;
  const r = await window.keeper.essayGet(Number(props.examId), activePassage.value.section);
  essayText.value = r.content || '';
  try { essayResult.value = r.result ? JSON.parse(r.result) : null; } catch (e) { essayResult.value = null; }
  essaySavedAt.value = '';
  showReference.value = false;
}

function scheduleSave() {
  clearTimeout(essayTimer);
  essayTimer = setTimeout(async () => {
    if (!activePassage.value || !isEssaySection.value) return;
    await window.keeper.essaySave(Number(props.examId), activePassage.value.section, essayText.value);
    const d = new Date();
    essaySavedAt.value = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }, 800);
}

watch(essayText, () => { if (isEssaySection.value) scheduleSave(); });

async function gradeEssay() {
  if (!activePassage.value || essayBusy.value) return;
  essayBusy.value = true;
  essayNotice.value = '';
  clearTimeout(essayTimer);
  await window.keeper.essaySave(Number(props.examId), activePassage.value.section, essayText.value);
  const r = await window.keeper.essayGrade(Number(props.examId), activePassage.value.section);
  essayBusy.value = false;
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
  } else {
    essayNoticeOk.value = false;
    essayNotice.value = '批改失败：' + r.error;
  }
}

const popover = ref({ show: false, loading: false, data: null, x: 0, y: 0, ctx: '' });
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
  return { left: Math.min(m.x, window.innerWidth - 220) + 'px', top: Math.max(8, m.y - 44) + 'px' };
});

const levelTags = computed(() => {
  const tags = (popover.value.data && popover.value.data.tags) || [];
  const out = [];
  const has = (k) => tags.includes(k);
  if (has('cet4')) out.push({ name: '四级考纲', cls: 'lvl4' });
  if (has('cet6')) out.push({ name: '六级考纲', cls: 'lvl6' });
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
  if (tk.t !== 'w') return '';
  const n = simpleNorm(tk.text);
  const st = userWords.value[n];
  if (st === 'learning') return 'marked';
  if (st === 'mastered') return 'marked mastered';
  if (scanOn.value && hardSet.value.has(n)) return 'hard';
  return '';
}

const hardSet = computed(() => new Set(hardWords.value.map((h) => h.word)));

function showToast(msg) {
  toast.value = msg;
  setTimeout(() => (toast.value = ''), 1800);
}

async function loadAll() {
  detail.value = await window.keeper.examDetail(Number(props.examId));
  userWords.value = await window.keeper.allWords();
  if (detail.value && !detail.value.passages.length) {
    showToast('该套真题没有结构化篇章数据');
  }
  // 恢复上次的作答与交卷结果（换套或重开应用都还在）
  graded.value = false;
  result.value = null;
  notice.value = '';
  answers.value = {};
  try { await restoreAttempt(); } catch { /* 忽略 */ }
  await loadEssay();
}

async function onWordClick(ev, tk, para) {
  if (tk.t !== 'w') { popover.value.show = false; return; }
  const sentence = sentenceOf(para, para.indexOf(tk));
  popover.value = { show: true, loading: true, data: null, x: ev.clientX, y: ev.clientY, ctx: sentence };
  const data = await window.keeper.lookup(tk.text);
  popover.value.loading = false;
  popover.value.data = data;
}

async function onWordDblClick(tk, para) {
  if (tk.t !== 'w') return;
  const sentence = sentenceOf(para, para.indexOf(tk));
  const r = await window.keeper.addWord(tk.text, sentence, activePassage.value ? activePassage.value.id : null);
  userWords.value[r.word] = 'learning';
  showToast(r.added ? `「${r.word}」已加入生词本` : `「${r.word}」已在生词本中`);
  if (popover.value.data) popover.value.data.inBook = true;
}

async function addFromPopover() {
  const d = popover.value.data;
  if (!d) return;
  const r = await window.keeper.addWord(d.word, popover.value.ctx, activePassage.value ? activePassage.value.id : null);
  userWords.value[r.word] = 'learning';
  d.inBook = true;
  showToast(r.added ? `「${r.word}」已加入生词本` : `「${r.word}」已在生词本中`);
}

async function removeFromPopover() {
  const d = popover.value.data;
  if (!d) return;
  await window.keeper.removeWord(d.word);
  delete userWords.value[d.word];
  d.inBook = false;
  showToast(`「${d.word}」已移出`);
}

async function quickAdd(word) {
  const r = await window.keeper.addWord(word, '', null);
  userWords.value[r.word] = 'learning';
  showToast(`「${r.word}」已加入生词本`);
}

function speak(word) {
  try {
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) { /* no tts */ }
}

function onDocClick() {
  popover.value.show = false;
  selMenu.value.show = false;
}

function onMouseUp(ev) {
  setTimeout(() => {
    const sel = window.getSelection();
    const text = sel ? String(sel).trim() : '';
    if (text && text.length > 3 && /^[A-Za-z]/.test(text) && ev.target.closest && ev.target.closest('.article')) {
      selMenu.value = { show: true, x: ev.clientX, y: ev.clientY, text };
    } else {
      selMenu.value.show = false;
    }
  }, 10);
}

async function doTranslate() {
  const text = selMenu.value.text;
  selMenu.value.show = false;
  aiResult.value = { kind: 'translate', text: '翻译中…（需在设置页配置 AI）', source: text };
  const r = await window.keeper.translate(text);
  if (r.ok) aiResult.value = { kind: 'translate', text: r.response.content, source: text, cached: r.cached };
  else if (r.error === 'no_key') aiResult.value = { kind: 'translate', text: '尚未配置 AI 服务。请到「设置」页填写 API 地址与 Key 后重试。', source: text };
  else aiResult.value = { kind: 'translate', text: '请求失败：' + r.error, source: text };
}

async function doGrammar() {
  const text = selMenu.value.text;
  selMenu.value.show = false;
  aiResult.value = { kind: 'grammar', text: '分析中…（需在设置页配置 AI）', source: text };
  const r = await window.keeper.grammar(text);
  if (r.ok) aiResult.value = { kind: 'grammar', text: r.response.content, source: text, cached: r.cached };
  else if (r.error === 'no_key') aiResult.value = { kind: 'grammar', text: '尚未配置 AI 服务。请到「设置」页填写 API 地址与 Key 后重试。', source: text };
  else aiResult.value = { kind: 'grammar', text: '请求失败：' + r.error, source: text };
}

async function scanHard() {
  if (!scanOn.value || !activePassage.value) return;
  const r = await window.keeper.scanHard(activePassage.value.content, detail.value.exam.level);
  hardWords.value = r || [];
}

watch(activeIdx, () => { aiResult.value = null; scanHard(); loadEssay(); });
watch(scanOn, () => scanHard());
// 同一个组件实例切换考次（hash 路由参数变化时 Vue 会复用实例）必须重新加载，
// 否则页面上仍是上一套的篇章与作答
watch(() => props.examId, () => { loadAll(); });

onMounted(() => {
  loadAll();
  loadChat();
  loadEssay();
  document.addEventListener('click', onDocClick);
  document.addEventListener('mouseup', onMouseUp);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('mouseup', onMouseUp);
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
.chat-msg.user .bubble { background: #5b7cfa; color: #fff; border-bottom-right-radius: 3px; }
.chat-msg.assistant .bubble { background: #fff; border: 1px solid var(--border, #e5e2da); border-bottom-left-radius: 3px; }
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
.er-num { font-size: 30px; font-weight: 700; color: #c0392b; }
.er-denom { font-size: 15px; color: var(--muted, #999); }
.er-conv { font-size: 12.5px; color: var(--muted, #999); margin-left: 8px; }
.er-band { font-size: 13.5px; margin-top: 4px; color: #2e7d4f; }
.er-strengths { font-size: 13px; margin-top: 8px; color: #2e7d4f; }
.er-issues { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.er-issue {
  font-size: 13px; line-height: 1.7; background: var(--bg, #faf8f4);
  border-radius: 8px; padding: 8px 12px;
}
.er-quote { font-family: Georgia, serif; color: #c0392b; }
.er-fix { color: #2e7d4f; }
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

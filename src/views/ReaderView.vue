<template>
  <div v-if="detail">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
      <div>
        <h1 class="page-title" style="margin-bottom: 2px;">
          {{ detail.exam.level }} · {{ detail.exam.year }} 年 {{ detail.exam.month }} 月 · 第{{ detail.exam.set_no }}套
        </h1>
        <p class="page-sub" style="margin-bottom: 0;">单击查词 · 双击直接加入生词本 · 划选句子可翻译与语法分析</p>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <label style="font-size: 12.5px; color: var(--muted); display: flex; align-items: center; gap: 5px; cursor: pointer;">
          <input type="checkbox" v-model="scanOn" /> 难词预扫
        </label>
        <button @click="fontSize = Math.max(14, fontSize - 1)">A-</button>
        <button @click="fontSize = Math.min(22, fontSize + 1)">A+</button>
      </div>
    </div>

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

    <div class="reader-layout">
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

        <div v-if="activePassage && activePassage.questions && activePassage.questions.length" class="card" style="margin-top: 16px;">
          <h3 style="font-size: 15px; margin-bottom: 14px;">题目与解析（同样可以点词标注）</h3>
          <div v-for="qs in activePassage.questions" :key="qs.id" class="qblock">
            <div class="qstem">{{ qs.stem }}</div>
            <div v-for="(opt, oi) in parseOptions(qs.options)" :key="oi" class="qopt">{{ opt }}</div>
            <div v-if="qs.answer" class="qans">答案：{{ qs.answer }}</div>
            <div v-if="qs.analysis" class="qanalysis">{{ qs.analysis }}</div>
          </div>
        </div>
      </div>

      <div class="side-pane">
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
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
  <div v-else class="empty-state"><div class="big">⏳</div>加载真题中…</div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { tokenize, simpleNorm, sentenceOf } from '../utils/tokens.js';

const props = defineProps({ examId: String });

const detail = ref(null);
const activeIdx = ref(0);
const userWords = ref({});
const fontSize = ref(16.5);
const scanOn = ref(false);
const hardWords = ref([]);
const toast = ref('');
const aiResult = ref(null);

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

function parseOptions(raw) {
  try { return JSON.parse(raw || '[]'); } catch (e) { return String(raw || '').split('\n').filter(Boolean); }
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

watch(activeIdx, () => { aiResult.value = null; scanHard(); });
watch(scanOn, () => scanHard());

onMounted(() => {
  loadAll();
  document.addEventListener('click', onDocClick);
  document.addEventListener('mouseup', onMouseUp);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('mouseup', onMouseUp);
});
</script>

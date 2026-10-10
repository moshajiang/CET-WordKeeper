<template>
  <div class="review-wrap">
    <h1 class="page-title">复习</h1>
    <p class="page-sub">认词 → 翻面核对 → 三键评分 · 语境模式用真题原句挖空</p>

    <div v-if="!started">
      <div class="card">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-weight: 700; font-size: 15px;">
              到期 {{ queue.due.length }} 词 · 新词 {{ queue.fresh.length }} 词
            </div>
            <div style="color: var(--muted); font-size: 13px; margin-top: 4px;">本局共 {{ total }} 词</div>
          </div>
          <div style="display: flex; gap: 10px; align-items: center;">
            <label style="font-size: 13px; display: flex; align-items: center; gap: 5px; cursor: pointer;">
              <input type="checkbox" v-model="clozeMode" /> 语境填空模式
            </label>
            <button class="primary" :disabled="!total" @click="started = true">开始</button>
          </div>
        </div>
      </div>
      <div v-if="!total" class="card empty-state">
        <div class="big">🎉</div>
        没有待复习的生词。去<a @click="$router.push('/library')">真题库</a>继续阅读、积累新词吧。
      </div>
    </div>

    <template v-else>
      <div class="review-progress"><div class="fill" :style="{ width: progress + '%' }"></div></div>

      <div v-if="current" class="review-card" :class="{ clickable: !revealed }" @click="flip">
        <template v-if="!revealed">
          <template v-if="clozeMode && current.sentence">
            <div class="rctx" v-html="clozeHtml"></div>
            <div class="rhint">回忆句中挖空的词，点击翻面核对</div>
          </template>
          <template v-else>
            <div class="rw">{{ current.word }}</div>
            <div class="rph">{{ current.phonetic ? '/' + current.phonetic + '/' : '' }}</div>
            <div class="rhint">心中回忆释义，点击卡片翻面</div>
          </template>
        </template>
        <template v-else>
          <div class="rw">{{ current.word }}
            <span class="speak" style="font-size: 18px; cursor: pointer; margin-left: 8px;" @click.stop="speak(current.word)">🔊</span>
          </div>
          <div class="rph">{{ current.phonetic ? '/' + current.phonetic + '/' : '' }}</div>
          <div class="rtrans">{{ current.translation || '（词典未收录）' }}</div>
          <div v-if="current.sentence" class="rctx" style="font-size: 14px;">{{ current.sentence }}</div>
          <div v-if="lastResult" class="rhint">上次评分后：间隔 {{ lastResult.interval < 1 ? Math.round(lastResult.interval * 1440) + ' 分钟' : lastResult.interval + ' 天' }}</div>
        </template>
      </div>

      <div v-if="current && revealed" class="rate-row">
        <button class="rate-forgot" @click="answer(0)">😵 忘记</button>
        <button class="rate-fuzzy" @click="answer(1)">🤔 模糊</button>
        <button class="rate-got" @click="answer(2)">😀 记得</button>
      </div>
      <div v-else-if="current" class="flip-hint" style="cursor: pointer;" @click="revealed = true">点击卡片或按空格键翻面</div>

      <div v-if="!current" class="card empty-state">
        <div class="big">✅</div>
        本轮复习完成！共复习 {{ doneCount }} 词。
        <div style="margin-top: 10px;"><button class="primary" @click="restart">再来一轮</button>
        <button style="margin-left: 8px;" @click="$router.push('/')">回首页</button></div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

const queue = ref({ due: [], fresh: [] });
const started = ref(false);
const clozeMode = ref(false);
const list = ref([]);
const idx = ref(0);
const revealed = ref(false);
const lastResult = ref(null);
const doneCount = ref(0);

const total = computed(() => queue.value.due.length + queue.value.fresh.length);
const current = computed(() => list.value[idx.value] || null);
const progress = computed(() => (total.value ? Math.round((idx.value / total.value) * 100) : 0));

const clozeHtml = computed(() => {
  if (!current.value || !current.value.sentence) return '';
  const w = current.value.word;
  const re = new RegExp('\\b(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '|\\w*(' + w + ')\\w*)\\b', 'gi');
  const esc = current.value.sentence.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(re, '<span class="blank">$1</span>');
});

async function load() {
  queue.value = await window.keeper.reviewQueue();
  list.value = [...queue.value.due, ...queue.value.fresh];
  idx.value = 0;
  revealed.value = false;
}

async function start() {
  started.value = true;
  if (!list.value.length) await load();
}

async function answer(rating) {
  if (!current.value) return;
  const r = await window.keeper.reviewAnswer(current.value.word, rating);
  lastResult.value = r;
  if (rating === 0) {
    list.value.push(current.value);
  }
  doneCount.value += 1;
  idx.value += 1;
  revealed.value = false;
}

// 点击卡面翻面核对（历史 bug：卡面本体没有绑定点击，只有下方一行小字可点）
function flip() {
  if (current.value && !revealed.value) revealed.value = true;
}

async function restart() {
  started.value = false;
  doneCount.value = 0;
  await load();
}

function speak(word) {
  try {
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) { /* no tts */ }
}

function onKey(ev) {
  if (!started.value || !current.value) return;
  if (ev.code === 'Space' && !revealed.value) { ev.preventDefault(); revealed.value = true; return; }
  if (revealed.value) {
    if (ev.key === '1') answer(0);
    if (ev.key === '2') answer(1);
    if (ev.key === '3') answer(2);
  }
}

onMounted(async () => {
  await load();
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

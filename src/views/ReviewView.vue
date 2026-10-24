<template>
  <div class="review-wrap">
    <h1 class="page-title">复习</h1>
    <div class="review-tabs"><button @click="tab='words'" :class="{active:tab==='words'}">生词复习</button><button @click="tab='knowledge'" :class="{active:tab==='knowledge'}">知识点复习</button><button @click="tab='cards'" :class="{active:tab==='cards'}">练习卡复习</button><button @click="openMistakes" :class="{active:tab==='mistakes'}">错题复盘</button></div>
    <PracticeCardReview v-if="tab==='cards'" />
    <KnowledgeReview v-else-if="tab==='knowledge'" />
    <section v-else-if="tab==='mistakes'" class="card"><p v-if="mistakeError" role="alert">{{ mistakeError }} <button @click="openMistakes">重试</button></p><p v-if="!mistakes.length">还没有错题复盘。核对答案后可在题目下整理错因并关联知识。</p><div v-for="m in mistakes" :key="m.question_id" class="mistake-review-item"><strong>{{ m.cause }} · {{ m.stem }}</strong><p>{{ m.note }}</p><button @click="$router.push({path:'/reader/'+m.exam_id,query:{passage:String(m.passage_id),question:String(m.question_id)}})">返回题目</button><button v-if="m.entry_key" @click="$router.push({path:'/knowledge',query:{entry:m.entry_key}})">关联知识与练习</button></div></section>
    <template v-else>
    <p class="page-sub">认词 → 翻面核对 → 三键评分 · 语境模式用真题原句挖空</p>
    <div v-if="errorMsg" class="card" role="alert" style="color: var(--red);">{{ errorMsg }} <button v-if="!started" @click="load">重试</button></div>

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
            <button class="primary" :disabled="loading || !total" @click="start">开始</button>
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
          <template v-if="clozeMode && clozeHtml">
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
        <button class="rate-forgot" :disabled="answering" @click="answer(0)">😵 忘记</button>
        <button class="rate-fuzzy" :disabled="answering" @click="answer(1)">🤔 模糊</button>
        <button class="rate-got" :disabled="answering" @click="answer(2)">😀 记得</button>
      </div>
      <div v-else-if="current" class="flip-hint" style="cursor: pointer;" @click="flip">点击卡片或按空格键翻面</div>

      <div v-if="!current" class="card empty-state">
        <div class="big">✅</div>
        本轮复习完成！共完成 {{ doneCount }} 次复习。
        <div style="margin-top: 10px;"><button class="primary" @click="restart">再来一轮</button>
        <button style="margin-left: 8px;" @click="$router.push('/')">回首页</button></div>
      </div>
    </template>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount,watch } from 'vue';
import {useRoute} from 'vue-router';
import KnowledgeReview from '../components/KnowledgeReview.vue';
import PracticeCardReview from '../components/PracticeCardReview.vue';
const route=useRoute(),tab=ref(['knowledge','cards'].includes(route.query.tab)?route.query.tab:'words'),mistakes=ref([]),mistakeError=ref('');
async function openMistakes(){tab.value='mistakes';mistakeError.value='';try{mistakes.value=await window.keeper.studyMistakeList();}catch(error){mistakeError.value=error.message;}}
watch(tab,()=>{revealed.value=false;});
watch(()=>route.query.tab,value=>{if(['knowledge','cards'].includes(value))tab.value=value;});

const queue = ref({ due: [], fresh: [] });
const started = ref(false);
const clozeMode = ref(false);
const list = ref([]);
const idx = ref(0);
const revealed = ref(false);
const lastResult = ref(null);
const doneCount = ref(0);
const answering = ref(false);
const loading = ref(false);
const errorMsg = ref('');
let loadSequence = 0, disposed = false, operationId = null, pendingRating = null;

const total = computed(() => queue.value.due.length + queue.value.fresh.length);
const current = computed(() => list.value[idx.value] || null);
const progress = computed(() => (list.value.length ? Math.round((idx.value / list.value.length) * 100) : 0));

const clozeHtml = computed(() => current.value?.clozeHtml || '');

async function load() {
  if (answering.value) return;
  const sequence = ++loadSequence;
  loading.value = true; errorMsg.value = '';
  try {
    const result = await window.keeper.reviewQueue();
    if (disposed || sequence !== loadSequence) return;
    queue.value = result;
    list.value = [...result.due, ...result.fresh];
    idx.value = 0; revealed.value = false; lastResult.value = null;
    operationId = null; pendingRating = null;
  } catch (error) { if (!disposed && sequence === loadSequence) errorMsg.value = '复习加载失败：' + error.message; }
  finally { if (!disposed && sequence === loadSequence) loading.value = false; }
}

async function start() {
  started.value = true;
  if (!list.value.length) await load();
}

async function answer(rating) {
  if (answering.value || !started.value || !revealed.value || !current.value) return;
  answering.value = true;
  const card = current.value, index = idx.value, sequence = loadSequence;
  // 失败重试复用同一操作身份和评分，避免“服务端成功、回执丢失”导致再次记忆调度。
  if (!operationId) {
    operationId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingRating = rating;
  }
  errorMsg.value = '';
  try {
    const result = await window.keeper.reviewAnswer(card.word,pendingRating,operationId);
    if (disposed || sequence !== loadSequence || idx.value !== index) return;
    if (!result?.ok) throw new Error(result?.error || '保存失败');
    lastResult.value = result;
    if (pendingRating === 0) list.value.push(card);
    doneCount.value += 1; idx.value += 1; revealed.value = false;
    operationId = null; pendingRating = null;
  } catch (error) {
    if (!disposed && sequence === loadSequence) errorMsg.value = '评分保存未确认，点击任意评分键重试本次评分：' + error.message;
  } finally { if (!disposed && sequence === loadSequence) answering.value = false; }
}

// 点击卡面翻面核对（历史 bug：卡面本体没有绑定点击，只有下方一行小字可点）
function flip() {
  if (!answering.value && current.value && !revealed.value) revealed.value = true;
}

async function restart() {
  if (answering.value) return;
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
  if (tab.value!=='words' || answering.value || ev.repeat || /INPUT|TEXTAREA|SELECT/.test(ev.target?.tagName || '') || !started.value || !current.value) return;
  if (ev.code === 'Space' && !revealed.value) { ev.preventDefault(); revealed.value = true; return; }
  if (revealed.value) {
    if (['1','2','3'].includes(ev.key)) ev.preventDefault();
    if (ev.key === '1') answer(0);
    if (ev.key === '2') answer(1);
    if (ev.key === '3') answer(2);
  }
}

onMounted(async () => {
  await load();
  if (!disposed) document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => { disposed = true; ++loadSequence; document.removeEventListener('keydown', onKey); });
</script>

<style scoped>.review-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.review-tabs .active{background:var(--accent);color:white}.mistake-review-item{padding:16px;border-bottom:1px solid var(--border)}.mistake-review-item button{margin-right:8px}</style>

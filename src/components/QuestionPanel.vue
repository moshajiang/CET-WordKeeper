<template>
  <div class="card qpanel">
    <div class="qpanel-head">
      <h3 style="font-size: 15px; margin: 0;">题目</h3>
      <span style="font-size: 12.5px; color: var(--muted);">
        已作答 {{ answeredCount }} / {{ questions.length }}
      </span>
    </div>

    <div v-if="isCloze" class="bank-box">
      <div style="font-size: 12.5px; color: var(--muted); margin-bottom: 6px;">词库（每个词最多用一次）</div>
      <div class="bank-list">
        <span v-for="b in parseOptions(questions[0].options)" :key="b" class="bank-chip">{{ b }}</span>
      </div>
    </div>

    <div v-for="qs in questions" :key="qs.id" class="qblock">
      <div class="qstem">
        <span>{{ qs.stem }}</span>
        <span v-if="showAnswer && qs.answer" class="qmark" :class="isRight(qs) ? 'ok' : 'no'">
          {{ isRight(qs) ? '✓ 正确' : '✗ 正确答案 ' + qs.answer }}
        </span>
      </div>

      <!-- 选词填空：下拉选择 -->
      <template v-if="isCloze">
        <select :value="answers[qs.id] || ''" :disabled="graded" @change="emit('pick', qs.id, $event.target.value)">
          <option value="">未选</option>
          <option v-for="o in parseOptions(qs.options)" :key="o" :value="o[0]">{{ o }}</option>
        </select>
      </template>

      <!-- 长篇阅读（段落匹配）：选项是段落字母，来自正文段落标记 -->
      <template v-else-if="isMatch">
        <div class="letter-row">
          <span class="letter-hint">对应段落：</span>
          <span
            v-for="L in letters"
            :key="L"
            class="qopt pick letter"
            :class="optClassByLetter(qs, L)"
            @click="emit('pick', qs.id, L)"
          >{{ L }}</span>
        </div>
      </template>

      <!-- 仔细阅读：A/B/C/D 选项 -->
      <template v-else>
        <div
          v-for="(opt, oi) in parseOptions(qs.options)"
          :key="oi"
          class="qopt pick"
          :class="optClass(qs, opt)"
          @click="emit('pick', qs.id, opt[0])"
        >{{ opt }}</div>
      </template>

      <div v-if="showAnswer && qs.answer" class="qanalysis">
        <b>正确答案：{{ qs.answer }}</b>
        <div style="margin-top: 4px;">{{ qs.analysis || '（暂无解析）' }}</div>
      </div>
    </div>

    <div v-if="!questions.length" style="font-size: 13px; color: var(--muted);">本篇没有客观题。</div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  passage: { type: Object, required: true },
  answers: { type: Object, default: () => ({}) },
  graded: { type: Boolean, default: false },     // 已交卷
  reveal: { type: Boolean, default: false },     // 主动「查看答案解析」
  letters: { type: Array, default: () => [] },   // 匹配题可用的段落字母
});
const emit = defineEmits(['pick']);

const questions = computed(() => (props.passage && props.passage.questions) || []);
const isCloze = computed(() => props.passage && props.passage.section === 'cloze');
const isMatch = computed(() => props.passage && props.passage.section === 'match');
const showAnswer = computed(() => props.graded || props.reveal);

const answeredCount = computed(() => questions.value.filter((q) => props.answers[q.id]).length);

// options 在库里存的是 JSON 字符串（如 '["A) adequate","B) ..."]'），必须解析后再用。
// 兼容三种形态：JSON 字符串 / 已是数组 / 换行分隔的纯文本，任何异常都回退为空数组（绝不抛错）。
function parseOptions(raw) {
  if (Array.isArray(raw)) return raw.map((o) => String(o).trim()).filter(Boolean);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map((o) => String(o).trim()).filter(Boolean);
    return [];
  } catch (e) {
    return String(raw).split('\n').map((s) => s.trim()).filter(Boolean);
  }
}
function isRight(qs) {
  return String(props.answers[qs.id] || '') === String(qs.answer || '');
}
function optClassByLetter(qs, letter) {
  const picked = String(props.answers[qs.id] || '');
  if (!showAnswer.value) return picked === letter ? 'picked' : '';
  if (letter === String(qs.answer || '')) return 'right';
  return picked === letter ? 'wrong' : '';
}
function optClass(qs, opt) {
  return optClassByLetter(qs, opt[0]);
}
</script>

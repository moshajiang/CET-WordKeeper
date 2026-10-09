<template>
  <div>
    <h1 class="page-title">生词本</h1>
    <p class="page-sub">每一个词，都带着你在真题里遇见它的那句话</p>

    <div class="filter-bar">
      <select v-model="filter.status">
        <option value="all">全部状态</option>
        <option value="learning">学习中</option>
        <option value="mastered">已掌握</option>
      </select>
      <input v-model="filter.search" placeholder="搜索单词或释义…" style="width: 220px;" />
      <select v-model="sortBy">
        <option value="time">按添加时间</option>
        <option value="hits">按真题出现次数</option>
        <option value="word">按字母</option>
      </select>
      <button class="primary" @click="$router.push('/review')">开始复习</button>
      <button @click="exportAnki" :disabled="!rows.length">导出 Anki</button>
    </div>
    <div v-if="ankiMsg" style="font-size: 13px; margin: -6px 0 12px;" :style="{ color: ankiOk ? '#2e7d4f' : 'var(--red)' }">{{ ankiMsg }}</div>

    <div class="card" style="padding: 8px 20px;">
      <table class="wtable" v-if="sorted.length">
        <tr>
          <th style="width: 130px;">单词</th>
          <th style="width: 110px;">音标</th>
          <th>释义</th>
          <th style="width: 70px;">真题出现</th>
          <th style="width: 80px;">状态</th>
          <th style="width: 100px;">下次复习</th>
        </tr>
        <tr v-for="w in sorted" :key="w.word">
          <td><span class="wword" @click="openDetail(w.word)">{{ w.word }}</span></td>
          <td style="color: var(--muted); font-size: 12.5px;">{{ w.phonetic ? '/' + w.phonetic + '/' : '' }}</td>
          <td style="max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ brief(w.translation) }}</td>
          <td>{{ w.hits }} 处</td>
          <td><span class="status-chip" :class="w.status">{{ w.status === 'learning' ? '学习中' : '已掌握' }}</span></td>
          <td style="font-size: 12.5px; color: var(--muted);">{{ dueText(w.due) }}</td>
        </tr>
      </table>
      <div v-else class="empty-state">
        <div class="big">📖</div>
        生词本还是空的。去<a @click="$router.push('/library')">真题库</a>读一篇文章，双击不认识的词即可加入。
      </div>
    </div>

    <template v-if="drawer.word">
      <div class="drawer-mask" @click="drawer.word = null"></div>
      <div class="drawer">
        <h3>{{ drawer.word }}</h3>
        <span v-if="drawer.data && drawer.data.entry && drawer.data.entry.phonetic" style="color: var(--muted);">/{{ drawer.data.entry.phonetic }}/</span>
        <div class="tags" style="margin-top: 6px;" v-if="drawer.data">
          <span v-for="t in drawerTags" :key="t.name" class="tagchip" :class="t.cls">{{ t.name }}</span>
        </div>
        <div v-if="drawer.data && drawer.data.entry" class="ai-result" style="margin-top: 10px;">{{ drawer.data.entry.translation || drawer.data.entry.definition || '（无释义）' }}</div>

        <div class="dsec" v-if="drawer.data">
          <h4>真题出处（{{ drawer.data.hits.length }}）</h4>
          <div v-for="(h, i) in drawer.data.hits" :key="i" class="hit-item">
            {{ h.sentence }}
            <div class="src" v-if="h.year">{{ h.level }} · {{ h.year }}.{{ h.month }} 第{{ h.set_no }}套 · {{ h.ptitle || '篇章' }}</div>
          </div>
          <div v-if="!drawer.data.hits.length" style="font-size: 13px; color: var(--muted);">暂无真题出处记录</div>
        </div>

        <div class="dsec">
          <h4>备注</h4>
          <textarea
            :value="drawer.data && drawer.data.userWord ? drawer.data.userWord.note : ''"
            @change="saveNote($event)"
            style="width: 100%; min-height: 70px; font-family: inherit; font-size: 13px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 7px; outline: none; resize: vertical;"
            placeholder="写下你对这个词的理解、联想或易混词…"
          ></textarea>
        </div>

        <div class="dsec" style="display: flex; gap: 10px;">
          <button v-if="drawerStatus === 'learning'" class="primary" style="flex: 1;" @click="markMastered">✓ 标记已掌握</button>
          <button v-else style="flex: 1;" @click="markLearning">↩ 重新学习</button>
          <button class="danger" @click="removeWord">删除</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';

const filter = ref({ status: 'all', search: '' });
const sortBy = ref('time');
const rows = ref([]);
const drawer = ref({ word: null, data: null });
const ankiMsg = ref('');
const ankiOk = ref(false);

async function exportAnki() {
  // 必须传普通对象：Vue 的响应式代理无法通过 IPC 的结构化克隆
  const r = await window.keeper.exportAnki({ ...filter.value });
  if (r.ok) { ankiOk.value = true; ankiMsg.value = `已导出 ${r.count} 个生词到 ${r.path}（Anki：文件→导入→选择该文件）`; }
  else if (r.canceled) { ankiMsg.value = ''; }
  else { ankiOk.value = false; ankiMsg.value = r.error === 'empty' ? '生词本为空，无法导出' : '导出失败：' + (r.error || '未知错误'); }
}

const sorted = computed(() => {
  let list = [...rows.value];
  if (sortBy.value === 'hits') list.sort((a, b) => (b.hits || 0) - (a.hits || 0));
  else if (sortBy.value === 'word') list.sort((a, b) => a.word.localeCompare(b.word));
  return list;
});

const drawerStatus = computed(() => (drawer.value.data && drawer.value.userWordStatus) || 'learning');

const drawerTags = computed(() => {
  const tags = (drawer.value.data && drawer.value.data.tags) || [];
  const out = [];
  if (tags.includes('cet4')) out.push({ name: '四级考纲', cls: 'lvl4' });
  if (tags.includes('cet6')) out.push({ name: '六级考纲', cls: 'lvl6' });
  if (tags.includes('ky')) out.push({ name: '考研', cls: '' });
  if (tags.includes('gre')) out.push({ name: 'GRE', cls: 'beyond' });
  if (tags.includes('toefl') || tags.includes('ielts')) out.push({ name: '托福/雅思', cls: 'beyond' });
  return out;
});

function brief(t) {
  if (!t) return '';
  return String(t).replace(/\n/g, '；').replace(/\s+/g, ' ');
}

function dueText(due) {
  if (!due) return '—';
  const d = new Date(due).getTime() - Date.now();
  if (d <= 0) return '现在';
  if (d < 3600000) return Math.ceil(d / 60000) + ' 分钟后';
  if (d < 86400000) return Math.ceil(d / 3600000) + ' 小时后';
  return Math.ceil(d / 86400000) + ' 天后';
}

async function load() {
  // 必须传普通对象：Vue 的响应式代理无法通过 IPC 的结构化克隆
  rows.value = await window.keeper.listWords({ ...filter.value });
}

async function openDetail(word) {
  drawer.value = { word, data: null };
  const data = await window.keeper.wordDetail(word);
  drawer.value = { word, data, userWordStatus: data.userWord ? data.userWord.status : 'learning' };
}

async function saveNote(ev) {
  await window.keeper.saveNote(drawer.value.word, ev.target.value);
}

async function markMastered() {
  await window.keeper.setWordStatus(drawer.value.word, 'mastered');
  drawer.value.userWordStatus = 'mastered';
  load();
}

async function markLearning() {
  await window.keeper.setWordStatus(drawer.value.word, 'learning');
  drawer.value.userWordStatus = 'learning';
  load();
}

async function removeWord() {
  await window.keeper.removeWord(drawer.value.word);
  drawer.value.word = null;
  load();
}

onMounted(load);
</script>

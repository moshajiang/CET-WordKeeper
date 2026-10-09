<template>
  <div>
    <h1 class="page-title">英语知识库</h1>
    <p class="page-sub">内置题型套路与语法结构 · 可添加自己的资料，AI 问答时会自动检索注入</p>

    <div class="card" style="margin-bottom: 14px;">
      <h3 style="font-size: 15px; margin-bottom: 4px;">内置条目 <span style="font-size: 11.5px; color: var(--muted); font-weight: 400;">只读 · 随软件分发</span></h3>
      <div class="hint" style="margin-bottom: 10px;">
        覆盖五大题型的做题套路与核心语法结构。在阅读器右侧「问 AI」提问时，命中的条目会自动作为上下文。
      </div>
      <div v-if="builtin.length" class="kb-grid">
        <span v-for="t in builtin" :key="t" class="tagchip">{{ t }}</span>
      </div>
      <div v-else style="color: var(--muted); font-size: 13px;">内置知识库未加载（data/knowledge 缺失）</div>
    </div>

    <div class="card">
      <h3 style="font-size: 15px; margin-bottom: 4px;">我的资料</h3>
      <div class="hint" style="margin-bottom: 10px;">
        添加你自己的笔记、错因总结、老师讲义等。提问内容与之相关时会被检索并注入给 AI。
      </div>

      <div v-if="userEntries.length" class="kb-user-list">
        <div v-for="e in userEntries" :key="e.id" class="kb-user-item">
          <div>
            <div style="font-weight: 500; font-size: 13.5px;">{{ e.title }}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">{{ e.preview }}…</div>
          </div>
          <button class="danger" @click="removeEntry(e.id)">删除</button>
        </div>
      </div>
      <div v-else style="color: var(--muted); font-size: 13px; margin-bottom: 6px;">还没有自己的条目</div>

      <div style="margin-top: 14px; border-top: 1px solid var(--border, #e5e2da); padding-top: 14px;">
        <label style="font-size: 12.5px; color: var(--muted);">标题</label>
        <input v-model="draft.title" placeholder="例如：我的阅读错因总结" style="margin-bottom: 8px;" />
        <label style="font-size: 12.5px; color: var(--muted);">内容</label>
        <textarea v-model="draft.content" rows="4" placeholder="写下想长期保留的笔记内容，AI 问答时会按相关度自动引用"></textarea>
        <div style="margin-top: 10px; display: flex; gap: 10px; align-items: center;">
          <button class="primary" @click="addEntry">添加条目</button>
          <span v-if="msg" style="font-size: 13px;" :style="{ color: msgOk ? '#2e7d4f' : 'var(--red)' }">{{ msg }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const builtin = ref([]);
const userEntries = ref([]);
const draft = ref({ title: '', content: '' });
const msg = ref('');
const msgOk = ref(false);

async function reload() {
  const r = await window.keeper.kbList();
  builtin.value = r.builtin || [];
  userEntries.value = r.user || [];
}

async function addEntry() {
  if (!draft.value.title.trim() || !draft.value.content.trim()) {
    msg.value = '标题和内容都要填';
    msgOk.value = false;
    return;
  }
  const r = await window.keeper.kbAdd(draft.value.title, draft.value.content);
  if (r.ok) {
    draft.value = { title: '', content: '' };
    msg.value = '已添加';
    msgOk.value = true;
    await reload();
  } else {
    msg.value = '添加失败：' + r.error;
    msgOk.value = false;
  }
  setTimeout(() => (msg.value = ''), 1800);
}

async function removeEntry(id) {
  await window.keeper.kbRemove(id);
  await reload();
}

onMounted(reload);
</script>

<style scoped>
.hint { font-size: 12px; color: var(--muted); }
.kb-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.kb-grid .tagchip { font-size: 12.5px; }
.kb-user-list { display: flex; flex-direction: column; gap: 8px; }
.kb-user-item {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; background: var(--bg);
}
.kb-user-item button { font-size: 12px; padding: 3px 10px; flex-shrink: 0; }
input, textarea {
  width: 100%; font-family: inherit; font-size: 13.5px; padding: 8px 10px;
  border-radius: 8px; border: 1px solid var(--border);
}
textarea { resize: vertical; line-height: 1.7; }
label { display: block; margin-bottom: 4px; }
</style>

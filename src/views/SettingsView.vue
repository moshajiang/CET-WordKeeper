<template>
  <div>
    <h1 class="page-title">设置</h1>
    <p class="page-sub">AI 服务、复习节奏与数据管理</p>

    <div class="card settings-form">
      <h3 style="font-size: 15px; margin-bottom: 4px;">AI 服务（整句翻译 / 语法分析 / 错因分析）</h3>
      <div class="hint" style="margin-bottom: 10px;">不配置也不影响查词、标注、复习等核心功能（100% 离线）。支持 OpenAI 兼容协议。</div>
      <label>API 地址（Base URL）</label>
      <input v-model="form.api_base" placeholder="例如 https://api.deepseek.com/v1" />
      <label>API Key</label>
      <input v-model="form.api_key" type="password" placeholder="sk-..." />
      <label>模型名称</label>
      <input v-model="form.api_model" placeholder="例如 deepseek-chat" />
      <div style="margin-top: 14px; display: flex; gap: 10px;">
        <button class="primary" @click="save">保存</button>
        <button @click="testConn" :disabled="testing">{{ testing ? '测试中…' : '测试连接' }}</button>
        <span v-if="testMsg" style="font-size: 13px; align-self: center;" :style="{ color: testOk ? '#2e7d4f' : 'var(--red)' }">{{ testMsg }}</span>
      </div>
    </div>

    <div class="card settings-form">
      <h3 style="font-size: 15px; margin-bottom: 4px;">导入自定义真题</h3>
      <div class="hint" style="margin-bottom: 10px;">
        选择 JSON 文件导入你自己的真题或学习材料（含更早年份、模拟题、考研阅读等），与内置真题同权，支持全部标注与预扫功能。
      </div>
      <div style="font-size: 12.5px; color: var(--muted); background: var(--bg); border-radius: 8px; padding: 12px 14px; line-height: 1.8;">
        格式：<code>{ "level": "CET6", "year": 2023, "month": 12, "set_no": 1,<br>
        &nbsp;&nbsp;"passages": [{ "section": "reading", "seq": 1, "content": "文章全文…",<br>
        &nbsp;&nbsp;&nbsp;&nbsp;"questions": [{ "stem": "题干", "options": ["A. …","B. …"], "answer": "A", "analysis": "解析" }] }] }</code>
      </div>
      <div style="margin-top: 14px; display: flex; gap: 10px; align-items: center;">
        <button class="primary" @click="pickImport">选择 JSON 文件导入</button>
        <span v-if="importMsg" style="font-size: 13px;" :style="{ color: importOk ? '#2e7d4f' : 'var(--red)' }">{{ importMsg }}</span>
      </div>
      <input ref="fileInput" type="file" accept=".json" style="display: none;" @change="doImport" />
    </div>

    <div class="card settings-form">
      <h3 style="font-size: 15px; margin-bottom: 4px;">数据</h3>
      <div class="hint" style="margin-bottom: 10px;">全部数据存储于本地单文件 keeper.db，备份即复制。</div>
      <button @click="backup">备份到…</button>
      <div v-if="backupMsg" style="font-size: 13px; color: #2e7d4f; margin-top: 8px;">{{ backupMsg }}</div>
    </div>

    <div class="card settings-form">
      <h3 style="font-size: 15px; margin-bottom: 4px;">版本更新</h3>
      <div class="hint" style="margin-bottom: 10px;">
        当前版本 v{{ upd.current || '…' }}<span v-if="upd.portable">（便携版）</span> · 新版本发布在 GitHub Releases
      </div>
      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
        <button class="primary" @click="checkUpdate" :disabled="upd.phase === 'checking' || upd.phase === 'downloading'">
          {{ upd.phase === 'checking' ? '正在检查…' : '检查更新' }}
        </button>
        <button v-if="upd.phase === 'downloaded'" class="primary" @click="installUpdate">立即安装并重启</button>
        <button v-if="upd.phase === 'available'" @click="openReleases">前往下载 v{{ upd.latest }}</button>
        <button v-if="upd.phase === 'not-available' || upd.phase === 'error'" @click="openReleases">打开发布页</button>
      </div>
      <div v-if="upd.phase === 'downloading'" style="margin-top: 12px;">
        <div class="review-progress"><div class="fill" :style="{ width: (upd.percent || 0) + '%' }"></div></div>
        <div class="hint">正在下载 v{{ upd.latest }}… {{ upd.percent || 0 }}%（{{ upd.mbPerSecond || 0 }} MB/s）</div>
      </div>
      <div v-if="upd.phase === 'downloaded'" class="hint" style="color: #2e7d4f; margin-top: 8px;">
        新版本 v{{ upd.latest }} 已就绪，点「立即安装并重启」完成更新（词库与学习数据都会保留）。
      </div>
      <div v-if="upd.phase === 'not-available'" class="hint" style="margin-top: 8px;">已是最新版本 ✓</div>
      <div v-if="upd.phase === 'available'" class="hint" style="margin-top: 8px;">
        发现新版本 v{{ upd.latest }}：便携版无法应用内自更新，点「前往下载」获取新文件替换即可（keeper.db 数据不受影响）。
      </div>
      <div v-if="upd.phase === 'error'" class="hint" style="color: var(--red); margin-top: 8px;">检查失败：{{ upd.error }}（请检查网络后重试）</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';

const form = ref({ api_base: '', api_key: '', api_model: '' });
const testing = ref(false);
const testMsg = ref('');
const testOk = ref(false);
const importMsg = ref('');
const importOk = ref(false);
const backupMsg = ref('');
const fileInput = ref(null);

onMounted(async () => {
  const s = await window.keeper.getSettings();
  form.value = {
    api_base: s.api_base || '',
    api_key: s.api_key || '',
    api_model: s.api_model || 'deepseek-chat',
  };
  // 版本更新：恢复当前状态并订阅主进程的更新事件推送
  try {
    const st = await window.keeper.updateState();
    upd.value = { ...upd.value, ...st };
    if (window.keeper.onUpdateEvent) offUpd = window.keeper.onUpdateEvent((d) => { upd.value = { ...upd.value, ...d }; });
  } catch (e) { /* 更新模块不可用时静默 */ }
});

onBeforeUnmount(() => { if (offUpd) offUpd(); });

// ---- 版本更新 ----
const upd = ref({ phase: 'idle', current: '', latest: null, percent: 0, portable: false });
let offUpd = null;

async function checkUpdate() {
  upd.value = { ...upd.value, phase: 'checking', error: null };
  const r = await window.keeper.updateCheck();
  upd.value = { ...upd.value, ...r };
}

async function installUpdate() {
  const r = await window.keeper.updateInstall();
  if (!r.ok) upd.value = { ...upd.value, phase: 'error', error: r.error || '安装失败' };
}

function openReleases() { window.keeper.updateOpenReleases(); }

async function save() {
  // 必须传普通对象：Vue 的响应式代理无法通过 IPC 的结构化克隆
  await window.keeper.setSettings({ ...form.value });
  testMsg.value = '已保存';
  testOk.value = true;
  setTimeout(() => (testMsg.value = ''), 1500);
}

async function testConn() {
  testing.value = true;
  testMsg.value = '';
  // 必须传普通对象：Vue 的响应式代理无法通过 IPC 的结构化克隆
  await window.keeper.setSettings({ ...form.value });
  const r = await window.keeper.translate('Hello, this is a connection test.');
  testing.value = false;
  if (r.ok) { testOk.value = true; testMsg.value = '连接成功：' + (r.response.content || '').slice(0, 40); }
  else if (r.error === 'no_key') { testOk.value = false; testMsg.value = '请先填写 API 地址与 Key'; }
  else { testOk.value = false; testMsg.value = '失败：' + r.error; }
}

function pickImport() {
  fileInput.value.click();
}

async function doImport(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const r = await window.keeper.importExam(text);
    if (r.ok) { importOk.value = true; importMsg.value = '导入成功！已加入真题库（我的导入）'; }
    else if (r.error === 'duplicate') { importOk.value = true; importMsg.value = '该套题已存在，无需重复导入。'; }
    else { importOk.value = false; importMsg.value = '导入失败：' + (r.error || '未知错误'); }
  } catch (e) {
    importOk.value = false;
    importMsg.value = '文件解析失败：' + e.message;
  }
  ev.target.value = '';
}

async function backup() {
  const r = await window.keeper.backupDialog();
  backupMsg.value = r.ok ? '已备份到 ' + r.path : '已取消';
}
</script>

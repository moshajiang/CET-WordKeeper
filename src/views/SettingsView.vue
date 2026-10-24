<template>
  <div>
    <h1 class="page-title">设置</h1>
    <p class="page-sub">AI 服务、复习节奏与数据管理</p>

    <ReviewPreferences />

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
        <button v-if="testing" @click="cancelProbe">取消测试</button>
        <span v-if="testMsg" style="font-size: 13px; align-self: center;" :style="{ color: testOk ? '#2e7d4f' : 'var(--red)' }">{{ testMsg }}</span>
      </div>
      <div class="hint" style="margin-top: 8px;">测试连接使用当前填写的配置，点击「保存」后才会用于 AI 请求。</div>
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
      <h3 style="font-size: 15px; margin-bottom: 4px;">外观</h3>
      <div class="hint" style="margin-bottom: 10px;">夜间模式适合晚上刷题，重启后保持。</div>
      <button @click="toggleTheme">{{ isDark ? '☀ 切换为浅色模式' : '🌙 切换为夜间模式' }}</button>
    </div>

    <div class="card settings-form">
      <h3 style="font-size: 15px; margin-bottom: 4px;">数据</h3>
      <div class="hint" style="margin-bottom: 10px;">备份包含词库、学习记录与 AI 配置（含 Key），请妥善保存。恢复会替换当前数据并重启软件。</div>
      <div style="display: flex; gap: 10px;">
        <button @click="backup" :disabled="dataBusy || restarting">备份到…</button>
        <button @click="previewRestore" :disabled="dataBusy || restarting">选择备份恢复…</button>
      </div>
      <div v-if="restorePreview" class="hint" style="margin-top: 12px; background: var(--bg); padding: 12px; border-radius: 8px;">
        <div style="overflow-wrap: anywhere;">已校验：{{ restorePreview.path }}</div>
        <div>{{ restorePreview.counts.exam }} 套材料 · {{ restorePreview.counts.user_word }} 个生词 · {{ restorePreview.counts.review_log }} 条复习 · {{ restorePreview.counts.attempt }} 次作答 · {{ restorePreview.counts.essay }} 篇作文/翻译草稿</div>
        <div>确认后将替换当前学习数据和 AI 配置；系统会先保存恢复前备份。原窗口的未完成请求会随重启结束。</div>
        <div style="display: flex; gap: 10px; margin-top: 10px;">
          <button class="primary" @click="confirmRestore" :disabled="dataBusy || restarting">确认恢复并重启</button>
          <button @click="cancelRestore" :disabled="dataBusy || restarting">取消</button>
        </div>
      </div>
      <div v-if="restoreState?.status === 'restored'" class="hint" style="margin-top: 8px; overflow-wrap: anywhere;">已恢复备份。恢复前的数据保留在：{{ restoreState.backupPath }}</div>
      <div v-if="restoreState?.status === 'failed'" class="hint" style="color: var(--red); margin-top: 8px; overflow-wrap: anywhere;">恢复未完成，已退回恢复前数据：{{ restoreState.error }}。保留的备份：{{ restoreState.backupPath }}</div>
      <div v-if="contentSync?.status === 'error'" class="hint" style="color: var(--red); margin-top: 8px;">内置内容更新未保存，已保留更新前内容。重启后会重试：{{ contentSync.error }}</div>
      <div v-if="contentSync?.backupPath" class="hint" style="margin-top: 8px;">更新前的数据库已自动备份：{{ contentSync.backupPath }}</div>
      <div v-if="contentSync?.issues" class="hint" style="margin-top: 8px;">部分旧内容身份重复，已保留原记录并归档，当前显示内置修正版。</div>
      <div v-if="backupMsg" style="font-size: 13px; margin-top: 8px; overflow-wrap: anywhere;" :style="{color:backupOk ? '#2e7d4f' : 'var(--red)'}">{{ backupMsg }}</div>
    </div>

    <div class="card settings-form">
      <h3 style="font-size: 15px; margin-bottom: 4px;">版本更新</h3>
      <div class="hint" style="margin-bottom: 10px;">
        当前版本 v{{ upd.current || '…' }}<span v-if="upd.portable">（便携版）</span> · 支持 GitHub / 码云 Releases
      </div>
      <label for="update-source">更新来源</label>
      <select id="update-source" v-model="updateSource" @change="changeUpdateSource" :disabled="['checking', 'downloading', 'downloaded'].includes(upd.phase)" style="margin-bottom: 10px;">
        <option value="github">GitHub</option>
        <option value="gitee">码云 Gitee</option>
      </select>
      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
        <button class="primary" @click="checkUpdate" :disabled="['checking', 'downloading', 'downloaded'].includes(upd.phase)">
          {{ upd.phase === 'checking' ? '正在检查…' : '检查更新' }}
        </button>
        <button v-if="upd.phase === 'downloaded'" class="primary" @click="installUpdate">立即安装并重启</button>
        <button v-if="upd.phase === 'available'" @click="openReleases">前往下载 v{{ upd.latest }}</button>
        <button @click="openReleases">打开{{ updateSource === 'gitee' ? '码云' : 'GitHub' }}发布页</button>
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
      <div v-if="upd.phase === 'error'" class="hint" style="color: var(--red); margin-top: 8px;">检查失败：{{ upd.error }}（可重试或切换更新来源）</div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import ReviewPreferences from '../components/ReviewPreferences.vue';
import { createAiTasks } from '../utils/ai-tasks.js';

const form = ref({ api_base: '', api_key: '', api_model: '' });
const testing = ref(false);
const testMsg = ref('');
const testOk = ref(false);
const aiTasks = createAiTasks(id => window.keeper.cancelAi?.(id));
let configVersion = 0, disposed = false;
watch(form,() => { aiTasks.cancel('probe'); testing.value = false; ++configVersion; testMsg.value = ''; testOk.value = false; },{deep:true,flush:'sync'});
const importMsg = ref('');
const importOk = ref(false);
const backupMsg = ref('');
const backupOk = ref(false), dataBusy = ref(false), restarting = ref(false);
const restorePreview = ref(null), restoreState = ref(null);
const contentSync = ref(null);
const fileInput = ref(null);

onMounted(async () => {
  const info = await window.keeper.info();
  contentSync.value = info.contentSync; restoreState.value = info.restore;
  const s = await window.keeper.getSettings();
  form.value = {
    api_base: s.api_base || '',
    api_key: s.api_key || '',
    api_model: s.api_model || 'deepseek-chat',
  };
  // 版本更新：恢复当前状态并订阅主进程的更新事件推送
  isDark.value = localStorage.getItem('keeper.theme') === 'dark';
  try {
    if (disposed) return;
    if (window.keeper.onUpdateEvent) offUpd = window.keeper.onUpdateEvent(receiveUpdate);
    const st = await window.keeper.updateState();
    if (disposed) return;
    receiveUpdate(st);
    if (['checking', 'downloading', 'downloaded'].includes(upd.value.phase)) updateSource.value = upd.value.source;
    else { try { const saved = localStorage.getItem('keeper.update.source'); if (['github','gitee'].includes(saved)) updateSource.value = saved; } catch {} }
  } catch (e) { /* 更新模块不可用时静默 */ }
});

onBeforeUnmount(() => { aiTasks.cancelAll(); if (restorePreview.value && !restarting.value) window.keeper.restoreCancel(); disposed = true; ++configVersion; if (offUpd) offUpd(); });

// ---- 版本更新 ----
const upd = ref({ phase: 'idle', current: '', latest: null, percent: 0, portable: false, source: 'github', revision: 0 });
const updateSource = ref('github');
let offUpd = null;

// ---- 外观：夜间模式 ----
const isDark = ref(false);

function toggleTheme() {
  isDark.value = !isDark.value;
  localStorage.setItem('keeper.theme', isDark.value ? 'dark' : 'light');
  document.documentElement.classList.toggle('dark', isDark.value);
}

function receiveUpdate(value) {
  if (disposed || (value.revision ?? 0) < (upd.value.revision ?? 0)) return;
  upd.value = { ...upd.value, ...value };
}
function changeUpdateSource() {
  try { localStorage.setItem('keeper.update.source', updateSource.value); } catch {}
  upd.value = { ...upd.value, phase: 'idle', source: updateSource.value, error: null, latest: null, percent: 0 };
}
async function checkUpdate() {
  if (['checking', 'downloading', 'downloaded'].includes(upd.value.phase)) return;
  upd.value = { ...upd.value, phase: 'checking', source: updateSource.value, error: null };
  try { receiveUpdate(await window.keeper.updateCheck(updateSource.value)); }
  catch (error) { if (!disposed) upd.value = { ...upd.value, phase: 'error', error: String(error.message || error) }; }
}

async function installUpdate() {
  try {
    const r = await window.keeper.updateInstall();
    if (!r.ok) throw Error(r.error || '安装失败');
  } catch (error) { if (!disposed) upd.value = { ...upd.value, phase: 'error', error: String(error.message || error) }; }
}

async function openReleases() {
  try {
    const result = await window.keeper.updateOpenReleases(updateSource.value);
    if (result?.ok === false) throw Error(result.error);
  } catch (error) { if (!disposed) upd.value = { ...upd.value, phase: 'error', error: String(error.message || error) }; }
}

async function save() {
  // 必须传普通对象：Vue 的响应式代理无法通过 IPC 的结构化克隆
  await window.keeper.setSettings({ ...form.value });
  testMsg.value = '已保存';
  testOk.value = true;
  setTimeout(() => (testMsg.value = ''), 1500);
}

async function testConn() {
  if (testing.value) return;
  const version = configVersion, settings = {...form.value}, task = aiTasks.start('probe');
  testing.value = true;
  testMsg.value = '';
  let r;
  try { r = await window.keeper.testConnection(settings,task.id); }
  catch (error) { r = {ok:false,error:error.message}; }
  finally { if (task.isCurrent()) testing.value = false; }
  if (!task.isCurrent()) return;
  task.finish();
  if (disposed || version !== configVersion) return;
  if (r.ok) { testOk.value = true; testMsg.value = '连接成功：' + (r.response.content || '').slice(0, 40); }
  else if (r.error === 'no_key') { testOk.value = false; testMsg.value = '请先填写 API 地址与 Key'; }
  else if (r.error === 'bad_base') { testOk.value = false; testMsg.value = 'API 地址应为有效的 HTTP 或 HTTPS 地址'; }
  else if (r.error === 'timeout') { testOk.value = false; testMsg.value = '连接超时，请检查地址和网络后重试'; }
  else { testOk.value = false; testMsg.value = r.error === 'cancelled' ? '已取消测试' : '失败：' + r.error; }
}

function cancelProbe() { aiTasks.cancel('probe'); testing.value = false; testOk.value = false; testMsg.value = '已取消测试'; }

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

async function dataAction(action) {
  if (dataBusy.value || restarting.value) return;
  dataBusy.value = true; backupMsg.value = '';
  try { await action(); }
  catch (error) { backupOk.value = false; backupMsg.value = error.message; }
  finally { dataBusy.value = false; }
}
async function backup() {
  await dataAction(async () => {
    const r = await window.keeper.backupDialog();
    backupOk.value = !!r.ok;
    backupMsg.value = r.ok ? '已备份到 '+r.path : r.canceled ? '已取消' : '备份失败：'+r.error;
  });
}
async function previewRestore() {
  await dataAction(async () => {
    restorePreview.value = null;
    const r = await window.keeper.restorePreview();
    if (disposed) { await window.keeper.restoreCancel(); return; }
    if (r.ok) restorePreview.value = r;
    else if (!r.canceled) { backupOk.value = false; backupMsg.value = r.error; }
  });
}
async function cancelRestore() {
  await window.keeper.restoreCancel(); restorePreview.value = null;
}
async function confirmRestore() {
  if (!restorePreview.value) return;
  await dataAction(async () => {
    const r = await window.keeper.restoreCommit(restorePreview.value.token);
    backupOk.value = !!r.ok;
    if (r.ok) { restarting.value = true; backupMsg.value = '正在重启恢复，恢复前备份：'+r.backupPath; }
    else backupMsg.value = '恢复失败：'+r.error;
  });
}
</script>

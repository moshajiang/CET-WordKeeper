<template>
 <aside v-if="visible" class="update-notice" aria-label="版本更新提醒" role="status" aria-live="polite">
  <strong>{{ state.phase==='downloaded'?'新版本已准备好':state.phase==='downloading'?'正在下载更新':state.phase==='error'?'更新下载未完成':'发现新版本' }} <span>v{{ state.latest }}</span></strong>
  <p v-if="state.phase==='downloading'">已下载 {{ state.percent||0 }}%，可继续使用软件。</p>
  <p v-else-if="state.phase==='downloaded'">点击安装后会关闭并重启软件，请先保存当前内容。</p>
  <p v-else-if="state.phase==='error'">下载失败，可重试或打开发版页面。</p>
  <p v-else>{{ state.portable?'便携版请前往发布页下载新版文件。':'已有新版可用，下载由你决定。' }} 来源：{{ state.source==='gitee'?'码云':'GitHub' }}。</p>
  <div class="notice-actions"><button v-if="state.phase==='downloaded'" class="primary" :disabled="busy" @click="install">安装并重启</button><button v-else-if="state.canDownload" class="primary" :disabled="busy" @click="download">{{ state.phase==='error'?'重试下载':'下载更新' }}</button><button v-else-if="state.portable" class="primary" :disabled="busy" @click="open">前往下载</button><button v-if="!state.portable&&state.phase!=='downloading'" :disabled="busy" @click="open">查看发布页</button><button :disabled="busy" @click="dismiss('later')">稍后提醒</button><button v-if="state.phase==='available'" :disabled="busy" @click="dismiss('skip')">跳过此版本</button></div>
  <p v-if="error" role="alert">{{ error }}</p>
 </aside>
</template>
<script setup>
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
const state=ref({phase:'idle',revision:0}),busy=ref(false),error=ref(''),visible=computed(()=>!!state.value.showReminder);let disposed=false,off;
function receive(value){if(disposed||!value||(value.revision??0)<(state.value.revision??0))return;state.value={...state.value,...value};}
async function run(work){if(busy.value)return;busy.value=true;error.value='';try{const r=await work();if(disposed)return;if(r?.ok===false)throw Error(r.error||'更新操作未完成');if(r?.phase)receive(r);}catch(e){if(!disposed)error.value=e.message;}finally{if(!disposed)busy.value=false;}}
function download(){return run(()=>window.keeper.updateDownload());}function install(){return run(()=>window.keeper.updateInstall());}function open(){return run(()=>window.keeper.updateOpenReleases(state.value.source));}function dismiss(action){return run(()=>window.keeper.updateDismiss(action));}
onMounted(async()=>{try{off=window.keeper.onUpdateEvent?.(receive);const initial=await window.keeper.updateState();receive(initial);if(disposed)return;if(initial.automatic&&!initial.automatic.configured&&window.keeper.updatePreferences){let source;try{const saved=localStorage.getItem('keeper.update.source');if(['github','gitee'].includes(saved))source=saved;}catch{}receive(await window.keeper.updatePreferences(source?{source}:{}));}}catch{ /* Manual settings remain usable if background state is unavailable. */ }});
onBeforeUnmount(()=>{disposed=true;off?.();});
</script>
<style scoped>.update-notice{position:fixed;right:24px;bottom:94px;width:370px;max-width:calc(100vw - 40px);z-index:140;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:0 10px 36px #0002;font-size:13px;overflow-wrap:anywhere}.update-notice strong{font-size:15px}.update-notice strong span{color:var(--accent)}.update-notice p{line-height:1.7;color:var(--muted);margin:10px 0}.notice-actions{display:flex;gap:8px;flex-wrap:wrap}.notice-actions button{font-size:12px}.update-notice [role=alert]{color:var(--red)}</style>

<template>
 <section class="automatic-update-settings" aria-label="自动更新检查设置">
  <label><input aria-label="自动检查并提醒新版本" type="checkbox" :checked="automatic.enabled!==false" :disabled="busy||!state.automatic" @change="change" /> 自动检查并提醒新版本</label>
  <p>启动后自动检查，运行期间约每 6 小时检查一次；只检查版本，不自动下载或重启。首选源失败时尝试另一个来源。</p>
  <p v-if="automatic.packaged===false">开发环境不发起自动检查，可使用下方手动检查。</p>
  <p v-if="automatic.lastAttemptAt">上次自动检查：{{ date(automatic.lastAttemptAt) }}<template v-if="automatic.lastSource"> · {{ automatic.lastSource==='gitee'?'码云':'GitHub' }}</template></p><p v-if="automatic.nextCheckAt&&automatic.enabled">下次自动检查：{{ date(automatic.nextCheckAt) }}</p>
  <p v-if="automatic.skippedVersion">已跳过 v{{ automatic.skippedVersion }} 的自动提醒，手动检查仍可下载。</p><p v-if="automatic.error" role="alert">{{ automatic.error }}</p><p v-if="error" role="alert">{{ error }}</p>
 </section>
</template>
<script setup>
import {computed,ref,onBeforeUnmount} from 'vue';
const props=defineProps({state:{type:Object,required:true}}),emit=defineEmits(['changed']),automatic=computed(()=>props.state.automatic||{}),busy=ref(false),error=ref('');
const date=value=>new Date(value).toLocaleString();
let disposed=false;onBeforeUnmount(()=>{disposed=true;});
async function change(event){const enabled=event.target.checked;busy.value=true;error.value='';try{const r=await window.keeper.updatePreferences({enabled});if(disposed)return;if(!r.ok)throw Error(r.error);emit('changed',r);}catch(e){if(disposed)return;event.target.checked=automatic.value.enabled!==false;error.value='设置未保存：'+e.message;}finally{if(!disposed)busy.value=false;}}
</script>
<style scoped>.automatic-update-settings{margin:10px 0 16px;padding:12px;background:var(--bg);border-radius:8px;font-size:12px}.automatic-update-settings label{display:flex!important;align-items:center;gap:8px;font-size:13px}.automatic-update-settings input{width:auto!important;margin:0!important}.automatic-update-settings p{color:var(--muted);line-height:1.7;margin:6px 0}.automatic-update-settings [role=alert]{color:var(--red)}</style>

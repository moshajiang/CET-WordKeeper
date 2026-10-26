<template>
 <section class="phrase-suggestion" aria-label="AI 此处释义建议">
  <div class="suggestion-actions"><button type="button" :disabled="disabled||busy" @click="generate">{{ result?'重新生成 AI 释义':'AI 建议此处释义' }}</button><button v-if="busy" type="button" @click="stop">停止生成</button></div>
  <p v-if="busy" role="status">正在根据此处原文生成，现有草稿会保留…</p>
  <p v-else class="suggestion-hint">主动点击才会向已配置的 AI 发送此处表达、上下文和出处；可继续手动填写。</p>
  <p v-if="error" role="alert">{{ error }}<RouterLink v-if="noKey" to="/settings">前往 AI 设置</RouterLink></p><p v-if="notice" role="status">{{ notice }}</p>
  <section v-if="result" class="suggestion-results"><h3>AI 候选 · 待你确认</h3><p>{{ result.model }} · {{ result.source.label }}<template v-if="result.source.status!=='current'"> · 使用收藏时的旧上下文</template></p>
   <article v-for="(c,index) in result.candidates" :key="index" class="suggestion-candidate"><strong>{{ c.meaning }}</strong><p>{{ c.explanation }}</p><blockquote>{{ c.evidence }}</blockquote><button type="button" :disabled="disabled||busy" @click="adopt(index)">采用此候选到释义草稿</button></article>
   <button type="button" :disabled="disabled||busy" @click="result=null">收起候选</button>
  </section>
  <p v-if="adopted" class="suggestion-adopted" role="status">草稿已采用 AI 建议，可继续修改；尚未保存。<button type="button" :disabled="disabled" @click="$emit('clear')">保留文字，改为手动编辑</button></p>
 </section>
</template>
<script setup>
import {ref,watch,onBeforeUnmount} from 'vue';import {createAiTasks} from '../utils/ai-tasks.js';
const props=defineProps({target:{type:Object,required:true},disabled:Boolean,adopted:Boolean}),emit=defineEmits(['adopt','clear']),busy=ref(false),result=ref(null),error=ref(''),notice=ref(''),noKey=ref(false),tasks=createAiTasks(id=>window.keeper.cancelAi(id));let disposed=false;
const clean=v=>JSON.parse(JSON.stringify(v));
function stop(){tasks.cancel('meaning');busy.value=false;notice.value='已停止生成，现有草稿保留。';}
async function generate(){if(busy.value||props.disabled)return;const task=tasks.start('meaning');busy.value=true;error.value='';notice.value='';noKey.value=false;result.value=null;try{const r=await window.keeper.phraseSuggest(clean(props.target),task.id);if(disposed||!task.isCurrent())return;if(!r.ok){noKey.value=['no_key','api_401','bad_base'].includes(r.error);throw Error(({api_401:'AI 凭据无效，请检查设置；手动草稿保留。',api_429:'AI 请求过于频繁或额度不足，请稍后重试。',bad_base:'AI 服务地址无效，请检查设置。',bad_response:'AI 返回了空结果，请重试或手动填写。',no_key:'请先在设置中配置 AI；也可以直接手动填写。',cancelled:'生成已取消。',timeout:'生成超时，请重试；手动草稿保留。',bad_json:'AI 返回格式无法读取，请重试或手动填写。'})[r.error]||(/^api_\d+$/.test(r.error)?'AI 服务暂时不可用（'+r.error.slice(4)+'），请稍后重试。':r.error.startsWith('network:')?'网络连接失败，请检查网络或 AI 服务地址；手动草稿保留。':r.error));}result.value=r;}catch(e){if(!disposed&&task.isCurrent())error.value='未生成建议：'+e.message;}finally{if(!disposed&&task.isCurrent())busy.value=false;task.finish();}}
function adopt(index){if(props.disabled||busy.value||!result.value)return;emit('adopt',{meaning:result.value.candidates[index].meaning,proof:{token:result.value.token,index}});notice.value='已填入释义草稿，请核对后保存。';}
watch(()=>JSON.stringify(props.target),()=>{stop();result.value=null;error.value='';notice.value='';noKey.value=false;});onBeforeUnmount(()=>{disposed=true;tasks.cancelAll();});
</script>
<style scoped>.phrase-suggestion{margin:14px 0;padding:12px;border:1px solid var(--border);border-radius:8px;line-height:1.7;overflow-wrap:anywhere}.suggestion-actions{display:flex;gap:8px;flex-wrap:wrap}.phrase-suggestion p{font-size:12px;margin:8px 0;color:var(--muted)}.suggestion-results h3{font-size:14px}.suggestion-candidate{padding:12px;margin:10px 0;background:var(--accent-soft);border-radius:6px}.suggestion-candidate blockquote{white-space:pre-wrap;margin:10px 0;font:14px/1.8 Georgia,serif}.phrase-suggestion [role=alert]{color:var(--red)}.suggestion-adopted button{margin-left:8px}</style>

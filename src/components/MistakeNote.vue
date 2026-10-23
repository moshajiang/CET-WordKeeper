<template>
 <div class="mistake-note">
  <button @click="toggle">{{ opened?'收起错因整理':'整理本题错因' }}</button>
  <section v-if="opened" class="mistake-editor">
   <label>错因<select v-model="cause" aria-label="错题原因"><option v-for="c in causes" :key="c">{{ c }}</option></select></label>
   <label>关联知识<select v-model="entryKey" aria-label="关联知识点"><option value="">暂不关联</option><option v-for="e in entries" :key="e.key" :value="e.key">{{ e.title }}</option></select></label>
   <label>证据与改进方法<textarea v-model="note" rows="3" maxlength="5000" aria-label="错题复盘" placeholder="原文依据是什么？选项改变了哪个条件？下次先检查什么？" /></label>
   <div><button @click="save" :disabled="loading||saving">保存复盘</button><button @click="suggest" :disabled="loading||busy">{{ busy?'正在分析…':'AI 建议错因' }}</button><button v-if="busy" @click="stop">停止</button><button v-if="entryKey" @click="practice">同类知识练习</button></div>
   <p v-if="notice" role="status">{{ notice }}</p><KnowledgePractice v-if="practiceEntry" :entry="practiceEntry" />
  </section>
 </div>
</template>
<script setup>
import {ref,computed,watch,onBeforeUnmount} from 'vue';import {onBeforeRouteLeave} from 'vue-router';import KnowledgePractice from './KnowledgePractice.vue';import {createAiTasks} from '../utils/ai-tasks.js';
const props=defineProps({questionId:Number});const opened=ref(false),causes=ref([]),cause=ref('其他'),entryKey=ref(''),entries=ref([]),note=ref(''),notice=ref(''),loading=ref(false),saving=ref(false),busy=ref(false),practiceEntry=ref(null);
const tasks=createAiTasks(id=>window.keeper.cancelAi(id));let sequence=0,disposed=false;const baseline=ref('');const serialized=()=>JSON.stringify([cause.value,entryKey.value,note.value]);const dirty=computed(()=>opened.value&&!!baseline.value&&serialized()!==baseline.value);onBeforeRouteLeave(()=>!saving.value&&(!dirty.value||window.confirm('错题复盘尚未保存，确定离开？')));
function stop(){tasks.cancel('cause');busy.value=false;}
async function toggle(){if(opened.value&&dirty.value&&!window.confirm('错题复盘尚未保存，确定收起？'))return;opened.value=!opened.value;if(!opened.value)return;const id=props.questionId,version=++sequence;loading.value=true;try{const [r,list]=await Promise.all([window.keeper.studyMistakeGet(id),window.keeper.kbSearch({})]);if(disposed||version!==sequence)return;causes.value=r.causes;cause.value=r.note?.cause||'其他';entryKey.value=r.note?.entry_key||'';note.value=r.note?.note||'';entries.value=list.entries;baseline.value=serialized();}catch(e){notice.value=e.message;}finally{if(version===sequence)loading.value=false;}}
async function save(){saving.value=true;try{const r=await window.keeper.studyMistakeSave({questionId:props.questionId,cause:cause.value,entryKey:entryKey.value,note:note.value});if(!r.ok)throw Error(r.error);baseline.value=serialized();notice.value='复盘已保存，可从复习页的错题复盘打开。';}catch(e){notice.value=e.message;}finally{saving.value=false;}}
async function suggest(){const task=tasks.start('cause');busy.value=true;try{const r=await window.keeper.studyMistakeSuggest(props.questionId,task.id);if(!task.isCurrent())return;if(!r.ok)throw Error(r.error==='no_key'?'请先在设置配置 AI 服务。':r.error);cause.value=r.suggestion.cause;note.value=[note.value,r.suggestion.reason].filter(Boolean).join('\n');notice.value='这是 AI 建议，请核对证据、调整后保存。';}catch(e){if(task.isCurrent())notice.value=e.message;}finally{if(task.isCurrent())busy.value=false;task.finish();}}
async function practice(){try{practiceEntry.value=await window.keeper.kbGet(entryKey.value);}catch(e){notice.value=e.message;}}
watch(entryKey,()=>{practiceEntry.value=null;});onBeforeUnmount(()=>{disposed=true;++sequence;stop();});
</script>
<style scoped>.mistake-note{margin-top:10px}.mistake-note button{font-size:12px;margin:4px 6px 4px 0}.mistake-editor{padding:14px;background:var(--bg);border-radius:8px;font-size:13px}.mistake-editor label{display:block;margin:9px 0}.mistake-editor select,.mistake-editor textarea{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:8px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:6px}.mistake-editor p{font-size:12px;color:var(--muted)}</style>

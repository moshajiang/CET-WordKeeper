<template>
 <section v-if="issues.length" class="essay-revisions" aria-label="逐处修改">
  <h4>逐处修改 <small>修改后可重新批改，更新评分</small></h4>
  <div v-for="(issue,index) in issues" :key="index" class="revision-item">
   <blockquote>{{ issue.quote }}</blockquote><p>{{ issue.problem }}</p><p>建议：{{ issue.fix }}</p><p v-if="issue.replacement">替换为：{{ issue.replacement }}</p>
   <button v-if="typeof issue.replacement==='string'&&issue.quote" @click="apply(issue,index)" :disabled="applied.includes(index)">{{ applied.includes(index)?'已采纳':'采纳这处修改' }}</button><span v-else>请按建议在原文中调整</span>
   <button @click="saveNote(issue)">存为薄弱点笔记</button>
  </div>
  <button v-if="undo" @click="restore" :disabled="text!==undo.after">撤销上次采纳</button><p v-if="notice" role="status">{{ notice }}</p>
 </section>
</template>
<script setup>
import {ref,watch} from 'vue';import {useRouter} from 'vue-router';import {prepareKnowledgeDraft} from '../composables/useKnowledgeDraft.js';import {reviseFragment} from '../utils/essay-revisions.js';
const props=defineProps({result:Object,text:String,section:String});const emit=defineEmits(['update']);const router=useRouter();
const issues=ref([]),applied=ref([]),undo=ref(null),notice=ref('');
watch(()=>props.result,value=>{if(value){issues.value=value.issues.map(e=>({...e}));applied.value=[];undo.value=null;notice.value='';}},{immediate:true});
function apply(issue,index){try{const before=props.text,after=reviseFragment(before,issue.quote,issue.replacement);undo.value={before,after,index};applied.value.push(index);emit('update',after);notice.value='已替换这一处，草稿将自动保存。';}catch(e){notice.value=e.message;}}
function restore(){if(props.text!==undo.value?.after)return;emit('update',undo.value.before);applied.value=applied.value.filter(i=>i!==undo.value.index);undo.value=null;notice.value='已恢复采纳前的草稿。';}
function saveNote(issue){prepareKnowledgeDraft({title:(props.section==='writing'?'写作':'翻译')+'：'+issue.problem.slice(0,65),content:['原句：'+issue.quote,'问题：'+issue.problem,'建议：'+issue.fix,issue.replacement?'修改：'+issue.replacement:''].filter(Boolean).join('\n\n'),category:'我的薄弱点',tags:[props.section==='writing'?'写作':'翻译'],origin:'manual'});router.push('/knowledge');}
</script>
<style scoped>.essay-revisions{margin-top:18px;padding:16px;border:1px solid var(--border);border-radius:10px}.essay-revisions h4 small{color:var(--muted);font-weight:400;margin-left:10px}.revision-item{border-top:1px dashed var(--border);padding:12px 0;font-size:13px;line-height:1.7}.revision-item blockquote{margin:0 0 8px;color:var(--muted)}.revision-item button{font-size:12px;margin:5px 8px 0 0}.essay-revisions p[role=status]{font-size:12px;color:var(--muted)}</style>

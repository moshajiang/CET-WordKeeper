<template>
 <section class="knowledge-practice card" aria-label="知识点自测">
  <h3>{{ reviewMode?'知识点复习':'练一练，检查是否会用' }}</h3>
  <p class="page-sub">先独立作答，再展开答案核对；评分由你确认。</p>
  <div class="practice-question">{{ question }}</div>
  <textarea v-model="response" rows="3" aria-label="自测作答" placeholder="写下你的判断和依据…" />
  <div class="practice-actions"><button @click="revealed=!revealed">{{ revealed?'收起答案':'查看答案与依据' }}</button><button v-if="!reviewMode" @click="join" :disabled="busy">加入知识点复习</button><button @click="generate" :disabled="busy">{{ busy?'正在出题…':'AI 出一道新题' }}</button><button v-if="busy" @click="cancel">停止出题</button></div>
  <article v-if="revealed" class="md-body" v-html="renderMarkdown(answer)"></article>
  <div v-if="reviewMode" class="practice-actions"><button v-for="(label,rating) in ['不会','模糊','会用']" :key="rating" @click="rate(rating)" :disabled="!revealed||saving">{{ label }}</button></div>
  <p v-if="notice" role="status">{{ notice }}</p>
 </section>
</template>
<script setup>
import {ref,computed,watch,onBeforeUnmount} from 'vue';
import {renderMarkdown} from '../utils/md.js';
import {createAiTasks} from '../utils/ai-tasks.js';
const props=defineProps({entry:Object,reviewMode:Boolean});const emit=defineEmits(['rated']);
const response=ref(''),revealed=ref(false),notice=ref(''),busy=ref(false),saving=ref(false),generated=ref(null);
const tasks=createAiTasks(id=>window.keeper.cancelAi(id));let ratingOperation=null;
const parts=computed(()=>{const text=props.entry?.content||'';const start=text.indexOf('**自测**'),end=text.indexOf('**答案与依据**',start);return start>=0&&end>start?{question:text.slice(start+6,end).replace(/^[：:\s]+/,'').trim(),answer:text.slice(end+9).replace(/^[：:\s]+/,'').trim()}:null;});
const question=computed(()=>generated.value?.question||parts.value?.question||'请用自己的话说明这条资料的主要规则，并举一个符合规则的例子。');
const answer=computed(()=>generated.value?[generated.value.answer,generated.value.explanation].join('\n\n'):parts.value?.answer||props.entry?.content||'');
function cancel(){tasks.cancel('exercise');busy.value=false;}
watch(()=>props.entry?.key,()=>{cancel();response.value='';revealed.value=false;notice.value='';generated.value=null;ratingOperation=null;});
async function join(){try{const r=await window.keeper.studyReviewAdd(props.entry.key);if(!r.ok)throw Error(r.error);notice.value='已加入知识点复习，可从复习页打开。';}catch(e){notice.value=e.message;}}
async function generate(){
 const task=tasks.start('exercise'),key=props.entry.key;busy.value=true;notice.value='';
 try{const r=await window.keeper.studyExercise(key,task.id);if(!task.isCurrent()||props.entry.key!==key)return;if(!r.ok)throw Error(r.error==='no_key'?'请先在设置配置 AI 服务。':r.error);generated.value=r.exercise;response.value='';revealed.value=false;ratingOperation=null;notice.value='AI 原创练习，请结合资料核对。';}catch(e){if(task.isCurrent())notice.value=e.message;}finally{if(task.isCurrent())busy.value=false;task.finish();}
}
async function rate(rating){if(saving.value)return;const key=props.entry.key;saving.value=true;ratingOperation||={id:crypto.randomUUID(),rating};
 try{const r=await window.keeper.studyReviewRate(key,ratingOperation.rating,ratingOperation.id);if(!r.ok)throw Error(r.error);ratingOperation=null;notice.value='评分已保存，下次复习：'+new Date(r.due).toLocaleString();emit('rated');}catch(e){notice.value='评分未确认，可重试：'+e.message;}finally{saving.value=false;}
}
onBeforeUnmount(cancel);
</script>
<style scoped>
.knowledge-practice{margin-top:22px;padding:18px}.knowledge-practice h3{margin:0 0 8px}.practice-question{white-space:pre-wrap;line-height:1.8;margin:14px 0}.knowledge-practice textarea{width:100%;box-sizing:border-box;background:var(--bg);color:var(--text);border:1px solid var(--border);padding:10px;border-radius:8px;resize:vertical}.practice-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.knowledge-practice article{line-height:1.8}.knowledge-practice p[role=status]{font-size:12px;color:var(--muted)}
</style>

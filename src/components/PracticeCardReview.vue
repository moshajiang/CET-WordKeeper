<template>
 <section class="card-review">
  <p class="page-sub">先独立作答，再核对答案并评分。本轮按设置的数量与目标时长安排，到期内容优先。</p>
  <ReviewPlanPanel :budget="budget" :due-only="dueOnly" :disabled="busy||loading||!!pending" @change="changeDueOnly" />
  <p v-if="error" class="card-review-error" role="alert">{{ error }} <button v-if="pending&&!busy" @click="submit()">重试本次评分</button><button :disabled="busy" @click="reload">重新加载队列</button></p>
  <p v-if="notice" role="status">{{ notice }}</p>
  <p v-if="loading">正在加载练习卡…</p>
  <section v-else-if="current" class="card practice-review-question">
   <p class="card-review-meta">{{ labels[current.type] }} · 本批剩余 {{ cards.length }} 张 · 已完成 {{ completed }} 张</p>
   <h2>{{ current.question }}</h2>
   <fieldset v-if="objective" :disabled="revealed||busy"><legend>选择你的答案</legend><label v-for="option in choices" :key="option.value"><input type="radio" v-model="response" :value="option.value" name="practice-response" /> {{ option.label }}</label></fieldset>
   <form v-else-if="typed" class="typed-response" @submit.prevent="response.trim()&&reveal()"><label>填写原文表达<input v-model="response" type="text" aria-label="练习卡拼写作答" maxlength="10000" :disabled="revealed||busy" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="保持原词形；不确定可先查看答案" /></label><p>核对参考拼写，忽略大小写和多余空格；不做同义或词形替换。</p></form>
   <label v-else class="card-review-response">我的作答（也可在心中作答）<textarea v-model="response" aria-label="练习卡作答" rows="4" maxlength="10000" :disabled="revealed||busy" placeholder="先回忆，再查看答案" /></label>
   <button v-if="!revealed" class="primary" @click="reveal" :disabled="busy||(objective&&!response)||(typed&&!response.trim())">{{ typed?'核对拼写':'查看卡片答案' }}</button><button v-if="typed&&!revealed" :disabled="busy" @click="reveal">没想起，查看答案</button>
   <section v-if="revealed" class="practice-review-answer">
    <p v-if="typed" :class="{mismatch:!matches}" class="typed-result">{{ matches?'与参考拼写一致':'与参考拼写不一致，请核对原文词形' }}</p><p v-else-if="objective" :class="{mismatch:!matches}">{{ matches?'与卡片答案一致':'与卡片答案不一致，请重新理解' }}</p><p v-else class="card-review-meta">请根据答案和依据自行判断掌握程度；文字作答未自动判分。</p>
    <h3>答案</h3><article class="md-body" v-html="renderMarkdown(current.answer)"></article><h3>解析</h3><article class="md-body" v-html="renderMarkdown(current.explanation)"></article>
    <SchedulePreview :schedule="current.schedule" />
    <template v-if="isFsrs"><p class="card-review-meta">FSRS 四档：没想起请选择第一档；费力想起仅用于已经回忆成功。旧调度记录与本次四档分别保留。</p><div class="card-review-ratings fsrs-ratings"><button v-for="option in current.schedule.options" :key="option.rating" :disabled="busy||!!pending||((objective||typed)&&!matches&&option.rating!==1)" @click="submit(option.rating)">{{ option.name }} · {{ option.label }}</button></div></template>
    <div v-else class="card-review-ratings"><button :disabled="busy||!!pending" @click="submit(0)">不会 · {{ intervalLabels[0] }}</button><button :disabled="busy||!!pending||(typed&&!matches)" @click="submit(1)">模糊 · {{ intervalLabels[1] }}</button><button class="primary" :disabled="busy||!!pending||((objective||typed)&&!matches)" @click="submit(2)">会用 · {{ intervalLabels[2] }}</button></div>
   </section>
   <p class="card-review-meta">来源：{{ typed&&!revealed?'作答后查看':current.source_title }} <strong v-if="current.sourceStatus==='changed'">（资料已变化，卡片使用制作时的版本）</strong><strong v-if="current.sourceStatus==='unavailable'">（资料暂不可用，快照仍保留）</strong></p>
   <details v-if="revealed"><summary>制作时的来源快照</summary><article class="md-body" v-html="renderMarkdown(current.source_content)"></article></details>
   <button :disabled="busy" @click="endRound">结束本轮</button>
   <button :disabled="busy||!!pending" @click="$router.push({path:'/cards',query:{entry:current.source_key,card:current.id}})">管理当前卡片</button>
  </section>
  <section v-else class="card card-review-empty"><h2>{{ ended?'本轮已结束':completed?'本批练习卡复习完成':'当前没有到期的练习卡' }}</h2><p>已完成 {{ completed }} 张。新卡需要先加入复习；达到今日额度或暂缓新内容时，可稍后继续，安排见上方。</p><button class="primary" @click="load" :disabled="busy">重新加载到期卡片</button><button @click="$router.push('/cards')">制作与管理卡片</button></section>
 </section>
</template>
<script setup>
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
import SchedulePreview from './SchedulePreview.vue';
import ReviewPlanPanel from './ReviewPlanPanel.vue';
import {renderMarkdown} from '../utils/md.js';
const budget=ref(null),dueOnly=ref(false),ended=ref(false);
const cards=ref([]),response=ref(''),revealed=ref(false),busy=ref(false),loading=ref(false),error=ref(''),notice=ref(''),completed=ref(0),pending=ref(null);
const labels={recall:'问答',translation:'翻译',judgment:'判断',choice:'选择',spelling:'拼写',cloze:'原句填空'};let disposed=false,sequence=0;
const typedCheck=ref(null);
const current=computed(()=>cards.value[0]),isFsrs=computed(()=>current.value?.schedule?.ratingScale==='fsrs-4-v1'),objective=computed(()=>['choice','judgment'].includes(current.value?.type)),typed=computed(()=>['spelling','cloze'].includes(current.value?.type)),matches=computed(()=>typed.value?!!typedCheck.value?.correct:response.value===current.value?.answer),intervalLabels=computed(()=>current.value?.schedule?.options?.map(option=>option.label)||['—','—','—']);
const choices=computed(()=>current.value?.type==='judgment'?['正确','错误'].map(value=>({value,label:value})):(current.value?.options||[]).map((label,i)=>({value:String.fromCharCode(65+i),label:String.fromCharCode(65+i)+'. '+label})));
async function load(){if(busy.value||pending.value)return;const version=++sequence;loading.value=true;error.value='';try{const result=await window.keeper.practiceSession({dueOnly:dueOnly.value});if(disposed||version!==sequence)return;budget.value=result.budget;cards.value=result.cards;ended.value=false;response.value='';revealed.value=false;typedCheck.value=null;}catch(e){if(!disposed&&version===sequence)error.value='卡片加载失败：'+e.message;}finally{if(!disposed&&version===sequence)loading.value=false;}}
function endRound(){if(busy.value)return;if((pending.value||response.value||revealed.value)&&!window.confirm('结束本轮会放弃当前未确认作答，已保存记录会保留，确定继续？'))return;notice.value='本轮已结束，'+cards.value.length+' 张未确认完成的卡片保留原到期安排。';pending.value=null;cards.value=[];response.value='';revealed.value=false;typedCheck.value=null;ended.value=true;}
function changeDueOnly(event){if((revealed.value||response.value)&&!window.confirm('切换本轮模式会放弃当前未保存的作答，确定继续？')){event.target.checked=dueOnly.value;return;}dueOnly.value=event.target.checked;load();}
async function reveal(){if(!current.value||busy.value||objective.value&&!response.value)return;if(!typed.value){revealed.value=true;return;}const row=current.value,version=sequence;busy.value=true;error.value='';try{const r=await window.keeper.practiceCheck({id:row.id,expectedRevision:row.revision,response:response.value});if(disposed||version!==sequence||current.value?.id!==row.id)return;if(!r.ok)throw Error(r.error);typedCheck.value=r.check;revealed.value=true;}catch(e){if(!disposed&&version===sequence)error.value='核对未完成，输入仍保留：'+e.message;}finally{if(!disposed&&version===sequence)busy.value=false;}}
function reload(){if(busy.value)return;if(pending.value&&!window.confirm('重新加载会放弃当前未确认的作答，已保存的记录会保留。确定继续？'))return;pending.value=null;load();}
async function submit(rating){
 if(busy.value||!revealed.value||!current.value)return;
 if(!pending.value){if(!(isFsrs.value?[1,2,3,4]:[0,1,2]).includes(rating)||((objective.value||typed.value)&&!matches.value&&(isFsrs.value?rating!==1:typed.value?rating!==0:rating===2)))return;pending.value={operationId:crypto.randomUUID(),id:current.value.id,expectedRevision:current.value.revision,response:response.value,rating,...(isFsrs.value?{ratingScale:'fsrs-4-v1'}:{})};}
 busy.value=true;error.value='';const version=sequence;
 try{const result=await window.keeper.practiceRate(JSON.parse(JSON.stringify(pending.value)));if(disposed||version!==sequence)return;if(!result.ok)throw Error(result.error);notice.value='已保存本次作答，下次复习：'+new Date(result.due).toLocaleString();cards.value.shift();completed.value++;response.value='';revealed.value=false;typedCheck.value=null;pending.value=null;}
 catch(e){if(!disposed&&version===sequence)error.value='评分尚未确认，请重试本次评分：'+e.message;}
 finally{if(!disposed&&version===sequence)busy.value=false;}
}
onMounted(load);onBeforeUnmount(()=>{disposed=true;++sequence;});
</script>
<style scoped>
.practice-review-question,.card-review-empty{padding:24px}.practice-review-question h2{font-size:21px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}.card-review-meta{font-size:12px;color:var(--muted);margin:14px 0;line-height:1.7}.practice-review-question fieldset{border:1px solid var(--border);border-radius:9px;margin:18px 0;padding:14px}.practice-review-question fieldset label{display:block;margin:12px 0;overflow-wrap:anywhere}.card-review-response{display:block;font-size:13px;margin:18px 0}.card-review-response textarea{display:block;width:100%;box-sizing:border-box;background:var(--card);color:var(--text);font:inherit;padding:12px;border:1px solid var(--border);border-radius:8px;resize:vertical;margin-top:8px}.practice-review-answer{border-top:1px solid var(--border);margin:20px 0;padding-top:10px}.practice-review-answer article,.practice-review-question details article{line-height:1.8;overflow-wrap:anywhere}.card-review-ratings{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}.card-review-error,.mismatch{color:var(--red)}.card-review-empty button{margin-right:10px}.practice-review-question details{margin:15px 0}
.typed-response{margin:20px 0;font-size:13px}.typed-response input{display:block;width:100%;box-sizing:border-box;padding:12px;font:18px Georgia,serif;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:8px;margin-top:8px}.typed-response p{font-size:12px;color:var(--muted)}
</style>

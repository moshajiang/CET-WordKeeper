<template>
 <section class="card-review">
  <p class="page-sub">先独立作答，再核对答案并评分。每批最多 30 张，到期后可继续加载。</p>
  <p v-if="error" class="card-review-error" role="alert">{{ error }} <button v-if="pending&&!busy" @click="submit()">重试本次评分</button><button :disabled="busy" @click="reload">重新加载队列</button></p>
  <p v-if="notice" role="status">{{ notice }}</p>
  <p v-if="loading">正在加载练习卡…</p>
  <section v-else-if="current" class="card practice-review-question">
   <p class="card-review-meta">{{ labels[current.type] }} · 本批剩余 {{ cards.length }} 张 · 已完成 {{ completed }} 张</p>
   <h2>{{ current.question }}</h2>
   <fieldset v-if="objective" :disabled="revealed||busy"><legend>选择你的答案</legend><label v-for="option in choices" :key="option.value"><input type="radio" v-model="response" :value="option.value" name="practice-response" /> {{ option.label }}</label></fieldset>
   <label v-else class="card-review-response">我的作答（也可在心中作答）<textarea v-model="response" aria-label="练习卡作答" rows="4" maxlength="10000" :disabled="revealed||busy" placeholder="先回忆，再查看答案" /></label>
   <button v-if="!revealed" class="primary" @click="reveal" :disabled="busy||(objective&&!response)">查看卡片答案</button>
   <section v-else class="practice-review-answer">
    <p v-if="objective" :class="{mismatch:!matches}">{{ matches?'与卡片答案一致':'与卡片答案不一致，请重新理解' }}</p><p v-else class="card-review-meta">请根据答案和依据自行判断掌握程度；文字作答未自动判分。</p>
    <h3>答案</h3><article class="md-body" v-html="renderMarkdown(current.answer)"></article><h3>解析</h3><article class="md-body" v-html="renderMarkdown(current.explanation)"></article>
    <div class="card-review-ratings"><button :disabled="busy||!!pending" @click="submit(0)">不会 · 10 分钟</button><button :disabled="busy||!!pending" @click="submit(1)">模糊 · 1 天</button><button class="primary" :disabled="busy||!!pending||(objective&&!matches)" @click="submit(2)">会用 · {{ nextDays }} 天</button></div>
   </section>
   <p class="card-review-meta">来源：{{ current.source_title }} <strong v-if="current.sourceStatus==='changed'">（资料已变化，卡片使用制作时的版本）</strong><strong v-if="current.sourceStatus==='unavailable'">（资料暂不可用，快照仍保留）</strong></p>
   <details v-if="revealed"><summary>制作时的来源快照</summary><article class="md-body" v-html="renderMarkdown(current.source_content)"></article></details>
   <button :disabled="busy||!!pending" @click="$router.push({path:'/cards',query:{entry:current.source_key,card:current.id}})">管理当前卡片</button>
  </section>
  <section v-else class="card card-review-empty"><h2>{{ completed?'本批练习卡复习完成':'当前没有到期的练习卡' }}</h2><p>已完成 {{ completed }} 张。新卡需要先在练习卡页面加入复习。</p><button class="primary" @click="load" :disabled="busy">重新加载到期卡片</button><button @click="$router.push('/cards')">制作与管理卡片</button></section>
 </section>
</template>
<script setup>
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
import {renderMarkdown} from '../utils/md.js';
const cards=ref([]),response=ref(''),revealed=ref(false),busy=ref(false),loading=ref(false),error=ref(''),notice=ref(''),completed=ref(0),pending=ref(null);
const labels={recall:'问答',translation:'翻译',judgment:'判断',choice:'选择'};let disposed=false,sequence=0;
const current=computed(()=>cards.value[0]),objective=computed(()=>['choice','judgment'].includes(current.value?.type)),matches=computed(()=>response.value===current.value?.answer),nextDays=computed(()=>Math.min(30,2**Math.min(5,(current.value?.reps||0)+1)));
const choices=computed(()=>current.value?.type==='judgment'?['正确','错误'].map(value=>({value,label:value})):(current.value?.options||[]).map((label,i)=>({value:String.fromCharCode(65+i),label:String.fromCharCode(65+i)+'. '+label})));
async function load(){if(busy.value||pending.value)return;const version=++sequence;loading.value=true;error.value='';try{const result=await window.keeper.practiceQueue();if(disposed||version!==sequence)return;cards.value=result;response.value='';revealed.value=false;}catch(e){if(!disposed&&version===sequence)error.value='卡片加载失败：'+e.message;}finally{if(!disposed&&version===sequence)loading.value=false;}}
function reveal(){if(current.value&&!busy.value&&(!objective.value||response.value))revealed.value=true;}
function reload(){if(busy.value)return;if(pending.value&&!window.confirm('重新加载会放弃当前未确认的作答，已保存的记录会保留。确定继续？'))return;pending.value=null;load();}
async function submit(rating){
 if(busy.value||!revealed.value||!current.value)return;
 if(!pending.value){if(![0,1,2].includes(rating)||(objective.value&&!matches.value&&rating===2))return;pending.value={operationId:crypto.randomUUID(),id:current.value.id,expectedRevision:current.value.revision,response:response.value,rating};}
 busy.value=true;error.value='';const version=sequence;
 try{const result=await window.keeper.practiceRate(JSON.parse(JSON.stringify(pending.value)));if(disposed||version!==sequence)return;if(!result.ok)throw Error(result.error);notice.value='已保存本次作答，下次复习：'+new Date(result.due).toLocaleString();cards.value.shift();completed.value++;response.value='';revealed.value=false;pending.value=null;}
 catch(e){if(!disposed&&version===sequence)error.value='评分尚未确认，请重试本次评分：'+e.message;}
 finally{if(!disposed&&version===sequence)busy.value=false;}
}
onMounted(load);onBeforeUnmount(()=>{disposed=true;++sequence;});
</script>
<style scoped>
.practice-review-question,.card-review-empty{padding:24px}.practice-review-question h2{font-size:21px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}.card-review-meta{font-size:12px;color:var(--muted);margin:14px 0;line-height:1.7}.practice-review-question fieldset{border:1px solid var(--border);border-radius:9px;margin:18px 0;padding:14px}.practice-review-question fieldset label{display:block;margin:12px 0;overflow-wrap:anywhere}.card-review-response{display:block;font-size:13px;margin:18px 0}.card-review-response textarea{display:block;width:100%;box-sizing:border-box;background:var(--card);color:var(--text);font:inherit;padding:12px;border:1px solid var(--border);border-radius:8px;resize:vertical;margin-top:8px}.practice-review-answer{border-top:1px solid var(--border);margin:20px 0;padding-top:10px}.practice-review-answer article,.practice-review-question details article{line-height:1.8;overflow-wrap:anywhere}.card-review-ratings{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}.card-review-error,.mismatch{color:var(--red)}.card-review-empty button{margin-right:10px}.practice-review-question details{margin:15px 0}
</style>

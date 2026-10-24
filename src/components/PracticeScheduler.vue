<template>
 <section v-if="card.trial" class="practice-scheduler" aria-label="卡片调度方式">
  <strong>调度方式：{{ card.trial.phase==='fsrs'?'FSRS 试用':card.trial.phase==='legacy'?'原调度（已退出试用）':'原调度' }}</strong>
  <template v-if="card.trial.phase==='none'"><p>仅从未作答的新卡可试用，最多同时 10 张。每次由你为当前卡选择，不自动切换其他内容。</p><label>试用目标保持率<select v-model.number="retention" :disabled="busy||disabled||!!plan" aria-label="试用目标保持率"><option :value="0.8">80%</option><option :value="0.9">90%</option><option :value="0.95">95%</option></select></label><button @click="prepare('enable')" :disabled="busy||disabled||!card.trial.eligible">预览 FSRS 试用方案</button><p v-if="!card.trial.eligible">{{ card.trial.reason }}</p></template>
  <template v-else-if="card.trial.phase==='fsrs'"><p>目标保持率 {{ card.trial.retention===null?'待核对':Math.round(card.trial.retention*100)+'%' }} · ts-fsrs {{ card.trial.libraryVersion }}。四档评分区分是否回忆成功；修改题面或答案会重新学习，历史保留。</p><button @click="prepare('rollback')" :disabled="busy||disabled">预览退出试用方案</button></template>
  <p v-else>试用期间的作答与 FSRS 状态已保留，后续按原调度继续。本批不为这张卡再次开启试用。</p>
  <section v-if="plan" class="trial-plan" aria-label="调度切换方案">
   <h3>{{ plan.action==='enable'?'仅为当前新卡启用 FSRS':'回到原调度并保留全部作答' }}</h3><p>当前启用 FSRS {{ plan.activeTrials }} / {{ plan.maxTrials }} 张（暂停和归档仍计入）。本次影响 1 张卡。</p>
   <p>切换前：{{ date(plan.currentDue) }}；切换后：{{ date(plan.proposedDue) }}。{{ plan.status==='active'?'到期内容仍受本轮数量和每日额度限制。':'卡片当前未启用复习，切换不会自动恢复队列。' }}</p>
   <p v-if="plan.action==='rollback'">按试用期间真实评分同步计算的原调度状态接续。不会用旧备份覆盖试用后的学习记录。</p>
   <p>提交前自动创建本机完整数据库备份，包含学习数据与 AI 配置，请妥善保管。</p>
   <button class="primary" @click="commit" :disabled="busy||disabled">{{ busy?'处理中…':plan.action==='enable'?'备份并启用 FSRS':'备份并回到原调度' }}</button><button @click="cancel" :disabled="busy||disabled">取消切换</button>
  </section>
  <p v-if="error" role="alert">{{ error }}</p><details v-if="card.trial.lastBackup"><summary>查看最近切换备份位置</summary><p>{{ card.trial.lastBackup }}</p></details>
 </section>
</template>
<script setup>
import {ref,onBeforeUnmount} from 'vue';const props=defineProps({card:{type:Object,required:true},disabled:Boolean}),emit=defineEmits(['changed','busy']);
const retention=ref(0.9),plan=ref(null),busy=ref(false),error=ref('');let disposed=false,operation=null;
const date=value=>value?new Date(value).toLocaleString():'尚未加入复习';
function setBusy(value){busy.value=value;emit('busy',value);}
async function prepare(action){if(busy.value||props.disabled)return;setBusy(true);error.value='';try{const result=await window.keeper.practiceTrialPreview({id:props.card.id,expectedRevision:props.card.revision,action,...(action==='enable'?{retention:retention.value}:{})});if(disposed)return;if(!result.ok)throw Error(result.error);plan.value=result;operation=crypto.randomUUID();}catch(e){if(!disposed)error.value='方案未生成：'+e.message;}finally{if(!disposed)setBusy(false);}}
function cancel(){plan.value=null;operation=null;error.value='';}
async function commit(){if(busy.value||props.disabled||!plan.value)return;setBusy(true);error.value='';const p=plan.value;try{const result=await window.keeper.practiceTrialCommit({id:p.id,expectedRevision:p.expectedRevision,action:p.action,...(p.action==='enable'?{retention:p.retention}:{}),previewToken:p.previewToken,operationId:operation});if(disposed)return;if(!result.ok)throw Error(result.error);plan.value=null;emit('changed',result);}catch(e){if(!disposed)error.value='切换未确认，可重试同一操作；已保存记录会保留：'+e.message;}finally{if(!disposed)setBusy(false);}}
onBeforeUnmount(()=>{disposed=true;emit('busy',false);});
</script>
<style scoped>.practice-scheduler{font-size:12px;line-height:1.9;padding:16px;border:1px solid var(--border);border-radius:8px;margin:18px 0;overflow-wrap:anywhere}.practice-scheduler p{color:var(--muted)}.practice-scheduler select{background:var(--card);color:var(--text);padding:6px;border:1px solid var(--border);border-radius:6px;margin:0 10px}.practice-scheduler button{font-size:12px;margin-right:8px}.trial-plan{background:var(--accent-soft);padding:12px;border-radius:8px;margin-top:12px}.trial-plan h3{font-size:14px}.practice-scheduler [role=alert]{color:var(--red)}</style>

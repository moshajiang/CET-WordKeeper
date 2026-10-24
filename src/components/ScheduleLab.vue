<template>
 <details class="card schedule-lab"><summary>复习调度评估（本地对照）</summary><p>将最近有记录的最多 20 个生词或练习卡，按相同评分历史分别计算原安排与 FSRS 安排。对照不会修改到期时间、学习记录或每日额度。</p>
  <label>对照目标保持率<select v-model.number="retention" :disabled="busy" @change="report=null" aria-label="对照目标保持率"><option :value="0.8">80%</option><option :value="0.9">90%</option><option :value="0.95">95%</option></select></label><button @click="compare" :disabled="busy">{{ busy?'正在本地对照…':'运行本地对照' }}</button>
  <p v-if="error" role="alert">{{ error }} <button @click="compare" :disabled="busy">重试对照</button></p>
  <section v-if="report" class="schedule-report" aria-label="调度对照结果">
   <p role="status">已检查 {{ report.checked }} 项，可对照 {{ report.eligible }} 项，跳过 {{ report.checked-report.eligible }} 项。</p>
   <p>待复习范围中，{{ report.scope.words.withoutHistory }} 个生词、{{ report.scope.cards.withoutHistory }} 张练习卡还没有作答记录，不参与历史对照。</p>
   <p>旧“模糊”评分无法确定是否回忆成功，包含此类记录的项目会跳过。缺少完整调度快照、修改过题目或历史异常的项目也会单独说明。</p>
   <div v-if="report.examples.length" class="schedule-table"><table><caption>最近一次评分后的下次时间对照</caption><thead><tr><th>项目</th><th>记录数</th><th>原安排</th><th>FSRS 对照</th></tr></thead><tbody><tr v-for="row in report.examples" :key="row.kind+row.id"><td>{{ row.kind==='words'?'生词':'练习卡' }} · {{ row.title }}</td><td>{{ row.reviews }}</td><td>{{ format(row.legacyDue) }}</td><td>{{ format(row.fsrsDue) }}</td></tr></tbody></table></div>
   <p v-else class="schedule-no-sample">暂时没有符合条件的完整记录。继续正常复习后，可以再运行对照。</p>
   <details v-if="report.skipped.length"><summary>查看跳过原因</summary><ul><li v-for="row in report.skipped" :key="row.kind+row.id">{{ row.title }}：{{ reasons[row.reason]||'历史记录异常' }}</li></ul></details>
   <details><summary>查看对照条件</summary><p>ts-fsrs {{ report.libraryVersion }}（FSRS {{ report.fsrsVersion }}），目标保持率 {{ Math.round(report.retention*100) }}%，最长间隔 {{ report.maximumInterval }} 天，使用默认参数。学习和重学步骤均为 10 分钟，关闭随机间隔扰动。</p><p>本次仅在已有记录上回放，没有训练个人参数，也不能据此证明记忆效果提升。当前实际复习仍采用原调度。</p></details>
  </section>
 </details>
</template>
<script setup>
import {ref,onBeforeUnmount} from 'vue';const retention=ref(0.9),busy=ref(false),report=ref(null),error=ref('');let disposed=false,version=0;
const reasons={trial_history:'含有 FSRS 试用或回退历史，独立保留，不混入旧策略对照',ambiguous:'含有无法确定回忆结果的“模糊”评分',missing_events:'缺少完整调度快照',invalid_history:'评分、时间或调度记录异常',changed_content:'题目或答案发生过变化',state_changed:'学习状态与连续历史不一致',too_long:'记录超过本次每项 200 次的回放上限',not_new_start:'首条记录不是可确认的新学习起点'};
const format=value=>new Date(value).toLocaleString();
async function compare(){if(busy.value)return;const current=++version;busy.value=true;error.value='';report.value=null;try{const result=await window.keeper.reviewCompare({retention:retention.value});if(disposed||current!==version)return;report.value=result;}catch(e){if(!disposed&&current===version)error.value='对照未完成：'+e.message;}finally{if(!disposed&&current===version)busy.value=false;}}
onBeforeUnmount(()=>{disposed=true;++version;});
</script>
<style scoped>.schedule-lab{padding:20px;margin-bottom:20px;font-size:13px;line-height:1.9}.schedule-lab>summary{font-weight:700;cursor:pointer}.schedule-lab p{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.schedule-lab select{padding:7px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:7px;margin:8px 12px}.schedule-table{overflow:auto}.schedule-table table{width:100%;border-collapse:collapse;font-size:12px}.schedule-table th,.schedule-table td{padding:10px;border-bottom:1px solid var(--border);text-align:left;min-width:100px;overflow-wrap:anywhere}.schedule-table td:first-child{min-width:160px;max-width:300px}.schedule-report details{margin-top:12px}.schedule-lab [role=alert]{color:var(--red)}</style>

<template>
 <section class="card knowledge-review">
  <p v-if="error" role="alert">{{ error }} <button @click="load">重试</button></p>
  <p v-if="loading">正在读取知识点复习…</p>
  <template v-else-if="entry"><p>本轮剩余 {{ queue.length }} 条 · {{ entry.title }}</p><button @click="openEntry">打开完整资料</button><button @click="remove">移出复习</button><KnowledgePractice :key="entry.key" :entry="entry" review-mode @rated="load" /></template>
  <p v-else>当前没有到期的知识点。可以到知识库选择资料，点击“加入知识点复习”。<button @click="$router.push('/knowledge')">打开知识库</button></p>
 </section>
</template>
<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue';import {useRouter} from 'vue-router';import KnowledgePractice from './KnowledgePractice.vue';
const router=useRouter(),queue=ref([]),entry=ref(null),loading=ref(false),error=ref('');let sequence=0,disposed=false;
async function load(){const version=++sequence;loading.value=true;error.value='';try{const all=await window.keeper.studyReviewList();if(disposed||version!==sequence)return;queue.value=all.filter(e=>Date.parse(e.due)<=Date.now());const next=queue.value[0]?await window.keeper.kbGet(queue.value[0].entry_key):null;if(!disposed&&version===sequence)entry.value=next;}catch(e){if(!disposed&&version===sequence)error.value=e.message;}finally{if(!disposed&&version===sequence)loading.value=false;}}
async function remove(){try{const r=await window.keeper.studyReviewRemove(entry.value.key);if(!r.ok)throw Error(r.error);await load();}catch(e){error.value=e.message;}}
function openEntry(){router.push({path:'/knowledge',query:{entry:entry.value.key}});}
onMounted(load);onBeforeUnmount(()=>{disposed=true;++sequence;});
</script>
<style scoped>.knowledge-review{padding:20px}.knowledge-review>button{margin-right:8px}</style>

<template>
  <div class="knowledge-page">
    <div class="kb-heading"><div><h1 class="page-title">英语知识库</h1><p class="page-sub">查阅方法，整理真题笔记，积累自己的学习资料</p></div><button class="primary" @click="createEntry">＋ 新建笔记</button></div>
    <div v-if="error" class="kb-notice error" role="alert">{{ error }} <button @click="reload">重新加载</button></div>
    <div v-if="message" class="kb-notice" role="status">{{ message }}</div>
    <button @click="toggleTrash">{{ showTrash?'返回资料库':'回收站' }}</button>
    <section v-if="showTrash" class="card kb-trash"><p>删除的个人笔记可以在这里恢复。</p><p v-if="!trash.length">回收站为空</p><div v-for="e in trash" :key="e.id">{{ e.title }} <button @click="restoreEntry(e.id)">恢复笔记</button></div></section>
    <div class="kb-toolbar card">
      <label class="kb-search">搜索资料<input v-model="query" type="search" maxlength="200" placeholder="搜索标题、正文或标签" aria-label="搜索知识库" /></label>
      <label>来源<select v-model="source"><option value="">全部来源</option><option value="builtin">内置资料</option><option value="user">我的笔记</option></select></label>
      <label>分类<select v-model="category"><option value="">全部分类</option><option v-for="c in categories" :key="c">{{ c }}</option></select></label>
      <label>标签<select v-model="tag"><option value="">全部标签</option><option v-for="t in tags" :key="t">{{ t }}</option></select></label>
      <span class="kb-count">{{ loading ? '检索中…' : `${entries.length} / ${total} 条` }}</span>
    </div>
    <div class="kb-workspace">
      <aside class="card kb-list" aria-label="知识库条目">
        <button v-for="entry in entries" :key="entry.key" class="kb-item" :class="{selected:selectedKey===entry.key}" @click="selectEntry(entry.key)">
          <span class="kb-item-meta">{{ entry.source==='builtin'?'内置资料':entry.origin==='ai'?'AI 整理 · 我的笔记':'我的笔记' }} · {{ entry.category }}</span>
          <strong>{{ entry.title }}</strong><span class="kb-preview">{{ entry.preview }}</span>
          <span v-if="entry.tags.length" class="kb-item-tags">{{ entry.tags.map(t=>'#'+t).join('　') }}</span>
        </button>
        <div v-if="!loading&&!entries.length" class="kb-empty">没有匹配的资料。试试其他关键词，或新建一篇笔记。<button v-if="query||source||category||tag" @click="resetFilters">清除筛选</button></div>
      </aside>
      <section class="card kb-detail" aria-label="知识库正文" :aria-busy="detailLoading">
        <form v-if="editing" class="kb-editor" @submit.prevent="save">
          <div class="kb-detail-top"><h2>{{ draft.key?'编辑笔记':'新建笔记' }}</h2><span v-if="draft.origin==='ai'" class="tagchip">AI 整理 · 请检查后保存</span></div>
          <label>标题<input v-model="draft.title" maxlength="160" required aria-label="笔记标题" placeholder="例如：非谓语动词作定语" /></label>
          <div class="kb-editor-meta"><label>分类<select v-model="draft.category" aria-label="笔记分类"><option v-for="c in categories" :key="c">{{ c }}</option></select></label><label>标签<input v-model="draft.tagsText" aria-label="笔记标签" placeholder="用逗号分隔，例如：语法,非谓语" /></label></div>
          <div v-if="draft.anchor" class="kb-origin"><strong>关联原文</strong><blockquote>{{ draft.anchor.quote }}</blockquote><small>{{ draft.anchor.label }}</small></div>
          <label>内容 <small>支持 Markdown · {{ draft.content.length }} / 100000 字</small><textarea v-model="draft.content" required maxlength="100000" rows="16" aria-label="笔记内容" placeholder="写下规则、例句和容易混淆的地方…"></textarea></label>
          <p v-if="saveError" class="error" role="alert">{{ saveError }}</p>
          <div class="kb-actions"><button class="primary" type="submit" :disabled="saving">{{ saving?'保存中…':'保存笔记' }}</button><button type="button" @click="cancelEdit" :disabled="saving">取消</button><span class="kb-muted">{{ dirty?'有未保存的修改':'可继续编辑后保存' }}</span></div>
        </form>
        <template v-else-if="selected">
          <div class="kb-detail-top"><span class="kb-muted">{{ selected.source==='builtin'?'内置资料 · 只读':selected.origin==='ai'?'AI 整理 · 我的笔记':'我的笔记' }} · {{ selected.category }}</span><div class="kb-actions"><button v-if="selected.source==='user'" @click="editEntry">编辑</button><button @click="copyEntry">复制为新笔记</button><button v-if="selected.source==='user'" class="danger" @click="deleting=true">删除</button></div></div>
          <h2 class="kb-title">{{ selected.title }}</h2>
          <div class="kb-tags"><button v-for="t in selected.tags" :key="t" class="tagchip" @click="tag=t">#{{ t }}</button></div>
          <div v-if="selected.anchor" class="kb-origin"><strong>真题来源</strong><blockquote>{{ selected.anchor.quote }}</blockquote><small>{{ selected.anchor.label }}</small><button @click="openSource" :disabled="locating">{{ locating?'定位中…':'返回原文并高亮' }}</button></div>
          <div v-if="deleting" class="kb-delete" role="alert">确定删除这篇笔记？<button class="danger" @click="removeEntry" :disabled="saving">确认删除</button><button @click="deleting=false">保留笔记</button></div>
          <article class="md-body kb-body" v-html="renderMarkdown(selected.content)"></article>
          <button @click="$router.push({path:'/cards',query:{entry:selected.key}})">制作练习卡</button>
          <KnowledgePractice :entry="selected" />
          <p v-if="selected.updated_at" class="kb-muted">最近更新：{{ new Date(selected.updated_at).toLocaleString() }}</p>
        </template>
        <div v-else class="kb-empty">{{ detailLoading?'正在加载正文…':'从左侧选择资料开始阅读，或新建自己的笔记。' }}</div>
      </section>
    </div>
  </div>
</template>
<script setup>
import {ref,computed,watch,onMounted,onBeforeUnmount} from 'vue';
import {useRouter,useRoute,onBeforeRouteLeave} from 'vue-router';
import KnowledgePractice from '../components/KnowledgePractice.vue';
import {usePageAssistant} from '../composables/usePageAssistant.js';
import {renderMarkdown} from '../utils/md.js';
import {knowledgeDraft} from '../composables/useKnowledgeDraft.js';
const route=useRoute(),pageAssistant=usePageAssistant();let unregisterAssistant=null;
const showTrash=ref(false),trash=ref([]);
async function toggleTrash(){showTrash.value=!showTrash.value;if(showTrash.value)try{trash.value=await window.keeper.kbTrash();}catch(e){error.value=e.message;}}
async function restoreEntry(id){try{const r=await window.keeper.kbRestore(id);if(!r.ok)throw Error(r.error);trash.value=await window.keeper.kbTrash();await reload();message.value='笔记已恢复';}catch(e){error.value=e.message;}}
const router=useRouter(),query=ref(''),source=ref(''),category=ref(''),tag=ref('');
const entries=ref([]),total=ref(0),categories=ref(['基础知识','真题笔记','我的薄弱点','未分类']),tags=ref([]);
const selectedKey=ref(''),selected=ref(null),loading=ref(false),detailLoading=ref(false),error=ref(''),message=ref('');
const editing=ref(false),draft=ref({}),baseline=ref(''),saving=ref(false),saveError=ref(''),deleting=ref(false),locating=ref(false);
let listSequence=0,detailSequence=0,disposed=false,timer;
const dirty=computed(()=>editing.value&&JSON.stringify(draft.value)!==baseline.value);
function canDiscard(){return !saving.value&&(!dirty.value||window.confirm('笔记尚未保存，确定放弃修改？'));}
function startEdit(value){draft.value={...value,tagsText:(value.tags||[]).join(', ')};baseline.value=JSON.stringify(draft.value);editing.value=true;deleting.value=false;saveError.value='';message.value='';}
async function reload(){
  const sequence=++listSequence;loading.value=true;error.value='';
  try{const result=await window.keeper.kbSearch({query:query.value,source:source.value,category:category.value,tag:tag.value});if(disposed||sequence!==listSequence)return;
    entries.value=result.entries;total.value=result.total;categories.value=result.categories;tags.value=result.tags;
    if(!selectedKey.value&&!editing.value&&result.entries.length)await selectEntry(result.entries[0].key);
  }catch(e){if(!disposed&&sequence===listSequence)error.value='资料加载失败：'+e.message;}
  finally{if(!disposed&&sequence===listSequence)loading.value=false;}
}
async function selectEntry(key){
  if(!canDiscard())return;
  const sequence=++detailSequence;detailLoading.value=true;selectedKey.value=key;editing.value=false;selected.value=null;deleting.value=false;error.value='';knowledgeDraft.value=null;
  try{const entry=await window.keeper.kbGet(key);if(disposed||sequence!==detailSequence)return;selected.value=entry;}
  catch(e){if(!disposed&&sequence===detailSequence)error.value='正文加载失败：'+e.message;}
  finally{if(!disposed&&sequence===detailSequence)detailLoading.value=false;}
}
function createEntry(){if(!canDiscard())return;++detailSequence;detailLoading.value=false;startEdit({title:'',content:'',category:'未分类',tags:[],origin:'manual'});knowledgeDraft.value=null;}
function editEntry(){startEdit({...selected.value,expectedUpdatedAt:selected.value.updated_at});}
function copyEntry(){startEdit({title:selected.value.title+'（笔记）',content:selected.value.content,category:selected.value.category,tags:[...selected.value.tags],origin:'manual',anchor:selected.value.anchor});}
function cancelEdit(){if(canDiscard()){editing.value=false;knowledgeDraft.value=null;saveError.value='';}}
async function save(){
  if(saving.value)return;saving.value=true;saveError.value='';
  try{const payload={...draft.value,tags:draft.value.tagsText.split(/[,，、\n]/).map(t=>t.trim()).filter(Boolean)};delete payload.tagsText;
    // Nested Vue proxies must be removed before crossing contextBridge, not only inside preload.
    const result=await window.keeper.kbSave(JSON.parse(JSON.stringify(payload)));if(!result.ok)throw Error(result.error);if(disposed)return;
    baseline.value=JSON.stringify(draft.value);editing.value=false;knowledgeDraft.value=null;saving.value=false;message.value='笔记已保存';await reload();await selectEntry(result.key);
  }catch(e){if(!disposed)saveError.value='保存失败：'+e.message;}
  finally{if(!disposed)saving.value=false;}
}
async function removeEntry(){
  if(saving.value)return;saving.value=true;error.value='';
  try{const result=await window.keeper.kbRemove(selected.value.id);if(!result.ok)throw Error(result.error);selectedKey.value='';selected.value=null;deleting.value=false;saving.value=false;await reload();message.value='笔记已移入回收站，可恢复';}
  catch(e){error.value='删除失败：'+e.message;}finally{saving.value=false;}
}
async function openSource(){
  if(locating.value)return;locating.value=true;error.value='';
  try{const found=await window.keeper.kbSource(selectedKey.value);await router.push({path:'/reader/'+found.examId,query:{passage:String(found.passageId),knowledge:selectedKey.value}});}
  catch(e){error.value='原文定位失败：'+e.message;}finally{locating.value=false;}
}
function resetFilters(){query.value='';source.value='';category.value='';tag.value='';}
watch([query,source,category,tag],()=>{clearTimeout(timer);timer=setTimeout(reload,180);});
onBeforeRouteLeave(()=>canDiscard());
watch(selectedKey,key=>{unregisterAssistant?.();unregisterAssistant=pageAssistant.register({label:'当前知识资料',snapshot:()=>({key:selectedKey.value,context:{page:'knowledge',knowledgeKey:selectedKey.value}}),matches:value=>value.key===selectedKey.value,apply:()=>{throw Error('当前资料仅支持问答');}});});
watch(()=>route.query.entry,key=>{if(typeof key==='string')selectEntry(key);});
onMounted(async()=>{if(knowledgeDraft.value)startEdit({...knowledgeDraft.value});await reload();if(typeof route.query.entry==='string'&&!editing.value)await selectEntry(route.query.entry);});
onBeforeUnmount(()=>{unregisterAssistant?.();disposed=true;++listSequence;++detailSequence;clearTimeout(timer);});
</script>
<style scoped>
.kb-heading,.kb-detail-top,.kb-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.kb-heading{margin-bottom:18px}.kb-heading .page-sub{margin-bottom:0}.kb-heading>.primary{flex-shrink:0}.kb-toolbar{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:16px;padding:16px}.kb-toolbar label{font-size:12px;color:var(--muted)}.kb-search{flex:1;min-width:180px}.kb-count,.kb-muted{font-size:12px;color:var(--muted)}.kb-count{padding-bottom:8px}.kb-workspace{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);gap:16px;align-items:start}.kb-list{padding:8px;max-height:calc(100vh - 260px);overflow-y:auto;position:sticky;top:20px}.kb-item{display:flex;flex-direction:column;gap:7px;width:100%;text-align:left;border:1px solid transparent;background:transparent;padding:14px 12px;border-radius:9px;margin-bottom:4px;overflow-wrap:anywhere}.kb-item.selected{border-color:var(--accent);background:var(--accent-soft)}.kb-item:hover{background:var(--bg)}.kb-item strong{font-size:14px;line-height:1.5}.kb-item-meta,.kb-item-tags{font-size:11px;color:var(--muted)}.kb-preview{font-size:12px;color:var(--muted);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.kb-detail{padding:26px;min-height:420px;min-width:0}.kb-detail-top h2{font-size:19px;margin:0}.kb-detail-top button{font-size:12px;padding:5px 9px}.kb-title{font-size:24px;line-height:1.5;margin:20px 0 12px;overflow-wrap:anywhere}.kb-tags{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:20px}.kb-body{line-height:1.9;font-size:14px;overflow-wrap:anywhere;user-select:text;margin:24px 0}.kb-origin{padding:14px 16px;background:var(--accent-soft);border-radius:10px;font-size:12px;margin:16px 0;overflow-wrap:anywhere}.kb-origin blockquote{font:15px/1.7 Georgia,serif;margin:9px 0;white-space:pre-wrap}.kb-origin button{display:block;margin-top:12px;font-size:12px}.kb-origin small{color:var(--muted)}.kb-editor label{display:block;font-size:13px;margin:16px 0}.kb-editor label small{color:var(--muted);font-weight:400;margin-left:6px}.kb-editor-meta{display:flex;gap:14px}.kb-editor-meta>label{flex:1;min-width:0}.knowledge-page input,.knowledge-page select,.knowledge-page textarea{display:block;width:100%;box-sizing:border-box;margin-top:7px;padding:9px 11px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text);font:inherit}.knowledge-page input:focus,.knowledge-page textarea:focus,.knowledge-page select:focus{outline:2px solid var(--accent);outline-offset:1px}.knowledge-page textarea{line-height:1.8;resize:vertical;min-height:240px;font-size:14px}.kb-actions{justify-content:flex-start}.kb-notice{padding:12px 16px;background:var(--accent-soft);border-radius:8px;margin-bottom:14px;font-size:13px}.error{color:var(--red)}.kb-empty{padding:30px 16px;color:var(--muted);line-height:1.8;font-size:13px}.kb-empty button{display:block;margin-top:12px}.kb-delete{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--bg);padding:12px;border-radius:8px;margin-top:16px;font-size:13px}
@media(max-width:1100px){.kb-workspace{grid-template-columns:220px minmax(0,1fr)}.kb-detail{padding:20px}.kb-toolbar{gap:10px}.kb-toolbar label{min-width:110px}}@media(max-width:820px){.kb-workspace{grid-template-columns:1fr}.kb-list{position:static;max-height:260px}.kb-editor-meta{flex-direction:column;gap:0}}
</style>

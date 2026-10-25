<template>
  <div class="reader-ai-controls">
    <span>✦ 划选原文后可就地讲解，也可让 AI 定位证据与题目</span>
    <button @mousedown.prevent @click="collectPhrase('sense')">保存划选词义</button><button @mousedown.prevent @click="collectPhrase()">收藏划选短语</button><button @click="markSelection">保存划选批注</button><button @click="savedOpen=!savedOpen">我的批注 {{ savedNotes.length }}</button><button v-if="undoState" @click="undoOperation">撤销上次页面操作</button>
    <span v-if="sourceNotice" role="status">{{ sourceNotice }}</span>
    <button v-if="notes.length" @click="reopen">查看讲解 {{ active+1 }}/{{ notes.length }}</button>
    <button v-if="notes.length" @click="clear">清除 {{ note?.origin==='sense'?'词义':note?.origin==='phrase'?'短语':'AI' }} 标注</button>
  </div>
  <div v-if="savedOpen" class="saved-annotations"><p v-if="!savedNotes.length">本篇还没有已保存批注。划选原文后可添加。</p><div v-for="saved in savedNotes" :key="saved.id"><button @click="openSaved(saved)">{{ saved.stale?'原文已变化 · ':'' }}{{ saved.title }} · {{ saved.quote.slice(0,70) }}</button><p>{{ saved.note }}</p><button @click="removeSaved(saved)">删除批注</button></div></div>
  <PhraseCapture v-if="phraseSelection" :key="JSON.stringify(phraseSelection)" :selection="phraseSelection" @close="phraseSelection=null" />
  <Teleport to="body">
    <section v-if="visible && note" ref="card" class="inline-explanation" :style="position" role="dialog" :aria-label="note.origin==='sense'?'原文旁语境义':note.origin==='phrase'?'原文旁短语释义':'原文旁 AI 讲解'" @click.stop @mouseup.stop @keydown.esc.stop="visible=false">
      <header><strong>✦ {{ note.title || 'AI 讲解' }}</strong><div><button v-if="notes.length>1" @click="change(-1)" aria-label="上一处讲解">‹</button><span v-if="notes.length>1">{{ active+1 }}/{{ notes.length }}</span><button v-if="notes.length>1" @click="change(1)" aria-label="下一处讲解">›</button><button @click="visible=false" aria-label="收起原文讲解">×</button></div></header>
      <blockquote>{{ note.quote }}</blockquote>
      <div class="inline-explanation-body ai-result md-body" aria-live="polite" v-html="renderMarkdown(note.explanation)"></div>
      <div class="annotation-editor"><label>备注<textarea v-model="annotationNote" rows="2" maxlength="5000" aria-label="批注备注" /></label><label>颜色<select v-model="annotationColor" aria-label="批注颜色"><option value="yellow">黄色</option><option value="green">绿色</option><option value="purple">紫色</option></select></label><button @click="saveAnnotation" :disabled="annotationBusy||result?.loading">{{ note.savedId?'更新批注':'保存批注' }}</button></div>
      <footer><button v-if="result?.loading" @click="emit('cancel')">取消请求</button><button @click="followUp">继续追问</button><button @click="saveKnowledge" :disabled="result?.loading">存入知识库</button><button @click="locate">定位原文</button><button @click="clear">清除标注</button></footer>
    </section>
  </Teleport>
</template>
<script setup>
import {ref,computed,watch,nextTick,onMounted,onBeforeUnmount} from 'vue';
import {usePageAssistant} from '../composables/usePageAssistant.js';
import {useRoute,useRouter} from 'vue-router';
import {prepareKnowledgeDraft} from '../composables/useKnowledgeDraft.js';
import {findArticleRange,selectedArticleAnchor,normalizedText,placeExplanation} from '../utils/page-anchors.js';
import {renderMarkdown} from '../utils/md.js';
import PhraseCapture from './PhraseCapture.vue';
const props=defineProps({detail:Object,passageId:Number,layout:String,translation:String,fontSize:Number,result:Object,draft:String});
const emit=defineEmits(['passage','view','cancel','close-result']);
const assistant=usePageAssistant(),notes=ref([]),active=ref(0),visible=ref(false),card=ref(null);
const phraseSelection=ref(null);
function collectPhrase(kind='phrase'){selection.value='';selectEvidence();if(!selection.value){sourceNotice.value=kind==='sense'?'请先完整划选一个英文单词。':'请先完整划选英文原文中的短语。';return;}phraseSelection.value={kind,examId:props.detail.exam.id,passageId:props.passageId,quote:selection.value,occurrence:selectionOccurrence};}
function collectWord(element){if(!element?.isConnected||!article()?.contains(element))return;const range=document.createRange();range.selectNodeContents(element);const selected=window.getSelection();selected.removeAllRanges();selected.addRange(range);collectPhrase('sense');selected.removeAllRanges();}
const position=ref({left:'240px',top:'200px'}),selection=ref(''),sourceNotice=ref('');
const route=useRoute(),router=useRouter();
let sourceSequence=0,restoredKey='',phraseSequence=0,restoredPhrase='';
async function restorePhraseSource(){const version=++phraseSequence,id=route.query.sense??route.query.phrase;if(typeof id!=='string'||!props.detail||!current()||restoredPhrase===id)return;const examId=props.detail.exam.id,passageId=props.passageId;const valid=()=>!disposed&&version===phraseSequence&&props.detail?.exam.id===examId&&props.passageId===passageId&&(route.query.sense??route.query.phrase)===id;try{const a=await window.keeper.phraseAnchor(id);if(!valid()||a.examId!==examId||a.passageId!==passageId)return;await apply([{type:'highlight',passageId,quote:a.quote,occurrence:a.occurrence,title:(a.kind==='sense'?'此处词义 · ':'短语 · ')+a.title,explanation:a.explanation,origin:a.kind==='sense'?'sense':'phrase'}],valid);if(valid())restoredPhrase=id;}catch(e){if(valid())sourceNotice.value='收藏原文定位失败：'+e.message;}}
const note=computed(()=>notes.value[active.value] || null);
let ranges=[],unregister=null,frame=0,resizeObserver=null,disposed=false,applying=false,selectionOccurrence=0,revision=0;
const article=()=>document.querySelector('.article');
const current=()=>props.detail?.passages.find(p=>p.id===props.passageId);
function snapshot(){return {key:JSON.stringify([props.detail?.exam.id,props.passageId,current()?.content,props.draft]),context:{page:'reader',examId:props.detail?.exam.id,passageId:props.passageId,selection:selection.value,selectionOccurrence,draft:props.draft||'',view:{layout:props.layout,translation:props.translation,fontSize:props.fontSize}}};}
const matches=value=>value?.key===snapshot().key;
function paint(){
  if(!globalThis.CSS?.highlights||typeof Highlight==='undefined')return;
  CSS.highlights.delete('keeper-ai-evidence');CSS.highlights.delete('keeper-ai-active');
  const valid=ranges.filter(r=>r?.startContainer.isConnected);
  if(valid.length)CSS.highlights.set('keeper-ai-evidence',new Highlight(...valid));
  if(ranges[active.value]?.startContainer.isConnected)CSS.highlights.set('keeper-ai-active',new Highlight(ranges[active.value]));
}
function reposition(){
  if(disposed||!visible.value||!note.value)return;
  const range=ranges[active.value];
  const rect=range?.startContainer.isConnected?range.getBoundingClientRect():article()?.getBoundingClientRect();
  if(!rect)return;
  const size=card.value?.getBoundingClientRect();
  const point=placeExplanation(rect,size?.width||400,size?.height||320,{width:window.innerWidth,height:window.innerHeight});
  position.value={left:point.left+'px',top:point.top+'px'};
}
function schedulePosition(){cancelAnimationFrame(frame);frame=requestAnimationFrame(reposition);}
function refreshRanges(){ranges=notes.value.map(n=>findArticleRange(article(),n.quote,n.occurrence||0));paint();refreshSavedRanges();schedulePosition();}
function clear(invalidate=true){if(invalidate)++revision;notes.value=[];ranges=[];visible.value=false;paint();emit('close-result');}
function reopen(){visible.value=true;nextTick(schedulePosition);}
function locate(){
  const range=ranges[active.value];
  range?.startContainer.parentElement?.scrollIntoView({block:'center',inline:'nearest'});
  schedulePosition();
}
function change(delta){active.value=(active.value+delta+notes.value.length)%notes.value.length;paint();locate();}
function followUp(){selection.value=note.value.quote;selectionOccurrence=note.value.occurrence||0;assistant.compose(note.value.quote);}
async function saveKnowledge(){
  if(!note.value||props.result?.loading)return;
  const exam=props.detail?.exam,passage=current();if(!exam||!passage)return;
  prepareKnowledgeDraft({title:note.value.title||note.value.quote.slice(0,80),content:note.value.explanation,category:'真题笔记',tags:[],origin:['phrase','sense'].includes(note.value.origin)?'manual':'ai',anchor:{examId:exam.id,passageId:passage.id,quote:note.value.quote,occurrence:note.value.occurrence||0,label:[exam.level,exam.year+' 年 '+exam.month+' 月','第 '+exam.set_no+' 套',passage.title||passage.section].join(' · ')}});
  try{await router.push('/knowledge');}catch(error){sourceNotice.value='笔记草稿打开失败：'+error.message;}
}
async function restoreKnowledgeSource(){
  const sequence=++sourceSequence,key=route.query.knowledge;sourceNotice.value='';
  if(typeof key!=='string'||!props.detail||!current()||key===restoredKey)return;
  const examId=props.detail.exam.id,passageId=props.passageId;
  const stillCurrent=()=>!disposed&&sequence===sourceSequence&&props.detail?.exam.id===examId&&props.passageId===passageId&&route.query.knowledge===key;
  try{
    const found=await window.keeper.kbSource(key);if(!stillCurrent())return;
    if(found.examId!==examId||found.passageId!==passageId)return;
    await apply([{type:'highlight',passageId,quote:found.quote,occurrence:found.occurrence,title:found.title,explanation:found.explanation}],stillCurrent);
    if(stillCurrent())restoredKey=key;
  }catch(error){if(stillCurrent())sourceNotice.value='笔记原文定位失败：'+error.message;}
}
const savedNotes=ref([]),savedOpen=ref(false),annotationBusy=ref(false),annotationNote=ref(''),annotationColor=ref('yellow'),undoState=ref(null);
let annotationSequence=0,savedRanges=[];
async function loadAnnotations(){
 const version=++annotationSequence,examId=props.detail?.exam.id,passageId=props.passageId;savedNotes.value=[];savedRanges=[];paintSaved();
 if(!examId||!passageId)return;
 try{const values=await window.keeper.annotationList(examId,passageId);if(disposed||version!==annotationSequence||passageId!==props.passageId)return;savedNotes.value=values;await nextTick();refreshSavedRanges();if(values.some(e=>e.stale))sourceNotice.value='部分已保存批注的原文发生变化，保留内容但不自动高亮。';}catch(error){if(version===annotationSequence)sourceNotice.value='批注读取失败：'+error.message;}
}
function paintSaved(){if(!globalThis.CSS?.highlights||typeof Highlight==='undefined')return;for(const color of ['yellow','green','purple']){const valid=savedRanges.filter((r,i)=>r?.startContainer.isConnected&&savedNotes.value[i].color===color);CSS.highlights.delete('keeper-note-'+color);if(valid.length)CSS.highlights.set('keeper-note-'+color,new Highlight(...valid));}}
function refreshSavedRanges(){savedRanges=savedNotes.value.map(n=>n.stale?null:findArticleRange(article(),n.quote,n.occurrence||0));paintSaved();}
function openSaved(value){if(value.stale){sourceNotice.value='原文已变化。保存的引文：'+value.quote+'；备注：'+value.note;return;}notes.value=[{quote:value.quote,occurrence:value.occurrence,title:value.title,explanation:value.explanation,savedId:value.id,expectedUpdatedAt:value.updated_at}];active.value=0;visible.value=true;annotationNote.value=value.note;annotationColor.value=value.color;nextTick(()=>{refreshRanges();locate();});}
async function saveAnnotation(){
 if(!note.value||props.result?.loading||annotationBusy.value)return;
 const target={examId:props.detail.exam.id,passageId:props.passageId,quote:note.value.quote,occurrence:note.value.occurrence||0,title:note.value.title||'原文批注',explanation:note.value.explanation,note:annotationNote.value,color:annotationColor.value};
 if(note.value.savedId){target.id=note.value.savedId;target.expectedUpdatedAt=note.value.expectedUpdatedAt;}
 annotationBusy.value=true;
 try{const r=await window.keeper.annotationSave(target);if(!r.ok)throw Error(r.error);if(props.passageId===target.passageId){sourceNotice.value='批注已保存，重新打开本篇会恢复。';await loadAnnotations();const saved=savedNotes.value.find(e=>e.id===r.id);if(saved)openSaved(saved);}}catch(error){sourceNotice.value='保存失败：'+error.message;}finally{annotationBusy.value=false;}
}
function markSelection(){selectEvidence();if(!selection.value){sourceNotice.value='请先划选英文原文。';return;}notes.value=[{quote:selection.value,occurrence:selectionOccurrence,title:'我的批注',explanation:'为选中的原文添加备注。'}];active.value=0;visible.value=true;annotationNote.value='';nextTick(refreshRanges);}
async function removeSaved(value){if(!window.confirm('删除这条已保存批注？'))return;try{const r=await window.keeper.annotationRemove(value.id);if(!r.ok)throw Error(r.error);await loadAnnotations();if(note.value?.savedId===value.id)clear();}catch(error){sourceNotice.value=error.message;}}
async function undoOperation(){
 const previous=undoState.value;if(!previous)return;
 if(props.detail!==previous.source||current()?.content!==previous.targetContent){undoState.value=null;sourceNotice.value='原文已变化，无法恢复旧页面操作。';return;}
 assistant.invalidate();undoState.value=null;applying=true;
 try{emit('passage',previous.passageId);emit('view',previous.view);await nextTick();if(disposed||props.detail!==previous.source||props.passageId!==previous.passageId)return;notes.value=previous.notes;active.value=previous.active;visible.value=previous.visible;await nextTick();refreshRanges();const main=document.querySelector('.main');if(main)main.scrollTop=previous.scroll;sourceNotice.value='已撤销上次页面操作。';}finally{applying=false;}
}

function selectEvidence(){
  const selected=window.getSelection();
  if(!selected?.rangeCount||selected.isCollapsed)return;
  const range=selected.getRangeAt(0),root=article();
  if(!root?.contains(range.startContainer)||!root.contains(range.endContainer))return;
  const containingBlock=node=>(node.nodeType===Node.ELEMENT_NODE?node:node.parentElement)?.closest('[data-ai-text]');
  const start=containingBlock(range.startContainer)||(range.startContainer===root?root.querySelector('[data-ai-text]'):null),end=containingBlock(range.endContainer)||(range.endContainer===root?root.querySelector('[data-ai-text]:last-child'):null);
  if(!start||!end){selection.value='';return;}
  const text=selected.toString().trim();if(!text||text.length>4000){selection.value='';return;}
  const anchor=selectedArticleAnchor(root,range,text);selection.value=anchor?text:'';selectionOccurrence=anchor?.occurrence??0;
}
function explainSelection(){selectEvidence();assistant.open.value=true;if(!selection.value){assistant.notice.value='请先划选英文原文，再点击就地讲解。';return;}emit('cancel');emit('close-result');if(assistant.busy.value)assistant.stop(false);assistant.send('请讲解我选中的原文，说明句意、句子结构和关键用法，并在原文附近展示讲解。',{inline:true});}
function quote(text){selection.value=normalizedText(current()?.content||'').text.includes(normalizedText(text).text.trim())?text:'';selectionOccurrence=0;assistant.compose(text);}
async function apply(actions,isCurrent){
  if(!isCurrent()||!current())throw Error('页面已变化，请重新请求。');
  const source=props.detail,passages=source.passages,targets=new Set();
  let target=props.passageId;const view={};const nextNotes=[];
  let questionId=null;
  for(const action of actions){
    if(!['highlight','navigate_passage','focus_question','set_view'].includes(action.type))throw Error('不支持的页面操作');
    if(action.type==='set_view'){
      if(action.layout!==undefined){if(!['stack','split'].includes(action.layout))throw Error('布局无效');view.layout=action.layout;}
      if(action.translation!==undefined){if(!['off','inline'].includes(action.translation))throw Error('翻译模式无效');view.translation=action.translation;}
      if(action.fontSize!==undefined){if(!Number.isFinite(action.fontSize)||action.fontSize<14||action.fontSize>22)throw Error('字号无效');view.fontSize=action.fontSize;}
      continue;
    }
    const passage=passages.find(p=>p.id===action.passageId);if(!passage)throw Error('篇章已变化');
    targets.add(passage.id);target=passage.id;
    if(action.type==='focus_question'){
      if(!passage.questions.some(q=>q.id===action.questionId))throw Error('题目已变化');
      questionId=action.questionId;
    }
    if(action.type==='highlight'){
      if(typeof action.quote!=='string'||!action.quote.trim()||typeof action.explanation!=='string'||!normalizedText(passage.content).text.includes(normalizedText(action.quote).text.trim()))throw Error('引文无法对应当前材料');
      nextNotes.push({...action});
    }
  }
  if(targets.size>1)throw Error('请一次操作一个篇章');
  if(view.translation==='inline'&&!passages.find(p=>p.id===target)?.translation)throw Error('该篇章暂无译文');
  const previous={source,passageId:props.passageId,view:{layout:props.layout,translation:props.translation,fontSize:props.fontSize},notes:notes.value.map(e=>({...e})),active:active.value,visible:visible.value,scroll:document.querySelector('.main')?.scrollTop||0,targetContent:passages.find(p=>p.id===target)?.content};
  const operation=++revision;applying=true;
  try{
    if(target!==props.passageId)emit('passage',target);
    if(Object.keys(view).length)emit('view',view);
    await nextTick();
    if(disposed||!isCurrent()||operation!==revision||props.detail!==source||props.passageId!==target)throw Error('页面已变化，请重新请求。');
    if(nextNotes.length){
      notes.value=nextNotes;active.value=0;visible.value=true;emit('close-result');await nextTick();refreshRanges();
      if(ranges.some(r=>!r)){
        notes.value=[];ranges=[];visible.value=false;paint();
        throw Error('已定位篇章，但当前排版无法匹配引文。请切换为原文展示后重试。');
      }
      locate();
    }
    if(questionId!==null){
      const block=document.querySelector(`[data-question-id="${questionId}"]`);
      if(block){block.scrollIntoView({block:'center'});block.focus({preventScroll:true});}
    }
    undoState.value=previous;
    return nextNotes.length?`已在原文高亮 ${nextNotes.length} 处，讲解显示在附近。`:questionId?'已定位题目。':'已调整阅读页面。';
   }catch(error){
    if(!disposed&&isCurrent()&&operation===revision&&props.detail===source&&props.passageId===target){emit('passage',previous.passageId);emit('view',previous.view);await nextTick();if(!disposed&&props.detail===source&&props.passageId===previous.passageId){notes.value=previous.notes;active.value=previous.active;visible.value=previous.visible;await nextTick();refreshRanges();}undoState.value=null;}
    throw error;
  }finally{applying=false;}
}
function hit(event){
  if(!article()?.contains(event.target))return;
  if(event.target.closest?.('.inline-explanation,.assistant-panel,.selmenu,.popover'))return;
  if(window.getSelection()?.toString().trim())return;
  const index=ranges.findIndex(range=>range&&[...range.getClientRects()].some(rect=>event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom));
  if(index<0){const savedIndex=savedRanges.findIndex(range=>range&&[...range.getClientRects()].some(rect=>event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom));if(savedIndex>=0){event.preventDefault();event.stopPropagation();openSaved(savedNotes.value[savedIndex]);return;}}
  if(index>=0){event.preventDefault();event.stopPropagation();active.value=index;visible.value=true;paint();schedulePosition();}
}
watch(()=>[props.passageId,current()?.content],()=>{
  if(!applying){assistant.invalidate();clear();undoState.value=null;}
  else clear(false);
  assistant.section.value=current()?.section||'';
  selection.value='';selectionOccurrence=0;phraseSelection.value=null;restoredPhrase='';loadAnnotations();
});
watch(()=>[props.layout,props.translation,props.fontSize],async()=>{await nextTick();refreshRanges();});
watch(()=>props.draft,()=>assistant.invalidate());
watch(()=>props.result,async value=>{
  if(!value)return;
  notes.value=[{quote:value.source,occurrence:selectionOccurrence,title:value.kind==='translate'?'整句翻译':'语法分析',explanation:value.text}];
  active.value=0;visible.value=true;await nextTick();refreshRanges();
});
watch(note,value=>{if(!value?.savedId){annotationNote.value='';annotationColor.value='yellow';}});
watch([visible,note],()=>nextTick(schedulePosition));
watch(()=>[props.detail?.exam.id,props.passageId,route.query.knowledge],restoreKnowledgeSource,{flush:'post'});
watch(()=>[props.detail?.exam.id,props.passageId,route.query.phrase,route.query.sense],restorePhraseSource,{flush:'post'});
onMounted(()=>{
  unregister=assistant.register({label:'当前真题与文章',section:()=>current()?.section,snapshot,matches,apply});
  restoreKnowledgeSource();restorePhraseSource();loadAnnotations();
  document.addEventListener('mouseup',selectEvidence);document.addEventListener('click',hit,true);
  window.addEventListener('scroll',schedulePosition,true);window.addEventListener('resize',schedulePosition);
  resizeObserver=new ResizeObserver(schedulePosition);if(article())resizeObserver.observe(article());
});
onBeforeUnmount(()=>{
  disposed=true;++revision;++annotationSequence;unregister?.();cancelAnimationFrame(frame);resizeObserver?.disconnect();
  document.removeEventListener('mouseup',selectEvidence);document.removeEventListener('click',hit,true);
  window.removeEventListener('scroll',schedulePosition,true);window.removeEventListener('resize',schedulePosition);
  notes.value=[];ranges=[];savedRanges=[];paint();paintSaved();
});
defineExpose({explainSelection,quote,clear,collectPhrase,collectWord});
</script>
<style>
::highlight(keeper-ai-evidence){background:#ffe09a;color:#2c2c2a;text-decoration:underline solid #aa6900 2px}
::highlight(keeper-ai-active){background:#c9c1ff;color:#211747;text-decoration:underline solid #6552bb 2px}
.reader-ai-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin:0 0 14px}.reader-ai-controls button{font-size:11px;padding:3px 8px}
.inline-explanation{position:fixed;z-index:120;width:min(400px,calc(100vw - 24px));max-height:calc(100vh - 24px);display:flex;flex-direction:column;border:1px solid var(--accent);border-radius:12px;background:var(--card);color:var(--text);box-shadow:0 12px 44px #0003;overflow:hidden;user-select:text}
.inline-explanation header{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:11px 14px;background:var(--accent-soft);font-size:13px}.inline-explanation header div{display:flex;gap:6px;align-items:center;flex-shrink:0}.inline-explanation header button{padding:1px 7px;font-size:14px}.inline-explanation header span{font-size:11px}
.inline-explanation blockquote{padding:10px 14px;margin:0;max-height:84px;overflow:auto;font:13px/1.6 Georgia,serif;color:var(--muted);border-bottom:1px solid var(--border);white-space:pre-wrap}
.inline-explanation .inline-explanation-body{overflow:auto;padding:14px;max-height:45vh;min-height:48px;margin:0;font-size:13px;line-height:1.8}.inline-explanation footer{display:flex;gap:8px;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--border)}.inline-explanation footer button{font-size:11px;padding:4px 8px}
.qblock[data-question-id]:focus{outline:2px solid var(--accent);outline-offset:5px;scroll-margin-top:180px}
</style>

<style>::highlight(keeper-note-yellow){background:#ffe09a;color:#2c2c2a}::highlight(keeper-note-green){background:#b9e7c5;color:#153e25}::highlight(keeper-note-purple){background:#d7ccff;color:#211747}.annotation-editor{padding:10px 14px;display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;border-top:1px solid var(--border);font-size:12px}.annotation-editor label:first-child{flex:1;min-width:160px}.annotation-editor textarea,.annotation-editor select{display:block;width:100%;box-sizing:border-box;padding:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:6px}.saved-annotations{padding:12px;margin-bottom:16px;background:var(--card);border:1px solid var(--border);border-radius:8px;font-size:12px}.saved-annotations>div{padding:8px;border-bottom:1px solid var(--border)}.saved-annotations button{text-align:left;font-size:12px}</style>

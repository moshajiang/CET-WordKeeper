<template>
  <div class="reader-ai-controls">
    <span>✦ 划选原文后可就地讲解，也可让 AI 定位证据与题目</span>
    <button v-if="notes.length" @click="reopen">查看讲解 {{ active+1 }}/{{ notes.length }}</button>
    <button v-if="notes.length" @click="clear">清除 AI 标注</button>
  </div>
  <Teleport to="body">
    <section v-if="visible && note" ref="card" class="inline-explanation" :style="position" role="dialog" aria-label="原文旁 AI 讲解" @click.stop @mouseup.stop @keydown.esc.stop="visible=false">
      <header><strong>✦ {{ note.title || 'AI 讲解' }}</strong><div><button v-if="notes.length>1" @click="change(-1)" aria-label="上一处讲解">‹</button><span v-if="notes.length>1">{{ active+1 }}/{{ notes.length }}</span><button v-if="notes.length>1" @click="change(1)" aria-label="下一处讲解">›</button><button @click="visible=false" aria-label="收起原文讲解">×</button></div></header>
      <blockquote>{{ note.quote }}</blockquote>
      <div class="inline-explanation-body ai-result md-body" aria-live="polite" v-html="renderMarkdown(note.explanation)"></div>
      <footer><button v-if="result?.loading" @click="emit('cancel')">取消请求</button><button @click="followUp">继续追问</button><button @click="locate">定位原文</button><button @click="clear">清除标注</button></footer>
    </section>
  </Teleport>
</template>
<script setup>
import {ref,computed,watch,nextTick,onMounted,onBeforeUnmount} from 'vue';
import {usePageAssistant} from '../composables/usePageAssistant.js';
import {findArticleRange,normalizedText,placeExplanation} from '../utils/page-anchors.js';
import {renderMarkdown} from '../utils/md.js';
const props=defineProps({detail:Object,passageId:Number,layout:String,translation:String,fontSize:Number,result:Object});
const emit=defineEmits(['passage','view','cancel','close-result']);
const assistant=usePageAssistant(),notes=ref([]),active=ref(0),visible=ref(false),card=ref(null);
const position=ref({left:'240px',top:'200px'}),selection=ref('');
const note=computed(()=>notes.value[active.value] || null);
let ranges=[],unregister=null,frame=0,resizeObserver=null,disposed=false,applying=false,selectionOccurrence=0,revision=0;
const article=()=>document.querySelector('.article');
const current=()=>props.detail?.passages.find(p=>p.id===props.passageId);
function snapshot(){return {key:JSON.stringify([props.detail?.exam.id,props.passageId,current()?.content]),context:{page:'reader',examId:props.detail?.exam.id,passageId:props.passageId,selection:selection.value,selectionOccurrence,view:{layout:props.layout,translation:props.translation,fontSize:props.fontSize}}};}
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
function refreshRanges(){ranges=notes.value.map(n=>findArticleRange(article(),n.quote,n.occurrence||0));paint();schedulePosition();}
function clear(invalidate=true){if(invalidate)++revision;notes.value=[];ranges=[];visible.value=false;paint();emit('close-result');}
function reopen(){visible.value=true;nextTick(schedulePosition);}
function locate(){
  const range=ranges[active.value];
  range?.startContainer.parentElement?.scrollIntoView({block:'center',inline:'nearest'});
  schedulePosition();
}
function change(delta){active.value=(active.value+delta+notes.value.length)%notes.value.length;paint();locate();}
function followUp(){selection.value=note.value.quote;selectionOccurrence=note.value.occurrence||0;assistant.compose(note.value.quote);}
function selectEvidence(){
  const selected=window.getSelection();
  if(!selected?.rangeCount||selected.isCollapsed)return;
  const range=selected.getRangeAt(0),root=article();
  if(!root?.contains(range.startContainer)||!root.contains(range.endContainer))return;
  const containingBlock=node=>(node.nodeType===Node.ELEMENT_NODE?node:node.parentElement)?.closest('[data-ai-text]');
  const start=containingBlock(range.startContainer)||(range.startContainer===root?root.querySelector('[data-ai-text]'):null),end=containingBlock(range.endContainer)||(range.endContainer===root?root.querySelector('[data-ai-text]:last-child'):null);
  if(!start||!end){selection.value='';return;}
  const text=selected.toString().trim();if(!text||text.length>4000){selection.value='';return;}
  selection.value=text;selectionOccurrence=0;
  for(let i=0;i<100;i++){
    const candidate=findArticleRange(root,text,i);
    if(!candidate)break;
    if(range.comparePoint(candidate.startContainer,candidate.startOffset)===0 && range.comparePoint(candidate.endContainer,candidate.endOffset)===0){selectionOccurrence=i;break;}
  }
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
    return nextNotes.length?`已在原文高亮 ${nextNotes.length} 处，讲解显示在附近。`:questionId?'已定位题目。':'已调整阅读页面。';
  }finally{applying=false;}
}
function hit(event){
  if(!article()?.contains(event.target))return;
  if(event.target.closest?.('.inline-explanation,.assistant-panel,.selmenu,.popover'))return;
  if(window.getSelection()?.toString().trim())return;
  const index=ranges.findIndex(range=>range&&[...range.getClientRects()].some(rect=>event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom));
  if(index>=0){event.preventDefault();event.stopPropagation();active.value=index;visible.value=true;paint();schedulePosition();}
}
watch(()=>[props.passageId,current()?.content],()=>{
  if(!applying){assistant.invalidate();clear();}
  else clear(false);
  selection.value='';selectionOccurrence=0;
});
watch(()=>[props.layout,props.translation,props.fontSize],async()=>{await nextTick();refreshRanges();});
watch(()=>props.result,async value=>{
  if(!value)return;
  notes.value=[{quote:value.source,occurrence:selectionOccurrence,title:value.kind==='translate'?'整句翻译':'语法分析',explanation:value.text}];
  active.value=0;visible.value=true;await nextTick();refreshRanges();
});
watch([visible,note],()=>nextTick(schedulePosition));
onMounted(()=>{
  unregister=assistant.register({label:'当前真题与文章',snapshot,matches,apply});
  document.addEventListener('mouseup',selectEvidence);document.addEventListener('click',hit,true);
  window.addEventListener('scroll',schedulePosition,true);window.addEventListener('resize',schedulePosition);
  resizeObserver=new ResizeObserver(schedulePosition);if(article())resizeObserver.observe(article());
});
onBeforeUnmount(()=>{
  disposed=true;++revision;unregister?.();cancelAnimationFrame(frame);resizeObserver?.disconnect();
  document.removeEventListener('mouseup',selectEvidence);document.removeEventListener('click',hit,true);
  window.removeEventListener('scroll',schedulePosition,true);window.removeEventListener('resize',schedulePosition);
  notes.value=[];ranges=[];paint();
});
defineExpose({explainSelection,quote,clear});
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

<template>
  <Teleport to="body">
    <button v-if="!open" class="assistant-launcher" @click="show" :aria-label="busy ? 'AI 正在处理，打开助手' : '打开 AI 页面助手'">{{ busy ? '◌ AI 处理中' : '✦ AI 助手' }}<kbd>Ctrl J</kbd></button>
    <section v-else ref="panel" class="assistant-panel chat-card" :class="{expanded}" role="dialog" aria-label="AI 页面助手" @keydown.esc.stop="hide">
      <header>
        <div><strong>✦ AI 页面助手</strong><small>{{ contextLabel }} · 可定位原文并就地讲解</small></div>
        <div class="assistant-window-actions">
          <button @click="expanded = !expanded" :aria-label="expanded ? '缩小助手' : '展开助手'">{{ expanded ? '收起宽屏' : '展开' }}</button>
          <button @click="hide" aria-label="收起 AI 助手">×</button>
        </div>
      </header>
      <div class="assistant-body chat-msgs" ref="history" role="log" aria-label="AI 对话记录" aria-live="polite">
        <div v-if="!messages.length" class="assistant-empty">
          <h2>直接告诉我你想怎么学</h2>
          <p>可以让我高亮原文、就地解释、定位题目或调整页面。也可以划选文章，直接在原文旁查看讲解。</p>
          <button v-for="prompt in suggestions" :key="prompt" @click="ask(prompt)" :disabled="busy || clearing">{{ prompt }} ↗</button>
        </div>
        <article v-for="(message,index) in messages" :key="index" class="chat-msg" :class="message.role">
          <small>{{ message.role === 'user' ? '你' : 'AI 助手' }}{{ message.pending ? ' · 正在处理' : '' }}</small>
          <div v-if="message.role === 'assistant'" class="bubble md-body" v-html="renderMarkdown(message.content)"></div>
          <div v-else class="bubble">{{ message.content }}</div>
          <div v-if="message.sources?.length" class="assistant-sources"><small>参考资料与原文定位（请结合回答核对）</small><button v-for="(source,i) in message.sources" :key="i" @click="openSource(source)">{{ source.title }}</button></div>
        </article>
        <div v-if="busy && preview" class="md-body assistant-preview" v-html="renderMarkdown(preview)"></div>
        <div v-if="busy" class="assistant-thinking" role="status">{{ preview?'正在生成讲解，完成校验后执行页面操作…':'正在阅读问题与当前材料…' }} <button @click="stop()">停止生成</button></div>
      </div>
      <footer>
        <div v-if="notice" class="assistant-notice" role="status">{{ notice }} <button v-if="notice.includes('尚未配置')" @click="settings">打开设置</button></div>
        <div v-if="messages.length" class="assistant-quick-actions"><button v-for="prompt in suggestions" :key="prompt" @click="ask(prompt)" :disabled="busy||clearing">{{ prompt }}</button></div>
        <div class="chat-input-row">
          <textarea ref="composer" v-model="input" rows="3" maxlength="8000" aria-label="向 AI 提问或请求页面操作" placeholder="例如：高亮这篇文章的转折句，并在旁边解释" @keydown.enter.exact="onEnter" @keydown.enter.ctrl="onEnter"></textarea>
          <button class="primary" @click="send()" :disabled="busy || clearing || !input.trim()">发送</button>
        </div>
        <div class="assistant-footer"><span>Enter 发送 · Shift+Enter 换行 · Esc 收起</span><button title="清空历史" @click="clear" :disabled="clearing">{{ clearing ? '清空中…' : '清空对话' }}</button></div>
      </footer>
    </section>
  </Teleport>
</template>
<script setup>
import {computed,ref,watch,nextTick,onMounted,onBeforeUnmount} from 'vue';
import {useRouter,useRoute} from 'vue-router';
import {usePageAssistant} from '../composables/usePageAssistant.js';
import {renderMarkdown} from '../utils/md.js';
const assistant=usePageAssistant();
const {open,expanded,messages,input,busy,preview,notice,clearing,contextLabel,send,stop,clear}=assistant;
const router=useRouter(),route=useRoute(),panel=ref(null),history=ref(null),composer=ref(null);
let previousFocus=null;
const suggestions=computed(()=>route.path.startsWith('/reader')&&assistant.section.value==='writing'?['检查当前作文的论点与例子是否对应','检查当前作文的语法，解释修改原因']:route.path.startsWith('/reader')&&assistant.section.value==='translation'?['检查当前译文是否漏掉条件与数字','解释当前译文中需要修改的表达']:route.path.startsWith('/reader') ? ['高亮这篇文章的主旨句，并在原文旁解释','切换为左右布局，让题目和原文并排','定位到本篇第一道题'] : route.name==='knowledge'?['解释当前知识点，给一个新例子','根据当前知识点出一道自测题，先不展示答案']:route.name==='review'?['怎样区分模糊和真正会用？','打开知识库']:route.name==='words'?['怎样结合原句记住一个词？','打开复习']:route.name==='settings'?['怎样配置兼容的 AI 服务？']:['打开真题库','我应该怎样结合真题记单词？','打开生词本']);
function openSource(source){if(source.kind==='knowledge'&&typeof source.key==='string')router.push({path:'/knowledge',query:{entry:source.key}});else if(source.kind==='passage'&&Number.isSafeInteger(source.examId)&&Number.isSafeInteger(source.passageId))router.push({path:'/reader/'+source.examId,query:{passage:String(source.passageId)}});}

function show(){open.value=true;}
function hide(){open.value=false;previousFocus?.focus?.();}
function ask(text){input.value=text;send();}
function settings(){router.push('/settings');}
function onEnter(event){if(event.isComposing || event.keyCode===229)return;event.preventDefault();send();}
function onKey(event){
  if(event.isComposing||event.repeat)return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='j'){event.preventDefault();open.value?hide():show();}
  if(event.key==='Escape'&&open.value){event.preventDefault();hide();}
}
watch(open,async value=>{if(value){previousFocus=document.activeElement;if(!busy.value)assistant.loadHistory();await nextTick();composer.value?.focus();history.value?.scrollTo(0,history.value.scrollHeight);}});
watch(()=>[messages.value.length,busy.value,preview.value],async()=>{await nextTick();history.value?.scrollTo(0,history.value.scrollHeight);});
onMounted(()=>{assistant.loadHistory();document.addEventListener('keydown',onKey);});
onBeforeUnmount(()=>{assistant.stop();document.removeEventListener('keydown',onKey);});
</script>
<style>
.assistant-launcher{position:fixed;right:24px;bottom:22px;z-index:80;display:flex;align-items:center;gap:16px;background:var(--accent);color:#fff;border:0;border-radius:24px;padding:12px 18px;box-shadow:0 6px 24px #0002;font-size:14px}
.assistant-launcher kbd{font:11px inherit;opacity:.8;border:1px solid #ffffff55;padding:1px 5px;border-radius:4px}
.assistant-panel{position:fixed;right:16px;top:16px;bottom:16px;width:min(460px,calc(100vw - 32px));z-index:110;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--border);border-radius:16px;box-shadow:0 16px 80px #0003;color:var(--text);overflow:hidden;user-select:text}
.assistant-panel.expanded{width:min(850px,calc(100vw - 48px))}
.assistant-panel header{padding:18px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.assistant-panel header strong{font-size:17px}.assistant-panel header small{display:block;color:var(--muted);font-size:11px;margin-top:4px}
.assistant-window-actions{display:flex;gap:6px;flex-shrink:0}.assistant-window-actions button{padding:4px 8px;font-size:12px}
.assistant-panel .assistant-body{flex:1;min-height:0;overflow:auto;padding:22px 20px;max-height:none;display:block}
.assistant-empty{padding:24px 0}.assistant-empty h2{font-size:20px;margin-bottom:12px}.assistant-empty p{font-size:13px;color:var(--muted);margin-bottom:24px}.assistant-empty button{display:block;text-align:left;width:100%;margin:10px 0;padding:12px;background:var(--bg)}
.assistant-panel .chat-msg{display:block;margin-bottom:22px}.assistant-panel .chat-msg small{font-size:11px;color:var(--muted);display:block;margin-bottom:6px}.assistant-panel .bubble{padding:12px 14px;border-radius:10px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;background:var(--bg);max-width:100%}.assistant-panel .assistant .bubble{white-space:normal;background:transparent;padding:0}.assistant-panel .user .bubble{background:var(--accent-soft)}
.assistant-panel footer{border-top:1px solid var(--border);padding:14px 18px;background:var(--card)}.assistant-panel .chat-input-row{display:flex;gap:8px;align-items:flex-end}.assistant-panel textarea{flex:1;min-width:0;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:12px;font:14px inherit;resize:vertical;max-height:210px;min-height:82px}.assistant-panel textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
.assistant-footer{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;font-size:11px;color:var(--muted)}.assistant-footer button{font-size:11px;padding:3px 7px}.assistant-notice{font-size:12px;color:var(--muted);margin-bottom:10px}.assistant-thinking{font-size:13px;color:var(--muted)}.assistant-thinking button{margin-left:8px;font-size:12px}
</style>

<style>.assistant-sources{margin-top:10px;display:flex;gap:6px;flex-wrap:wrap}.assistant-sources small{width:100%}.assistant-sources button{font-size:11px;padding:4px 7px;text-align:left}.assistant-preview{font-size:14px;line-height:1.8;overflow-wrap:anywhere;margin:16px 0}</style>

<style>.assistant-quick-actions{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:9px}.assistant-quick-actions button{font-size:11px;padding:4px 7px;text-align:left}</style>

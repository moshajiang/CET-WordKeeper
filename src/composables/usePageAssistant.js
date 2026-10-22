import { ref } from 'vue';
import { createAiTasks } from '../utils/ai-tasks.js';

export function createPageAssistant({getApi = () => window.keeper, navigate = () => {}} = {}) {
  const open = ref(false), expanded = ref(false), messages = ref([]), input = ref('');
  const busy = ref(false), notice = ref(''), clearing = ref(false), contextLabel = ref('当前页面');
  const tasks = createAiTasks(id => getApi().cancelAi?.(id));
  let adapter = null, epoch = 0, historySequence = 0, page = 'home', navigateTo = navigate;
  function stop(restoreInput = true) {
    tasks.cancel('chat'); ++historySequence;
    const pending = messages.value.find(m => m.pending);
    messages.value = messages.value.filter(m => !m.pending);
    if (pending && restoreInput && !input.value) input.value = pending.content;
    if (busy.value && restoreInput) notice.value = '已停止生成，问题已保留，可重新发送。';
    busy.value = false;
  }
  function invalidate() { ++epoch; stop(); }
  function setPage(value) { invalidate(); adapter = null; page = value; contextLabel.value = '当前页面'; }
  function register(value) {
    invalidate(); adapter = value; contextLabel.value = value.label || '当前文章';
    return () => { if (adapter === value) { invalidate(); adapter = null; contextLabel.value = '当前页面'; } };
  }
  async function loadHistory() {
    if (clearing.value) return;
    const sequence = ++historySequence;
    try {
      const rows = await getApi().chatHistory();
      if (sequence === historySequence) messages.value = rows || [];
    } catch (error) { if (sequence === historySequence) notice.value = '历史加载失败：' + error.message; }
  }
  async function clear() {
    if (clearing.value) return;
    stop(false); ++historySequence;
    clearing.value = true; notice.value = '';
    try {
      const result = await getApi().chatClear();
      if (!result.ok) throw Error(result.error || '未知错误');
      ++historySequence;
      messages.value = [];
    } catch (error) {
      notice.value = '清空失败，历史已保留：' + error.message; clearing.value = false; await loadHistory();
    } finally { clearing.value = false; }
  }
  function compose(text) { open.value = true; input.value = (input.value ? input.value + '\n' : '') + '“' + text + '”\n'; }
  async function send(value, options = {}) {
    const text = (typeof value === 'string' ? value : input.value).trim();
    if (!text || busy.value || clearing.value) return;
    if (text.length > 8000) { notice.value = '问题过长，请缩短到 8000 字以内。'; return; }
    const source = adapter, version = epoch, snapshot = source?.snapshot?.();
    const task = tasks.start('chat'); ++historySequence;
    let applying = false;
    const isCurrent = () => task.isCurrent() && version === epoch && adapter === source && (applying || !source || source.matches(snapshot));
    input.value = ''; notice.value = ''; busy.value = true;
    messages.value.push({role:'user',content:text,pending:true});
    try {
      const payload = {...(snapshot?.context || {page}),text,inline:!!options.inline};
      const api = getApi();
      const result = api.assistantRun ? await api.assistantRun(payload,task.id)
        : await api.chatSend(payload.examId || null,payload.passageId || null,text,task.id);
      if (!isCurrent()) { if (task.isCurrent()) stop(); return; }
      if (!result.ok) {
        const hints = {no_key:'尚未配置 AI 服务，请到设置填写 API 地址与 Key。',cancelled:'已停止生成，可重新发送。',bad_ai_action:'AI 操作格式不正确，页面未改变，请重试。',quote_not_found:'AI 引文未能对应原文，页面未改变，请重试。',ambiguous_quote:'AI 引文对应多处原文，页面未改变，请重试。',conflicting_actions:'AI 返回了冲突的页面操作，页面未改变，请重试。',translation_unavailable:'目标篇章暂无译文，页面未改变。'};
        throw Error(hints[result.error] || '请求失败：' + result.error);
      }
      messages.value = messages.value.map(m => m.pending ? {role:'user',content:text} : m);
      const message = {role:'assistant',content:result.reply}; messages.value.push(message);
      if (result.actions?.length) {
        const route = result.actions.find(a => a.type === 'navigate_page');
        if (route) {
          if (result.actions.length !== 1 || !['home','library','words','review','knowledge','settings','recite'].includes(route.page)) throw Error('页面操作无效');
          task.finish(); busy.value = false;
          try { await navigateTo(route.page,payload); notice.value = '已打开目标页面。'; }
          catch (error) { notice.value = '页面打开失败：' + error.message; open.value = true; }
        } else {
          if (!source) throw Error('当前页面不支持该操作');
          applying = true;
          const feedback = await source.apply(result.actions,isCurrent);
          if (!isCurrent()) return;
          notice.value = feedback || '已完成页面操作。';
          if (result.actions.some(a => a.type === 'highlight')) open.value = false;
        }
      } else if (options.inline) notice.value = 'AI 已回答，可在助手中查看。';
    } catch (error) {
      if (!task.isCurrent() || version !== epoch) return;
      messages.value = messages.value.filter(m => !m.pending);
      if (!input.value) input.value = text;
      notice.value = error.message;
      open.value = true;
    } finally { if (task.isCurrent()) busy.value = false; task.finish(); }
  }
  return {open,expanded,messages,input,busy,notice,clearing,contextLabel,stop,invalidate,setPage,register,loadHistory,clear,compose,send,setNavigate:fn=>{navigateTo=fn;}};
}
let shared;
export function usePageAssistant() { return shared ||= createPageAssistant(); }

import { shallowRef } from 'vue';

// App 与首页共用快照；变更事件使在途旧快照失效，额外请求合并为一次重读。
export function createLearningState({ load = () => window.keeper.stats(), subscribe = callback => window.keeper.onLearningChanged(callback),
  host = window, visibility = document, clock = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const stats = shallowRef({ learning:0,mastered:0,dueNow:0,reviewedToday:0,exams:0 });
  const error = shallowRef('');
  let pending = null, revision = 0, loadingRevision = -1, dirty = false, running = false, timer = null, off = null;
  function schedule() {
    clearTimer(timer);
    if (!running) return;
    let delay = 60000; // 同时防护系统时钟、时区变化，不依赖固定 24 小时。
    for (const value of [stats.value.nextDue,stats.value.dayEnd]) {
      const when = Date.parse(value);
      // IPC 返回时可能刚好越过到期/午夜边界；立即补读，失败时退回分钟级重试。
      if (Number.isFinite(when) && !error.value) delay = Math.min(delay,Math.max(1,when-clock()));
    }
    timer = setTimer(() => { void invalidate(); },Math.max(1,delay));
  }
  function refresh() {
    if (pending) return pending;
    pending = (async () => {
      let ok = false;
      do {
        dirty = false;
        const version = revision;
        loadingRevision = version;
        try {
          const value = await load();
          if (!value || ['learning','mastered','dueNow','reviewedToday','exams'].some(k => !Number.isFinite(value[k]) || value[k]<0)) throw new Error('Invalid learning statistics');
          if (version === revision) { stats.value = value; error.value = ''; ok = true; }
        } catch (cause) { if (version === revision) error.value = cause.message; }
      } while (dirty);
      return ok;
    })().finally(() => { pending = null; schedule(); });
    return pending;
  }
  function invalidate() { ++revision; if (pending) dirty = true; return refresh(); }
  function onVisible() { if (visibility.visibilityState === 'visible') void invalidate(); }
  function start() {
    if (running) return refresh();
    running = true;
    host.addEventListener('focus',invalidate);
    visibility.addEventListener('visibilitychange',onVisible);
    off = subscribe(() => { void invalidate(); });
    if (pending && loadingRevision !== revision) dirty = true;
    return refresh();
  }
  function stop() {
    running = false; ++revision; dirty = false;
    clearTimer(timer); off?.(); off = null;
    host.removeEventListener('focus',invalidate);
    visibility.removeEventListener('visibilitychange',onVisible);
  }
  return { stats,error,refresh,invalidate,start,stop };
}
let shared;
export function useLearningState() { return shared ||= createLearningState(); }

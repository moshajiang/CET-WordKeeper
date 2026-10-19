// 每次编辑即保留恢复副本；队列捕获草稿身份，切页/关闭时不会把旧内容写到新章节。
export function createEssayDrafts({ save, storage, onSaved = () => {}, onError = () => {}, delay = 800,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  const pending = new Map();
  const latest = new Map();
  let timer = null;
  let chain = Promise.resolve(true);
  const keyOf = (draft) => `keeper.essay.draft:${draft.examId}:${draft.section}`;
  const recover = (draft) => {
    try {
      const stored = JSON.parse(storage.getItem(keyOf(draft)) || 'null');
      return stored && stored.examId === draft.examId && stored.section === draft.section && typeof stored.content === 'string' ? stored : null;
    } catch { return null; }
  };
  function flush() {
    clearTimer(timer);
    timer = null;
    const batch = [...pending.entries()];
    pending.clear();
    chain = chain.then(async () => {
      let ok = true;
      for (const [key, draft] of batch) {
        try {
          const result = await save(draft.examId, draft.section, draft.content);
          if (!result || !result.ok) throw new Error(result?.error || '保存失败');
          if (recover(draft)?.content === draft.content) storage.removeItem(key);
          onSaved(draft);
        } catch (error) {
          // 更新的编辑优先，失败的旧任务不能覆盖新任务。
          if (latest.get(key) === draft && !pending.has(key)) pending.set(key, draft);
          ok = false;
          onError(error, draft);
        }
      }
      return ok && pending.size === 0;
    });
    return chain;
  }
  function schedule(value) {
    const draft = { examId: value.examId, section: value.section, content: String(value.content) };
    latest.set(keyOf(draft), draft);
    pending.set(keyOf(draft), draft);
    try { storage.setItem(keyOf(draft), JSON.stringify(draft)); } catch (error) { onError(error, draft); }
    clearTimer(timer);
    timer = setTimer(() => { void flush(); }, delay);
  }
  return { schedule, flush, recover };
}

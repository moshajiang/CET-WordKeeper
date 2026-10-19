// 作答草稿捕获考次、内容版本及交卷代次；同步恢复副本覆盖关闭时未完成的 IPC。
export function createAnswerDrafts({ save, storage, onState = () => {}, delay = 500,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  const pending = new Map(), latest = new Map();
  let timer = null, chain = Promise.resolve(true);
  const keyOf = value => `keeper.answer.draft:${value.examId}`;
  const same = (a,b) => a?.examId === b?.examId && a?.revision === b?.revision && a?.generation === b?.generation;
  const peek = target => { try { return JSON.parse(storage.getItem(keyOf(target)) || 'null'); } catch { return null; } };
  function recover(target) {
    const value = peek(target);
    return same(value,target) && value.answers && typeof value.answers === 'object' && !Array.isArray(value.answers) ? value : null;
  }
  function flush() {
    clearTimer(timer); timer = null;
    const batch = [...pending.entries()]; pending.clear();
    chain = chain.then(async () => {
      let ok = true;
      for (const [key,draft] of batch) {
        if (latest.get(key) !== draft) continue;
        try {
          const result = await save(draft.examId, { revision:draft.revision, generation:draft.generation, answers:draft.answers });
          if (!result?.ok) throw new Error(result?.error || '保存失败');
          if (JSON.stringify(peek(draft)) === JSON.stringify(draft)) storage.removeItem(key);
          if (latest.get(key) === draft) onState('saved',draft);
        } catch (error) {
          if (latest.get(key) === draft) {
            if (!pending.has(key) && !['stale_draft','already_graded'].includes(error.message)) pending.set(key,draft);
            onState('error',draft,error);
          }
          ok = false;
        }
      }
      return ok && pending.size === 0;
    });
    return chain;
  }
  function schedule(value) {
    const draft = { examId:value.examId, revision:value.revision, generation:value.generation, answers:{...value.answers} };
    const key = keyOf(draft); latest.set(key,draft); pending.set(key,draft);
    let stored = true;
    try { storage.setItem(key,JSON.stringify(draft)); } catch (error) { stored = false; onState('error',draft,error); }
    if (stored) onState('saving',draft);
    clearTimer(timer); timer = setTimer(() => { void flush(); }, stored ? delay : 0);
  }
  function discard(target) {
    const key = keyOf(target);
    if (same(pending.get(key),target)) pending.delete(key);
    if (same(latest.get(key),target)) latest.delete(key);
    if (same(peek(target),target)) { try { storage.removeItem(key); } catch { /* 代次校验阻止旧副本复活 */ } }
  }
  return { schedule,flush,recover,peek,discard };
}

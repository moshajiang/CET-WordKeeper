export function createAiTasks(cancel) {
  const active = new Map();
  const prefix = Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  let sequence = 0;
  function stop(key) {
    const task = active.get(key);
    if (!task) return;
    active.delete(key); // Invalidate locally before IPC; stale results stay harmless if IPC fails.
    try { Promise.resolve(cancel(task.id)).catch(() => {}); } catch { /* teardown may have closed IPC */ }
  }
  return {
    start(key) {
      stop(key);
      const task = {id:prefix+'-'+(++sequence),
        isCurrent:() => active.get(key) === task,
        finish() { if (active.get(key) === task) active.delete(key); },
      };
      active.set(key,task); return task;
    },
    cancel:stop,
    requestCancel(key) {
      const task = active.get(key);
      if (task) { try { Promise.resolve(cancel(task.id)).catch(() => {}); } catch {} }
    },
    cancelAll() { for (const key of [...active.keys()]) stop(key); },
  };
}

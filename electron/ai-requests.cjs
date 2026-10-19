const { randomUUID } = require('node:crypto');

function createAiRequests() {
  const active = new Map();
  function start(owner, id, kind) {
    id ??= randomUUID();
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id)) throw Error('invalid_request_id');
    const key = owner+':'+id;
    if (active.has(key)) throw Error('request_in_progress');
    const controller = new AbortController();
    const task = {owner,id,kind,signal:controller.signal,
      ensureActive() { if (controller.signal.aborted) throw Error('cancelled'); },
      cancel() { controller.abort(); },
      finish() { if (active.get(key) === task) active.delete(key); },
    };
    active.set(key,task);
    return task;
  }
  return {start,
    cancel(owner,id) { const task=active.get(owner+':'+id);task?.cancel();return !!task; },
    cancelOwner(owner) { for (const task of active.values()) if (task.owner === owner) task.cancel(); },
    cancelKind(kind) { for (const task of active.values()) if (task.kind === kind) task.cancel(); },
    cancelAll() { for (const task of active.values()) task.cancel(); },
  };
}

// Cancellation and deadline share one signal, including response body reads.
// The caller also checks task validity after awaits, even when a transport ignores abort.
function requestSignal(task,timeoutMs) {
  const deadline = AbortSignal.timeout(timeoutMs);
  return task ? AbortSignal.any([task.signal,deadline]) : deadline;
}
module.exports = {createAiRequests,requestSignal};

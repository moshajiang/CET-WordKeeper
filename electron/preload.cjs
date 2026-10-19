const { contextBridge, ipcRenderer } = require('electron');

// IPC 使用结构化克隆传输参数，而 Vue 的响应式代理（ref / reactive 对象的 .value）
// 无法被克隆，会抛出 "An object could not be cloned."；且失败是静默的
// （调用方 await 直接 reject），界面上的表现是「页面永远加载不出内容」。
// 这里统一把对象载荷转成普通对象，从根上杜绝这一类问题。
const plain = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

contextBridge.exposeInMainWorld('keeper', {
  info: () => ipcRenderer.invoke('app:info'),
  lookup: (w) => ipcRenderer.invoke('dict:lookup', w),
  dictLex: () => ipcRenderer.invoke('dict:lex'),
  resolveWords: (words) => ipcRenderer.invoke('dict:resolveBatch', plain(words)),
  listExams: () => ipcRenderer.invoke('exams:list'),
  examDetail: (id) => ipcRenderer.invoke('exam:detail', id),
  addWord: (w, sentence, pid) => ipcRenderer.invoke('words:add', w, sentence, pid),
  removeWord: (w) => ipcRenderer.invoke('words:remove', w),
  setWordStatus: (w, s) => ipcRenderer.invoke('words:setStatus', w, s),
  saveNote: (w, n) => ipcRenderer.invoke('words:saveNote', w, n),
  allWords: () => ipcRenderer.invoke('words:all'),
  listWords: (f) => ipcRenderer.invoke('words:list', plain(f)),
  wordDetail: (w) => ipcRenderer.invoke('words:detail', w),
  reviewQueue: () => ipcRenderer.invoke('review:queue'),
  reviewAnswer: (w, r, operationId) => ipcRenderer.invoke('review:answer', w, r, operationId),
  stats: () => ipcRenderer.invoke('stats:summary'),
  onLearningChanged: (callback) => {
    const listener = (_e, event) => callback(plain(event));
    ipcRenderer.on('learning:changed',listener);
    return () => ipcRenderer.removeListener('learning:changed',listener);
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', plain(s)),
  translate: (t, id) => ipcRenderer.invoke('ai:translate', t, id),
  cancelAi: id => ipcRenderer.invoke('ai:cancel', id),
  grammar: (t, id) => ipcRenderer.invoke('ai:grammar', t, id),
  testConnection: (settings, id) => ipcRenderer.invoke('ai:testConnection', plain(settings), id),
  scanHard: (content, level) => ipcRenderer.invoke('scan:hard', content, level),
  importExam: (payload) => ipcRenderer.invoke('import:exam', payload),
  exportAnki: (filter) => ipcRenderer.invoke('export:anki', plain(filter)),
  backupDialog: () => ipcRenderer.invoke('backup:dialog'),
  restorePreview: () => ipcRenderer.invoke('backup:restorePreview'),
  restoreCancel: () => ipcRenderer.invoke('backup:restoreCancel'),
  restoreCommit: token => ipcRenderer.invoke('backup:restoreCommit',token),
  backupExport: (targetPath) => ipcRenderer.invoke('backup:export', targetPath),
  examAnalysis: (examId, id) => ipcRenderer.invoke('exam:analysis', examId, id),
  attemptGet: (examId) => ipcRenderer.invoke('attempt:get', examId),
  attemptSaveDraft: (examId, draft) => ipcRenderer.invoke('attempt:saveDraft', examId, plain(draft)),
  attemptSubmit: (examId, answers, context, id) => ipcRenderer.invoke('attempt:submit', examId, plain(answers), plain(context), id),
  attemptClear: (examId, context) => ipcRenderer.invoke('attempt:clear', examId, plain(context)),
  chatSend: (examId, passageId, text, id) => ipcRenderer.invoke('chat:send', examId, passageId, text, id),
  chatHistory: () => ipcRenderer.invoke('chat:history'),
  chatClear: () => ipcRenderer.invoke('chat:clear'),
  kbList: () => ipcRenderer.invoke('kb:list'),
  kbAdd: (title, content) => ipcRenderer.invoke('kb:add', title, content),
  kbRemove: (id) => ipcRenderer.invoke('kb:remove', id),
  essayGet: (examId, section) => ipcRenderer.invoke('essay:get', examId, section),
  essaySave: (examId, section, content) => ipcRenderer.invoke('essay:save', examId, section, content),
  essayGrade: (examId, section, id) => ipcRenderer.invoke('essay:grade', examId, section, id),
  // 版本更新
  updateCheck: (source) => ipcRenderer.invoke('update:check', source),
  updateState: () => ipcRenderer.invoke('update:state'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  updateOpenReleases: (source) => ipcRenderer.invoke('update:openReleases', source),
  onUpdateEvent: (cb) => {
    const l = (_e, d) => cb(plain(d));
    ipcRenderer.on('update:event', l);
    return () => ipcRenderer.removeListener('update:event', l);
  },
});

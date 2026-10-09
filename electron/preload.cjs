const { contextBridge, ipcRenderer } = require('electron');

// IPC 使用结构化克隆传输参数，而 Vue 的响应式代理（ref / reactive 对象的 .value）
// 无法被克隆，会抛出 "An object could not be cloned."；且失败是静默的
// （调用方 await 直接 reject），界面上的表现是「页面永远加载不出内容」。
// 这里统一把对象载荷转成普通对象，从根上杜绝这一类问题。
const plain = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

contextBridge.exposeInMainWorld('keeper', {
  info: () => ipcRenderer.invoke('app:info'),
  lookup: (w) => ipcRenderer.invoke('dict:lookup', w),
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
  reviewAnswer: (w, r) => ipcRenderer.invoke('review:answer', w, r),
  stats: () => ipcRenderer.invoke('stats:summary'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', plain(s)),
  translate: (t) => ipcRenderer.invoke('ai:translate', t),
  grammar: (t) => ipcRenderer.invoke('ai:grammar', t),
  scanHard: (content, level) => ipcRenderer.invoke('scan:hard', content, level),
  importExam: (payload) => ipcRenderer.invoke('import:exam', payload),
  exportAnki: (filter) => ipcRenderer.invoke('export:anki', plain(filter)),
  backupDialog: () => ipcRenderer.invoke('backup:dialog'),
  backupExport: (targetPath) => ipcRenderer.invoke('backup:export', targetPath),
  examAnalysis: (examId) => ipcRenderer.invoke('exam:analysis', examId),
  attemptGet: (examId) => ipcRenderer.invoke('attempt:get', examId),
  attemptSubmit: (examId, answers) => ipcRenderer.invoke('attempt:submit', examId, plain(answers)),
  attemptClear: (examId) => ipcRenderer.invoke('attempt:clear', examId),
  chatSend: (examId, passageId, text) => ipcRenderer.invoke('chat:send', examId, passageId, text),
  chatHistory: () => ipcRenderer.invoke('chat:history'),
  chatClear: () => ipcRenderer.invoke('chat:clear'),
  kbList: () => ipcRenderer.invoke('kb:list'),
  kbAdd: (title, content) => ipcRenderer.invoke('kb:add', title, content),
  kbRemove: (id) => ipcRenderer.invoke('kb:remove', id),
  essayGet: (examId, section) => ipcRenderer.invoke('essay:get', examId, section),
  essaySave: (examId, section, content) => ipcRenderer.invoke('essay:save', examId, section, content),
  essayGrade: (examId, section) => ipcRenderer.invoke('essay:grade', examId, section),
});

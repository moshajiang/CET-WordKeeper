// Existing VM component tests must load the real imported helper rather than stub its behavior.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
module.exports = scripts => vm.runInNewContext(fs.readFileSync(path.join(scripts,'../src/utils/ai-tasks.js'),'utf8').replace('export function','function')+'\ncreateAiTasks;');

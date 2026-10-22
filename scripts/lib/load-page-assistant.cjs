const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Vue=require('vue'),createAiTasks=require('./load-ai-tasks.cjs')(path.resolve(__dirname,'..'));
const source=fs.readFileSync(path.join(__dirname,'../../src/composables/usePageAssistant.js'),'utf8').replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
module.exports=vm.runInNewContext(source+'\ncreatePageAssistant;',{...Vue,createAiTasks});

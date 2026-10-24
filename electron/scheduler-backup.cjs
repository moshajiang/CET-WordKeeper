const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
function writeTrialBackup({directory,bytes,operationId,io=fs}){
 if(typeof directory!=='string'||!Buffer.isBuffer(bytes)||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(operationId))throw Error('调度备份参数无效');
 const folder=path.resolve(directory,'scheduler-backups'),digest=createHash('sha256').update(bytes).digest('hex'),file=path.join(folder,`keeper-before-fsrs-${operationId}-${digest.slice(0,16)}.db`),temporary=file+'.tmp-'+randomUUID();
 io.mkdirSync(folder,{recursive:true});
 if(io.existsSync(file)){if(!io.readFileSync(file).equals(bytes))throw Error('已有调度备份校验失败');return {path:file,sha256:digest};}
 try{io.writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});if(!io.readFileSync(temporary).equals(bytes))throw Error('调度备份写入校验失败');io.renameSync(temporary,file);if(!io.readFileSync(file).equals(bytes))throw Error('调度备份发布校验失败');return {path:file,sha256:digest};}
 catch(error){try{if(io.existsSync(temporary))io.unlinkSync(temporary);}catch{}throw Error('调度切换前备份未完成：'+error.message);}
}
module.exports={writeTrialBackup};

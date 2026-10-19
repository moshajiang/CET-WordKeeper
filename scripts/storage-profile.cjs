// Measure actual backend functions against a bundled seed and owned temporary files.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module'),{performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'..'),dep=process.env.KEEPER_DEPENDENCY_ROOT||root,req=createRequire(path.join(dep,'package.json'));
const indexes=[
 'CREATE INDEX IF NOT EXISTS idx_word_hit_word ON word_hit(word)',
 'CREATE INDEX IF NOT EXISTS idx_review_log_word ON review_log(word_id)',
 'CREATE INDEX IF NOT EXISTS idx_review_log_day ON review_log(reviewed_at)',
 'CREATE INDEX IF NOT EXISTS idx_user_word_due ON user_word(status,due)'
];
(async()=>{
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'cet-wordkeeper-profile-'));
 try{
 const SQL=await req('sql.js')({locateFile:f=>path.join(dep,'node_modules/sql.js/dist',f)}),handlers=new Map();
 const context=vm.createContext({Buffer,console:{log(){},error:console.error},__dirname:path.join(dep,'electron'),process:{env:{},platform:'win32'},require(name){
  if(name==='electron')return{app:{disableHardwareAcceleration(){},requestSingleInstanceLock:()=>true,on(){},whenReady:()=>({then(){}}),getPath:()=>dir},ipcMain:{handle:(n,f)=>handlers.set(n,f)},dialog:{},shell:{}};
  if(name==='electron-updater')return{autoUpdater:{on(){}}};
  return name.startsWith('./')?req(path.join(fs.existsSync(path.join(root,'electron',name))?root:dep,'electron',name)):req(name);
 }});
 vm.runInContext(fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8')+'\nglobalThis.h={initDb,q,run,persist,persistTransaction,listBookWords,rebuildWordFreq,registerIpc,close:()=>db.close()};',context);
 const h=context.h,report={node:process.version,seedBytes:fs.statSync(path.join(dep,'data/keeper.db')).size,synthetic:{words:1000,hits:10000,logs:20000}};
 async function measure(fn,n=5){const times=[];for(let i=0;i<n;i++){const start=performance.now();await fn();times.push(performance.now()-start);}times.sort((a,b)=>a-b);return{medianMs:+times[Math.floor(n/2)].toFixed(2),maxMs:+times.at(-1).toFixed(2),samples:n};}
 report.startupFirst=await measure(()=>h.initDb(),1);h.close();report.startupExisting=await measure(async()=>{await h.initDb();h.close();},3);await h.initDb();h.registerIpc();
 report.persistSeed=await measure(()=>h.persist());report.transactionSeed=await measure(()=>h.persistTransaction(()=>h.run("INSERT OR REPLACE INTO settings VALUES ('profile','1')")));
 report.wordFrequency=await measure(()=>h.rebuildWordFreq(),3);
 h.run('BEGIN');for(let i=0;i<1000;i++){h.run('INSERT INTO user_word(word,status,created_at,due) VALUES (?,\'learning\',?,?)',['profile'+i,'2026-10-19T00:00:00Z','2027-01-01T00:00:00Z']);for(let j=0;j<10;j++)h.run('INSERT INTO word_hit(word,sentence) VALUES (?,?)',['profile'+i,'sentence '+j]);for(let j=0;j<20;j++)h.run('INSERT INTO review_log(word_id,reviewed_at) VALUES (?,?)',[i+1,'2026-10-19T00:00:00Z']);}h.run('COMMIT');
 const queries=async()=>({list:await measure(()=>h.listBookWords({sortBy:'hits'}),3),queue:await measure(()=>handlers.get('review:queue')(),3),stats:await measure(()=>handlers.get('stats:summary')(),5)});
 const plan=()=>h.q('EXPLAIN QUERY PLAN SELECT u.word,(SELECT COUNT(*) FROM word_hit h WHERE h.word=u.word) hits FROM user_word u');
 // Keep the same data and query code on both sides, even after indexes become the default migration.
 for(const name of ['idx_word_hit_word','idx_review_log_word','idx_review_log_day','idx_user_word_due'])h.run('DROP INDEX IF EXISTS '+name);
 report.withoutIndexes=await queries();report.planBefore=plan();for(const sql of indexes)h.run(sql);report.withIndexes=await queries();report.planAfter=plan();
 report.persistPopulated=await measure(()=>h.persist());report.finalBytes=fs.statSync(path.join(dir,'keeper.db')).size;h.close();
 console.log(JSON.stringify(report,null,2));
 }finally{const parent=fs.realpathSync(os.tmpdir());if(path.dirname(dir)!==parent||!path.basename(dir).startsWith('cet-wordkeeper-profile-')||fs.lstatSync(dir).isSymbolicLink())throw Error('unowned temp directory');fs.rmSync(dir,{recursive:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

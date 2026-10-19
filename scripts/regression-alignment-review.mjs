import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {numericAnchors,auditPairs} from './lib/alignment-audit.mjs';
import {applyReviewedAlignment} from './lib/reviewed-alignment.mjs';
import {buildAlignmentLex} from './lib/alignment-lex.mjs';
import {alignBilingual,blankNumbers} from '../src/utils/bilingual.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dependencies=process.env.KEEPER_DEPENDENCY_ROOT||root,req=createRequire(path.join(dependencies,'package.json'));
const contentSync=req(path.join(dependencies,'electron/content-sync.cjs'));
const before=JSON.parse(fs.readFileSync(new URL('./fixtures/alignment-before-phase4j.json',import.meta.url),'utf8'));
let passed=0;const test=async(name,work)=>{await work();passed++;console.log('✓ '+name);};
const keys=text=>[...numericAnchors(text)].sort(),compact=text=>String(text||'').replace(/\s/g,'');
await test('每个锚点单独计数，四个数字全命中应为4/4而非1/4',()=>{
 const audit=auditPairs([{en:'In 2015 and 2020, 100 people paid 1,000 dollars.',zh:'2015和2020年，100人支付1000美元。'}]);assert.equal(audit.anT,4);assert.equal(audit.anHit,4);assert.equal(audit.rate,1);
});
await test('数值必须完整匹配，2015不等于12015，百分比不等于裸数',()=>{
 const audit=auditPairs([{en:'2015 with 15%.',zh:'12015和115%。'}]);assert.equal(audit.anHit,0);assert.equal(audit.anT,2);
 assert.deepEqual(keys('40'),['number:40']);assert.deepEqual(keys('40%'),['percent:40']);
});
await test('千分位、million/billion与万亿制按相同数值比较',()=>{
 assert.deepEqual(keys('1,000 and 1.65 billion; 12.5 million; $50bn.'),keys('1000，16.5亿、1250万，500亿美元。'));assert.deepEqual(keys('2 trillion'),keys('2万亿'));
});
await test('世纪与年代归一化，中文省略世纪的范围仍保留两个年代',()=>{
 assert.deepEqual(keys('1960s and 1980s, into early 2000s in the 21st century'),keys('20世纪60年代至80年代，到21世纪初，在21世纪'));
 assert.deepEqual(keys('1990s and 2000s'),keys('20世纪90年代和21世纪头十年后期'));
});
await test('百分比范围与per cent/中文百分之相等，裸空号不吞掉真实百分比',()=>{
 assert.deepEqual(keys('18-22%, 62 per cent'),keys('18%至22%，百分之六十二'));
 assert.deepEqual([...numericAnchors('26 heat and 35 percent, at 700 meters',{exclude:new Set([26,35])})].sort(),['number:700','percent:35']);
 assert.ok(numericAnchors('30 people').has('number:30'));
});
await test('同值但缺失单位单独报告，不误认作另一行漂移；多候选也不确认漂移',()=>{
 const audit=auditPairs([{en:'40 of the area.',zh:'面积40%。'},{en:'No figures.',zh:'40人。'}]);assert.equal(audit.anUnitMismatch,1);assert.equal(audit.anDrift,0);
 const ambiguous=auditPairs([{en:'100 workers.',zh:'没有数字。'},{en:'No figures.',zh:'100人。'},{en:'No figures.',zh:'100人。'}]);assert.equal(ambiguous.anAmbiguous,1);assert.equal(ambiguous.anDrift,0);
});
await test('Directions不进入锚点，邻行唯一候选按行计数并提供可复核位置',()=>{
 const audit=auditPairs([{en:'Directions: Read questions 46 to 50.',zh:''},{en:'In 2015 and 2020.',zh:'没有数字。'},{en:'No figures.',zh:'2015及2020年。'}]);assert.equal(audit.anT,2);assert.equal(audit.anDrift,1);assert.deepEqual(audit.details[0].candidateRows,[3]);
});
const SQL=await req('sql.js')({locateFile:file=>path.join(dependencies,'node_modules/sql.js/dist',file)});
const database=process.env.KEEPER_ALIGNMENT_DB || path.join(dependencies,'data/keeper.db'),db=new SQL.Database(new Uint8Array(fs.readFileSync(database)));
const q=(db,sql,args=[])=>{const stmt=db.prepare(sql);try{stmt.bind(args);const out=[];while(stmt.step())out.push(stmt.getAsObject());return out;}finally{stmt.free();}};
const passages=q(db,"SELECT p.*,e.level,e.year,e.month,e.set_no,e.imported FROM passage p JOIN exam e ON e.id=p.exam_id WHERE p.translation!=''");
const lex=buildAlignmentLex(q(db,'SELECT word,translation,exchange FROM dict'));
const aligned=new Map();
for(const passage of passages){passage.questions=q(db,'SELECT * FROM question WHERE passage_id=?',[passage.id]);aligned.set(passage.id,applyReviewedAlignment(passage,alignBilingual(passage.content,passage.translation,lex,{blankNums:blankNumbers(passage)})));}
await test('全库311篇逐字符顺序守恒，仅五篇复核数据变化，其余为固定点',()=>{
 assert.equal(passages.length,311);const originals=new Map(before.map(row=>[row.id,row.rows])),changed=[];
 for(const p of passages){const rows=aligned.get(p.id);assert.equal(compact(rows.map(row=>row.en).join('')),compact(p.content));assert.equal(compact(rows.map(row=>row.zh).join('')),compact(p.translation));if(originals.has(p.id)){assert.notDeepEqual(rows,originals.get(p.id));changed.push(p.id);}else assert.deepEqual(rows,JSON.parse(p.rows),String(p.id));}
 assert.deepEqual(changed.sort((a,b)=>a-b),[26,117,304,399,424]);
});
await test('海洋篇150年与19世纪各归正确原句；反垄断国家与公司段落不再串行',()=>{
 const ocean=aligned.get(26);assert.match(ocean.find(row=>row.en.includes('gathered 150')).zh,/150 年/);assert.match(ocean.find(row=>row.en.includes('19th century')).zh,/19 世纪/);
 const tech=aligned.get(399);assert.equal(tech.find(row=>row.en.startsWith('Germany')).zh,'德国和法国共享边界和货币，却常常争执不下。');assert.equal(tech.find(row=>row.en.startsWith('The U. K.')).zh,'英国和印度喜欢各行其是。');
 assert.match(tech.find(row=>row.en.includes('$ 37 billion')).zh,/370亿美元/);
});
await test('核能引文与可行性句边界已人工区分，配音报酬与200万销量对应',()=>{
 const nuclear=aligned.get(424);assert.doesNotMatch(nuclear.find(row=>row.en.startsWith('“Core')).zh,/可行性/);assert.match(nuclear.find(row=>row.en.includes('achievability')).zh,/可行性/);
 const actors=aligned.get(304);assert.match(actors.find(row=>row.en.includes('$825')).zh,/825美元/);assert.match(actors.find(row=>row.en.includes('2 million copies')).zh,/200万/);
});
await test('无中文字母标记的松岛篇按10个段落对齐，重复标题和段标全部保留',()=>{
 const p=passages.find(p=>p.id===117),rows=aligned.get(117);assert.equal(rows.length,10);assert.deepEqual(rows.map(row=>compact(row.zh)),p.translation.split(/\n+/).filter(Boolean).map(compact));assert.match(rows[5].en,/F\)/);assert.match(rows[5].zh,/2005/);
});
await test('无译文标记的退化规则要求连续字母和相同段数，不按不可靠下标强配',()=>{
 const en='A) First text.\nB) Second text.\nC) Third text.\nD) Fourth text.',zh='第一段。\n第二段。\n第三段。\n第四段。';
 const rows=alignBilingual(en,zh);assert.equal(rows.length,4);assert.deepEqual(rows.map(row=>row.zh),zh.split('\n'));
 const missing=alignBilingual(en,'第一段。\n第二段。');assert.equal(compact(missing.map(row=>row.en).join('')),compact(en));assert.equal(compact(missing.map(row=>row.zh).join('')),'第一段。第二段。');
});
await test('复核指纹只容忍空白排版，正文改动必须重新审查，不应用到私人导入',()=>{
 const p=passages.find(p=>p.id===26),fallback=[];assert.equal(applyReviewedAlignment({...p,imported:1},fallback),fallback);assert.throws(()=>applyReviewedAlignment({...p,content:p.content+' changed'},fallback),/须重新审查/);
 assert.deepEqual(applyReviewedAlignment({...p,content:p.content.replace(/ /g,'  ')},fallback).map(row=>compact(row.en)),aligned.get(26).map(row=>compact(row.en)));
});
await test('原七篇的真实漂移已修正，数字表达误报与语义结论分开',()=>{
 for(const id of [26,33,117,315,335,399,424]){const p=passages.find(p=>p.id===id),audit=auditPairs(aligned.get(id),{exclude:blankNumbers(p)});assert.equal(audit.anDrift,0,String(id));assert.ok(audit.rate===null||audit.rate>=0.7,id+': '+audit.rate);}
});
await test('仅rows变化的内置同步保留所有ID、用户数据与成绩版本，第二次同步幂等',()=>{
 const bytes=db.export(),local=new SQL.Database(new Uint8Array(bytes)),seed=new SQL.Database(new Uint8Array(bytes));
 for(const p of before)local.run('UPDATE passage SET rows=? WHERE id=?',[JSON.stringify(p.rows),p.id]);contentSync.stampBuiltinContent(local);
 for(const [id,rows] of aligned)seed.run('UPDATE passage SET rows=? WHERE id=?',[JSON.stringify(rows),id]);contentSync.stampBuiltinContent(seed);
 const examId=q(local,'SELECT exam_id FROM passage WHERE id=26')[0].exam_id,revision=contentSync.assessmentRevision(local,examId);
 local.run("INSERT INTO user_word(word,note,status) VALUES ('run','keep note','mastered')");local.run("INSERT INTO word_hit(word,passage_id,sentence) VALUES ('run',26,'Keep source.')");local.run('INSERT INTO attempt(exam_id,total,score,content_revision) VALUES (?,1,100,?)',[examId,revision]);
 const ids=['exam','passage','question'].map(table=>q(local,'SELECT id FROM '+table));const summary=contentSync.syncBuiltinContent(local,seed);assert.equal(summary.changed,true);assert.deepEqual(['exam','passage','question'].map(table=>q(local,'SELECT id FROM '+table)),ids);assert.equal(contentSync.assessmentRevision(local,examId),revision);assert.equal(q(local,'SELECT score FROM attempt')[0].score,100);assert.equal(q(local,'SELECT note FROM user_word')[0].note,'keep note');assert.equal(q(local,'SELECT passage_id FROM word_hit')[0].passage_id,26);
 const saved=Buffer.from(local.export());assert.equal(contentSync.syncBuiltinContent(local,seed).changed,false);assert.deepEqual(Buffer.from(local.export()),saved);local.close();seed.close();
});
db.close();console.log(`对齐复核与审计回归 ${passed}/${passed}`);

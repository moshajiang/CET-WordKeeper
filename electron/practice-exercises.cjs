const {wordTokens}=require('./word-semantics.cjs');
const CHECK_VERSION='typed-answer:v1',TYPED_TYPES=['spelling','cloze'],BLANK='【填空】';
const normalizeAnswer=value=>String(value).normalize('NFKC').replace(/[‘’]/g,"'").trim().replace(/\s+/g,' ').toLowerCase();
function validateTyped(type,question,answer){
 if(!TYPED_TYPES.includes(type))return;
 const normalized=normalizeAnswer(answer),words=normalized.match(/[a-z]+(?:['\-][a-z]+)*/g)||[];
 if(answer.length>240||!words.length||words.length>12||!/^[a-z0-9'\- ]+$/.test(normalized))throw Error('拼写/填空答案应为 1 至 12 个英文词组成的表达，最长 240 字符');
 if(type==='cloze'&&question.split(BLANK).length!==2)throw Error('原句填空需要且只能有一个【填空】目标');
}
function checkAnswer(answer,response){const normalizedAnswer=normalizeAnswer(answer),normalizedResponse=normalizeAnswer(response);return {version:CHECK_VERSION,correct:!!normalizedResponse&&normalizedAnswer===normalizedResponse,normalizedAnswer,normalizedResponse};}
function ensureAnswerCheckSchema(db){db.run(`CREATE TABLE IF NOT EXISTS practice_answer_check(
 attempt_id TEXT PRIMARY KEY,version TEXT NOT NULL,correct INTEGER NOT NULL,normalized_answer TEXT NOT NULL,normalized_response TEXT NOT NULL);`);}
function savedCheck(q,id){const r=q('SELECT * FROM practice_answer_check WHERE attempt_id=?',[id])[0];return r?{version:r.version,correct:!!r.correct,normalizedAnswer:r.normalized_answer,normalizedResponse:r.normalized_response}:null;}
function recordCheck(run,id,result){run('INSERT INTO practice_answer_check VALUES(?,?,?,?,?)',[id,result.version,Number(result.correct),result.normalizedAnswer,result.normalizedResponse]);}
const escapeRegex=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function expressionRanges(text,target,hint=false){
 const pattern=target.split(/\s+/).map(part=>escapeRegex(part).replace(/[‘’']/g,"['‘’]")).join('\\s+'),result=[];
 for(const match of text.matchAll(new RegExp(pattern,'gi'))){const start=match.index,end=start+match[0].length,boundary=hint?/[A-Za-z0-9_'‘’\-]/:/[\p{L}\p{N}_'‘’\-]/u;if(!boundary.test(text[start-1]||'')&&!boundary.test(text[end]||''))result.push({start,end});}return result;
}
function hideExpression(text,p,resolveWord,targetOffset=null,hint=false){
 let matches=expressionRanges(text,p.quote,hint);
 if(p.kind==='sense')for(const token of wordTokens(text)){const resolved=resolveWord(token[0]);if(resolved.exact&&resolved.word===p.lemma)matches.push({start:token.index,end:token.index+token[0].length});}
 // The selected range is authoritative; overlapping duplicates are merged before replacements.
 if(targetOffset!==null){const end=targetOffset+p.quote.length;matches=matches.flatMap(r=>r.end<=targetOffset||r.start>=end?[r]:[...(r.start<targetOffset?[{start:r.start,end:targetOffset}]:[]),...(r.end>end?[{start:end,end:r.end}]:[])]);matches.push({start:targetOffset,end});}
 const unique=[...new Map(matches.map(r=>[r.start+':'+r.end,r])).values()].sort((a,b)=>a.start-b.start||b.end-a.end),ranges=[];
 for(const r of unique){const previous=ranges.at(-1);if(previous&&r.start<previous.end)previous.end=Math.max(previous.end,r.end);else ranges.push({...r});}
 let result='',cursor=0,targets=0;
 for(const r of ranges){result+=text.slice(cursor,r.start);if(targetOffset!==null&&r.start===targetOffset&&r.end===targetOffset+p.quote.length){result+=BLANK;targets++;}else result+=targetOffset===null?'【目标词】':'【同词遮挡】';cursor=r.end;}
 result+=text.slice(cursor);if(targetOffset!==null&&targets!==1)throw Error('无法确认此处目标，请重新从原文收藏后制作填空');return result;
}
function contextExercise(source,mode,resolveWord){
 if(!['spelling','cloze'].includes(mode))throw Error('练习方式无效');const p=source.sense||source.phrase;if(!p)throw Error('请从短语或语境义收藏制作这类练习');
 // Edge punctuation belongs to the quotation, not a spelling target. Keep internal punctuation literal.
 const leading=p.quote.match(/^[\s“”"()[\].,;:!?]+/)?.[0].length||0,target=p.quote.slice(leading).replace(/[\s“”"()[\].,;:!?]+$/g,'');
 validateTyped('spelling','',target);const scoped={...p,quote:target},meaning=hideExpression(p.meaning,scoped,resolveWord,null,true),tags=source.tags;
 let question;
 if(mode==='spelling')question='根据此处释义，拼写原文表达（保持原词形）：\n\n'+meaning+'\n\n词形提示：'+target.trim().split(/\s+/).length+' 个词，'+target.replace(/\s/g,'').length+' 个字符（不含空格）。';
 else{const offset=p.context_offset===null?null:p.context_offset+leading;if(!Number.isSafeInteger(offset)||p.context.slice(offset,offset+target.length)!==target)throw Error('保存的上下文缺少准确目标，请重新从原文收藏后制作填空');const hidden=hideExpression(p.context,scoped,resolveWord,offset);question='填入原文表达（保持原词形），只回答目标空：\n\n'+hidden+'\n\n此处释义：'+meaning+'\n\n其余同词已遮挡，不需要作答。';}
 validateTyped(mode,question,target);return {type:mode,question,answer:target,explanation:[p.note,'原文：'+p.context,'此处释义：'+p.meaning,'出处：'+p.source_label].filter(Boolean).join('\n\n'),options:[],tags};
}
module.exports={CHECK_VERSION,TYPED_TYPES,normalizeAnswer,validateTyped,checkAnswer,ensureAnswerCheckSchema,savedCheck,recordCheck,contextExercise};

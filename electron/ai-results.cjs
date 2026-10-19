class AiResultError extends Error {
  constructor(code) { super(code === 'json' ? 'bad_json' : 'bad_ai_result'); this.code = code; }
}
const fail = code => { throw new AiResultError(code); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, field, limit, empty = false) {
  if (typeof value !== 'string' || value.length > limit || (!empty && !value.trim())) fail(field);
  return value.trim();
}
function parseAiJson(content) {
  if (typeof content !== 'string' || content.length > 2*1024*1024) fail('json');
  let source = content.trim();
  const fence = source.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/i);
  if (fence) source = fence[1].trim();
  let value;
  try { value = JSON.parse(source); } catch { fail('json'); }
  if (!record(value)) fail('object');
  return value;
}
function validateEssayResult(value, section) {
  if (!['writing','translation'].includes(section)) fail('section');
  if (!record(value)) fail('object');
  if (!Object.hasOwn(value,'score') || typeof value.score !== 'number' || !Number.isFinite(value.score)
    || value.score < 0 || value.score > 15 || Math.abs(value.score*10-Math.round(value.score*10)) > 1e-8) fail('score');
  const band = text(value.band,'band',1000);
  if (!Array.isArray(value.issues) || value.issues.length > 100) fail('issues');
  const issues = value.issues.map(issue => {
    if (!record(issue)) fail('issue');
    return {quote:text(issue.quote,'quote',10000,true),problem:text(issue.problem,'problem',20000),fix:text(issue.fix,'fix',20000)};
  });
  const normalized = {score:Math.round(value.score*10)/10,band,issues};
  if (section === 'writing') {
    normalized.strengths = text(value.strengths,'strengths',20000,true);
    normalized.improved = text(value.improved,'improved',100000);
  } else normalized.reference = text(value.reference,'reference',100000);
  return normalized;
}
function optionLetters(raw) {
  let options = raw;
  if (typeof raw === 'string') { try { options = JSON.parse(raw); } catch { options = raw.split('\n'); } }
  if (!Array.isArray(options) || !options.some(value => typeof value === 'string' && value.trim())) return null;
  // QuestionPanel emits the first character of each displayed option.
  return [...new Set(options.flatMap(value => typeof value === 'string' && /^[A-Z]/.test(value.trim()) ? [value.trim()[0]] : []))];
}
// Match the reader's paragraph button policy; short/unstructured imports use A–O.
function matchLetters(content) {
  const letters = [];
  for (const line of String(content || '').split(/\n/)) {
    const m = line.trim().match(/^(?:\[([A-Z])\]|([A-Z])[ \t]*[)）．.、])[ \t]*\S/);
    if (m && (m[1] || m[2]) === 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[letters.length]) letters.push(m[1] || m[2]);
  }
  return letters.length >= 4 ? letters : [...'ABCDEFGHIJKLMNO'];
}
function analysisContext(passage, questions, {includeAnalysis = false, includeTranslation = true} = {}) {
  if (!['reading','cloze','match'].includes(passage.section)) fail('section');
  const candidates = questions.map(q => {
    const match = String(q.stem || '').match(/^\s*(\d{1,3})(?=\D|$)/);
    return match && Number(match[1]) > 0 ? Number(match[1]) : null;
  });
  const used = new Set(candidates.filter(n => n !== null && candidates.filter(x => x === n).length === 1));
  let fallback = 1;
  const all = questions.map((q,index) => {
    let n = candidates[index];
    if (n === null || candidates.filter(x => x === n).length !== 1) {
      if (Number.isSafeInteger(q.id) && q.id > 0 && !used.has(q.id)) n = q.id;
      else { while (used.has(fallback)) ++fallback; n = fallback++; }
      used.add(n);
    }
    const base = passage.section === 'reading' ? [...'ABCD'] : passage.section === 'match' ? matchLetters(passage.content) : [...'ABCDEFGHIJKLMNO'];
    const options = optionLetters(q.options);
    const allowed = passage.section === 'match' || options === null ? base : base.filter(letter => options.includes(letter));
    return {id:q.id,n,stem:q.stem || '',options:q.options,allowed,answer:q.answer || '',analysis:q.analysis || ''};
  });
  const needTranslation = includeTranslation && !String(passage.translation || '').trim();
  return {section:passage.section,needTranslation,
    targets:all.filter(q => !q.answer || (includeAnalysis || needTranslation) && !String(q.analysis).trim()),all};
}
function validateAnalysisResult(value, context) {
  if (!record(value)) fail('object');
  let translation = null;
  if (context.needTranslation || Object.hasOwn(value,'translation')) {
    const translated = text(value.translation,'translation',500000,!context.needTranslation);
    if (context.needTranslation) translation = translated;
  }
  if (!Array.isArray(value.answers) || value.answers.length !== context.targets.length) fail('answers_count');
  const targets = new Map(context.targets.map(q => [q.n,q])), seen = new Set();
  const targetIds = new Set(context.targets.map(q => q.id));
  const usedWords = new Set(context.section === 'cloze' ? context.all.filter(q => q.answer && !targetIds.has(q.id)).map(q => q.answer) : []);
  const answers = value.answers.map(answer => {
    if (!record(answer) || !Number.isSafeInteger(answer.n) || !targets.has(answer.n) || seen.has(answer.n)) fail('question_number');
    seen.add(answer.n);
    const target = targets.get(answer.n);
    if (typeof answer.answer !== 'string' || !/^[A-Z]$/.test(answer.answer) || !target.allowed.includes(answer.answer)) fail('answer_range');
    if (target.answer && target.answer !== answer.answer) fail('known_answer_conflict');
    if (context.section === 'cloze') { if (usedWords.has(answer.answer)) fail('duplicate_cloze_word'); usedWords.add(answer.answer); }
    return {id:target.id,n:answer.n,answer:answer.answer,analysis:text(answer.analysis,'analysis',50000)};
  });
  return {translation,answers};
}
module.exports = {AiResultError,parseAiJson,validateEssayResult,analysisContext,validateAnalysisResult};

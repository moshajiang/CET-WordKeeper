// 查词、原句定位和构建/运行时词频共用的纯函数。位置始终指向未经 HTML 转义的原文。
const FREQUENCY_REVISION = 'lemma-passages:v2';
const STOP_WORDS = new Set(('a an the this that these those it its is are was were be been being am do does did done ' +
  'have has had having will would shall should can could may might must to of in on at by for with from as and or but if ' +
  'not no nor so than then there here when where which who whom whose what how why all any both each few more most other ' +
  'some such only own same too very just also into over under again further once during before after above below up down out ' +
  'off about against between through i you he she we they me him her us them my your his their our one two three s t d ll re ve m').split(' '));
const normalize = value => String(value || '').toLowerCase().replace(/’/g, "'");
function buildWordIndex(rows) {
  const forward = new Map(), reverse = new Map();
  for (const row of rows) {
    const head = normalize(row.word);
    for (const part of String(row.exchange || '').split('/')) {
      const [key, value] = part.split(':');
      if (!value) continue;
      const form = normalize(value);
      if (form === head) continue;
      if (key === '0') forward.set(head, form);
      else if (!reverse.has(form)) reverse.set(form, head);
    }
  }
  for (const [form, head] of reverse) if (!forward.has(form)) forward.set(form, head);
  return forward;
}
function createWordResolver(hasWord, formIndex, extraForms) {
  function simpleNorm(lower) {
    for (const suffix of ['ies','ing','ed','es','ly','er','est','s','d']) {
      if (lower.length <= suffix.length + 2 || !lower.endsWith(suffix)) continue;
      let base = lower.slice(0, -suffix.length);
      if (suffix === 'ies') base += 'y';
      if (base.length <= 2) continue;
      for (const candidate of [base, base + 'e', base.slice(0, -1)]) if (candidate && hasWord(candidate)) return candidate;
      const mapped = formIndex.get(base);
      if (mapped && hasWord(mapped)) return mapped;
    }
    return lower;
  }
  return raw => {
    const lower = normalize(raw), mapped = formIndex.get(lower);
    if (mapped && hasWord(mapped)) return {word:mapped,exact:true};
    if (hasWord(lower)) return {word:lower,exact:true};
    const simple = simpleNorm(lower);
    if (simple !== lower) {
      const mappedSimple = formIndex.get(simple);
      if (mappedSimple && hasWord(mappedSimple)) return {word:mappedSimple,exact:true};
      if (hasWord(simple)) return {word:simple,exact:true};
    }
    const extra = Object.hasOwn(extraForms,lower) ? extraForms[lower] : Object.hasOwn(extraForms,simple) ? extraForms[simple] : null;
    return extra && hasWord(extra) ? {word:extra,exact:true} : {word:simple,exact:false};
  };
}
function* wordTokens(text) {
  // 连字符和撇号是词内字符，不把 art-school、don't 拆成 art 或 don。
  const source = String(text || '');
  for (const token of source.matchAll(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g)) {
    // 不把带数字、下划线或非英文词内字母的标识符切出半个词。
    const before = source[token.index - 1] || '', after = source[token.index + token[0].length] || '';
    if (/[\p{L}\p{N}_]/u.test(before) || /[\p{L}\p{N}_]/u.test(after)) continue;
    yield token;
  }
}
const escapeHtml = text => String(text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function markContext(sentence, word, resolveWord, mode = 'cloze') {
  const source = String(sentence || ''), target = normalize(word);
  let cursor = 0, html = '', count = 0;
  for (const token of wordTokens(source)) {
    if (resolveWord(token[0]).word !== target) continue;
    const surface = escapeHtml(token[0]);
    html += escapeHtml(source.slice(cursor,token.index));
    html += mode === 'bold' ? `<b>${surface}</b>` : `<span class="blank">${surface}</span>`;
    cursor = token.index + token[0].length; count++;
  }
  html += escapeHtml(source.slice(cursor));
  return {html,count};
}
function countWordFrequency(passages, dictionaryRows, extraForms) {
  const dictionary = new Set(dictionaryRows.map(row => row.word));
  const resolve = createWordResolver(word => dictionary.has(word),buildWordIndex(dictionaryRows),extraForms);
  const cache = new Map(), result = new Map();
  for (const passage of passages) {
    const seen = new Set();
    for (const token of wordTokens(passage.content)) {
      const raw = normalize(token[0]);
      if (raw.length < 3 || STOP_WORDS.has(raw)) continue;
      if (!cache.has(raw)) cache.set(raw,resolve(raw));
      const {word,exact} = cache.get(raw);
      if (!exact || word.length < 3 || STOP_WORDS.has(word) || seen.has(word)) continue;
      seen.add(word);
      if (!result.has(word)) result.set(word,{total:0,exams:new Set()});
      const entry = result.get(word); entry.total++; entry.exams.add(passage.exam_id);
    }
  }
  return [...result].sort(([a],[b]) => a.localeCompare(b)).map(([word,value]) => ({word,total:value.total,exams:value.exams.size}));
}
module.exports = {FREQUENCY_REVISION,buildWordIndex,createWordResolver,wordTokens,escapeHtml,markContext,countWordFrequency};

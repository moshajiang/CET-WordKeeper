// CET 真题 docx -> 结构化 JSON
// 用法: node scripts/parse-docx.mjs <docx路径> <CET4|CET6> <year> <month> <set_no>
import { unzipSync } from 'fflate';
import fs from 'fs';
import path from 'path';

const [,, docxPath, level, year, month, setNo] = process.argv;
if (!docxPath || !level) {
  console.error('用法: node scripts/parse-docx.mjs <docx> <CET4|CET6> <year> <month> <setNo>');
  process.exit(1);
}

function decodeXml(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// 修补源文档的排版瑕疵：真题 docx 里普遍存在「标点后丢空格」的粘连
// （实测全库约 900 处，如 "world.”You" "part,you" "Directions:For"）。
// 只处理几乎不可能是缩写的组合，避免误伤 "U.S." "10:30" "1,000" "don't"。
function healSpacing(s) {
  return s
    // 逗号/分号/冒号后紧跟字母 —— 这些符号不用于英文缩写
    .replace(/([,;:])(?=[A-Za-z])/g, '$1 ')
    // 右双引号后紧跟字母（“” 形式的引号一定是闭引号，加空格安全）
    .replace(/([”])(?=[A-Za-z])/g, '$1 ')
    // 句点后紧跟「首字母大写且有 2 个以上小写字母」的词，可排除 U.S. / Ph.D.
    .replace(/(?<=[a-z])\.(?=[A-Z][a-z]{2,})/g, '. ');
}

// 页脚（"第3页,共6页"）不是正文
const PAGE_FOOT = /^第\s*\d+\s*页\s*[,，、]?\s*共\s*\d+\s*页$/;

const zip = fs.readFileSync(docxPath);
const xml = Buffer.from(unzipSync(zip)['word/document.xml']).toString('utf8');
// 个别文档把 Part 标题与上一段粘连成一段（"...higher BMI. Part Ⅳ Translation ( 30 minutes )"），
// ^ 锚定的 isPart 识别不到 → 翻译区被并进最后一道阅读题、seed 里缺 translation 篇章。
// 这里按「内嵌的 Part + 题型词」把段落拆开（要求 Part 后紧跟题型词，不碰普通正文）。
const splitEmbeddedPart = (s) =>
  s.split(/(?=Part\b[\s\W]*(?:[IVXⅠⅡⅢⅣⅤivx]{1,4}|[A-Za-z]{1,3})?[\s\W]*(?:Writing|Listening|Reading|Translation)\b)/);

const parasAll = xml
  .split(/<w:p[ >]/)
  .slice(1)
  .map((p) => {
    // <w:tab/> / <w:br/> 是排版上的分隔（词库、两栏选项都靠 tab 分列）。
    // 只取 <w:t> 会把 "A)credentials⇥I)scale" 粘成 "A)credentialsI)scale" ——
    // 词库判据因此认定「整段不是纯词库」而整段丢弃，选词填空直接 0 题。
    // 这里把 tab/换行替换成一段空白文本节点再参与拼接。
    const withSep = p
      .replace(/<w:tab\b[^>]*\/?>/g, '<w:t> </w:t>')
      .replace(/<w:br\b[^>]*\/?>/g, '<w:t> </w:t>');
    const ts = withSep.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
    return ts.map((t) => decodeXml(t.replace(/<[^>]+>/g, ''))).join('');
  })
  .map((s) => healSpacing(s.replace(/\s+/g, ' ').trim()))
  .filter(Boolean)
  .filter((s) => !PAGE_FOOT.test(s))
  .flatMap(splitEmbeddedPart);

// 个别文档把 Part 标题拆成两段（"Part Ⅳ" 一段 + "Translation" 一段）——
// 两段单独都不满足 isPart（识别需要题型词），翻译区会被并进最后一道阅读题。
// 这里把「光杆 Part + 罗马数字」与其后紧跟的题型段合并回一段。
const paras = [];
for (const s of parasAll) {
  const prev = paras[paras.length - 1];
  if (prev && /^Part\b[\s\W]*[IVXⅠⅡⅢⅣⅤivx]{1,4}[\s\W]*$/i.test(prev) && /^(Writing|Listening|Reading|Translation)\b/i.test(s)) {
    paras[paras.length - 1] = prev + ' ' + s;
  } else {
    paras.push(s);
  }
}

// 兼容各种转写瑕疵：".Part I Writing" / "Part ][ Reading Comprehension" / "Part Ⅲ"
// 以及罗马数字被 OCR 串掉的 "Part FTranslation(30 minutes)"（F 是 Ⅵ 的残形）——
// 漏认这行会让 Reading 区一直吞到文末，把翻译段落并进最后一道阅读题里。
const PART_RE = /^\W*Part\b[\s\W]*(?:[IVXⅠⅡⅢⅣⅤivx]{1,4}|[A-Za-z]{1,3})?[\s\W]*(Writing|Listening|Reading|Translation)/i;
const isPart = (p) => PART_RE.test(p);
const partKind = (p) => {
  const m = p.match(PART_RE);
  if (!m) return null;
  const w = m[1].toLowerCase();
  if (w.startsWith('writ')) return 'writing';
  if (w.startsWith('list')) return 'listening';
  if (w.startsWith('read')) return 'reading';
  if (w.startsWith('tran')) return 'translation';
  return null;
};
const isSection = (p) => /^Section\s+[ABC]\b/i.test(p);
const isDirections = (p) => /^Directions\s*:/i.test(p);

// 选词填空的词库：一份词库常被折成 2–3 行、每行 5–7 个（"A) accustomed B) acquired C) assembly …"），
// 序号写法有 "A)" 也有 "A."；个别文档甚至是「无序号裸词表」（表格排版，还会重复一遍）。
// 判据：把词条全摘掉后该段不该再有实质内容 —— 这样才不会把正文里的 A) 误当词库。
// 容忍三种源文档瑕疵：① 序号与单词之间夹了装饰符号（"K)' secondary"）；
// ② OCR 把 O 认成 0（"0) threshold"）；③ 词条之间散落的 "·" 之类噪声。
const BANK_ENTRY = /([A-O0])\s*[)）.．、]\s*['’`·．.\-]*\s*([A-Za-z][A-Za-z'’-]*)/g;
const BANK_NOISE = /[\s,，、;；.．·'"’`\-]/g;
function bankEntries(text) {
  // 兜底：万一 tab 仍丢失、词库粘成 "A)credentialsI)scale"，
  // 在「小写字母 + 下一个字母序号」之间补一个空格再判据。
  const norm = String(text).replace(/([a-z])([A-O0]\s*[)）.．、])/g, '$1 $2');
  const rest = norm.replace(BANK_ENTRY, '').replace(BANK_NOISE, '');
  if (rest) return null;
  const out = [...norm.matchAll(BANK_ENTRY)].map((m) => ({ letter: m[1] === '0' ? 'O' : m[1], word: m[2] }));
  return out.length ? out : null;
}

// 收集一段范围内的词库。三种排版都要认：
//   ① 整行词库："A) accustomed  B) acquired  C) assembly …"
//   ② 表格拆成单元格：字母序号与单词各占一段（"A)" 紧接 "abundance"）——
//      Word 表格用 <w:tab/> 分列，抽出纯文本后两格就成了相邻两段
//   ③ 无序号裸词表（表格排版，按字母序补 A–O）
// 返回 { words, consumed }：consumed 是被判定为词库的段落下标，正文里要剔除。
const LETTER_ONLY = /^([A-O0])\s*[)）.．、]\s*['’`·]*$/;                              // 光秃秃的字母序号
const LETTER_WORD = /^([A-O0])\s*[)）.．、]\s*['’`·]*\s*([A-Za-z][A-Za-z'’\-;., ]*)\s*$/; // 整段只有一条（词可能带 OCR 噪声、含空格）
function collectBank(paras) {
  const map = new Map();
  const consumed = new Set();
  const put = (letter, word) => { const L = letter === '0' ? 'O' : letter; if (L && word && !map.has(L)) map.set(L, word); };
  let firstLettered = -1;   // 第一个「带字母序号」词条的段落下标

  for (let i = 0; i < paras.length; i++) {
    const p = String(paras[i]).trim();
    const e = bankEntries(p);
    if (e) { if (firstLettered < 0) firstLettered = i; for (const x of e) put(x.letter, x.word); consumed.add(i); continue; }
    const lo = p.match(LETTER_ONLY);
    if (lo) {
      if (firstLettered < 0) firstLettered = i;
      // ② 字母序号单独一段 → 下一段就是它的单词
      const nxt = String(paras[i + 1] || '').trim();
      if (nxt && !LETTER_ONLY.test(nxt) && !bankEntries(nxt) && /^[a-z][A-Za-z'’\-;.,]*$/.test(nxt)) {
        put(lo[1], nxt); consumed.add(i); consumed.add(i + 1); i++;
        continue;
      }
    }
    const lw = p.match(LETTER_WORD);   // ②' 连成一条且带噪声（"K) perm; mently"）
    if (lw && p.length <= 40 && !/\.\s/.test(lw[2])) {
      if (firstLettered < 0) firstLettered = i;
      put(lw[1], lw[2]); consumed.add(i);
    }
  }

  // ③ 孤儿 A 词：源文里词库首词的「A)」标记可能单独丢失（如 "cautiously" 独占一段，
  //    其后才是 B) commit … O) vigorous）。若收集到的字母从 B 开始且缺 A，
  //    就把首词条前一段的裸单词补为 A —— 否则整个词库会被错位重标，答案整体偏移一位。
  if (map.size >= 10 && !map.has('A') && firstLettered > 0) {
    const prev = String(paras[firstLettered - 1] || '').trim();
    if (!consumed.has(firstLettered - 1) && /^[a-z][A-Za-z'’\-]*$/.test(prev) && !bankEntries(prev)) {
      put('A', prev); consumed.add(firstLettered - 1);
    }
  }

  if (map.size >= 10) return { words: [...map.keys()].sort().map((k) => map.get(k)), consumed };
  const words = paras.filter((p) => /^[a-z][a-z'-]*$/i.test(p)).map((p) => p.toLowerCase());
  const uniq = [...new Set(words)];
  return { words: uniq.length >= 12 && uniq.length <= 20 ? uniq.sort() : [], consumed };
}

// 按 Part 分块
const parts = [];
let cur = null;
for (const p of paras) {
  if (isPart(p)) {
    cur = { kind: partKind(p), paras: [] };
    parts.push(cur);
  } else if (cur) {
    cur.paras.push(p);
  }
}
const reading = parts.find((x) => x.kind === 'reading');
const writing = parts.find((x) => x.kind === 'writing');
const translation = parts.find((x) => x.kind === 'translation');
if (!reading) {
  console.error('未找到 Reading 部分');
  process.exit(1);
}

// Reading 内按 Section 分块
const sections = [];
let cs = null;
for (const p of reading.paras) {
  if (isSection(p)) {
    cs = { name: p.trim().slice(0, 9), paras: [] };
    sections.push(cs);
  } else if (cs) {
    cs.paras.push(p);
  }
}

// 题号正则：允许小数点后无空格（"36.The"），但排除小数（"45.5"）
const QNUM_RE = /^(\d{1,2})\s*[.．]\s*(?!\d)/;
// 宽松题号：源文常漏点（"40 Leah's…"）、误用逗号（"54, What…"）。要求后随大写字母，
// 以免把正文里的 "40 years later" 误认成题号（小写开头）。
const QNUM_LOOSE = /^(\d{1,2})\s*[.．,]?\s*(?=[A-Z])/;
// 极少数源文把题号里的数字印成形近字母（如 "3B." 其实是 "36."）。全库仅此 1 处。
// 只在「找题号起点 / 切题区」时做形近替换，不污染正文。
const OCR_DIGIT = { B: '6', G: '6', S: '5', Z: '2', I: '1', l: '1', o: '0', O: '0' };
const ocrFix = (s) => String(s).replace(
  /(?<![0-9A-Za-z])([0-9])([BGSZlIoO])(?=\s*[.．])/g,
  (m, a, b) => a + (OCR_DIGIT[b] || b),
);

// 题号区间从原文的 "Questions 36 to 45 are based on the following passage." 推导。
// 老卷编排与现在不同（2014 六级：选词 36–45、匹配 46–55、仔细阅读 56–65），写死会整段落空。
const Q_RANGE = /Questions?\s+(\d{1,2})\s*(?:to|~|[-–—])\s*(\d{1,2})\b/i;
function qRange(arr, dLo, dHi) {
  for (const s of arr) {
    const m = String(s).match(Q_RANGE);
    if (m) return { lo: Number(m[1]), hi: Number(m[2]) };
  }
  return { lo: dLo, hi: dHi };
}

// 2003–2014 时期的老卷，题区里的题干与选项**完全没有题号**（"What do critics say about texting?"
// 直接跟选项），无法按编号切分。这里的兜底切分思路：
//   · 选项行 = 以 A)–D) 标记开头/内含字母标记，或以小写字母开头（"the difference between…"）
//   · 题干行 = 不是选项行，且 （以问号结尾）或（下一行是小写开头的选项行）
// 切出来的段数必须正好等于「Questions X to Y」给出的题数，否则判定失败、返回 null 交给上层降级。
function isOptionish(s) {
  const t = String(s).trim();
  if (/^[A-D]\s*[)）.．]/.test(t)) return true;
  if (/[A-D]\s*[)）.．]\s*\S/.test(t)) return true;
  return /^[a-z]/.test(t);
}

// 按「任意两位题号 + 点 + 大写」切分，不做区间过滤
function splitAnyNumbered(text) {
  return String(text).split(/(?=\d{2}\s*\.\s*[A-Z])/).map((s) => s.trim()).filter(Boolean);
}

// 源文常把题号后的「点」漏掉（"40 Leah's interest…"），上一条切不动，会把两条陈述并成一条。
// 这时改用「落在预期区间内的题号」切分：前置数字边界（(?<!\d)）防止把 1936 切成 36。
function splitByRange(text, lo, hi) {
  const nums = [];
  for (let n = lo; n <= hi; n++) nums.push(String(n));
  const re = new RegExp('(?=(?<!\\d)(?:' + nums.join('|') + ')\\s*[.．,]?\\s*[A-Z])');
  return String(text).split(re).map((s) => s.trim()).filter(Boolean);
}

// 有些卷把 10 条陈述排成有序列表："1. 36. <陈述>  2. 37. …"。
// 外层列表序号会挡住真正的题号（36–45），导致定位不到题区起点。
// 判据严格：只有「序号 + 点」紧跟「另一位题号 + 点 + 大写」时才剥掉外层序号，不碰正文。
const stripListMarker = (s) => String(s).replace(/^\s*\d{1,2}\s*[.．]\s*(?=\d{1,2}\s*[.．]\s*[A-Z])/, '');

function firstInRange(chunks, lo, hi) {
  return chunks.findIndex((c) => {
    const m = String(c).match(QNUM_LOOSE);
    return !!m && Number(m[1]) >= lo && Number(m[1]) <= hi;
  });
}

// 从题区文本里切出 count 道题。
// 只用「落在区间内的题号」定位**起点**，之后按任意题号切分并取前 count 段 ——
// 不能对每段硬做区间过滤：源文题号本身常错标（2015.12 六级把 44/45 写成 54/55、
// 把 51–55 的题写成 61–65），硬过滤会整段丢题。
// 若常规切分凑不齐 count（题号漏点等），退回「按区间题号切分」再试一次。
function takeQuestions(text, lo, hi, count) {
  let chunks = splitAnyNumbered(text);
  let si = firstInRange(chunks, lo, hi);
  if (si >= 0 && chunks.length - si >= count) return chunks.slice(si, si + count);

  const rc = splitByRange(text, lo, hi);
  const rsi = firstInRange(rc, lo, hi);
  if (rsi >= 0 && rc.length - rsi >= count) {
    // 漏点的题号统一补上分隔点，让全库题干格式一致（"40 Leah's…" → "40. Leah's…"）
    return rc.slice(rsi, rsi + count).map((c) => c.replace(/^(\d{1,2})\s+/, '$1. '));
  }
  return si >= 0 ? chunks.slice(si, si + count) : [];
}

// 题干补题号：原文已带编号就保留，否则补上推导出的题号
function withQNum(stem, n) {
  const s = String(stem).trim();
  return QNUM_RE.test(s) ? s : `${n}.${s}`;
}

// 题区结束位置：遇到下一个 Part / Section / Directions 就停
// （Section C 是最后一节，Reading 区可能一直延伸到文末，把翻译段落并进最后一道题）
function regionEnd(paras) {
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (PART_RE.test(p) || /^Section\s+[ABC]\b/i.test(p) || isDirections(p)) return i;
  }
  return paras.length;
}

// 无标记时推断题区起点：正文段落明显更长，题区自最后一个长段落之后开始
function guessRegionStart(paras) {
  let last = -1;
  for (let i = 0; i < paras.length; i++) if (String(paras[i]).length > 140) last = i;
  return last + 1;
}

// 题号不全（局部丢失）时的兜底切分。依次尝试两种策略，切出的段数必须正好等于 count：
//   B 结构法 —— 题干 = 以问号/下划线填空结尾，或下一段是选项行
//   C 等分法 —— 同一篇里每题的段落数一致（题干 + 4 个选项各占一段），总段数能被题数整除
function splitLooseQuestions(region, count) {
  const ps = region.map((s) => String(s).trim()).filter(Boolean);
  if (ps.length < count) return null;

  // 选项行「头」：以 A)–D) 字母序号开头（老卷则是无序号的小写裸选项）
  const isOptHead = (s) => /^[A-D]\s*[)）.．]/.test(String(s).trim());
  const idx = [];
  for (let i = 0; i < ps.length; i++) {
    const t = ps[i];
    if (isOptionish(t)) continue;
    const nxt = ps[i + 1];
    // 题干：以问号结尾、含下划线填空，或下一段就是选项行（如 "…so as to ____" 后接 "A) …"）
    if (/[?？]\s*$/.test(t) || /[_＿]{2,}/.test(t) || (nxt && (isOptHead(nxt) || /^[a-z]/.test(nxt)))) idx.push(i);
  }
  if (idx.length === count) {
    return idx.map((s, k) => {
      const e = k + 1 < idx.length ? idx[k + 1] : ps.length;
      return { stem: ps[s], options: ps.slice(s + 1, e) };
    });
  }
  if (ps.length % count === 0) {
    const k = ps.length / count;
    if (k >= 2 && k <= 6) {
      return Array.from({ length: count }, (_, i) => ({
        stem: ps[i * k],
        options: ps.slice(i * k + 1, (i + 1) * k),
      }));
    }
  }
  return null;
}

function parseOptions(chunk) {
  const m = chunk.match(/A\)/);
  if (!m) return { stem: chunk.trim(), options: [] };
  const stem = chunk.slice(0, m.index).trim();
  const rest = chunk.slice(m.index);
  const parts = rest.split(/(?=[A-D]\))/);
  const options = parts
    .filter((x) => /^[A-D]\)/.test(x.trim()))
    .map((x) => x.trim().replace(/\s+/g, ' '));
  return { stem, options };
}

const passages = [];

if (writing) {
  passages.push({
    section: 'writing', seq: 1, title: '写作',
    content: writing.paras.join('\n'),
    questions: [],
  });
}

for (const sec of sections) {
  if (/^Section\s+A/i.test(sec.name)) {
    // 选词填空：正文 + 词库（词库可能占多行、每行多个词，也可能是被拆成单元格的表格）
    const { words: bank, consumed } = collectBank(sec.paras);
    const body = sec.paras.filter(
      (p, i) => !consumed.has(i) && !bankEntries(p) && !isDirections(p)
        && !/Answer\s*Sheet/i.test(p) && !/^Questions\s+\d+\s+to\s+\d+/i.test(p)
    );
    // 模型是「N 个空共享一份 15 词词库」，不是「一个词对应一道题」。
    // 空号从 "Questions 36 to 45 are based on the following passage." 推导（默认 26–35）——
    // 2014 六级等老卷是 36–45，写死 26–35 会让标号与真题脱节。
    const r = qRange(sec.paras, 26, 35);
    const n = Math.max(1, r.hi - r.lo + 1);
    const bankOptions = bank.map((w, i) => `${String.fromCharCode(65 + i)}) ${w}`);
    passages.push({
      section: 'cloze', seq: 1, title: '选词填空',
      content: body.join('\n'),
      questions: bankOptions.length
        ? Array.from({ length: n }, (_, i) => ({ qtype: 'cloze', stem: String(r.lo + i), options: bankOptions.slice(), answer: '', analysis: '' }))
        : [],
    });
  } else if (/^Section\s+B/i.test(sec.name)) {
    // 长篇阅读：文章段落 + 匹配题（10 条陈述）。区间从 "Questions 36 to 45" 推导，
    // 缺该行时默认 36–45（四六级长篇阅读历年都是 36–45）
    const clean = (p) => !isDirections(p) && !/Answer\s*Sheet/i.test(p);
    const r = qRange(sec.paras, 36, 45);
    const count = r.hi - r.lo + 1;
    const hitAt = (p, re) => { const m = ocrFix(stripListMarker(p)).match(re); return !!m && Number(m[1]) >= r.lo && Number(m[1]) <= r.hi; };
    // 严格（题号带点）优先；第一条陈述就漏点时退回宽松（"36 The CGi…"）
    const candidates = [sec.paras.findIndex((p) => hitAt(p, QNUM_RE))];
    const looseIdx = sec.paras.findIndex((p) => hitAt(p, QNUM_LOOSE));
    if (looseIdx >= 0 && !candidates.includes(looseIdx)) candidates.push(looseIdx);
    const take = (firstQ) => takeQuestions(ocrFix(sec.paras.slice(firstQ).map(stripListMarker).join(' ')), r.lo, r.hi, count)
      .filter((c) => c && !isDirections(c) && !/答题卡|Answer\s*Sheet/i.test(c));

    let bodyParas = null, stems = null;
    for (const firstQ of candidates) {
      if (firstQ < 0) continue;
      const got = take(firstQ);
      if (got.length === count) { stems = got; bodyParas = sec.paras.slice(0, firstQ).filter(clean); break; }
    }
    if (!stems) {
      // 老卷的 10 条陈述没有编号。题区从「注意：…答题卡…」之后开始，但该标记有时出现得很早
      // （紧接着文章标题），直接取前 count 段会抓到正文 —— 所以取题区的**末尾 count 段**。
      const MARK = /答题卡|Answer\s*Sheet/i;
      const ok = (p) => clean(p) && !MARK.test(p) && !/^Questions\s+\d+/i.test(p);
      const mIdx = sec.paras.findIndex((p) => MARK.test(p));
      const start = mIdx >= 0 ? mIdx + 1 : 0;
      let pick = [];
      for (let i = start; i < sec.paras.length; i++) if (ok(sec.paras[i])) pick.push(i);
      pick = pick.slice(-count);
      if (pick.length < count) {
        pick = [];
        for (let i = 0; i < sec.paras.length; i++) if (ok(sec.paras[i])) pick.push(i);
        pick = pick.slice(-count);
      }
      const cut = pick.length ? pick[0] : sec.paras.length;
      stems = pick.map((i, k) => withQNum(sec.paras[i], r.lo + k));
      bodyParas = sec.paras.slice(0, cut).filter(clean);
    }
    const qs = stems.map((chunk) => ({ qtype: 'match', stem: chunk, options: [], answer: '', analysis: '' }));
    passages.push({
      section: 'match', seq: 1, title: '长篇阅读',
      content: bodyParas.join('\n'),
      questions: qs,
    });
  } else if (/^Section\s+C/i.test(sec.name)) {
    // 仔细阅读：Passage One / Two。
    // 注意：部分文档里 "Passage One" 与 Directions 合并成同一段，因此用非锚定匹配
    const groups = [];
    let g = null;
    for (const p of sec.paras) {
      const m = p.match(/Passage\s+(One|Two|Three)/i);
      if (m) {
        g = { title: 'Passage ' + m[1].replace(/^./, (c) => c.toUpperCase()), paras: [] };
        groups.push(g);
      } else if (g) {
        g.paras.push(p);
      }
    }
    if (!groups.length) {
      const body = sec.paras.filter((p) => !isDirections(p) && !/Answer\s*Sheet/i.test(p));
      groups.push({ title: 'Section C', paras: body });
    }
    groups.forEach((grp, gi) => {
      // 题号区间从本篇的 "Questions X to Y" 推导（老卷是 56–65，写死 46–55 会整段 0 题）
      const r = qRange(grp.paras, gi === 0 ? 46 : gi === 1 ? 51 : 56, gi === 0 ? 50 : gi === 1 ? 55 : 60);
      const count = r.hi - r.lo + 1;
      const MARK = /答题卡|Answer\s*Sheet/i;
      const inRange = (p) => { const m = String(p).match(QNUM_RE); return !!m && Number(m[1]) >= r.lo && Number(m[1]) <= r.hi; };
      const firstQ = grp.paras.findIndex(inRange);

      // 先按题号切；源文题号常局部丢失（如 46–48 无编号、49–50 有），切出正好 count 道才算数
      const numbered = firstQ >= 0 ? takeQuestions(grp.paras.slice(firstQ).join(' '), r.lo, r.hi, count) : [];
      const useNumbered = numbered.length === count;

      // 题区起点：题号 → 「注意…答题卡」标记 → 段落长度推断
      const mIdx = grp.paras.findIndex((p) => MARK.test(p));
      const qStart = useNumbered ? firstQ
        : mIdx >= 0 ? mIdx
        : Math.min(guessRegionStart(grp.paras), grp.paras.length);

      const body = grp.paras.slice(0, qStart)
        .filter((p) => !isDirections(p) && !/Answer\s*Sheet/i.test(p) && !/^Questions\s+\d+\s+to\s+\d+/i.test(p));
      let qs = [];
      if (useNumbered) {
        qs = numbered.map((chunk) => {
          const { stem, options } = parseOptions(chunk);
          return { qtype: 'choice', stem, options, answer: '', analysis: '' };
        });
      } else {
        const tail = grp.paras.slice(qStart);
        const strip = (p) => !isDirections(p) && !MARK.test(p) && !/Answer\s*Sheet/i.test(p) && !/^Questions\s+\d+/i.test(p);
        const region = tail.slice(0, regionEnd(tail)).filter(strip);
        const sp = splitLooseQuestions(region, count);
        if (sp) qs = sp.map(({ stem, options }, i) => ({ qtype: 'choice', stem: withQNum(stem, r.lo + i), options, answer: '', analysis: '' }));
      }
      passages.push({
        section: 'reading', seq: gi + 1, title: '仔细阅读 · ' + grp.title,
        content: body.join('\n'),
        questions: qs,
      });
    });
  }
}

if (translation) {
  // 粘连场景下，翻译段可能整个挤在一段里（"Part Ⅳ Translation ( 30 minutes ) Directions: ... Answer Sheet 2 . 随着……"）。
  // 剥掉到 "Answer Sheet n ." 为止的说明头，只留中文原文；正常分段的段落不受影响。
  const stripTransHead = (s) => s.replace(/^Part\b[\s\S]*?Answer\s*Sheet\s*\d?\s*[.．]?\s*/, '');
  passages.push({
    section: 'translation', seq: 1, title: '翻译（中文原文）',
    content: translation.paras.filter((p) => !isDirections(p)).map(stripTransHead)
      .filter((p) => !/^Part\b/.test(p) && !/^\(\s*\d+\s*minutes\s*\)/.test(p))
      .filter(Boolean).join('\n'),
    questions: [],
  });
}

const out = {
  level,
  year: Number(year) || 0,
  month: Number(month) || 0,
  set_no: Number(setNo) || 1,
  title: `${level} ${year} 年 ${month} 月第 ${setNo} 套`,
  source: path.basename(docxPath),
  passages,
};

// 数据质量校验：阅读类内容过少说明源文档残缺，跳过避免污染题库
const readLen = passages
  .filter((p) => ['reading', 'match', 'cloze'].includes(p.section))
  .reduce((a, p) => a + p.content.length, 0);
if (readLen < 2000) {
  console.error(`内容不完整（阅读部分仅 ${readLen} 字符），跳过该文件`);
  process.exit(2);
}

const outDir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'data', 'seed');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${level.toLowerCase()}-${year}.${String(month).padStart(2, '0')}-set${setNo || 1}.json`);
fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');

console.log('输出:', outFile);
for (const p of passages) {
  console.log(`  [${p.section}] ${p.title} — ${p.content.length} 字符, ${p.questions.length} 题`);
}

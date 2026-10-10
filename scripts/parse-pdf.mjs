// 真题 PDF 提取出的纯文本 -> 结构化 JSON（与 parse-docx.mjs 输出同构）
// 用法: node scripts/parse-pdf.mjs <文本路径> <CET4|CET6> <year> <month> <setNo> <源文件名>
//
// 与 docx 的差异（都已在下面处理）：
//  · 选项常按两栏排版（"A) ... C) ..." 同一行，下一行 "B) ... D) ..."）
//  · Section A 的词库可能被排到 Section B 段落中间（PDF 分栏阅读顺序所致）
//  · 两端对齐会插入伪空格（"self -worth"、"Small child ren"）
import fs from 'fs';
import path from 'path';

const [, , txtPath, level, year, month, setNo, srcName] = process.argv;
if (!txtPath || !level) {
  console.error('用法: node scripts/parse-pdf.mjs <txt> <CET4|CET6> <year> <month> <setNo> <源文件>');
  process.exit(1);
}

const raw = fs.readFileSync(txtPath, 'utf8');

// 页脚（"第3页,共6页" / "第 3 页 共 6 页"）不是正文，混进题区会污染匹配题的切分
const PAGE_FOOT = /^第\s*\d+\s*页\s*[,，、]?\s*共\s*\d+\s*页$/;

// 归一化：合并空白；修掉「词 - 词」里的伪空格；剔除页脚
const lines = raw
  .split(/\r?\n/)
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .map((s) => s.replace(/(\w)\s+-\s*(\w)/g, '$1-$2'))
  .filter(Boolean)
  .filter((s) => !PAGE_FOOT.test(s));

// ---- 结构识别 ----
// 两个都必须容忍：
//  · 罗马数字可能是非 ASCII 的 Ⅱ（U+2161），后面紧跟空格时不构成 \b 边界，
//    所以不能用 \b 收尾，否则 "PartⅡ Listening" 会漏识别，写作区会一直吞到下一个 Part；
//  · PDF 文本层质量差时 "Part III" 会被识别成 "Part in"（I 和 II 被连读），
//    所以编号部分只做「1~4 个非字母 + 至多 3 个字母」的宽松匹配。
const PART_RE = /^Part[^A-Za-z]{0,4}(?:[IVXⅠⅡⅢⅣⅤ]+|[A-Za-z]{1,3})?[^A-Za-z]*(Writing|Listening|Reading|Translation)/i;
const isDirections = (s) => /^Directions\s*[:：]/i.test(s);
const isSection = (s) => /^Section\s+[ABC]\b/i.test(s);
const isPassageHead = (s) => /^Passage\s+(One|Two|Three)\b/i.test(s);

// Directions 是多行块（自动换行），必须整块剔除，不能只删以 "Directions" 开头的行。
// 这些模板块总是以某个标志性短语收尾（"on Answer Sheet 2." / "through the centre." /
// "more than once．"），用「行尾」判定才不会误伤正文。
const DIR_END = /(Answer Sheet\s*\d|through the cent(?:er|re)|more than once|best choice)\s*[.．]?\s*$/i;
function stripDirections(arr) {
  const i = arr.findIndex((s) => isDirections(s));
  if (i < 0) return arr;
  let j = i + 1;
  while (j < arr.length) {
    if (DIR_END.test(arr[j])) { j++; break; }
    j++;
  }
  return arr.slice(j);
}

// 题号正则：允许小数点后无空格（"36.The"），但排除小数（"45.5"）
const QNUM_RE = /^(\d{1,2})\s*[.．]\s*(?!\d)/;
// 宽松题号：源文常漏点（"40 Leah's…"）、误用逗号（"54, What…"）。要求后随大写字母，
// 以免把正文里的 "40 years later" 误认成题号（小写开头）。与 parse-docx.mjs 同一套。
const QNUM_LOOSE = /^(\d{1,2})\s*[.．,]?\s*(?=[A-Z])/;

// 题号区间从原文的 "Questions 36 to 45 are based on the following passage." 推导，
// 不再写死 —— 老卷的编排与现在不同（如 2014 六级：选词 36–45、匹配 46–55、仔细阅读 56–65）。
const Q_RANGE = /Questions?\s+(\d{1,2})\s*(?:to|~|[-–—])\s*(\d{1,2})\b/i;
function qRange(arr, dLo, dHi) {
  for (const s of arr) {
    const m = String(s).match(Q_RANGE);
    if (m) return { lo: Number(m[1]), hi: Number(m[2]) };
  }
  return { lo: dLo, hi: dHi };
}

// 按「行首两位题号 + 点 + 非数字」切分，不做区间过滤
const splitAnyNumbered = (text) =>
  String(text).split(/(?=^\s*\d{1,2}\s*[.．]\s*(?!\d))/m).map((s) => s.trim()).filter(Boolean);

// 源文常把题号后的「点」漏掉（"40 Leah's interest…"），上一条切不动，会把两条陈述并成一条。
// 这时改用「落在预期区间内的题号」切分：前置数字边界（(?<!\d)）防止把 1936 切成 36。
function splitByRange(text, lo, hi) {
  const nums = [];
  for (let n = lo; n <= hi; n++) nums.push(String(n));
  const re = new RegExp('(?=(?<!\\d)(?:' + nums.join('|') + ')\\s*[.．,]?\\s*[A-Z])');
  return String(text).split(re).map((s) => s.trim()).filter(Boolean);
}

function firstInRange(chunks, lo, hi) {
  return chunks.findIndex((c) => {
    const m = String(c).match(QNUM_LOOSE);
    return !!m && Number(m[1]) >= lo && Number(m[1]) <= hi;
  });
}

// 从题区切出 count 道题：只用区间内的题号定位起点，之后按任意题号切、取前 count 段。
// 不能对每段硬做区间过滤 —— 源文题号常错标（如 44/45 写成 54/55），硬过滤会丢题。
// 若常规切分凑不齐 count（题号漏点等），退回「按区间题号切分」再试一次。
function takeQuestions(text, lo, hi, count) {
  const chunks = splitAnyNumbered(text);
  const si = firstInRange(chunks, lo, hi);
  if (si >= 0 && chunks.length - si >= count) return chunks.slice(si, si + count);

  const rc = splitByRange(text, lo, hi);
  const rsi = firstInRange(rc, lo, hi);
  if (rsi >= 0 && rc.length - rsi >= count) {
    // 漏点的题号统一补上分隔点，让全库题干格式一致（"40 Leah's…" → "40. Leah's…"）
    return rc.slice(rsi, rsi + count).map((c) => c.replace(/^(\d{1,2})\s+/, '$1. '));
  }
  return si >= 0 ? chunks.slice(si, si + count) : [];
}

// 题干补题号：原文已带编号就保留
function withQNum(stem, n) {
  const s = String(stem).trim();
  return QNUM_RE.test(s) ? s : `${n}.${s}`;
}

// 有些卷把 10 条陈述排成有序列表："1. 36. <陈述>  2. 37. …"。
// 列表序号会把真正的题号（36–45）挡住，导致按题号定位失败、退化成「取末尾 10 行」的错乱结果。
// 判据严格：只有「序号 + 点」紧跟「另一位题号 + 点 + 大写」时才剥掉外层序号，不碰正文。
const stripListMarker = (s) => String(s).replace(/^\s*\d{1,2}\s*[.．]\s*(?=\d{1,2}\s*[.．]\s*[A-Z])/, '');

// 选词填空的词库行：一份词库常被折成多行、每行多个词，甚至按栏排成三段；序号有 "A)" 也有 "A."。
// 判据 —— 把词条全摘掉后该行不该再有实质内容，这样才不会把正文里的 A) 误认成词库。
// 容忍与 parse-docx 一致的三种源瑕疵：装饰符号（"K)' secondary"）、OCR 把 O 认成 0、散落噪声 "·"。
const BANK_ENTRY = /([A-O0])\s*[)）.．、]\s*['’`·．.\-]*\s*([A-Za-z][A-Za-z'’-]*)/g;
const BANK_NOISE = /[\s,，、;；.．·'"’`\-]/g;
function bankEntries(text) {
  const norm = String(text).replace(/([a-z])([A-O0]\s*[)）.．、])/g, '$1 $2');
  const rest = norm.replace(BANK_ENTRY, '').replace(BANK_NOISE, '');
  if (rest) return null;
  const out = [...norm.matchAll(BANK_ENTRY)].map((m) => ({ letter: m[1] === '0' ? 'O' : m[1], word: m[2] }));
  return out.length ? out : null;
}

const parts = [];
let cur = null;
lines.forEach((s, i) => {
  const m = s.match(PART_RE);
  if (m) {
    const w = m[1].toLowerCase();
    cur = { kind: w.startsWith('writ') ? 'writing' : w.startsWith('read') ? 'reading' : w.startsWith('tran') ? 'translation' : 'other', from: i };
    parts.push(cur);
  } else if (cur) cur.to = i;
});
const writing = parts.find((p) => p.kind === 'writing');
const reading = parts.find((p) => p.kind === 'reading');
const translation = parts.find((p) => p.kind === 'translation');
if (!reading) { console.error('未找到 Reading 部分'); process.exit(1); }

const slice = (p) => (p ? lines.slice(p.from + 1, (p.to ?? lines.length - 1) + 1) : []);

// ---- 词库（全局扫描：它可能被排版进别的 Section 里）----
const bankMap = new Map();
const bankLines = new Set();
lines.forEach((s, i) => {
  const e = bankEntries(s);
  if (!e) return;
  bankLines.add(i);
  for (const x of e) bankMap.set(x.letter, x.word);
});
const bankWords = [...bankMap.keys()].sort().map((k) => ({ letter: k, word: bankMap.get(k) }));

function parseOptions(chunk) {
  const idx = chunk.search(/[A-D]\)/);
  if (idx < 0) return { stem: chunk.trim(), options: [] };
  const stem = chunk.slice(0, idx).replace(/^\d{2}\s*[.．]\s*/, '').trim();
  const rest = chunk.slice(idx);
  const options = (rest.match(/[A-D]\)\s*[^A-D]*/g) || [])
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter((x) => /^[A-D]\)/.test(x));
  return { stem, options };
}

const passages = [];

// 写作区保留 Directions 原文（它就是题目要求本身，与 docx 管线一致）
if (writing) {
  const body = slice(writing);
  if (body.length) passages.push({ section: 'writing', seq: 1, title: '写作', content: body.join('\n'), questions: [] });
}

// Reading 内按 Section 切块（用行号定位，保留对原始行的引用以便剔除词库行）
const rFrom = reading.from;
const rTo = reading.to ?? lines.length - 1;
const sectionIdx = [];
for (let i = rFrom; i <= rTo; i++) if (isSection(lines[i])) sectionIdx.push(i);
sectionIdx.push(rTo + 1);

for (let k = 0; k < sectionIdx.length - 1; k++) {
  const a = sectionIdx[k];
  const b = sectionIdx[k + 1];
  const name = lines[a].match(/^Section\s+([ABC])/i)[1].toUpperCase();
  const bodyIdx = [];
  for (let i = a + 1; i < b; i++) if (!bankLines.has(i)) bodyIdx.push(i);
  const body = stripDirections(bodyIdx.map((i) => lines[i])).map(stripListMarker);

  if (name === 'A') {
    // 选词填空：正文 + 词库（词库可能被排版到别处，已全局收集）
    // 每个空的 options 都是同一份完整词库 —— 不是「一词一题」。
    // 空号从 "Questions 36 to 45 are based on the following passage." 推导（默认 26–35）
    const r = qRange(body, 26, 35);
    const text = body.filter((s) => !/^Questions?\s+\d/i.test(s));
    const bankOptions = bankWords.map((w) => `${w.letter}) ${w.word}`);
    const n = Math.max(1, r.hi - r.lo + 1);
    passages.push({
      section: 'cloze', seq: 1, title: '选词填空', content: text.join('\n'),
      questions: bankOptions.length
        ? Array.from({ length: n }, (_, i) => ({ qtype: 'cloze', stem: String(r.lo + i), options: bankOptions.slice(), answer: '', analysis: '' }))
        : [],
    });
  } else if (name === 'B') {
    // 长篇阅读：文章段落 + 匹配题。区间从 "Questions 36 to 45" 推导，缺该行时默认 36–45
    const r = qRange(body, 36, 45);
    const count = r.hi - r.lo + 1;
    const hitAt = (s, re) => { const m = String(s).match(re); return !!m && Number(m[1]) >= r.lo && Number(m[1]) <= r.hi; };
    // 严格（题号带点）优先；第一条陈述就漏点时退回宽松（"36 The CGi…"）
    const candidates = [body.findIndex((s) => hitAt(s, QNUM_RE))];
    const looseIdx = body.findIndex((s) => hitAt(s, QNUM_LOOSE));
    if (looseIdx >= 0 && !candidates.includes(looseIdx)) candidates.push(looseIdx);

    let paragraphs = null, stems = null;
    for (const firstQ of candidates) {
      if (firstQ < 0) continue;
      // 保留 "36." 前缀（前端直接显示 stem，全库一致）
      const got = takeQuestions(body.slice(firstQ).join('\n'), r.lo, r.hi, count);
      if (got.length === count) { stems = got; paragraphs = body.slice(0, firstQ); break; }
    }
    if (!stems) {
      // 源文里 10 条陈述**没有编号**（老卷常见）：
      // 优先取「注意：…答题卡…」之后的内容，否则退化为取末尾 count 段；补上题号
      const MARK = /答题卡|Answer\s*Sheet/i;
      const mIdx = body.reduce((a, s, i) => (MARK.test(s) ? i : a), -1);
      const after = mIdx >= 0 ? body.slice(mIdx + 1) : [];
      const tail = after.length >= count ? after : body.slice(Math.max(0, body.length - count));
      stems = tail.map((s) => s.trim()).filter(Boolean)
        .map((s, i) => withQNum(s, r.lo + i));
      paragraphs = after.length >= count ? body.slice(0, mIdx + 1) : body.slice(0, Math.max(0, body.length - count));
    }
    const title = paragraphs.find((s) => !/^[A-O][)）.．]/.test(s) && !/答题卡|Answer\s*Sheet/i.test(s) && s.length < 120) || '长篇阅读';
    passages.push({
      section: 'match', seq: 1, title: '长篇阅读 · ' + title, content: paragraphs.join('\n'),
      questions: stems.map((c) => ({ qtype: 'match', stem: c, options: [], answer: '', analysis: '', })),
    });
  } else if (name === 'C') {
    // 仔细阅读：Passage One / Two；题号区间逐 Passage 从 "Questions X to Y" 推导
    const groups = [];
    let g = null;
    for (const s of body) {
      if (isPassageHead(s)) { g = { title: s.trim(), lines: [] }; groups.push(g); }
      else if (g) g.lines.push(s);
    }
    if (!groups.length) groups.push({ title: 'Section C', lines: body });
    groups.forEach((grp, gi) => {
      const arr = grp.lines.filter((s) => !/^Questions?\s+\d+\s+to\s+\d+/i.test(s));
      const r = qRange(grp.lines, gi === 0 ? 46 : gi === 1 ? 51 : 56, gi === 0 ? 50 : gi === 1 ? 55 : 60);
      const count = r.hi - r.lo + 1;
      const inRange = (s) => { const m = String(s).match(QNUM_RE); return !!m && Number(m[1]) >= r.lo && Number(m[1]) <= r.hi; };
      const firstQ = arr.findIndex(inRange);
      const head = firstQ < 0 ? arr.length : firstQ;
      // 起点之后按任意题号切、取前 count 段（源文题号可能错标）
      const chunks = firstQ < 0 ? [] : takeQuestions(arr.slice(head).join('\n'), r.lo, r.hi, count);
      passages.push({
        section: 'reading', seq: gi + 1,
        title: '仔细阅读 · ' + grp.title.trim(),
        content: arr.slice(0, head).join('\n'),
        questions: chunks.map((c) => { const { stem, options } = parseOptions(c); return { qtype: 'choice', stem, options, answer: '', analysis: '' }; }),
      });
    });
  }
}

if (translation) {
  const body = stripDirections(slice(translation));
  if (body.length) passages.push({ section: 'translation', seq: 1, title: '翻译（中文原文）', content: body.join('\n'), questions: [] });
}

const out = {
  level,
  year: Number(year) || 0,
  month: Number(month) || 0,
  set_no: Number(setNo) || 1,
  title: `${level} ${year} 年 ${month} 月第 ${setNo} 套`,
  source: srcName || path.basename(txtPath),
  passages,
};

// 质量门禁：阅读类正文过少说明提取失败或源文件是扫描件
const readLen = passages
  .filter((p) => ['reading', 'match', 'cloze'].includes(p.section))
  .reduce((a, p) => a + p.content.length, 0);
if (readLen < 2000) {
  console.error(`内容不完整（阅读部分仅 ${readLen} 字符），跳过`);
  process.exit(2);
}

const outDir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'data', 'seed');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${level.toLowerCase()}-${year}.${String(month).padStart(2, '0')}-set${setNo || 1}.json`);
fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
console.log('输出:', outFile);
for (const p of passages) console.log(`  [${p.section}] ${p.title} — ${p.content.length} 字符, ${p.questions.length} 题`);

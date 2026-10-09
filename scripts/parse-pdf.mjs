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

// 归一化：合并空白；修掉「词 - 词」里的伪空格
const lines = raw
  .split(/\r?\n/)
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .map((s) => s.replace(/(\w)\s+-\s*(\w)/g, '$1-$2'))
  .filter(Boolean);

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

// 题号切分：必须带小数点且落在指定区间。
// 否则正文续行 "47 hours in the United States…" 会被当成第 47 题，把篇章拦腰截断。
const splitNumbered = (text, lo, hi) =>
  text
    .split(/(?=^\s*\d{2}\s*[.．]\s)/m)
    .map((s) => s.trim())
    .filter((s) => {
      const m = s.match(/^(\d{2})\s*[.．]\s/);
      return m && Number(m[1]) >= lo && Number(m[1]) <= hi;
    });

// 选词填空的词库行：一份词库常被折成多行、每行多个词，甚至按栏排成三段；序号有 "A)" 也有 "A."。
// 判据 —— 把词条全摘掉后该行不该再有实质内容，这样才不会把正文里的 A) 误认成词库。
const BANK_ENTRY = /([A-O])\s*[)）.．、]\s*([A-Za-z][A-Za-z'’-]*)/g;
function bankEntries(text) {
  const rest = String(text).replace(BANK_ENTRY, '').replace(/[\s,，、;；.．]/g, '');
  if (rest) return null;
  const out = [...String(text).matchAll(BANK_ENTRY)].map((m) => ({ letter: m[1], word: m[2] }));
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
  const body = stripDirections(bodyIdx.map((i) => lines[i]));

  if (name === 'A') {
    // 选词填空：正文 + 词库（词库可能被排版到别处，已全局收集）
    // 每个空（26–35）的 options 都是同一份完整词库 —— 不是「一词一题」
    const text = body.filter((s) => !/^Questions?\s+\d/i.test(s));
    const bankOptions = bankWords.map((w) => `${w.letter}) ${w.word}`);
    passages.push({
      section: 'cloze', seq: 1, title: '选词填空', content: text.join('\n'),
      questions: bankOptions.length
        ? Array.from({ length: 10 }, (_, i) => ({ qtype: 'cloze', stem: String(26 + i), options: bankOptions.slice(), answer: '', analysis: '' }))
        : [],
    });
  } else if (name === 'B') {
    // 长篇阅读：段落（A-O）+ 匹配题（36-45）
    const firstQ = body.findIndex((s) => /^3[6-9]\s*[.．]\s|^4[0-5]\s*[.．]\s/.test(s));
    const head = firstQ < 0 ? body.length : firstQ;
    const paragraphs = body.slice(0, head);
    const title = paragraphs.find((s) => !/^[A-O]\)/.test(s)) || '长篇阅读';
    passages.push({
      section: 'match', seq: 1, title: '长篇阅读 · ' + title, content: paragraphs.join('\n'),
      questions: splitNumbered(body.slice(head).join('\n'), 36, 45)
        .map((c) => ({ qtype: 'match', stem: c.replace(/^\d{2}\s*[.．]\s*/, '').trim(), options: [], answer: '', analysis: '' })),
    });
  } else if (name === 'C') {
    // 仔细阅读：Passage One / Two + 题目（46-55）
    const groups = [];
    let g = null;
    for (const s of body) {
      if (isPassageHead(s)) { g = { title: s.trim(), lines: [] }; groups.push(g); }
      else if (g) g.lines.push(s);
    }
    if (!groups.length) groups.push({ title: 'Section C', lines: body });
    groups.forEach((grp, gi) => {
      const arr = grp.lines.filter((s) => !/^Questions?\s+\d+\s+to\s+\d+/i.test(s));
      const firstQ = arr.findIndex((s) => /^4[6-9]\s*[.．]\s|^5[0-5]\s*[.．]\s/.test(s));
      const head = firstQ < 0 ? arr.length : firstQ;
      const qText = arr.slice(head).join('\n');
      passages.push({
        section: 'reading', seq: gi + 1,
        title: '仔细阅读 · ' + grp.title.trim(),
        content: arr.slice(0, head).join('\n'),
        questions: splitNumbered(qText, 46, 55).map((c) => { const { stem, options } = parseOptions(c); return { qtype: 'choice', stem, options, answer: '', analysis: '' }; }),
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

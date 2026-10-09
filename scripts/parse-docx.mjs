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

const zip = fs.readFileSync(docxPath);
const xml = Buffer.from(unzipSync(zip)['word/document.xml']).toString('utf8');
const paras = xml
  .split(/<w:p[ >]/)
  .slice(1)
  .map((p) => {
    const ts = p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
    return ts.map((t) => decodeXml(t.replace(/<[^>]+>/g, ''))).join('');
  })
  .map((s) => healSpacing(s.replace(/\s+/g, ' ').trim()))
  .filter(Boolean);

// 兼容各种转写瑕疵：".Part I Writing" / "Part ][ Reading Comprehension" / "Part Ⅲ"
const PART_RE = /^\W*Part\b[\s\W]*(?:[IVXⅠⅡⅢⅣivx]{1,4}[\s\W]*)?(Writing|Listening|Reading|Translation)/i;
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
const isQNum = (p) => /^\d{2}\./.test(p);

// 选词填空的词库：一份词库常被折成 2–3 行、每行 5–7 个（"A) accustomed B) acquired C) assembly …"），
// 序号写法有 "A)" 也有 "A."；个别文档甚至是「无序号裸词表」（表格排版，还会重复一遍）。
// 判据：把词条全摘掉后该段不该再有实质内容 —— 这样才不会把正文里的 A) 误当词库。
const BANK_ENTRY = /([A-O])\s*[)）.．、]\s*([A-Za-z][A-Za-z'’-]*)/g;
function bankEntries(text) {
  const rest = String(text).replace(BANK_ENTRY, '').replace(/[\s,，、;；.．]/g, '');
  if (rest) return null;
  const out = [...String(text).matchAll(BANK_ENTRY)].map((m) => ({ letter: m[1], word: m[2] }));
  return out.length ? out : null;
}

// 收集一段范围内的词库；优先用字母序号，找不到则退回「裸词表」（按字母序补 A–O）
function collectBank(paras) {
  const map = new Map();
  for (const p of paras) {
    const e = bankEntries(p);
    if (e) for (const x of e) map.set(x.letter, x.word);
  }
  if (map.size >= 10) return [...map.keys()].sort().map((k) => map.get(k));
  const words = paras.filter((p) => /^[a-z][a-z'-]*$/i.test(p)).map((p) => p.toLowerCase());
  const uniq = [...new Set(words)];
  return uniq.length >= 12 && uniq.length <= 20 ? uniq.sort() : [];
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

function splitQuestions(text) {
  // 题号格式可能有瑕疵："46.What" / "52 . What" / "36.Jackson"
  return text
    .split(/(?=\d{2}\s*\.\s*[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
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
    // 选词填空：正文 + 词库（词库可能占多行、每行多个词，也可能无字母序号）
    const bank = collectBank(sec.paras);
    const body = sec.paras.filter(
      (p) => !bankEntries(p) && !isDirections(p) && !/Answer\s*Sheet/i.test(p) && !/^Questions\s+\d+\s+to\s+\d+/i.test(p)
    );
    // 模型是「10 个空共享一份 15 词词库」，不是「一个词对应一道题」。
    // 早期实现把每个备选词当成某道题的答案（26→adequate、27→natural…），完全错位，这里修正：
    // 每个空（26–35）的 options 都是同一份带字母序号的完整词库。
    const bankOptions = bank.map((w, i) => `${String.fromCharCode(65 + i)}) ${w}`);
    passages.push({
      section: 'cloze', seq: 1, title: '选词填空',
      content: body.join('\n'),
      questions: bankOptions.length
        ? Array.from({ length: 10 }, (_, i) => ({ qtype: 'cloze', stem: String(26 + i), options: bankOptions.slice(), answer: '', analysis: '' }))
        : [],
    });
  } else if (/^Section\s+B/i.test(sec.name)) {
    // 长篇阅读：文章段落 + 匹配题
    const clean = (p) => !isDirections(p) && !/Answer\s*Sheet/i.test(p);
    const firstQ = sec.paras.findIndex((p) => isQNum(p));
    const bodyParas = sec.paras.slice(0, firstQ < 0 ? sec.paras.length : firstQ).filter(clean);
    const qText = (firstQ >= 0 ? sec.paras.slice(firstQ) : []).join(' ');
    const qs = splitQuestions(qText).map((chunk) => ({
      qtype: 'match', stem: chunk, options: [], answer: '', analysis: '',
    }));
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
      const firstQ = grp.paras.findIndex((p) => isQNum(p));
      const split = firstQ < 0 ? grp.paras.length : firstQ;
      const body = grp.paras
        .slice(0, split)
        .filter((p) => !isDirections(p) && !/Answer\s*Sheet/i.test(p) && !/^Questions\s+\d+\s+to\s+\d+/i.test(p));
      const qText = grp.paras.slice(split).join(' ');
      const qs = splitQuestions(qText).map((chunk) => {
        const { stem, options } = parseOptions(chunk);
        return { qtype: 'choice', stem, options, answer: '', analysis: '' };
      });
      passages.push({
        section: 'reading', seq: gi + 1, title: '仔细阅读 · ' + grp.title,
        content: body.join('\n'),
        questions: qs,
      });
    });
  }
}

if (translation) {
  passages.push({
    section: 'translation', seq: 1, title: '翻译（中文原文）',
    content: translation.paras.filter((p) => !isDirections(p)).join('\n'),
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

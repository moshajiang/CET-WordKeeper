// 批量预生成「答案 + 中文解析 + 全文翻译」，写入本地库与覆盖层文件（可续跑）
//
// 用法示例：
//   node scripts/gen-answers.mjs --model deepseek-v4-pro --exams 1 --concurrency 2      # 试跑 1 套
//   node scripts/gen-answers.mjs --model deepseek-v4-pro --exams 78 --concurrency 6    # 全量
//   node scripts/gen-answers.mjs --dry                                                 # 只看任务清单
//
// 关键设计
// - 每个篇章一次请求，返回 {translation, answers:[{n,answer,analysis}]}
// - 每个客观题再跑一次「独立复核」（只作答不解释）；与首次不一致时发起第三次仲裁
// - 结果写入 data/ai-answers/<key>.json（覆盖层，源码可复现），同时直接回写 data/keeper.db
// - 已有结果的篇章默认跳过（--force 重做），失败篇章不影响其它篇章
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const has = (name) => args.includes('--' + name);

const MODEL = opt('model', 'deepseek-v4-pro');
const CONC = Number(opt('concurrency', 4));
const EXAM_LIMIT = Number(opt('exams', 0));
const OVERLAY_DIR = path.join(root, 'data', 'ai-answers');
const DB_PATH = path.join(root, 'data', 'keeper.db');
const DRY = has('dry');
const FORCE = has('force');
const VERIFY = !has('no-verify');
// 只对「答案有效但复核没跑成」的题重跑复核（不重新生成答案）
const REVERIFY = has('reverify');

// ---------- 取 API 配置：环境变量优先，其次本机已配置的用户库 ----------
function readApiConfig() {
  if (process.env.KEEPER_AI_KEY && process.env.KEEPER_AI_BASE) {
    return { base: process.env.KEEPER_AI_BASE, key: process.env.KEEPER_AI_KEY };
  }
  const dir = path.join(process.env.APPDATA || '', 'cet-wordkeeper');
  if (!fs.existsSync(dir)) return null;
  const cands = fs.readdirSync(dir).filter((f) => /^keeper\.db/.test(f))
    .map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const f of cands) {
    try {
      const db = new SQL.Database(fs.readFileSync(f));
      const r = db.exec('SELECT key,value FROM settings');
      if (r.length) {
        const m = {}; for (const row of r[0].values) m[row[0]] = row[1];
        if (m.api_key && /^sk-/.test(m.api_key) && m.api_base) { db.close(); return { base: m.api_base, key: m.api_key }; }
      }
      db.close();
    } catch { /* 跳过坏文件 */ }
  }
  return null;
}

const SQL = await initSqlJs({ locateFile: (f) => path.join(root, 'node_modules', 'sql.js', 'dist', f) });
const API = readApiConfig();
if (!API && !DRY) { console.error('未找到可用的 API 配置（环境变量 KEEPER_AI_KEY/KEEPER_AI_BASE 或用户库 settings）'); process.exit(2); }
const db = new SQL.Database(fs.readFileSync(DB_PATH));
const all = (sql, p = []) => { const s = db.prepare(sql); s.bind(p || []); const out = []; while (s.step()) out.push(s.getAsObject()); s.free(); return out; };

// ---------- 任务清单 ----------
const OBJ = new Set(['cloze', 'match', 'reading']);
// 主观题篇章：写作生成「范文」，翻译生成「英文参考译文」（无客观答案，存 passage.reference）
const REF = new Set(['writing', 'translation']);
const ONLY = typeof opt('only', null) === 'string' ? String(opt('only', null)) : null;
const exams = all(`SELECT id, level, year, month, set_no FROM exam ORDER BY level DESC, year, month, set_no`)
  .filter((e) => e.imported !== 1)
  .filter((e) => !ONLY || `${e.level}-${e.year}.${String(e.month).padStart(2, '0')}-set${e.set_no}`.includes(ONLY))
  .slice(0, EXAM_LIMIT || undefined);

const tasks = [];
for (const ex of exams) {
  const key = `${ex.level}-${ex.year}.${String(ex.month).padStart(2, '0')}-set${ex.set_no}`;
  const overlayPath = path.join(OVERLAY_DIR, key + '.json');
  let done = {};
  if (fs.existsSync(overlayPath) && !FORCE) {
    try { const o = JSON.parse(fs.readFileSync(overlayPath, 'utf8')); for (const p of o.passages || []) done[p.section + ':' + p.seq] = p; } catch { /* 重做 */ }
  }
  const passages = all(`SELECT id, section, seq, title, content FROM passage WHERE exam_id = ? ORDER BY id`, [ex.id]);
  for (const p of passages) {
    if (!OBJ.has(p.section) && !REF.has(p.section)) continue;
    // 已有条目也要看完整度：作答数 < 题数、缺翻译、缺范文的篇章要重做
    // （历史教训：AI 偶发返回畸形输出，只写回部分答案；旧逻辑「有条目就跳过」会让这些篇章永远缺答案）
    const d = done[p.section + ':' + p.seq];
    if (d) {
      const needAns = OBJ.has(p.section);
      const qs0 = needAns ? all(`SELECT id, stem, options FROM question WHERE passage_id = ? ORDER BY id`, [p.id]) : [];
      const ansOk = !needAns || qs0.every((q, i) => ((d.questions || [])[i] || {}).answer && String((d.questions || [])[i].answer).trim());
      const trOk = !needAns || String(d.translation || '').length >= 30;
      const refOk = !REF.has(p.section) || String(d.reference || '').length >= 50;
      const ansValid = !needAns || qs0.every((q, i) => /^[A-D]$/.test(String(((d.questions || [])[i] || {}).answer || '').trim()));
      if (ansOk && trOk && refOk && ansValid) continue;
    }
    const qs = all(`SELECT id, stem, options FROM question WHERE passage_id = ? ORDER BY id`, [p.id]);
    tasks.push({ ex, key, overlayPath, passage: p, questions: qs, done, ref: REF.has(p.section) });
  }
}

console.log(`模型 ${MODEL} ｜ 并发 ${CONC} ｜ 复核 ${VERIFY ? '开' : '关'} ｜ 待生成篇章 ${tasks.length}（共 ${exams.length} 套）`);
if (DRY) {
  const bySection = {};
  for (const t of tasks) { bySection[t.passage.section] = (bySection[t.passage.section] || 0) + 1; }
  console.log('按题型:', JSON.stringify(bySection));
  for (const t of tasks.slice(0, 10)) console.log(`  ${t.key} ${t.passage.section}#${t.passage.seq} ${t.questions.length} 题 正文 ${t.passage.content.length} 字`);
  process.exit(0);
}

// ---------- LLM 调用 ----------
const t0 = Date.now();
let calls = 0, inTok = 0, outTok = 0;
async function chat(messages, { maxTokens = 7000, temperature = 0.2, json = true } = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const body = { model: MODEL, messages, temperature, max_tokens: maxTokens };
      if (json) body.response_format = { type: 'json_object' };
      const resp = await fetch(API.base.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API.key },
        body: JSON.stringify(body),
      });
      calls++;
      if (!resp.ok) {
        const txt = await resp.text();
        if (resp.status === 429 || resp.status >= 500) { await sleep(2000 * attempt); continue; }
        throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 160)}`);
      }
      const data = await resp.json();
      if (data.usage) { inTok += data.usage.prompt_tokens || 0; outTok += data.usage.completion_tokens || 0; }
      const msg = data.choices && data.choices[0] && data.choices[0].message;
      return { content: (msg && msg.content) || '', reasoning: (msg && msg.reasoning_content) || '' };
    } catch (err) {
      if (attempt === 4) throw err;
      await sleep(1500 * attempt);
    }
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseJson(text) {
  if (!text) throw new Error('空响应');
  let s = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  return JSON.parse(s);
}

// ---------- 提示词 ----------
const SYS = '你是大学英语四六级（CET）命题与阅卷专家。你只能输出一个 JSON 对象，不要输出任何解释、寒暄或 markdown 代码块。';

function optionsText(raw) {
  let arr = [];
  try { arr = JSON.parse(raw || '[]'); } catch { arr = String(raw || '').split('\n').filter(Boolean); }
  // 选项数组顺序可能是打乱的，按字母前缀排序后展示，避免模型误判
  return arr.map((o) => String(o).replace(/^([A-Z])[\)\.]\s*/, '$1) '))
    .sort((a, b) => a.charCodeAt(0) - b.charCodeAt(0));
}

function buildPrompt(section, passage, questions) {
  // 写作 / 翻译章节没有客观题：生成范文或参考译文，供离线自我对照
  if (section === 'writing') {
    return `${SYS}\n\n下面是一道 CET 写作题的题目要求（英文 Directions）。请写一篇符合要求的考场范文，并给出中文点评。\n\n【题目要求】\n${passage.content}\n\n` +
      `要求：正文 120–180 词，结构清晰（引出观点—论证—总结），使用四六级常见高分表达但不要堆砌生僻词。\n` +
      `只返回 JSON：{"reference":"<英文范文正文>","note":"<中文点评：这篇范文怎么切题、结构怎么安排、有哪些可复用句型，150 字以内>"}`;
  }
  if (section === 'translation') {
    return `${SYS}\n\n下面是一道 CET 汉译英试题的原文。请给出高质量参考译文（英文）。\n` +
      `注意：原文开头可能残留一句考场说明（例如 “should write your answer on Answer Sheet 2.”），忽略它，只翻译真正的题目内容。\n\n【中文原文】\n${passage.content}\n\n` +
      `要求：忠实原文、语法正确、用词地道，符合四六级翻译评分的高分标准。\n` +
      `只返回 JSON：{"reference":"<英文参考译文>","note":"<中文点评：难点在哪里、关键表达怎么处理，150 字以内>"}`;
  }
  // 少数篇章源文档缺题（无题干可作答），只生成全文翻译
  if (!questions.length) {
    return `${SYS}\n\n请把下面这篇 CET 英语文章翻译成通顺自然的简体中文。\n\n【文章】\n${passage.content}\n\n` +
      `只返回 JSON：{"translation":"<中文翻译>","answers":[]}`;
  }
  const head = { cloze: '选词填空（Section A）', match: '长篇阅读·段落匹配（Section B）', reading: '仔细阅读（Section C）' }[section];

  if (section === 'cloze') {
    const bank = optionsText(questions[0] && questions[0].options);
    const nums = questions.map((q) => q.stem.trim()).filter(Boolean);
    return `${SYS}\n\n下面是一篇 CET ${head} 文章。文中出现的数字是 10 个空格编号（数字后紧跟的那个词之前缺少一个被挖空的词），空格编号为：${nums.join('、')}。\n` +
      `备选词库（A–O，每个词最多用一次，其中有 5 个多余词）：\n${bank.join('\n')}\n\n` +
      `【文章】\n${passage.content}\n\n请为每个空格选出正确的备选词，并给出中文解析。\n` +
      `只返回 JSON：{"translation":"<全文中文翻译，通顺自然>","answers":[{"n":26,"answer":"A","word":"alleviate","analysis":"<为什么是这个词：语法+搭配+语义，1-2 句>"}]}`;
  }
  if (section === 'match') {
    const qs = questions.map((q, i) => `${i + 1}. ${q.stem.trim()}`).join('\n');
    return `${SYS}\n\n下面是一篇 CET ${head} 文章，每个段落以 A)、B)、C)… 开头。每题给出一句陈述，请判断该陈述出自哪个段落（答案写段落字母）。\n\n` +
      `【文章】\n${passage.content}\n\n【题目】\n${qs}\n\n注意：题干开头的序号（如 36.）是题号，不是段落字母。\n` +
      `只返回 JSON：{"translation":"<全文中文翻译，通顺自然>","answers":[{"n":36,"answer":"C","analysis":"<依据：该段哪句话对应这条陈述>"}]}`;
  }
  const qs = questions.map((q) => `【题号 ${q.stem.trim().match(/^(\d+)/) ? q.stem.trim().match(/^(\d+)/)[1] : ''}】${q.stem.trim()}\n${optionsText(q.options).join('\n')}`).join('\n\n');
  return `${SYS}\n\n下面是一篇 CET ${head} 文章与若干单项选择题。选项自带字母，字母以选项开头为准。\n\n` +
    `【文章】\n${passage.content}\n\n【题目】\n${qs}\n\n` +
    `只返回 JSON：{"translation":"<全文中文翻译，通顺自然>","answers":[{"n":46,"answer":"B","analysis":"<正确项依据 + 干扰项为何错，2-3 句>"}]}`;
}

// 兜底：只出答案与解析（不含翻译），用于长文章一次调用被截断时
function buildAnswersPrompt(section, passage, questions) {
  const head = { cloze: '选词填空（Section A）', match: '长篇阅读·段落匹配（Section B）', reading: '仔细阅读（Section C）' }[section];
  if (section === 'cloze') {
    const bank = optionsText(questions[0] && questions[0].options);
    return `${SYS}\n\n下面是 CET ${head} 文章，空格编号 ${questions.map((q) => q.stem.trim()).join('、')}。\n词库（A–O，每词最多一次）：\n${bank.join('\n')}\n\n【文章】\n${passage.content}\n\n` +
      `只返回 JSON：{"answers":[{"n":26,"answer":"A","word":"alleviate","analysis":"<1-2 句中文解析>"}]}`;
  }
  if (section === 'match') {
    const qs = questions.map((q, i) => `${i + 1}. ${q.stem.trim()}`).join('\n');
    return `${SYS}\n\n下面是 CET ${head} 文章（段落以 A)、B)… 开头）与陈述句。\n\n【文章】\n${passage.content}\n\n【题目】\n${qs}\n\n` +
      `只返回 JSON：{"answers":[{"n":36,"answer":"C","analysis":"<该段哪句对应，1 句中文>"}]}`;
  }
  const qs = questions.map((q) => `${q.stem.trim()}\n${optionsText(q.options).join('\n')}`).join('\n\n');
  return `${SYS}\n\n下面是 CET ${head} 文章与单项选择题。\n\n【文章】\n${passage.content}\n\n【题目】\n${qs}\n\n` +
    `只返回 JSON：{"answers":[{"n":46,"answer":"B","analysis":"<1-2 句中文解析>"}]}`;
}

function buildTranslationPrompt(passage) {
  return `${SYS}\n\n请把下面这篇 CET 英语文章翻译成通顺自然的简体中文，忠实原文、不要增删内容。\n\n【文章】\n${passage.content}\n\n` +
    `只返回 JSON：{"translation":"<中文翻译>"}`;
}

// 先生成「答案+解析+翻译」；若输出被截断（长文章常见）则拆成两次调用兜底
async function generateData(section, passage, questions) {
  // 写作 / 翻译：只产出范文或参考译文
  if (section === 'writing' || section === 'translation') {
    const r = await chat([{ role: 'user', content: buildPrompt(section, passage, questions) }], { maxTokens: 12000, temperature: 0.4 });
    const d = parseJson(r.content);
    return { answers: [], translation: '', reference: String(d.reference || '').trim(), note: String(d.note || '').trim() };
  }
  if (questions.length) {
    try {
      const r = await chat([{ role: 'user', content: buildPrompt(section, passage, questions) }], { maxTokens: 16000 });
      const d = parseJson(r.content);
      if (d && Array.isArray(d.answers) && d.answers.length) return d;
      throw new Error('answers 为空');
    } catch (e) {
      const a = parseJson((await chat([{ role: 'user', content: buildAnswersPrompt(section, passage, questions) }], { maxTokens: 10000, temperature: 0 })).content);
      let translation = '';
      try {
        translation = String(parseJson((await chat([{ role: 'user', content: buildTranslationPrompt(passage) }], { maxTokens: 6000, temperature: 0.3 })).content).translation || '');
      } catch { /* 翻译失败不影响答案落库 */ }
      return { answers: a.answers, translation };
    }
  }
  const t = await chat([{ role: 'user', content: buildTranslationPrompt(passage) }], { maxTokens: 8000, temperature: 0.3 });
  return { answers: [], translation: String(parseJson(t.content).translation || '') };
}

function buildVerifyPrompt(section, passage, questions, first) {
  if (section === 'writing' || section === 'translation') return null;   // 主观题无客观答案可复核
  if (!questions.length) return null;
  // 复核用：题干在前、文章在后，且只要答案不解释，降低与首次回答的相关性
  if (section === 'cloze') {
    const bank = optionsText(questions[0] && questions[0].options);
    return `${SYS}\n\n你是 CET 阅卷专家。下面是一篇选词填空，空格编号 ${questions.map((q) => q.stem.trim()).join('、')}。\n` +
      `词库：\n${bank.join('\n')}\n\n【文章】\n${passage.content}\n\n` +
      `逐一独立判断每个空格应填的词（把它们代回原文，检查语法、搭配与语义是否通顺），不要参考任何既有答案。\n` +
      `只返回 JSON：{"answers":[{"n":26,"answer":"A"}]}`;
  }
  if (section === 'match') {
    const qs = questions.map((q, i) => `${i + 1}. ${q.stem.trim()}`).join('\n');
    return `${SYS}\n\n你是 CET 阅卷专家。每题是文章里某一段的信息，请判断它出自哪一段（写段落字母）。\n\n【题目】\n${qs}\n\n【文章】\n${passage.content}\n\n` +
      `逐题独立判断，不要参考任何既有答案。只返回 JSON：{"answers":[{"n":36,"answer":"C"}]}`;
  }
  const qs = questions.map((q) => `${q.stem.trim()}\n${optionsText(q.options).join('\n')}`).join('\n\n');
  return `${SYS}\n\n你是 CET 阅卷专家。请逐题作答（写下你认为正确的选项字母）。\n\n【题目】\n${qs}\n\n【文章】\n${passage.content}\n\n` +
    `逐题独立判断，不要参考任何既有答案。只返回 JSON：{"answers":[{"n":46,"answer":"B"}]}`;
}

// ---------- 结构校验 ----------
function paragraphLetters(content) {
  const set = new Set();
  for (const m of String(content).matchAll(/(?:^|\n)([A-Z])[\)\.]/g)) set.add(m[1]);
  return set;
}
function normalizeAnswers(section, list, questions) {
  const out = new Map();
  const nums = questions.map((q) => String(q.stem.trim().match(/^(\d+)/) ? q.stem.trim().match(/^(\d+)/)[1] : '').trim());
  (list || []).forEach((a, idx) => {
    const n = String(a && (a.n !== undefined ? a.n : a.number !== undefined ? a.number : (a.num !== undefined ? a.num : ''))).trim();
    const letter = String((a && (a.answer || a.choice || a.letter)) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1);
    let keyIdx = -1;
    if (n) keyIdx = nums.indexOf(n);
    if (keyIdx < 0 && !n) keyIdx = idx;                     // 模型没给题号时按顺序兜底
    if (keyIdx >= 0 && keyIdx < questions.length) out.set(keyIdx, { n: nums[keyIdx] || String(keyIdx + 1), letter, raw: a });
  });
  return out;
}
function validate(section, questions, map) {
  const problems = [];
  if (map.size !== questions.length) problems.push(`作答数 ${map.size} ≠ 题数 ${questions.length}`);
  const letters = [...map.values()].map((v) => v.letter);
  if (letters.some((l) => !/^[A-Z]$/.test(l))) problems.push('存在非单字母答案');
  if (section === 'reading') {
    if (letters.some((l) => !'ABCD'.includes(l))) problems.push('阅读答案超出 A–D');
  }
  if (section === 'cloze') {
    const bankLetters = new Set(optionsText(questions[0] && questions[0].options).map((o) => o[0]));
    const bad = letters.filter((l) => !bankLetters.has(l));
    if (bad.length) problems.push('答案不在词库字母表: ' + bad.join(','));
    const dup = letters.filter((l, i) => letters.indexOf(l) !== i);
    if (dup.length) problems.push('同一字母被重复使用（CET 要求每词一次）: ' + [...new Set(dup)].join(','));
  }
  return problems;
}

// ---------- 单篇章处理 ----------
async function runTask(task) {
  const { ex, key, overlayPath, passage, questions, done } = task;
  const section = passage.section;
  const label = `${key} ${section}#${passage.seq}`;
  const gen = await generateData(section, passage, questions);
  const data = gen;
  const map = normalizeAnswers(section, data.answers, questions);
  const problems = validate(section, questions, map);
  let translation = String(data.translation || '').trim();
  // 独立复核：只作答，比对答案；不一致则仲裁
  let verifyError = null;
  let dissent = {};
  let verifyRan = false;
  const verifyPrompt = buildVerifyPrompt(section, passage, questions, map);
  if (VERIFY && verifyPrompt) {
    try {
      // 复核也要给足 token：推理模型的思维链会先吃掉一大截预算，给少了 content 会是空的
      let vText = '';
      for (let i = 0; i < 2 && !vText; i++) {
        const v = await chat([{ role: 'user', content: verifyPrompt + (i ? '\n\n直接给出 JSON。' : '') }], { maxTokens: 8000, temperature: 0 });
        vText = v.content && v.content.trim() ? v.content : '';
        if (!vText) await sleep(800);
      }
      if (!vText) throw new Error('复核响应为空');
      const vmap = normalizeAnswers(section, parseJson(vText).answers, questions);
      verifyRan = true;
      for (const [i, a] of map) {
        const b = vmap.get(i);
        if (b && b.letter !== a.letter) dissent[i] = b.letter;
      }
      if (Object.keys(dissent).length) {
        const pairs = Object.entries(dissent).map(([i, l]) => `题 ${map.get(Number(i)).n}：候选1 = ${map.get(Number(i)).letter}，候选2 = ${l}`).join('\n');
        const arb = await chat([{ role: 'user', content: `${SYS}\n\n你是 CET 阅卷组长，需要裁定分歧。\n\n${buildPrompt(section, passage, questions)}\n\n注意：已有两种候选答案，请逐一核对原文后给出你判定正确的答案（可以选候选1或候选2，也可以给出第三种）。\n\n${pairs}\n\n只返回 JSON：{"answers":[{"n":26,"answer":"A","reason":"<一句话依据>"}]}` }], { maxTokens: 3000, temperature: 0 });
        const amap = normalizeAnswers(section, parseJson(arb.content).answers, questions);
        for (const i of Object.keys(dissent).map(Number)) {
          const a = amap.get(i);
          if (a && /^[A-Z]$/.test(a.letter)) {
            const old = map.get(i).letter;
            if (a.letter !== old) { map.get(i).letter = a.letter; }
          }
        }
      }
    } catch (e) {
      verifyError = String(e.message).slice(0, 120);
      problems.push('复核失败: ' + String(e.message).slice(0, 60));
    }
  }

  const reference = String(data.reference || '').trim();
  const result = {
    section, seq: passage.seq, translation,
    ...(reference ? { reference, note: String(data.note || '').trim() } : {}),
    ...(verifyError ? { verifyError } : {}),
    questions: questions.map((q, i) => {
      const a = map.get(i) || {};
      return {
        stem: q.stem, answer: a.letter || '', analysis: String((a.raw && (a.raw.analysis || a.raw.reason)) || '').trim(),
        verified: verifyRan && !dissent[i], dissent: dissent[i] || null,
      };
    }),
  };

  // 写入覆盖层（按篇章增量累积）
  let overlay = { level: ex.level, year: ex.year, month: ex.month, set_no: ex.set_no, model: MODEL, passages: [] };
  if (fs.existsSync(overlayPath)) { try { overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8')); } catch { /* 重建 */ } }
  overlay.passages = (overlay.passages || []).filter((p) => !(p.section === section && p.seq === passage.seq));
  overlay.passages.push(result);
  overlay.generatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(overlayPath), { recursive: true });
  fs.writeFileSync(overlayPath, JSON.stringify(overlay, null, 1));

  // 回写数据库
  if (translation || reference) {
    const cols = all('PRAGMA table_info(passage)').map((c) => c.name);
    if (!cols.includes('translation')) db.run('ALTER TABLE passage ADD COLUMN translation TEXT');
    if (!cols.includes('reference')) db.run('ALTER TABLE passage ADD COLUMN reference TEXT');
    if (translation) db.run('UPDATE passage SET translation = ? WHERE id = ?', [translation, passage.id]);
    if (reference) db.run('UPDATE passage SET reference = ? WHERE id = ?', [reference, passage.id]);
  }
  questions.forEach((q, i) => {
    const a = map.get(i);
    if (!a || !a.letter) return;
    db.run('UPDATE question SET answer = ?, analysis = ? WHERE id = ?',
      [a.letter, String((a.raw && (a.raw.analysis || a.raw.reason)) || '').trim(), q.id]);
  });
  persistDb();

  const flags = [];
  if (problems.length) flags.push('⚠ ' + problems.join('；'));
  const nd = Object.keys(dissent).length;
  if (nd) flags.push(`复核分歧 ${nd} 题`);
  if (VERIFY && questions.length && !verifyRan) flags.push('未复核');
  const what = reference ? `${section === 'writing' ? '范文' : '参考译文'} ${reference.length} 字` : `翻译 ${translation.length} 字`;
  console.log(`✓ ${label}  ${questions.length} 题  ${what}  ${flags.join('  ') || ''}`);
  return { ok: true, problems, dissent: nd, questions: questions.length };
}

let dbSaveQueue = null;
function persistDb() {
  // sql.js 是全内存库，写盘用节流，避免每篇章都全量导出
  if (dbSaveQueue) return;
  dbSaveQueue = setTimeout(() => {
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
    dbSaveQueue = null;
  }, 3000);
}

// ---------- 只补复核（--reverify）----------
// 场景：主生成时复核请求失败（返回空/JSON 截断），题目只有单次作答、没通过交叉检查。
// 这里只重跑复核，不重新生成答案；若这次发现与已定稿答案不一致，才发起第三方仲裁。
if (REVERIFY) {
  const jobs = [];
  for (const f of fs.readdirSync(OVERLAY_DIR).filter((x) => x.endsWith('.json')).sort()) {
    const overlayPath = path.join(OVERLAY_DIR, f);
    const ov = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
    const ex = all('SELECT id FROM exam WHERE level=? AND year=? AND month=? AND set_no=?',
      [ov.level, ov.year, ov.month, ov.set_no])[0];
    if (!ex) continue;
    for (const op of ov.passages || []) {
      // 只处理「有答案、但既没通过复核、也没记录过分歧」的题（记录过分歧的已仲裁过，不重复打扰）
      if (!(op.questions || []).some((q) => q.answer && !q.verified && !q.dissent)) continue;
      const p = all('SELECT id, section, seq, content FROM passage WHERE exam_id=? AND section=? AND seq=?',
        [ex.id, op.section, op.seq])[0];
      if (!p) continue;
      const qs = all('SELECT id, stem, options FROM question WHERE passage_id=? ORDER BY id', [p.id]);
      if (!qs.length) continue;
      jobs.push({ overlayPath, ov, op, passage: p, questions: qs });
    }
  }
  console.log(`待补复核篇章 ${jobs.length} ｜ 模型 ${MODEL} ｜ 并发 ${CONC}`);

  let okPassages = 0, newlyVerified = 0, stillUnverified = 0, newDissent = 0, failed = 0;
  let cur2 = 0;
  const workers2 = Array.from({ length: Math.min(CONC, jobs.length || 1) }, async () => {
    while (cur2 < jobs.length) {
      const j = jobs[cur2++];
      const label = `${j.ov.level}-${j.ov.year}.${j.ov.month}-set${j.ov.set_no} ${j.op.section}#${j.op.seq}`;
      try {
        const vp = buildVerifyPrompt(j.op.section, j.passage, j.questions, null);
        let vText = '';
        for (let i = 0; i < 3 && !vText; i++) {
          const v = await chat([{ role: 'user', content: vp + (i ? '\n\n严格只输出 JSON 对象本身。' : '') }], { maxTokens: 8000, temperature: 0 });
          vText = v.content && v.content.trim() ? v.content : '';
          if (!vText) await sleep(1200);
        }
        if (!vText) throw new Error('复核响应为空');
        const vmap = normalizeAnswers(j.op.section, parseJson(vText).answers, j.questions);

        const conflicts = [];
        j.op.questions.forEach((oq, i) => {
          if (!oq.answer || oq.verified || oq.dissent) return;
          const b = vmap.get(i);
          if (!b || !b.letter) return;                      // 这次没给出该题 → 保持未复核
          if (b.letter === oq.answer) { oq.verified = true; newlyVerified++; }
          else conflicts.push([i, b.letter]);
        });

        // 新发现的分歧：第三方仲裁后定稿
        if (conflicts.length) {
          const pairs = conflicts.map(([i, l]) => `题 ${String(j.op.questions[i].stem).trim().slice(0, 12)}：候选1 = ${j.op.questions[i].answer}，候选2 = ${l}`).join('\n');
          const arb = await chat([{ role: 'user', content: `${SYS}\n\n你是 CET 阅卷组长，需要裁定分歧。\n\n${buildPrompt(j.op.section, j.passage, j.questions)}\n\n已有两种候选答案，请核对原文后给出你判定正确的答案。\n\n${pairs}\n\n只返回 JSON：{"answers":[{"n":26,"answer":"A","reason":"<一句话依据>"}]}` }], { maxTokens: 3000, temperature: 0 });
          const amap = normalizeAnswers(j.op.section, parseJson(arb.content).answers, j.questions);
          for (const [i, l] of conflicts) {
            const a = amap.get(i);
            if (a && /^[A-Z]$/.test(a.letter) && a.letter !== j.op.questions[i].answer) {
              j.op.questions[i].answer = a.letter;
              db.run('UPDATE question SET answer = ? WHERE id = ?', [a.letter, j.questions[i].id]);
            }
            j.op.questions[i].verified = false;
            j.op.questions[i].dissent = l;
            newDissent++;
          }
        }
        j.op.questions.forEach((oq) => { if (oq.answer && !oq.verified && !oq.dissent) stillUnverified++; });

        // 复核已重跑：清掉上次的失败原因（只清这次真的通过了的）
        j.op.questions.forEach((oq) => { if (oq.verified && oq.verifyError) delete oq.verifyError; });
        if (j.op.verifyError && !j.op.questions.some((oq) => oq.answer && !oq.verified && !oq.dissent)) delete j.op.verifyError;

        j.ov.generatedAt = new Date().toISOString();
        j.ov.reverifiedAt = new Date().toISOString();
        fs.writeFileSync(j.overlayPath, JSON.stringify(j.ov, null, 1));
        persistDb();
        okPassages++;
        console.log(`✓ ${label}${conflicts.length ? `  新分歧 ${conflicts.length} 题（已仲裁）` : '  复核通过'}`);
      } catch (e) {
        failed++;
        // 记录失败原因并落盘，便于下次定位（否则原因只存在于控制台）
        j.op.verifyError = String(e.message).slice(0, 120);
        try { fs.writeFileSync(j.overlayPath, JSON.stringify(j.ov, null, 1)); } catch {}
        console.log(`✗ ${label}  ${String(e.message).slice(0, 80)}`);
      }
      await sleep(200);
    }
  });
  await Promise.all(workers2);
  if (dbSaveQueue) { clearTimeout(dbSaveQueue); dbSaveQueue = null; }
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  console.log(`\n===== 补复核：成功 ${okPassages}/${jobs.length} ｜ 新通过 ${newlyVerified} 题 ｜ 新分歧 ${newDissent} 题 ｜ 仍未复核 ${stillUnverified} 题 ｜ 失败篇章 ${failed} =====`);
  console.log(`请求 ${calls} 次 ｜ token 输入 ${inTok} 输出 ${outTok} ｜ 用时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
  process.exit(failed === 0 ? 0 : 1);
}

// ---------- 并发调度 ----------
const results = [];
let cursor = 0;
const workers = Array.from({ length: Math.min(CONC, tasks.length || 1) }, async () => {
  while (cursor < tasks.length) {
    const t = tasks[cursor++];
    const label = `${t.key} ${t.passage.section}#${t.passage.seq}`;
    try {
      results.push(await runTask(t));
    } catch (e) {
      console.log(`✗ ${label}  ${String(e.message).slice(0, 120)}`);
      results.push({ ok: false, label });
    }
    await sleep(200);
  }
});
await Promise.all(workers);
if (dbSaveQueue) { clearTimeout(dbSaveQueue); dbSaveQueue = null; }
fs.writeFileSync(DB_PATH, Buffer.from(db.export()));

const ok = results.filter((r) => r.ok).length;
const flagged = results.filter((r) => r.ok && r.problems.length).length;
const diss = results.filter((r) => r.ok && r.dissent).reduce((a, r) => a + r.dissent, 0);
const qs = results.filter((r) => r.ok).reduce((a, r) => a + r.questions, 0);
console.log(`\n===== 完成 ${ok}/${results.length} 篇章 ｜ 题 ${qs} ｜ 结构告警 ${flagged} ｜ 复核分歧 ${diss} =====`);
console.log(`请求 ${calls} 次 ｜ token 输入 ${inTok} 输出 ${outTok} ｜ 用时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
process.exit(ok === results.length ? 0 : 1);

// 把人工产出的内容补丁合并进 data/ai-answers/ 覆盖层（gen-answers 的离线替代）。
// 用法: node scripts/apply-manual.mjs <patch.json> [patch2.json ...]
//
// patch.json 格式:
// {
//   "key": "CET4-2015.12-set1",                 // 覆盖层文件名主干（必须有对应 seed）
//   "passages": [
//     { "section": "cloze", "seq": 1,
//       "translation": "全文中文翻译（可选）",
//       "questions": [ {"stem":"26","answer":"K","analysis":"..."} ] },   // 按题号/位置合并
//     { "section": "match", "seq": 1, "translation": "..." },             // 只补翻译
//     { "section": "writing", "seq": 1, "reference": "英文范文", "note": "中文点评" }
//   ]
// }
//
// 合并语义（与 apply-answers 的位置对齐一致）：
//   · 篇章条目不存在 → 新建；questions 由补丁提供（须带 stem）
//   · 已存在 → 只覆盖补丁里给出的非空字段；题目按位置对齐，长度不一致直接报错
//   · 绝不动 verified 之外的学习数据；verified 统一记 false（未独立复核）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OV = path.join(root, 'data', 'ai-answers');
const SEED = path.join(root, 'data', 'seed');
const files = process.argv.slice(2);
if (!files.length) { console.error('用法: node scripts/apply-manual.mjs <patch.json> [...]'); process.exit(1); }

for (const pf of files) {
  const patch = JSON.parse(fs.readFileSync(pf, 'utf8'));
  const key = patch.key;
  if (!key) { console.error(`✗ ${pf}: 缺 key`); process.exit(1); }
  const seedPath = path.join(SEED, key.toLowerCase() + '.json');
  if (!fs.existsSync(seedPath)) { console.error(`✗ ${key}: 找不到 seed ${seedPath}`); process.exit(1); }
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const seedMap = new Map(seed.passages.map((p) => [p.section + ':' + p.seq, p]));

  const ovPath = path.join(OV, key + '.json');
  let ov = { level: seed.level, year: seed.year, month: seed.month, set_no: seed.set_no, model: 'manual', passages: [] };
  try { ov = JSON.parse(fs.readFileSync(ovPath, 'utf8')); } catch { /* 新文件 */ }
  ov.model = ov.model && ov.model !== 'manual' ? ov.model : 'manual';
  const map = new Map(ov.passages.map((p) => [p.section + ':' + p.seq, p]));

  for (const pp of patch.passages || []) {
    const k = pp.section + ':' + pp.seq;
    const sp = seedMap.get(k);
    if (!sp) { console.error(`✗ ${key} ${k}: seed 中无此篇章`); process.exit(1); }
    let e = map.get(k);
    const created = !e;
    if (!e) { e = { section: pp.section, seq: pp.seq, translation: '', questions: [] }; map.set(k, e); }

    if (pp.translation) e.translation = String(pp.translation).trim();
    if (pp.reference) e.reference = String(pp.reference).trim();
    if (pp.note) e.note = String(pp.note).trim();

    if (pp.questions) {
      const want = (sp.questions || []).length;
      if (created) {
        if (pp.questions.length !== want) { console.error(`✗ ${key} ${k}: 新建条目题数 ${pp.questions.length} ≠ seed ${want}`); process.exit(1); }
        e.questions = pp.questions.map((q, i) => ({
          stem: q.stem || String(sp.questions[i].stem || ''),
          answer: String(q.answer || '').trim(),
          analysis: String(q.analysis || '').trim(),
          verified: false, dissent: null,
        }));
      } else {
        // 已有条目：按「题号数字前缀（或补丁里的 n 字段）」定位补丁题（支持只修个别题），找不到再退回按位置
        const numOf = (q) => {
          const m = String(q.stem || '').trim().match(/^(\d{1,2})\b/);
          return m ? m[1] : (q.n != null ? String(q.n) : null);
        };
        const idxByNum = new Map();
        (e.questions || []).forEach((q, i) => {
          // 覆盖层题干可能不带题号（gen-answers 曾剥掉），此时用 seed 同位置的题号兜底
          const n = numOf(q) || numOf({ stem: (sp.questions[i] || {}).stem });
          if (n && !idxByNum.has(n)) idxByNum.set(n, i);
        });
        if (pp.questions.length !== (e.questions || []).length && pp.questions.length !== want) {
          // 部分修补：要求每条补丁题都能按题号命中
          const missing = pp.questions.filter((q) => !numOf(q) || !idxByNum.has(numOf(q)));
          if (missing.length) { console.error(`✗ ${key} ${k}: 题数不一致且 ${missing.length} 条补丁题无法按题号定位`); process.exit(1); }
        }
        let cursor = 0;
        pp.questions.forEach((q, k2) => {
          const n = numOf(q);
          const i = n && idxByNum.has(n) ? idxByNum.get(n) : (pp.questions.length === (e.questions || []).length ? k2 : cursor++);
          if (i == null || i >= (e.questions || []).length) { console.error(`✗ ${key} ${k}: 无法定位补丁题 ${q.stem}`); process.exit(1); }
          const t = e.questions[i];
          if (q.answer) t.answer = String(q.answer).trim();
          if (q.analysis) t.analysis = String(q.analysis).trim();
          t.verified = false; t.dissent = null;
        });
      }
    }
    console.log(`  ${created ? '+' : '~'} ${key} ${k}${pp.translation ? ' [翻译]' : ''}${pp.reference ? ' [范文]' : ''}${pp.questions ? ` [${pp.questions.length} 题]` : ''}`);
  }

  ov.passages = [...map.values()];
  ov.generatedAt = new Date().toISOString();
  fs.writeFileSync(ovPath, JSON.stringify(ov, null, 1), 'utf8');
  console.log(`✓ ${key} 已写回 ${path.basename(ovPath)}`);
}

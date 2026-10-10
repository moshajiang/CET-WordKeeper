// 清理与当前 seed 对不上的覆盖层条目，让 gen-answers 重新生成它们。
//
// 背景：覆盖层是按「套 → 篇章(section,seq) → 题目顺序」对齐到库里的，不看题干文本。
// 一旦解析器修好了题号/题数（例如把 0 题的篇章补回 5 题、把 26–35 改成 36–45），
// 旧条目就会错位 —— 把上一版的答案写到新题上。所以解析器改动后必须跑一次本脚本。
//
// 用法:
//   node scripts/prune-stale-overlay.mjs --dry   # 只看会删什么
//   node scripts/prune-stale-overlay.mjs         # 真删（写回覆盖层 JSON）
//
// 判定：篇章在 seed 中不存在 / 题数不等 / 非选词填空的题干逐条不等 → 删除该条目。
// 删掉后 gen-answers 会把它当作「未生成」重新处理。
//
// 例外：题干只差「题号前缀」或「空白」时不算失效 —— 答案是按位置对齐的，两者都不影响正确性。
// 空白差异来自 build-db 的 healGlued（"ofland" → "of land"）：覆盖层存修补后的文本、seed 存原始文本，
// 直接逐字比会把这类好条目误判成「题干已变」，白白触发一次重新生成。这类条目一律保留、不改写。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(root, 'data', 'seed');
const OV = path.join(root, 'data', 'ai-answers');
const DRY = process.argv.includes('--dry');
const stripNum = (s) => String(s || '').trim().replace(/^\d{1,2}\s*[.．]\s*/, '').trim();

let touched = 0, kept = 0, fixed = 0;
const dropped = [];

for (const f of fs.readdirSync(OV).filter((x) => x.endsWith('.json')).sort()) {
  const ovPath = path.join(OV, f);
  const seedPath = path.join(SEED, f);
  let ov;
  try { ov = JSON.parse(fs.readFileSync(ovPath, 'utf8')); } catch { console.log('  ✗ 无法解析', f); continue; }
  const seed = fs.existsSync(seedPath) ? JSON.parse(fs.readFileSync(seedPath, 'utf8')) : null;
  const key = (p) => `${p.section}#${p.seq}`;
  const seedMap = new Map(((seed && seed.passages) || []).map((p) => [key(p), p]));

  const out = [];
  let changed = false;
  for (const op of ov.passages || []) {
    const sp = seedMap.get(key(op));
    const oq = op.questions || [];
    const sq = (sp && sp.questions) || [];
    let reason = null;
    if (!seed) reason = 'seed 缺失';
    else if (!sp) reason = 'seed 中已无此篇章';
    else if (oq.length !== sq.length) reason = `题数 ${oq.length} → ${sq.length}`;
    else if (op.section !== 'cloze') {
      let diffAt = -1, cosmetic = true;
      for (let i = 0; i < oq.length; i++) {
        const a = String(oq[i].stem || '').trim(), b = String(sq[i].stem || '').trim();
        if (a === b) continue;
        if (diffAt < 0) diffAt = i;
        // 只差「题号前缀」或「空白」都不算失效 —— 答案是按位置对齐的，两者都不影响正确性。
        // 空白差异来自 build-db 的 healGlued（"ofland" → "of land"）：覆盖层存的是修补后的文本，
        // seed 存的是原始文本，直接比会把这类好条目误判成「题干已变」。
        const norm = (s) => stripNum(s).replace(/\s+/g, '');
        if (!stripNum(a) || norm(a) !== norm(b)) { cosmetic = false; break; }
      }
      if (diffAt >= 0 && cosmetic) { fixed++; }   // 保留：不改写覆盖层里的题干
      else if (diffAt >= 0) reason = `第 ${diffAt + 1} 题题干已变`;
    }
    if (reason) { dropped.push(`  ${f}  ${op.section}#${op.seq}  ${reason}`); changed = true; continue; }
    kept++;
    out.push(op);
  }
  if (changed) {
    touched++;
    if (!DRY) { ov.passages = out; ov.prunedAt = new Date().toISOString(); fs.writeFileSync(ovPath, JSON.stringify(ov, null, 1)); }
  }
}

console.log(`${DRY ? '[dry-run] ' : ''}覆盖层文件 ${touched} 个被清理 ｜ 保留 ${kept} ｜ 正文等价仅题号/空白差异 ${fixed} ｜ 删除 ${dropped.length}`);
if (dropped.length) {
  console.log('删除明细：');
  for (const d of dropped) console.log(d);
}

// 一次性清理：seed 与 AI 覆盖层里的页眉页脚/水印/作答说明行
// 规则与 scripts/build-db.mjs 的 isExamJunkLine 一致（零误伤：仅删除独立成行的命中项）
import fs from 'fs';
import path from 'path';

const root = 'D:/2026-10-09-16-27-21/cet-wordkeeper';

function isExamJunkLine(line) {
  const s = String(line).trim();
  if (!s || s.length > 90) return false;
  if (/^(19|20)\d{2}\s*年/.test(s) && /(四级|六级)/.test(s) && (/真题/.test(s) || (/考试/.test(s) && (/第\s*\d+\s*套/.test(s) || /第\s*[一二三四五六七八九十]+\s*套/.test(s) || /页/.test(s))))) return true;
  if (/^注意[:：]\s*此部分试题请在答题卡/.test(s)) return true;
  if (/^(b\s*)?y\s*[:：]\s*新一文化/.test(s)) return true;
  return false;
}
function clean(text) {
  const t = String(text || '');
  if (!t.includes('\n')) return { text: t.replace(/\s*b\s*y\s*[:：]\s*新一文化\s*/g, ''), removed: [] };
  const lines = t.split(/\r?\n/);
  const removed = [];
  const kept = lines.filter((l) => {
    if (isExamJunkLine(l)) { removed.push(l.trim()); return false; }
    return true;
  });
  let out = kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s*b\s*y\s*[:：]\s*新一文化\s*/g, '');
  out = out.replace(/^\n+/, '').replace(/\s+$/, '');
  return { text: out, removed };
}

let total = 0;
const cleanDir = (dir, fields) => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const p = path.join(dir, f);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    let changed = false;
    for (const pass of j.passages || []) {
      for (const field of fields) {
        if (!pass[field]) continue;
        const { text, removed } = clean(pass[field]);
        if (removed.length) {
          changed = true; total += removed.length;
          console.log(`  ${f} [${pass.section} ${pass.seq || ''}] ${field} 移除 ${removed.length} 行: ${removed.map((x) => x.slice(0, 26)).join(' / ')}`);
        }
        pass[field] = text;
      }
    }
    if (changed) fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8');
  }
};

console.log('== 清理 seed（原文/译文/范文）==');
cleanDir(path.join(root, 'data', 'seed'), ['content', 'translation', 'reference']);
console.log('== 清理 ai-answers（译文/范文）==');
cleanDir(path.join(root, 'data', 'ai-answers'), ['translation', 'reference']);
console.log('共移除行数:', total);

// 逐句对照工具：把「原文」与「整段译文」按句对齐（纯函数，便于测试与复用）
// 用途：阅读器里的「逐句对照」「对照背诵」两种展示模式

const EN_ABBR = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|No|Fig|Inc|Ltd|Co|e\.g|i\.e|a\.m|p\.m|U\.S|U\.K|U\.N)\.|\b[A-Z]\.)$/i;

// 英文断句：句末标点 + 空白 + 大写/引号开头；避免切小数（1.8）、缩写（Dr.）与序号
export function splitEn(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const parts = raw.split(/(?<=[.!?]["”'’)]?)\s+(?=[A-Z"“'‘(])/);
  const out = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    // 缩写结尾、或以数字+点结尾（1.8 / $5.）→ 与上一句合并
    if (prev && (EN_ABBR.test(prev) || /\d\.$/.test(prev) || prev.length < 12)) out[out.length - 1] = prev + ' ' + p;
    else out.push(p);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

// 中文断句：句末标点后断开（保留标点）；过短的片段并入上一句
export function splitZh(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const parts = raw.split(/(?<=[。！？；…])/);
  const out = [];
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    const prev = out[out.length - 1];
    if (prev && (s.length < 6 || /^[，、）】》”’]/.test(s))) out[out.length - 1] = prev + s;
    else out.push(s);
  }
  return out;
}

// 把一组「英文句」与「中文句」按顺序对齐；中文多/少时把差额并入末句，保证一一对应
function pairList(ens, zhs, para) {
  const n = Math.max(ens.length, zhs.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const en = ens[i] || '';
    const zh = i === n - 1 ? zhs.slice(i).join('') : (zhs[i] || '');
    const enFull = i === n - 1 ? ens.slice(i).join(' ') : en;
    if (!enFull && !zh) continue;
    out.push({ para, i, en: enFull, zh });
  }
  return out;
}

// 主入口：返回 [{ para, i, en, zh }]
// 段落数一致时按段对齐（更准）；否则整篇按句序对齐
export function alignBilingual(content, translation) {
  const enParas = String(content || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const zhParas = String(translation || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  if (!zhParas.length) {
    enParas.forEach((p, pi) => splitEn(p).forEach((s, i) => out.push({ para: pi, i, en: s, zh: '' })));
    return out;
  }
  if (enParas.length > 1 && enParas.length === zhParas.length) {
    enParas.forEach((p, pi) => out.push(...pairList(splitEn(p), splitZh(zhParas[pi]), pi)));
    return out;
  }
  return pairList(splitEn(enParas.join(' ')), splitZh(zhParas.join(' ')), 0);
}

// 取匹配题正文里的段落字母（A) / [A] / A. 三种写法都认），用于生成作答按钮
export function paragraphLetters(content) {
  const letters = [];
  for (const line of String(content || '').split(/\n/)) {
    const m = line.trim().match(/^\[?([A-Z])\]?\s*[)）．.]?\s+\S/);
    if (!m) continue;
    // 仅当字母按顺序出现（A→B→C…）才算段落标记，避免把「A good example」当标记
    const next = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[letters.length];
    if (m[1] === next) letters.push(m[1]);
  }
  return letters;
}

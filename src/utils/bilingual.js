// 逐句对照工具：把「原文」与「整段译文」按句对齐（纯函数，便于测试与复用）
// 用途：阅读器里的「逐句对照」「对照背诵」两种展示模式
//
// 对齐策略（v0.2.8）：
// 1. 长篇阅读：两侧 A–O 字标记 → 按字母配对（缺字母软退化：缺失行留空并入邻行）
// 2. 段落数一致 → 逐段对齐
// 3. 句子级：句数差 ≤2 → 1:1（AI 译文基本逐句翻）；差得多 → DP 动态规划对齐
//    DP 允许 1-1/1-2/2-1/2-2/1-0/0-1，代价 = 长度比偏离 + 数字锚点奖励，
//    单调对齐保证局部差异（标题行/并句/漏译）就地吸收，不扩散成全篇漂移

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

// 数字锚点：≥2 位数字（选词填空的 26–35 空号不算——它们不会出现在译文里）
function anchorsOf(text) {
  return (String(text).match(/\d+(?:[,.]\d+)*/g) || [])
    .filter((d) => { const n = parseInt(d.replace(/\D/g, ''), 10); return !(n >= 26 && n <= 35) && (String(n).length >= 2 || d.length >= 3); });
}

// 空缺侧行合并：一侧为空的行并入相邻行（不留「译文缺失」，也不丢内容）
function mergeEmptyRows(rows) {
  const merged = [];
  for (const row of rows) {
    if (!row.zh && merged.length) merged[merged.length - 1].en += ' ' + row.en;
    else if (!row.en && merged.length) merged[merged.length - 1].zh += row.zh;
    else merged.push(row);
  }
  return merged;
}

// DP 动态规划对齐（Gale-Church 简化版）：
// 单调、允许 1-1/1-2/2-1/2-2/1-0/0-1；代价 = |log(中文字符/英文长度/基准比)| − 数字锚点奖励
// 用于句数差大的篇章（比例分配会在这里产生漂移）
function alignDP(ens, zhs, para, kBase) {
  const n = ens.length, m = zhs.length;
  const cost = (enTexts, zhTexts) => {
    const enLen = enTexts.join(' ').length;
    const zhLen = zhTexts.join('').length;
    let c = Math.abs(Math.log(Math.max(1, zhLen) / Math.max(1, enLen * kBase)));
    const ds = anchorsOf(enTexts.join(' '));
    if (ds.length) {
      const zhAll = zhTexts.join('');
      const hitN = ds.filter((d) => zhAll.includes(d)).length;
      c -= 2 * hitN;              // 锚点命中强奖励
      c += 0.5 * (ds.length - hitN); // 未命中轻罚
    }
    return c;
  };
  const OPS = [[1, 1], [1, 2], [2, 1], [2, 2], [1, 0], [0, 1]];
  const INF = 1e9;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(INF));
  const bt = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null));
  dp[0][0] = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (dp[i][j] >= INF) continue;
      for (const [a, b] of OPS) {
        const ni = i + a, nj = j + b;
        if (ni > n || nj > m) continue;
        let c = cost(ens.slice(i, ni), zhs.slice(j, nj));
        if (a === 0 || b === 0) c += 6;   // 跳过惩罚：优先合并而不是丢内容
        if (a === 2 && b === 2) c += 1;
        if (dp[i][j] + c < dp[ni][nj]) { dp[ni][nj] = dp[i][j] + c; bt[ni][nj] = { pi: i, pj: j }; }
      }
    }
  }
  const out = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const b = bt[i] && bt[i][j];
    if (!b) { // 理论不可达；兜底逐句
      return ens.map((s, k) => ({ para, i: k, en: s, zh: zhs[k] || '' }));
    }
    const en = ens.slice(b.pi, i).join(' ');
    const zh = zhs.slice(b.pj, j).join('');
    if (en || zh) out.unshift({ para, i: 0, en, zh });
    i = b.pi; j = b.pj;
  }
  out.forEach((r, k) => (r.i = k));
  return mergeEmptyRows(out);
}

// 句子级配对主入口
function pairSentences(ens, zhs, para, kBase) {
  const out = [];
  if (zhs.length && Math.abs(ens.length - zhs.length) <= 2) {
    // 数量接近：按句号一一对应（AI 译文基本逐句翻），差的一两条并入末行
    const n = Math.min(ens.length, zhs.length);
    for (let i = 0; i < n; i++) out.push({ para, i, en: ens[i], zh: zhs[i] });
    if (zhs.length > ens.length) out[out.length - 1].zh += zhs.slice(n).join('');
    if (ens.length > zhs.length) out[out.length - 1].en += ' ' + ens.slice(n).join(' ');
    return out;
  }
  // 数量差得多：DP 对齐（抗漂移）
  return alignDP(ens, zhs, para, kBase);
}

// 长篇阅读：段落序号对齐（按字母配对，软退化）
function markerAligned(enParas, zhParas) {
  const enText = enParas.join('\n');
  const zhText = zhParas.join('\n');
  const enParts = enText.split(/(?=[A-O]\s*[)．.])/).map((s) => s.trim()).filter(Boolean);
  const zhParts = zhText.split(/(?=(?:\[[A-O]\]|[A-O][)．.、]))/).map((s) => s.trim()).filter(Boolean);
  if (enParts.length < 4) return null;
  const enSecs = enParts
    .filter((s) => /^[A-O]\s*[)．.]/.test(s))
    .map((s) => ({ letter: s.match(/^[A-O]/)[0], text: s }));
  const zhSecs = zhParts
    .filter((s) => /^(?:\[[A-O]\]|[A-O][)．.、])/.test(s))
    .map((s) => ({ letter: (s.match(/\[([A-O])\]/) || s.match(/^([A-O])/))[1], text: s }));
  if (enSecs.length < 4) return null;
  // 软退化：按字母配对；个别字母缺译文 → zh 留空（随后并入邻行），不再整体放弃。
  // 但缺译文的段落超过 1/3 时，说明译文大概率不是本篇的 → 放弃段落级对齐
  const zhByLetter = new Map(zhSecs.map((s) => [s.letter, s.text]));
  const missing = enSecs.filter((s) => !zhByLetter.has(s.letter)).length;
  if (missing > enSecs.length / 3) return null;
  const rows = [];
  for (const s of enSecs) {
    rows.push({ para: rows.length, i: rows.length, en: s.text, zh: zhByLetter.get(s.letter) || '' });
  }
  if (rows.length < 4) return null;
  // 标题等无序号碎片并入第一份
  const enLead = enParts.filter((p) => !/^[A-O]\s*[)．.]/.test(p)).join(' ');
  const zhLead = zhParts.filter((p) => !/^(?:\[[A-O]\]|[A-O][)．.、])/.test(p)).join(' ');
  if (enLead) rows[0].en = enLead + ' ' + rows[0].en;
  if (zhLead) rows[0].zh = zhLead + ' ' + rows[0].zh;
  return mergeEmptyRows(rows);
}

// 主入口：返回 [{ para, i, en, zh }]
export function alignBilingual(content, translation) {
  const enParas = String(content || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const zhParas = String(translation || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  if (!zhParas.length) {
    enParas.forEach((p, pi) => splitEn(p).forEach((s, i) => out.push({ para: pi, i, en: s, zh: '' })));
    return out;
  }
  // 长篇阅读等「段落级对应」的篇章：一段对一段
  const marked = markerAligned(enParas, zhParas);
  if (marked) {
    out.push(...marked);
    return out;
  }
  // 段落数一致时按段对齐（更准）；否则整篇对齐
  const useParas = enParas.length > 1 && enParas.length === zhParas.length;
  if (useParas) {
    enParas.forEach((p, pi) => {
      const zhs = splitZh(zhParas[pi]);
      const ens = splitEn(p);
      const k = (zhs.reduce((a, s) => a + s.length, 0) || 1) / (ens.reduce((a, s) => a + s.length, 0) || 1);
      out.push(...pairSentences(ens, zhs, pi, k));
    });
    return out;
  }
  const ensAll = splitEn(enParas.join(' '));
  const zhsAll = splitZh(zhParas.join(' '));
  const kBase = (zhsAll.reduce((a, s) => a + s.length, 0) || 1) / (ensAll.reduce((a, s) => a + s.length, 0) || 1);
  return pairSentences(ensAll, zhsAll, 0, kBase);
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

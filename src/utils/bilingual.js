// 逐句对照对齐引擎 v0.3：Gale-Church 统计 DP + 数字锚点 + ECDICT 词典评分
// 理论依据：Gale & Church (1993)；Champollion (Ma, LDC 2006) 中英对齐词典路线；
// DP 骨架参考 multi-align (github.com/tanyaqiong31029/multi-align, MIT)。
// 用途：阅读器「逐句对照」、对照背诵页 两种展示模式
//
// 对齐流程：
// 1. 长篇阅读：两侧 A–L 字标记 → 按字母配对（软退化：缺失行留空并入邻行）
// 2. 其余：单调 DP（允许 1-1/1-2/2-1/2-2/1-0/0-1），代价 = 长度概率 + 锚点奖励 + 词典奖励
//    —— 局部差异（标题行/并句/漏译）被 DP 就地吸收，不再扩散成全篇漂移

const EN_ABBR = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|No|Fig|Inc|Ltd|Co|e\.g|i\.e|a\.m|p\.m|U\.S|U\.K|U\.N)\.|\b[A-Z]\.)$/i;

// ===== 校准常量（2026-10 由全库 579 个锚点确认的 1-1 行统计） =====
const C_RATIO = 1.58;   // 每个英文单词对应的中文汉字数（均值）
const S2_RATIO = 0.47;  // 该比的方差

// 英文断句：句末标点 + 空白 + 大写/引号开头；避免切小数（1.8）、缩写（Dr.）与序号
export function splitEn(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const parts = raw.split(/(?<=[.!?]["”'’)]?)\s+(?=[A-Z"“'‘(])/);
  const out = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
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
function anchorsOf(text, exclude) {
  return [...new Set((String(text).match(/\d+(?:[,.]\d+)*/g) || [])
    .filter((d) => { const n = parseInt(d.replace(/\D/g, ''), 10); return !(exclude && exclude.has(n)) && !(n >= 26 && n <= 35) && (String(n).length >= 2 || d.length >= 3); }))];
}

const enWordsOf = (s) => (String(s).match(/[A-Za-z']+/g) || []).length;
const zhCharsOf = (s) => (String(s).match(/[\u4e00-\u9fff]/g) || []).length;

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

// ===== DP 核心 =====

/* 误差函数（Abramowitz & Stegun 7.1.26 近似） */
function erf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
/* 双侧概率 p = 2(1-Φ(|z|))，下限截断防 log(0) */
function pd(z) {
  return Math.max(2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))), 1e-9);
}
/* 句对类型罚分（Gale-Church Table 5 换算） */
const PEN = { '11': 0, '12': 230, '21': 230, '22': 440, '10': 450, '01': 450 };
const OPS = [[1, 1, '11'], [1, 2, '12'], [2, 1, '21'], [2, 2, '22'], [1, 0, '10'], [0, 1, '01']];

const W_NUM = 6;   // 数字锚点 Dice 权重
const W_LEX = 5;   // 词典词汇命中权重

function dice(a, b) {
  if (!a || !b || !a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return (2 * inter) / (a.size + b.size);
}

function unionNums(sents, from, to) {
  const u = new Set();
  for (let x = from; x < to; x++) for (const v of sents[x].nums) u.add(v);
  return u;
}
function unionLex(sents, from, to) {
  const u = new Set();
  for (let x = from; x < to; x++) for (const v of sents[x].lex) u.add(v);
  return u;
}

/* 预计算句子特征：len / nums / lex（EN 句实词的中文候选集合） */
function prepEn(text, lex, exclude) {
  const words = (String(text).match(/[A-Za-z']+/g) || []).map((w) => w.toLowerCase().replace(/^'|'$/g, ''));
  const lexSet = new Set();
  if (lex) {
    for (const w of words) {
      const cands = lex[w] || lex[wordFormsFallback(w)];
      if (cands) for (const cand of cands) lexSet.add(cand);
    }
  }
  return { len: Math.max(1, words.length), nums: new Set(anchorsOf(text, exclude)), lex: lexSet };
}
function prepZh(text, exclude) {
  return { len: Math.max(1, zhCharsOf(text)), nums: new Set(anchorsOf(text, exclude)) };
}
// 轻量词形回退（词典没查到原形时试剥后缀）
function wordFormsFallback(w) {
  if (w.length > 4 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}

/* 单语对 DP：enSents/zhSents 为预计算的句子对象，返回 beads [{ ai:[], bi:[], type }] */
function alignPairDP(enSents, zhSents) {
  const n = enSents.length, m = zhSents.length;
  if (n === 0 || m === 0) {
    const beads = [];
    for (let i = 0; i < n; i++) beads.push({ ai: [i], bi: [], type: '1-0' });
    for (let j = 0; j < m; j++) beads.push({ ai: [], bi: [j], type: '0-1' });
    return beads;
  }
  const W = m + 1;
  const size = (n + 1) * (m + 1);
  const cost = new Float64Array(size).fill(Infinity);
  const prevIdx = new Int32Array(size).fill(-1);
  const typeArr = new Int8Array(size).fill(0);
  cost[0] = 0;

  const beadCost = (i, j, ni, nj, type) => {
    let la = 0, lb = 0;
    for (let x = i; x < ni; x++) la += enSents[x].len;
    for (let x = j; x < nj; x++) lb += zhSents[x].len;
    // 长度概率代价：z = (中文字数 − c×英文词数) / √(词数×s²)
    const z = (lb - C_RATIO * la) / Math.sqrt(Math.max(1, la) * S2_RATIO);
    let c = -100 * Math.log(pd(z));
    c += PEN[type];
    if (W_NUM > 0) {
      const na = unionNums(enSents, i, ni);
      const nb = unionNums(zhSents, j, nj);
      if (na.size && nb.size) c -= W_NUM * dice(na, nb);
      else if (na.size !== nb.size) c += W_NUM * 0.2;
    }
    if (W_LEX > 0) {
      // 词典评分：英句实词的中文候选（并集）在中文文本中的命中比例
      const cands = unionLex(enSents, i, ni);
      if (cands.size) {
        const zhAll = zhSents.slice(j, nj).join('');
        let hits = 0;
        for (const cand of cands) if (zhAll.includes(cand)) hits++;
        c -= W_LEX * (hits / cands.size);
      }
    }
    return c;
  };

  for (let i = 0; i <= n; i++) {
    const iW = i * W;
    for (let j = 0; j <= m; j++) {
      const cur = cost[iW + j];
      if (!isFinite(cur)) continue;
      for (let t = 0; t < OPS.length; t++) {
        const di = OPS[t][0], dj = OPS[t][1], type = OPS[t][2];
        const ni = i + di, nj = j + dj;
        if (ni > n || nj > m) continue;
        const c = cur + beadCost(i, j, ni, nj, type);
        const nidx = ni * W + nj;
        if (c < cost[nidx]) { cost[nidx] = c; prevIdx[nidx] = iW + j; typeArr[nidx] = t; }
      }
    }
  }

  const beads = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const idx = i * W + j;
    const t = typeArr[idx];
    const p = prevIdx[idx];
    if (p < 0) break;
    const pi = (p / W) | 0, pj = p % W;
    const b = { ai: [], bi: [], type: OPS[t][2] };
    for (let x = pi; x < i; x++) b.ai.push(x);
    for (let x = pj; x < j; x++) b.bi.push(x);
    beads.push(b);
    i = pi; j = pj;
  }
  beads.reverse();
  return beads;
}

// ===== 长篇阅读：段落序号对齐（按字母配对，软退化） =====
function markerAligned(enParas, zhParas) {
  const enText = enParas.join('\n');
  const zhText = zhParas.join('\n');
  const enParts = enText.split(/(?=(?:\[?[A-O]\]?\s*[)．.]|\[[A-O]\]))/).map((s) => s.trim()).filter(Boolean);
  const zhParts = zhText.split(/(?=(?:\[[A-O]\]|[A-O][)．.、]))/).map((s) => s.trim()).filter(Boolean);
  if (enParts.length < 4) return null;
  const enSecs = enParts
    .filter((s) => /^(?:\[?[A-O]\]?\s*[)．.]|\[[A-O]\])/.test(s))
    .map((s) => ({ letter: s.match(/[A-O]/)[0], text: s }));
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
  const enLead = enParts.filter((p) => !/^(?:\[?[A-O]\]?\s*[)．.]|\[[A-O]\])/.test(p)).join(' ');
  const zhLead = zhParts.filter((p) => !/^(?:\[[A-O]\]|[A-O][)．.、])/.test(p)).join(' ');
  if (enLead) rows[0].en = enLead + ' ' + rows[0].en;
  if (zhLead) rows[0].zh = zhLead + ' ' + rows[0].zh;
  // 内容无损门：段落级配对必须覆盖译文的全部内容，否则回退句级 DP
  //（此前部分篇章的译文因标记形态差异被整段丢弃，覆盖率最低只剩 44%——已踩坑）
  const zhTotal = zhCharsOf(zhText);
  const zhKept = rows.reduce((acc, r) => acc + zhCharsOf(r.zh), 0);
  if (zhTotal && zhKept / zhTotal < 0.97) return null;
  return mergeEmptyRows(rows);
}

// ===== 主入口：返回 [{ para, i, en, zh }] =====
// lex：可选的「英词 → 中文候选串数组」映射（来自 ECDICT），传入后启用词典评分
export function alignBilingual(content, translation, lex, opts) {
  const exclude = opts && opts.blankNums;
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
  const alignAll = (enText, zhText, para, exclude) => {
    const ens = splitEn(enText).map((s) => ({ text: s, ...prepEn(s, lex, exclude) }));
    const zhs = splitZh(zhText).map((s) => ({ text: s, ...prepZh(s, exclude) }));
    const beads = alignPairDP(ens, zhs);
    const rows = [];
    for (const b of beads) {
      const en = b.ai.map((x) => ens[x].text).join(' ');
      const zh = b.bi.map((x) => zhs[x].text).join('');
      if (!en && !zh) continue;
      rows.push({ para, i: rows.length, en, zh });
    }
    return mergeEmptyRows(rows);
  };
  // 段落数一致时按段对齐（更准）；否则整篇对齐
  if (enParas.length > 1 && enParas.length === zhParas.length) {
    const out2 = [];
    enParas.forEach((p, pi) => out2.push(...alignAll(p, zhParas[pi], pi, exclude)));
    return out2;
  }
  return alignAll(enParas.join(' '), zhParas.join(' '), 0, exclude);
}

// 取匹配题正文里的段落字母（A) / [A] / A. 三种写法都认），用于生成作答按钮
export function paragraphLetters(content) {
  const letters = [];
  for (const line of String(content || '').split(/\n/)) {
    const m = line.trim().match(/^\[?([A-Z])\]?\s*[)）．.]?\s+\S/);
    if (!m) continue;
    const next = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[letters.length];
    if (m[1] === next) letters.push(m[1]);
  }
  return letters;
}

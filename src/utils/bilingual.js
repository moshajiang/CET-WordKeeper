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

// 把一组「英文句」与「中文句」配成句对。
// 数量相等时一一对应；不等时按累计字符长度比例分配（此前把差额全并入末句，
// 会出现英文 1 句对中文 8 句、其余行「译文缺失」的糟糕体验——全库实测 311 篇仅 21% 完美）
function pairProportional(ens, zhs, para) {
  const out = [];
  const totalEn = ens.reduce((a, s) => a + s.length, 0) || 1;
  if (zhs.length && zhs.length <= ens.length) {
    // 中文句更少：英文按长度比例分组，每组共用一句中文（保证无空缺）
    let ei = 0;
    let cumEn = 0;
    for (let z = 0; z < zhs.length; z++) {
      const isLast = z === zhs.length - 1;
      const target = (totalEn * (z + 1)) / zhs.length;
      const grp = [];
      while (ei < ens.length && (isLast || grp.length === 0 || cumEn < target)) {
        grp.push(ens[ei]); cumEn += ens[ei].length; ei++;
      }
      if (grp.length) out.push({ para, i: out.length, en: grp.join(' '), zh: zhs[z] });
    }
    return out;
  }
  // 中文句更多（或为空）：按英文句长度比例把中文句分给每句英文
  const totalZh = zhs.reduce((a, s) => a + s.length, 0) || 1;
  let zi = 0;
  let cumZh = 0;
  for (let i = 0; i < ens.length; i++) {
    const isLast = i === ens.length - 1;
    const target = (totalZh * (i + 1)) / ens.length;
    let zh = '';
    while (zi < zhs.length && (isLast || zh === '' || cumZh < target)) {
      zh += zhs[zi]; cumZh += zhs[zi].length; zi++;
    }
    out.push({ para, i, en: ens[i], zh });
  }
  if (zi < zhs.length && out.length) out[out.length - 1].zh += zhs.slice(zi).join('');
  // 兜底：任何一侧为空的行并入相邻行（不留「译文缺失」，也不丢内容）
  const merged = [];
  for (const row of out) {
    if (!row.zh && merged.length) merged[merged.length - 1].en += ' ' + row.en;
    else if (!row.en && merged.length) merged[merged.length - 1].zh += row.zh;
    else merged.push(row);
  }
  return merged;
}

// 段落序号对齐检测：长篇阅读的原文带 A)–O) 标记、译文带 [A]–[O] 标记。
// 源文档的段落结构可能塌掉（标题与 A) 同段、B) 粘在上一段尾），
// 因此按「序号」切分而不是按段落收集：两侧切出的序号份数一致时按 k↔k 对应，
// 序号前的标题碎片并入第一份。此前的句子级硬配会把段落级译文配得面目全非。
function markerAligned(enParas, zhParas) {
  const enText = enParas.join('\n');
  const zhText = zhParas.join('\n');
  // 标记形态：EN「A) In / A)In」，ZH「[A] / A)在 / A、」——括号后有无空格都认
  const enParts = enText.split(/(?=[A-O]\s*[)．.])/).map((s) => s.trim()).filter(Boolean);
  const zhParts = zhText.split(/(?=(?:\[[A-O]\]|[A-O][)．.、]))/).map((s) => s.trim()).filter(Boolean);
  if (enParts.length < 4) return null;
  const enSecs = enParts.filter((s) => /^[A-O]\s*[)．.]/.test(s));
  const zhSecs = zhParts.filter((s) => /^(?:\[[A-O]\]|[A-O][)．.、])/.test(s));
  if (enSecs.length !== zhSecs.length || enSecs.length < 4) return null;
  // 标题等无序号碎片并入第一份；段落续行（页眉分割残留）由 join 顺序自然并入前一段
  const enLead = enParts.slice(0, enParts.indexOf(enSecs[0])).join(' ');
  const zhLead = zhParts.slice(0, zhParts.indexOf(zhSecs[0])).join(' ');
  const rows = [];
  enSecs.forEach((s, k) => rows.push({ para: k, i: k, en: (k === 0 && enLead ? enLead + ' ' : '') + s, zh: (k === 0 && zhLead ? zhLead + ' ' : '') + (zhSecs[k] || '') }));
  return rows.length >= 4 ? rows : null;
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
  // 段落数一致时按段对齐（更准）；否则整篇按句序对齐
  if (enParas.length > 1 && enParas.length === zhParas.length) {
    enParas.forEach((p, pi) => out.push(...pairProportional(splitEn(p), splitZh(zhParas[pi]), pi)));
    return out;
  }
  return pairProportional(splitEn(enParas.join(' ')), splitZh(zhParas.join(' ')), 0);
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

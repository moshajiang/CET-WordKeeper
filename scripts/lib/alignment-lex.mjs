// 构建库和对齐候选重建共用同一词典转换，避免两条数据管线漂移。
export function buildAlignmentLex(rows) {
  const lex = Object.create(null);
  for (const row of rows) {
    const candidates = [];
    for (const line of String(row.translation || '').split('\n')) {
      const segment = line.replace(/^[a-z.\[\]\s]+/i, '').replace(/\[[^\]]*\]/g, '');
      for (const part of segment.split(/[，,；;。\/（(）)→]/)) {
        const word = part.trim().replace(/\s+/g, '');
        if (word.length >= 1 && word.length <= 12 && /[\u4e00-\u9fff]/.test(word) && !/[A-Za-z0-9]/.test(word)) candidates.push(word);
      }
    }
    if (!candidates.length) continue;
    const unique = [...new Set(candidates)].slice(0, 6);
    lex[String(row.word).toLowerCase()] = unique;
    for (const exchange of String(row.exchange || '').split('/')) {
      const match = exchange.match(/^([pdi3s]):(.+)$/);
      if (!match) continue;
      for (const form of match[2].split('\\').map(value => value.trim().toLowerCase()).filter(Boolean)) {
        if (!lex[form]) lex[form] = unique;
      }
    }
  }
  return lex;
}

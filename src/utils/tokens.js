export function tokenize(text) {
  const tokens = [];
  const re = /([A-Za-z][A-Za-z'’-]*)|([^A-Za-z]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) tokens.push({ t: 'w', text: m[1] });
    else tokens.push({ t: 'o', text: m[2] });
  }
  return tokens;
}

export function splitSentences(text) {
  const parts = String(text)
    .replace(/\r/g, '')
    .split(/\n+/)
    .flatMap((para) => para.split(/(?<=[.!?])\s+(?=[A-Z"“(])/));
  return parts.map((s) => s.trim()).filter(Boolean);
}

export function sentenceOf(tokens, idx) {
  let start = idx;
  let end = idx;
  while (start > 0 && !/[.!?]/.test(tokens[start - 1].t === 'o' ? tokens[start - 1].text : '')) start--;
  while (end < tokens.length - 1 && !/[.!?]/.test(tokens[end].t === 'o' ? tokens[end].text : '')) end++;
  return tokens
    .slice(start, end + 1)
    .map((x) => x.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

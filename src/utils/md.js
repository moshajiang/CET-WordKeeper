// 极简 Markdown → HTML（零依赖）。用于 AI 回答的气泡与结果卡。
// 安全策略：先把 HTML 特殊字符全部转义，再在其上渲染 Markdown 标记，
// 因此 AI 输出里夹带的 <script> 等只会以文本形式出现，不会被当作 HTML 执行。

export function renderMarkdown(src) {
  let t = String(src || '');
  // ① 转义 HTML
  t = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ② 抠出代码块（```lang ... ```），占位还原，避免内部被二次处理
  const codes = [];
  t = t.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, c) => {
    codes.push(c.replace(/\n$/, ''));
    return '\u0000C' + (codes.length - 1) + '\u0000';
  });

  // ③ 表格：连续以 | 开头的行；第二行若是 |---| 分隔行则表头加粗
  const lines = t.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^\|.+\|$/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        rows.push(cells);
        i++;
      }
      i--;
      const isSep = (r) => r.every((c) => /^:?-{2,}:?$/.test(c));
      let html = '<table class="md-table">';
      rows.forEach((r, ri) => {
        if (ri === 1 && isSep(r)) return;
        const tag = ri === 0 && rows[1] && isSep(rows[1]) ? 'th' : 'td';
        html += '<tr>' + r.map((c) => `<${tag}>${inline(c)}</${tag}>`).join('') + '</tr>';
      });
      out.push(html + '</table>');
      continue;
    }
    out.push(line);
  }
  t = out.join('\n');

  // ④ 标题 / 列表 / 引用
  t = t.replace(/^###\s+(.+)$/gm, '<h4>$1</h4>');
  t = t.replace(/^##\s+(.+)$/gm, '<h4>$1</h4>');
  t = t.replace(/^#\s+(.+)$/gm, '<h4>$1</h4>');
  t = blockList(t, /^[-*]\s+/, 'ul');
  t = blockList(t, /^\d+[.)]\s+/, 'ol');
  t = t.replace(/^&gt;\s+(.+)$/gm, (_, s) => '<blockquote>' + inline(s) + '</blockquote>');

  // ⑤ 段落：双换行分段，段内单换行转 <br>；段落正文同样应用行内标记
  t = t
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => (b.startsWith('<') ? b : '<p>' + inline(b).replace(/\n/g, '<br>') + '</p>'))
    .join('');

  // ⑥ 还原代码块
  t = t.replace(/\u0000C(\d+)\u0000/g, (_, i) => `<pre class="md-code">${codes[i]}</pre>`);
  return t;

  // 行内标记（粗体 / 斜体 / 行内代码）
  function inline(s) {
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    return s;
  }

  // 把连续命中的行包成列表
  function blockList(text, re, tag) {
    const ls = text.split('\n');
    const res = [];
    let buf = [];
    const flush = () => {
      if (buf.length) res.push(`<${tag}>` + buf.map((x) => `<li>${x}</li>`).join('') + `</${tag}>`);
      buf = [];
    };
    for (const l of ls) {
      const m = l.match(re);
      if (m) buf.push(inline(l.slice(m[0].length)));
      else flush(), res.push(l);
    }
    flush();
    return res.join('\n');
  }
}

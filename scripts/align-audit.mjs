// 全库对齐体检：逐句对照的英文句数 vs 中文句数匹配情况
import fs from 'fs';
const initSqlJs = (await import('file:///D:/2026-10-09-16-27-21/cet-wordkeeper/node_modules/sql.js/dist/sql-wasm.js')).default;
const SQL = await initSqlJs({ locateFile: (f) => 'D:/2026-10-09-16-27-21/cet-wordkeeper/node_modules/sql.js/dist/' + f });
const db = new SQL.Database(fs.readFileSync('D:/2026-10-09-16-27-21/cet-wordkeeper/data/keeper.db'));
const { alignBilingual, splitEn, splitZh } = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(fs.readFileSync('D:/2026-10-09-16-27-21/cet-wordkeeper/src/utils/bilingual.js', 'utf8')));

const r = db.exec(`SELECT e.level, e.year, e.month, e.set_no, p.section, p.seq, p.content, p.translation
  FROM passage p JOIN exam e ON e.id = p.exam_id WHERE p.translation != ''`);
const rows = r[0].values;

let perfect = 0, emptySide = 0, total = 0;
const worst = [];
const diffHist = {};
for (const [level, year, month, set, section, seq, content, translation] of rows) {
  total++;
  const enN = splitEn(content).length;
  const zhN = splitZh(translation).length;
  const d = Math.abs(enN - zhN);
  diffHist[d] = (diffHist[d] || 0) + 1;
  const pairs = alignBilingual(content, translation);
  const missing = pairs.filter((x) => !x.en || !x.zh).length;
  if (missing === 0) perfect++;
  else {
    emptySide += missing;
    worst.push({ tag: `${level} ${year}.${month} set${set} ${section}${seq > 1 ? ' ' + seq : ''}`, enN, zhN, missing });
  }
}
console.log('篇章总数:', total);
console.log('完全 1:1 对齐:', perfect, `(${Math.round(perfect / total * 100)}%)`);
console.log('|句数差| 分布:', JSON.stringify(diffHist));
console.log('有空缺侧的句对:', emptySide);
console.log('\n最差 12 例:');
worst.sort((a, b) => (b.missing + Math.abs(b.enN - b.zhN)) - (a.missing + Math.abs(a.enN - a.zhN)));
worst.slice(0, 12).forEach((w) => console.log(`  ${w.tag}: 英 ${w.enN} 句 / 中 ${w.zhN} 句 / 空缺 ${w.missing}`));

// 展示一个不匹配实例的对齐结果片段
if (worst.length) {
  const [level, year, month, set, section, seq] = rows.find((r2) => r2[0] === worst[0].tag.split(' ')[0] && String(r2[2]) === worst[0].tag.split('.')[1].split(' ')[0]);
}
const sample = rows.find((r2) => {
  const tag = `${r2[0]} ${r2[1]}.${r2[2]} set${r2[3]} ${r2[4]}${r2[5] > 1 ? ' ' + r2[5] : ''}`;
  return worst.some((w) => w.tag === tag && Math.abs(w.enN - w.zhN) >= 2);
});
if (sample) {
  const pairs = alignBilingual(sample[6], sample[7]);
  console.log('\n--- 样例:', `${sample[0]} ${sample[1]}.${sample[2]} set${sample[3]} ${sample[4]}`, '---');
  pairs.slice(0, 6).forEach((p, i) => console.log(`  ${i + 1}. EN: ${p.en.slice(0, 40)}…\n     ZH: ${p.zh.slice(0, 30)}…`));
}

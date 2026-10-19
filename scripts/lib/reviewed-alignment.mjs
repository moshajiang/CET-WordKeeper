// 经人工逐句复核的少量异常材料。边界只重新分组，不修改、增删、重排任何原文。
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const manifest = JSON.parse(fs.readFileSync(new URL('../../data/reviewed-alignments.json',import.meta.url),'utf8'));
if (manifest.version !== 1 || !Array.isArray(manifest.reviews)) throw Error('无效对齐复核版本');
const reviews = new Map();
for (const review of manifest.reviews) {
  if (reviews.has(review.key)) throw Error('重复对齐复核身份');
  reviews.set(review.key,review);
}
const compact = text => String(text || '').replace(/\s/g,'');
export function applyReviewedAlignment(passage,fallback) {
  if (passage.imported) return fallback;
  const key = [passage.level,passage.year,passage.month,passage.set_no,passage.section,passage.seq || 1].join('/');
  const review = reviews.get(key);
  if (!review) return fallback;
  const fingerprint = createHash('sha256').update(JSON.stringify([compact(passage.content),compact(passage.translation)])).digest('hex');
  if (fingerprint !== review.sourceHash) throw Error('已复核篇章内容变化，须重新审查：'+key);
  function segments(source,ends) {
    const text = String(source || ''),positions=[];
    for (let index=0;index<text.length;index++) if (!/\s/.test(text[index])) positions.push(index+1);
    if (!Array.isArray(ends) || !ends.length || ends.at(-1) !== positions.length) throw Error('无效复核终点：'+key);
    let previous=0,cursor=0;
    return ends.map(end => {
      if (!Number.isSafeInteger(end) || end<=previous || end>positions.length) throw Error('无效复核边界：'+key);
      const value=text.slice(cursor,positions[end-1]).trim(); cursor=positions[end-1]; previous=end; return value;
    });
  }
  const en=segments(passage.content,review.enEnds),zh=segments(passage.translation,review.zhEnds);
  if (en.length!==zh.length) throw Error('复核双语行数不一致：'+key);
  return en.map((text,index)=>({para:0,i:index,en:text,zh:zh[index]}));
}

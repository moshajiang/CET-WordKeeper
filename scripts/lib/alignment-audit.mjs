// 信息性筛查：数字等价不证明语义正确，邻行候选也不等于已经确认错位。
const digits={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
function chineseNumber(text) {
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (/^[零〇一二两三四五六七八九]+$/.test(text)) return Number([...text].map(char=>digits[char]).join(''));
  let total=0,section=0,number=0;
  for (const char of text) {
    if (Object.hasOwn(digits,char)) number=digits[char];
    else if (char==='万'||char==='亿') { total+=(section+number)*({万亿:1000000000000,万:10000,亿:100000000}[char]);section=0;number=0; }
    else if ('十百千'.includes(char)) { section+=(number||1)*({十:10,百:100,千:1000}[char]);number=0; }
    else return NaN;
  }
  return total+section+number;
}
const keyNumber=value=>String(Number(value.toPrecision(14)));
export function numericAnchors(text,{exclude=new Set()}={}) {
  let source=String(text || '').replace(/(\d),(?=\d{3}(?:\D|$))/g,'$1');
  source=source.replace(/百分之\s*([零〇一二两三四五六七八九十百千]+|\d+(?:\.\d+)?)/g,(_all,n)=>chineseNumber(n)+'%');
  source=source.replace(/[零〇一二两三四五六七八九十百千]+(?=世纪|年代|年|月|日)/g,n=>String(chineseNumber(n)));
  const values=new Set();
  const add=(kind,value)=>{if(Number.isFinite(value))values.add(kind+':'+keyNumber(value));};
  source=source.replace(/(\d+)世纪\s*(\d{2})年代(?:至|到)(\d{2})年代/g,(_all,c,d,e)=>{add('decade',(Number(c)-1)*100+Number(d));add('decade',(Number(c)-1)*100+Number(e));return ' ';});
  source=source.replace(/(\d+)世纪\s*(\d{2})年代/g,(_all,c,d)=>{add('decade',(Number(c)-1)*100+Number(d));return ' ';});
  source=source.replace(/(\d+)世纪(?:初|头(?:十|10)年(?:后期)?)/g,(_all,c)=>{add('decade',(Number(c)-1)*100);return ' ';});
  source=source.replace(/\b(\d{3}0)s\b/g,(_all,n)=>{add('decade',Number(n));return ' ';});
  source=source.replace(/\b(\d+)(?:st|nd|rd|th)\s+century\b|(\d+)世纪/gi,(_all,en,zh)=>{add('century',Number(en||zh));return ' ';});
  source=source.replace(/(\d+(?:\.\d+)?)\s*[-–至]\s*(\d+(?:\.\d+)?)\s*%/g,'$1% $2%');
  const scale={thousand:1000,million:1000000,billion:1000000000,bn:1000000000,trillion:1000000000000,万亿:1000000000000,万:10000,亿:100000000};
  for (const match of source.matchAll(/\d+(?:\.\d+)?(?:\s*(?:thousand|million|billion|trillion|bn|per\s+cent|percent|%|万亿|万|亿))?/gi)) {
    const raw=match[0],parts=raw.match(/^(\d+(?:\.\d+)?)(?:\s*(.*))?$/),number=Number(parts[1]),unit=(parts[2]||'').toLowerCase();
    const before=source[match.index-1]||'',after=source[match.index+raw.length]||'';
    if (/[\d.]/.test(before)||/\d/.test(after)||(after==='.'&&/\d/.test(source[match.index+raw.length+1]||''))) continue;
    if (!unit && Number.isInteger(number) && exclude.has(number)) continue;
    if (!unit && number<10 && !parts[1].includes('.')) continue;
    add(unit==='%'||unit==='percent'||/^per\s+cent$/.test(unit)?'percent':'number',number*(scale[unit]||1));
  }
  return values;
}
export const isDirections=text=>/^Directions?\b/.test(String(text)) || /Questions?\s+\d+\s+(?:and\s+\d+\s+|to\s+\d+\s+)?(?:are|is)\s+based/.test(String(text));
export function auditPairs(pairs,{exclude=new Set()}={}) {
  const zh=pairs.map(row=>numericAnchors(row.zh));
  let anT=0,anHit=0,anDrift=0,anLost=0,anAmbiguous=0,anUnitMismatch=0;
  const missSamples=[],details=[];
  for (const [index,row] of pairs.entries()) {
    if (isDirections(row.en)) continue;
    let rowDrift=false;
    const missing=[];
    for (const anchor of numericAnchors(row.en,{exclude})) {
      anT++;
      if (zh[index].has(anchor)) { anHit++;continue; }
      const [kind,value]=anchor.split(':');
      if (['number','percent'].includes(kind) && zh[index].has((kind==='number'?'percent':'number')+':'+value)) {
        anUnitMismatch++;missing.push(anchor);details.push({row:index+1,anchor,candidateRows:[],unitMismatch:true});continue;
      }
      const candidates=[];
      for (let next=Math.max(0,index-3);next<=Math.min(pairs.length-1,index+3);next++) if(next!==index&&zh[next].has(anchor)) candidates.push(next+1);
      if (candidates.length===1) rowDrift=true;
      else if(candidates.length>1) anAmbiguous++;
      else anLost++;
      missing.push(anchor);details.push({row:index+1,anchor,candidateRows:candidates});
    }
    if(rowDrift) anDrift++;
    if(missing.length&&missSamples.length<3) missSamples.push({k:index+1,en:String(row.en).slice(0,70),zh:String(row.zh).slice(0,62),ds:missing.join(',')});
  }
  return {anT,anHit,anDrift,anLost,anAmbiguous,anUnitMismatch,rate:anT?anHit/anT:null,missSamples,details};
}

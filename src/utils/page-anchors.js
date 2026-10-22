// Map normalized text offsets back to text nodes, without replacing Vue-owned article DOM.
export function normalizedText(value) {
  let text='',offsets=[];
  for(let i=0;i<value.length;i++){
    const c=/\s/u.test(value[i])?' ':value[i];
    if(c===' '&&text.endsWith(' '))continue;
    text+=c;offsets.push(i);
  }
  return {text,offsets};
}
export function findArticleRange(root,quote,occurrence=0) {
  if(!root||typeof quote!=='string'||!Number.isInteger(occurrence)||occurrence<0)return null;
  let text='',positions=[];
  for(const block of root.querySelectorAll('[data-ai-text]')){
    if(text){text+='\n';positions.push(null);}
    const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode();node;node=walker.nextNode()){
      for(let i=0;i<node.textContent.length;i++){text+=node.textContent[i];positions.push({node,offset:i});}
    }
  }
  const source=normalizedText(text),needle=normalizedText(quote).text.trim();
  if(!needle)return null;
  let start=-1;
  for(let i=0;i<=occurrence;i++){start=source.text.indexOf(needle,start+1);if(start<0)return null;}
  const first=positions[source.offsets[start]],last=positions[source.offsets[start+needle.length-1]];
  if(!first||!last)return null;
  const range=document.createRange();range.setStart(first.node,first.offset);range.setEnd(last.node,last.offset+1);
  return range;
}
export function placeExplanation(rect,width,height,viewport) {
  const gap=12,margin=12,w=Math.min(width,viewport.width-margin*2),h=Math.min(height,viewport.height-margin*2);
  let left=rect.right+gap,top=rect.top;
  if(left+w>viewport.width-margin){left=rect.left;top=rect.bottom+gap;}
  if(top+h>viewport.height-margin)top=rect.top-h-gap;
  return {left:Math.max(margin,Math.min(left,viewport.width-w-margin)),top:Math.max(margin,Math.min(top,viewport.height-h-margin))};
}

export function reviseFragment(text,quote,replacement){
 if(typeof text!=='string'||typeof quote!=='string'||!quote||typeof replacement!=='string'||replacement.length>20000)throw Error('替换内容无效');
 const index=text.indexOf(quote);if(index<0)throw Error('原句已修改，请重新批改。');if(text.indexOf(quote,index+1)>=0)throw Error('原句重复出现，请在输入框中手动修改对应位置。');
 return text.slice(0,index)+replacement+text.slice(index+quote.length);
}

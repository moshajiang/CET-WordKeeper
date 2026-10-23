// Parse SSE as data; never execute partial tool plans. Also accepts JSON-only services.
async function completionContent(response,{ensureActive=()=>{},onDelta=()=>{}}={}){
 if(!response.headers?.get?.('content-type')?.includes('text/event-stream')){const data=await response.json();ensureActive();return data?.choices?.[0]?.message?.content;}
 let buffer='',content='',done=false,finished=false;const decoder=new TextDecoder();
 function line(value){
  if(!value.startsWith('data:'))return;const data=value.slice(5).trim();if(!data)return;
  if(data==='[DONE]'){done=true;return;}
  const item=JSON.parse(data);if(item.error)throw Error('stream_error');
  const choice=item.choices?.[0];if(choice?.finish_reason){if(!['stop','tool_calls'].includes(choice.finish_reason))throw Error('incomplete_response');finished=true;}
  const delta=choice?.delta?.content;if(typeof delta==='string'){content+=delta;if(content.length>500000)throw Error('response_too_large');onDelta(content);}
 }
 for await(const bytes of response.body){ensureActive();buffer+=decoder.decode(bytes,{stream:true});if(buffer.length>2*1024*1024)throw Error('response_too_large');let end;while((end=buffer.indexOf('\n'))>=0){line(buffer.slice(0,end).replace(/\r$/,''));buffer=buffer.slice(end+1);}if(done)break;}
 ensureActive();buffer+=decoder.decode();if(buffer.trim())line(buffer.trim());if(!done&&!finished)throw Error('incomplete_response');return content;
}
function replyPreview(content){
 const source=content.trimStart().replace(/^```(?:json)?\s*/,'');
 if(!source.startsWith('{'))return source.slice(0,16000);
 const match=source.match(/^\{\s*"reply"\s*:\s*"/);if(!match)return '';
 let value='',escaped=false;
 for(let i=match[0].length;i<source.length;i++){const c=source[i];if(!escaped&&c==='"')break;value+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;}
 // Trim only an unfinished escape sequence; incomplete strings are expected during streaming.
 for(let trim=0;trim<=6&&trim<=value.length;trim++){try{return JSON.parse('"'+value.slice(0,value.length-trim)+'"').slice(0,16000);}catch{}}
 return '';
}
module.exports={completionContent,replyPreview};

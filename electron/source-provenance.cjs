function captureSourceAnchor(source){
 const p=source.sense||source.phrase;
 if(p)return {version:1,kind:p.kind,examId:p.exam_id,passageId:p.passage_id,quote:p.quote,occurrence:p.occurrence,start:p.start_offset,end:p.end_offset,contentHash:p.content_hash,context:p.context,contextOffset:p.context_offset??null,label:p.source_label};
 if(source.anchor){const a=source.anchor;return {version:1,kind:'knowledge',examId:a.examId,passageId:a.passageId,quote:a.quote,occurrence:a.occurrence,label:a.label,contentHash:a.contentHash??null};}
 return null;
}
module.exports={captureSourceAnchor};

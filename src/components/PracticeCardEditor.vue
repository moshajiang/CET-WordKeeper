<template>
 <fieldset class="practice-card-editor" :disabled="disabled">
  <label>题型<select :value="modelValue.type" @change="setType($event.target.value)" aria-label="练习卡题型"><option value="recall">问答</option><option value="translation">翻译</option><option value="judgment">判断</option><option value="choice">选择</option></select></label>
  <label>题目<textarea :value="modelValue.question" @input="set('question',$event.target.value)" rows="3" maxlength="6000" aria-label="练习卡题目" placeholder="一张卡解决一个问题，写清必要的语境…" /></label>
  <label v-if="modelValue.type==='choice'">选项，每行一个<textarea :value="modelValue.optionsText" @input="set('optionsText',$event.target.value)" rows="3" maxlength="6000" aria-label="练习卡选项" placeholder="至少两项，无需添加 A、B 编号" /></label>
  <label>答案<select v-if="modelValue.type==='judgment'" :value="modelValue.answer" @change="set('answer',$event.target.value)" aria-label="练习卡答案"><option>正确</option><option>错误</option></select><select v-else-if="modelValue.type==='choice'" :value="modelValue.answer" @change="set('answer',$event.target.value)" aria-label="练习卡答案"><option v-for="(option,i) in choices" :key="i" :value="String.fromCharCode(65+i)">{{ String.fromCharCode(65+i) }} · {{ option.slice(0,80) }}</option></select><textarea v-else :value="modelValue.answer" @input="set('answer',$event.target.value)" rows="3" maxlength="6000" aria-label="练习卡答案" /></label>
  <label>解析与依据<textarea :value="modelValue.explanation" @input="set('explanation',$event.target.value)" rows="3" maxlength="12000" aria-label="练习卡解析" /></label>
  <label>标签<input :value="modelValue.tagsText" @input="set('tagsText',$event.target.value)" maxlength="400" aria-label="练习卡标签" placeholder="逗号分隔，例如：语法,部分否定" /></label>
 </fieldset>
</template>
<script setup>
import {computed} from 'vue';
const props=defineProps({modelValue:{type:Object,required:true},disabled:{type:Boolean,default:false}}),emit=defineEmits(['update:modelValue']);
const choices=computed(()=>String(props.modelValue.optionsText||'').split('\n').map(s=>s.trim()).filter(Boolean).slice(0,6));
function set(key,value){emit('update:modelValue',{...props.modelValue,[key]:value});}
function setType(type){emit('update:modelValue',{...props.modelValue,type,optionsText:'',answer:type==='judgment'?'正确':type==='choice'?'A':''});}
</script>
<style scoped>
.practice-card-editor{display:grid;gap:12px;border:0;padding:0;margin:0;min-width:0}.practice-card-editor label{display:block;font-size:13px;line-height:1.6}.practice-card-editor input,.practice-card-editor textarea,.practice-card-editor select{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:9px 11px;border:1px solid var(--border);border-radius:8px;color:var(--text);background:var(--card);font:inherit}.practice-card-editor textarea{resize:vertical;min-height:65px}.practice-card-editor :focus{outline:2px solid var(--accent);outline-offset:1px}
</style>

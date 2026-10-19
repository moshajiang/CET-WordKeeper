import { shallowRef } from 'vue';

// 保留响应式引用，异步词典就绪时重新计算自导入文章的回退对齐。
export function useAlignmentLex(load = () => window.keeper.dictLex()) {
  const lex = shallowRef(null);
  let pending = null;
  function ensureLex() {
    if (lex.value) return Promise.resolve(lex.value);
    if (!pending) {
      pending = Promise.resolve().then(load).then(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid alignment lexicon');
        lex.value = value;
        return value;
      }).catch(() => null).finally(() => { pending = null; });
    }
    return pending;
  }
  return { lex, ensureLex };
}

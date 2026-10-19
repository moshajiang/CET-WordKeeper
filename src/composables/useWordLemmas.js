import { shallowRef } from 'vue';

// 后端为唯一词形来源。每个阅读器缓存结果，按批查询并合并并发的重复词。
export function useWordLemmas(load = words => window.keeper.resolveWords(words)) {
  const lemmas = shallowRef(new Map()), pending = new Map();
  const keyOf = raw => String(raw || '').toLowerCase().replace(/’/g,"'");
  const lemmaOf = raw => lemmas.value.get(keyOf(raw)) || keyOf(raw);
  async function ensureWords(values) {
    const words = [...new Set(values.map(keyOf))].filter(w => w.length <= 128 && /^[a-z][a-z'-]*$/.test(w));
    const waiting = new Set();
    const missing = words.filter(word => {
      if (pending.has(word)) { waiting.add(pending.get(word)); return false; }
      return !lemmas.value.has(word);
    });
    for (let i=0;i<missing.length;i+=1000) {
      const batch = missing.slice(i,i+1000);
      const request = Promise.resolve().then(() => load(batch)).then(result => {
        if (!result || typeof result !== 'object' || Array.isArray(result) || batch.some(w => !Object.hasOwn(result,w) || typeof result[w] !== 'string')) throw new Error('Invalid word mapping');
        const next = new Map(lemmas.value);
        for (const word of batch) next.set(word,result[word]);
        lemmas.value = next;
        return true;
      }).catch(() => false).finally(() => { for (const word of batch) if (pending.get(word) === request) pending.delete(word); });
      for (const word of batch) pending.set(word,request);
      waiting.add(request);
    }
    return (await Promise.all(waiting)).every(Boolean);
  }
  return { lemmas,lemmaOf,ensureWords };
}

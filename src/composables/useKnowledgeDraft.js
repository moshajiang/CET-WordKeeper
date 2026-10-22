import {ref} from 'vue';
// A draft is never written to the knowledge library until the user reviews and saves it.
export const knowledgeDraft=ref(null);
export function prepareKnowledgeDraft(value) {knowledgeDraft.value=JSON.parse(JSON.stringify(value));}

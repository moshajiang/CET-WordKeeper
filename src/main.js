import { createApp } from 'vue';
import App from './App.vue';
import router from './router.js';
import './styles.css';
import { syncStorageEpoch } from './utils/storage-epoch.js';

async function start() {
  try {
    const info = await window.keeper.info();
    syncStorageEpoch(localStorage,info.restore?.epoch);
    createApp(App).use(router).mount('#app');
  } catch (error) {
    // Fail closed: a reader must never replay stale drafts if storage cleanup fails.
    document.querySelector('#app').textContent = '启动失败，请关闭后重试：'+error.message;
  }
}
start();

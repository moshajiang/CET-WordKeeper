import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from './views/HomeView.vue';
import ExamLibrary from './views/ExamLibrary.vue';
import ReaderView from './views/ReaderView.vue';
import WordBook from './views/WordBook.vue';
import ReviewView from './views/ReviewView.vue';
import SettingsView from './views/SettingsView.vue';

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/library', name: 'library', component: ExamLibrary },
    { path: '/reader/:examId', name: 'reader', component: ReaderView, props: true },
    { path: '/words', name: 'words', component: WordBook },
    { path: '/review', name: 'review', component: ReviewView },
    { path: '/settings', name: 'settings', component: SettingsView },
  ],
});

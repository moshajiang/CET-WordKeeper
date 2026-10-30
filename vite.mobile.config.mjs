import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({root:path.join(root,'mobile'),base:'./',plugins:[vue()],build:{outDir:path.join(root,'dist-mobile'),emptyOutDir:true},server:{host:'127.0.0.1',port:5174,strictPort:true,fs:{allow:[root]}}});

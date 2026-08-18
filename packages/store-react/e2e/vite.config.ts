import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../../node_modules/.vite/store-react-e2e', import.meta.url)),
  resolve: {
    alias: { '@migaia/store-react': fileURLToPath(new URL('../src/index.ts', import.meta.url)) }
  },
  server: { host: '127.0.0.1', port: 4181, strictPort: true }
});

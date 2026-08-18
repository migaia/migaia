import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../../node_modules/.vite/store-keyed-e2e', import.meta.url)),
  resolve: {
    alias: { '@migaia/store-keyed': fileURLToPath(new URL('../src/index.ts', import.meta.url)) }
  },
  server: { host: '127.0.0.1', port: 4185, strictPort: true }
});

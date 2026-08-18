import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(
    new URL('../../../node_modules/.vite/store-indexed-e2e', import.meta.url)
  ),
  resolve: {
    alias: { '@migaia/store-indexed': fileURLToPath(new URL('../src/index.ts', import.meta.url)) }
  },
  server: { host: '127.0.0.1', port: 4184, strictPort: true }
});

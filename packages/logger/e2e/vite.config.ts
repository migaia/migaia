import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../../node_modules/.vite/logger', import.meta.url)),
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true
  }
});

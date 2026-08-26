import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../../node_modules/.vite/store-worker-e2e', import.meta.url)),
  resolve: {
    alias: { '@migaia/store-worker': fileURLToPath(new URL('../src/index.ts', import.meta.url)) }
  },
  server: { host: '127.0.0.1', port: 4182, strictPort: true }
})

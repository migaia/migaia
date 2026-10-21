import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('./fixtures/', import.meta.url)),
  optimizeDeps: {
    exclude: [
      '@migaia/rpc-contract',
      '@migaia/rpc-core',
      '@migaia/rpc-threads',
      '@migaia/lifecycle',
      '@migaia/supervision',
      '@migaia/utils'
    ]
  },
  server: {
    host: '127.0.0.1',
    port: 4180,
    strictPort: true
  }
})

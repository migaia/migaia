import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('../../rpc-integration/test/', import.meta.url)),
  optimizeDeps: {
    exclude: [
      '@migaia/rpc-contract',
      '@migaia/rpc-core',
      '@migaia/rpc-process',
      '@migaia/rpc-threads',
      '@migaia/rpc-bridge-jsonrpc',
      '@migaia/rpc-browser'
    ]
  },
  server: {
    host: '127.0.0.1',
    port: 4178,
    strictPort: true
  }
})

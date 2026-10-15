import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/**
 * Peer fixtures stay with their owning browser package while legacy Endpoint fixtures retain their
 * root.
 */
const peerFixtures = fileURLToPath(new URL('./browser-peer/', import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL('../../rpc-integration/test/', import.meta.url)),
  plugins: [
    {
      name: 'rpc-browser-peer-fixtures',
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (request.url?.startsWith('/browser-peer/'))
            request.url = `/@fs/${peerFixtures}${request.url.slice('/browser-peer/'.length)}`
          next()
        })
      }
    }
  ],
  optimizeDeps: {
    exclude: [
      '@migaia/rpc-contract',
      '@migaia/rpc-core',
      '@migaia/rpc-process',
      '@migaia/rpc-threads',
      '@migaia/rpc-browser'
    ]
  },
  server: {
    host: '127.0.0.1',
    port: 4178,
    strictPort: true
  }
})

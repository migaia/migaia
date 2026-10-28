import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/** Serve the original browser fixture against public package entries and a private build cache. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(
    new URL('../../../../node_modules/.vite/log-console-browser', import.meta.url)
  ),
  server: { host: '127.0.0.1', port: 4173, strictPort: true }
})

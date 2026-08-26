import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/** Produces one runtime-neutral ESM entry; declarations are emitted by TypeScript. */
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/storage-contract', import.meta.url)),
  build: {
    target: 'es2022',
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js'
    },
    sourcemap: true,
    rollupOptions: {
      external: ['@migaia/lifecycle', '@migaia/utils', '@migaia/utils/bytes']
    }
  }
})

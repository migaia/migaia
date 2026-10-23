import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

/** Existing dependency owners stay external through their root and every public subpath. */
const dependencies = ['@migaia/utils', '@migaia/serialize']

/** Produces one runtime-neutral ESM entry; declarations are emitted by TypeScript. */
export default defineConfig(
  withDistFreshness({
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
        external: (id) =>
          dependencies.some((dependency) => id === dependency || id.startsWith(`${dependency}/`))
      }
    }
  })
)

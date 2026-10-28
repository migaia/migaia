import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

/** Existing dependency owners stay external through their root and every public subpath. */
const dependencies = ['@migaia/utils', '@migaia/serialize']

/** Separate consumer-run conformance from the normal runtime entry; declarations stay with TypeScript. */
export default defineConfig(
  withDistFreshness({
    cacheDir: fileURLToPath(new URL('../../node_modules/.vite/storage-contract', import.meta.url)),
    build: {
      target: 'es2022',
      lib: {
        entry: {
          index: 'src/index.ts',
          'error-code': 'src/error-codes.ts',
          conformance: 'src/conformance/index.ts'
        },
        formats: ['es'],
        fileName: (_format, name) => `${name}.js`
      },
      sourcemap: true,
      rollupOptions: {
        external: (id) =>
          dependencies.some((dependency) => id === dependency || id.startsWith(`${dependency}/`))
      }
    }
  })
)

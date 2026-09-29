import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

/** Builds each public entry while keeping lifecycle and utils as single workspace copies. */
export default defineConfig(withDistFreshness({
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/supervision', import.meta.url)),
  build: {
    target: 'es2022',
    rollupOptions: {
      external: (id) => id === '@migaia/lifecycle' || id.startsWith('@migaia/lifecycle/') || id === '@migaia/utils' || id.startsWith('@migaia/utils/'),
      preserveEntrySignatures: 'strict',
      input: { index: 'src/index.ts', 'coroutine/index': 'src/coroutine/index.ts' },
      output: { preserveModules: true, preserveModulesRoot: 'src', entryFileNames: '[name].js' }
    },
    sourcemap: true
  }
}))

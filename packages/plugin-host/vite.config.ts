import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

/** Runtime dependencies that must stay external to preserve one owner per package boundary. */
const runtimeExternals = [
  '@migaia/capability',
  '@migaia/lifecycle',
  '@migaia/middleware-pipeline',
  '@migaia/utils'
] as const

/** Keeps exact package imports and their subpaths external to the publication graph. */
const isRuntimeExternal = (id: string): boolean =>
  runtimeExternals.some((dependency) => id === dependency || id.startsWith(`${dependency}/`))

/**
 * Test files whose assertions compare wall-clock timings across input sizes. They run as a separate
 * project after every other file has finished and one file at a time, so parallel workers cannot
 * steal CPU from a timed section and turn a size ratio red (R18, X6).
 */
const timingTestFiles = ['test/host-mutation-scaling.test.ts', 'test/acceptance-contract.test.ts']

/** Produces one runtime-neutral ESM entry; declarations are emitted by TypeScript. */
export default defineConfig(withDistFreshness({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          exclude: [...configDefaults.exclude, ...timingTestFiles],
          sequence: { groupOrder: 0 }
        }
      },
      {
        extends: true,
        test: {
          name: 'timing',
          include: timingTestFiles,
          fileParallelism: false,
          sequence: { groupOrder: 1 }
        }
      }
    ]
  },
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/plugin-host', import.meta.url)),
  build: {
    target: 'es2020',
    lib: {
      entry: {
        index: 'src/index.ts',
        'composition-entry': 'src/composition-entry.ts'
      },
      formats: ['es'],
      fileName: () => 'index.js'
    },
    sourcemap: true,
    rollupOptions: {
      external: isRuntimeExternal,
      preserveEntrySignatures: 'strict',
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js'
      }
    }
  }
}))

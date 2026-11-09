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
 * steal CPU from a timed section and turn a size ratio red.
 */
const timingTestFiles = ['test/acceptance-contract.test.ts']

/** Produces one runtime-neutral ESM entry; declarations are emitted by TypeScript. */
export default defineConfig(
  withDistFreshness({
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
      target: 'es2022',
      lib: {
        entry: {
          index: 'src/index.ts',
          'modules/feature-dependencies/composition-entry':
            'src/modules/feature-dependencies/composition-entry.ts',
          'modules/features/index': 'src/modules/features/index.ts',
          'modules/enablement/index': 'src/modules/enablement/index.ts',
          'modules/activation/index': 'src/modules/activation/index.ts',
          'modules/named-pipelines/index': 'src/modules/named-pipelines/index.ts',
          'modules/pipeline-modes/sync': 'src/modules/pipeline-modes/sync.ts',
          'modules/pipeline-modes/async': 'src/modules/pipeline-modes/async.ts',
          'modules/pipeline-modes/generator': 'src/modules/pipeline-modes/generator.ts',
          'modules/pipeline-modes/async-generator': 'src/modules/pipeline-modes/async-generator.ts',
          'modules/feature-dependencies/index': 'src/modules/feature-dependencies/index.ts',
          'feature-overlay': 'src/feature-overlay.ts',
          'feature-overlay-notifications': 'src/feature-overlay-notifications.ts'
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
  })
)

import { configDefaults, defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

export default defineConfig(
  withDistFreshness({
    test: {
      /** Large frame coverage and native child fixtures share the CI host without starving timers. */
      maxWorkers: 2,
      exclude: [
        ...configDefaults.exclude,
        'test/process/conformance*.test.ts',
        'test/bridge/conformance-faults.test.ts',
        'test/merge/suite-parity.test.ts'
      ],
      /**
       * Reuse the repository's project ordering so 16 MiB coverage never competes with native
       * fixtures.
       */
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            include: ['test/**/*.{test,spec}.ts'],
            exclude: [
              ...configDefaults.exclude,
              'test/process/conformance*.test.ts',
              'test/bridge/conformance-faults.test.ts',
              'test/merge/suite-parity.test.ts',
              'test/runtime-api/single-frame.test.ts'
            ],
            sequence: { groupOrder: 0 }
          }
        },
        {
          extends: true,
          test: {
            name: 'large-frame',
            include: ['test/runtime-api/single-frame.test.ts'],
            fileParallelism: false,
            sequence: { groupOrder: 1 }
          }
        }
      ],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        reporter: ['text-summary', 'json-summary', 'json']
      }
    }
  })
)

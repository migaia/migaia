import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

/** Every current RPC test owner contributes to the same executed-source coverage unit. */
const testOwners = [
  'rpc-contract',
  'rpc-core',
  'rpc-process',
  'rpc-threads',
  'rpc-browser',
  'rpc-integration'
]
/** Runtime coverage belongs to exactly the five final Source owners; integration has no runtime API. */
const runtimeOwners = testOwners.filter((owner) => owner !== 'rpc-integration')
/** Preserve the existing test discovery origin while each owner supplies its TS transformer. */
const familyDirectory = fileURLToPath(new URL('.', import.meta.url))
/** Timing-sensitive conformance and parity suites belong to their exclusive standalone gates. */
const excluded = [
  ...configDefaults.exclude,
  'test/process/conformance*.test.ts',
  'test/bridge/conformance-faults.test.ts',
  'test/bridge/conformance-faults.test.ts',
  'test/merge/suite-parity.test.ts'
]

/** A single family gate makes moving a test between owners neutral to Source coverage. */
export default defineConfig(
  withDistFreshness({
    test: {
      maxWorkers: 2,
      exclude: excluded,
      projects: [
        ...testOwners.map((owner) => ({
          root: fileURLToPath(new URL('../' + owner, import.meta.url)),
          extends: true as const,
          test: {
            name: 'family-unit-' + owner,
            dir: familyDirectory,
            include: ['../' + owner + '/test/**/*.{test,spec}.ts'],
            exclude: [...excluded, '**/test/runtime-api/single-frame.test.ts'],
            sequence: { groupOrder: 0 }
          }
        })),
        {
          extends: true,
          test: {
            name: 'family-large-frame',
            include: testOwners.map(
              (owner) => '../' + owner + '/test/runtime-api/single-frame.test.ts'
            ),
            fileParallelism: false,
            sequence: { groupOrder: 1 }
          }
        }
      ],
      coverage: {
        provider: 'v8',
        enabled: true,
        allowExternal: true,
        // V8 matches canonical absolute execution URLs before its compiler Source-map remap.
        include: runtimeOwners.flatMap((owner) => [
          fileURLToPath(new URL('../' + owner + '/src/**/*.{ts,tsx}', import.meta.url)),
          fileURLToPath(new URL('../' + owner + '/dist/**/*.js', import.meta.url))
        ]),
        reporter: ['text-summary', 'json-summary', 'json'],
        reportsDirectory: 'coverage-family',
        thresholds: { statements: 85, branches: 80, functions: 85, lines: 85 }
      }
    }
  })
)

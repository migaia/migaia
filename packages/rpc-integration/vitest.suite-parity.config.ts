import { configDefaults, defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'
import { fileURLToPath } from 'node:url'

/**
 * Only the oracle's child enables collection; the public parity command still runs its two
 * assertions.
 */
const collect = process.env.RPC_SUITE_PARITY_COLLECT === '1'
/** Each real owner has a unique project name and its own test root. */
const owners = [
  'rpc-contract',
  'rpc-core',
  'rpc-process',
  'rpc-threads',
  'rpc-bridge-jsonrpc',
  'rpc-browser',
  'rpc-integration'
] as const

/** Run the legacy parity aggregator after the default suite, avoiding two competing worker pools. */
export default defineConfig(
  withDistFreshness({
    test: collect
      ? {
          maxWorkers: 2,
          coverage: { enabled: false },
          projects: owners.map((owner, index) => ({
            extends: true as const,
            root: fileURLToPath(new URL('../' + owner + '/', import.meta.url)),
            test: {
              name: owner,
              include: ['test/**/*.{test,spec}.ts'],
              exclude: [
                ...configDefaults.exclude,
                'test/process/conformance*.test.ts',
                'test/bridge/conformance-faults.test.ts',
                'test/merge/suite-parity.test.ts'
              ],
              sequence: { groupOrder: index }
            }
          }))
        }
      : {
          include: ['test/merge/suite-parity.test.ts'],
          exclude: [...configDefaults.exclude],
          fileParallelism: false,
          maxWorkers: 1,
          coverage: { enabled: false }
        }
  })
)

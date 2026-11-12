import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig, type Plugin } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

/** Every current RPC test owner contributes to the same executed-source coverage unit. */
const testOwners = [
  'rpc-contract',
  'rpc-host',
  'rpc-plugin-process',
  'rpc-plugin-thread',
  'rpc-plugin-browser',
  'rpc-plugin-coroutines',
  'rpc-plugin-pool',
  'rpc-plugin-devtools',
  'rpc-integration'
]
/** Runtime coverage belongs to exactly the final source owners; integration has no runtime API. */
const runtimeOwners = testOwners.filter((owner) => owner !== 'rpc-integration')
/** Preserve the existing test discovery origin while each owner supplies its TS transformer. */
const familyDirectory = fileURLToPath(new URL('.', import.meta.url))
/** Timing-sensitive conformance and parity suites belong to their exclusive standalone gates. */
const excluded = [
  ...configDefaults.exclude,
  'test/process/conformance*.test.ts',
  'test/bridge/conformance-faults.test.ts',
  'test/bridge/conformance-faults.test.ts',
  'test/merge/suite-parity.test.ts',
  // Browser specs run under Playwright through each owner's test:e2e, never under Vitest.
  '../*/test/e2e/**'
]

/** Absolute `packages/` directory that holds every family owner. */
const packagesDirectory = fileURLToPath(new URL('../', import.meta.url))

/**
 * Map an owner's built file to the source file it was compiled from, or undefined when the path is
 * not an owner's `dist/*.js`. Every owner builds with `rootDir: ./src`, so `dist` mirrors `src`.
 */
function ownerSourceOf(resolved: string): string | undefined {
  if (!resolved.startsWith(packagesDirectory)) return undefined
  const [owner, folder, ...rest] = resolved.slice(packagesDirectory.length).split('/')
  if (folder !== 'dist' || !runtimeOwners.includes(owner!) || !rest.at(-1)?.endsWith('.js'))
    return undefined
  /** Source path with the same relative location and a `.ts` extension. */
  const source = packagesDirectory + [owner, 'src', ...rest].join('/').replace(/\.js$/, '.ts')
  return existsSync(source) ? source : undefined
}

/**
 * Tests reach owner modules both through `src` and through `dist` (package names, or relative
 * `dist` paths used to spy on the classes the runtime uses). Loading both puts two copies of one
 * module in the run, and coverage counts the source twice with slightly different positions.
 * Resolving package imports to `src` keeps one copy.
 */
const ownerSourcePlugin: Plugin = {
  name: 'rpc-family-owner-source',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    // Only package names and explicit `dist` paths can reach an owner's built output.
    if (!source.startsWith('@migaia/rpc') && !source.includes('/dist/')) return null
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
    return resolved ? (ownerSourceOf(resolved.id) ?? null) : null
  }
}

/** A single family gate makes moving a test between owners neutral to Source coverage. */
export default defineConfig(
  withDistFreshness({
    plugins: [ownerSourcePlugin],
    test: {
      // Shared budget of the family unit projects; large frames stay serial.
      maxWorkers: 3,
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
        // V8 matches canonical absolute execution URLs. Owner package imports load `src` (see
        // ownerSourcePlugin), so `dist` is not counted and cannot duplicate a source file.
        include: runtimeOwners.map((owner) =>
          fileURLToPath(new URL('../' + owner + '/src/**/*.{ts,tsx}', import.meta.url))
        ),
        reporter: ['text-summary', 'json-summary', 'json'],
        reportsDirectory: 'coverage-family',
        thresholds: { statements: 85, branches: 80, functions: 85, lines: 85 }
      }
    }
  })
)

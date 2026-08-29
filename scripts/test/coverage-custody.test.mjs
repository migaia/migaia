import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  assertCompleteMetrics,
  assertExclusions,
  assertChangedFilesCovered,
  assertChangedFilesPresent,
  assertPackageReportsComplete,
  assertMonotonic,
  changedRuntimeFiles,
  normalizeCoveragePath,
  serializeBaseline,
  summaryMetrics
} from '../coverage-custody.mjs'

const metrics = (covered = 8, total = 10, pct = 80) => ({ covered, total, pct })

/**
 * Resolves synthetic coverage fixture paths from this test's checkout so the custody assertions
 * remain portable across developer and CI workspaces.
 */
const checkoutPath = (...segments) => resolve(import.meta.dirname, '..', '..', ...segments)

test('coverage custody rejects a decreased package metric', () => {
  assert.throws(
    () =>
      assertMonotonic(
        { branches: metrics(7, 10, 70) },
        { branches: metrics(8, 10, 80) },
        '@migaia/example'
      ),
    /decreased/
  )
})

test('coverage custody rejects covered-count decrease hidden by equal percentage', () => {
  assert.throws(
    () =>
      assertMonotonic(
        { branches: metrics(8, 10, 80) },
        { branches: metrics(9, 10, 80) },
        '@migaia/example'
      ),
    /covered count/
  )
})

test('coverage custody rejects denominator expansion hidden by equal percentage', () => {
  assert.throws(
    () =>
      assertMonotonic(
        { branches: metrics(16, 20, 80) },
        { branches: metrics(8, 10, 80) },
        '@migaia/example'
      ),
    /expanded/
  )
})

test('coverage custody rejects a changed file absent from the report', () => {
  assert.throws(() => assertChangedFilesPresent(['packages/example/src/new.ts'], {}), /absent/)
})

test('coverage custody rejects a changed file without a branch map', () => {
  assert.throws(
    () =>
      assertChangedFilesPresent(['packages/example/src/new.ts'], {
        [checkoutPath('packages', 'example', 'src', 'new.ts')]: {}
      }),
    /branch map/
  )
})

test('coverage custody rejects a changed file without a baseline', () => {
  assert.throws(
    () =>
      assertChangedFilesCovered(
        ['packages/example/src/new.ts'],
        {
          [checkoutPath('packages', 'example', 'src', 'new.ts')]: {
            branches: metrics(10, 10, 100),
            branchMap: {}
          }
        },
        {}
      ),
    /baseline/
  )
})

test('coverage custody rejects a changed file with a decreased branch map', () => {
  assert.throws(
    () =>
      assertChangedFilesCovered(
        ['packages/example/src/new.ts'],
        {
          [checkoutPath('packages', 'example', 'src', 'new.ts')]: {
            branches: metrics(8, 10, 80),
            branchMap: {}
          }
        },
        { 'packages/example/src/new.ts': { branches: metrics(9, 10, 90) } }
      ),
    /decreased/
  )
})

test('coverage custody accepts covered changed files and ignores docs/tests', () => {
  const changed = changedRuntimeFiles([
    'packages/example/src/index.ts',
    'packages/example/src/index.ts',
    'packages/example/test/index.test.ts',
    'packages/example/README.md'
  ])
  assert.deepEqual(changed, ['packages/example/src/index.ts'])
  assert.doesNotThrow(() =>
    assertChangedFilesCovered(
      changed,
      {
        [checkoutPath('packages', 'example', 'src', 'index.ts')]: {
          branches: metrics(10, 10, 100),
          branchMap: {}
        }
      },
      { 'packages/example/src/index.ts': { branches: metrics(9, 10, 90) } }
    )
  )
})

test('coverage summary preserves all count and percentage fields', () => {
  assert.deepEqual(
    summaryMetrics({
      total: {
        lines: metrics(8, 10, 80),
        statements: metrics(7, 10, 70),
        functions: metrics(6, 10, 60),
        branches: metrics(5, 10, 50)
      }
    }),
    {
      lines: metrics(8, 10, 80),
      statements: metrics(7, 10, 70),
      functions: metrics(6, 10, 60),
      branches: metrics(5, 10, 50)
    }
  )
})

test('coverage custody rejects incomplete package metric reports', () => {
  assert.throws(
    () => assertCompleteMetrics({ lines: metrics() }, '@migaia/example'),
    /complete metric set/
  )
})

test('coverage custody rejects omitted package reports', () => {
  assert.throws(
    () => assertPackageReportsComplete(['capability', 'web-rpc'], { capability: {} }),
    /incomplete/
  )
})

test('coverage custody rejects broadened exclusions', () => {
  assert.throws(
    () =>
      assertExclusions({
        wasm: 'Rust and wasm-bindgen coverage is owned by the package wasm runner',
        website: 'not covered'
      }),
    /exclusions differ/
  )
})

test('coverage custody excludes non-V8 changed runtime files', () => {
  assert.deepEqual(
    changedRuntimeFiles(['packages/wasm/src/index.ts', 'packages/utils/src/index.ts'], ['wasm']),
    ['packages/utils/src/index.ts']
  )
})

test('coverage custody normalizes file URLs without checkout paths', () => {
  assert.equal(
    normalizeCoveragePath(pathToFileURL(checkoutPath('packages', 'utils', 'src', 'index.ts')).href),
    'packages/utils/src/index.ts'
  )
})

test('coverage custody serializes package and file keys deterministically', () => {
  const result = {
    version: 1,
    generatedBy: 'scripts/coverage-custody.mjs',
    packages: { utils: { lines: metrics() }, capability: { lines: metrics() } },
    files: { 'packages/utils/src/z.ts': {}, 'packages/utils/src/a.ts': {} },
    exclusions: { wasm: 'Rust and wasm-bindgen coverage is owned by the package wasm runner' },
    changedRuntimeFiles: ['packages/utils/src/z.ts', 'packages/utils/src/a.ts']
  }
  assert.equal(
    serializeBaseline(result),
    serializeBaseline({ ...result, packages: { ...result.packages }, files: { ...result.files } })
  )
})

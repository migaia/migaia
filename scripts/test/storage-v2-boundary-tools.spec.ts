import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  inspectVirtualStorePackageRoots,
  packageContentSha256
} from '../storage-v2-package-tree.mjs'
import {
  assertExactRetainedModules,
  normalizeRetainedModules
} from '../storage-v2-retained-ledger.mjs'

describe('root-owned package-tree and retained-ledger tools', () => {
  it('hashes file and symlink identity deterministically and detects byte drift', () => {
    const root = mkdtempSync(join(tmpdir(), 'storage-v2-tree-tool-'))
    mkdirSync(join(root, 'dist'))
    writeFileSync(join(root, 'dist', 'index.js'), 'export const value = 1\n')
    symlinkSync('index.js', join(root, 'dist', 'alias.js'))
    const before = packageContentSha256(root)
    expect(packageContentSha256(root)).toBe(before)
    writeFileSync(join(root, 'dist', 'index.js'), 'export const value = 2\n')
    expect(packageContentSha256(root)).not.toBe(before)
  })

  it('enumerates distinct virtual-store roots for one scoped package', () => {
    const consumer = mkdtempSync(join(tmpdir(), 'storage-v2-root-tool-'))
    const first = join(consumer, 'node_modules/.pnpm/first/node_modules/@migaia/utils')
    const second = join(consumer, 'node_modules/.pnpm/second/node_modules/@migaia/utils')
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })
    expect(inspectVirtualStorePackageRoots(consumer, '@migaia/utils')).toEqual(
      [realpathSync(first), realpathSync(second)].sort()
    )
  })

  it('normalizes only the admitted root and rejects raw-ID collisions or set drift', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'storage-v2-ledger-tool-'))
    const consumer = join(fixture, 'consumer')
    const packageRoot = join(fixture, 'node_modules/@migaia/utils')
    const aliasRoot = join(fixture, 'alias/node_modules/@migaia/utils')
    mkdirSync(consumer, { recursive: true })
    mkdirSync(join(packageRoot, 'dist'), { recursive: true })
    mkdirSync(join(aliasRoot, '..'), { recursive: true })
    writeFileSync(join(consumer, 'bundle-entry.js'), 'export const app = true\n')
    writeFileSync(join(packageRoot, 'dist/bytes.js'), 'export const bytes = true\n')
    symlinkSync(packageRoot, aliasRoot, 'dir')
    const installed = new Map([['@migaia/utils', { root: realpathSync(packageRoot) }]])
    const normalized = normalizeRetainedModules(
      [realpathSync(join(consumer, 'bundle-entry.js')), join(packageRoot, 'dist/bytes.js')],
      consumer,
      installed
    )
    expect(normalized).toEqual(['app/bundle-entry.js', '@migaia/utils/dist/bytes.js'])
    expect(() =>
      normalizeRetainedModules(
        [join(packageRoot, 'dist/bytes.js'), join(aliasRoot, 'dist/bytes.js')],
        consumer,
        installed
      )
    ).toThrow('retained module identity collision')
    expect(() =>
      assertExactRetainedModules([...normalized, 'virtual:hostile'], normalized)
    ).toThrow('unexpected retained module: virtual:hostile')
  })

  it('normalizes a packed unscoped dependency only through its admitted root', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'storage-v2-packed-dependency-'))
    const consumer = join(fixture, 'consumer')
    const packageRoot = join(fixture, 'node_modules/.pnpm/ansis/node_modules/ansis')
    const foreignRoot = join(fixture, 'foreign/node_modules/ansis')
    mkdirSync(consumer, { recursive: true })
    mkdirSync(packageRoot, { recursive: true })
    mkdirSync(foreignRoot, { recursive: true })
    writeFileSync(join(packageRoot, 'index.mjs'), 'export const color = true\n')
    writeFileSync(join(foreignRoot, 'index.mjs'), 'export const color = true\n')
    const moduleId = join(packageRoot, 'index.mjs')
    const installed = new Map([['ansis', { root: realpathSync(packageRoot) }]])
    expect(normalizeRetainedModules([moduleId], consumer, installed)).toEqual(['ansis/index.mjs'])
    expect(normalizeRetainedModules([moduleId], consumer, new Map())).toEqual([
      'package:ansis/index.mjs'
    ])
    expect(() =>
      assertExactRetainedModules(normalizeRetainedModules([moduleId], consumer, new Map()), [
        'ansis/index.mjs'
      ])
    ).toThrow('unexpected retained module: package:ansis/index.mjs')
    expect(normalizeRetainedModules([join(foreignRoot, 'index.mjs')], consumer, installed)).toEqual(
      [`foreign-package:${join(foreignRoot, 'index.mjs')}`]
    )
    symlinkSync(join(foreignRoot, 'index.mjs'), join(packageRoot, 'escaped.mjs'))
    expect(
      normalizeRetainedModules([join(packageRoot, 'escaped.mjs')], consumer, installed)
    ).toEqual([`escaped-package:${join(packageRoot, 'escaped.mjs')}`])
  })

  it(
    'preserves semantic eight-letter suffixes and candidates without chunk evidence',
    preservesSemanticSuffixes
  )
  it('normalizes chunks proven by source maps or declared-entry imports', normalizesProvenChunks)
  it(
    'rejects distinct proven chunks that normalize to the same identity',
    rejectsProvenChunkCollisions
  )
})

/** Exact declarations and source-map identities keep real module names distinct from hash suffixes. */
function preservesSemanticSuffixes(): void {
  /** This isolated package has no relationship to workspace source or build directories. */
  const fixture = mkdtempSync(join(tmpdir(), 'storage-v2-semantic-suffix-'))
  /** Normalization still begins from the real consumer root. */
  const consumer = join(fixture, 'consumer')
  /** All evidence belongs to the exact admitted installed package. */
  const packageRoot = join(fixture, 'node_modules/@migaia/utils')
  mkdirSync(consumer, { recursive: true })
  mkdirSync(join(packageRoot, 'dist'), { recursive: true })
  /** Three literal fixture names cover a declaration, a source map and absent metadata. */
  const modules = ['host-defaults.js', 'host-identity.js', 'worker-abcdefgh.js'] as const
  // The loop is bounded by the three literal fixture names above.
  for (const module of modules)
    writeFileSync(join(packageRoot, 'dist', module), 'export const stable = true\n')
  writeFileSync(join(packageRoot, 'dist/host-defaults.d.ts'), 'export declare const stable: true\n')
  writeFileSync(
    join(packageRoot, 'dist/host-identity.js.map'),
    JSON.stringify({ version: 3, file: 'host-identity.js', sources: ['../src/host-identity.ts'] })
  )
  /** The immutable installed snapshot owns declaration and map evidence for this operation. */
  const installed = new Map([['@migaia/utils', { root: realpathSync(packageRoot) }]])
  /** Full semantic suffixes and unproven candidates must remain three separate identities. */
  const normalized = normalizeRetainedModules(
    [
      join(packageRoot, 'dist/host-defaults.js'),
      join(packageRoot, 'dist/host-identity.js'),
      join(packageRoot, 'dist/worker-abcdefgh.js')
    ],
    consumer,
    installed
  )
  expect(normalized).toEqual([
    '@migaia/utils/dist/host-defaults.js',
    '@migaia/utils/dist/host-identity.js',
    '@migaia/utils/dist/worker-abcdefgh.js'
  ])
}

/** Real map ownership and parsed static imports prove both single-source and multi-source chunks. */
function normalizesProvenChunks(): void {
  /** The fixture models installed output without an unpublished src tree. */
  const fixture = mkdtempSync(join(tmpdir(), 'storage-v2-proven-chunks-'))
  /** Consumer provenance is independent from the package's bundle metadata. */
  const consumer = join(fixture, 'consumer')
  /** Both candidate chunks and the declared scheduler entry belong to this admitted package. */
  const packageRoot = join(fixture, 'node_modules/@migaia/utils')
  mkdirSync(consumer, { recursive: true })
  mkdirSync(join(packageRoot, 'dist'), { recursive: true })
  writeFileSync(
    join(packageRoot, 'dist/projection-AbCd1234.js'),
    'export const projection = true\n'
  )
  writeFileSync(
    join(packageRoot, 'dist/projection-AbCd1234.js.map'),
    JSON.stringify({
      version: 3,
      file: 'projection-AbCd1234.js',
      sources: ['../src/entity/projection.ts']
    })
  )
  writeFileSync(join(packageRoot, 'dist/scheduler-XyZq5678.js'), 'export const timer = true\n')
  writeFileSync(
    join(packageRoot, 'dist/scheduler-XyZq5678.js.map'),
    JSON.stringify({
      version: 3,
      file: 'scheduler-XyZq5678.js',
      sources: ['../src/internal/timer.ts', '../src/internal/rate.ts']
    })
  )
  writeFileSync(
    join(packageRoot, 'dist/scheduler.js'),
    "import './scheduler-XyZq5678.js'\nexport const value = 1\n"
  )
  writeFileSync(join(packageRoot, 'dist/scheduler.d.ts'), 'export declare const value: number\n')
  /** Both branches use the same immutable package record as the real retained ledger. */
  const installed = new Map([['@migaia/utils', { root: realpathSync(packageRoot) }]])
  expect(
    normalizeRetainedModules(
      [
        join(packageRoot, 'dist/projection-AbCd1234.js'),
        join(packageRoot, 'dist/scheduler-XyZq5678.js')
      ],
      consumer,
      installed
    )
  ).toEqual(['@migaia/utils/dist/projection-[chunk].js', '@migaia/utils/dist/scheduler-[chunk].js'])
}

/** Positive chunk evidence never grants permission to collapse two distinct raw module files. */
function rejectsProvenChunkCollisions(): void {
  /** Each raw file has its own real path and source map inside one admitted package. */
  const fixture = mkdtempSync(join(tmpdir(), 'storage-v2-chunk-collision-'))
  /** Collision checking retains the existing consumer-root admission. */
  const consumer = join(fixture, 'consumer')
  /** Both generated variants intentionally claim one reviewed source stem. */
  const packageRoot = join(fixture, 'node_modules/@migaia/utils')
  mkdirSync(consumer, { recursive: true })
  mkdirSync(join(packageRoot, 'dist'), { recursive: true })
  /** Two literal generated variants establish an actual many-to-one normalization collision. */
  const modules = ['projection-AbCd1234.js', 'projection-XyZq5678.js'] as const
  // The loop is bounded by the two literal generated variants above.
  for (const module of modules) {
    writeFileSync(join(packageRoot, 'dist', module), 'export const projection = true\n')
    writeFileSync(
      join(packageRoot, 'dist', `${module}.map`),
      JSON.stringify({ version: 3, file: module, sources: ['../src/entity/projection.ts'] })
    )
  }
  /** Original package provenance remains required before either variant can be normalized. */
  const installed = new Map([['@migaia/utils', { root: realpathSync(packageRoot) }]])
  /** The error must identify the exact distinct raw files, not merely reject for another reason. */
  const first = join(packageRoot, 'dist', modules[0])
  /** Input order determines the second raw identity named by the unchanged collision guard. */
  const second = join(packageRoot, 'dist', modules[1])
  expect(() => normalizeRetainedModules([first, second], consumer, installed)).toThrow(
    `retained module identity collision: @migaia/utils/dist/projection-[chunk].js: ${first}, ${second}`
  )
}

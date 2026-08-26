import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type ISemanticCategory =
  | 'owner'
  | 'adapter'
  | 'consumer'
  | 'export'
  | 'manifest'
  | 'lock'
  | 'test'
  | 'docs'
  | 'assets'

type IDeletePoint = {
  readonly file: string
  readonly absentPattern: string
  readonly replacement: string
}

type IPostSnapshotOutOfScopeClaim = {
  readonly path: string
  readonly owner: string
  readonly reason: string
}

type IRollbackConsumer = {
  readonly id: string
  readonly requires: readonly string[]
}

type ICompatibilityEdit = {
  readonly file: string
  readonly search: string
  readonly replacement: string
}

type ISemanticPatchUnit = {
  readonly id: string
  readonly rollback: boolean
  readonly canonicalOwners: readonly string[]
  readonly provides: readonly string[]
  readonly consumers: readonly IRollbackConsumer[]
  readonly exports: readonly string[]
  readonly dependencies: readonly string[]
  readonly tests: readonly string[]
  readonly assets: readonly string[]
  readonly compatibilityEdits?: readonly ICompatibilityEdit[]
  readonly categories: Readonly<Record<ISemanticCategory, readonly string[]>>
  readonly emptyCategoryReasons: Partial<Readonly<Record<ISemanticCategory, string>>>
  readonly deletePoints: readonly IDeletePoint[]
}

type IMigrationUnitLedger = {
  readonly schemaVersion: number
  readonly observationSnapshot: string
  readonly formatOnlyPaths: readonly string[]
  readonly postSnapshotOutOfScopeClaims: readonly IPostSnapshotOutOfScopeClaim[]
  readonly migrationUnits: readonly ISemanticPatchUnit[]
}

type IObservationMetadata = {
  readonly record: 'metadata'
  readonly baseCommit: string
  readonly scope: {
    readonly affectedPackages: readonly string[]
    readonly namedDirectConsumers: readonly string[]
    readonly rootPaths: readonly string[]
    readonly captureRule: string
  }
}

type IObservationPath = {
  readonly record: 'path'
  readonly path: string
  readonly contentSha256: string
  readonly owner: string
  readonly classification: 'pre-existing' | 'user-owned' | 'cycle-owned'
}

type IObservationFacts = {
  readonly metadata: IObservationMetadata
  readonly paths: ReadonlyMap<string, IObservationPath>
}

type IPatchCount = {
  readonly additions: number
  readonly deletions: number
}

type IChangeMeasurement = IPatchCount & {
  readonly rawChanged: boolean
  readonly formatOnly: boolean
}

type IOutOfScopePath = {
  readonly path: string
  readonly owner: string
  readonly classification:
    | IObservationPath['classification']
    | 'post-snapshot-reviewed'
    | 'external-scope'
  readonly reason?: string
}

type IReconciliation = {
  readonly currentInScopePaths: readonly string[]
  readonly outOfScopePaths: readonly IOutOfScopePath[]
  readonly semanticLocByUnit: ReadonlyMap<string, number>
  readonly semanticFilesByUnit: ReadonlyMap<string, number>
}

/** Repository root used for Git facts and formatter configuration. */
const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')
/** Direct formatter binary keeps T54 deterministic and offline. */
const formatter = resolve(repositoryRoot, 'node_modules', '.bin', 'oxfmt')
/** Exact semantic categories required by SWV2-D37 and SWV2-T54. */
const semanticCategories: readonly ISemanticCategory[] = [
  'owner',
  'adapter',
  'consumer',
  'export',
  'manifest',
  'lock',
  'test',
  'docs',
  'assets'
]
/** Categories whose post-observation semantic changes consume the B00 source/config budget. */
const budgetCategories = new Set<ISemanticCategory>([
  'owner',
  'adapter',
  'consumer',
  'export',
  'manifest',
  'lock'
])
/** C2-R3 ledger path, intentionally separate from the narrowed Cycle 1 capability map. */
const ledgerPath = resolve(import.meta.dirname, 'fixtures/storage-v2-c2-migration-units.json')

/** Immutable finite owner contract prevents coordinated fixture weakening. */
const expectedCanonicalOwners: Readonly<Record<string, readonly string[]>> = {
  'abort-timeout': ['@migaia/utils'],
  'byte-brand': ['@migaia/utils'],
  'event-fanout': ['@migaia/event-subscriber'],
  'live-ownership': ['@migaia/lifecycle', '@migaia/reactive']
}

/** Immutable finite path/category contract reviewed for C2-R3. */
const expectedPathContract = [
  'abort-timeout\0adapter\0packages/lifecycle/src/abort.ts',
  'abort-timeout\0adapter\0packages/storage-web/src/core/operation.ts',
  'abort-timeout\0assets\0packages/utils/test/packed-export-smoke.mjs',
  'abort-timeout\0docs\0packages/utils/README.md',
  'abort-timeout\0export\0packages/utils/src/index.ts',
  'abort-timeout\0lock\0pnpm-lock.yaml',
  'abort-timeout\0manifest\0packages/utils/package.json',
  'abort-timeout\0owner\0packages/utils/src/promise.ts',
  'abort-timeout\0test\0packages/storage-web/test/utils/abort.spec.ts',
  'abort-timeout\0test\0packages/utils/test/promise.test.ts',
  'byte-brand\0adapter\0packages/storage-contract/src/bytes.ts',
  'byte-brand\0assets\0packages/storage-web/e2e/byte-brand.spec.ts',
  'byte-brand\0consumer\0packages/storage-web/src/core/bytes.ts',
  'byte-brand\0consumer\0packages/store-worker/e2e/worker.ts',
  'byte-brand\0docs\0packages/utils/README.md',
  'byte-brand\0export\0packages/utils/src/index.ts',
  'byte-brand\0lock\0pnpm-lock.yaml',
  'byte-brand\0manifest\0packages/storage-contract/package.json',
  'byte-brand\0manifest\0packages/utils/package.json',
  'byte-brand\0owner\0packages/utils/src/bytes.ts',
  'byte-brand\0test\0packages/utils/test/bytes.test.ts',
  'event-fanout\0adapter\0packages/storage-web/src/backends/indexed-db.ts',
  'event-fanout\0adapter\0packages/storage-web/src/backends/memory.ts',
  'event-fanout\0consumer\0packages/store-light/src/store-resource.ts',
  'event-fanout\0consumer\0packages/web-rpc/src/internal/hooks.ts',
  'event-fanout\0docs\0packages/event-subscriber/README.md',
  'event-fanout\0export\0packages/event-subscriber/src/index.ts',
  'event-fanout\0lock\0pnpm-lock.yaml',
  'event-fanout\0manifest\0packages/event-subscriber/package.json',
  'event-fanout\0owner\0packages/event-subscriber/src/channel.ts',
  'event-fanout\0owner\0packages/event-subscriber/src/state-constants.ts',
  'event-fanout\0owner\0packages/event-subscriber/src/types.ts',
  'event-fanout\0test\0packages/event-subscriber/test/storage-v2-b00-red.spec.ts',
  'event-fanout\0test\0packages/store-light/test/storage-v2-t53-event-trace.test.ts',
  'event-fanout\0test\0packages/web-rpc/test/storage-v2-t53-event-trace.test.ts',
  'live-ownership\0lock\0pnpm-lock.yaml',
  'live-ownership\0manifest\0packages/lifecycle/package.json',
  'live-ownership\0manifest\0packages/reactive/package.json',
  'live-ownership\0owner\0packages/lifecycle/src/generation-controller.ts',
  'live-ownership\0owner\0packages/reactive/src/index.ts',
  'live-ownership\0test\0packages/storage-web/test/reactive-ownership-model.spec.ts'
].sort()

/** Immutable delete-to-replacement contract prevents mapping deletion or retargeting. */
const expectedDeleteContract = [
  'abort-timeout\0packages/storage-web/src/core/operation.ts\0const storageTimeoutController = new AbortController\0packages/utils/src/promise.ts',
  'byte-brand\0packages/storage-contract/src/bytes.ts\0value instanceof Uint8Array\0packages/utils/src/bytes.ts',
  'event-fanout\0packages/storage-web/src/backends/memory.ts\0const storageListeners = new Set\0packages/event-subscriber/src/channel.ts'
].sort()

/** Exact multi-unit ownership for genuinely shared release surfaces. */
const expectedSharedPathClaims: Readonly<Record<string, readonly string[]>> = {
  'packages/utils/README.md': ['abort-timeout', 'byte-brand'],
  'packages/utils/package.json': ['abort-timeout', 'byte-brand'],
  'packages/utils/src/index.ts': ['abort-timeout', 'byte-brand'],
  'pnpm-lock.yaml': ['abort-timeout', 'byte-brand', 'event-fanout', 'live-ownership']
}

/** Immutable package and root scope captured by C2-R1 metadata. */
const expectedObservationScope = {
  affectedPackages: [
    '@migaia/event-subscriber',
    '@migaia/lifecycle',
    '@migaia/reactive',
    '@migaia/serialize',
    '@migaia/storage-contract',
    '@migaia/storage-web',
    '@migaia/store-persist',
    '@migaia/store-worker',
    '@migaia/utils'
  ],
  namedDirectConsumers: ['@migaia/store-light', '@migaia/web-rpc'],
  rootPaths: ['Makefile', 'package.json', 'pnpm-lock.yaml'],
  captureRule:
    'all tracked-modified, tracked-staged, and untracked files observed under affected packages, named direct consumers, and named root paths; the snapshot file excludes itself'
} as const

/** Static path roots corresponding to the immutable package names above. */
const expectedScopedPackageRoots = [
  'packages/event-subscriber/',
  'packages/lifecycle/',
  'packages/reactive/',
  'packages/serialize/',
  'packages/storage-contract/',
  'packages/storage-web/',
  'packages/store-light/',
  'packages/store-persist/',
  'packages/store-worker/',
  'packages/utils/',
  'packages/web-rpc/'
] as const

/** Exact reviewed exceptions for paths created after the immutable observation. */
const expectedPostSnapshotClaims: readonly IPostSnapshotOutOfScopeClaim[] = [
  {
    path: 'Makefile',
    owner: 'repository-tooling',
    reason:
      'C2-R4 D18 release orchestration hardening created after the immutable C2-R1 capture; it is host/release acceptance evidence, not a B00 migration-unit semantic patch.'
  },
  {
    path: 'packages/storage-web/test/fixtures/storage-v2-bounded-capability-catalog.json',
    owner: 'repository-tooling',
    reason:
      'C2-R2 bounded T44 catalog created after the immutable C2-R1 capture; it is architecture-gate evidence, not a migration-unit semantic patch.'
  },
  {
    path: 'packages/storage-web/test/fixtures/storage-v2-bounded-t44-hostile.json',
    owner: 'repository-tooling',
    reason:
      'C2-R2 bounded T44 hostile fixture created after the immutable C2-R1 capture; it is architecture-gate evidence, not a migration-unit semantic patch.'
  },
  {
    path: 'packages/storage-web/test/fixtures/storage-v2-c2-migration-units.json',
    owner: 'repository-tooling',
    reason:
      'C2-R3 executable migration ledger created after the immutable C2-R1 capture and sealed by the T54 source contract.'
  },
  {
    path: 'packages/storage-web/test/fixtures/storage-v2-c2-observation-snapshot.jsonl',
    owner: 'repository-tooling',
    reason:
      'The immutable C2-R1 snapshot excludes its own path by capture rule and is sealed independently by the snapshot validator.'
  },
  {
    path: 'packages/web-rpc/src/internal/composed-disposal-observer.ts',
    owner: '@migaia/web-rpc',
    reason:
      'Concurrent user-owned direct-consumer work created after C2-R1; unrelated to storage-v2 C2-R3 and excluded from every migration numerator.'
  },
  {
    path: 'packages/web-rpc/test/packed-d95-boundary.mjs',
    owner: '@migaia/web-rpc',
    reason:
      'Concurrent WebRPC Cycle H D95/T222 packed source-dist-export and two-copy boundary work created after C2-R1; it is owned by the active WebRPC continuation SDD, unrelated to storage-v2 C2-R3, and excluded from every migration numerator.'
  },
  {
    path: 'packages/web-rpc/test/packed-provider-authority.mjs',
    owner: '@migaia/web-rpc',
    reason:
      'Concurrent user-owned direct-consumer test work created after C2-R1; unrelated to storage-v2 C2-R3 and excluded from every migration numerator.'
  }
]

/** Full immutable projection consumed by the T52 rollback rehearsal. */
const expectedRollbackProjection = {
  'abort-timeout': {
    rollback: true,
    provides: ['utils.abort-timeout-signal'],
    consumers: [
      { id: 'storage.operation-signal-adapter', requires: ['utils.abort-timeout-signal'] }
    ],
    exports: ['@migaia/utils.createAbortTimeoutSignal'],
    dependencies: [],
    tests: ['SWV2-T47', 'SWV2-T48', 'SWV2-T49'],
    assets: [
      'storage.operation-signal-adapter',
      'utils.abort-timeout-signal-runtime',
      'utils.promise-packed-smoke'
    ],
    compatibilityEdits: []
  },
  'byte-brand': {
    rollback: false,
    provides: ['utils.byte-brand'],
    consumers: [],
    exports: ['@migaia/utils.isArrayBuffer', '@migaia/utils.isUint8Array'],
    dependencies: [],
    tests: ['SWV2-T55', 'SWV2-T56', 'SWV2-T57', 'SWV2-T58'],
    assets: ['storage-web.byte-brand-browser', 'utils.byte-brand-runtime'],
    compatibilityEdits: []
  },
  'event-fanout': {
    rollback: true,
    provides: ['event.dispatch-policy'],
    consumers: [
      { id: 'storage.indexed-db.queued-feed', requires: ['event.dispatch-policy'] },
      { id: 'storage.memory.queued-feed', requires: ['event.dispatch-policy'] }
    ],
    exports: ['@migaia/event-subscriber.EventDispatchPolicy'],
    dependencies: [],
    tests: ['SWV2-T45', 'SWV2-T46', 'SWV2-T53'],
    assets: [
      'event.dispatch-policy-contract',
      'event.queued-runtime',
      'storage.queued-feed-adapters'
    ],
    compatibilityEdits: [
      {
        file: 'packages/storage-web/src/backends/indexed-db.ts',
        search: '  iteration: true,\n  maxValueBytes: undefined,',
        replacement:
          '  iteration: true,\n  secondaryIndexes: false,\n  changeFeed: false,\n  maxValueBytes: undefined,'
      },
      {
        file: 'packages/storage-web/src/backends/memory.ts',
        search: '  iteration: true,\n  maxValueBytes: undefined,',
        replacement:
          '  iteration: true,\n  secondaryIndexes: false,\n  changeFeed: false,\n  maxValueBytes: undefined,'
      }
    ]
  },
  'live-ownership': {
    rollback: true,
    provides: ['storage.live-ownership-blueprint'],
    consumers: [
      {
        id: 'storage.live-ownership-blueprint',
        requires: [
          'event.channel',
          'lifecycle.generation',
          'lifecycle.sync-scope',
          'reactive.scheduler',
          'reactive.signal'
        ]
      }
    ],
    exports: [],
    dependencies: ['@migaia/storage-web -> @migaia/lifecycle'],
    tests: ['SWV2-T50'],
    assets: [
      'storage.lifecycle-build-external',
      'storage.lifecycle-dependency-edge',
      'storage.live-ownership-model'
    ],
    compatibilityEdits: []
  }
} as const

/** Reads the reviewed migration-unit ledger. */
const readLedger = (): IMigrationUnitLedger =>
  JSON.parse(readFileSync(ledgerPath, 'utf8')) as IMigrationUnitLedger

/** Reads immutable metadata and per-path facts without altering the Cycle 2 snapshot. */
const readObservationFacts = (relativePath: string): IObservationFacts => {
  const records = readFileSync(resolve(repositoryRoot, relativePath), 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as IObservationMetadata | IObservationPath | { record: string })
  const metadata = records.find(
    (record): record is IObservationMetadata => record.record === 'metadata'
  )
  if (metadata === undefined) throw new Error('C2 observation metadata missing')
  const paths = new Map(
    records
      .filter((record): record is IObservationPath => record.record === 'path')
      .map((record) => [record.path, record])
  )
  return { metadata, paths }
}

/** Returns a stable content hash for exact per-path reconciliation. */
const hash = (content: string | Buffer): string =>
  createHash('sha256').update(content).digest('hex')

/** Formats one source in an isolated directory without changing the workspace. */
const normalizeSource = (source: string, fileName: string): string => {
  const directory = mkdtempSync(resolve(tmpdir(), 'migai-t54-format-'))
  const target = resolve(directory, basename(fileName))
  try {
    writeFileSync(target, source, 'utf8')
    execFileSync(formatter, [target], { cwd: repositoryRoot, stdio: 'pipe' })
    return readFileSync(target, 'utf8')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** Counts one no-index diff while accepting Git's expected changed-file status. */
const diffCount = (fileName: string, baseline: string, current: string): IPatchCount => {
  const directory = mkdtempSync(resolve(tmpdir(), 'migai-t54-diff-'))
  const baselinePath = resolve(directory, `baseline-${basename(fileName)}`)
  const currentPath = resolve(directory, `current-${basename(fileName)}`)
  try {
    writeFileSync(baselinePath, baseline, 'utf8')
    writeFileSync(currentPath, current, 'utf8')
    let output = ''
    try {
      output = execFileSync('git', ['diff', '--no-index', '--numstat', baselinePath, currentPath], {
        cwd: repositoryRoot,
        encoding: 'utf8'
      })
    } catch (error) {
      const failed = error as { readonly status?: number; readonly stdout?: string | Buffer }
      if (failed.status !== 1) throw error
      output = typeof failed.stdout === 'string' ? failed.stdout : (failed.stdout?.toString() ?? '')
    }
    if (output.trim() === '') return { additions: 0, deletions: 0 }
    const [additions, deletions] = output.trim().split(/\s+/)
    return { additions: Number(additions), deletions: Number(deletions) }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** Separates formatter-only churn from normalized semantic LOC. */
const measureTextChange = (
  fileName: string,
  baseline: string,
  current: string
): IChangeMeasurement => {
  const raw = diffCount(fileName, baseline, current)
  const semantic = diffCount(
    fileName,
    normalizeSource(baseline, fileName),
    normalizeSource(current, fileName)
  )
  return {
    ...semantic,
    rawChanged: raw.additions + raw.deletions > 0,
    formatOnly: raw.additions + raw.deletions > 0 && semantic.additions + semantic.deletions === 0
  }
}

/** Rejects semantic drift and requires explicit recording for formatter-only churn. */
const assertReviewedTextChange = (
  fileName: string,
  baseline: string,
  current: string,
  formatOnlyPaths: readonly string[]
): IChangeMeasurement => {
  const measurement = measureTextChange(fileName, baseline, current)
  if (!measurement.rawChanged) return measurement
  if (measurement.formatOnly) {
    if (!formatOnlyPaths.includes(fileName))
      throw new Error(`unrecorded formatter-only path: ${fileName}`)
    return measurement
  }
  if (formatOnlyPaths.includes(fileName))
    throw new Error(`semantic change mislabeled formatter-only: ${fileName}`)
  throw new Error(`unreviewed semantic path: ${fileName}`)
}

/** Returns all paths changed from the approved base, including untracked paths. */
const readChangedPaths = (baseCommit: string): readonly string[] => {
  const tracked = execFileSync('git', ['diff', '--name-only', baseCommit, '--'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
    .split('\n')
    .filter(Boolean)
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
    .split('\n')
    .filter(Boolean)
  return [...new Set([...tracked, ...untracked])].sort()
}

/** Reports whether a path is inside the immutable affected/direct-consumer/root scope. */
const isObservationScopedPath = (fileName: string, metadata: IObservationMetadata): boolean =>
  metadata.scope.rootPaths.includes(fileName) ||
  expectedScopedPackageRoots.some((root) => fileName.startsWith(root))

/** Resolves immutable drift facts without allowing a new scoped path to self-exempt. */
const outOfScopeFactForPath = (
  fileName: string,
  observations: ReadonlyMap<string, IObservationPath>,
  claims: ReadonlyMap<string, IPostSnapshotOutOfScopeClaim>,
  metadata: IObservationMetadata
): IOutOfScopePath => {
  const observed = observations.get(fileName)
  if (observed !== undefined)
    return {
      path: fileName,
      owner: observed.owner,
      classification: observed.classification
    }
  const claim = claims.get(fileName)
  if (claim !== undefined)
    return {
      path: fileName,
      owner: claim.owner,
      classification: 'post-snapshot-reviewed',
      reason: claim.reason
    }
  if (isObservationScopedPath(fileName, metadata))
    throw new Error(`unreviewed post-snapshot scoped path: ${fileName}`)
  const segments = fileName.split('/')
  const ownerRoot = segments[0] === 'packages' ? segments.slice(0, 2).join('/') : segments[0]!
  return {
    path: fileName,
    owner:
      !fileName.includes('/') || fileName.startsWith('scripts/')
        ? 'repository-tooling'
        : `external-scope:${ownerRoot}`,
    classification: 'external-scope'
  }
}

/** Normalizes one unit's path/category rows without hiding duplicates. */
const pathContract = (units: readonly ISemanticPatchUnit[]): readonly string[] =>
  units
    .flatMap((unit) =>
      semanticCategories.flatMap((category) =>
        (unit.categories[category] ?? []).map((fileName) => `${unit.id}\0${category}\0${fileName}`)
      )
    )
    .sort()

/** Normalizes delete mappings while retaining every exact mapping field. */
const deleteContract = (units: readonly ISemanticPatchUnit[]): readonly string[] =>
  units
    .flatMap((unit) =>
      unit.deletePoints.map(
        (point) => `${unit.id}\0${point.file}\0${point.absentPattern}\0${point.replacement}`
      )
    )
    .sort()

/** Normalizes every T52 projection field so fixture order cannot hide drift. */
const rollbackProjection = (
  units: readonly ISemanticPatchUnit[]
): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    units
      .map(
        (unit) =>
          [
            unit.id,
            {
              rollback: unit.rollback,
              provides: [...unit.provides].sort(),
              consumers: unit.consumers
                .map((consumer) => ({ id: consumer.id, requires: [...consumer.requires].sort() }))
                .sort((left, right) => left.id.localeCompare(right.id)),
              exports: [...unit.exports].sort(),
              dependencies: [...unit.dependencies].sort(),
              tests: [...unit.tests].sort(),
              assets: [...unit.assets].sort(),
              compatibilityEdits: [...(unit.compatibilityEdits ?? [])].sort((left, right) =>
                `${left.file}\0${left.search}\0${left.replacement}`.localeCompare(
                  `${right.file}\0${right.search}\0${right.replacement}`
                )
              )
            }
          ] as const
      )
      .sort(([left], [right]) => left.localeCompare(right))
  )

/** Fails closed on owner, path, category, duplicate, and delete-mapping drift. */
const assertExactLedgerContract = (ledger: IMigrationUnitLedger): void => {
  expect(ledger.schemaVersion).toBe(1)
  expect(ledger.observationSnapshot).toBe(
    'packages/storage-web/test/fixtures/storage-v2-c2-observation-snapshot.jsonl'
  )
  expect(ledger.formatOnlyPaths).toEqual([])
  expect(ledger.postSnapshotOutOfScopeClaims).toEqual(expectedPostSnapshotClaims)
  expect(new Set(ledger.postSnapshotOutOfScopeClaims.map((claim) => claim.path)).size).toBe(
    expectedPostSnapshotClaims.length
  )
  expect(
    ledger.postSnapshotOutOfScopeClaims.every(
      (claim) => claim.owner.length > 0 && claim.reason.length > 0
    )
  ).toBe(true)
  expect(
    Object.fromEntries(
      ledger.migrationUnits
        .map((unit) => [unit.id, [...unit.canonicalOwners].sort()] as const)
        .sort(([left], [right]) => left.localeCompare(right))
    )
  ).toEqual(expectedCanonicalOwners)
  expect(pathContract(ledger.migrationUnits)).toEqual(expectedPathContract)
  expect(new Set(pathContract(ledger.migrationUnits)).size).toBe(expectedPathContract.length)
  expect(deleteContract(ledger.migrationUnits)).toEqual(expectedDeleteContract)
  expect(rollbackProjection(ledger.migrationUnits)).toEqual(expectedRollbackProjection)

  const claimsByPath = new Map<string, Set<string>>()
  for (const unit of ledger.migrationUnits)
    for (const fileName of semanticCategories.flatMap((category) => unit.categories[category])) {
      const claims = claimsByPath.get(fileName) ?? new Set<string>()
      claims.add(unit.id)
      claimsByPath.set(fileName, claims)
    }
  const sharedClaims = Object.fromEntries(
    [...claimsByPath]
      .filter(([, claims]) => claims.size > 1)
      .map(([fileName, claims]) => [fileName, [...claims].sort()])
  )
  expect(sharedClaims).toEqual(expectedSharedPathClaims)

  for (const unit of ledger.migrationUnits) {
    expect(Object.keys(unit.categories).sort(), unit.id).toEqual([...semanticCategories].sort())
    for (const category of semanticCategories) {
      const paths = unit.categories[category]
      if (paths.length === 0)
        expect(
          unit.emptyCategoryReasons[category]?.length,
          `${unit.id}:${category}`
        ).toBeGreaterThan(0)
      else expect(unit.emptyCategoryReasons[category], `${unit.id}:${category}`).toBeUndefined()
      for (const fileName of paths)
        expect(existsSync(resolve(repositoryRoot, fileName)), fileName).toBe(true)
    }
    const ownedPaths = new Set(unit.categories.owner)
    for (const point of unit.deletePoints) {
      expect(unit.categories.adapter, `${unit.id}:${point.file}`).toContain(point.file)
      expect(ownedPaths, `${unit.id}:${point.replacement}`).toContain(point.replacement)
      expect(readFileSync(resolve(repositoryRoot, point.file), 'utf8')).not.toContain(
        point.absentPattern
      )
    }
  }
}

/** Reads a tracked baseline path or reports that the base commit did not contain it. */
const readBaseSource = (baseCommit: string, fileName: string): string | undefined => {
  try {
    return execFileSync('git', ['show', `${baseCommit}:${fileName}`], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch {
    return undefined
  }
}

/** Reconciles every unit path to immutable observation facts and isolates all other drift. */
const reconcileWorkspace = (
  ledger: IMigrationUnitLedger,
  changedPathsOverride?: readonly string[]
): IReconciliation => {
  assertExactLedgerContract(ledger)
  const observation = readObservationFacts(ledger.observationSnapshot)
  const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  }).trim()
  expect(currentCommit, 'Cycle 2 base commit drifted').toBe(observation.metadata.baseCommit)
  expect(observation.metadata.scope).toEqual(expectedObservationScope)

  const claims = new Map(
    ledger.postSnapshotOutOfScopeClaims.map((claim) => [claim.path, claim] as const)
  )
  const inScopePaths = new Set(
    ledger.migrationUnits.flatMap((unit) =>
      semanticCategories.flatMap((category) => unit.categories[category])
    )
  )
  const changedPaths = [
    ...new Set(changedPathsOverride ?? readChangedPaths(observation.metadata.baseCommit))
  ].sort()
  const currentInScopePaths = changedPaths.filter((fileName) => inScopePaths.has(fileName))
  const outOfScopePaths = changedPaths
    .filter((fileName) => !inScopePaths.has(fileName))
    .map((fileName) =>
      outOfScopeFactForPath(fileName, observation.paths, claims, observation.metadata)
    )
  expect(new Set(currentInScopePaths).size).toBe(currentInScopePaths.length)
  expect(new Set(outOfScopePaths.map((entry) => entry.path)).size).toBe(outOfScopePaths.length)
  expect(outOfScopePaths.every((entry) => entry.owner.length > 0)).toBe(true)

  const semanticLocByUnit = new Map<string, number>()
  const semanticFilesByUnit = new Map<string, number>()
  for (const unit of ledger.migrationUnits) {
    let semanticLoc = 0
    let semanticFiles = 0
    for (const category of semanticCategories) {
      for (const fileName of unit.categories[category]) {
        const current = readFileSync(resolve(repositoryRoot, fileName))
        const observed = observation.paths.get(fileName)
        const baseSource = readBaseSource(observation.metadata.baseCommit, fileName)
        const baselineHash =
          observed?.contentSha256 ?? (baseSource === undefined ? undefined : hash(baseSource))
        expect(baselineHash, `${fileName}: no observation or clean base fact`).toBeDefined()
        const currentHash = hash(current)
        if (currentHash !== baselineHash) {
          if (baseSource === undefined || hash(baseSource) !== baselineHash)
            throw new Error(`unreviewed in-scope drift lacks snapshot source: ${fileName}`)
          const measurement = measureTextChange(fileName, baseSource, current.toString())
          if (measurement.formatOnly) {
            if (!ledger.formatOnlyPaths.includes(fileName))
              throw new Error(`unrecorded formatter-only path: ${fileName}`)
          } else if (measurement.additions + measurement.deletions > 0) {
            if (budgetCategories.has(category)) {
              semanticLoc += measurement.additions + measurement.deletions
              semanticFiles += 1
            }
          }
        }
        if (category === 'owner') {
          const pathOwner = outOfScopeFactForPath(
            fileName,
            observation.paths,
            claims,
            observation.metadata
          ).owner
          expect(unit.canonicalOwners, `${unit.id}:${fileName}: canonical owner`).toContain(
            pathOwner
          )
        }
      }
    }
    semanticLocByUnit.set(unit.id, semanticLoc)
    semanticFilesByUnit.set(unit.id, semanticFiles)
  }

  return { currentInScopePaths, outOfScopePaths, semanticLocByUnit, semanticFilesByUnit }
}

/** Deep-clones the JSON ledger for hostile mutations. */
const cloneLedger = (ledger: IMigrationUnitLedger): IMigrationUnitLedger =>
  JSON.parse(JSON.stringify(ledger)) as IMigrationUnitLedger

describe('SWV2-T54 scoped semantic patch reconciliation', () => {
  it('reconciles exact unit paths and names owned out-of-scope drift without changing numerator', () => {
    const ledger = readLedger()
    assertExactLedgerContract(ledger)
    const result = reconcileWorkspace(ledger)
    expect(result.currentInScopePaths.length).toBeGreaterThan(0)
    expect(result.outOfScopePaths.length).toBeGreaterThan(0)
    expect(result.outOfScopePaths.every((entry) => entry.owner.length > 0)).toBe(true)
    expect(result.outOfScopePaths.every((entry) => entry.classification.length > 0)).toBe(true)
    expect(
      result.outOfScopePaths
        .filter((entry) => entry.classification === 'post-snapshot-reviewed')
        .map(({ path, owner, reason }) => ({ path, owner, reason }))
    ).toEqual(expectedPostSnapshotClaims)
  })

  it('fails before budget measurement for a new real adapter path inside captured scope', () => {
    expect(() =>
      reconcileWorkspace(readLedger(), [
        'packages/storage-web/src/backends/sol-t54-event-adapter.ts'
      ])
    ).toThrow(
      'unreviewed post-snapshot scoped path: packages/storage-web/src/backends/sol-t54-event-adapter.ts'
    )
  })

  it('keeps every post-observation production/config semantic patch inside B00 budgets', () => {
    const result = reconcileWorkspace(readLedger())
    for (const [unitId, semanticLoc] of result.semanticLocByUnit)
      expect(semanticLoc, `${unitId}: semantic LOC`).toBeLessThanOrEqual(150)
    for (const [unitId, semanticFiles] of result.semanticFilesByUnit)
      expect(semanticFiles, `${unitId}: changed source/config files`).toBeLessThanOrEqual(5)
  })

  it('fails closed when a real storage adapter mapping is removed or semantically changed', () => {
    const ledger = cloneLedger(readLedger())
    const eventUnit = ledger.migrationUnits.find((unit) => unit.id === 'event-fanout')!
    const adapterPath = 'packages/storage-web/src/backends/memory.ts'
    const corruptedLedger = {
      ...ledger,
      migrationUnits: ledger.migrationUnits.map((unit) =>
        unit === eventUnit
          ? {
              ...unit,
              categories: {
                ...unit.categories,
                adapter: unit.categories.adapter.filter((fileName) => fileName !== adapterPath)
              }
            }
          : unit
      )
    }
    expect(() => assertExactLedgerContract(corruptedLedger)).toThrow()

    const source = readFileSync(resolve(repositoryRoot, adapterPath), 'utf8')
    const corrupted = source.replace(
      '  changeFeed: true,\n  maxValueBytes: undefined,',
      '  changeFeed: false,\n  maxValueBytes: undefined,'
    )
    expect(corrupted).not.toBe(source)
    expect(() => assertReviewedTextChange(adapterPath, source, corrupted, [])).toThrow(
      `unreviewed semantic path: ${adapterPath}`
    )
  })

  it('fails closed when the real owner manifest mapping or content is corrupted', () => {
    const ledger = cloneLedger(readLedger())
    const eventUnit = ledger.migrationUnits.find((unit) => unit.id === 'event-fanout')!
    const manifestPath = 'packages/event-subscriber/package.json'
    const corruptedLedger = {
      ...ledger,
      migrationUnits: ledger.migrationUnits.map((unit) =>
        unit === eventUnit ? { ...unit, categories: { ...unit.categories, manifest: [] } } : unit
      )
    }
    expect(() => assertExactLedgerContract(corruptedLedger)).toThrow()

    const source = readFileSync(resolve(repositoryRoot, manifestPath), 'utf8')
    const manifest = JSON.parse(source) as Record<string, unknown>
    manifest['sol-hostile'] = true
    const corrupted = `${JSON.stringify(manifest, null, 2)}\n`
    expect(() => assertReviewedTextChange(manifestPath, source, corrupted, [])).toThrow(
      `unreviewed semantic path: ${manifestPath}`
    )
  })

  it('fails closed when a real delete-to-replacement mapping is removed', () => {
    const ledger = cloneLedger(readLedger())
    const abortUnit = ledger.migrationUnits.find((unit) => unit.id === 'abort-timeout')!
    const corruptedLedger = {
      ...ledger,
      migrationUnits: ledger.migrationUnits.map((unit) =>
        unit === abortUnit ? { ...unit, deletePoints: [] } : unit
      )
    }
    expect(() => assertExactLedgerContract(corruptedLedger)).toThrow()
  })

  it('fails closed when canonical owner authority is reassigned', () => {
    const ledger = cloneLedger(readLedger())
    const byteUnit = ledger.migrationUnits.find((unit) => unit.id === 'byte-brand')!
    const corruptedLedger = {
      ...ledger,
      migrationUnits: ledger.migrationUnits.map((unit) =>
        unit === byteUnit ? { ...unit, canonicalOwners: ['@migaia/storage-web'] } : unit
      )
    }
    expect(() => assertExactLedgerContract(corruptedLedger)).toThrow()
  })

  it('seals every T52 rollback projection class and rollback participation flag', () => {
    const ledger = readLedger()
    const corrupt = (
      unitId: string,
      change: (unit: ISemanticPatchUnit) => ISemanticPatchUnit
    ): IMigrationUnitLedger => ({
      ...ledger,
      migrationUnits: ledger.migrationUnits.map((unit) =>
        unit.id === unitId ? change(unit) : unit
      )
    })
    const hostileLedgers: readonly IMigrationUnitLedger[] = [
      corrupt('live-ownership', (unit) => ({ ...unit, rollback: false })),
      corrupt('event-fanout', (unit) => ({ ...unit, provides: [] })),
      corrupt('event-fanout', (unit) => ({ ...unit, consumers: [] })),
      corrupt('event-fanout', (unit) => ({ ...unit, exports: [] })),
      corrupt('live-ownership', (unit) => ({ ...unit, dependencies: [] })),
      corrupt('live-ownership', (unit) => ({ ...unit, tests: [] })),
      corrupt('live-ownership', (unit) => ({ ...unit, assets: [] })),
      corrupt('event-fanout', (unit) => ({ ...unit, compatibilityEdits: [] }))
    ]
    for (const hostileLedger of hostileLedgers)
      expect(() => assertExactLedgerContract(hostileLedger)).toThrow()
  })

  it('records and excludes formatter-only full-file churn from semantic LOC', () => {
    const fileName = 'packages/event-subscriber/src/channel.ts'
    const source = readFileSync(resolve(repositoryRoot, fileName), 'utf8')
    const formattedNoise = source.replaceAll('\n', '\r\n')
    expect(() => assertReviewedTextChange(fileName, source, formattedNoise, [])).toThrow(
      `unrecorded formatter-only path: ${fileName}`
    )
    const measurement = assertReviewedTextChange(fileName, source, formattedNoise, [fileName])
    expect(measurement.rawChanged).toBe(true)
    expect(measurement.formatOnly).toBe(true)
    expect(measurement.additions + measurement.deletions).toBe(0)
    expect(readLedger().formatOnlyPaths).not.toContain(fileName)
    const semanticNoise = source.replace('export ', 'export const solHostile = true\nexport ')
    expect(() => assertReviewedTextChange(fileName, source, semanticNoise, [fileName])).toThrow(
      `semantic change mislabeled formatter-only: ${fileName}`
    )
  })
})

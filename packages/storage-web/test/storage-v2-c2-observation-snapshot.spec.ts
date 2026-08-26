import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type IObservationPath = {
  readonly path: string
  readonly trackedStatus: 'tracked-modified' | 'tracked-staged' | 'untracked'
  readonly contentSha256: string
  readonly bytes: number
  readonly owner: string
  readonly classification: 'pre-existing' | 'user-owned' | 'cycle-owned'
  readonly origin:
    | 'cycle1-implementation'
    | 'cycle1-prototype'
    | 'concurrent-user-work'
    | 'cycle2-round1'
  readonly postCaptureDisposition?: 'deleted'
}

type IDispositionFieldSlice = {
  readonly path: string
  readonly topLevelFields: readonly string[]
}

type IPrototypeDisposition = {
  readonly id: string
  readonly disposition: 'keep' | 'narrow' | 'rework' | 'revert'
  readonly owner: string
  readonly paths: readonly string[]
  readonly fieldSlices?: readonly IDispositionFieldSlice[]
  readonly replacementOwner: string
  readonly deleteCondition: string
  readonly tests: readonly string[]
}

type IObservationSnapshot = {
  readonly schemaVersion: number
  readonly cycle: 'post-reset-cycle-2'
  readonly round: 1
  readonly approvedAt: string
  readonly approval: string
  readonly baseCommit: string
  readonly workspaceState: 'dirty'
  readonly classificationCorrection: {
    readonly round: 2
    readonly correctedAt: string
    readonly finding: 'SOL-SWV2-072'
    readonly scope: string
  }
  readonly representationCorrection: {
    readonly round: 3
    readonly correctedAt: string
    readonly finding: 'SOL-SWV2-074'
    readonly format: 'canonical-jsonl'
    readonly scope: string
  }
  readonly selfPath: string
  readonly snapshotSha256: string
  readonly scope: {
    readonly affectedPackages: readonly string[]
    readonly namedDirectConsumers: readonly string[]
    readonly rootPaths: readonly string[]
    readonly captureRule: string
  }
  readonly prototypeDispositions: readonly IPrototypeDisposition[]
  readonly paths: readonly IObservationPath[]
}

type IObservationMetadataRecord = Omit<IObservationSnapshot, 'prototypeDispositions' | 'paths'> & {
  readonly record: 'metadata'
}

type IObservationDispositionRecord = IPrototypeDisposition & {
  readonly record: 'prototypeDisposition'
}

type IObservationPathRecord = IObservationPath & {
  readonly record: 'path'
}

type IObservationRecord =
  | IObservationMetadataRecord
  | IObservationDispositionRecord
  | IObservationPathRecord

/** Repository root used to verify immutable Cycle 2-owned observation rows. */
const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')

/** Frozen Cycle 2 Round 1 observation snapshot required by SWV2-D43. */
const snapshotPath = resolve(
  import.meta.dirname,
  'fixtures/storage-v2-c2-observation-snapshot.jsonl'
)

/** Canonical JSONL source retained for line-level deterministic-format assertions. */
const snapshotSource = readFileSync(snapshotPath, 'utf8')

/** Non-empty canonical JSONL rows in their required metadata/disposition/path order. */
const snapshotLines = snapshotSource.trimEnd().split('\n')

/** Parsed records used to reconstruct the logical immutable snapshot. */
const snapshotRecords = snapshotLines.map((line) => JSON.parse(line) as IObservationRecord)

/** Exact schema-3 row count: one metadata, five dispositions, and 609 captured paths. */
const expectedSnapshotRecordCount = 615

/** Fails closed unless every JSONL row belongs to the exact ordered schema-3 phases. */
const assertSnapshotRecordLayout = (records: readonly IObservationRecord[]): void => {
  expect(records).toHaveLength(expectedSnapshotRecordCount)
  /** Required record kind for each exact schema-3 row position. */
  const expectedKinds = records.map((_record, index) =>
    index === 0 ? 'metadata' : index <= 5 ? 'prototypeDisposition' : 'path'
  )
  /** Actual discriminators retained without filtering unknown record kinds away. */
  const actualKinds = records.map((record) => (record as { readonly record?: unknown }).record)
  expect(actualKinds).toEqual(expectedKinds)
}

assertSnapshotRecordLayout(snapshotRecords)

/** Unique metadata record containing all non-repeating snapshot fields. */
const snapshotMetadata = snapshotRecords.find(
  (record): record is IObservationMetadataRecord => record.record === 'metadata'
)!

/** Parsed snapshot under structural and content-integrity review. */
const snapshot: IObservationSnapshot = {
  ...snapshotMetadata,
  prototypeDispositions: snapshotRecords
    .filter(
      (record): record is IObservationDispositionRecord => record.record === 'prototypeDisposition'
    )
    .map(({ record: _record, ...entry }) => entry),
  paths: snapshotRecords
    .filter((record): record is IObservationPathRecord => record.record === 'path')
    .map(({ record: _record, ...entry }) => entry)
}

/** Cycle 1 map whose catalog and semantic-budget fields have separate dispositions. */
const capabilityMapRelativePath =
  'packages/event-subscriber/test/fixtures/storage-v2-b00-capability-map.json'

/** Current narrowed rollback-map fields retained after the C2-R2/R3 dispositions. */
const capabilityMapFields = Object.keys(
  JSON.parse(readFileSync(resolve(repositoryRoot, capabilityMapRelativePath), 'utf8')) as Record<
    string,
    unknown
  >
).sort()

/** Exact post-disposition map surface; aggregate-baseline and T44 fields must stay removed. */
const expectedNarrowedCapabilityMapFields = [
  'capabilityFlags',
  'directGates',
  'retiredArtifacts',
  'schemaVersion',
  'sharedProviders',
  'v1Gates'
]

/** Fixed D46 field owners; exhaustive union alone cannot detect semantic owner swaps. */
const expectedFieldSlicesByDisposition: Readonly<
  Record<string, readonly IDispositionFieldSlice[]>
> = {
  'cycle1-shared-capability-map': [
    {
      path: capabilityMapRelativePath,
      topLevelFields: [
        'candidateDefinitions',
        'capabilities',
        'capabilityFlags',
        'directGates',
        'inventoryFiles',
        'nonCapabilityEdges',
        'packages',
        'retiredArtifacts',
        'schemaVersion',
        'sharedProviders',
        'v1Gates'
      ]
    }
  ],
  'cycle1-aggregate-semantic-digest': [
    {
      path: capabilityMapRelativePath,
      topLevelFields: ['baseline', 'migrationUnits']
    }
  ]
}

/** Computes the canonical seal over row metadata without self-referential file content. */
const sealRows = (rows: readonly IObservationPath[]): string =>
  createHash('sha256').update(JSON.stringify(rows)).digest('hex')

/** Normalizes field slices without erasing their disposition owner. */
const normalizeFieldSlices = (
  slices: readonly IDispositionFieldSlice[]
): readonly IDispositionFieldSlice[] =>
  slices
    .map((slice) => ({ ...slice, topLevelFields: [...slice.topLevelFields].sort() }))
    .sort((left, right) => left.path.localeCompare(right.path))

/** Fails closed unless prototype rows and path dispositions reconcile exactly once. */
const assertPrototypeDispositionReconciliation = (candidate: IObservationSnapshot): void => {
  /** Prototype rows that require one and only one path-level disposition. */
  const prototypePaths = new Set(
    candidate.paths.filter((row) => row.origin === 'cycle1-prototype').map((row) => row.path)
  )
  /** Every claimed path, retaining duplicates so duplicate ownership cannot hide in a Set. */
  const dispositionPaths = candidate.prototypeDispositions.flatMap((entry) => entry.paths)
  /** Union needed to reject both uncovered prototypes and dispositions for non-prototypes. */
  const reconciledPaths = new Set([...prototypePaths, ...dispositionPaths])

  for (const path of reconciledPaths) {
    /** Number of path-level disposition owners claiming this artifact. */
    const claimCount = dispositionPaths.filter((candidatePath) => candidatePath === path).length
    expect(claimCount, `${path}: path-level disposition count`).toBe(
      prototypePaths.has(path) ? 1 : 0
    )
  }

  for (const entry of candidate.prototypeDispositions) {
    for (const slice of entry.fieldSlices ?? [])
      expect(
        prototypePaths.has(slice.path),
        `${entry.id}:${slice.path}: field-slice prototype path`
      ).toBe(true)
  }

  /** Flattened field claims used to prevent overlapping map concerns. */
  const fieldClaims = candidate.prototypeDispositions.flatMap((entry) =>
    (entry.fieldSlices ?? []).flatMap((slice) =>
      slice.topLevelFields.map((field) => `${slice.path}\0${field}`)
    )
  )
  expect(new Set(fieldClaims).size, 'field-slice claims must not overlap').toBe(fieldClaims.length)

  for (const entry of candidate.prototypeDispositions)
    expect(
      normalizeFieldSlices(entry.fieldSlices ?? []),
      `${entry.id}: field-slice ownership`
    ).toEqual(normalizeFieldSlices(expectedFieldSlicesByDisposition[entry.id] ?? []))

  /** Historical fields specifically assigned from the captured Cycle 1 map. */
  const claimedCapabilityMapFields = candidate.prototypeDispositions
    .flatMap((entry) => entry.fieldSlices ?? [])
    .filter((slice) => slice.path === capabilityMapRelativePath)
    .flatMap((slice) => slice.topLevelFields)
    .sort()
  const observedCapabilityMapFields = Object.values(expectedFieldSlicesByDisposition)
    .flatMap((slices) => slices)
    .filter((slice) => slice.path === capabilityMapRelativePath)
    .flatMap((slice) => slice.topLevelFields)
    .sort()
  expect(claimedCapabilityMapFields).toEqual(observedCapabilityMapFields)
}

describe('SWV2-D43 Cycle 2 observation snapshot', () => {
  it('freezes scoped dirty paths with explicit ownership and prototype disposition', () => {
    expect(snapshot.schemaVersion).toBe(3)
    expect(snapshot.cycle).toBe('post-reset-cycle-2')
    expect(snapshot.round).toBe(1)
    expect(snapshot.baseCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(Number.isNaN(Date.parse(snapshot.approvedAt))).toBe(false)
    expect(snapshot.approval).toBe('user-authorized Cycle 2 Round 1 prompt')
    expect(snapshot.workspaceState).toBe('dirty')
    expect(snapshot.classificationCorrection.round).toBe(2)
    expect(snapshot.classificationCorrection.finding).toBe('SOL-SWV2-072')
    expect(Number.isNaN(Date.parse(snapshot.classificationCorrection.correctedAt))).toBe(false)
    expect(snapshot.classificationCorrection.scope).toContain('captured path hashes')
    expect(snapshot.representationCorrection.round).toBe(3)
    expect(snapshot.representationCorrection.finding).toBe('SOL-SWV2-074')
    expect(snapshot.representationCorrection.format).toBe('canonical-jsonl')
    expect(Number.isNaN(Date.parse(snapshot.representationCorrection.correctedAt))).toBe(false)
    expect(snapshotSource.endsWith('\n')).toBe(true)
    expect(snapshotRecords.filter((record) => record.record === 'metadata')).toHaveLength(1)
    expect(snapshotRecords[0]?.record).toBe('metadata')
    expect(
      snapshotRecords.filter((record) => record.record === 'prototypeDisposition')
    ).toHaveLength(5)
    expect(snapshotLines.map((line) => JSON.stringify(JSON.parse(line)))).toEqual(snapshotLines)
    expect(snapshot.paths.map((row) => row.path)).toEqual(
      snapshot.paths.map((row) => row.path).sort()
    )
    expect(new Set(snapshot.paths.map((row) => row.path)).size).toBe(snapshot.paths.length)
    expect(snapshot.paths.some((row) => row.path === snapshot.selfPath)).toBe(false)
    expect(snapshot.snapshotSha256).toBe(sealRows(snapshot.paths))
    expect(capabilityMapFields).toEqual(expectedNarrowedCapabilityMapFields)

    for (const row of snapshot.paths) {
      expect(row.path).not.toMatch(/^docs\//)
      expect(row.contentSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(row.bytes).toBeGreaterThanOrEqual(0)
      expect(row.owner.length).toBeGreaterThan(0)
      if (row.classification !== 'cycle-owned') continue
      const currentPath = resolve(repositoryRoot, row.path)
      expect(existsSync(currentPath), row.path).toBe(true)
      expect(createHash('sha256').update(readFileSync(currentPath)).digest('hex'), row.path).toBe(
        row.contentSha256
      )
    }

    expect(snapshot.prototypeDispositions.map((entry) => [entry.id, entry.disposition])).toEqual([
      ['cycle1-callable-fact-ledger', 'revert'],
      ['cycle1-compiler-value-flow-analyzer', 'rework'],
      ['cycle1-shared-capability-map', 'narrow'],
      ['cycle1-real-rollback', 'keep'],
      ['cycle1-aggregate-semantic-digest', 'revert']
    ])
    for (const entry of snapshot.prototypeDispositions) {
      expect(entry.owner.length).toBeGreaterThan(0)
      expect(entry.paths.length).toBeGreaterThan(0)
      expect(entry.replacementOwner.length).toBeGreaterThan(0)
      expect(entry.deleteCondition.length).toBeGreaterThan(0)
      expect(entry.tests.length).toBeGreaterThan(0)
    }
    assertPrototypeDispositionReconciliation(snapshot)

    const retiredLedger = snapshot.paths.find((row) =>
      row.path.endsWith('storage-v2-b00-fact-dispositions.json')
    )
    expect(retiredLedger?.origin).toBe('cycle1-prototype')
    expect(retiredLedger?.postCaptureDisposition).toBe('deleted')
    expect(existsSync(resolve(repositoryRoot, retiredLedger!.path))).toBe(false)
  })

  it('rejects zero and duplicate path-level prototype dispositions', () => {
    /** Prototype analyzer path used for both hostile reconciliation mutations. */
    const analyzerPath = 'packages/event-subscriber/test/storage-v2-b00-architecture.test.ts'
    /** Snapshot mutation that removes the analyzer's only disposition claim. */
    const missingDisposition: IObservationSnapshot = {
      ...snapshot,
      prototypeDispositions: snapshot.prototypeDispositions.map((entry) =>
        entry.id === 'cycle1-compiler-value-flow-analyzer' ? { ...entry, paths: [] } : entry
      )
    }
    expect(() => assertPrototypeDispositionReconciliation(missingDisposition)).toThrow(
      `${analyzerPath}: path-level disposition count`
    )

    /** Snapshot mutation that gives the analyzer two competing disposition owners. */
    const duplicateDisposition: IObservationSnapshot = {
      ...snapshot,
      prototypeDispositions: snapshot.prototypeDispositions.map((entry) =>
        entry.id === 'cycle1-real-rollback'
          ? { ...entry, paths: [...entry.paths, analyzerPath] }
          : entry
      )
    }
    expect(() => assertPrototypeDispositionReconciliation(duplicateDisposition)).toThrow(
      `${analyzerPath}: path-level disposition count`
    )

    /** Snapshot mutation that assigns one map field to both disposition concerns. */
    const overlappingFieldDisposition: IObservationSnapshot = {
      ...snapshot,
      prototypeDispositions: snapshot.prototypeDispositions.map((entry) =>
        entry.id === 'cycle1-aggregate-semantic-digest'
          ? {
              ...entry,
              fieldSlices: (entry.fieldSlices ?? []).map((slice) => ({
                ...slice,
                topLevelFields: [...slice.topLevelFields, 'schemaVersion']
              }))
            }
          : entry
      )
    }
    expect(() => assertPrototypeDispositionReconciliation(overlappingFieldDisposition)).toThrow(
      'field-slice claims must not overlap'
    )

    /** Snapshot mutation that preserves the global field union but swaps D46 owners. */
    const swappedFieldOwners: IObservationSnapshot = {
      ...snapshot,
      prototypeDispositions: snapshot.prototypeDispositions.map((entry) => {
        if (entry.id === 'cycle1-shared-capability-map')
          return {
            ...entry,
            fieldSlices: expectedFieldSlicesByDisposition['cycle1-aggregate-semantic-digest']
          }
        if (entry.id === 'cycle1-aggregate-semantic-digest')
          return {
            ...entry,
            fieldSlices: expectedFieldSlicesByDisposition['cycle1-shared-capability-map']
          }
        return entry
      })
    }
    expect(() => assertPrototypeDispositionReconciliation(swappedFieldOwners)).toThrow(
      'cycle1-shared-capability-map: field-slice ownership'
    )

    /** Snapshot mutation that assigns a field slice to an unknown non-prototype artifact. */
    const unknownFieldPath: IObservationSnapshot = {
      ...snapshot,
      prototypeDispositions: snapshot.prototypeDispositions.map((entry) =>
        entry.id === 'cycle1-shared-capability-map'
          ? {
              ...entry,
              fieldSlices: [
                ...(entry.fieldSlices ?? []),
                { path: 'packages/unknown/prototype.json', topLevelFields: ['schemaVersion'] }
              ]
            }
          : entry
      )
    }
    expect(() => assertPrototypeDispositionReconciliation(unknownFieldPath)).toThrow(
      'cycle1-shared-capability-map:packages/unknown/prototype.json: field-slice prototype path'
    )
  })

  it('rejects unknown, reordered, and miscounted JSONL record phases', () => {
    /** Unknown canonical record that must not disappear during reconstruction. */
    const unknownRecord = { record: 'unknown-sol-probe' } as unknown as IObservationRecord
    expect(() => assertSnapshotRecordLayout([...snapshotRecords, unknownRecord])).toThrow()

    /** Reordered path record that violates metadata then five-disposition phase ownership. */
    const reorderedRecords = [...snapshotRecords]
    ;[reorderedRecords[1], reorderedRecords[6]] = [reorderedRecords[6]!, reorderedRecords[1]!]
    expect(() => assertSnapshotRecordLayout(reorderedRecords)).toThrow()

    /** Missing disposition that shifts every later path into the wrong required phase. */
    expect(() => assertSnapshotRecordLayout(snapshotRecords.toSpliced(5, 1))).toThrow()
  })
})

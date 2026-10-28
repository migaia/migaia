// Backfill commit, failure, validation, leases and projection for the IndexedDB index assembly (see ./indexed-db-indexes-assembly.ts).
import {
  createStorageOperationRuntime,
  throwIfAborted,
  snapshotOperationContext,
  compareStorageKeys,
  encodeFlatStorageKey,
  snapshotKeyRange,
  safeJsonPayloadByteLength
} from '@migaia/storage-host/sdk'
import { createStorageAggregateError, StorageError } from '../types/errors.ts'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { indexBackfillFailureText } from '../error-text.ts'
import { StorageBackend, StorageOperation } from '../constants.ts'
import { fromIdbRequest, idbTransactionCommit } from '../utils/idb-request.ts'
import type { IOperationContext, IStorageKey } from '../types/context.ts'
import type { IRecordIndexHandle, IRecordIndexReadiness } from '@migaia/storage-contract'
import {
  RecordIndexBackfillPhase,
  type IRecordIndexBackfillBatch,
  type IRecordIndexBackfillCandidate,
  type IRecordIndexBackfillPhase,
  type IRecordIndexBackfillPreparation,
  type IRecordIndexBackfillReadOptions,
  type IRecordIndexBackfillRetryReceipt,
  type IRecordIndexBackfillSession
} from '@migaia/storage-host/entity'
import { createBackfillContentionFailure } from './backend-errors.ts'
import { withStorageIteratorResource } from '../utils/storage-iterator.ts'
import {
  IBackfillLease,
  IIndexedDbContext,
  IIndexedDbStore,
  IMutationLeaseContext,
  INDEX_BACKFILL_DEFAULT_LEASE_MS,
  INDEX_BACKFILL_MAX_BATCH_SIZE,
  INDEX_BACKFILL_MAX_LEASE_MS,
  INDEX_BACKFILL_MIN_BATCH_SIZE,
  INDEX_BACKFILL_MIN_LEASE_MS,
  INDEX_BACKFILL_SOFT_CAP_BYTES,
  INDEX_RECORDS_STORE_NAME,
  LEGACY_MIGRATION_BATCH_SIZE,
  META_STORE_NAME,
  REVISIONS_STORE_NAME,
  assertBackfillProjectionLimits,
  assertLive,
  backfillDecodedTooLarge,
  backfillTakeoverObservationKey,
  clearBackfillTakeoverObservations,
  createTransaction,
  estimateBackfillProjectionMetrics,
  indexMetadataKey,
  indexRawEpochKey,
  isValidIndexGeneration,
  open,
  recordRevisionKey,
  staleIndexHandleError,
  toIdbKey,
  toIdbRange,
  withMutationLease
} from './indexed-db.ts'
import { assertSession } from './indexed-db-backfill.ts'
import type { IIndexedDbBackfillSession, IIndexedDbBackfillCommit } from './indexed-db-backfill.ts'
import { indexedDbIndexRows } from './indexed-db-indexes-assembly.ts'

export async function commitIndexedDbBackfillNative<TValue>(
  sessionState: IIndexedDbBackfillSession<TValue>,
  batch: IRecordIndexBackfillBatch,
  commitCtx: IOperationContext | undefined,
  lease: IMutationLeaseContext
): ReturnType<IRecordIndexBackfillSession<TValue>['commitBatch']> {
  /** Commit-local facts cannot outlive this original controller lease. */
  const commitState = { sessionState, batch, commitCtx, lease } as IIndexedDbBackfillCommit<TValue>

  assertSession(commitState.sessionState)

  commitState.commitOperation = snapshotOperationContext(commitState.commitCtx)

  throwIfAborted(commitState.commitOperation?.signal)

  commitState.batchPhase = commitState.batch.phase ?? RecordIndexBackfillPhase.canonical

  if (
    commitState.batchPhase !== commitState.sessionState.currentPhase ||
    commitState.batch.generation !== commitState.sessionState.handle.generation ||
    commitState.batch.ownerToken !== commitState.sessionState.ownerToken
  )
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })

  commitState.batchIdentity = JSON.stringify({
    phase: commitState.batchPhase,
    generation: commitState.batch.generation,
    ownerToken: commitState.batch.ownerToken,
    checkpoint:
      commitState.batch.checkpoint === undefined
        ? undefined
        : encodeFlatStorageKey(commitState.batch.checkpoint),
    nextCheckpoint:
      commitState.batch.nextCheckpoint === undefined
        ? undefined
        : encodeFlatStorageKey(commitState.batch.nextCheckpoint),
    endOfScan: commitState.batch.endOfScan,
    projections: commitState.batch.projections.map((projection) => ({
      key: encodeFlatStorageKey(projection.key),
      expectedRevision: projection.expectedRevision,
      outcome: projection.outcome,
      counted: projection.counted,
      projection: projection.projection
        ? Object.fromEntries(
            Object.entries(projection.projection).map(([name, entry]) => [
              name,
              entry === undefined
                ? undefined
                : entry.kind === 'multiple'
                  ? { kind: entry.kind, keys: entry.keys.map(encodeFlatStorageKey) }
                  : { kind: entry.kind, key: encodeFlatStorageKey(entry.key) }
            ])
          )
        : undefined
    }))
  })

  commitState.commitRuntime = createStorageOperationRuntime()

  commitState.commitDatabase = await open(
    commitState.sessionState.indexedDbContext,
    commitState.commitRuntime,
    commitState.lease
  )

  commitState.transaction = createTransaction(
    commitState.commitDatabase,
    [
      commitState.sessionState.indexedDbContext.recordsStoreName,
      INDEX_RECORDS_STORE_NAME,
      REVISIONS_STORE_NAME,
      META_STORE_NAME
    ],
    'readwrite'
  )

  commitState.committed = idbTransactionCommit(
    commitState.transaction,
    { signal: commitState.commitOperation?.signal },
    commitState.commitRuntime
  )

  void commitState.committed.catch(() => {})

  try {
    /** Exact retries settle the original transaction without rewriting its sidecars. */
    const retried = await validateIndexedDbBackfillCommit(commitState)
    if (retried !== undefined) return retried
    /** All projection writes precede the original readiness and checkpoint publication. */
    const indexed = await applyIndexedDbBackfillProjection(commitState)
    return await finishIndexedDbBackfillCommit(commitState, indexed)
  } catch (cause) {
    try {
      commitState.transaction.abort()
    } catch {
      /* Transaction already settled. */
    }
    await commitState.committed.catch(() => {})
    throw cause
  }
}

export function indexedDbBackfillFail<TValue>(
  sessionState: IIndexedDbBackfillSession<TValue>,
  ...args: Parameters<IRecordIndexBackfillSession<TValue>['fail']>
): ReturnType<IRecordIndexBackfillSession<TValue>['fail']> {
  const [cause, failCtx] = args
  return withMutationLease(sessionState.indexedDbContext, async (lease) => {
    assertSession(sessionState)
    const failOperation = snapshotOperationContext(failCtx)
    throwIfAborted(failOperation?.signal)
    const failRuntime = createStorageOperationRuntime()
    const failDatabase = await open(sessionState.indexedDbContext, failRuntime, lease)
    const transaction = createTransaction(failDatabase, META_STORE_NAME, 'readwrite')
    const metadata = transaction.objectStore(META_STORE_NAME)
    const state = (await fromIdbRequest(
      metadata.get(indexMetadataKey(sessionState.handle.scope)),
      { signal: failOperation?.signal },
      failRuntime
    )) as
      | {
          handle?: IRecordIndexHandle
          lease?: IBackfillLease
        }
      | undefined
    if (
      state?.handle?.generation !== sessionState.handle.generation ||
      state?.lease?.ownerToken !== sessionState.ownerToken
    )
      throw state?.handle?.generation !== sessionState.handle.generation
        ? staleIndexHandleError()
        : new StorageError(StorageBrowserErrorCode.unavailable, {
            backend: StorageBackend.indexedDb
          })
    const readiness = (state as { readiness?: IRecordIndexReadiness }).readiness ?? {
      status: 'running',
      scanned: 0,
      indexed: 0
    }
    let persistedCause: unknown = cause
    try {
      persistedCause = structuredClone(cause)
    } catch {
      persistedCause = {
        name: cause instanceof Error ? cause.name : 'Error',
        message: cause instanceof Error ? cause.message : String(cause),
        stack: cause instanceof Error ? cause.stack : undefined
      }
    }
    metadata.put(
      {
        ...state,
        readiness: { ...readiness, status: 'failed' },
        failure: persistedCause,
        lease: undefined
      },
      indexMetadataKey(sessionState.handle.scope)
    )
    failRuntime.reporter(cause)
    try {
      await idbTransactionCommit(transaction, { signal: failOperation?.signal }, failRuntime)
    } catch (persistFailure) {
      throw createStorageAggregateError(
        StorageBrowserErrorCode.indexBackfillFailed,
        indexBackfillFailureText(sessionState.handle.scope),
        [cause, persistFailure]
      )
    }
    sessionState.released = true
  })
}

export function validateIndexedDbBackfillSession<TValue>(
  sessionState: IIndexedDbBackfillSession<TValue>
): void {
  assertLive(sessionState.indexedDbContext)

  if (!isValidIndexGeneration(sessionState.handle.generation)) throw staleIndexHandleError()

  sessionState.operation = snapshotOperationContext(sessionState.ctx)

  throwIfAborted(sessionState.operation?.signal)

  if (
    sessionState.options === null ||
    typeof sessionState.options !== 'object' ||
    Array.isArray(sessionState.options)
  )
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })

  sessionState.physicalRange = snapshotKeyRange(
    sessionState.options.range,
    StorageBackend.indexedDb
  )

  sessionState.legacyPhysicalRange = snapshotKeyRange(
    sessionState.options.legacyRange,
    StorageBackend.indexedDb
  )

  sessionState.includeLegacy = sessionState.options.includeLegacy === true

  if (
    sessionState.physicalRange?.lower === undefined ||
    sessionState.physicalRange.upper === undefined ||
    typeof sessionState.options.allowComplete !== 'boolean'
  )
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })

  sessionState.batchSize = sessionState.options.batchSize ?? LEGACY_MIGRATION_BATCH_SIZE

  sessionState.leaseMs = sessionState.options.leaseMs ?? INDEX_BACKFILL_DEFAULT_LEASE_MS

  if (
    !Number.isSafeInteger(sessionState.batchSize) ||
    sessionState.batchSize < INDEX_BACKFILL_MIN_BATCH_SIZE ||
    sessionState.batchSize > INDEX_BACKFILL_MAX_BATCH_SIZE
  )
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })

  if (
    !Number.isSafeInteger(sessionState.leaseMs) ||
    sessionState.leaseMs < INDEX_BACKFILL_MIN_LEASE_MS ||
    sessionState.leaseMs > INDEX_BACKFILL_MAX_LEASE_MS
  )
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })
}

export async function acquireIndexedDbBackfillLease<TValue>(
  sessionState: IIndexedDbBackfillSession<TValue>
): Promise<void> {
  if (sessionState.current?.handle?.generation !== sessionState.handle.generation)
    throw staleIndexHandleError()

  sessionState.readiness = sessionState.current.readiness ?? {
    status: 'pending',
    scanned: 0,
    indexed: 0
  }

  if (sessionState.readiness.status === 'complete') throw staleIndexHandleError()

  sessionState.phase = sessionState.current.phase ?? RecordIndexBackfillPhase.canonical

  if (
    sessionState.phase !== RecordIndexBackfillPhase.canonical &&
    sessionState.phase !== RecordIndexBackfillPhase.legacy
  )
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })

  if (sessionState.phase === RecordIndexBackfillPhase.legacy && !sessionState.includeLegacy)
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })

  sessionState.currentLease = sessionState.current.lease

  if (sessionState.currentLease !== undefined) {
    const currentRevision = sessionState.currentLease.heartbeatRevision ?? 0
    const currentLeaseMs = sessionState.currentLease.leaseMs ?? INDEX_BACKFILL_DEFAULT_LEASE_MS
    const observationKey = backfillTakeoverObservationKey(
      sessionState.handle.scope,
      sessionState.handle.generation,
      sessionState.currentLease.ownerToken,
      currentRevision
    )
    const observedAtMonotonic =
      sessionState.indexedDbContext.backfillTakeoverObservations.get(observationKey)
    const nowMonotonic = sessionState.indexedDbContext.backfillMonotonicNow()
    if (observedAtMonotonic === undefined || nowMonotonic - observedAtMonotonic < currentLeaseMs) {
      if (observedAtMonotonic === undefined) {
        clearBackfillTakeoverObservations(
          sessionState.indexedDbContext,
          sessionState.handle.scope,
          sessionState.handle.generation
        )
        sessionState.indexedDbContext.backfillTakeoverObservations.set(observationKey, nowMonotonic)
      }
      try {
        sessionState.acquire.abort()
      } catch {
        /* The transaction may already have settled while the contender was reading. */
      }
      throw createBackfillContentionFailure()
    }
    clearBackfillTakeoverObservations(
      sessionState.indexedDbContext,
      sessionState.handle.scope,
      sessionState.handle.generation
    )
    // The readwrite transaction is the compare-and-swap boundary for takeover.
    sessionState.lease = {
      ownerToken: sessionState.ownerToken,
      heartbeatRevision: currentRevision + 1,
      leaseMs: currentLeaseMs
    }
  } else {
    clearBackfillTakeoverObservations(
      sessionState.indexedDbContext,
      sessionState.handle.scope,
      sessionState.handle.generation
    )
    sessionState.lease = {
      ownerToken: sessionState.ownerToken,
      heartbeatRevision: 0,
      leaseMs: sessionState.leaseMs
    }
  }

  /**
   * /042: only a genuinely fresh scan (starting from the range's beginning, i.e. no checkpoint yet)
   * takes a new raw-firewall epoch snapshot; a resumed session preserves the one from when this
   * scan actually began, so a raw write from an earlier resumed batch is still caught at completion
   * in `commitBatch`.
   */
  sessionState.scanStartRawEpoch =
    sessionState.current.scanStartRawEpoch === undefined
      ? (((await fromIdbRequest(
          sessionState.acquire
            .objectStore(REVISIONS_STORE_NAME)
            .get(indexRawEpochKey(sessionState.handle.scope)) as IDBRequest<number | undefined>,
          { signal: sessionState.operation?.signal },
          sessionState.runtime
        )) as number | undefined) ?? 0)
      : sessionState.current.scanStartRawEpoch
}

export async function prepareIndexedDbBackfillCandidates<TValue>(
  sessionState: IIndexedDbBackfillSession<TValue>,
  rawCandidates: readonly IRecordIndexBackfillCandidate<TValue>[],
  readOptions: IRecordIndexBackfillReadOptions<TValue> | undefined
) {
  const candidates: IRecordIndexBackfillCandidate<TValue>[] = []
  const preparations: IRecordIndexBackfillPreparation[] = []
  let decodedBytes = 0
  if (readOptions?.prepare !== undefined) {
    for (const candidate of rawCandidates) {
      const preparation = await readOptions.prepare(candidate)
      if (!Number.isFinite(preparation.decodedBytes) || preparation.decodedBytes < 0)
        throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
          backend: StorageBackend.indexedDb
        })
      const metrics = estimateBackfillProjectionMetrics(
        preparation.projection,
        candidate.key,
        sessionState.handle.scope,
        sessionState.handle.generation
      )
      assertBackfillProjectionLimits(metrics, 'record')
      if (preparation.decodedBytes > INDEX_BACKFILL_SOFT_CAP_BYTES) throw backfillDecodedTooLarge()
      if (decodedBytes + preparation.decodedBytes > INDEX_BACKFILL_SOFT_CAP_BYTES)
        throw backfillDecodedTooLarge()
      candidates.push(candidate)
      preparations.push(preparation)
      decodedBytes += preparation.decodedBytes
    }
  } else {
    for (const candidate of rawCandidates) {
      const valueBytes = safeJsonPayloadByteLength(candidate.raw)
      if (decodedBytes + valueBytes > INDEX_BACKFILL_SOFT_CAP_BYTES) throw backfillDecodedTooLarge()
      candidates.push(candidate)
      decodedBytes += valueBytes
    }
  }
  let preparedProjectionRows = 0
  let preparedProjectionBytes = 0
  for (let index = 0; index < candidates.length; index += 1) {
    const metrics = estimateBackfillProjectionMetrics(
      preparations[index]?.projection,
      candidates[index]!.key,
      sessionState.handle.scope,
      sessionState.handle.generation
    )
    preparedProjectionRows += metrics.rows
    preparedProjectionBytes += metrics.bytes
  }
  assertBackfillProjectionLimits(
    { rows: preparedProjectionRows, bytes: preparedProjectionBytes },
    'batch'
  )
  return { candidates, preparations }
}

export async function validateIndexedDbBackfillCommit<TValue>(
  commitState: IIndexedDbBackfillCommit<TValue>
): Promise<IRecordIndexReadiness | undefined> {
  commitState.metadata = commitState.transaction.objectStore(META_STORE_NAME)
  commitState.state = (await fromIdbRequest(
    commitState.metadata.get(indexMetadataKey(commitState.sessionState.handle.scope)),
    { signal: commitState.commitOperation?.signal },
    commitState.commitRuntime
  )) as
    | {
        handle?: IRecordIndexHandle
        checkpoint?: IStorageKey
        phase?: IRecordIndexBackfillPhase
        readiness?: IRecordIndexReadiness
        lastBatch?: string
        lastBatchReceipt?: IRecordIndexBackfillRetryReceipt
        issued?: {
          ownerToken: string
          phase: IRecordIndexBackfillPhase
          checkpoint?: string
          endOfScan: boolean
          finalKey?: string
          entries: readonly { key: string; revision: number }[]
        }
        lease?: IBackfillLease
        scanStartRawEpoch?: number
      }
    | undefined
  if (commitState.state?.handle?.generation !== commitState.sessionState.handle.generation)
    throw staleIndexHandleError()
  if (
    ((commitState.state?.phase as IRecordIndexBackfillPhase | undefined) ??
      RecordIndexBackfillPhase.canonical) !== commitState.batchPhase
  )
    throw staleIndexHandleError()
  if (commitState.state?.readiness?.status === 'complete') throw staleIndexHandleError()
  commitState.activeLease = commitState.state?.lease
  const retryReceipt = commitState.state?.lastBatchReceipt
  const isExactRetry =
    commitState.activeLease === undefined &&
    retryReceipt?.ownerToken === commitState.sessionState.ownerToken &&
    retryReceipt.heartbeatRevision === commitState.sessionState.sessionHeartbeatRevision &&
    retryReceipt.batchIdentity === commitState.batchIdentity
  if (commitState.activeLease?.ownerToken !== commitState.sessionState.ownerToken && !isExactRetry)
    throw staleIndexHandleError()
  if (isExactRetry) {
    await commitState.committed
    return commitState.state.readiness ?? { status: 'running', scanned: 0, indexed: 0 }
  }
  if (
    (commitState.state.checkpoint === undefined
      ? commitState.batch.checkpoint !== undefined
      : commitState.batch.checkpoint === undefined ||
        encodeFlatStorageKey(commitState.state.checkpoint) !==
          encodeFlatStorageKey(commitState.batch.checkpoint)) ||
    (commitState.state.checkpoint !== undefined &&
      commitState.batch.nextCheckpoint !== undefined &&
      compareStorageKeys(commitState.batch.nextCheckpoint, commitState.state.checkpoint) <= 0)
  )
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })
  const issuedManifest = commitState.state.issued
  const issued = issuedManifest?.entries ?? []
  if (
    issuedManifest?.ownerToken !== commitState.sessionState.ownerToken ||
    issuedManifest.phase !== commitState.batchPhase ||
    issuedManifest.checkpoint !==
      (commitState.batch.checkpoint === undefined
        ? undefined
        : encodeFlatStorageKey(commitState.batch.checkpoint)) ||
    issuedManifest.endOfScan !== commitState.batch.endOfScan ||
    issuedManifest.finalKey !==
      (commitState.batch.nextCheckpoint === undefined
        ? undefined
        : encodeFlatStorageKey(commitState.batch.nextCheckpoint)) ||
    issued.length !== commitState.batch.projections.length ||
    commitState.batch.projections.some(
      (projection, index) =>
        issued[index]?.key !== encodeFlatStorageKey(projection.key) ||
        issued[index]?.revision !== projection.expectedRevision
    )
  )
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })
  if (
    issued.length > 0 &&
    (commitState.batch.nextCheckpoint === undefined ||
      encodeFlatStorageKey(commitState.batch.nextCheckpoint) !== issued[issued.length - 1]!.key)
  )
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })
  let projectionRows = 0
  let projectionBytes = 0
  for (const projection of commitState.batch.projections) {
    const metrics = estimateBackfillProjectionMetrics(
      projection.projection,
      projection.key,
      commitState.sessionState.handle.scope,
      commitState.sessionState.handle.generation
    )
    assertBackfillProjectionLimits(metrics, 'record')
    projectionRows += metrics.rows
    projectionBytes += metrics.bytes
  }
  assertBackfillProjectionLimits({ rows: projectionRows, bytes: projectionBytes }, 'batch')
  return undefined
}

export async function applyIndexedDbBackfillProjection<TValue>(
  commitState: IIndexedDbBackfillCommit<TValue>
): Promise<number> {
  commitState.sidecar = commitState.transaction.objectStore(INDEX_RECORDS_STORE_NAME)
  commitState.revisions = commitState.transaction.objectStore(REVISIONS_STORE_NAME)
  let indexed = 0
  // A projection skipped here because its revision moved (the record was mutated after
  // this batch's `readBatch`, at a key that will never be re-scanned once past the
  // checkpoint) must not be re-projected with stale data; completeness for the whole scan
  // is separately gated below by the raw-firewall epoch, not by tracking this locally.
  for (const projection of commitState.batch.projections) {
    const currentRevision =
      ((await fromIdbRequest(
        commitState.revisions.get(
          recordRevisionKey(commitState.sessionState.indexedDbContext, projection.key)
        ),
        { signal: commitState.commitOperation?.signal },
        commitState.commitRuntime
      )) as number | undefined) ?? 0
    if (currentRevision !== projection.expectedRevision) continue
    // A full legacy scan also visits canonical and foreign physical keys. They advance
    // the bounded cursor but must not delete sidecar rows produced by the canonical phase.
    if (projection.counted === false) continue
    const oldRows = await fromIdbRequest(
      commitState.sidecar
        .index('record')
        .getAllKeys([
          commitState.sessionState.handle.scope,
          commitState.sessionState.handle.generation,
          toIdbKey(projection.key)
        ]),
      { signal: commitState.commitOperation?.signal },
      commitState.commitRuntime
    )
    for (const oldRow of oldRows as IDBValidKey[]) commitState.sidecar.delete(oldRow)
    if (projection.outcome !== 'indexed' || projection.projection === undefined) continue
    for (const [indexName, entry] of Object.entries(projection.projection)) {
      if (entry === undefined) continue
      const values = entry.kind === 'multiple' ? entry.keys : [entry.key]
      for (const indexValue of values) {
        commitState.sidecar.put({
          scope: commitState.sessionState.handle.scope,
          generation: commitState.sessionState.handle.generation,
          indexName,
          indexValue: toIdbKey(indexValue),
          recordKey: toIdbKey(projection.key)
        })
        indexed += 1
      }
    }
  }
  return indexed
}

export async function finishIndexedDbBackfillCommit<TValue>(
  commitState: IIndexedDbBackfillCommit<TValue>,
  indexed: number
): Promise<IRecordIndexReadiness> {
  /** Validation already rejected missing or stale metadata for this native commit. */
  const state = commitState.state!
  const activeRange =
    commitState.batchPhase === RecordIndexBackfillPhase.legacy
      ? commitState.sessionState.legacyPhysicalRange
      : commitState.sessionState.physicalRange
  const suffixRange = toIdbRange(
    commitState.batch.nextCheckpoint === undefined
      ? activeRange
      : activeRange === undefined
        ? { lower: commitState.batch.nextCheckpoint, lowerOpen: true }
        : { ...activeRange, lower: commitState.batch.nextCheckpoint, lowerOpen: true },
    commitState.sessionState.indexedDbContext.keyRange
  )
  const suffix = await fromIdbRequest(
    commitState.transaction
      .objectStore(commitState.sessionState.indexedDbContext.recordsStoreName)
      .getAllKeys(suffixRange, 1),
    { signal: commitState.commitOperation?.signal },
    commitState.commitRuntime
  )
  const previous = state.readiness ?? { status: 'running', scanned: 0, indexed: 0 }
  /**
   * /042: a scan can only be trusted `complete` if the raw-firewall epoch (bumped by every
   * canonical or legacy-shaped raw write in `applyRawMutationFirewall`, at _any_ readiness state,
   * not only `complete`) still matches the snapshot taken when this scan genuinely restarted from
   * the range's beginning. This catches an interleaved raw write regardless of whether it landed
   * inside this batch or between two commits, and regardless of its position relative to the
   * checkpoint — the batch-local flag this replaced could only see the former. It is also
   * recoverable: a later fresh full re-scan takes a new snapshot, and if nothing else mutates the
   * scope during that new scan, the epochs match again and `complete` is reachable — unlike a
   * sticky boolean with no legitimate reset path.
   */
  const currentRawEpoch =
    ((await fromIdbRequest(
      commitState.revisions.get(
        indexRawEpochKey(commitState.sessionState.handle.scope)
      ) as IDBRequest<number | undefined>,
      { signal: commitState.commitOperation?.signal },
      commitState.commitRuntime
    )) as number | undefined) ?? 0
  const scanUnchanged =
    state.scanStartRawEpoch !== undefined && currentRawEpoch === state.scanStartRawEpoch
  const reachedPhaseEnd = commitState.batch.endOfScan && (suffix as IDBValidKey[]).length === 0
  const entersLegacyPhase =
    commitState.batchPhase === RecordIndexBackfillPhase.canonical &&
    commitState.sessionState.includeLegacy &&
    reachedPhaseEnd
  const reachedScanEnd =
    commitState.sessionState.options.allowComplete &&
    (commitState.batchPhase === RecordIndexBackfillPhase.legacy ||
      !commitState.sessionState.includeLegacy) &&
    reachedPhaseEnd
  const nextReadiness: IRecordIndexReadiness = {
    status: reachedScanEnd && scanUnchanged ? 'complete' : 'running',
    scanned:
      previous.scanned +
      commitState.batch.projections.filter((projection) => projection.counted !== false).length,
    indexed: previous.indexed + indexed
  }
  /**
   * The scan reached its natural end (nothing left to scan) but could not be trusted `complete`
   * only because the epoch moved underneath it. Holding onto a checkpoint at the very end of the
   * range with no way to advance further would wedge this generation permanently `running` — the
   * next `openBackfillSession` would see a defined checkpoint and treat it as a resume, never
   * re-snapshotting the raw-firewall epoch. Clearing the checkpoint here instead makes the _next_
   * session a genuinely fresh start (per the raw-firewall epoch logic in `openBackfillSession`), so
   * a later clean full re-scan can still reach `complete`.
   */
  const nextPhase = entersLegacyPhase ? RecordIndexBackfillPhase.legacy : commitState.batchPhase
  const nextCheckpoint =
    entersLegacyPhase || (reachedScanEnd && !scanUnchanged)
      ? undefined
      : commitState.batch.nextCheckpoint
  const heartbeatRevision =
    commitState.activeLease?.heartbeatRevision ?? commitState.sessionState.sessionHeartbeatRevision
  commitState.metadata.put(
    {
      ...state,
      phase: nextPhase,
      readiness: nextReadiness,
      checkpoint: nextCheckpoint,
      lastBatch: commitState.batchIdentity,
      lastBatchReceipt: {
        ownerToken: commitState.sessionState.ownerToken,
        heartbeatRevision,
        batchIdentity: commitState.batchIdentity
      },
      issued: undefined,
      lease: undefined
    },
    indexMetadataKey(commitState.sessionState.handle.scope)
  )
  await commitState.committed
  commitState.sessionState.checkpoint = nextCheckpoint
  commitState.sessionState.currentPhase = nextPhase
  return nextReadiness
}

export function iterateIndexedDbIndex<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  ...args: Parameters<NonNullable<IIndexedDbStore<TValue>['iterateRecordIndex']>>
): ReturnType<NonNullable<IIndexedDbStore<TValue>['iterateRecordIndex']>> {
  const [query, ctx] = args
  return withStorageIteratorResource(indexedDbIndexRows(indexedDbContext, query, ctx), {
    execution: indexedDbContext.runtime.execution,
    operation: StorageOperation.indexedDbCursor,
    ctx
  })
}

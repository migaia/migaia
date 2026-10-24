import { indexUniqueConflictText } from '../error-text.js'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { assertTransactionOwner } from '@migaia/storage-host/authoring/transaction'
import { snapshotConcurrencyLockRange } from '@migaia/storage-host/authoring/concurrency'
import {
  createStorageOperationRuntime,
  type IStorageOperationRuntime
} from '@migaia/storage-host/authoring/backend'
import { createStorageAggregateError, StorageError, StorageErrorCode } from '../types/errors.js'
import { indexBackfillFailureText, StorageErrorText } from '../error-text.js'
import { StorageBackend, StorageOperation, StorageTransactionOperation } from '../constants.js'
import { mergeSignals, throwIfAborted, withAbort } from '@migaia/storage-host/authoring/backend'
import { snapshotOperationContext } from '@migaia/storage-host/authoring/context'
import { compareStorageKeys, snapshotStorageKey } from '@migaia/storage-host/authoring/key'
import { encodeFlatStorageKey, snapshotKeyRange } from '@migaia/storage-host/authoring/backend'
import { collectUniqueIndexOwners } from './errors.js'
import { isStorageKeyInRange } from '@migaia/storage-host/authoring/backend'
import { raceWithAbort } from '@migaia/utils/promise'
import { fromIdbRequest, idbTransactionCommit } from '../utils/idb-request.js'
import type { IKeyRange, IOperationContext, IStorageKey } from '../types/context.js'
import type {
  IRecordIndexDefinition,
  IRecordIndexHandle,
  IRecordIndexReadiness,
  IRecordIndexQuery
} from '@migaia/storage-contract'
import { readTransactionConflictPolicy } from '@migaia/storage-contract'
import {
  RecordIndexBackfillPhase,
  registerRecordIndexBackfillStore,
  type IRecordIndexBackfillBatch,
  type IRecordIndexBackfillCandidate,
  type IRecordIndexBackfillPhase,
  type IRecordIndexBackfillPreparation,
  type IRecordIndexBackfillReadOptions,
  type IRecordIndexBackfillRetryReceipt,
  type IRecordIndexBackfillSession
} from '@migaia/storage-host/entity'
import { safeJsonPayloadByteLength } from '@migaia/storage-host/authoring/backend'
import { createStorageToken } from '@migaia/storage-host/authoring/backend'
import { createBackfillContentionFailure } from './errors.js'
import { withStorageIteratorResource } from '../utils/storage-iterator.js'
import {
  IBackfillLease,
  type IIndexedDbTransactionRecordSource,
  createMonotonicClock,
  IIndexedDbContext,
  IIndexedDbNativeCallback,
  IIndexedDbScopeContext,
  IIndexedDbStore,
  IIndexedDbTransactionScope,
  IMutationLeaseContext,
  INDEX_BACKFILL_DEFAULT_LEASE_MS,
  INDEX_BACKFILL_MAX_BATCH_SIZE,
  INDEX_BACKFILL_MAX_LEASE_MS,
  INDEX_BACKFILL_MIN_BATCH_SIZE,
  INDEX_BACKFILL_MIN_LEASE_MS,
  INDEX_BACKFILL_SOFT_CAP_BYTES,
  INDEX_QUERY_PAGE_SIZE,
  INDEX_RECORDS_STORE_NAME,
  LEGACY_MIGRATION_BATCH_SIZE,
  META_STORE_NAME,
  RECORD_EPOCH_KEY,
  REVISIONS_STORE_NAME,
  archiveIndexGeneration,
  assertBackfillProjectionLimits,
  assertLive,
  backfillDecodedTooLarge,
  backfillTakeoverObservationKey,
  clearBackfillTakeoverObservations,
  createIndexGeneration,
  createTransaction,
  estimateBackfillProjectionMetrics,
  indexMetadataKey,
  indexRawEpochKey,
  indexScopeEpochKey,
  indexedDbScopeOperation,
  isValidIndexGeneration,
  normalizeIndexedDbOperationError,
  open,
  recordIterator,
  recordRevisionKey,
  request,
  rootKeys,
  rootMutation,
  runTransaction,
  snapshotWriteValue,
  staleIndexHandleError,
  toIdbKey,
  toIdbRange,
  withMutationLease,
  write
} from './indexed-db.js'
export async function ensureRecordIndexes<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  scope: string,
  definitions: readonly IRecordIndexDefinition[],
  _ctx?: IOperationContext
): Promise<IRecordIndexHandle> {
  return withMutationLease(indexedDbContext, (lease) =>
    withAbort(_ctx, async (signal, _context, runtime) => {
      assertLive(indexedDbContext)
      throwIfAborted(signal)
      const fingerprint = JSON.stringify(definitions)
      const database = await (
        signal === undefined
          ? open(indexedDbContext, runtime, lease)
          : raceWithAbort(() => open(indexedDbContext, runtime, lease), {
              signal,
              cleanupPolicy: 'report',
              report: runtime.reporter
            })
      ).catch((cause: unknown) => {
        throw normalizeIndexedDbOperationError(cause)
      })
      throwIfAborted(signal)
      /** The readwrite metadata transaction is the cross-connection linearization point. */
      const transaction = createTransaction(database, META_STORE_NAME, 'readwrite')
      const metadata = transaction.objectStore(META_STORE_NAME)
      const existing = (await fromIdbRequest(
        metadata.get(indexMetadataKey(scope)),
        { signal },
        runtime
      )) as (Record<string, unknown> & { readonly handle?: IRecordIndexHandle }) | undefined
      const existingReadiness = existing?.readiness as IRecordIndexReadiness | undefined
      if (
        isValidIndexGeneration(existing?.handle?.generation) &&
        existing?.handle?.fingerprint === fingerprint &&
        existingReadiness?.status !== 'failed'
      ) {
        await idbTransactionCommit(transaction, { signal }, runtime)
        return existing.handle
      }
      const generation = createIndexGeneration()
      const handle = { scope, generation, fingerprint }
      if (existing?.handle !== undefined)
        archiveIndexGeneration(indexedDbContext, metadata, existing, generation)
      metadata.put(
        {
          handle,
          currentGeneration: generation,
          readiness: { status: 'pending', scanned: 0, indexed: 0 }
        },
        indexMetadataKey(scope)
      )
      await idbTransactionCommit(transaction, { signal }, runtime)
      return handle
    })
  )
}

export type IIndexedDbBackfillSession<TValue> = {
  /** Original indexedDbContext is borrowed by this native backfill session. */
  readonly indexedDbContext: IIndexedDbContext<TValue>
  /** Original handle is borrowed by this native backfill session. */
  readonly handle: IRecordIndexHandle
  /** Original options is borrowed by this native backfill session. */
  readonly options: {
    readonly range: IKeyRange
    readonly legacyRange?: IKeyRange
    readonly includeLegacy?: boolean
    readonly allowComplete: boolean
    readonly batchSize?: number
    readonly leaseMs?: number
  }
  /** Original ctx is borrowed by this native backfill session. */
  readonly ctx?: IOperationContext
  /** The original top-level controller lease covers only session acquisition. */
  mutationLease: IMutationLeaseContext

  operation: ReturnType<typeof snapshotOperationContext>

  physicalRange: ReturnType<typeof snapshotKeyRange>

  legacyPhysicalRange: ReturnType<typeof snapshotKeyRange>

  includeLegacy: boolean

  batchSize: number

  leaseMs: number

  runtime: ReturnType<typeof createStorageOperationRuntime>

  database: IDBDatabase

  ownerToken: string

  acquire: IDBTransaction

  metadata: IDBObjectStore

  current:
    | {
        handle?: IRecordIndexHandle
        readiness?: IRecordIndexReadiness
        checkpoint?: IStorageKey
        phase?: IRecordIndexBackfillPhase
        lease?: IBackfillLease
        scanStartRawEpoch?: number
      }
    | undefined

  readiness: IRecordIndexReadiness

  phase: IRecordIndexBackfillPhase

  currentLease: IBackfillLease | undefined

  lease: IBackfillLease

  /**
   * /042: only a genuinely fresh scan (starting from the range's beginning, i.e. no checkpoint yet)
   * takes a new raw-firewall epoch snapshot; a resumed session preserves the one from when this
   * scan actually began, so a raw write from an earlier resumed batch is still caught at completion
   * in `commitBatch`.
   */
  scanStartRawEpoch: number

  checkpoint: IStorageKey | undefined

  currentPhase: IRecordIndexBackfillPhase

  sessionHeartbeatRevision: number

  released: boolean

  session: IRecordIndexBackfillSession<TValue>
}

export async function openBackfillSession<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  handle: IRecordIndexHandle,
  options: {
    readonly range: IKeyRange
    readonly legacyRange?: IKeyRange
    readonly includeLegacy?: boolean
    readonly allowComplete: boolean
    readonly batchSize?: number
    readonly leaseMs?: number
  },
  ctx?: IOperationContext
): Promise<import('@migaia/storage-host/entity').IRecordIndexBackfillSession<TValue>> {
  /** Session callbacks share only explicitly owned native scan state. */
  const sessionState = {
    indexedDbContext,
    handle,
    options,
    ctx
  } as IIndexedDbBackfillSession<TValue>
  return withMutationLease(indexedDbContext, (mutationLease) =>
    initializeIndexedDbBackfillSession(sessionState, mutationLease)
  )
}

export async function initializeIndexedDbBackfillSession<TValue>(
  sessionState: IIndexedDbBackfillSession<TValue>,
  mutationLease: IMutationLeaseContext
): Promise<IRecordIndexBackfillSession<TValue>> {
  sessionState.mutationLease = mutationLease

  validateIndexedDbBackfillSession(sessionState)

  sessionState.runtime = createStorageOperationRuntime()

  sessionState.database = await open(
    sessionState.indexedDbContext,
    sessionState.runtime,
    sessionState.mutationLease
  )

  sessionState.ownerToken = createStorageToken()

  sessionState.acquire = createTransaction(
    sessionState.database,
    [META_STORE_NAME, REVISIONS_STORE_NAME],
    'readwrite'
  )

  sessionState.metadata = sessionState.acquire.objectStore(META_STORE_NAME)

  sessionState.current = (await fromIdbRequest(
    sessionState.metadata.get(indexMetadataKey(sessionState.handle.scope)),
    {
      signal: sessionState.operation?.signal
    },
    sessionState.runtime
  )) as
    | {
        handle?: IRecordIndexHandle
        readiness?: IRecordIndexReadiness
        checkpoint?: IStorageKey
        phase?: IRecordIndexBackfillPhase
        lease?: IBackfillLease
        scanStartRawEpoch?: number
      }
    | undefined

  await acquireIndexedDbBackfillLease(sessionState)

  /** Lease acquisition rejected absent or stale metadata before this original publication. */
  sessionState.metadata.put(
    {
      ...sessionState.current,
      handle: sessionState.handle,
      readiness: { ...sessionState.readiness, status: 'running' },
      lease: sessionState.lease,
      checkpoint: sessionState.current!.checkpoint,
      phase: sessionState.phase,
      issued: undefined,
      scanStartRawEpoch: sessionState.scanStartRawEpoch,
      lastBatchReceipt: undefined
    },
    indexMetadataKey(sessionState.handle.scope)
  )

  await idbTransactionCommit(
    sessionState.acquire,
    { signal: sessionState.operation?.signal },
    sessionState.runtime
  )

  sessionState.checkpoint = sessionState.current!.checkpoint

  sessionState.currentPhase = sessionState.phase

  sessionState.sessionHeartbeatRevision = sessionState.lease.heartbeatRevision

  sessionState.released = false
  sessionState.session = createIndexedDbBackfillMethods(sessionState)
  return sessionState.session
}

export function assertSession<TValue>(sessionState: IIndexedDbBackfillSession<TValue>): void {
  if (sessionState.released)
    throw new StorageContractError(StorageContractErrorCode.disposed, {
      backend: StorageBackend.indexedDb
    })
}

export async function readBatch<TValue>(
  sessionState: IIndexedDbBackfillSession<TValue>,
  readCtx?: IOperationContext,
  readOptions?: IRecordIndexBackfillReadOptions<TValue>,
  inheritedLease?: IMutationLeaseContext
): Promise<Awaited<ReturnType<IRecordIndexBackfillSession<TValue>['readBatch']>>> {
  assertSession(sessionState)
  const readOperation = snapshotOperationContext(readCtx)
  throwIfAborted(readOperation?.signal)
  const readRuntime = createStorageOperationRuntime()
  const readDatabase = await open(sessionState.indexedDbContext, readRuntime, inheritedLease)
  const transaction = createTransaction(
    readDatabase,
    [sessionState.indexedDbContext.recordsStoreName, REVISIONS_STORE_NAME],
    'readonly'
  )
  const activeRange =
    sessionState.currentPhase === RecordIndexBackfillPhase.legacy
      ? sessionState.legacyPhysicalRange
      : sessionState.physicalRange
  const range = toIdbRange(
    sessionState.checkpoint === undefined
      ? activeRange
      : activeRange === undefined
        ? { lower: sessionState.checkpoint, lowerOpen: true }
        : { ...activeRange, lower: sessionState.checkpoint, lowerOpen: true },
    sessionState.indexedDbContext.keyRange
  )
  const keys = (await fromIdbRequest(
    transaction
      .objectStore(sessionState.indexedDbContext.recordsStoreName)
      .getAllKeys(range, sessionState.batchSize + 1),
    { signal: readOperation?.signal },
    readRuntime
  )) as IDBValidKey[]
  const values = (await fromIdbRequest(
    transaction
      .objectStore(sessionState.indexedDbContext.recordsStoreName)
      .getAll(range, sessionState.batchSize + 1),
    { signal: readOperation?.signal },
    readRuntime
  )) as TValue[]
  const rawCandidates: IRecordIndexBackfillCandidate<TValue>[] = []
  const candidateCount = Math.min(keys.length, sessionState.batchSize)
  for (let index = 0; index < candidateCount; index += 1) {
    const key = snapshotStorageKey(keys[index] as IStorageKey, StorageBackend.indexedDb)
    const revision = (await fromIdbRequest(
      transaction
        .objectStore(REVISIONS_STORE_NAME)
        .get(recordRevisionKey(sessionState.indexedDbContext, key)),
      { signal: readOperation?.signal },
      readRuntime
    )) as number | undefined
    const raw = snapshotWriteValue(values[index], key)
    rawCandidates.push({
      key,
      raw,
      revision: revision ?? 0,
      phase: sessionState.currentPhase
    })
  }
  /** Candidate projection ownership finishes before publishing the original issued manifest. */
  const { candidates, preparations } = await prepareIndexedDbBackfillCandidates(
    sessionState,
    rawCandidates,
    readOptions
  )
  // `release()` may race an entity decoder; never publish an issued manifest after release.
  assertSession(sessionState)
  const endOfScan = candidates.length === keys.length
  const metadataTransaction = createTransaction(readDatabase, META_STORE_NAME, 'readwrite')
  const metadataStore = metadataTransaction.objectStore(META_STORE_NAME)
  const metadataState = (await fromIdbRequest(
    metadataStore.get(indexMetadataKey(sessionState.handle.scope)),
    { signal: readOperation?.signal },
    readRuntime
  )) as Record<string, unknown> | undefined
  if (
    (metadataState?.handle as IRecordIndexHandle | undefined)?.generation !==
    sessionState.handle.generation
  )
    throw staleIndexHandleError()
  if (
    ((metadataState?.phase as IRecordIndexBackfillPhase | undefined) ??
      RecordIndexBackfillPhase.canonical) !== sessionState.currentPhase
  )
    throw staleIndexHandleError()
  if (
    metadataState === undefined ||
    (metadataState.lease as { ownerToken?: string } | undefined)?.ownerToken !==
      sessionState.ownerToken
  )
    throw new StorageError(StorageErrorCode.unavailable, {
      backend: StorageBackend.indexedDb
    })
  metadataStore.put(
    {
      ...metadataState,
      issued: {
        ownerToken: sessionState.ownerToken,
        phase: sessionState.currentPhase,
        checkpoint:
          sessionState.checkpoint === undefined
            ? undefined
            : encodeFlatStorageKey(sessionState.checkpoint),
        endOfScan,
        finalKey:
          candidates.length === 0
            ? undefined
            : encodeFlatStorageKey(candidates[candidates.length - 1]!.key),
        entries: candidates.map((candidate) => ({
          key: encodeFlatStorageKey(candidate.key),
          revision: candidate.revision
        }))
      }
    },
    indexMetadataKey(sessionState.handle.scope)
  )
  await idbTransactionCommit(metadataTransaction, { signal: readOperation?.signal }, readRuntime)
  return {
    phase: sessionState.currentPhase,
    checkpoint: sessionState.checkpoint,
    endOfScan,
    candidates: candidates,
    preparations: readOptions?.prepare === undefined ? undefined : preparations
  }
}

export function createIndexedDbBackfillMethods<TValue>(
  sessionState: IIndexedDbBackfillSession<TValue>
): IRecordIndexBackfillSession<TValue> {
  return {
    generation: sessionState.handle.generation,
    ownerToken: sessionState.ownerToken,
    renew: (...args) => indexedDbBackfillRenew(sessionState, ...args),
    readBatch: (readCtx, readOptions) =>
      withMutationLease(sessionState.indexedDbContext, (lease) =>
        readBatch(sessionState, readCtx, readOptions, lease)
      ),
    commitBatch: (...args) => indexedDbBackfillCommitBatch(sessionState, ...args),
    fail: (...args) => indexedDbBackfillFail(sessionState, ...args),
    release: () => {
      sessionState.released = true
    }
  }
}

export function registerIndexedDbBackfill<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): void {
  registerRecordIndexBackfillStore(indexedDbContext.store, {
    prepare: async () => {
      await open(indexedDbContext, createStorageOperationRuntime())
    },
    ensureRecordIndexes: (
      scope: string,
      definitions: readonly IRecordIndexDefinition[],
      _ctx?: IOperationContext
    ) => ensureRecordIndexes(indexedDbContext, scope, definitions, _ctx),
    getRecordIndexReadiness: indexedDbContext.store.getRecordIndexReadiness,
    openBackfillSession: (
      handle: IRecordIndexHandle,
      options: {
        readonly range: IKeyRange
        readonly legacyRange?: IKeyRange
        readonly includeLegacy?: boolean
        readonly allowComplete: boolean
        readonly batchSize?: number
        readonly leaseMs?: number
      },
      ctx?: IOperationContext
    ) => openBackfillSession(indexedDbContext, handle, options, ctx)
  })
}

export async function assertHandle<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  handle: IRecordIndexHandle
): Promise<void> {
  if (!isValidIndexGeneration(handle.generation)) throw staleIndexHandleError()
  const state = (await request(nativeState, () =>
    nativeState.native.objectStore(META_STORE_NAME).get(indexMetadataKey(handle.scope))
  )) as { handle?: IRecordIndexHandle } | undefined
  if (
    state?.handle?.generation !== handle.generation ||
    state.handle.fingerprint !== handle.fingerprint
  )
    throw staleIndexHandleError()
}

export function createIndexedDbScopeIndexes<TValue, T>(
  scopeState: IIndexedDbScopeContext<TValue, T>
): Pick<
  IIndexedDbTransactionScope<TValue>,
  'isRecordIndexReady' | 'putIndexedRecord' | 'iterateRecordIndex'
> {
  return {
    isRecordIndexReady: (handle) =>
      indexedDbScopeOperation(
        scopeState,
        StorageTransactionOperation.isRecordIndexReady,
        handle,
        async (_view, handle) => {
          /** A cached repository handle grants no readiness across native snapshots. */
          const { scope, generation, fingerprint } = handle
          const state = (await request(scopeState.nativeState, () =>
            scopeState.nativeState.native.objectStore(META_STORE_NAME).get(indexMetadataKey(scope))
          )) as
            | {
                readonly handle?: IRecordIndexHandle
                readonly readiness?: IRecordIndexReadiness
              }
            | undefined
          return (
            state?.handle?.generation === generation &&
            state.handle.fingerprint === fingerprint &&
            state.readiness?.status === 'complete'
          )
        }
      ),
    putIndexedRecord: (value, key, handle, projection, options) =>
      indexedDbScopeOperation(
        scopeState,
        StorageTransactionOperation.putIndexedRecord,
        { value, key, handle, projection, options },
        async (_view, { value, key, handle, projection, options }) => {
          const snapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
          const copy =
            scopeState.nativeState.attemptState.logicalTransaction.root === undefined
              ? snapshotWriteValue(value, snapshot)
              : value
          const projected =
            scopeState.nativeState.attemptState.logicalTransaction.root === undefined
              ? snapshotWriteValue(projection, snapshot)
              : projection
          const conflictPolicy = readTransactionConflictPolicy(options, StorageBackend.indexedDb)
          await assertHandle(scopeState.nativeState, handle)
          const definitions = JSON.parse(handle.fingerprint) as IRecordIndexDefinition[]
          const owners = collectUniqueIndexOwners(
            definitions,
            [{ key: snapshot, projection: projected }],
            StorageBackend.indexedDb
          )
          for (const [identity, unique] of owners)
            scopeState.nativeState.uniqueChecks.set(
              JSON.stringify([handle.scope, handle.generation, identity]),
              {
                handle,
                indexName: unique.indexName,
                indexValue: unique.indexValue
              }
            )
          const sidecar = scopeState.nativeState.native.objectStore(INDEX_RECORDS_STORE_NAME)
          const rows = await request(scopeState.nativeState, () =>
            sidecar
              .index('record')
              .getAllKeys([handle.scope, handle.generation, toIdbKey(snapshot)])
          )
          for (const row of rows) await request(scopeState.nativeState, () => sidecar.delete(row))
          await write(scopeState.nativeState, 'record', snapshot, copy, conflictPolicy, true)
          for (const [indexName, entry] of Object.entries(projected)) {
            if (entry === undefined) continue
            const keys = entry.kind === 'multiple' ? entry.keys : [entry.key]
            for (const indexValue of keys)
              await request(scopeState.nativeState, () =>
                sidecar.put({
                  scope: handle.scope,
                  generation: handle.generation,
                  indexName,
                  indexValue: toIdbKey(indexValue),
                  recordKey: toIdbKey(snapshot)
                })
              )
          }
          scopeState.nativeState.indexedScopes.add(handle.scope)
          return snapshot
        }
      ),
    iterateRecordIndex: (query) =>
      recordIterator(
        scopeState.nativeState,
        scopeState.scope,
        query.range,
        new IndexedDbTransactionIndexSource(scopeState.nativeState, query)
      )
  }
}

export function indexedDbBackfillRenew<TValue>(
  sessionState: IIndexedDbBackfillSession<TValue>,
  ...args: Parameters<IRecordIndexBackfillSession<TValue>['renew']>
): ReturnType<IRecordIndexBackfillSession<TValue>['renew']> {
  const [renewCtx] = args
  return withMutationLease(sessionState.indexedDbContext, async (lease) => {
    assertSession(sessionState)
    assertLive(sessionState.indexedDbContext)
    const renewOperation = snapshotOperationContext(renewCtx)
    throwIfAborted(renewOperation?.signal)
    const renewRuntime = createStorageOperationRuntime()
    const renewDatabase = await open(sessionState.indexedDbContext, renewRuntime, lease)
    const transaction = createTransaction(renewDatabase, META_STORE_NAME, 'readwrite')
    const metadata = transaction.objectStore(META_STORE_NAME)
    const state = (await fromIdbRequest(
      metadata.get(indexMetadataKey(sessionState.handle.scope)),
      { signal: renewOperation?.signal },
      renewRuntime
    )) as
      | {
          handle?: IRecordIndexHandle
          lease?: IBackfillLease
        }
      | undefined
    if (
      state?.handle?.generation !== sessionState.handle.generation ||
      state.lease?.ownerToken !== sessionState.ownerToken
    )
      throw state?.handle?.generation !== sessionState.handle.generation
        ? staleIndexHandleError()
        : new StorageError(StorageErrorCode.unavailable, {
            backend: StorageBackend.indexedDb
          })
    const currentLease = state.lease
    const nextHeartbeatRevision = (currentLease?.heartbeatRevision ?? 0) + 1
    sessionState.sessionHeartbeatRevision = nextHeartbeatRevision
    metadata.put(
      {
        ...state,
        lease: {
          ownerToken: sessionState.ownerToken,
          heartbeatRevision: nextHeartbeatRevision,
          leaseMs: currentLease?.leaseMs ?? sessionState.leaseMs
        }
      },
      indexMetadataKey(sessionState.handle.scope)
    )
    await idbTransactionCommit(transaction, { signal: renewOperation?.signal }, renewRuntime)
  })
}

export type IIndexedDbBackfillCommit<TValue> = {
  /** The existing metadata-owned session retains checkpoint and heartbeat authority. */
  readonly sessionState: IIndexedDbBackfillSession<TValue>
  /** Native commit consumes the caller batch accepted before the original lease wait. */
  readonly batch: IRecordIndexBackfillBatch
  /** Caller context retains the original deadline and cancellation owner. */
  readonly commitCtx: IOperationContext | undefined
  /** The original controller lease spans this complete native commit. */
  readonly lease: IMutationLeaseContext
  /** Metadata remains local to this original native commit operation. */
  metadata: IDBObjectStore

  /** State remains local to this original native commit operation. */
  state:
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

  /** ActiveLease remains local to this original native commit operation. */
  activeLease: IBackfillLease | undefined

  /** Sidecar remains local to this original native commit operation. */
  sidecar: IDBObjectStore

  /** Revisions remains local to this original native commit operation. */
  revisions: IDBObjectStore

  commitOperation: ReturnType<typeof snapshotOperationContext>

  batchPhase: IRecordIndexBackfillPhase

  batchIdentity: string

  commitRuntime: IStorageOperationRuntime

  commitDatabase: IDBDatabase

  transaction: IDBTransaction

  committed: Promise<void>
}

export function indexedDbBackfillCommitBatch<TValue>(
  sessionState: IIndexedDbBackfillSession<TValue>,
  batch: IRecordIndexBackfillBatch,
  commitCtx?: IOperationContext
): ReturnType<IRecordIndexBackfillSession<TValue>['commitBatch']> {
  return withMutationLease(sessionState.indexedDbContext, (lease) =>
    commitIndexedDbBackfillNative(sessionState, batch, commitCtx, lease)
  )
}

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
    throw new StorageError(StorageErrorCode.invalidConfig, {
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
        : new StorageError(StorageErrorCode.unavailable, {
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
        StorageErrorCode.indexBackfillFailed,
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
    throw new StorageError(StorageErrorCode.invalidConfig, {
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
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })

  sessionState.batchSize = sessionState.options.batchSize ?? LEGACY_MIGRATION_BATCH_SIZE

  sessionState.leaseMs = sessionState.options.leaseMs ?? INDEX_BACKFILL_DEFAULT_LEASE_MS

  if (
    !Number.isSafeInteger(sessionState.batchSize) ||
    sessionState.batchSize < INDEX_BACKFILL_MIN_BATCH_SIZE ||
    sessionState.batchSize > INDEX_BACKFILL_MAX_BATCH_SIZE
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })

  if (
    !Number.isSafeInteger(sessionState.leaseMs) ||
    sessionState.leaseMs < INDEX_BACKFILL_MIN_LEASE_MS ||
    sessionState.leaseMs > INDEX_BACKFILL_MAX_LEASE_MS
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
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
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })

  if (sessionState.phase === RecordIndexBackfillPhase.legacy && !sessionState.includeLegacy)
    throw new StorageError(StorageErrorCode.invalidConfig, {
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
        throw new StorageError(StorageErrorCode.invalidConfig, {
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
    throw new StorageError(StorageErrorCode.invalidConfig, {
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
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })
  if (
    issued.length > 0 &&
    (commitState.batch.nextCheckpoint === undefined ||
      encodeFlatStorageKey(commitState.batch.nextCheckpoint) !== issued[issued.length - 1]!.key)
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
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

export function createIndexedDbStoreIndexes<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): Pick<
  IIndexedDbStore<TValue>,
  | 'ensureRecordIndexes'
  | 'getRecordIndexReadiness'
  | 'putIndexedRecord'
  | 'iterateRecordIndex'
  | 'transactionIndexed'
> {
  return {
    ensureRecordIndexes: (
      scope: string,
      definitions: readonly IRecordIndexDefinition[],
      _ctx?: IOperationContext
    ) => ensureRecordIndexes(indexedDbContext, scope, definitions, _ctx),
    getRecordIndexReadiness: (handle: IRecordIndexHandle, ctx?: IOperationContext) =>
      withAbort(ctx, async (_signal, _context, runtime) => {
        if (!isValidIndexGeneration(handle.generation)) throw staleIndexHandleError()
        const database = await open(indexedDbContext, runtime)
        const transaction = createTransaction(database, META_STORE_NAME, 'readonly')
        const state = (await fromIdbRequest(
          transaction.objectStore(META_STORE_NAME).get(indexMetadataKey(handle.scope)),
          {},
          runtime
        )) as { handle?: IRecordIndexHandle; readiness?: IRecordIndexReadiness } | undefined
        if (state?.handle?.generation !== handle.generation) throw staleIndexHandleError()
        return state.readiness ?? { status: 'pending', scanned: 0, indexed: 0 }
      }),
    putIndexedRecord: (value, key, handle, projection, ctx) =>
      rootMutation(
        indexedDbContext,
        'putIndexedRecord',
        { value, key, handle, projection },
        ctx,
        { channel: 'record', kind: 'batch', displacedKind: 'batch' },
        ({ value, key, handle, projection }, context) => {
          const captured = snapshotStorageKey(key, StorageBackend.indexedDb)
          const copy = snapshotWriteValue(value, captured)
          const capturedHandle = snapshotWriteValue(handle, captured)
          const capturedProjection = snapshotWriteValue(projection, captured)
          return {
            keys: rootKeys('record', captured, context),
            run: async (scope) => {
              return scope.putIndexedRecord!(
                copy,
                captured,
                capturedHandle,
                capturedProjection,
                context
              )
            }
          }
        }
      ),
    iterateRecordIndex: (...args) => iterateIndexedDbIndex(indexedDbContext, ...args),
    transactionIndexed: (handle, run, ctx) =>
      withMutationLease(indexedDbContext, (lease) =>
        runTransaction(
          indexedDbContext,
          (scope) => {
            if (!isValidIndexGeneration(handle.generation)) throw staleIndexHandleError()
            return run(scope)
          },
          ctx,
          lease
        )
      )
  }
}

export type IIndexedDbIndexIterator<TValue> = {
  /** Original indexedDbContext belongs to this bounded native iterator. */
  readonly indexedDbContext: IIndexedDbContext<TValue>
  /** Original query belongs to this bounded native iterator. */
  readonly query: IRecordIndexQuery
  /** Original _ctx belongs to this bounded native iterator. */
  readonly _ctx?: IOperationContext

  /** Range belongs to this original bounded index cursor. */
  range: ReturnType<typeof snapshotKeyRange>

  /** Direction belongs to this original bounded index cursor. */
  direction: IDBCursorDirection

  /** Prefix belongs to this original bounded index cursor. */
  prefix: IDBValidKey[]

  /** PageSize belongs to this original bounded index cursor. */
  pageSize: number

  /** ExpectedEpoch belongs to this original bounded index cursor. */
  expectedEpoch: { readonly global: number; readonly scope: number } | undefined

  /** Continuation belongs to this original bounded index cursor. */
  continuation: IDBValidKey[] | undefined

  /** Emitted belongs to this original bounded index cursor. */
  emitted: number

  /** Exhausted belongs to this original bounded index cursor. */
  exhausted: boolean

  /** One deadline and abort subscription belong to the entire iterator, including yields. */
  runtime: IStorageOperationRuntime
  /** The same merged signal owns cancellation and cleanup for the full iterator. */
  merged: ReturnType<typeof mergeSignals>
  /** The original merged signal port belongs to this iterator only. */
  signal: ReturnType<typeof mergeSignals>['signal']
  /** The original merged dispose port belongs to this iterator only. */
  disposeSignal: ReturnType<typeof mergeSignals>['dispose']
  /** The original merged context port belongs to this iterator only. */
  context: ReturnType<typeof mergeSignals>['context']
}

export async function* indexedDbIndexRows<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  query: IRecordIndexQuery,
  _ctx?: IOperationContext
): AsyncGenerator<[IStorageKey, TValue], void, unknown> {
  /** State initializes on the first native advance, preserving the original lazy input boundary. */
  const iteratorState = { indexedDbContext, query, _ctx } as IIndexedDbIndexIterator<TValue>

  assertLive(iteratorState.indexedDbContext)

  if (!isValidIndexGeneration(iteratorState.query.handle.generation)) throw staleIndexHandleError()

  /** One deadline and abort subscription belong to the entire iterator, including yields. */
  iteratorState.runtime = createStorageOperationRuntime()
  iteratorState.merged = mergeSignals(iteratorState._ctx, iteratorState.runtime.reporter)
  iteratorState.signal = iteratorState.merged.signal
  iteratorState.disposeSignal = iteratorState.merged.dispose
  iteratorState.context = iteratorState.merged.context

  try {
    throwIfAborted(iteratorState.signal)
    if (!iteratorState.indexedDbContext.keyRange)
      throw new StorageError(StorageErrorCode.unavailable, {
        backend: StorageBackend.indexedDb,
        cause: new Error('IDBKeyRange is unavailable; pass options.keyRange explicitly')
      })
    iteratorState.range = snapshotKeyRange(iteratorState.query.range, StorageBackend.indexedDb)
    iteratorState.direction = iteratorState.query.direction === 'prev' ? 'prev' : 'next'
    iteratorState.prefix = [
      iteratorState.query.handle.scope,
      iteratorState.query.index,
      iteratorState.query.handle.generation
    ]
    /** Bounded per short readonly transaction; keeps pages small and predictable. */
    iteratorState.pageSize = INDEX_QUERY_PAGE_SIZE
    /**
     * `{global, scope}` mutation-epoch vector observed on the first page; every later page must
     * match.
     */

    /**
     * Full sidecar primary key ([scope, indexName, generation, indexValue, recordKey]) of the last
     * cursor position visited. The `lookup` index key alone ([scope, indexName, generation,
     * indexValue]) is not unique when an index value is shared by multiple records, so a page
     * boundary falling inside such a tied group must resume by primary key, not by index key: the
     * next page's range is bounded _inclusively_ at the boundary group's index key (so remaining
     * ties are not dropped), and every cursor entry already emitted is then skipped by comparing
     * full primary keys until this position is passed.
     */

    iteratorState.emitted = 0
    iteratorState.exhausted = false
    while (!iteratorState.exhausted) {
      assertLive(iteratorState.indexedDbContext)
      throwIfAborted(iteratorState.signal)
      if (
        iteratorState.query.limit !== undefined &&
        iteratorState.emitted >= iteratorState.query.limit
      )
        break

      /** One bounded native page shares continuation and epoch observations with its iterator. */
      const pageState: IIndexedDbIndexPage<TValue> = {
        iteratorState,
        page: [],
        cursorExhausted: true
      }
      await readIndexedDbIndexPage(pageState)
      for (const entry of pageState.page) {
        throwIfAborted(pageState.iteratorState.signal)
        if (
          pageState.iteratorState.query.limit !== undefined &&
          pageState.iteratorState.emitted >= pageState.iteratorState.query.limit
        ) {
          pageState.iteratorState.exhausted = true
          break
        }
        pageState.iteratorState.emitted += 1
        yield entry
      }
      if (pageState.cursorExhausted) pageState.iteratorState.exhausted = true
    }
  } finally {
    iteratorState.disposeSignal()
  }
}

export type IIndexedDbIndexPage<TValue> = {
  /** Continuation, cancellation and epochs remain with the original iterator. */
  readonly iteratorState: IIndexedDbIndexIterator<TValue>
  /** At most the original page bound of selected native values is retained. */
  readonly page: Array<[IStorageKey, TValue]>
  /** The original native cursor reports whether another page can exist. */
  cursorExhausted: boolean
}

export function readIndexedDbIndexPage<TValue>(
  pageState: IIndexedDbIndexPage<TValue>
): Promise<void> {
  return withMutationLease(pageState.iteratorState.indexedDbContext, (lease) =>
    runTransaction(
      pageState.iteratorState.indexedDbContext,
      (scope) => readIndexedDbIndexNativePage(pageState, scope),
      {
        signal: pageState.iteratorState.signal,
        ...(pageState.iteratorState.context?.orgId === undefined
          ? {}
          : { orgId: pageState.iteratorState.context.orgId })
      },
      lease,
      false,
      {
        executeAttempt: (_context, proceed) => proceed(),
        lock: () => [],
        ranges: () => [
          {
            channel: 'record',
            ...snapshotConcurrencyLockRange({ channel: 'record' }, StorageBackend.indexedDb)
          }
        ],
        notification: { channel: 'record', kind: 'remove' }
      }
    )
  )
}

export async function readIndexedDbIndexNativePage<TValue>(
  pageState: IIndexedDbIndexPage<TValue>,
  scope: IIndexedDbTransactionScope<TValue>
): Promise<void> {
  const { id } = assertTransactionOwner(
    pageState.iteratorState.indexedDbContext.construction.store,
    scope
  )
  const nativeState = pageState.iteratorState.indexedDbContext.nativeTransactions.get(id)
  if (nativeState === undefined)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  const transaction = nativeState.native
  await assertIndexedDbIndexPage(pageState, transaction)
  const index = transaction.objectStore(INDEX_RECORDS_STORE_NAME).index('lookup')
  /**
   * The boundary group's index key ([scope, indexName, generation, indexValue]) is bound
   * inclusively so records tied with the last-visited entry are not dropped; already-visited ties
   * are skipped below by comparing full primary keys.
   */
  const continuationIndexKey = pageState.iteratorState.continuation?.slice(0, 4)
  const cursorRange = toIdbRecordIndexRange(
    pageState.iteratorState.range,
    pageState.iteratorState.prefix,
    pageState.iteratorState.indexedDbContext.keyRange!,
    pageState.iteratorState.direction,
    pageState.iteratorState.continuation
  )
  const cursorRequest = index.openKeyCursor(cursorRange, pageState.iteratorState.direction)
  let cursor = (await fromIdbRequest(
    cursorRequest,
    { signal: pageState.iteratorState.signal },
    pageState.iteratorState.runtime
  )) as IDBCursor | null
  cursor = await seekIndexedDbIndexCursor(pageState, cursorRequest, cursor, continuationIndexKey)
  let scannedInPage = 0
  while (cursor !== null && scannedInPage < pageState.iteratorState.pageSize) {
    assertLive(pageState.iteratorState.indexedDbContext)
    throwIfAborted(pageState.iteratorState.signal)
    scannedInPage += 1
    const lookupKey = cursor.key
    if (
      !Array.isArray(lookupKey) ||
      lookupKey.length !== 4 ||
      lookupKey[0] !== pageState.iteratorState.prefix[0] ||
      lookupKey[1] !== pageState.iteratorState.prefix[1] ||
      lookupKey[2] !== pageState.iteratorState.prefix[2]
    ) {
      cursor.continue()
      cursor = (await fromIdbRequest(
        cursorRequest,
        { signal: pageState.iteratorState.signal },
        pageState.iteratorState.runtime
      )) as IDBCursor | null
      continue
    }
    const primaryKey = cursor.primaryKey as IDBValidKey[]
    pageState.iteratorState.continuation = primaryKey
    const recordKey = primaryKey[4] as IStorageKey
    const indexValue = primaryKey[3] as IStorageKey
    if (isStorageKeyInRange(indexValue, pageState.iteratorState.range)) {
      const value = await scope.getRecord(recordKey)
      if (value === undefined && !(await nativeState.expiredRecord(recordKey)))
        pageState.iteratorState.runtime.reporter(
          new StorageError(
            StorageErrorCode.indexOrphan,
            { backend: StorageBackend.indexedDb, key: recordKey },
            StorageErrorText.indexOrphan
          )
        )
      else if (value !== undefined) pageState.page.push([recordKey, value])
    }
    cursor.continue()
    cursor = (await fromIdbRequest(
      cursorRequest,
      { signal: pageState.iteratorState.signal },
      pageState.iteratorState.runtime
    )) as IDBCursor | null
  }
  pageState.cursorExhausted = cursor === null
  // Account only this page's own TTL removals; unrelated between-page mutations still invalidate.
  pageState.iteratorState.expectedEpoch = await nativeState.recordEpoch(
    pageState.iteratorState.query.handle.scope
  )
}

export async function assertIndexedDbIndexPage<TValue>(
  pageState: IIndexedDbIndexPage<TValue>,
  transaction: IDBTransaction
): Promise<void> {
  const revisionsStore = transaction.objectStore(REVISIONS_STORE_NAME)
  const globalEpoch =
    ((await fromIdbRequest(
      revisionsStore.get(RECORD_EPOCH_KEY) as IDBRequest<number | undefined>,
      { signal: pageState.iteratorState.signal },
      pageState.iteratorState.runtime
    )) as number | undefined) ?? 0
  const scopeEpoch =
    ((await fromIdbRequest(
      revisionsStore.get(
        indexScopeEpochKey(pageState.iteratorState.query.handle.scope)
      ) as IDBRequest<number | undefined>,
      { signal: pageState.iteratorState.signal },
      pageState.iteratorState.runtime
    )) as number | undefined) ?? 0
  if (pageState.iteratorState.expectedEpoch === undefined)
    pageState.iteratorState.expectedEpoch = { global: globalEpoch, scope: scopeEpoch }
  else if (
    pageState.iteratorState.expectedEpoch.global !== globalEpoch ||
    pageState.iteratorState.expectedEpoch.scope !== scopeEpoch
  )
    throw new StorageError(
      StorageErrorCode.indexQueryInvalidated,
      { backend: StorageBackend.indexedDb },
      StorageErrorText.indexQueryInvalidated
    )
  const state = (await fromIdbRequest(
    transaction
      .objectStore(META_STORE_NAME)
      .get(indexMetadataKey(pageState.iteratorState.query.handle.scope)),
    { signal: pageState.iteratorState.signal },
    pageState.iteratorState.runtime
  )) as { handle?: IRecordIndexHandle; readiness?: IRecordIndexReadiness } | undefined
  if (state?.handle?.generation !== pageState.iteratorState.query.handle.generation)
    throw staleIndexHandleError()
  if (state.readiness?.status !== 'complete')
    throw new StorageError(StorageErrorCode.unavailable, {
      backend: StorageBackend.indexedDb,
      cause: new Error('record index is not complete; caller must use fallback scan')
    })
}

export async function seekIndexedDbIndexCursor<TValue>(
  pageState: IIndexedDbIndexPage<TValue>,
  cursorRequest: IDBRequest<IDBCursor | null>,
  cursor: IDBCursor | null,
  continuationIndexKey: IDBValidKey[] | undefined
): Promise<IDBCursor | null> {
  if (
    cursor !== null &&
    pageState.iteratorState.continuation !== undefined &&
    continuationIndexKey !== undefined
  ) {
    /**
     * The inclusive range may land the fresh cursor before, exactly at, or already past the
     * last-visited entry, and each case needs different handling: `continuePrimaryKey` throws
     * `DataError` if asked to move to a position at-or-before the cursor's _current_ one (per spec,
     * even requesting the cursor's own exact position is rejected), so an exact match must use a
     * plain single-step `continue()` instead, and an already-past position needs no skip at all.
     * When the cursor is still strictly before the previous continuation (earlier not-yet-skipped
     * ties in the same index-key group), `continuePrimaryKey` jumps straight past it in one
     * engine-side seek. Either branch is O(1) regardless of tie-group size, unlike a JS walk over
     * every already-emitted tied entry, which would be `Θ(G)` per page and quadratic across a group
     * spanning multiple pages (paging requires `O(pageSize)` per page to avoid resource
     * exhaustion).
     */
    const currentPrimaryKey = cursor.primaryKey as IDBValidKey[]
    const comparison = compareStorageKeys(
      currentPrimaryKey as unknown as IStorageKey,
      pageState.iteratorState.continuation as unknown as IStorageKey
    )
    const isBeforeContinuation =
      pageState.iteratorState.direction === 'prev' ? comparison > 0 : comparison < 0
    if (isBeforeContinuation) {
      /**
       * `continuePrimaryKey` finds the first record whose (index key, primary key) is _inclusive_
       * of the given pair — it may land exactly back on `continuation` itself if that sidecar row
       * still exists, not strictly past it. The single `.continue()` correction below then steps
       * past it deterministically.
       */
      cursor.continuePrimaryKey(
        continuationIndexKey,
        pageState.iteratorState.continuation as unknown as IDBValidKey
      )
      cursor = (await fromIdbRequest(
        cursorRequest,
        { signal: pageState.iteratorState.signal },
        pageState.iteratorState.runtime
      )) as IDBCursor | null
    }
    if (cursor !== null) {
      const landedPrimaryKey = cursor.primaryKey as IDBValidKey[]
      const stillAtContinuation =
        compareStorageKeys(
          landedPrimaryKey as unknown as IStorageKey,
          pageState.iteratorState.continuation as unknown as IStorageKey
        ) === 0
      if (stillAtContinuation) {
        cursor.continue()
        cursor = (await fromIdbRequest(
          cursorRequest,
          { signal: pageState.iteratorState.signal },
          pageState.iteratorState.runtime
        )) as IDBCursor | null
      }
    }
  }
  return cursor
}
/**
 * Explicit indexes own native planning, readiness and generation-safe backfill on the original
 * store.
 */
export class IndexedDbIndexesAssembly {
  /** Allocate only the selected index owner's existing lease observations and monotonic clock. */
  initialize<T>(context: IIndexedDbContext<T>): void {
    context.backfillMonotonicNow = createMonotonicClock()
    context.backfillTakeoverObservations = new Map<string, number>()
  }
  readonly ensureSchema = ensureIndexedDbIndexSchema
  readonly validateSchema = validateIndexedDbIndexSchema
  readonly beforeCommit = validateIndexedDbUniqueCommit
  readonly assertHandle = assertHandle
  readonly register = registerIndexedDbBackfill
  readonly api = createIndexedDbStoreIndexes
  readonly scope = createIndexedDbScopeIndexes
}

/** Native secondary-index schema is validated only by its explicitly selected owner. */
function validateIndexedDbIndexSchema(database: IDBDatabase): void {
  /** Compare IndexedDB key paths without accepting a widened or reordered tuple. */
  const sameKeyPath = (actual: string | string[] | null, expected: readonly string[]): boolean =>
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index])

  /** Reject an owned sidecar index whose complete signature does not match the fixed layout. */
  const assertSidecarIndex = (
    sidecar: IDBObjectStore,
    name: string,
    keyPath: readonly string[]
  ): void => {
    if (!sidecar.indexNames.contains(name))
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: StorageBackend.indexedDb,
        operation: StorageOperation.indexedDbSchema,
        cause: new TypeError(`IndexedDB sidecar index ${name} is missing`)
      })
    const index = sidecar.index(name)
    if (!sameKeyPath(index.keyPath, keyPath) || index.unique || index.multiEntry)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: StorageBackend.indexedDb,
        operation: StorageOperation.indexedDbSchema,
        cause: new TypeError(`IndexedDB sidecar index ${name} has an incompatible signature`)
      })
  }
  /** Reject physical layouts that add an unowned index to the fixed sidecar schema. */
  const assertExactSidecarIndexes = (sidecar: IDBObjectStore): void => {
    const actualNames: string[] = []
    for (let index = 0; index < sidecar.indexNames.length; index += 1) {
      const name = sidecar.indexNames.item(index)
      if (name !== null) actualNames.push(name)
    }
    actualNames.sort()
    if (actualNames.join('\u0000') !== ['lookup', 'record'].join('\u0000'))
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: StorageBackend.indexedDb,
        operation: StorageOperation.indexedDbSchema,
        cause: new TypeError('IndexedDB sidecar index set is incompatible')
      })
  }
  const sidecar = database
    .transaction(INDEX_RECORDS_STORE_NAME, 'readonly')
    .objectStore(INDEX_RECORDS_STORE_NAME)
  const keyPath = sidecar.keyPath
  if (!sameKeyPath(keyPath, ['scope', 'indexName', 'generation', 'indexValue', 'recordKey']))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      operation: StorageOperation.indexedDbSchema,
      cause: new TypeError('IndexedDB sidecar layout is incompatible')
    })
  assertExactSidecarIndexes(sidecar)
  assertSidecarIndex(sidecar, 'lookup', ['scope', 'indexName', 'generation', 'indexValue'])
  assertSidecarIndex(sidecar, 'record', ['scope', 'generation', 'recordKey'])
}
/** Add the native sidecar only when indexes are selected; existing database upgrades remain native. */
function ensureIndexedDbIndexSchema(database: IDBDatabase): boolean {
  let created = false
  if (!database.objectStoreNames.contains(INDEX_RECORDS_STORE_NAME)) {
    const indexRecords = database.createObjectStore(INDEX_RECORDS_STORE_NAME, {
      keyPath: ['scope', 'indexName', 'generation', 'indexValue', 'recordKey']
    })
    indexRecords.createIndex('lookup', ['scope', 'indexName', 'generation', 'indexValue'], {
      unique: false
    })
    indexRecords.createIndex('record', ['scope', 'generation', 'recordKey'], {
      unique: false
    })
    created = true
  }
  return created
}

/** Validate final native unique ownership before the original transaction commits. */
function validateIndexedDbUniqueCommit<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>
): Promise<void> {
  return validateIndexedDbUniqueOwners(nativeState)
}
/** Inspect final sidecars and TTL presence without adding another transaction owner. */
async function validateIndexedDbUniqueOwners<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>
): Promise<void> {
  for (const { handle, indexName, indexValue } of nativeState.uniqueChecks.values()) {
    const owners = await request(nativeState, () =>
      nativeState.native
        .objectStore(INDEX_RECORDS_STORE_NAME)
        .index('lookup')
        .getAllKeys([handle.scope, indexName, handle.generation, toIdbKey(indexValue)])
    )
    let liveOwners = 0
    for (const owner of owners) {
      const key = (owner as IDBValidKey[])[4] as IStorageKey
      if (await nativeState.ttlAccess.present('record', key)) liveOwners += 1
    }
    if (liveOwners > 1)
      throw new StorageError(
        StorageErrorCode.indexUniqueConflict,
        { backend: StorageBackend.indexedDb },
        indexUniqueConflictText(indexName)
      )
  }
}

export const toIdbRecordIndexRange = (
  range: IKeyRange | undefined,
  prefix: readonly IDBValidKey[],
  KeyRange: typeof IDBKeyRange,
  direction: IDBCursorDirection,
  continuation: readonly IDBValidKey[] | undefined
): IDBKeyRange => {
  const snapshot = range
  if (typeof prefix[2] !== 'string' || prefix[2].includes('\u0000'))
    throw new StorageError(StorageErrorCode.invalidConfig, { backend: StorageBackend.indexedDb })
  let lower: IDBValidKey[] =
    snapshot?.lower === undefined ? [...prefix] : [...prefix, toIdbKey(snapshot.lower)]
  let upper: IDBValidKey[] =
    snapshot?.upper === undefined
      ? [prefix[0]!, prefix[1]!, `${prefix[2]}\u0000`]
      : [...prefix, toIdbKey(snapshot.upper)]
  let lowerOpen = snapshot?.lowerOpen ?? false
  let upperOpen = snapshot?.upperOpen ?? snapshot?.upper === undefined
  const continuationIndexKey = continuation?.slice(0, 4)
  if (continuationIndexKey !== undefined) {
    if (
      direction === 'prev' &&
      (snapshot?.upper === undefined ||
        compareStorageKeys(continuationIndexKey[3] as IStorageKey, snapshot.upper) < 0)
    ) {
      upper = continuationIndexKey
      upperOpen = false
    } else if (
      direction !== 'prev' &&
      (snapshot?.lower === undefined ||
        compareStorageKeys(continuationIndexKey[3] as IStorageKey, snapshot.lower) > 0)
    ) {
      lower = continuationIndexKey
      lowerOpen = false
    }
  }
  return KeyRange.bound(lower, upper, lowerOpen, upperOpen)
}

/** Native index cursors retain authoritative-record reads and the original orphan policy. */
class IndexedDbTransactionIndexSource<
  TValue,
  T
> implements IIndexedDbTransactionRecordSource<TValue> {
  /** Original native scope owns requests, selected TTL policy and rollback. */
  readonly #nativeState: IIndexedDbNativeCallback<TValue, T>
  /** Validated query belongs to the immutable operation's existing captured input. */
  readonly #query: IRecordIndexQuery
  readonly operation = StorageTransactionOperation.iterateRecordIndex
  readonly limit: number | undefined
  /** Capture only the same native state and query; no parallel transaction exists. */
  constructor(nativeState: IIndexedDbNativeCallback<TValue, T>, query: IRecordIndexQuery) {
    this.#nativeState = nativeState
    this.#query = query
    this.limit = query.limit
  }
  /** Validate the current handle before opening its one native sidecar cursor. */
  async open(range: IKeyRange | undefined): Promise<IDBRequest<IDBCursorWithValue | null>> {
    await assertHandle(this.#nativeState, this.#query.handle)
    const context = this.#nativeState.attemptState.logicalTransaction.indexedDbContext
    if (context.keyRange === undefined)
      throw new StorageError(StorageErrorCode.unavailable, { backend: StorageBackend.indexedDb })
    const direction = this.#query.direction === 'prev' ? 'prev' : 'next'
    const prefix = [this.#query.handle.scope, this.#query.index, this.#query.handle.generation]
    return this.#nativeState.native
      .objectStore(INDEX_RECORDS_STORE_NAME)
      .index('lookup')
      .openCursor(
        toIdbRecordIndexRange(range, prefix, context.keyRange, direction, undefined),
        direction
      )
  }
  /** Read the authoritative row and distinguish expired data from an orphaned index entry. */
  async row(cursor: IDBCursorWithValue): Promise<[IStorageKey, TValue] | undefined> {
    const key = (cursor.value as { recordKey: IStorageKey }).recordKey
    if (await this.#nativeState.ttlAccess.present('record', key)) {
      const value = (await request(this.#nativeState, () =>
        this.#nativeState.native
          .objectStore(
            this.#nativeState.attemptState.logicalTransaction.indexedDbContext.recordsStoreName
          )
          .get(toIdbKey(key))
      )) as TValue | undefined
      if (value !== undefined) return [key, value]
    } else if (await this.#nativeState.ttlAccess.expired('record', key)) return undefined
    throw new StorageError(
      StorageErrorCode.indexOrphan,
      { backend: StorageBackend.indexedDb },
      StorageErrorText.indexOrphan
    )
  }
}

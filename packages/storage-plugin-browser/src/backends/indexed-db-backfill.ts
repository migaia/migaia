// Backfill sessions, batches, scope indexes and lease renewal for the IndexedDB index assembly (see ./indexed-db-indexes-assembly.ts).
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import {
  createStorageOperationRuntime,
  type IStorageOperationRuntime,
  throwIfAborted,
  snapshotOperationContext,
  snapshotStorageKey,
  encodeFlatStorageKey,
  snapshotKeyRange,
  createStorageToken
} from '@migaia/storage-host/sdk'
import { StorageError } from '../types/errors.ts'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageBackend, StorageTransactionOperation } from '../constants.ts'
import { collectUniqueIndexOwners } from './backend-errors.ts'
import { fromIdbRequest, idbTransactionCommit } from '../utils/idb-request.ts'
import type { IKeyRange, IOperationContext, IStorageKey } from '../types/context.ts'
import type {
  IRecordIndexDefinition,
  IRecordIndexHandle,
  IRecordIndexReadiness
} from '@migaia/storage-contract'
import { readTransactionConflictPolicy } from '@migaia/storage-contract'
import {
  RecordIndexBackfillPhase,
  registerRecordIndexBackfillStore,
  type IRecordIndexBackfillBatch,
  type IRecordIndexBackfillCandidate,
  type IRecordIndexBackfillPhase,
  type IRecordIndexBackfillReadOptions,
  type IRecordIndexBackfillRetryReceipt,
  type IRecordIndexBackfillSession
} from '@migaia/storage-host/entity'
import {
  IBackfillLease,
  IIndexedDbContext,
  IIndexedDbNativeCallback,
  IIndexedDbScopeContext,
  IIndexedDbTransactionScope,
  IMutationLeaseContext,
  INDEX_RECORDS_STORE_NAME,
  META_STORE_NAME,
  REVISIONS_STORE_NAME,
  assertLive,
  createTransaction,
  indexMetadataKey,
  indexedDbScopeOperation,
  isValidIndexGeneration,
  open,
  recordIterator,
  recordRevisionKey,
  request,
  snapshotWriteValue,
  staleIndexHandleError,
  toIdbKey,
  toIdbRange,
  withMutationLease,
  write
} from './indexed-db.ts'
import {
  validateIndexedDbBackfillSession,
  acquireIndexedDbBackfillLease,
  prepareIndexedDbBackfillCandidates,
  indexedDbBackfillFail,
  commitIndexedDbBackfillNative
} from './indexed-db-backfill-commit.ts'
import {
  ensureRecordIndexes,
  IndexedDbTransactionIndexSource
} from './indexed-db-indexes-assembly.ts'

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
    throw new StorageError(StorageBrowserErrorCode.unavailable, {
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
        : new StorageError(StorageBrowserErrorCode.unavailable, {
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

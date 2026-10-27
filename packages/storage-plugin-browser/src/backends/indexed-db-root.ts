// Native data access, transaction loops, root operations and store/record API objects for the IndexedDB backend (see ./indexed-db.ts).
import { IndexedDbFeature } from '../constants.js'
import type { createIndexedDbJournalImages } from './indexed-db-images.js'
import type { createIndexedDbTtlAccess } from './indexed-db-ttl.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  records,
  type ITransactionOptions,
  type ILockKey,
  type IRecordQuerySource,
  type ITransactionRecordsApi
} from '@migaia/storage-contract'
import {
  assertTransactionOwner,
  runWithConcurrency,
  snapshotConcurrencyLockRange,
  lockKey,
  createRecordQueryWithoutKeyset,
  snapshotStorageKeyPrefix,
  createStorageOperationReporter,
  reportCleanupError,
  type IStorageOperationRuntime,
  withAbort,
  encodeFlatStorageKey
} from '@migaia/storage-host/sdk'
import { isStorageErrorFamily } from './backend-errors.js'
import { StorageError } from '../types/errors.js'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageBackend, StorageOperation, storageBackendOperation } from '../constants.js'
import { normalizeError } from './backend-errors.js'
import {
  fromIdbRequest,
  idbTransactionCommit,
  installIdbOpenRequestHandlers,
  readIdbRequestError
} from '../utils/idb-request.js'
import type { IOperationContext, IStorageKey, IWriteOptions } from '../types/context.js'
import type { IRecordIndexHandle } from '@migaia/storage-contract'
import { assertTransactionCallback, type ITransactionScope } from '@migaia/storage-contract'
import { IndexedDbBaseAccess, indexedDbFeatureMissing } from './indexed-db-base-access.js'
import type { IBackendRuntime } from './construction.js'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { observeIndexedDbStage } from './indexed-db-transaction.js'
import { runIndexedDbConcurrencyAttempt } from './indexed-db-construction.js'
import {
  META_STORE_NAME,
  REVISIONS_STORE_NAME,
  INDEX_RECORDS_STORE_NAME,
  INTERNAL_META_NAMESPACE,
  toIdbKey,
  readIndexedDbBytes,
  RECORD_EPOCH_KEY,
  normalizeIndexedDbOperationError
} from './indexed-db-layout.js'
import {
  assertLive,
  recordRevisionKey,
  applyRawMutationFirewall,
  classifyLegacyMutationBatch,
  indexMetadataKey,
  indexScopeEpochKey,
  withMutationLease,
  closeForTransition
} from './indexed-db-lifecycle.js'
import { open, createTransaction } from './indexed-db-open.js'
import {
  createIndexedDbStoreText,
  createIndexedDbStoreObservation,
  createIndexedDbMetadata,
  createIndexedDbStoreBytes,
  createIndexedDbStoreRecords,
  createIndexedDbStoreTransactions
} from './indexed-db-store-channels.js'
import { publishChange, indexedDbSignalFailure, recordQueryPushdown } from './indexed-db.js'
import type {
  IIndexedDbContext,
  IMutationLeaseContext,
  IIndexedDbTransactionScope,
  IRootMode,
  IRootPrepared
} from './indexed-db.js'

/**
 * Keep the original read lifetime; data projections may lazily expire through its same native
 * snapshot.
 */
export async function readFrom<TValue, T>(
  indexedDbContext: IIndexedDbContext<TValue>,
  storeName: string,
  run: (store: IDBObjectStore) => IDBRequest<T>,
  signal: AbortSignal | undefined,
  runtime: IStorageOperationRuntime,
  project?: (value: T, access: ReturnType<typeof createNativeDataAccess>) => Promise<T>
): Promise<T> {
  const database = await open(indexedDbContext, runtime)
  assertLive(indexedDbContext)
  const transaction = createTransaction(
    database,
    project === undefined
      ? storeName
      : [
          indexedDbContext.kvStoreName,
          indexedDbContext.bytesStoreName,
          indexedDbContext.recordsStoreName,
          META_STORE_NAME,
          REVISIONS_STORE_NAME,
          ...(database.objectStoreNames.contains(INDEX_RECORDS_STORE_NAME)
            ? [INDEX_RECORDS_STORE_NAME]
            : [])
        ],
    project === undefined ? 'readonly' : 'readwrite'
  )
  const access =
    project === undefined
      ? undefined
      : createNativeDataAccess(
          indexedDbContext,
          transaction,
          undefined,
          runtime,
          (make) => fromIdbRequest(make(), undefined, runtime),
          (
            channel: 'value' | 'bytes' | 'record',
            key: IStorageKey,
            context?: Parameters<IIndexedDbContext<TValue>['coordination']['keyPort']['probe']>[2]
          ) => assertExpiryRemoval(indexedDbContext, channel, key, context)
        )
  /** Native setup cannot leak a mutation lease; the existing controller owns actual accepted I/O. */
  const release = project === undefined ? () => {} : indexedDbContext.controller.beginMutation()
  const committed = idbTransactionCommit(transaction, { signal }, runtime)
  void committed.catch(() => {})
  try {
    const request = fromIdbRequest(
      run(transaction.objectStore(storeName)),
      { signal },
      runtime
    ).then(async (value) => {
      if (project === undefined) return value
      const projected = await project(value, access!)
      await access!.finishIndexes()
      return projected
    })
    const [value] = await Promise.all([request, committed])
    if (access !== undefined)
      for (const [channel, keys] of access.changed)
        if (keys.size > 0)
          publishChange(indexedDbContext, { channel, kind: 'remove', keys: [...keys.values()] })
    return value
  } catch (cause) {
    try {
      transaction.abort()
    } catch {
      /* transaction already settled */
    }
    await committed.catch(() => {})
    const signalFailure = indexedDbSignalFailure(signal)
    if (signalFailure) throw signalFailure
    if (isStorageErrorFamily(cause)) throw cause
    throw normalizeError(
      cause,
      StorageBackend.indexedDb,
      StorageBrowserErrorCode.transactionFailed,
      StorageOperation.indexedDbRead
    )
  } finally {
    release()
  }
}

/** Every caller already holds a mutation lease; resolve only after the native write commits. */
export async function writeTo<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  storeName: string,
  run: (store: IDBObjectStore) => unknown,
  signal: AbortSignal | undefined,
  runtime: IStorageOperationRuntime,
  inheritedLease: IMutationLeaseContext
): Promise<void> {
  const database = await open(indexedDbContext, runtime, inheritedLease)
  const transaction = createTransaction(database, storeName, 'readwrite')
  const committed = idbTransactionCommit(transaction, { signal }, runtime)
  void committed.catch(() => {})
  if (indexedDbSignalFailure(signal)) {
    await committed
    return
  }
  try {
    run(transaction.objectStore(storeName))
  } catch (cause) {
    try {
      transaction.abort()
    } catch {
      /* already settled */
    }
    /** Capture the original write failure before waiting for native rollback cleanup. */
    const failure = new StorageError(StorageBrowserErrorCode.transactionFailed, {
      backend: StorageBackend.indexedDb,
      cause
    })
    await committed.catch(() => {})
    throw failure
  }
  await committed
}

/** Lazy expiry is a write only when a live native target is actually removed. */
export function assertExpiryRemoval<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  channel: 'value' | 'bytes' | 'record',
  key: IStorageKey,
  context?: Parameters<IIndexedDbContext<TValue>['coordination']['keyPort']['probe']>[2]
): void {
  const lockChannel = channel === 'value' ? 'text' : channel
  const range = snapshotConcurrencyLockRange(
    { channel: lockChannel, prefix: key },
    StorageBackend.indexedDb
  )
  const held = indexedDbContext.coordination.keyPort.probe(
    [],
    [{ channel: lockChannel, ...range }],
    context
  )
  if (held !== undefined)
    throw new StorageContractError(StorageContractErrorCode.writeConflict, {
      backend: StorageBackend.indexedDb,
      keys: [held.key],
      holder: held.holder
    })
}

/**
 * Physical expiry reuses the original deletion, revision and sidecar primitives in its owning
 * native transaction.
 */
/** Own physical data, revision, image and TTL ports for one already-open native transaction. */
class IndexedDbNativeDataAccess<TValue> {
  /** The original indexedDbContext port belongs to this physical native transaction. */
  #indexedDbContext: IIndexedDbContext<TValue>
  /** The original native port belongs to this physical native transaction. */
  #native: IDBTransaction
  /** The original signal port belongs to this physical native transaction. */
  #signal: AbortSignal | undefined
  /** The original operationRuntime port belongs to this physical native transaction. */
  #operationRuntime: IStorageOperationRuntime
  /** The original request port belongs to this physical native transaction. */
  #request: <R>(make: () => IDBRequest<R>) => Promise<R>
  /** The original assertRemoval port belongs to this physical native transaction. */
  #assertRemoval: ((channel: 'value' | 'bytes' | 'record', key: IStorageKey) => void) | undefined

  /** Per-channel insertion order gives one post-commit batch with no duplicate keys. */
  readonly changed = new Map<'value' | 'bytes' | 'record', Map<string, IStorageKey>>()

  /** Indexed writes update one scope epoch in this same transaction. */
  readonly indexedScopes = new Set<string>()

  /**
   * Complete point revisions share this existing native revision store, including non-journal
   * writers.
   */
  readonly journalImages: ReturnType<typeof createIndexedDbJournalImages>

  /** Snapshot metadata borrows the same original physical request/deletion path. */
  readonly ttlAccess: ReturnType<typeof createIndexedDbTtlAccess>
  /** Initialize native image and deadline adapters on the same original physical request path. */
  constructor(
    indexedDbContext: IIndexedDbContext<TValue>,
    native: IDBTransaction,
    signal: AbortSignal | undefined,
    operationRuntime: IStorageOperationRuntime,
    request: <R>(make: () => IDBRequest<R>) => Promise<R>,
    assertRemoval?: (channel: 'value' | 'bytes' | 'record', key: IStorageKey) => void
  ) {
    this.#indexedDbContext = indexedDbContext
    this.#native = native
    this.#signal = signal
    this.#operationRuntime = operationRuntime
    this.#request = request
    this.#assertRemoval = assertRemoval

    /**
     * Complete point revisions share this existing native revision store, including non-journal
     * writers.
     */
    this.journalImages = (
      indexedDbContext.assemblies.journal?.images ?? IndexedDbBaseAccess.images
    )({
      namespace: INTERNAL_META_NAMESPACE,
      revisions: this.#native.objectStore(REVISIONS_STORE_NAME),
      request: this.#request,
      read: async (channel, key) => {
        const target = this.#native.objectStore(
          channel === 'value'
            ? this.#indexedDbContext.kvStoreName
            : channel === 'bytes'
              ? this.#indexedDbContext.bytesStoreName
              : this.#indexedDbContext.recordsStoreName
        )
        const value: unknown = await this.#request(() => target.get(toIdbKey(key)))
        const present =
          value !== undefined ||
          (await this.#request(() => target.getKey(toIdbKey(key)))) !== undefined
        return { present, value: channel === 'bytes' ? readIndexedDbBytes(value) : value }
      }
    })

    /** Snapshot metadata borrows the same original physical request/deletion path. */
    this.ttlAccess = (indexedDbContext.assemblies.ttl?.access ?? IndexedDbBaseAccess.ttl)({
      metadata: this.#native.objectStore(META_STORE_NAME),
      namespace: INTERNAL_META_NAMESPACE,
      keyRange: this.#indexedDbContext.keyRange,
      request: this.#request,
      now: this.#indexedDbContext.ttlNow,
      present: async (channel, key) =>
        (await this.#request(() =>
          this.#native
            .objectStore(
              channel === 'value'
                ? this.#indexedDbContext.kvStoreName
                : channel === 'bytes'
                  ? this.#indexedDbContext.bytesStoreName
                  : this.#indexedDbContext.recordsStoreName
            )
            .getKey(toIdbKey(key))
        )) !== undefined,
      remove: this.removeNative,
      changed: this.markChanged,
      deadline: this.journalImages.deadline
    })
  }

  /** Mark an actual mutation without publishing before native commit. */
  markChanged = (channel: 'value' | 'bytes' | 'record', key: IStorageKey): void => {
    let keys = this.changed.get(channel)
    if (keys === undefined) {
      keys = new Map()
      this.changed.set(channel, keys)
    }
    keys.set(encodeFlatStorageKey(key), key)
  }

  /** Revisions and record invalidation retain their existing physical keys and firewall. */
  reviseRecord = async (key: IStorageKey, raw: boolean): Promise<void> => {
    const revisions = this.#native.objectStore(REVISIONS_STORE_NAME)
    const revision = (await this.#request(() =>
      revisions.get(recordRevisionKey(this.#indexedDbContext, key))
    )) as number | undefined
    revisions.put((revision ?? 0) + 1, recordRevisionKey(this.#indexedDbContext, key))
    const epoch = (await this.#request(() => revisions.get(RECORD_EPOCH_KEY))) as number | undefined
    revisions.put((epoch ?? 0) + 1, RECORD_EPOCH_KEY)
    if (raw)
      await applyRawMutationFirewall(
        this.#indexedDbContext,
        this.#native.objectStore(META_STORE_NAME),
        revisions,
        this.#native.objectStoreNames.contains(INDEX_RECORDS_STORE_NAME)
          ? this.#native.objectStore(INDEX_RECORDS_STORE_NAME)
          : undefined,
        key,
        this.#signal,
        this.#operationRuntime
      )
  }

  /** Canonical deletion can maintain existing sidecars without knowing a new projection. */
  deleteRecordSidecars = async (key: IStorageKey): Promise<boolean> => {
    if (!this.#native.objectStoreNames.contains(INDEX_RECORDS_STORE_NAME)) return false
    /** Reuse the existing key classifier rather than granting a new indexed-delete mode. */
    const authority = classifyLegacyMutationBatch([key])
    if (authority.unscopedPresent) return false
    for (const scope of authority.canonicalScopes) {
      /** The current handle and its rows are read in this same native transaction. */
      const state = (await this.#request(() =>
        this.#native.objectStore(META_STORE_NAME).get(indexMetadataKey(scope))
      )) as { handle?: IRecordIndexHandle } | undefined
      const handle = state?.handle
      if (handle === undefined) continue
      /** The record index locates only this record's existing projected rows. */
      const sidecar = this.#native.objectStore(INDEX_RECORDS_STORE_NAME)
      const rows = await this.#request(() =>
        sidecar.index('record').getAllKeys([scope, handle.generation, toIdbKey(key)])
      )
      for (const row of rows) await this.#request(() => sidecar.delete(row))
      this.indexedScopes.add(scope)
    }
    return true
  }

  /** Missing entries do not mutate revisions or emit a post-commit batch. */
  removeNative = async (channel: 'value' | 'bytes' | 'record', key: IStorageKey): Promise<void> => {
    const name =
      channel === 'value'
        ? this.#indexedDbContext.kvStoreName
        : channel === 'bytes'
          ? this.#indexedDbContext.bytesStoreName
          : this.#indexedDbContext.recordsStoreName
    const existing = await this.#request(() => this.#native.objectStore(name).getKey(toIdbKey(key)))
    if (existing === undefined) return
    this.#assertRemoval?.(channel, key)
    await this.journalImages.mutate(channel, key, false, undefined, () =>
      this.#request(() => this.#native.objectStore(name).delete(toIdbKey(key)))
    )
    this.markChanged(channel, key)
    if (channel === 'record') await this.reviseRecord(key, !(await this.deleteRecordSidecars(key)))
  }

  /** Scope epochs advance once per native transaction, including cursor-driven expiry. */
  finishIndexes = async (): Promise<void> => {
    const revisions = this.#native.objectStore(REVISIONS_STORE_NAME)
    for (const scope of this.indexedScopes) {
      const epoch = (await this.#request(() => revisions.get(indexScopeEpochKey(scope)))) as
        | number
        | undefined
      revisions.put((epoch ?? 0) + 1, indexScopeEpochKey(scope))
    }
  }
}
/** Reuse the native transaction without creating another mutation or cleanup owner. */
export function createNativeDataAccess<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  native: IDBTransaction,
  signal: AbortSignal | undefined,
  operationRuntime: IStorageOperationRuntime,
  request: <R>(make: () => IDBRequest<R>) => Promise<R>,
  assertRemoval?: (channel: 'value' | 'bytes' | 'record', key: IStorageKey) => void
) {
  return new IndexedDbNativeDataAccess(
    indexedDbContext,
    native,
    signal,
    operationRuntime,
    request,
    assertRemoval
  )
}

/** Run one genuine native attempt; no record draft or callback timeout owner remains here. */
/** One logical operation retains endpoint input and delegates retries to the canonical owner. */
export type IIndexedDbLogicalTransaction<TValue, T> = {
  /** Original indexedDbContext belongs to this logical transaction operation. */
  readonly indexedDbContext: IIndexedDbContext<TValue>
  /** Original run belongs to this logical transaction operation. */
  readonly run: (tx: IIndexedDbTransactionScope<TValue>) => T
  /** Original options belongs to this logical transaction operation. */
  readonly options: ITransactionOptions | undefined
  /** Original lease belongs to this logical transaction operation. */
  readonly lease: IMutationLeaseContext
  /** Original pipeline belongs to this logical transaction operation. */
  readonly pipeline: boolean
  /** Original root belongs to this logical transaction operation. */
  readonly root?: IRootMode<Awaited<T>>
  /** Original journaled belongs to this logical transaction operation. */
  readonly journaled: boolean
  /** The selected original journal owns preparation and head locks for every native attempt. */
  selectedJournal: IBackendRuntime['journal']
}
/** Prepare one original logical transaction without adding another retry or lease owner. */
export function runTransaction<TValue, T>(
  indexedDbContext: IIndexedDbContext<TValue>,
  run: (tx: IIndexedDbTransactionScope<TValue>) => T,
  options: ITransactionOptions | undefined,
  lease: IMutationLeaseContext,
  pipeline = true,
  root?: IRootMode<Awaited<T>>,
  journaled = true
): Promise<Awaited<T>> {
  assertTransactionCallback(run, StorageBackend.indexedDb)
  /** All attempt callbacks receive this immutable logical input explicitly. */
  const logicalTransaction = {
    indexedDbContext,
    run,
    options,
    lease,
    pipeline,
    root,
    journaled
  } as IIndexedDbLogicalTransaction<TValue, T>
  logicalTransaction.selectedJournal = logicalTransaction.journaled
    ? logicalTransaction.indexedDbContext.runtime.journal
    : undefined
  return runIndexedDbTransactionLoop(logicalTransaction)
}
/** The shared runWithConcurrency loop is the sole retry, deadline and waiting owner. */
function runIndexedDbTransactionLoop<TValue, T>(
  logicalTransaction: IIndexedDbLogicalTransaction<TValue, T>
): Promise<Awaited<T>> {
  /** The selected journal is fixed for this logical operation across every callback. */
  const selectedJournal = logicalTransaction.selectedJournal
  return runWithConcurrency(
    {
      store: logicalTransaction.indexedDbContext.store,
      options: logicalTransaction.options === undefined ? {} : logicalTransaction.options,
      prepare: selectedJournal === undefined ? undefined : () => selectedJournal.prepare(),
      executeAttempt: logicalTransaction.root?.executeAttempt,
      lock:
        selectedJournal === undefined
          ? logicalTransaction.root?.lock
          : (context) => [
              ...(logicalTransaction.root?.lock(context) ?? []),
              ...selectedJournal.headLocks()
            ]
    },
    {
      attempt: (context) => runIndexedDbConcurrencyAttempt(logicalTransaction, context)
    }
  )
}

/** Root execution uses one complete pipeline per native attempt in the original loop/owner. */
export function rootMutation<TValue, I, R>(
  indexedDbContext: IIndexedDbContext<TValue>,
  method: string,
  input: I,
  options: IWriteOptions | undefined,
  notification: IRootMode<Awaited<R>>['notification'],
  prepare: (input: I, context: IWriteOptions) => IRootPrepared<TValue, R>,
  read = false
): Promise<Awaited<R>> {
  /** Pipeline output is fixed before implicit key/range derivation can run. */
  let capturedInput = input
  /** One native attempt derives detached arguments once, including across acquire waits. */
  let prepared!: IRootPrepared<TValue, R>
  return withMutationLease(indexedDbContext, (lease) =>
    runTransaction(indexedDbContext, (scope) => prepared.run(scope), options, lease, false, {
      ...(read ? { read: true as const } : {}),
      executeAttempt: (context, proceed) =>
        indexedDbContext.runtime.execution.run(
          {
            operation: storageBackendOperation(StorageBackend.indexedDb, method),
            input,
            ctx: context
          },
          (captured) => {
            capturedInput = captured
            return proceed()
          }
        ),
      lock: (context) => {
        prepared = prepare(capturedInput, context)
        return prepared.keys
      },
      ranges: () => prepared.ranges ?? [],
      notification
    })
  )
}

/** Selected reads prepare the original org once and capture lazy expiry in the same native attempt. */
export function rootRead<TValue, I, R>(
  indexedDbContext: IIndexedDbContext<TValue>,
  method: string,
  input: I,
  context: IOperationContext | undefined,
  channel: 'value' | 'bytes' | 'record',
  run: (scope: IIndexedDbTransactionScope<TValue>, input: I) => R
): Promise<Awaited<R>> {
  return rootMutation(
    indexedDbContext,
    method,
    input,
    context,
    { channel, kind: 'remove' },
    (captured) => ({
      keys: [],
      run: (scope) => run(scope, captured)
    }),
    true
  )
}

/** Replace protects all channels that the existing native write may displace. */
export function rootKeys(
  channel: 'value' | 'bytes' | 'record',
  key: IStorageKey,
  context: IWriteOptions
): readonly ILockKey[] {
  return (
    context.conflictPolicy === 'replace' ? (['value', 'bytes', 'record'] as const) : [channel]
  ).flatMap<ILockKey>((target) =>
    target === 'value'
      ? [lockKey.text(key)]
      : target === 'record'
        ? [lockKey.record(key)]
        : typeof key === 'string'
          ? [lockKey.bytes(key)]
          : []
  )
}

/** Channel/range identity is prepared once, before the original provider may wait. */
export function rootClear<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  method: string,
  channel: 'value' | 'bytes' | 'record' | undefined,
  ctx?: IWriteOptions
): Promise<void> {
  return rootMutation(
    indexedDbContext,
    method,
    channel,
    ctx,
    { channel: channel ?? 'all', kind: 'clear' },
    (captured) => ({
      keys: [],
      ranges: (captured === undefined ? (['value', 'bytes', 'record'] as const) : [captured]).map(
        (target) => {
          const channel = target === 'value' ? 'text' : target
          return {
            channel,
            ...snapshotConcurrencyLockRange({ channel }, StorageBackend.indexedDb)
          }
        }
      ),
      run: (scope) => {
        const { id } = assertTransactionOwner(indexedDbContext.construction.store, scope)
        const transaction = indexedDbContext.nativeTransactions.get(id)
        if (transaction === undefined)
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        return transaction.clearRoot(captured)
      }
    })
  )
}

export function createIndexedDbStore<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['store'] {
  return {
    backend: StorageBackend.indexedDb,
    capabilities: indexedDbContext.capabilities,
    inspectLocks: (ctx) =>
      withAbort(ctx, async (_signal, _context, operationRuntime) => {
        assertLive(indexedDbContext)
        /** Inspections observe this registration while the physical port remains shared by the DB. */
        const stages = indexedDbContext.runtime.stageBindings.concurrencyStages(
          indexedDbContext.construction.store
        )
        observeIndexedDbStage(stages, 'beforeLockInspect', operationRuntime)
        try {
          const locks = indexedDbContext.coordination.keyPort.inspectLocks()
          observeIndexedDbStage(stages, 'afterLockInspect', operationRuntime, locks.length)
          return locks
        } catch (error) {
          const failure = normalizeIndexedDbOperationError(error)
          observeIndexedDbStage(stages, 'onLockInspectError', operationRuntime, failure.code)
          throw failure
        }
      }),
    ...(indexedDbContext.assemblies.indexes?.api(indexedDbContext) ??
      indexedDbFeatureMissing.indexes()),
    undo: (txId, ctx) =>
      (
        indexedDbContext.assemblies.journal?.undo(indexedDbContext) ??
        indexedDbFeatureMissing.journal()
      ).undo!(txId, ctx),
    dispose: () => {
      indexedDbContext.prepareState = 'disposed'
      for (const transaction of indexedDbContext.nativeTransactions.values()) transaction.abort()
      return indexedDbContext.controller.dispose()
    },
    [asyncDisposeKey]: () =>
      (indexedDbContext.symbolicDispose ??= indexedDbContext.store
        .dispose()
        .catch((error) => reportCleanupError(createStorageOperationReporter(), error))),
    ...createIndexedDbStoreText(indexedDbContext),
    ...createIndexedDbStoreObservation(indexedDbContext),
    metadata: createIndexedDbMetadata(indexedDbContext),
    ...createIndexedDbStoreBytes(indexedDbContext),
    ...createIndexedDbStoreRecords(indexedDbContext),
    ...createIndexedDbStoreTransactions(indexedDbContext)
  }
}

/** Queries use the shared planner and the original native cursor rather than another executor. */
export function createIndexedDbRecordApi<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['recordApi'] {
  return {
    query: <R = TValue>() => {
      /** Native execution remains in the original storage owner with optional cursor assembly. */
      const source: IRecordQuerySource = {
        asyncDisposeKey,
        pushdown: recordQueryPushdown,
        execute: ({ ctx }) => indexedDbContext.store.iterateRecords(undefined, ctx)
      }
      /** Pure Feature chain declarations retain their original public query surface. */
      const methods = indexedDbContext.runtime.getChainMethods('query')
      return (
        indexedDbContext.assemblies.keyset?.query<R>(source, methods) ??
        createRecordQueryWithoutKeyset<R>(source, methods, () =>
          indexedDbFeatureMissing.fail(IndexedDbFeature.keyset)
        )
      )
    },
    removeByPrefix: (prefix, ctx) =>
      rootMutation(
        indexedDbContext,
        'records.removeByPrefix',
        prefix,
        ctx,
        { channel: 'record', kind: 'batch' },
        (prefix) => {
          const captured = snapshotStorageKeyPrefix(prefix, StorageBackend.indexedDb)
          return {
            keys: [],
            ranges: [
              {
                channel: 'record',
                ...snapshotConcurrencyLockRange(
                  { channel: 'record', prefix: captured.key },
                  StorageBackend.indexedDb
                )
              }
            ],
            run: (scope) => scope.use(records).removeByPrefix(captured.key)
          }
        }
      )
  }
}

/** A bound record API borrows only the exact view authorized by the canonical owner. */
export function transactionRecordApi<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  scope: ITransactionScope
): ITransactionRecordsApi<TValue> {
  return {
    query: <R = TValue>() => {
      /** The selected cursor owner borrows this same admitted native transaction source. */
      const source: IRecordQuerySource = {
        pushdown: recordQueryPushdown,
        execute: () => scope.iterateRecords()
      }
      /** Pure chain declarations never change the existing transaction lifetime. */
      const methods = indexedDbContext.runtime.getChainMethods('query')
      return (
        indexedDbContext.assemblies.keyset?.query<R, undefined>(source, methods) ??
        createRecordQueryWithoutKeyset<R, undefined>(source, methods, () =>
          indexedDbFeatureMissing.fail(IndexedDbFeature.keyset)
        )
      )
    },
    removeByPrefix: (prefix) => {
      /** The native map grants no authority; membership is proved before the original handle lookup. */
      const { id } = assertTransactionOwner(indexedDbContext.construction.store, scope)
      /** This is the same record that owns native abort and physical termination. */
      const native = indexedDbContext.nativeTransactions.get(id)
      if (native === undefined)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      return native.removeRecordsByPrefix(scope, prefix)
    }
  }
}

/** Root TTL endpoints retain one original policy, native transaction and complete pipeline. */

/** Standard root batches reuse the same native views and original concurrency/pipeline owner. */

/** Native close-pending drains existing transactions; deletion keeps the original opener sealed. */
export function dropData<TValue>(indexedDbContext: IIndexedDbContext<TValue>): Promise<void> {
  assertLive(indexedDbContext)
  if (indexedDbContext.deleting !== undefined) return indexedDbContext.deleting
  /** Capture an opening already owned by this exact physical organization. */
  const pending = indexedDbContext.connection
  indexedDbContext.deleting = Promise.resolve()
    .then(async () => {
      /** A failed preparation acquired no successful connection and must not prevent deletion. */
      const opened = await pending?.then(
        (database) => database,
        () => undefined
      )
      const active = indexedDbContext.activeDatabase
      if (opened !== undefined) closeForTransition(indexedDbContext, opened)
      if (active !== undefined && active !== opened) closeForTransition(indexedDbContext, active)
      indexedDbContext.connection = undefined
      if (indexedDbContext.prepareState !== 'disposed') indexedDbContext.prepareState = 'idle'
      indexedDbContext.terminalPrepareFailure = undefined
      await new Promise<void>((resolve, reject) => {
        try {
          /** The native request waits for close-pending transactions and cooperating connections. */
          const request = indexedDbContext.factory.deleteDatabase(indexedDbContext.dbName)
          installIdbOpenRequestHandlers(
            request,
            () => undefined,
            () => undefined,
            () => resolve(),
            () => reject(readIdbRequestError(request))
          )
        } catch (cause) {
          reject(cause)
        }
      }).catch((cause: unknown) => {
        throw normalizeError(
          cause,
          StorageBackend.indexedDb,
          StorageBrowserErrorCode.unavailable,
          StorageOperation.indexedDbDelete
        )
      })
      indexedDbContext.journalGeneration = {}
      publishChange(indexedDbContext, { channel: 'all', kind: 'clear' })
    })
    .finally(() => {
      indexedDbContext.deleting = undefined
    })
  return indexedDbContext.deleting
}

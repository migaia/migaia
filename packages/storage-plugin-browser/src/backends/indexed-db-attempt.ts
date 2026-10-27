// Native attempts, writes, clears, prefix removal and record iterators for the IndexedDB backend (see ./indexed-db.ts).
import { IndexedDbFeature } from '../constants.js'
import type { createIndexedDbJournalTerminal } from './indexed-db-journal.js'
import {
  TransactionBeforeStage,
  TransactionObservedStage,
  type ITransactionStageObserver,
  type IStorageIterator
} from '@migaia/storage-contract'
import {
  snapshotStorageKeyPrefix,
  createStorageOperationRuntime,
  reportCleanupError,
  compareStorageKeys,
  snapshotKeyRange
} from '@migaia/storage-host/sdk'
import type { IStorageErrorFamily } from './backend-errors.js'
import type { IStorageJournalAttempt } from '@migaia/storage-host'
import { StorageBackend, StorageTransactionOperation } from '../constants.js'
import { planChannelWrite } from './backend-errors.js'
import { fromIdbRequest } from '../utils/idb-request.js'
import type { IKeyRange, IStorageKey } from '../types/context.js'
import type { IRecordIndexHandle } from '@migaia/storage-contract'
import { assertTransactionCallback, type ITransactionScope } from '@migaia/storage-contract'
import { indexedDbFeatureMissing } from './indexed-db-base-access.js'
import type { IBackendRuntime } from './construction.js'
import { observeIndexedDbStage, runNativeIndexedDbTransaction } from './indexed-db-transaction.js'
import type { IIndexedDbAdmittedAttempt } from './indexed-db-construction.js'
import {
  REVISIONS_STORE_NAME,
  INDEX_RECORDS_STORE_NAME,
  META_STORE_NAME,
  RECORD_EPOCH_KEY,
  normalizeIndexedDbOperationError,
  readIndexedDbBytes,
  toIdbKey,
  toIdbRange
} from './indexed-db-layout.js'
import { assertLive, deleteOwnedMetaKeys, deleteOwnedRevisionKeys } from './indexed-db-lifecycle.js'
import { open, createTransaction } from './indexed-db-open.js'
import { createNativeDataAccess, assertExpiryRemoval } from './indexed-db-root.js'
import {
  createScope,
  indexedDbNativeRegisterNative,
  indexedDbNativeBeforeCommit,
  indexedDbNativeValidateCommit
} from './indexed-db-scope.js'
import type { IIndexedDbTransactionScope } from './indexed-db.js'

/** Public transactions have one outer endpoint; internal roots use their operation. */
/** One native callback owns physical requests, private images and its original draft views. */
export type IIndexedDbNativeCallback<TValue, T> = {
  /** Original attemptState belongs to this same native callback lifetime. */
  readonly attemptState: IIndexedDbAdmittedAttempt<TValue, T>
  /** Original run belongs to this same native callback lifetime. */
  readonly run: (scope: IIndexedDbTransactionScope<TValue>) => T

  /** Database preparation precedes native admission and never runs in the active callback. */
  operationRuntime: ReturnType<typeof createStorageOperationRuntime>

  /** These waits retain the original overall deadline rather than opening a second one. */
  database: IDBDatabase

  /** Every public channel and index sidecar belongs to this same native transaction. */
  native: IDBTransaction

  /** Signals are already captured by the canonical attempt context. */
  signal: AbortSignal | undefined

  /** The original provider has already refined this exact base object in place. */
  stages: ReturnType<IBackendRuntime['stageBindings']['transactionStages']> | undefined

  /** Request rejection reuses the native adapter's first failure, including cancellation. */
  attemptFailure: IStorageErrorFamily | undefined

  /** Final unique checks inspect the final sidecar state after swaps and deletions. */
  uniqueChecks: Map<
    string,
    {
      readonly handle: IRecordIndexHandle
      readonly indexName: string
      readonly indexValue: IStorageKey
    }
  >

  /** Allocate terminal channels only when an admitted private namespace borrows this attempt. */
  journalTerminal: ReturnType<typeof createIndexedDbJournalTerminal> | undefined

  /** Actual commit-only external work drains after this same native terminal. */
  journalAttempt: IStorageJournalAttempt | undefined
  /** All physical data/deadline operations borrow this native transaction access. */
  access: ReturnType<typeof createNativeDataAccess<TValue>>
  /** Original native access exposes changed within this callback only. */
  changed: ReturnType<typeof createNativeDataAccess<TValue>>['changed']
  /** Original native access exposes indexedScopes within this callback only. */
  indexedScopes: ReturnType<typeof createNativeDataAccess<TValue>>['indexedScopes']
  /** Original native access exposes markChanged within this callback only. */
  markChanged: ReturnType<typeof createNativeDataAccess<TValue>>['markChanged']
  /** Original native access exposes reviseRecord within this callback only. */
  reviseRecord: ReturnType<typeof createNativeDataAccess<TValue>>['reviseRecord']
  /** Original native access exposes deleteRecordSidecars within this callback only. */
  deleteRecordSidecars: ReturnType<typeof createNativeDataAccess<TValue>>['deleteRecordSidecars']
  /** Original native access exposes removeNative within this callback only. */
  removeNative: ReturnType<typeof createNativeDataAccess<TValue>>['removeNative']
  /** Original native access exposes journalImages within this callback only. */
  journalImages: ReturnType<typeof createNativeDataAccess<TValue>>['journalImages']
  /** Original native access exposes ttlAccess within this callback only. */
  ttlAccess: ReturnType<typeof createNativeDataAccess<TValue>>['ttlAccess']
  /** Original native access exposes finishIndexes within this callback only. */
  finishIndexes: ReturnType<typeof createNativeDataAccess<TValue>>['finishIndexes']

  result: Awaited<T>
}
/** Run the original business callback in exactly one accepted native transaction. */
export async function attemptNative<TValue, T>(
  attemptState: IIndexedDbAdmittedAttempt<TValue, T>,
  run: (scope: IIndexedDbTransactionScope<TValue>) => T
): Promise<Awaited<T>> {
  /** Physical state is initialized before its corresponding native callbacks can execute. */
  const nativeState = { attemptState, run } as IIndexedDbNativeCallback<TValue, T>

  assertTransactionCallback(nativeState.run, StorageBackend.indexedDb)

  /** An accepted waiter may drain after disposal but cannot start new native I/O. */
  assertLive(nativeState.attemptState.logicalTransaction.indexedDbContext)

  /** Database preparation precedes native admission and never runs in the active callback. */
  nativeState.operationRuntime = createStorageOperationRuntime()

  /** These waits retain the original overall deadline rather than opening a second one. */
  nativeState.database = await nativeState.attemptState.context.waitPhysical(
    open(
      nativeState.attemptState.logicalTransaction.indexedDbContext,
      nativeState.operationRuntime,
      nativeState.attemptState.logicalTransaction.lease
    )
  )

  /** Every public channel and index sidecar belongs to this same native transaction. */
  nativeState.native = createTransaction(
    nativeState.database,
    [
      nativeState.attemptState.logicalTransaction.indexedDbContext.kvStoreName,
      nativeState.attemptState.logicalTransaction.indexedDbContext.bytesStoreName,
      nativeState.attemptState.logicalTransaction.indexedDbContext.recordsStoreName,
      REVISIONS_STORE_NAME,
      ...(nativeState.database.objectStoreNames.contains(INDEX_RECORDS_STORE_NAME)
        ? [INDEX_RECORDS_STORE_NAME]
        : []),
      META_STORE_NAME,
      ...nativeState.attemptState.logicalTransaction.indexedDbContext.featureStoreNames
    ],
    'readwrite'
  )

  /** Signals are already captured by the canonical attempt context. */
  nativeState.signal = nativeState.attemptState.context.signal as AbortSignal | undefined

  /** The original provider has already refined this exact base object in place. */
  nativeState.stages =
    nativeState.attemptState.logicalTransaction.root === undefined
      ? nativeState.attemptState.logicalTransaction.indexedDbContext.runtime.stageBindings.transactionStages(
          nativeState.attemptState.logicalTransaction.indexedDbContext.construction.store
        )
      : undefined

  /** Final unique checks inspect the final sidecar state after swaps and deletions. */
  nativeState.uniqueChecks = new Map<
    string,
    {
      readonly handle: IRecordIndexHandle
      readonly indexName: string
      readonly indexValue: IStorageKey
    }
  >()

  /** One physical access owns all data/deadline mutations in this native attempt. */
  nativeState.access = createNativeDataAccess(
    nativeState.attemptState.logicalTransaction.indexedDbContext,
    nativeState.native,
    nativeState.signal,
    nativeState.operationRuntime,
    <R>(make: () => IDBRequest<R>) => request(nativeState, make),
    nativeState.attemptState.logicalTransaction.root?.read
      ? (channel, key) =>
          assertExpiryRemoval(
            nativeState.attemptState.logicalTransaction.indexedDbContext,
            channel,
            key,
            nativeState.attemptState.context
          )
      : undefined
  )
  nativeState.changed = nativeState.access.changed
  nativeState.indexedScopes = nativeState.access.indexedScopes
  nativeState.markChanged = nativeState.access.markChanged
  nativeState.reviseRecord = nativeState.access.reviseRecord
  nativeState.deleteRecordSidecars = nativeState.access.deleteRecordSidecars
  nativeState.removeNative = nativeState.access.removeNative
  nativeState.journalImages = nativeState.access.journalImages
  nativeState.ttlAccess = nativeState.access.ttlAccess
  nativeState.finishIndexes = nativeState.access.finishIndexes

  /** Original observer factories may synchronously start accepted scope operations. */
  if (nativeState.attemptState.selectedJournal?.active()) nativeState.journalImages.changes()

  nativeState.result = await runNativeIndexedDbTransaction({
    transaction: nativeState.native,
    guardStoreName: REVISIONS_STORE_NAME,
    guardKey: RECORD_EPOCH_KEY,
    owner: nativeState.attemptState.logicalTransaction.indexedDbContext.transactionOwner,
    createScope: () => createScope(nativeState),
    run: nativeState.run,
    signal: nativeState.signal,
    context: nativeState.attemptState.context,
    runtime: nativeState.operationRuntime,
    normalizeFailure: (cause) =>
      (nativeState.attemptFailure ??= normalizeIndexedDbOperationError(cause)),
    observer: nativeState.stages,
    waitPhysical: (pending) => nativeState.attemptState.context.waitPhysical(pending),
    registerNative: (...args) => indexedDbNativeRegisterNative(nativeState, ...args),
    onNativeEnd: (committed) => nativeState.journalTerminal?.complete(committed),
    onRegistered: (scope) => {
      nativeState.journalAttempt = nativeState.attemptState.selectedJournal?.begin(scope)
    },
    beforeCommit: (...args) => indexedDbNativeBeforeCommit(nativeState, ...args),
    validateCommit: () => indexedDbNativeValidateCommit(nativeState),
    changedKeys: () =>
      [...nativeState.changed.values()].reduce((count, keys) => count + keys.size, 0),
    afterCommit: () =>
      nativeState.attemptState.logicalTransaction.indexedDbContext.assemblies.notifications?.afterCommit(
        nativeState
      )
  })

  await nativeState.journalAttempt?.settle?.()
  return nativeState.result
}

/** A current operation issues its own native request directly, including after awaits. */
export function request<TValue, T, R>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  make: () => IDBRequest<R>
): Promise<R> {
  return fromIdbRequest(make(), { signal: nativeState.signal }, nativeState.operationRuntime).catch(
    (cause) => {
      throw nativeState.attemptFailure ?? cause
    }
  )
}

/** The same physical writer owns data, image order, raw-record sidecars and revisions. */
export async function putNative<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  channel: 'value' | 'bytes' | 'record',
  key: IStorageKey,
  value: unknown,
  indexed = false
): Promise<void> {
  const name =
    channel === 'value'
      ? nativeState.attemptState.logicalTransaction.indexedDbContext.kvStoreName
      : channel === 'bytes'
        ? nativeState.attemptState.logicalTransaction.indexedDbContext.bytesStoreName
        : nativeState.attemptState.logicalTransaction.indexedDbContext.recordsStoreName
  await nativeState.journalImages.mutate(
    channel,
    key,
    true,
    channel === 'bytes' ? readIndexedDbBytes(value) : value,
    () => request(nativeState, () => nativeState.native.objectStore(name).put(value, toIdbKey(key)))
  )
  nativeState.markChanged(channel, key)
  if (channel === 'record') await nativeState.reviseRecord(key, !indexed)
}

/** Resolve the existing cross-channel policy inside this same native transaction. */
export async function write<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  channel: 'value' | 'bytes' | 'record',
  key: IStorageKey,
  value: unknown,
  conflictPolicy: 'conflict' | 'replace',
  indexed = false
): Promise<void> {
  const stringKey = typeof key === 'string' ? key : undefined
  /** Expired conflicting channels are removed inside this same original native write. */
  await Promise.all([
    nativeState.ttlAccess.present('value', key),
    nativeState.ttlAccess.present('record', key),
    ...(stringKey === undefined ? [] : [nativeState.ttlAccess.present('bytes', key)])
  ])
  const reads = [
    request(nativeState, () =>
      nativeState.native
        .objectStore(nativeState.attemptState.logicalTransaction.indexedDbContext.kvStoreName)
        .get(toIdbKey(key))
    ),
    stringKey === undefined
      ? Promise.resolve(undefined)
      : request(nativeState, () =>
          nativeState.native
            .objectStore(
              nativeState.attemptState.logicalTransaction.indexedDbContext.bytesStoreName
            )
            .get(stringKey)
        ),
    request(nativeState, () =>
      nativeState.native
        .objectStore(nativeState.attemptState.logicalTransaction.indexedDbContext.recordsStoreName)
        .getKey(toIdbKey(key))
    )
  ]
  const [text, bytes, record] = await Promise.all(reads)
  const existing = new Set<'value' | 'bytes' | 'record'>()
  if (text !== undefined) existing.add('value')
  if (bytes !== undefined) existing.add('bytes')
  if (record !== undefined) existing.add('record')
  const plan = planChannelWrite(key, channel, existing, conflictPolicy, StorageBackend.indexedDb)
  for (const removal of plan.remove) {
    const name =
      removal === 'value'
        ? nativeState.attemptState.logicalTransaction.indexedDbContext.kvStoreName
        : removal === 'bytes'
          ? nativeState.attemptState.logicalTransaction.indexedDbContext.bytesStoreName
          : nativeState.attemptState.logicalTransaction.indexedDbContext.recordsStoreName
    await nativeState.journalImages.mutate(removal, key, false, undefined, () =>
      request(nativeState, () => nativeState.native.objectStore(name).delete(toIdbKey(key)))
    )
    await nativeState.ttlAccess.removed(removal, key)
    nativeState.markChanged(removal, key)
    if (removal === 'record')
      await nativeState.reviseRecord(key, !(await nativeState.deleteRecordSidecars(key)))
  }
  await putNative(nativeState, channel, key, value, indexed)
  await nativeState.ttlAccess.written(channel, key)
}

/** Explicit removal clears the old target deadline in the same native transaction. */
export async function remove<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  channel: 'value' | 'bytes' | 'record',
  key: IStorageKey
): Promise<void> {
  await nativeState.removeNative(channel, key)
  await nativeState.ttlAccess.removed(channel, key)
}

/** Root clears reuse this transaction's stores, revisions and raw-record firewall. */
export async function clearRoot<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  channel: 'value' | 'bytes' | 'record' | undefined
): Promise<void> {
  const channels = channel === undefined ? (['value', 'bytes', 'record'] as const) : [channel]
  const revisions = nativeState.native.objectStore(REVISIONS_STORE_NAME)
  const epoch = channels.includes('record')
    ? ((await request(nativeState, () => revisions.get(RECORD_EPOCH_KEY))) as number | undefined)
    : undefined
  for (const target of channels) {
    const name =
      target === 'value'
        ? nativeState.attemptState.logicalTransaction.indexedDbContext.kvStoreName
        : target === 'bytes'
          ? nativeState.attemptState.logicalTransaction.indexedDbContext.bytesStoreName
          : nativeState.attemptState.logicalTransaction.indexedDbContext.recordsStoreName
    const physical = nativeState.native.objectStore(name)
    const keys = await request(nativeState, () => physical.getAllKeys())
    const count = keys.length
    await nativeState.journalImages.clear(target, keys as IStorageKey[], () =>
      request(nativeState, () => physical.clear())
    )
    await nativeState.ttlAccess.clear(target)
    if (count > 0) nativeState.changed.set(target, new Map())
  }
  if (channels.includes('record')) {
    if (nativeState.native.objectStoreNames.contains(INDEX_RECORDS_STORE_NAME))
      await request(nativeState, () =>
        nativeState.native.objectStore(INDEX_RECORDS_STORE_NAME).clear()
      )
    await deleteOwnedMetaKeys(
      nativeState.attemptState.logicalTransaction.indexedDbContext,
      nativeState.native.objectStore(META_STORE_NAME),
      nativeState.signal,
      nativeState.operationRuntime
    )
    await deleteOwnedRevisionKeys(revisions, nativeState.signal, nativeState.operationRuntime)
    revisions.put((epoch ?? 0) + 1, RECORD_EPOCH_KEY)
  }
}

/** Delete one canonical prefix through the existing ordered native cursor. */
export async function removePrefix<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  channel: 'value' | 'record',
  prefix: ReturnType<typeof snapshotStorageKeyPrefix>
): Promise<number> {
  /** The same physical store and native transaction own the complete range. */
  const target = nativeState.native.objectStore(
    channel === 'value'
      ? nativeState.attemptState.logicalTransaction.indexedDbContext.kvStoreName
      : nativeState.attemptState.logicalTransaction.indexedDbContext.recordsStoreName
  )
  /** Optional injected range support only changes the first native seek. */
  const cursorRequest = target.openCursor(
    nativeState.attemptState.logicalTransaction.indexedDbContext.keyRange?.lowerBound(
      toIdbKey(prefix.key)
    )
  )
  /** Cursor continuation seeks directly when the injected factory lacks IDBKeyRange. */
  let cursor = await request(nativeState, () => cursorRequest)
  if (
    nativeState.attemptState.logicalTransaction.indexedDbContext.keyRange === undefined &&
    cursor !== null &&
    compareStorageKeys(cursor.key as IStorageKey, prefix.key) < 0
  )
    cursor = await request(nativeState, () => {
      cursor!.continue(toIdbKey(prefix.key))
      return cursorRequest
    })
  /** Each matching native entry is deleted once and counted once. */
  let removed = 0
  while (cursor !== null && prefix.matches(cursor.key as IStorageKey)) {
    const key = cursor.key as IStorageKey
    if (await nativeState.ttlAccess.present(channel, key)) {
      await nativeState.journalImages.mutate(channel, key, false, undefined, () =>
        request(nativeState, () => cursor!.delete())
      )
      await nativeState.ttlAccess.removed(channel, key)
      nativeState.markChanged(channel, key)
      if (channel === 'record')
        await nativeState.reviseRecord(key, !(await nativeState.deleteRecordSidecars(key)))
      removed += 1
    }
    cursor = await request(nativeState, () => {
      cursor!.continue()
      return cursorRequest
    })
  }
  return removed
}

/** Validate one index handle against this transaction's current metadata. */

/** Execute only an already-authorized short-lived view through the original pipeline. */
export function executeOperation<TValue, T, TScope extends ITransactionScope<unknown>, TInput, R>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  view: TScope,
  name: string,
  input: TInput,
  run: (view: TScope, input: TInput) => R,
  batch?: { readonly count?: number }
): Promise<Awaited<R>> {
  /** Root batch observation already encloses this same native scope. */
  const invoke = (): Promise<Awaited<R>> =>
    nativeState.attemptState.logicalTransaction.root !== undefined
      ? Promise.resolve(run(view, input))
      : nativeState.attemptState.logicalTransaction.indexedDbContext.runtime.execution.run<
          TInput,
          Awaited<R>
        >(
          { operation: name, input, ctx: nativeState.attemptState.context, scope: view },
          async (captured): Promise<Awaited<R>> => {
            /** Observer failures report without changing the admitted native operation. */
            let operationStages: ITransactionStageObserver | undefined
            try {
              operationStages = nativeState.stages?.forTransaction(view)
            } catch (cause) {
              reportCleanupError(nativeState.operationRuntime.reporter, cause)
            }
            observeIndexedDbStage(
              operationStages,
              TransactionBeforeStage.beforeTxOperation,
              nativeState.operationRuntime,
              name
            )
            const value = await run(view, captured)
            observeIndexedDbStage(
              operationStages,
              TransactionObservedStage.afterTxOperation,
              nativeState.operationRuntime,
              name
            )
            return value
          }
        )
  return batch !== undefined && nativeState.attemptState.logicalTransaction.root === undefined
    ? (
        nativeState.attemptState.logicalTransaction.indexedDbContext.assemblies.batch?.observe ??
        (() => indexedDbFeatureMissing.fail(IndexedDbFeature.batch))
      )(
        nativeState.attemptState.logicalTransaction.indexedDbContext.runtime,
        nativeState.attemptState.logicalTransaction.indexedDbContext.construction.store,
        name,
        batch.count,
        invoke,
        view
      )
    : invoke()
}

/** One same-transaction cursor is advanced only by an authorized fresh operation view. */
export function recordIterator<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  scope: ITransactionScope<TValue>,
  range: IKeyRange | undefined,
  source: IIndexedDbTransactionRecordSource<TValue> = new IndexedDbBasicRecordSource(nativeState)
): IStorageIterator<[IStorageKey, TValue]> {
  return new IndexedDbTransactionRecordIterator(nativeState, range, source).iterator(scope)
}

/** A native source owns only cursor selection and row interpretation, never transaction lifetime. */
export type IIndexedDbTransactionRecordSource<T> = {
  readonly operation: string
  readonly limit?: number
  open(range: IKeyRange | undefined): Promise<IDBRequest<IDBCursorWithValue | null>>
  row(cursor: IDBCursorWithValue): Promise<[IStorageKey, T] | undefined>
}
/** Basic record reads borrow the original data store and optional expiry policy. */
class IndexedDbBasicRecordSource<TValue, T> implements IIndexedDbTransactionRecordSource<TValue> {
  /** The original native callback is the only data and expiry authority. */
  readonly #nativeState: IIndexedDbNativeCallback<TValue, T>
  readonly operation = StorageTransactionOperation.iterateRecords
  /** Borrow this native callback without allocating another cursor lifetime. */
  constructor(nativeState: IIndexedDbNativeCallback<TValue, T>) {
    this.#nativeState = nativeState
  }
  /** Open only the original authoritative records store. */
  async open(range: IKeyRange | undefined): Promise<IDBRequest<IDBCursorWithValue | null>> {
    const context = this.#nativeState.attemptState.logicalTransaction.indexedDbContext
    return this.#nativeState.native
      .objectStore(context.recordsStoreName)
      .openCursor(toIdbRange(range, context.keyRange))
  }
  /** Expired native rows are omitted through the same transaction's selected expiry policy. */
  async row(cursor: IDBCursorWithValue): Promise<[IStorageKey, TValue] | undefined> {
    const key = cursor.key as IStorageKey
    return (await this.#nativeState.ttlAccess.present('record', key))
      ? [key, cursor.value as TValue]
      : undefined
  }
}
/** One authentic iterator owns cursor advancement and releases it through the canonical transaction. */
class IndexedDbTransactionRecordIterator<TValue, T> {
  /** Existing native callback supplies operation execution and request failure ownership. */
  readonly #nativeState: IIndexedDbNativeCallback<TValue, T>
  /** Borrowed range is captured on the first authorized advance. */
  readonly #range: IKeyRange | undefined
  /** Optional sources supply only their own native selection semantics. */
  readonly #source: IIndexedDbTransactionRecordSource<TValue>
  /** One original request stays alive across native cursor continuations. */
  #request: IDBRequest<IDBCursorWithValue | null> | undefined
  /** Last cursor can advance only through a fresh authorized transaction view. */
  #cursor: IDBCursorWithValue | undefined
  /** Successful rows alone count toward a selected source's bound. */
  #emitted = 0
  /** Retain the existing transaction and source without starting any request. */
  constructor(
    nativeState: IIndexedDbNativeCallback<TValue, T>,
    range: IKeyRange | undefined,
    source: IIndexedDbTransactionRecordSource<TValue>
  ) {
    this.#nativeState = nativeState
    this.#range = range
    this.#source = source
  }
  /** Register the resource on the original owner; methods never grant native lifetime. */
  iterator(scope: ITransactionScope<TValue>): IStorageIterator<[IStorageKey, TValue]> {
    return this.#nativeState.attemptState.logicalTransaction.indexedDbContext.transactionOwner.registerIterator<
      ITransactionScope<TValue>,
      [IStorageKey, TValue]
    >(scope, {
      next: (view) =>
        executeOperation(this.#nativeState, view, this.#source.operation, undefined, () =>
          this.next()
        ),
      close: () => {
        this.#request = undefined
        this.#cursor = undefined
      }
    })
  }
  /** Advance the one native request until a visible row or exhaustion. */
  async next(): Promise<IteratorResult<[IStorageKey, TValue], undefined>> {
    if (this.#source.limit !== undefined && this.#emitted >= this.#source.limit)
      return { done: true, value: undefined }
    if (this.#request === undefined)
      this.#request = await this.#source.open(
        snapshotKeyRange(this.#range, StorageBackend.indexedDb)
      )
    else this.#cursor?.continue()
    let cursor = await request(this.#nativeState, () => this.#request!)
    while (cursor !== null) {
      this.#cursor = cursor
      const row = await this.#source.row(cursor)
      if (row !== undefined) {
        this.#emitted += 1
        return { done: false, value: row }
      }
      cursor.continue()
      cursor = await request(this.#nativeState, () => this.#request!)
    }
    return { done: true, value: undefined }
  }
}

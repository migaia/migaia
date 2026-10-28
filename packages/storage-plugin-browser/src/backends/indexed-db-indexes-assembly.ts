import { indexUniqueConflictText } from '../error-text.ts'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import {
  assertTransactionOwner,
  snapshotConcurrencyLockRange,
  createStorageOperationRuntime,
  type IStorageOperationRuntime,
  mergeSignals,
  throwIfAborted,
  withAbort,
  compareStorageKeys,
  snapshotStorageKey,
  snapshotKeyRange,
  isStorageKeyInRange
} from '@migaia/storage-host/sdk'
import { StorageError } from '../types/errors.ts'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.ts'
import { StorageBackend, StorageOperation, StorageTransactionOperation } from '../constants.ts'
import { raceWithAbort } from '@migaia/utils/promise'
import { fromIdbRequest, idbTransactionCommit } from '../utils/idb-request.ts'
import type { IKeyRange, IOperationContext, IStorageKey } from '../types/context.ts'
import type {
  IRecordIndexDefinition,
  IRecordIndexHandle,
  IRecordIndexReadiness,
  IRecordIndexQuery
} from '@migaia/storage-contract'
import {
  type IIndexedDbTransactionRecordSource,
  createMonotonicClock,
  IIndexedDbContext,
  IIndexedDbNativeCallback,
  IIndexedDbStore,
  IIndexedDbTransactionScope,
  INDEX_QUERY_PAGE_SIZE,
  INDEX_RECORDS_STORE_NAME,
  META_STORE_NAME,
  RECORD_EPOCH_KEY,
  REVISIONS_STORE_NAME,
  archiveIndexGeneration,
  assertLive,
  createIndexGeneration,
  createTransaction,
  indexMetadataKey,
  indexScopeEpochKey,
  isValidIndexGeneration,
  normalizeIndexedDbOperationError,
  open,
  request,
  rootKeys,
  rootMutation,
  runTransaction,
  snapshotWriteValue,
  staleIndexHandleError,
  toIdbKey,
  withMutationLease
} from './indexed-db.ts'
import { iterateIndexedDbIndex } from './indexed-db-backfill-commit.ts'
import {
  assertHandle,
  registerIndexedDbBackfill,
  createIndexedDbScopeIndexes
} from './indexed-db-backfill.ts'

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
      throw new StorageError(StorageBrowserErrorCode.unavailable, {
        backend: StorageBackend.indexedDb,
        cause: new Error(StorageErrorText.indexedDbKeyRangeUnavailable)
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
            StorageBrowserErrorCode.indexOrphan,
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
      StorageBrowserErrorCode.indexQueryInvalidated,
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
    throw new StorageError(StorageBrowserErrorCode.unavailable, {
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
      throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
        backend: StorageBackend.indexedDb,
        operation: StorageOperation.indexedDbSchema,
        cause: new TypeError(`IndexedDB sidecar index ${name} is missing`)
      })
    const index = sidecar.index(name)
    if (!sameKeyPath(index.keyPath, keyPath) || index.unique || index.multiEntry)
      throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
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
    /** Exactly the two owned indexes, in any order; checked without sorting. */
    const exact =
      actualNames.length === 2 && actualNames.includes('lookup') && actualNames.includes('record')
    if (!exact)
      throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
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
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
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
        StorageBrowserErrorCode.indexUniqueConflict,
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
export class IndexedDbTransactionIndexSource<
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
      throw new StorageError(StorageBrowserErrorCode.unavailable, {
        backend: StorageBackend.indexedDb
      })
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
      StorageBrowserErrorCode.indexOrphan,
      { backend: StorageBackend.indexedDb },
      StorageErrorText.indexOrphan
    )
  }
}
export {
  openBackfillSession,
  initializeIndexedDbBackfillSession,
  assertSession,
  readBatch,
  createIndexedDbBackfillMethods,
  registerIndexedDbBackfill,
  assertHandle,
  createIndexedDbScopeIndexes,
  indexedDbBackfillRenew,
  indexedDbBackfillCommitBatch
} from './indexed-db-backfill.ts'
export type { IIndexedDbBackfillSession, IIndexedDbBackfillCommit } from './indexed-db-backfill.ts'
export {
  commitIndexedDbBackfillNative,
  indexedDbBackfillFail,
  validateIndexedDbBackfillSession,
  acquireIndexedDbBackfillLease,
  prepareIndexedDbBackfillCandidates,
  validateIndexedDbBackfillCommit,
  applyIndexedDbBackfillProjection,
  finishIndexedDbBackfillCommit,
  iterateIndexedDbIndex
} from './indexed-db-backfill-commit.ts'

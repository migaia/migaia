// Store text, bytes, record, metadata and transaction channels for the IndexedDB backend (see ./indexed-db.ts).
import { IndexedDbFeature } from '../constants.js'
import {
  createTransactionBuilder,
  lockKey,
  withAbort,
  snapshotStorageKey,
  createStorageToken
} from '@migaia/storage-host/sdk'
import { StorageError } from '../types/errors.js'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.js'
import { StorageBackend, StorageOperation } from '../constants.js'
import { assertStringStorageKey } from '@migaia/storage-contract'
import { isUint8Array } from '@migaia/utils/bytes'
import { indexedDbFeatureMissing } from './indexed-db-base-access.js'
import { withStorageIteratorResource } from '../utils/storage-iterator.js'
import {
  META_STORE_NAME,
  readIndexedDbBytes,
  snapshotWriteValue,
  toIdbKey
} from './indexed-db-layout.js'
import { assertLive, withMutationLease } from './indexed-db-lifecycle.js'
import { indexedDbRecordRows } from './indexed-db-record-cursor.js'
import {
  rootRead,
  readFrom,
  rootMutation,
  rootKeys,
  rootClear,
  writeTo,
  runTransaction
} from './indexed-db-root.js'
import { journalNative } from './indexed-db.js'
import type { IIndexedDbStore, IIndexedDbContext } from './indexed-db.js'

/**
 * Store shape the IndexedDbStoreText class implements; named because implements cannot take an
 * intersection.
 */
type IIndexedDbStoreTextShape<TValue> = Pick<
  IIndexedDbStore<TValue>,
  'get' | 'set' | 'remove' | 'has' | 'keys' | 'clearValues' | 'clearAll'
>

/**
 * Text channel of one IndexedDB store: get, set, remove, has, keys and batches over the shared
 * database.
 */
class IndexedDbStoreText<TValue> implements IIndexedDbStoreTextShape<TValue> {
  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #indexedDbContext: IIndexedDbContext<TValue>

  get: IIndexedDbStoreTextShape<TValue>['get'] = (key, ctx) =>
    this.#indexedDbContext.runtime.journal !== undefined
      ? rootRead(this.#indexedDbContext, 'get', [key, ctx] as const, ctx, 'value', (scope, [key]) =>
          scope.get(key)
        )
      : withAbort(ctx, async (signal, _context, runtime) => {
          assertLive(this.#indexedDbContext)
          assertStringStorageKey(key, StorageBackend.indexedDb)
          const value = await readFrom(
            this.#indexedDbContext,
            this.#indexedDbContext.kvStoreName,
            (store) => store.get(key) as IDBRequest<unknown>,
            signal,
            runtime,
            async (value, access) =>
              (await access.ttlAccess.present('value', key)) ? value : undefined
          )
          return typeof value === 'string' ? value : null
        })

  set: IIndexedDbStoreTextShape<TValue>['set'] = (key, value, ctx) =>
    rootMutation(
      this.#indexedDbContext,
      'set',
      { key, value },
      ctx,
      { channel: 'value', kind: 'put' },
      ({ key, value }, context) => {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        if (typeof value !== 'string')
          throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
            backend: StorageBackend.indexedDb,
            key,
            cause: new TypeError(StorageErrorText.storageValueInvalid)
          })
        return {
          keys: rootKeys('value', key, context),
          run: (scope) => scope.set(key, value, context)
        }
      }
    )

  remove: IIndexedDbStoreTextShape<TValue>['remove'] = (key, ctx) =>
    rootMutation(
      this.#indexedDbContext,
      'remove',
      key,
      ctx,
      { channel: 'value', kind: 'remove' },
      (key) => {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        return { keys: [lockKey.text(key)], run: (scope) => scope.remove(key) }
      }
    )

  has: IIndexedDbStoreTextShape<TValue>['has'] = (key, ctx) =>
    this.#indexedDbContext.runtime.journal !== undefined
      ? rootRead(this.#indexedDbContext, 'has', [key, ctx] as const, ctx, 'value', (scope, [key]) =>
          scope.has(key)
        )
      : withAbort(ctx, async (signal, _context, runtime) => {
          assertLive(this.#indexedDbContext)
          assertStringStorageKey(key, StorageBackend.indexedDb)
          const value = await readFrom(
            this.#indexedDbContext,
            this.#indexedDbContext.kvStoreName,
            (store) => store.get(key) as IDBRequest<unknown>,
            signal,
            runtime,
            async (value, access) =>
              (await access.ttlAccess.present('value', key)) ? value : undefined
          )
          return value !== undefined
        })

  keys: IIndexedDbStoreTextShape<TValue>['keys'] = (ctx) =>
    this.#indexedDbContext.runtime.journal !== undefined
      ? rootRead(this.#indexedDbContext, 'keys', [ctx] as const, ctx, 'value', (scope) =>
          journalNative(this.#indexedDbContext, scope).readKeys()
        )
      : withAbort(ctx, async (signal, _context, runtime) => {
          assertLive(this.#indexedDbContext)
          const raw = await readFrom(
            this.#indexedDbContext,
            this.#indexedDbContext.kvStoreName,
            (store) => store.getAllKeys(),
            signal,
            runtime,
            async (keys, access) => {
              const live: IDBValidKey[] = []
              for (const key of keys) {
                assertStringStorageKey(key, StorageBackend.indexedDb, 'persisted value key')
                if (await access.ttlAccess.present('value', key)) live.push(key)
              }
              return live
            }
          )
          return raw.map((key) => {
            assertStringStorageKey(key, StorageBackend.indexedDb, 'persisted value key')
            return key
          })
        })

  clearValues: IIndexedDbStoreTextShape<TValue>['clearValues'] = (ctx) =>
    rootClear(this.#indexedDbContext, 'clearValues', 'value', ctx)

  clearAll: IIndexedDbStoreTextShape<TValue>['clearAll'] = (ctx) =>
    rootClear(this.#indexedDbContext, 'clearAll', undefined, ctx)

  /** Capture the owner state; members are own-property arrows so the public shape is unchanged. */
  constructor(indexedDbContext: IIndexedDbContext<TValue>) {
    this.#indexedDbContext = indexedDbContext
  }
}

/** Execute the original session renew with its existing controller lease and native metadata. */

/** Execute the original session commitBatch with its existing controller lease and native metadata. */
/** One acquired native commit owns batch validation, sidecar writes and metadata publication. */

/** Retain the session's existing mutation lease for the original complete native commit. */

/** Commit the issued batch through its original IndexedDB transaction and failure cleanup. */

/** Execute the original session fail with its existing controller lease and native metadata. */

/** Admit the native scan domain and capture bounds before opening the database. */

/** Compare generation and heartbeat ownership in the original readwrite acquisition transaction. */

/** Prepare caller-decoded candidate projections within the original row and batch limits. */

/** Validate current generation, lease, checkpoint, issued manifest and bounded projections. */

/** Apply only revision-matching projections in the original sidecar write order. */

/** Publish readiness and checkpoints only after the original native transaction commits. */

/**
 * Run the original bounded native iterateRecordIndex cursor with its existing signal and resource
 * owner.
 */

/** Compose root indexes access from the existing native backend ports. */

/** Compose root text access from the existing native backend ports. */
export function createIndexedDbStoreText<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): Pick<
  IIndexedDbStore<TValue>,
  'get' | 'set' | 'remove' | 'has' | 'keys' | 'clearValues' | 'clearAll'
> {
  return new IndexedDbStoreText<TValue>(indexedDbContext)
}
/** Compose root observation access from the existing native backend ports. */
export function createIndexedDbStoreObservation<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): Pick<IIndexedDbStore<TValue>, 'watch' | 'subscribeChanges'> {
  return {
    watch: (key, ctx) => {
      const owner = indexedDbContext.assemblies.changeFeed
      if (owner === undefined) return indexedDbFeatureMissing.fail(IndexedDbFeature.changeFeed)
      return owner.watch(indexedDbContext, key, ctx)
    },
    subscribeChanges: (listener) => {
      const owner = indexedDbContext.assemblies.notifications
      if (owner === undefined) return indexedDbFeatureMissing.fail(IndexedDbFeature.notifications)
      return owner.subscribe(indexedDbContext, listener)
    }
  }
}
/** Metadata operations borrow the original physical store and mutation lease paths. */
export function createIndexedDbMetadata<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): NonNullable<IIndexedDbStore<TValue>['metadata']> {
  return {
    get: (key, ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive(indexedDbContext)
        assertStringStorageKey(key, StorageBackend.indexedDb, 'metadata key')
        return readFrom(
          indexedDbContext,
          META_STORE_NAME,
          (store) => store.get(key),
          signal,
          runtime
        )
      }),
    set: (key, value, ctx) =>
      withMutationLease(indexedDbContext, (lease) =>
        withAbort(ctx, async (signal, _context, runtime) => {
          assertLive(indexedDbContext)
          assertStringStorageKey(key, StorageBackend.indexedDb, 'metadata key')
          await writeTo(
            indexedDbContext,
            META_STORE_NAME,
            (store) => store.put(value, key),
            signal,
            runtime,
            lease
          )
        })
      ),
    delete: (key, ctx) =>
      withMutationLease(indexedDbContext, (lease) =>
        withAbort(ctx, async (signal, _context, runtime) => {
          assertLive(indexedDbContext)
          assertStringStorageKey(key, StorageBackend.indexedDb, 'metadata key')
          await writeTo(
            indexedDbContext,
            META_STORE_NAME,
            (store) => store.delete(key),
            signal,
            runtime,
            lease
          )
        })
      )
  }
}

/**
 * Store shape the IndexedDbStoreBytes class implements; named because implements cannot take an
 * intersection.
 */
type IIndexedDbStoreBytesShape<TValue> = Pick<
  IIndexedDbStore<TValue>,
  'getBytes' | 'setBytes' | 'removeBytes' | 'clearBytes'
>

/** Bytes channel of one IndexedDB store. */
class IndexedDbStoreBytes<TValue> implements IIndexedDbStoreBytesShape<TValue> {
  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #indexedDbContext: IIndexedDbContext<TValue>

  getBytes: IIndexedDbStoreBytesShape<TValue>['getBytes'] = (key, ctx) =>
    this.#indexedDbContext.runtime.journal !== undefined
      ? rootRead(
          this.#indexedDbContext,
          'getBytes',
          [key, ctx] as const,
          ctx,
          'bytes',
          (scope, [key]) => scope.getBytes(key)
        )
      : withAbort(ctx, async (signal, _context, runtime) => {
          assertLive(this.#indexedDbContext)
          assertStringStorageKey(key, StorageBackend.indexedDb)
          const value = await readFrom(
            this.#indexedDbContext,
            this.#indexedDbContext.bytesStoreName,
            (store) => store.get(key) as IDBRequest<unknown>,
            signal,
            runtime,
            async (value, access) =>
              (await access.ttlAccess.present('bytes', key)) ? value : undefined
          )
          return readIndexedDbBytes(value)
        })

  setBytes: IIndexedDbStoreBytesShape<TValue>['setBytes'] = (key, value, ctx) =>
    rootMutation(
      this.#indexedDbContext,
      'setBytes',
      { key, value },
      ctx,
      { channel: 'bytes', kind: 'put' },
      ({ key, value }, context) => {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        if (!isUint8Array(value))
          throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
            backend: StorageBackend.indexedDb,
            key,
            cause: new TypeError(StorageErrorText.storageBytesInvalid)
          })
        const captured = snapshotWriteValue(value, key)
        return {
          keys: rootKeys('bytes', key, context),
          run: (scope) => scope.setBytes(key, captured, context)
        }
      }
    )

  removeBytes: IIndexedDbStoreBytesShape<TValue>['removeBytes'] = (key, ctx) =>
    rootMutation(
      this.#indexedDbContext,
      'removeBytes',
      key,
      ctx,
      { channel: 'bytes', kind: 'remove' },
      (key) => {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        return { keys: [lockKey.bytes(key)], run: (scope) => scope.removeBytes(key) }
      }
    )

  clearBytes: IIndexedDbStoreBytesShape<TValue>['clearBytes'] = (ctx) =>
    rootClear(this.#indexedDbContext, 'clearBytes', 'bytes', ctx)

  /** Capture the owner state; members are own-property arrows so the public shape is unchanged. */
  constructor(indexedDbContext: IIndexedDbContext<TValue>) {
    this.#indexedDbContext = indexedDbContext
  }
}

/** Compose root bytes access from the existing native backend ports. */
export function createIndexedDbStoreBytes<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): Pick<IIndexedDbStore<TValue>, 'getBytes' | 'setBytes' | 'removeBytes' | 'clearBytes'> {
  return new IndexedDbStoreBytes<TValue>(indexedDbContext)
}
/**
 * Run the original bounded native iterateRecords cursor with its existing signal and resource
 * owner.
 */
function iterateIndexedDbRecords<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  ...args: Parameters<NonNullable<IIndexedDbStore<TValue>['iterateRecords']>>
): ReturnType<NonNullable<IIndexedDbStore<TValue>['iterateRecords']>> {
  const [range, ctx] = args
  return withStorageIteratorResource(indexedDbRecordRows(indexedDbContext, range, ctx), {
    execution: indexedDbContext.runtime.execution,
    operation: StorageOperation.indexedDbCursor,
    ctx
  })
}

/**
 * Store shape the IndexedDbStoreRecords class implements; named because implements cannot take an
 * intersection.
 */
type IIndexedDbStoreRecordsShape<TValue> = Pick<
  IIndexedDbStore<TValue>,
  'getRecord' | 'putRecord' | 'deleteRecord' | 'clearRecords' | 'iterateRecords'
>

/** Record channel of one IndexedDB store. */
class IndexedDbStoreRecords<TValue> implements IIndexedDbStoreRecordsShape<TValue> {
  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #indexedDbContext: IIndexedDbContext<TValue>

  getRecord: IIndexedDbStoreRecordsShape<TValue>['getRecord'] = (key, ctx) =>
    this.#indexedDbContext.runtime.journal !== undefined
      ? rootRead(
          this.#indexedDbContext,
          'getRecord',
          [key, ctx] as const,
          ctx,
          'record',
          (scope, [key]) => scope.getRecord(key)
        )
      : withAbort(ctx, async (signal, _context, runtime) => {
          assertLive(this.#indexedDbContext)
          const keySnapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
          return readFrom(
            this.#indexedDbContext,
            this.#indexedDbContext.recordsStoreName,
            (store) => store.get(toIdbKey(keySnapshot)) as IDBRequest<TValue | undefined>,
            signal,
            runtime,
            async (value, access) =>
              (await access.ttlAccess.present('record', keySnapshot)) ? value : undefined
          )
        })

  putRecord: IIndexedDbStoreRecordsShape<TValue>['putRecord'] = (value, key, ctx) =>
    rootMutation(
      this.#indexedDbContext,
      'putRecord',
      { value, key },
      ctx,
      { channel: 'record', kind: 'put' },
      ({ value, key }, context) => {
        const captured = snapshotStorageKey(key ?? createStorageToken(), StorageBackend.indexedDb)
        const copy = snapshotWriteValue(value, captured)
        return {
          keys: rootKeys('record', captured, context),
          run: (scope) => scope.putRecord(copy, captured, context)
        }
      }
    )

  deleteRecord: IIndexedDbStoreRecordsShape<TValue>['deleteRecord'] = (key, ctx) =>
    rootMutation(
      this.#indexedDbContext,
      'deleteRecord',
      key,
      ctx,
      { channel: 'record', kind: 'remove' },
      (key) => {
        const captured = snapshotStorageKey(key, StorageBackend.indexedDb)
        return { keys: [lockKey.record(captured)], run: (scope) => scope.deleteRecord(captured) }
      }
    )

  clearRecords: IIndexedDbStoreRecordsShape<TValue>['clearRecords'] = (ctx) =>
    rootClear(this.#indexedDbContext, 'clearRecords', 'record', ctx)

  iterateRecords: IIndexedDbStoreRecordsShape<TValue>['iterateRecords'] = (...args) =>
    iterateIndexedDbRecords(this.#indexedDbContext, ...args)

  /** Capture the owner state; members are own-property arrows so the public shape is unchanged. */
  constructor(indexedDbContext: IIndexedDbContext<TValue>) {
    this.#indexedDbContext = indexedDbContext
  }
}

/** Compose root records access from the existing native backend ports. */
export function createIndexedDbStoreRecords<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): Pick<
  IIndexedDbStore<TValue>,
  'getRecord' | 'putRecord' | 'deleteRecord' | 'clearRecords' | 'iterateRecords'
> {
  return new IndexedDbStoreRecords<TValue>(indexedDbContext)
}
/** Compose root transactions access from the existing native backend ports. */
export function createIndexedDbStoreTransactions<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): Pick<IIndexedDbStore<TValue>, 'tx' | 'transaction'> {
  return {
    tx: () =>
      createTransactionBuilder(
        indexedDbContext.construction.store,
        undefined,
        indexedDbContext.runtime.getChainMethods('tx')
      ),
    transaction: (run, ctx) => {
      assertLive(indexedDbContext)
      return withMutationLease(indexedDbContext, (lease) =>
        runTransaction(indexedDbContext, run, ctx, lease)
      )
    }
  }
}

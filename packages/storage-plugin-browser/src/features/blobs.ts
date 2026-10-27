import {
  assertStringStorageKey,
  StorageContractError,
  StorageContractErrorCode,
  type IOperationContext
} from '@migaia/storage-contract'
import { runTransactionOperation } from '@migaia/storage-host/authoring/transaction'
import {
  defineFeature,
  type IStorageFeature,
  type IStorageFeatureOutput
} from '@migaia/storage-host'
import { createStorageOperationRuntime } from '@migaia/storage-host/authoring/backend'
import { indexedDbBackendKind } from '../host/builtin-kinds.js'
import { INDEXED_DB_BLOB_STORE, StorageBackend } from '../constants.js'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'
import { fromIdbRequest, normalizeIdbRequestFailure } from '../utils/idb-request.js'

/** Blob and File values use the selected native store's structured clone without a codec. */
export type IIndexedDbBlobApi = {
  put(key: string, value: Blob, ctx?: IOperationContext): Promise<void>
  get(key: string, ctx?: IOperationContext): Promise<Blob | undefined>
  remove(key: string, ctx?: IOperationContext): Promise<void>
}
/** Transaction methods borrow the existing native scope and accept no independent context. */
export type ITransactionBlobApi = {
  put(key: string, value: Blob): Promise<void>
  get(key: string): Promise<Blob | undefined>
  remove(key: string): Promise<void>
}
/** Selecting the Feature adds only its named native store and two API projections. */
type IIndexedDbBlobOutput = IStorageFeatureOutput<
  readonly [],
  {},
  {
    readonly store: { readonly blobs: IIndexedDbBlobApi }
    readonly transaction: { readonly blobs: ITransactionBlobApi }
  }
>

/** Declare native schema before opening, then join every Blob request to the original executor. */
export function indexedDbBlobFeature(options?: {
  readonly storeName?: string
}): IStorageFeature<typeof indexedDbBackendKind, IIndexedDbBlobOutput> {
  /** Borrowed configuration is captured before any installation or database request. */
  let storeName: string
  try {
    const configured = options?.storeName
    if (
      (options !== undefined &&
        (typeof options !== 'object' || options === null || Array.isArray(options))) ||
      (configured !== undefined && (typeof configured !== 'string' || configured.length === 0))
    )
      throw new StorageError(
        StorageErrorCode.invalidConfig,
        { backend: StorageBackend.indexedDb },
        StorageErrorText.indexedDbSchemaDeclarationInvalid
      )
    storeName = configured ?? INDEXED_DB_BLOB_STORE
  } catch (cause) {
    if (cause instanceof StorageError) throw cause
    throw new StorageError(
      StorageErrorCode.invalidConfig,
      { backend: StorageBackend.indexedDb, cause },
      StorageErrorText.indexedDbSchemaDeclarationInvalid
    )
  }
  return defineFeature<typeof indexedDbBackendKind, {}, IIndexedDbBlobOutput>(
    indexedDbBackendKind,
    ({ featureExpose }) => {
      featureExpose.requireObjectStore(storeName)
      /** Request normalization reuses the backend's original bridge and diagnostic owner. */
      const runtime = createStorageOperationRuntime()
      /** Request success stays provisional until the original transaction owner reaches commit. */
      function request<T>(
        transaction: IDBTransaction,
        invoke: (store: IDBObjectStore) => IDBRequest<T>
      ): Promise<T> {
        try {
          return fromIdbRequest(invoke(transaction.objectStore(storeName)), undefined, runtime)
        } catch (cause) {
          return Promise.reject(normalizeIdbRequestFailure(cause))
        }
      }
      /** Native put preserves Blob/File metadata and never serializes portable payload bytes. */
      function put(transaction: IDBTransaction, key: string, value: Blob): Promise<void> {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        if (typeof Blob === 'undefined' || !(value instanceof Blob))
          return Promise.reject(
            new StorageContractError(StorageContractErrorCode.invalidArgument, {
              backend: StorageBackend.indexedDb
            })
          )
        return request(transaction, (store) => store.put(value, key)).then(() => undefined)
      }
      /** Missing values keep the native undefined result. */
      function get(transaction: IDBTransaction, key: string): Promise<Blob | undefined> {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        return request(transaction, (store) => store.get(key))
      }
      /** Removing a missing native Blob row is idempotent and remains in the same transaction. */
      function remove(transaction: IDBTransaction, key: string): Promise<void> {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        return request(transaction, (store) => store.delete(key)).then(() => undefined)
      }
      return {
        capabilities: [] as const,
        chain: {},
        api: {
          store: {
            blobs: {
              put(key, value, ctx) {
                return this.store.transaction(
                  (scope) =>
                    runTransactionOperation(scope, (current) =>
                      put(featureExpose.getTransactionClientForOrg(current, this.orgId), key, value)
                    ),
                  ctx
                )
              },
              get(key, ctx) {
                return this.store.transaction(
                  (scope) =>
                    runTransactionOperation(scope, (current) =>
                      get(featureExpose.getTransactionClientForOrg(current, this.orgId), key)
                    ),
                  ctx
                )
              },
              remove(key, ctx) {
                return this.store.transaction(
                  (scope) =>
                    runTransactionOperation(scope, (current) =>
                      remove(featureExpose.getTransactionClientForOrg(current, this.orgId), key)
                    ),
                  ctx
                )
              }
            }
          },
          transaction: {
            blobs: {
              put(key, value) {
                return put(this.client, key, value)
              },
              get(key) {
                return get(this.client, key)
              },
              remove(key) {
                return remove(this.client, key)
              }
            }
          }
        }
      }
    }
  )
}

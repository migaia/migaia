// Layout validation, legacy migration, database open and metadata reads/writes for the IndexedDB backend (see ./indexed-db.ts).
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import type { IStorageOperationRuntime } from '@migaia/storage-host/sdk'
import { isStorageErrorFamily } from './backend-errors.ts'
import { StorageError, createStorageError } from '../types/errors.ts'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.ts'
import { StorageBackend, StorageMigrationStatus, StorageOperation } from '../constants.ts'
import { normalizeError } from './backend-errors.ts'
import {
  fromIdbRequest,
  idbTransactionCommit,
  installIdbOpenRequestHandlers,
  installIdbRequestHandlers,
  installIdbTransactionHandlers,
  readIdbOpenTransaction,
  readIdbRequestError,
  readIdbRequestResult,
  readIdbTransactionError
} from '../utils/idb-request.ts'
import type { IStorageKey } from '../types/context.ts'
import {
  REVISIONS_STORE_NAME,
  META_STORE_NAME,
  LEGACY_RECORDS_STORE_NAME,
  LEGACY_RECORDS_MIGRATION_KEY,
  INDEX_RECORDS_STORE_NAME,
  RECORD_EPOCH_KEY,
  LEGACY_RECORDS_MIGRATION_MIRROR_KEY,
  LEGACY_MIGRATION_BATCH_SIZE,
  META_SCHEMA_KEY,
  CURRENT_SCHEMA_VERSION,
  LEGACY_META_SCHEMA_KEY
} from './indexed-db-layout.ts'
import {
  withInternalMutationLease,
  recordRevisionKey,
  classifyLegacyMutationBatch,
  applyRawMutationFirewall,
  tryCloseDatabase,
  closeForTransition
} from './indexed-db-lifecycle.ts'
import { publishChange } from './indexed-db.ts'
import type { IIndexedDbContext, IMutationLeaseContext } from './indexed-db.ts'

/** Validate the fixed native layout before any metadata can influence backend authority. */
function validatePhysicalLayout<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  database: IDBDatabase
): void {
  try {
    const transaction = database.transaction(
      [
        indexedDbContext.kvStoreName,
        indexedDbContext.bytesStoreName,
        indexedDbContext.recordsStoreName,
        REVISIONS_STORE_NAME,
        META_STORE_NAME
      ],
      'readonly'
    )
    for (const storeName of [
      indexedDbContext.kvStoreName,
      indexedDbContext.bytesStoreName,
      indexedDbContext.recordsStoreName
    ]) {
      if (transaction.objectStore(storeName).keyPath !== null)
        throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
          backend: StorageBackend.indexedDb,
          operation: StorageOperation.indexedDbSchema,
          cause: new TypeError(StorageErrorText.indexedDbChannelKeyPathInvalid)
        })
    }
    for (const storeName of [REVISIONS_STORE_NAME, META_STORE_NAME]) {
      if (transaction.objectStore(storeName).keyPath !== null)
        throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
          backend: StorageBackend.indexedDb,
          operation: StorageOperation.indexedDbSchema,
          cause: new TypeError('IndexedDB internal stores must use private keys')
        })
    }
    indexedDbContext.assemblies.indexes?.validateSchema(database)
  } catch (cause) {
    if (isStorageErrorFamily(cause)) throw cause
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      operation: StorageOperation.indexedDbSchema,
      cause
    })
  }
}

/** Layout/version conflicts are stable until an operator changes the database; other failures retry. */
function isTerminalPrepareFailure(cause: unknown): boolean {
  return (
    cause instanceof StorageError &&
    (cause.code === StorageBrowserErrorCode.invalidConfig ||
      cause.code === StorageBrowserErrorCode.versionUnsupported)
  )
}

function ensureStores<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  database: IDBDatabase,
  transaction: IDBTransaction
): { readonly created: boolean; readonly recordsCreated: boolean } {
  let created = false
  let recordsCreated = false
  if (!database.objectStoreNames.contains(indexedDbContext.kvStoreName)) {
    database.createObjectStore(indexedDbContext.kvStoreName)
    created = true
  }
  if (!database.objectStoreNames.contains(indexedDbContext.recordsStoreName)) {
    database.createObjectStore(indexedDbContext.recordsStoreName)
    created = true
    recordsCreated = true
  }
  if (!database.objectStoreNames.contains(indexedDbContext.bytesStoreName)) {
    database.createObjectStore(indexedDbContext.bytesStoreName)
    created = true
  }
  if (!database.objectStoreNames.contains(REVISIONS_STORE_NAME)) {
    database.createObjectStore(REVISIONS_STORE_NAME)
    created = true
  }
  if (!database.objectStoreNames.contains(META_STORE_NAME)) {
    database.createObjectStore(META_STORE_NAME)
    created = true
  }
  /** Deadline lookup extends the original META layout without rewriting any existing data. */
  if (indexedDbContext.assemblies.ttl?.ensureSchema(transaction.objectStore(META_STORE_NAME)))
    created = true
  if (indexedDbContext.assemblies.indexes?.ensureSchema(database)) created = true
  for (const name of indexedDbContext.featureStoreNames) {
    if (database.objectStoreNames.contains(name)) continue
    database.createObjectStore(name)
    created = true
  }
  return { created, recordsCreated }
}

/** Copy the historical store in restartable read/write batches. */
async function migrateLegacyRecords<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  database: IDBDatabase,
  runtime: IStorageOperationRuntime,
  inheritedLease?: IMutationLeaseContext
): Promise<void> {
  return withInternalMutationLease(
    indexedDbContext,
    async () => {
      if (!database.objectStoreNames.contains(LEGACY_RECORDS_STORE_NAME)) return
      if (indexedDbContext.recordsStoreName === LEGACY_RECORDS_STORE_NAME) return
      const state = (await readFromMetadata(
        indexedDbContext,
        database,
        LEGACY_RECORDS_MIGRATION_KEY,
        runtime
      )) as { status?: unknown; to?: unknown; lastKey?: IDBValidKey } | undefined
      if (state?.status === 'complete' && state.to === indexedDbContext.recordsStoreName) return
      let lastKey = state?.lastKey
      while (true) {
        const batch = await readLegacyBatch(indexedDbContext, database, lastKey)
        if (batch.length === 0) {
          await writeLegacyMigrationState(
            indexedDbContext,
            database,
            {
              status: StorageMigrationStatus.complete,
              from: LEGACY_RECORDS_STORE_NAME,
              to: indexedDbContext.recordsStoreName
            },
            runtime
          )
          return
        }
        const transaction = createTransaction(
          database,
          [
            LEGACY_RECORDS_STORE_NAME,
            indexedDbContext.recordsStoreName,
            REVISIONS_STORE_NAME,
            ...(database.objectStoreNames.contains(INDEX_RECORDS_STORE_NAME)
              ? [INDEX_RECORDS_STORE_NAME]
              : []),
            META_STORE_NAME
          ],
          'readwrite'
        )
        const committed = idbTransactionCommit(transaction, undefined, runtime)
        void committed.catch(() => {})
        const source = transaction.objectStore(LEGACY_RECORDS_STORE_NAME)
        const target = transaction.objectStore(indexedDbContext.recordsStoreName)
        const revisions = transaction.objectStore(REVISIONS_STORE_NAME)
        const meta = transaction.objectStore(META_STORE_NAME)
        const sidecar = transaction.objectStoreNames.contains(INDEX_RECORDS_STORE_NAME)
          ? transaction.objectStore(INDEX_RECORDS_STORE_NAME)
          : undefined
        /**
         * Only the entries this batch actually copies (not skipped as pre-existing or
         * already-removed from the legacy store), so a batch that copies nothing publishes
         * nothing.
         */
        const migratedKeys: IStorageKey[] = []
        try {
          for (const entry of batch) {
            const existingKey = await fromIdbRequest(target.getKey(entry.key), {}, runtime)
            if (existingKey !== undefined) continue
            const currentKey = await fromIdbRequest(source.getKey(entry.key), {}, runtime)
            if (currentKey === undefined) continue
            const currentValue = await fromIdbRequest(source.get(entry.key), {}, runtime)
            target.put(currentValue, entry.key)
            const migratedKey = entry.key as IStorageKey
            const revision = (await fromIdbRequest(
              revisions.get(recordRevisionKey(indexedDbContext, migratedKey)) as IDBRequest<
                number | undefined
              >,
              {},
              runtime
            )) as number | undefined
            revisions.put((revision ?? 0) + 1, recordRevisionKey(indexedDbContext, migratedKey))
            migratedKeys.push(migratedKey)
          }
          // Legacy keys cannot be projected by the canonical entity planner. Invalidate every
          // existing projection in this same transaction before publishing the migration checkpoint.
          if (migratedKeys.length > 0) {
            const authority = classifyLegacyMutationBatch(migratedKeys)
            await applyRawMutationFirewall(
              indexedDbContext,
              meta,
              revisions,
              sidecar,
              undefined,
              undefined,
              runtime,
              authority
            )
            const epoch = (await fromIdbRequest(
              revisions.get(RECORD_EPOCH_KEY) as IDBRequest<number | undefined>,
              {},
              runtime
            )) as number | undefined
            revisions.put((epoch ?? 0) + 1, RECORD_EPOCH_KEY)
          }
          meta.put(
            {
              status: StorageMigrationStatus.running,
              from: LEGACY_RECORDS_STORE_NAME,
              to: indexedDbContext.recordsStoreName,
              lastKey: batch[batch.length - 1]!.key
            },
            LEGACY_RECORDS_MIGRATION_KEY
          )
          await committed
          // This backend's own record-mutating route, previously entirely silent —
          // a subscriber must learn that records materialized in the store it is watching, exactly
          // as any other route that commits records does.
          if (migratedKeys.length > 0)
            publishChange(indexedDbContext, {
              channel: 'record',
              kind: 'batch',
              keys: migratedKeys
            })
        } catch (cause) {
          try {
            transaction.abort()
          } catch {
            /* transaction already settled */
          }
          await committed.catch(() => {})
          throw cause
        }
        lastKey = batch[batch.length - 1]!.key
      }
    },
    inheritedLease
  )
}

async function readFromMetadata<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  database: IDBDatabase,
  key: IDBValidKey,
  runtime: IStorageOperationRuntime
): Promise<unknown | undefined> {
  const transaction = createTransaction(database, META_STORE_NAME, 'readonly')
  return fromIdbRequest(transaction.objectStore(META_STORE_NAME).get(key), {}, runtime)
}

async function writeLegacyMigrationState<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  database: IDBDatabase,
  state: unknown,
  runtime: IStorageOperationRuntime
): Promise<void> {
  const transaction = createTransaction(database, META_STORE_NAME, 'readwrite')
  const committed = idbTransactionCommit(transaction, undefined, runtime)
  void committed.catch(() => {})
  try {
    transaction.objectStore(META_STORE_NAME).put(state, LEGACY_RECORDS_MIGRATION_KEY)
    transaction.objectStore(META_STORE_NAME).put(state, LEGACY_RECORDS_MIGRATION_MIRROR_KEY)
    await committed
  } catch (cause) {
    try {
      transaction.abort()
    } catch {
      /* transaction already settled */
    }
    await committed.catch(() => {})
    throw cause
  }
}

async function readLegacyBatch<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  database: IDBDatabase,
  lastKey: IDBValidKey | undefined
): Promise<Array<{ readonly key: IDBValidKey; readonly value: unknown }>> {
  if (lastKey !== undefined && !indexedDbContext.keyRange)
    throw new StorageError(StorageBrowserErrorCode.unavailable, {
      backend: StorageBackend.indexedDb,
      operation: StorageOperation.indexedDbLegacyMigration,
      cause: new Error('IDBKeyRange is required to resume legacy migration')
    })
  let transaction: IDBTransaction
  let request: IDBRequest<IDBCursorWithValue | null>
  try {
    transaction = createTransaction(database, LEGACY_RECORDS_STORE_NAME, 'readonly')
    const store = transaction.objectStore(LEGACY_RECORDS_STORE_NAME)
    const range =
      lastKey === undefined
        ? undefined
        : (indexedDbContext.keyRange?.lowerBound(lastKey, true) ?? undefined)
    request = store.openCursor(range)
  } catch (cause) {
    throw normalizeError(
      cause,
      StorageBackend.indexedDb,
      StorageBrowserErrorCode.transactionFailed,
      'indexeddb.legacy.cursor'
    )
  }
  return new Promise((resolve, reject) => {
    const batch: Array<{ readonly key: IDBValidKey; readonly value: unknown }> = []
    let cursorFinished = false
    let settled = false
    const failure = (cause: unknown): void => {
      if (settled) return
      settled = true
      /**
       * Preserve the host failure while assigning this cursor boundary's operation metadata. Only a
       * web `StorageError` bridge wrapper is unwrapped; a contract error stays whole so
       * `normalizeError` lets it penetrate (rule).
       */
      const rootCause = cause instanceof StorageError ? (cause.cause ?? cause) : cause
      reject(
        normalizeError(
          rootCause,
          StorageBackend.indexedDb,
          StorageBrowserErrorCode.transactionFailed,
          'indexeddb.legacy.cursor'
        )
      )
    }
    try {
      installIdbTransactionHandlers(
        transaction,
        () => {
          if (settled) return
          if (!cursorFinished) {
            failure(new Error('IndexedDB transaction completed before legacy cursor finished'))
            return
          }
          settled = true
          resolve(batch)
        },
        () => failure(readIdbTransactionError(transaction)),
        () => failure(readIdbTransactionError(transaction))
      )
      installIdbRequestHandlers(
        request,
        () => {
          try {
            const cursor = readIdbRequestResult(request)
            if (!cursor || batch.length >= LEGACY_MIGRATION_BATCH_SIZE) {
              cursorFinished = true
              return
            }
            batch.push({ key: cursor.key, value: cursor.value })
            cursor.continue()
          } catch (cause) {
            failure(cause)
          }
        },
        () => failure(readIdbRequestError(request))
      )
    } catch (cause) {
      failure(cause)
      try {
        transaction.abort()
      } catch {
        /* setup failure already owns the result */
      }
    }
  })
}

/** Delete the legacy store only after a completed copy was recorded in metadata. */
function cleanupLegacyRecordStore<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  database: IDBDatabase,
  transaction: IDBTransaction,
  onFailure: (cause: unknown) => void
): void {
  if (
    !indexedDbContext.cleanupLegacyRecords ||
    !database.objectStoreNames.contains(LEGACY_RECORDS_STORE_NAME)
  )
    return
  const metadata = transaction.objectStore(META_STORE_NAME)
  const request = metadata.get(LEGACY_RECORDS_MIGRATION_KEY)
  installIdbRequestHandlers(
    request,
    () => {
      try {
        const state = readIdbRequestResult(request) as
          | { status?: unknown; to?: unknown }
          | undefined
        if (state?.status === 'complete' && state.to === indexedDbContext.recordsStoreName)
          database.deleteObjectStore(LEGACY_RECORDS_STORE_NAME)
      } catch (cause) {
        onFailure(cause)
      }
    },
    () => onFailure(readIdbRequestError(request))
  )
}

function openOnce<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  version?: number
): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false
    let request: IDBOpenDBRequest
    /** Reject this open attempt once while preserving the owning operation metadata. */
    const rejectOpen = (cause: unknown): void => {
      if (settled) return
      settled = true
      /**
       * Remove an intermediate web bridge wrapper before assigning open semantics; a contract error
       * is never unwrapped so `normalizeError` lets it penetrate (rule).
       */
      const rootCause = cause instanceof StorageError ? (cause.cause ?? cause) : cause
      reject(
        normalizeError(
          rootCause,
          StorageBackend.indexedDb,
          StorageBrowserErrorCode.unavailable,
          StorageOperation.indexedDbOpen
        )
      )
    }
    try {
      request =
        version === undefined
          ? indexedDbContext.factory.open(indexedDbContext.dbName)
          : indexedDbContext.factory.open(indexedDbContext.dbName, version)
    } catch (cause) {
      rejectOpen(cause)
      return
    }
    /** Abort a failed upgrade when possible, then settle the public open Promise immediately. */
    const failUpgrade = (cause: unknown): void => {
      try {
        readIdbOpenTransaction(request)?.abort()
      } catch {
        /* transaction unavailable or already settled */
      }
      rejectOpen(cause)
    }
    try {
      installIdbOpenRequestHandlers(
        request,
        () => {
          try {
            const transaction = readIdbOpenTransaction(request)
            if (settled) {
              transaction?.abort()
              return
            }
            const database = readIdbRequestResult(request)
            if (!transaction)
              throw createStorageError(
                StorageBrowserErrorCode.transactionFailed,
                StorageErrorText.indexedDbUpgradeTransactionMissing
              )
            ensureStores(indexedDbContext, database, transaction)
            cleanupLegacyRecordStore(indexedDbContext, database, transaction, failUpgrade)
          } catch (cause) {
            failUpgrade(cause)
          }
        },
        () => rejectOpen(new Error('IndexedDB upgrade is blocked by another open connection')),
        () => {
          let database: IDBDatabase
          try {
            database = readIdbRequestResult(request)
          } catch (cause) {
            rejectOpen(cause)
            return
          }
          if (settled) {
            tryCloseDatabase(database)
            return
          }
          settled = true
          resolve(database)
        },
        () => {
          const cause = readIdbRequestError(request)
          rejectOpen(cause ?? new Error(StorageErrorText.indexedDbOpenFailed))
        }
      )
    } catch (cause) {
      failUpgrade(cause)
    }
  })
}

export function open<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  runtime: IStorageOperationRuntime,
  inheritedLease?: IMutationLeaseContext
): Promise<IDBDatabase> {
  if (indexedDbContext.prepareState === 'disposed') {
    return Promise.reject(
      new StorageContractError(StorageContractErrorCode.disposed, {
        backend: StorageBackend.indexedDb
      })
    )
  }
  if (indexedDbContext.deleting !== undefined)
    return indexedDbContext.deleting.then(() => open(indexedDbContext, runtime, inheritedLease))
  if (indexedDbContext.prepareState === 'terminal')
    return Promise.reject(indexedDbContext.terminalPrepareFailure)
  if (indexedDbContext.connection !== undefined) return indexedDbContext.connection
  indexedDbContext.prepareState = 'running'
  indexedDbContext.connection = withInternalMutationLease(
    indexedDbContext,
    async (lease) => {
      const recoveryDatabase = indexedDbContext.activeDatabase
      if (recoveryDatabase) closeForTransition(indexedDbContext, recoveryDatabase)
      // 不写死版本号：同一个 dbName 可能已被别处用别的 storeName 建过，
      // 硬开 version 1 不会触发 upgrade，之后 transaction(storeName) 直接
      // 抛 NotFoundError。先按当前版本开，缺 store 再升一版补建。
      let database = await openOnce(indexedDbContext)
      const attachConnectionHandlers = (connected: IDBDatabase): void => {
        try {
          // 别的标签页要升级时必须让路，否则对方会一直 blocked。
          Object.assign(connected, {
            onversionchange: () => {
              indexedDbContext.journalGeneration = {}
              try {
                connected.close()
              } catch {
                /* Host close failures must not retain a stale connection cache. */
              } finally {
                if (indexedDbContext.activeDatabase === connected) {
                  indexedDbContext.activeDatabase = undefined
                  indexedDbContext.connection = undefined
                  if (indexedDbContext.prepareState === 'ready')
                    indexedDbContext.prepareState = 'idle'
                }
              }
            },
            onclose: () => {
              // A stale close event from an older connection must not evict a newer cache entry.
              if (indexedDbContext.activeDatabase === connected) {
                indexedDbContext.activeDatabase = undefined
                indexedDbContext.connection = undefined
                if (indexedDbContext.prepareState === 'ready')
                  indexedDbContext.prepareState = 'idle'
              }
            }
          })
          indexedDbContext.activeDatabase = connected
        } catch (cause) {
          throw normalizeError(
            cause,
            StorageBackend.indexedDb,
            StorageBrowserErrorCode.unavailable,
            StorageOperation.indexedDbOpen
          )
        }
      }
      try {
        if (
          !database.objectStoreNames.contains(indexedDbContext.kvStoreName) ||
          !database.objectStoreNames.contains(indexedDbContext.recordsStoreName) ||
          !database.objectStoreNames.contains(indexedDbContext.bytesStoreName) ||
          !database.objectStoreNames.contains(REVISIONS_STORE_NAME) ||
          !database.objectStoreNames.contains(META_STORE_NAME) ||
          (indexedDbContext.assemblies.indexes !== undefined &&
            !database.objectStoreNames.contains(INDEX_RECORDS_STORE_NAME)) ||
          (indexedDbContext.assemblies.ttl !== undefined &&
            !indexedDbContext.assemblies.ttl.hasSchema(
              database.transaction(META_STORE_NAME, 'readonly').objectStore(META_STORE_NAME)
            )) ||
          indexedDbContext.featureStoreNames.some(
            (name) => !database.objectStoreNames.contains(name)
          )
        ) {
          const nextVersion = database.version + 1
          closeForTransition(indexedDbContext, database)
          database = await openOnce(indexedDbContext, nextVersion)
        }
        attachConnectionHandlers(database)
        validatePhysicalLayout(indexedDbContext, database)
        await ensureMeta(indexedDbContext, database, runtime)
        await migrateLegacyRecords(indexedDbContext, database, runtime, lease)
        if (
          indexedDbContext.cleanupLegacyRecords &&
          database.objectStoreNames.contains(LEGACY_RECORDS_STORE_NAME)
        ) {
          const nextVersion = database.version + 1
          closeForTransition(indexedDbContext, database)
          database = await openOnce(indexedDbContext, nextVersion)
          attachConnectionHandlers(database)
        }
        return database
      } catch (cause) {
        const closeCause = tryCloseDatabase(database)
        if (closeCause !== undefined) indexedDbContext.activeDatabase = database
        else if (indexedDbContext.activeDatabase === database)
          indexedDbContext.activeDatabase = undefined
        throw isStorageErrorFamily(cause)
          ? cause
          : normalizeError(
              cause,
              StorageBackend.indexedDb,
              StorageBrowserErrorCode.unavailable,
              StorageOperation.indexedDbOpen
            )
      }
    },
    inheritedLease
  )
    .then((database) => {
      if (indexedDbContext.prepareState !== 'disposed') indexedDbContext.prepareState = 'ready'
      return database
    })
    .catch((error: unknown) => {
      indexedDbContext.connection = undefined
      if (indexedDbContext.prepareState === 'disposed') throw error
      if (isTerminalPrepareFailure(error)) {
        indexedDbContext.prepareState = 'terminal'
        indexedDbContext.terminalPrepareFailure = error
      } else indexedDbContext.prepareState = 'idle'
      throw error
    })
  return indexedDbContext.connection
}

export function createTransaction(
  database: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode
): IDBTransaction {
  try {
    return database.transaction(stores, mode)
  } catch (cause) {
    throw normalizeError(
      cause,
      StorageBackend.indexedDb,
      StorageBrowserErrorCode.transactionFailed,
      StorageOperation.indexedDbTransaction
    )
  }
}

/** Persist the schema checkpoint so future upgrades can distinguish initialized v2 stores. */
async function ensureMeta<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  database: IDBDatabase,
  runtime: IStorageOperationRuntime
): Promise<void> {
  const readTransaction = createTransaction(database, META_STORE_NAME, 'readonly')
  const current = await fromIdbRequest(
    readTransaction.objectStore(META_STORE_NAME).get(META_SCHEMA_KEY),
    {},
    runtime
  )
  if (current && typeof current === 'object') {
    const schemaVersion = (current as { version?: unknown }).version
    if (schemaVersion === CURRENT_SCHEMA_VERSION) return
    if (typeof schemaVersion === 'number' && schemaVersion > CURRENT_SCHEMA_VERSION)
      throw new StorageError(StorageBrowserErrorCode.versionUnsupported, {
        backend: StorageBackend.indexedDb,
        operation: StorageOperation.indexedDbSchema,
        cause: new Error(
          `IndexedDB schema version ${schemaVersion} is newer than ${CURRENT_SCHEMA_VERSION}`
        )
      })
  }
  const writeTransaction = createTransaction(database, META_STORE_NAME, 'readwrite')
  const committed = idbTransactionCommit(writeTransaction, undefined, runtime)
  void committed.catch(() => {})
  try {
    writeTransaction.objectStore(META_STORE_NAME).put(
      {
        version: CURRENT_SCHEMA_VERSION,
        keySpace: 'repository-v2',
        migration: 'checkpointed'
      },
      META_SCHEMA_KEY
    )
    writeTransaction.objectStore(META_STORE_NAME).put(
      {
        version: CURRENT_SCHEMA_VERSION,
        keySpace: 'repository-v2',
        migration: 'checkpointed'
      },
      LEGACY_META_SCHEMA_KEY
    )
    await committed
  } catch (cause) {
    try {
      writeTransaction.abort()
    } catch {
      /* transaction already settled */
    }
    await committed.catch(() => {})
    throw cause
  }
}

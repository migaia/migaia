import {
  StorageContractError,
  StorageContractErrorCode,
  isStorageContractError
} from '@migaia/storage-contract';
import { isStorageErrorFamily } from '../core/error-family.js';
import {
  createStorageOperationRuntime,
  type IStorageOperationRuntime
} from '../core/operation-reporter.js';
import { StorageError, StorageErrorCode } from '../types/errors.js';
import {
  StorageBackend,
  StorageChannel,
  StorageConflictPolicy,
  StorageMigrationStatus,
  StorageOperation
} from '../constants.js';
import {
  mergeSignals,
  readAbortReason,
  subscribeToAbort,
  throwIfAborted,
  withAbort
} from '../core/operation.js';
import {
  assertStringStorageKey,
  encodeFlatStorageKey,
  snapshotStorageKey,
  snapshotKeyRange
} from '../core/key-domain.js';
import { planChannelWrite } from '../core/channel-write.js';
import { isUint8Array } from '../core/bytes.js';
import { intrinsicConstructorName } from '../core/brand.js';
import { normalizeError } from '../core/errors.js';
import {
  fromIdbRequest,
  idbTransactionCommit,
  installIdbOpenRequestHandlers,
  installIdbRequestHandlers,
  installIdbTransactionHandlers,
  normalizeIdbRequestFailure,
  readIdbOpenTransaction,
  readIdbRequestError,
  readIdbRequestResult,
  readIdbTransactionError
} from '../utils/idb-request.js';
import type { IKeyRange, IStorageKey } from '../types/context.js';
import type { IRecordStore } from '../types/storage.js';
import {
  assertTransactionCallback,
  assertTransactionScopeActive,
  readTransactionConflictPolicy,
  type ITransactionScope
} from '../core/transaction.js';
import type { IStorageCapabilities } from '../types/capabilities.js';

const CAPABILITIES: IStorageCapabilities = Object.freeze({
  syncRead: false,
  binary: true,
  records: true,
  transactions: true,
  iteration: true,
  maxValueBytes: undefined,
  opaqueEntries: false
});

/** Convert current cancellation state into an IndexedDB-owned error without throwing from events. */
const indexedDbSignalFailure = (
  signal: AbortSignal | undefined
): StorageError | StorageContractError | undefined => {
  try {
    throwIfAborted(signal);
    return undefined;
  } catch (cause) {
    if (cause instanceof StorageError)
      return new StorageError(cause.code, {
        backend: StorageBackend.indexedDb,
        cause: cause.cause ?? cause
      });
    if (isStorageContractError(cause)) return cause;
    return new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause
    });
  }
};

export type IIndexedDbOptions = {
  readonly dbName?: string;
  readonly kvStoreName?: string;
  readonly bytesStoreName?: string;
  readonly recordsStoreName?: string;
  /** Explicit release-time opt-in to delete the legacy `documents` object store after migration. */
  readonly cleanupLegacyRecords?: boolean;
  /** 注入点：测试环境（jsdom 没有 IndexedDB）与非浏览器环境用。 */
  readonly factory?: IDBFactory;
  /**
   * 注入点：`IDBKeyRange` 构造器。jsdom 完全不提供 IndexedDB，测试环境下 必须和 `factory` 一起从 fake-indexeddb
   * 显式传入；真实浏览器默认取 `globalThis.IDBKeyRange`。
   */
  readonly keyRange?: typeof IDBKeyRange;
};

const REVISIONS_STORE_NAME = '__storage_web_revisions__';
const META_STORE_NAME = 'storage-web:meta';
const META_SCHEMA_KEY = 'schema';
const CURRENT_SCHEMA_VERSION = 2;
const LEGACY_RECORDS_STORE_NAME = 'documents';
const LEGACY_RECORDS_MIGRATION_KEY = 'migration:records-v1-to-v2';
const RECORD_EPOCH_KEY = '__storage_web_record_epoch__';
const LEGACY_MIGRATION_BATCH_SIZE = 128;
const INTERNAL_STORE_NAMES = new Set([REVISIONS_STORE_NAME, META_STORE_NAME]);

/** 判断 IndexedDB 数据库/对象仓库名称是否满足构造期契约。 */
const isValidStoreName = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/** Realm-wide monotonic suffix prevents silent overwrite when entropy sources repeat. */
let indexedDbAutoKeySequence = 0;

const autoKey = (): string => {
  const entropy =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  indexedDbAutoKeySequence += 1;
  return `${entropy}-${indexedDbAutoKeySequence.toString(36)}`;
};

const toIdbKey = (key: IStorageKey): IDBValidKey => key as IDBValidKey;

/** Detach mutable record/byte payloads before the first asynchronous backend boundary. */
const snapshotWriteValue = <T>(value: T, key: IStorageKey): T => {
  try {
    return structuredClone(value);
  } catch (cause) {
    throw new StorageError(StorageErrorCode.serializeFailed, {
      backend: StorageBackend.indexedDb,
      key,
      cause
    });
  }
};

/**
 * `ArrayBuffer.isView` 与 `Object.prototype.toString` 是跨 realm 安全的： IndexedDB 的结构化克隆可能在与调用方不同的 realm
 * 里重建 Uint8Array/ArrayBuffer （测试环境下 fake-indexeddb 与 jsdom 就是两个不同 realm 的典型场景）， `instanceof`
 * 在这种情况下会误判为 false，即便 constructor.name 完全一致。
 */
const isByteView = (value: unknown): value is Uint8Array => ArrayBuffer.isView(value);
const isRawArrayBuffer = (value: unknown): value is ArrayBuffer =>
  intrinsicConstructorName(value) === 'ArrayBuffer';

const toIdbRange = (
  range: IKeyRange | undefined,
  KeyRange: typeof IDBKeyRange | undefined
): IDBKeyRange | undefined => {
  const rangeSnapshot = snapshotKeyRange(range, StorageBackend.indexedDb);
  if (!rangeSnapshot) return undefined;
  if (!KeyRange)
    throw new StorageError(StorageErrorCode.unavailable, {
      backend: StorageBackend.indexedDb,
      cause: new Error('IDBKeyRange is unavailable; pass options.keyRange explicitly')
    });
  if (rangeSnapshot.lower !== undefined && rangeSnapshot.upper !== undefined)
    return KeyRange.bound(
      toIdbKey(rangeSnapshot.lower),
      toIdbKey(rangeSnapshot.upper),
      rangeSnapshot.lowerOpen ?? false,
      rangeSnapshot.upperOpen ?? false
    );
  if (rangeSnapshot.lower !== undefined)
    return KeyRange.lowerBound(toIdbKey(rangeSnapshot.lower), rangeSnapshot.lowerOpen ?? false);
  if (rangeSnapshot.upper !== undefined)
    return KeyRange.upperBound(toIdbKey(rangeSnapshot.upper), rangeSnapshot.upperOpen ?? false);
  return undefined;
};

/**
 * IndexedDB 后端：唯一原样存字节、支持索引与事务的浏览器存储。
 *
 * 连接管理、写入-等-commit、onblocked/onversionchange 处理，都是从早期 实现直接搬运的已验证坑位处理，未改动核心逻辑，详见各处注释。
 */
export const indexedDb = <TValue = unknown>(
  options: IIndexedDbOptions = {}
): IRecordStore<TValue> => {
  if (options === null || typeof options !== 'object' || Array.isArray(options))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError('IndexedDB options must be an object')
    });
  let configuredDbName: string | undefined;
  let configuredKvStoreName: string | undefined;
  let configuredBytesStoreName: string | undefined;
  let configuredRecordsStoreName: string | undefined;
  let configuredCleanupLegacyRecords: boolean | undefined;
  let configuredFactory: IDBFactory | undefined;
  let configuredKeyRange: typeof IDBKeyRange | undefined;
  try {
    configuredDbName = options.dbName;
    configuredKvStoreName = options.kvStoreName;
    configuredBytesStoreName = options.bytesStoreName;
    configuredRecordsStoreName = options.recordsStoreName;
    configuredCleanupLegacyRecords = options.cleanupLegacyRecords;
    configuredFactory = options.factory;
    configuredKeyRange = options.keyRange;
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause
    });
  }
  const dbName = configuredDbName === undefined ? 'storage-web' : configuredDbName;
  const kvStoreName = configuredKvStoreName === undefined ? 'kv' : configuredKvStoreName;
  const bytesStoreName =
    configuredBytesStoreName === undefined ? 'bytes' : configuredBytesStoreName;
  const recordsStoreName =
    configuredRecordsStoreName === undefined ? 'records' : configuredRecordsStoreName;
  const cleanupLegacyRecords =
    configuredCleanupLegacyRecords === undefined ? false : configuredCleanupLegacyRecords;
  const factory =
    configuredFactory === undefined
      ? (globalThis as { indexedDB?: IDBFactory }).indexedDB
      : configuredFactory;
  const keyRange =
    configuredKeyRange === undefined
      ? (globalThis as { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange
      : configuredKeyRange;

  if (typeof cleanupLegacyRecords !== 'boolean')
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError('cleanupLegacyRecords must be a boolean')
    });

  if (!factory)
    throw new StorageError(StorageErrorCode.unavailable, { backend: StorageBackend.indexedDb });
  if (
    (typeof factory !== 'object' && typeof factory !== 'function') ||
    factory === null ||
    typeof (factory as { open?: unknown }).open !== 'function'
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError('IndexedDB factory must provide open()')
    });
  if (
    keyRange !== undefined &&
    (typeof keyRange !== 'function' ||
      typeof (keyRange as typeof IDBKeyRange).bound !== 'function' ||
      typeof (keyRange as typeof IDBKeyRange).lowerBound !== 'function' ||
      typeof (keyRange as typeof IDBKeyRange).upperBound !== 'function')
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError('IDBKeyRange must provide bound/lowerBound/upperBound')
    });
  const configuredStoreNames = [kvStoreName, bytesStoreName, recordsStoreName];
  if (
    !isValidStoreName(dbName) ||
    configuredStoreNames.some((storeName) => !isValidStoreName(storeName)) ||
    new Set(configuredStoreNames).size !== configuredStoreNames.length ||
    configuredStoreNames.some((storeName) => INTERNAL_STORE_NAMES.has(storeName))
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError(
        'IndexedDB channel store names must be non-empty, unique, and non-reserved'
      )
    });

  const recordRevisionKey = (key: IStorageKey): IDBValidKey => [
    recordsStoreName,
    encodeFlatStorageKey(key)
  ];

  let disposed = false;
  const assertLive = (): void => {
    if (disposed)
      throw new StorageContractError(StorageContractErrorCode.disposed, {
        backend: StorageBackend.indexedDb
      });
  };

  // 只开一次库，之后所有事务复用同一个连接。失败时要清掉缓存，否则一次瞬时
  // 故障（另一个标签页正卡在旧版本上）会把这个实例永久毒死。
  let connection: Promise<IDBDatabase> | undefined;
  /** Identifies the connection currently allowed to invalidate the cache. */
  let activeDatabase: IDBDatabase | undefined;

  /** Attempt a host close without allowing it to replace the caller's owning failure. */
  const tryCloseDatabase = (database: IDBDatabase): unknown | undefined => {
    try {
      database.close();
      return undefined;
    } catch (cause) {
      return cause;
    }
  };

  /** Close before a required state transition, retaining ownership when the host refuses. */
  const closeForTransition = (database: IDBDatabase): void => {
    const cause = tryCloseDatabase(database);
    if (cause !== undefined) {
      activeDatabase = database;
      throw new StorageError(StorageErrorCode.unavailable, {
        backend: StorageBackend.indexedDb,
        operation: StorageOperation.indexedDbClose,
        cause
      });
    }
    if (activeDatabase === database) activeDatabase = undefined;
  };

  const ensureStores = (
    database: IDBDatabase
  ): { readonly created: boolean; readonly recordsCreated: boolean } => {
    let created = false;
    let recordsCreated = false;
    if (!database.objectStoreNames.contains(kvStoreName)) {
      database.createObjectStore(kvStoreName);
      created = true;
    }
    if (!database.objectStoreNames.contains(recordsStoreName)) {
      database.createObjectStore(recordsStoreName);
      created = true;
      recordsCreated = true;
    }
    if (!database.objectStoreNames.contains(bytesStoreName)) {
      database.createObjectStore(bytesStoreName);
      created = true;
    }
    if (!database.objectStoreNames.contains(REVISIONS_STORE_NAME)) {
      database.createObjectStore(REVISIONS_STORE_NAME);
      created = true;
    }
    if (!database.objectStoreNames.contains(META_STORE_NAME)) {
      database.createObjectStore(META_STORE_NAME);
      created = true;
    }
    return { created, recordsCreated };
  };

  /** Copy the historical store in restartable read/write batches. */
  const migrateLegacyRecords = async (
    database: IDBDatabase,
    runtime: IStorageOperationRuntime
  ): Promise<void> => {
    if (!database.objectStoreNames.contains(LEGACY_RECORDS_STORE_NAME)) return;
    if (!database.objectStoreNames.contains(recordsStoreName)) return;
    if (recordsStoreName === LEGACY_RECORDS_STORE_NAME) return;
    const state = (await readFromMetadata(database, LEGACY_RECORDS_MIGRATION_KEY, runtime)) as
      | { status?: unknown; to?: unknown; lastKey?: IDBValidKey }
      | undefined;
    if (state?.status === 'complete' && state.to === recordsStoreName) return;
    let lastKey = state?.lastKey;
    while (true) {
      const batch = await readLegacyBatch(database, lastKey);
      if (batch.length === 0) {
        await writeLegacyMigrationState(
          database,
          {
            status: StorageMigrationStatus.complete,
            from: LEGACY_RECORDS_STORE_NAME,
            to: recordsStoreName
          },
          runtime
        );
        return;
      }
      const transaction = createTransaction(
        database,
        [LEGACY_RECORDS_STORE_NAME, recordsStoreName, META_STORE_NAME],
        'readwrite'
      );
      const committed = idbTransactionCommit(transaction, undefined, runtime);
      void committed.catch(() => {});
      const source = transaction.objectStore(LEGACY_RECORDS_STORE_NAME);
      const target = transaction.objectStore(recordsStoreName);
      try {
        for (const entry of batch) {
          const existingKey = await fromIdbRequest(target.getKey(entry.key), {}, runtime);
          if (existingKey !== undefined) continue;
          const currentKey = await fromIdbRequest(source.getKey(entry.key), {}, runtime);
          if (currentKey === undefined) continue;
          const currentValue = await fromIdbRequest(source.get(entry.key), {}, runtime);
          target.put(currentValue, entry.key);
        }
        transaction.objectStore(META_STORE_NAME).put(
          {
            status: StorageMigrationStatus.running,
            from: LEGACY_RECORDS_STORE_NAME,
            to: recordsStoreName,
            lastKey: batch[batch.length - 1]!.key
          },
          LEGACY_RECORDS_MIGRATION_KEY
        );
        await committed;
      } catch (cause) {
        try {
          transaction.abort();
        } catch {
          /* transaction already settled */
        }
        await committed.catch(() => {});
        throw cause;
      }
      lastKey = batch[batch.length - 1]!.key;
    }
  };

  const readFromMetadata = async (
    database: IDBDatabase,
    key: string,
    runtime: IStorageOperationRuntime
  ): Promise<unknown | undefined> => {
    const transaction = createTransaction(database, META_STORE_NAME, 'readonly');
    return fromIdbRequest(transaction.objectStore(META_STORE_NAME).get(key), {}, runtime);
  };

  const writeLegacyMigrationState = async (
    database: IDBDatabase,
    state: unknown,
    runtime: IStorageOperationRuntime
  ): Promise<void> => {
    const transaction = createTransaction(database, META_STORE_NAME, 'readwrite');
    const committed = idbTransactionCommit(transaction, undefined, runtime);
    void committed.catch(() => {});
    try {
      transaction.objectStore(META_STORE_NAME).put(state, LEGACY_RECORDS_MIGRATION_KEY);
      await committed;
    } catch (cause) {
      try {
        transaction.abort();
      } catch {
        /* transaction already settled */
      }
      await committed.catch(() => {});
      throw cause;
    }
  };

  const readLegacyBatch = async (
    database: IDBDatabase,
    lastKey: IDBValidKey | undefined
  ): Promise<Array<{ readonly key: IDBValidKey; readonly value: unknown }>> => {
    if (lastKey !== undefined && !keyRange)
      throw new StorageError(StorageErrorCode.unavailable, {
        backend: StorageBackend.indexedDb,
        operation: StorageOperation.indexedDbLegacyMigration,
        cause: new Error('IDBKeyRange is required to resume legacy migration')
      });
    let transaction: IDBTransaction;
    let request: IDBRequest<IDBCursorWithValue | null>;
    try {
      transaction = createTransaction(database, LEGACY_RECORDS_STORE_NAME, 'readonly');
      const store = transaction.objectStore(LEGACY_RECORDS_STORE_NAME);
      const range =
        lastKey === undefined ? undefined : (keyRange?.lowerBound(lastKey, true) ?? undefined);
      request = store.openCursor(range);
    } catch (cause) {
      throw normalizeError(
        cause,
        StorageBackend.indexedDb,
        StorageErrorCode.transactionFailed,
        'indexeddb.legacy.cursor'
      );
    }
    return new Promise((resolve, reject) => {
      const batch: Array<{ readonly key: IDBValidKey; readonly value: unknown }> = [];
      let cursorFinished = false;
      let settled = false;
      const failure = (cause: unknown): void => {
        if (settled) return;
        settled = true;
        /**
         * Preserve the host failure while assigning this cursor boundary's operation metadata. Only
         * a web `StorageError` bridge wrapper is unwrapped; a contract error stays whole so
         * `normalizeError` lets it penetrate (rule §4.4).
         */
        const rootCause = cause instanceof StorageError ? (cause.cause ?? cause) : cause;
        reject(
          normalizeError(
            rootCause,
            StorageBackend.indexedDb,
            StorageErrorCode.transactionFailed,
            'indexeddb.legacy.cursor'
          )
        );
      };
      try {
        installIdbTransactionHandlers(
          transaction,
          () => {
            if (settled) return;
            if (!cursorFinished) {
              failure(new Error('IndexedDB transaction completed before legacy cursor finished'));
              return;
            }
            settled = true;
            resolve(batch);
          },
          () => failure(readIdbTransactionError(transaction)),
          () => failure(readIdbTransactionError(transaction))
        );
        installIdbRequestHandlers(
          request,
          () => {
            try {
              const cursor = readIdbRequestResult(request);
              if (!cursor || batch.length >= LEGACY_MIGRATION_BATCH_SIZE) {
                cursorFinished = true;
                return;
              }
              batch.push({ key: cursor.key, value: cursor.value });
              cursor.continue();
            } catch (cause) {
              failure(cause);
            }
          },
          () => failure(readIdbRequestError(request))
        );
      } catch (cause) {
        failure(cause);
        try {
          transaction.abort();
        } catch {
          /* setup failure already owns the result */
        }
      }
    });
  };

  /** Delete the legacy store only after a completed copy was recorded in metadata. */
  const cleanupLegacyRecordStore = (
    database: IDBDatabase,
    transaction: IDBTransaction,
    onFailure: (cause: unknown) => void
  ): void => {
    if (!cleanupLegacyRecords || !database.objectStoreNames.contains(LEGACY_RECORDS_STORE_NAME))
      return;
    const metadata = transaction.objectStore(META_STORE_NAME);
    const request = metadata.get(LEGACY_RECORDS_MIGRATION_KEY);
    installIdbRequestHandlers(
      request,
      () => {
        try {
          const state = readIdbRequestResult(request) as
            | { status?: unknown; to?: unknown }
            | undefined;
          if (state?.status === 'complete' && state.to === recordsStoreName)
            database.deleteObjectStore(LEGACY_RECORDS_STORE_NAME);
        } catch (cause) {
          onFailure(cause);
        }
      },
      () => onFailure(readIdbRequestError(request))
    );
  };

  const openOnce = (version?: number): Promise<IDBDatabase> =>
    new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      let request: IDBOpenDBRequest;
      /** Reject this open attempt once while preserving the owning operation metadata. */
      const rejectOpen = (cause: unknown): void => {
        if (settled) return;
        settled = true;
        /**
         * Remove an intermediate web bridge wrapper before assigning open semantics; a contract
         * error is never unwrapped so `normalizeError` lets it penetrate (rule §4.4).
         */
        const rootCause = cause instanceof StorageError ? (cause.cause ?? cause) : cause;
        reject(
          normalizeError(
            rootCause,
            StorageBackend.indexedDb,
            StorageErrorCode.unavailable,
            StorageOperation.indexedDbOpen
          )
        );
      };
      try {
        request = version === undefined ? factory.open(dbName) : factory.open(dbName, version);
      } catch (cause) {
        rejectOpen(cause);
        return;
      }
      /** Abort a failed upgrade when possible, then settle the public open Promise immediately. */
      const failUpgrade = (cause: unknown): void => {
        try {
          readIdbOpenTransaction(request)?.abort();
        } catch {
          /* transaction unavailable or already settled */
        }
        rejectOpen(cause);
      };
      try {
        installIdbOpenRequestHandlers(
          request,
          () => {
            try {
              const transaction = readIdbOpenTransaction(request);
              if (settled) {
                transaction?.abort();
                return;
              }
              const database = readIdbRequestResult(request);
              if (!transaction)
                throw new Error('IndexedDB upgrade event is missing its transaction');
              ensureStores(database);
              cleanupLegacyRecordStore(database, transaction, failUpgrade);
            } catch (cause) {
              failUpgrade(cause);
            }
          },
          () => rejectOpen(new Error('IndexedDB upgrade is blocked by another open connection')),
          () => {
            let database: IDBDatabase;
            try {
              database = readIdbRequestResult(request);
            } catch (cause) {
              rejectOpen(cause);
              return;
            }
            if (settled) {
              tryCloseDatabase(database);
              return;
            }
            settled = true;
            resolve(database);
          },
          () => {
            const cause = readIdbRequestError(request);
            rejectOpen(cause ?? new Error('[storage-web] IndexedDB open failed'));
          }
        );
      } catch (cause) {
        failUpgrade(cause);
      }
    });

  const open = (runtime: IStorageOperationRuntime): Promise<IDBDatabase> =>
    (connection ??= (async () => {
      const recoveryDatabase = activeDatabase;
      if (recoveryDatabase) closeForTransition(recoveryDatabase);
      // 不写死版本号：同一个 dbName 可能已被别处用别的 storeName 建过，
      // 硬开 version 1 不会触发 upgrade，之后 transaction(storeName) 直接
      // 抛 NotFoundError。先按当前版本开，缺 store 再升一版补建。
      let database = await openOnce();
      const attachConnectionHandlers = (connected: IDBDatabase): void => {
        try {
          // 别的标签页要升级时必须让路，否则对方会一直 blocked。
          connected.onversionchange = () => {
            try {
              connected.close();
            } catch {
              /* Host close failures must not retain a stale connection cache. */
            } finally {
              if (activeDatabase === connected) {
                activeDatabase = undefined;
                connection = undefined;
              }
            }
          };
          connected.onclose = () => {
            // A stale close event from an older connection must not evict a newer cache entry.
            if (activeDatabase === connected) {
              activeDatabase = undefined;
              connection = undefined;
            }
          };
          activeDatabase = connected;
        } catch (cause) {
          throw normalizeError(
            cause,
            StorageBackend.indexedDb,
            StorageErrorCode.unavailable,
            StorageOperation.indexedDbOpen
          );
        }
      };
      try {
        if (
          !database.objectStoreNames.contains(kvStoreName) ||
          !database.objectStoreNames.contains(recordsStoreName) ||
          !database.objectStoreNames.contains(bytesStoreName) ||
          !database.objectStoreNames.contains(REVISIONS_STORE_NAME) ||
          !database.objectStoreNames.contains(META_STORE_NAME)
        ) {
          const nextVersion = database.version + 1;
          closeForTransition(database);
          database = await openOnce(nextVersion);
        }
        attachConnectionHandlers(database);
        await ensureMeta(database, runtime);
        await migrateLegacyRecords(database, runtime);
        if (cleanupLegacyRecords && database.objectStoreNames.contains(LEGACY_RECORDS_STORE_NAME)) {
          const nextVersion = database.version + 1;
          closeForTransition(database);
          database = await openOnce(nextVersion);
          attachConnectionHandlers(database);
        }
        return database;
      } catch (cause) {
        const closeCause = tryCloseDatabase(database);
        if (closeCause !== undefined) activeDatabase = database;
        else if (activeDatabase === database) activeDatabase = undefined;
        throw isStorageErrorFamily(cause)
          ? cause
          : normalizeError(
              cause,
              StorageBackend.indexedDb,
              StorageErrorCode.unavailable,
              StorageOperation.indexedDbOpen
            );
      }
    })().catch((error: unknown) => {
      connection = undefined;
      throw error;
    }));

  const createTransaction = (
    database: IDBDatabase,
    stores: string | string[],
    mode: IDBTransactionMode
  ): IDBTransaction => {
    try {
      return database.transaction(stores, mode);
    } catch (cause) {
      throw normalizeError(
        cause,
        StorageBackend.indexedDb,
        StorageErrorCode.transactionFailed,
        StorageOperation.indexedDbTransaction
      );
    }
  };

  /** Persist the schema checkpoint so future upgrades can distinguish initialized v2 stores. */
  const ensureMeta = async (
    database: IDBDatabase,
    runtime: IStorageOperationRuntime
  ): Promise<void> => {
    const readTransaction = createTransaction(database, META_STORE_NAME, 'readonly');
    const current = await fromIdbRequest(
      readTransaction.objectStore(META_STORE_NAME).get(META_SCHEMA_KEY),
      {},
      runtime
    );
    if (current && typeof current === 'object') {
      const schemaVersion = (current as { version?: unknown }).version;
      if (schemaVersion === CURRENT_SCHEMA_VERSION) return;
      if (typeof schemaVersion === 'number' && schemaVersion > CURRENT_SCHEMA_VERSION)
        throw new StorageError(StorageErrorCode.versionUnsupported, {
          backend: StorageBackend.indexedDb,
          operation: StorageOperation.indexedDbSchema,
          cause: new Error(
            `IndexedDB schema version ${schemaVersion} is newer than ${CURRENT_SCHEMA_VERSION}`
          )
        });
    }
    const writeTransaction = createTransaction(database, META_STORE_NAME, 'readwrite');
    const committed = idbTransactionCommit(writeTransaction, undefined, runtime);
    void committed.catch(() => {});
    try {
      writeTransaction.objectStore(META_STORE_NAME).put(
        {
          version: CURRENT_SCHEMA_VERSION,
          keySpace: 'repository-v2',
          migration: 'checkpointed'
        },
        META_SCHEMA_KEY
      );
      await committed;
    } catch (cause) {
      try {
        writeTransaction.abort();
      } catch {
        /* transaction already settled */
      }
      await committed.catch(() => {});
      throw cause;
    }
  };

  const readFrom = async <T>(
    storeName: string,
    run: (store: IDBObjectStore) => IDBRequest<T>,
    signal: AbortSignal | undefined,
    runtime: IStorageOperationRuntime
  ): Promise<T> => {
    const database = await open(runtime);
    assertLive();
    const transaction = createTransaction(database, storeName, 'readonly');
    const committed = idbTransactionCommit(transaction, { signal }, runtime);
    void committed.catch(() => {});
    try {
      const request = fromIdbRequest(run(transaction.objectStore(storeName)), { signal }, runtime);
      const [value] = await Promise.all([request, committed]);
      return value;
    } catch (cause) {
      try {
        transaction.abort();
      } catch {
        /* transaction already settled */
      }
      await committed.catch(() => {});
      const signalFailure = indexedDbSignalFailure(signal);
      if (signalFailure) throw signalFailure;
      if (isStorageErrorFamily(cause)) throw cause;
      throw normalizeError(
        cause,
        StorageBackend.indexedDb,
        StorageErrorCode.transactionFailed,
        StorageOperation.indexedDbRead
      );
    }
  };

  /** 写入等事务 commit，而不是等单条请求 success。 */
  const writeTo = async (
    storeName: string,
    run: (store: IDBObjectStore) => unknown,
    signal: AbortSignal | undefined,
    runtime: IStorageOperationRuntime
  ): Promise<void> => {
    const database = await open(runtime);
    assertLive();
    const transaction = createTransaction(database, storeName, 'readwrite');
    const committed = idbTransactionCommit(transaction, { signal }, runtime);
    void committed.catch(() => {});
    if (indexedDbSignalFailure(signal)) {
      await committed;
      return;
    }
    try {
      run(transaction.objectStore(storeName));
    } catch (cause) {
      try {
        transaction.abort();
      } catch {
        /* already settled */
      }
      throw new StorageError(StorageErrorCode.transactionFailed, {
        backend: StorageBackend.indexedDb,
        cause
      });
    }
    await committed;
  };

  const writeWithConflict = async (
    channel: 'value' | 'bytes' | 'record',
    key: IStorageKey,
    value: unknown,
    signal: AbortSignal | undefined,
    policy: (typeof StorageConflictPolicy)[keyof typeof StorageConflictPolicy] = StorageConflictPolicy.conflict,
    runtime: IStorageOperationRuntime
  ): Promise<void> => {
    const valueSnapshot = channel === StorageChannel.value ? value : snapshotWriteValue(value, key);
    const database = await open(runtime);
    assertLive();
    const transaction = createTransaction(
      database,
      [kvStoreName, bytesStoreName, recordsStoreName, REVISIONS_STORE_NAME],
      'readwrite'
    );
    const committed = idbTransactionCommit(transaction, { signal }, runtime);
    void committed.catch(() => {});
    try {
      const stringKey = typeof key === 'string' ? key : undefined;
      const kvRequest =
        stringKey === undefined ? undefined : transaction.objectStore(kvStoreName).get(stringKey);
      const bytesRequest =
        stringKey === undefined
          ? undefined
          : transaction.objectStore(bytesStoreName).get(stringKey);
      const recordRequest = transaction.objectStore(recordsStoreName).getKey(toIdbKey(key));
      const [kvExisting, bytesExisting, recordExisting] = await Promise.all([
        kvRequest ? fromIdbRequest(kvRequest, { signal }, runtime) : Promise.resolve(undefined),
        bytesRequest
          ? fromIdbRequest(bytesRequest, { signal }, runtime)
          : Promise.resolve(undefined),
        fromIdbRequest(recordRequest, { signal }, runtime)
      ]);
      const existing = new Set<'value' | 'bytes' | 'record'>();
      if (kvExisting !== undefined) existing.add('value');
      if (bytesExisting !== undefined) existing.add('bytes');
      if (recordExisting !== undefined) existing.add('record');
      const plan = planChannelWrite(key, channel, existing, policy, StorageBackend.indexedDb);
      for (const removal of plan.remove) {
        if (removal === StorageChannel.value && stringKey !== undefined)
          transaction.objectStore(kvStoreName).delete(stringKey);
        if (removal === StorageChannel.bytes && stringKey !== undefined)
          transaction.objectStore(bytesStoreName).delete(stringKey);
        if (removal === 'record') transaction.objectStore(recordsStoreName).delete(toIdbKey(key));
      }
      const target =
        channel === StorageChannel.value
          ? kvStoreName
          : channel === StorageChannel.bytes
            ? bytesStoreName
            : recordsStoreName;
      const targetKey = channel === 'record' ? toIdbKey(key) : (key as string);
      transaction.objectStore(target).put(valueSnapshot, targetKey);
      if (channel === 'record') {
        const revisionStore = transaction.objectStore(REVISIONS_STORE_NAME);
        const revision = await fromIdbRequest(
          revisionStore.get(recordRevisionKey(key)) as IDBRequest<number | undefined>,
          { signal },
          runtime
        );
        revisionStore.put((revision ?? 0) + 1, recordRevisionKey(key));
      }
      if (plan.remove.includes('record') && channel !== 'record') {
        const revisionStore = transaction.objectStore(REVISIONS_STORE_NAME);
        const encoded = recordRevisionKey(key);
        const revision = await fromIdbRequest(
          revisionStore.get(encoded) as IDBRequest<number | undefined>,
          { signal },
          runtime
        );
        revisionStore.put((revision ?? 0) + 1, encoded);
      }
      await committed;
    } catch (cause) {
      try {
        transaction.abort();
      } catch {
        /* transaction already settled */
      }
      await committed.catch(() => {});
      throw cause;
    }
  };

  const runTransaction = async <T>(
    run: (tx: ITransactionScope<TValue>) => Promise<T>,
    signal: AbortSignal | undefined,
    runtime: IStorageOperationRuntime
  ): Promise<T> => {
    const database = await open(runtime);
    /** Scope remains usable only while the transaction callback is pending. */
    let scopeActive = true;
    const tombstone = Symbol('indexeddb-transaction-tombstone');
    const draft = new Map<
      string,
      [IStorageKey, TValue, 'conflict' | 'replace'] | [IStorageKey, typeof tombstone]
    >();
    const readRevisions = new Map<
      string,
      { readonly key: IStorageKey; readonly revision: number }
    >();
    const readSnapshots = new Map<string, TValue | undefined>();
    let snapshotEpoch: number | undefined;
    const readRevision = async (key: IStorageKey): Promise<void> => {
      const encoded = encodeFlatStorageKey(key);
      if (readRevisions.has(encoded)) return;
      const revisionTx = createTransaction(
        database,
        [REVISIONS_STORE_NAME, recordsStoreName],
        'readonly'
      );
      const epoch = await fromIdbRequest(
        revisionTx.objectStore(REVISIONS_STORE_NAME).get(RECORD_EPOCH_KEY) as IDBRequest<
          number | undefined
        >,
        { signal },
        runtime
      );
      const revision = await fromIdbRequest(
        revisionTx.objectStore(REVISIONS_STORE_NAME).get(recordRevisionKey(key)) as IDBRequest<
          number | undefined
        >,
        { signal },
        runtime
      );
      const value = await fromIdbRequest(
        revisionTx.objectStore(recordsStoreName).get(toIdbKey(key)) as IDBRequest<
          TValue | undefined
        >,
        { signal },
        runtime
      );
      if (snapshotEpoch === undefined) {
        snapshotEpoch = epoch ?? 0;
      }
      readRevisions.set(encoded, { key, revision: revision ?? 0 });
      readSnapshots.set(encoded, value === undefined ? undefined : structuredClone(value));
    };
    const scope: ITransactionScope<TValue> = {
      get: async (key) => {
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb);
        const keySnapshot = snapshotStorageKey(key, StorageBackend.indexedDb);
        await readRevision(keySnapshot);
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb);
        const entry = draft.get(encodeFlatStorageKey(keySnapshot));
        if (entry !== undefined && entry.length === 2 && entry[1] === tombstone) return undefined;
        if (entry !== undefined) return structuredClone(entry[1] as TValue);
        const snapshot = readSnapshots.get(encodeFlatStorageKey(keySnapshot));
        return snapshot === undefined ? undefined : structuredClone(snapshot);
      },
      put: async (value, key, options) => {
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb);
        const conflictPolicy = readTransactionConflictPolicy(options, StorageBackend.indexedDb);
        const resolvedKey = key ?? autoKey();
        const keySnapshot = snapshotStorageKey(resolvedKey, StorageBackend.indexedDb);
        const valueSnapshot = snapshotWriteValue(value, keySnapshot);
        await readRevision(keySnapshot);
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb);
        draft.set(encodeFlatStorageKey(keySnapshot), [keySnapshot, valueSnapshot, conflictPolicy]);
        return resolvedKey;
      },
      delete: async (key) => {
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb);
        const keySnapshot = snapshotStorageKey(key, StorageBackend.indexedDb);
        await readRevision(keySnapshot);
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb);
        draft.set(encodeFlatStorageKey(keySnapshot), [keySnapshot, tombstone]);
      }
    };
    let result: T;
    try {
      result = await run(scope);
    } catch (error) {
      if (isStorageErrorFamily(error)) throw error;
      throw new StorageError(StorageErrorCode.transactionFailed, {
        backend: StorageBackend.indexedDb,
        cause: error
      });
    } finally {
      scopeActive = false;
    }
    throwIfAborted(signal);
    assertLive();
    throwIfAborted(signal);
    const idbTx = createTransaction(
      database,
      [kvStoreName, bytesStoreName, recordsStoreName, REVISIONS_STORE_NAME],
      'readwrite'
    );
    const committed = idbTransactionCommit(idbTx, { signal }, runtime);
    void committed.catch(() => {});
    const revisionStore = idbTx.objectStore(REVISIONS_STORE_NAME);
    const currentEpoch =
      (await fromIdbRequest(
        revisionStore.get(RECORD_EPOCH_KEY) as IDBRequest<number | undefined>,
        {
          signal
        },
        runtime
      )) ?? 0;
    if (snapshotEpoch !== undefined && currentEpoch !== snapshotEpoch) {
      idbTx.abort();
      await committed.catch(() => {});
      throw new StorageError(StorageErrorCode.transactionConflict, {
        backend: StorageBackend.indexedDb,
        operation: StorageOperation.transactionCommit,
        cause: new Error('record epoch changed')
      });
    }
    for (const { key, revision: expected } of readRevisions.values()) {
      const actual =
        (await fromIdbRequest(
          revisionStore.get(recordRevisionKey(key)) as IDBRequest<number | undefined>,
          {
            signal
          },
          runtime
        )) ?? 0;
      if (actual !== expected) {
        idbTx.abort();
        await committed.catch(() => {});
        throw new StorageError(StorageErrorCode.transactionConflict, {
          backend: StorageBackend.indexedDb,
          operation: StorageOperation.transactionCommit,
          cause: new Error(`record revision changed from ${expected} to ${actual}`)
        });
      }
    }
    for (const entry of draft.values()) {
      if (entry.length === 2 && entry[1] === tombstone) {
        const key = entry[0] as IStorageKey;
        idbTx.objectStore(recordsStoreName).delete(toIdbKey(key));
        const current =
          (await fromIdbRequest(
            revisionStore.get(recordRevisionKey(key)) as IDBRequest<number | undefined>,
            {
              signal
            },
            runtime
          )) ?? 0;
        revisionStore.put(current + 1, recordRevisionKey(key));
        continue;
      }
      const [key, value, policy] = entry;
      const stringKey = typeof key === 'string' ? key : undefined;
      const kvExisting = stringKey
        ? await fromIdbRequest(idbTx.objectStore(kvStoreName).get(stringKey), { signal }, runtime)
        : undefined;
      const bytesExisting = stringKey
        ? await fromIdbRequest(
            idbTx.objectStore(bytesStoreName).get(stringKey),
            { signal },
            runtime
          )
        : undefined;
      const conflict =
        (kvExisting !== undefined && 'value') || (bytesExisting !== undefined && 'bytes');
      if (conflict && policy !== 'replace') {
        idbTx.abort();
        await committed.catch(() => {});
        throw new StorageError(StorageErrorCode.duplicateKey, {
          backend: StorageBackend.indexedDb,
          key,
          existingChannel: conflict,
          attemptedChannel: 'record'
        });
      }
      if (policy === 'replace' && stringKey !== undefined) {
        idbTx.objectStore(kvStoreName).delete(stringKey);
        idbTx.objectStore(bytesStoreName).delete(stringKey);
      }
      idbTx.objectStore(recordsStoreName).put(value, toIdbKey(key));
      const current =
        (await fromIdbRequest(
          revisionStore.get(recordRevisionKey(key)) as IDBRequest<number | undefined>,
          {
            signal
          },
          runtime
        )) ?? 0;
      revisionStore.put(current + 1, recordRevisionKey(key));
    }
    await committed;
    return result;
  };

  return {
    backend: StorageBackend.indexedDb,
    capabilities: CAPABILITIES,
    // sync 未定义：IndexedDB 无同步 API。

    dispose: async () => {
      disposed = true;
      const pending = connection;
      const recoveryDatabase = activeDatabase;
      connection = undefined;
      activeDatabase = undefined;
      let pendingDatabase: IDBDatabase | undefined;
      if (pending) {
        try {
          pendingDatabase = await pending;
          tryCloseDatabase(pendingDatabase);
        } catch {
          // 失败/正在打开的连接已不可用，dispose 是尽力而为。
        }
      }
      if (recoveryDatabase && recoveryDatabase !== pendingDatabase)
        tryCloseDatabase(recoveryDatabase);
    },

    get: (key, ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive();
        assertStringStorageKey(key, StorageBackend.indexedDb);
        const value = await readFrom(
          kvStoreName,
          (store) => store.get(key) as IDBRequest<unknown>,
          signal,
          runtime
        );
        return typeof value === 'string' ? value : null;
      }),
    set: (key, value, ctx) =>
      withAbort(ctx, async (signal, context, runtime) => {
        assertLive();
        assertStringStorageKey(key, StorageBackend.indexedDb);
        if (typeof value !== 'string')
          throw new StorageError(StorageErrorCode.invalidConfig, {
            backend: StorageBackend.indexedDb,
            key,
            cause: new TypeError('storage value must be a string')
          });
        await writeWithConflict('value', key, value, signal, context?.conflictPolicy, runtime);
      }),
    remove: (key, ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive();
        assertStringStorageKey(key, StorageBackend.indexedDb);
        await writeTo(kvStoreName, (store) => store.delete(key), signal, runtime);
      }),
    has: (key, ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive();
        assertStringStorageKey(key, StorageBackend.indexedDb);
        const value = await readFrom(
          kvStoreName,
          (store) => store.get(key) as IDBRequest<unknown>,
          signal,
          runtime
        );
        return value !== undefined;
      }),
    keys: (ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive();
        const raw = await readFrom(kvStoreName, (store) => store.getAllKeys(), signal, runtime);
        return raw.map((key) => {
          assertStringStorageKey(key, StorageBackend.indexedDb, 'persisted value key');
          return key;
        });
      }),
    clearValues: (ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive();
        await writeTo(kvStoreName, (store) => store.clear(), signal, runtime);
      }),
    clearAll: (ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive();
        const database = await open(runtime);
        assertLive();
        throwIfAborted(signal);
        const transaction = createTransaction(
          database,
          [kvStoreName, bytesStoreName, recordsStoreName, REVISIONS_STORE_NAME],
          'readwrite'
        );
        const committed = idbTransactionCommit(transaction, { signal }, runtime);
        void committed.catch(() => {});
        try {
          const revisionStore = transaction.objectStore(REVISIONS_STORE_NAME);
          await new Promise<void>((resolve, reject) => {
            const request = revisionStore.get(RECORD_EPOCH_KEY) as IDBRequest<number | undefined>;
            installIdbRequestHandlers(
              request,
              () => {
                try {
                  const revision = readIdbRequestResult(request);
                  transaction.objectStore(kvStoreName).clear();
                  transaction.objectStore(bytesStoreName).clear();
                  transaction.objectStore(recordsStoreName).clear();
                  revisionStore.put((revision ?? 0) + 1, RECORD_EPOCH_KEY);
                  resolve();
                } catch (cause) {
                  reject(normalizeIdbRequestFailure(cause));
                }
              },
              () =>
                reject(
                  indexedDbSignalFailure(signal) ??
                    normalizeIdbRequestFailure(readIdbRequestError(request))
                )
            );
          });
          await committed;
        } catch (cause) {
          try {
            transaction.abort();
          } catch {
            /* transaction already settled */
          }
          await committed.catch(() => {});
          throw cause;
        }
      }),
    metadata: {
      get: (key, ctx) =>
        withAbort(ctx, async (signal, _context, runtime) => {
          assertLive();
          assertStringStorageKey(key, StorageBackend.indexedDb, 'metadata key');
          return readFrom(META_STORE_NAME, (store) => store.get(key), signal, runtime);
        }),
      set: (key, value, ctx) =>
        withAbort(ctx, async (signal, _context, runtime) => {
          assertLive();
          assertStringStorageKey(key, StorageBackend.indexedDb, 'metadata key');
          await writeTo(META_STORE_NAME, (store) => store.put(value, key), signal, runtime);
        }),
      delete: (key, ctx) =>
        withAbort(ctx, async (signal, _context, runtime) => {
          assertLive();
          assertStringStorageKey(key, StorageBackend.indexedDb, 'metadata key');
          await writeTo(META_STORE_NAME, (store) => store.delete(key), signal, runtime);
        })
    },

    getBytes: (key, ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive();
        assertStringStorageKey(key, StorageBackend.indexedDb);
        const value = await readFrom(
          bytesStoreName,
          (store) => store.get(key) as IDBRequest<unknown>,
          signal,
          runtime
        );
        if (isByteView(value))
          return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        // IndexedDB 可能把它还原成 ArrayBuffer，取决于实现。
        if (isRawArrayBuffer(value)) return new Uint8Array(value);
        return null;
      }),
    setBytes: (key, value, ctx) =>
      withAbort(ctx, async (signal, context, runtime) => {
        assertLive();
        assertStringStorageKey(key, StorageBackend.indexedDb);
        if (!isUint8Array(value))
          throw new StorageError(StorageErrorCode.invalidConfig, {
            backend: StorageBackend.indexedDb,
            key,
            cause: new TypeError('bytes value must be a Uint8Array')
          });
        await writeWithConflict('bytes', key, value, signal, context?.conflictPolicy, runtime);
      }),
    clearBytes: (ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive();
        await writeTo(bytesStoreName, (store) => store.clear(), signal, runtime);
      }),

    getRecord: (key, ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive();
        const keySnapshot = snapshotStorageKey(key, StorageBackend.indexedDb);
        return readFrom(
          recordsStoreName,
          (store) => store.get(toIdbKey(keySnapshot)) as IDBRequest<TValue | undefined>,
          signal,
          runtime
        );
      }),
    putRecord: (value, key, ctx) =>
      withAbort(ctx, async (signal, context, runtime) => {
        assertLive();
        const resolvedKey = key ?? autoKey();
        const keySnapshot = snapshotStorageKey(resolvedKey, StorageBackend.indexedDb);
        await writeWithConflict(
          'record',
          keySnapshot,
          value,
          signal,
          context?.conflictPolicy,
          runtime
        );
        return resolvedKey;
      }),
    deleteRecord: (key, ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive();
        const keySnapshot = snapshotStorageKey(key, StorageBackend.indexedDb);
        const database = await open(runtime);
        throwIfAborted(signal);
        const transaction = createTransaction(
          database,
          [recordsStoreName, REVISIONS_STORE_NAME],
          'readwrite'
        );
        const committed = idbTransactionCommit(transaction, { signal }, runtime);
        void committed.catch(() => {});
        try {
          const revisionStore = transaction.objectStore(REVISIONS_STORE_NAME);
          await new Promise<void>((resolve, reject) => {
            const request = revisionStore.get(recordRevisionKey(keySnapshot)) as IDBRequest<
              number | undefined
            >;
            installIdbRequestHandlers(
              request,
              () => {
                try {
                  const revision = readIdbRequestResult(request);
                  transaction.objectStore(recordsStoreName).delete(toIdbKey(keySnapshot));
                  revisionStore.put((revision ?? 0) + 1, recordRevisionKey(keySnapshot));
                  resolve();
                } catch (cause) {
                  reject(normalizeIdbRequestFailure(cause));
                }
              },
              () =>
                reject(
                  indexedDbSignalFailure(signal) ??
                    normalizeIdbRequestFailure(readIdbRequestError(request))
                )
            );
          });
          await committed;
        } catch (cause) {
          try {
            transaction.abort();
          } catch {
            /* transaction already settled */
          }
          await committed.catch(() => {});
          throw cause;
        }
      }),
    clearRecords: (ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive();
        const database = await open(runtime);
        throwIfAborted(signal);
        const transaction = createTransaction(
          database,
          [recordsStoreName, REVISIONS_STORE_NAME],
          'readwrite'
        );
        const committed = idbTransactionCommit(transaction, { signal }, runtime);
        void committed.catch(() => {});
        try {
          const revisionStore = transaction.objectStore(REVISIONS_STORE_NAME);
          await new Promise<void>((resolve, reject) => {
            const request = revisionStore.get(RECORD_EPOCH_KEY) as IDBRequest<number | undefined>;
            installIdbRequestHandlers(
              request,
              () => {
                try {
                  const revision = readIdbRequestResult(request);
                  transaction.objectStore(recordsStoreName).clear();
                  revisionStore.put((revision ?? 0) + 1, RECORD_EPOCH_KEY);
                  resolve();
                } catch (cause) {
                  reject(normalizeIdbRequestFailure(cause));
                }
              },
              () =>
                reject(
                  indexedDbSignalFailure(signal) ??
                    normalizeIdbRequestFailure(readIdbRequestError(request))
                )
            );
          });
          await committed;
        } catch (cause) {
          try {
            transaction.abort();
          } catch {
            /* transaction already settled */
          }
          await committed.catch(() => {});
          throw cause;
        }
      }),
    iterateRecords: async function* (range, ctx) {
      const rangeSnapshot = snapshotKeyRange(range, StorageBackend.indexedDb);
      assertLive();
      /** One reporter shared by every abort subscription inside this iteration operation. */
      const runtime = createStorageOperationRuntime();
      const { signal, dispose: disposeSignal, context } = mergeSignals(ctx, runtime.reporter);
      const pageSize = context?.pageSize ?? 128;
      let lower = rangeSnapshot?.lower;
      let lowerOpen = rangeSnapshot?.lowerOpen;
      try {
        while (true) {
          throwIfAborted(signal);
          const pageRange =
            lower === undefined && rangeSnapshot?.upper === undefined
              ? undefined
              : {
                  lower,
                  lowerOpen,
                  upper: rangeSnapshot?.upper,
                  upperOpen: rangeSnapshot?.upperOpen
                };
          const database = await open(runtime);
          assertLive();
          const transaction = createTransaction(database, recordsStoreName, 'readonly');
          const store = transaction.objectStore(recordsStoreName);
          const idbRange = toIdbRange(pageRange, keyRange);
          const request = idbRange ? store.openCursor(idbRange) : store.openCursor();
          const page = await new Promise<Array<[IStorageKey, TValue]>>((resolve, reject) => {
            const values: Array<[IStorageKey, TValue]> = [];
            let cursorFinished = false;
            let settled = false;
            let cancelled = false;
            let abortReason: unknown;
            /** Owns the cursor abort subscription and is safe before registration completes. */
            let disposeAbort = (): void => {};
            const finish = (callback: () => void): void => {
              if (settled) return;
              settled = true;
              disposeAbort();
              callback();
            };
            /**
             * Normalize every non-cancellation cursor failure at its owning operation boundary. A
             * contract error penetrates whole (rule §4.4); only a web `StorageError` bridge wrapper
             * is unwrapped before the cursor boundary assigns its own metadata.
             */
            const cursorFailure = (cause: unknown): StorageError | StorageContractError =>
              isStorageContractError(cause)
                ? cause
                : new StorageError(StorageErrorCode.transactionFailed, {
                    backend: StorageBackend.indexedDb,
                    operation: StorageOperation.indexedDbCursor,
                    cause: cause instanceof StorageError ? (cause.cause ?? cause) : cause
                  });
            const abort = (): void => {
              cancelled = true;
              abortReason = readAbortReason(signal);
              finish(() =>
                reject(
                  new StorageContractError(StorageContractErrorCode.aborted, { cause: abortReason })
                )
              );
            };
            try {
              installIdbTransactionHandlers(
                transaction,
                () => {
                  finish(() => {
                    if (cancelled) {
                      reject(
                        new StorageContractError(StorageContractErrorCode.aborted, {
                          cause: abortReason
                        })
                      );
                      return;
                    }
                    if (!cursorFinished) {
                      reject(
                        cursorFailure(
                          new Error('IndexedDB transaction completed before cursor finished')
                        )
                      );
                      return;
                    }
                    resolve(values);
                  });
                },
                () => finish(() => reject(cursorFailure(readIdbTransactionError(transaction)))),
                () => finish(() => reject(cursorFailure(readIdbTransactionError(transaction))))
              );
              installIdbRequestHandlers(
                request,
                () => {
                  try {
                    const cursor = readIdbRequestResult(request);
                    if (!cursor || values.length >= pageSize) {
                      cursorFinished = true;
                      finish(() => resolve(values));
                      return;
                    }
                    values.push([cursor.key as IStorageKey, cursor.value as TValue]);
                    if (values.length < pageSize) cursor.continue();
                    else cursorFinished = true;
                  } catch (cause) {
                    finish(() => reject(cursorFailure(cause)));
                  }
                },
                () => finish(() => reject(cursorFailure(readIdbRequestError(request))))
              );
              disposeAbort = subscribeToAbort(signal, abort, runtime.reporter);
            } catch (cause) {
              finish(() =>
                reject(
                  isStorageContractError(cause) ||
                    (cause instanceof StorageError && cause.code === StorageErrorCode.invalidConfig)
                    ? cause
                    : cursorFailure(cause)
                )
              );
              try {
                transaction.abort();
              } catch {
                /* setup failure already owns the result */
              }
            }
          });
          if (page.length === 0) return;
          for (const entry of page) {
            throwIfAborted(signal);
            yield entry;
          }
          if (page.length < pageSize) return;
          lower = page[page.length - 1]![0];
          lowerOpen = true;
        }
      } finally {
        disposeSignal();
      }
    },
    transaction: (run, ctx) => {
      assertLive();
      return withAbort(ctx, (signal, _context, runtime) => {
        assertTransactionCallback(run, StorageBackend.indexedDb);
        return runTransaction(run, signal, runtime);
      });
    }
  };
};

import {
  StorageContractError,
  StorageContractErrorCode,
  isStorageContractError,
  type IChangeFeedStore,
  type IStorageChange
} from '@migaia/storage-contract'
import { isStorageErrorFamily } from '../core/error-family.js'
import {
  createStorageOperationReporter,
  createStorageOperationRuntime,
  reportCleanupError,
  type IStorageOperationRuntime
} from '../core/operation-reporter.js'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { indexUniqueConflictText, StorageErrorText } from '../error-text.js'
import {
  StorageBackend,
  StorageChannel,
  StorageConflictPolicy,
  StorageMigrationStatus,
  StorageOperation
} from '../constants.js'
import {
  mergeSignals,
  readAbortReason,
  snapshotOperationContext,
  subscribeToAbort,
  throwIfAborted,
  withAbort
} from '../core/operation.js'
import {
  assertStringStorageKey,
  compareStorageKeys,
  encodeFlatStorageKey,
  snapshotStorageKey,
  snapshotKeyRange
} from '../core/key-domain.js'
import { planChannelWrite } from '../core/channel-write.js'
/**
 * SWV2-D27's raw-record firewall must distinguish a "canonical entity key" from an
 * unclassifiable/legacy one by physical key shape. `REPOSITORY_KEY_PREFIX` is the one constant that
 * shape depends on; it is a leaf-level string with no dependency back onto this backend module, so
 * importing it here does not create a cycle with `entity/repository.ts` (which does depend on this
 * file).
 */
import { REPOSITORY_KEY_PREFIX, repositoryMigrationKey } from '../entity/key.js'
import { isArrayBuffer, isUint8Array } from '../core/bytes.js'
import { normalizeError } from '../core/errors.js'
import { isStorageKeyInRange } from '../core/query.js'
import { UtilsAbortError, withTimeout } from '@migaia/utils/promise'
import { UtilsErrorCode } from '@migaia/utils/error'
import { utf8ByteLength } from '@migaia/utils/bytes'
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
} from '../utils/idb-request.js'
import type { IKeyRange, IOperationContext, IStorageKey, IWriteOptions } from '../types/context.js'
import type { IRecordStore } from '../types/storage.js'
import type {
  IRecordIndexDefinition,
  IRecordIndexHandle,
  IRecordIndexProjection,
  IRecordIndexReadiness,
  IRecordIndexQuery,
  ISecondaryIndexTransactionScope,
  ISecondaryIndexRecordStore
} from '@migaia/storage-contract'
import {
  assertTransactionCallback,
  assertTransactionScopeActive,
  readTransactionConflictPolicy,
  type ITransactionScope
} from '../core/transaction.js'
import type { IStorageCapabilities } from '../types/capabilities.js'
import {
  createBackfillContentionFailure,
  IndexedDbBackfillPhase,
  registerIndexedDbBackfillStore,
  type IIndexedDbBackfillBatch,
  type IIndexedDbBackfillCandidate,
  type IIndexedDbBackfillPhase,
  type IIndexedDbBackfillPreparation,
  type IIndexedDbBackfillReadOptions,
  type IIndexedDbBackfillRetryReceipt,
  type IIndexedDbBackfillSession
} from './indexed-db-backfill.js'
import { acquireIndexedDbCoordination } from './indexed-db-coordination.js'
import { safeJsonPayloadByteLength } from '../utils/json.js'
import { createStorageToken } from '../utils/storage-token.js'
import {
  createBackendReactiveController,
  registerBackendReactiveController
} from './reactive-controller.js'

const CAPABILITIES: IStorageCapabilities = Object.freeze({
  syncRead: false,
  binary: true,
  records: true,
  transactions: true,
  iteration: true,
  // R07 closes the full planner/readiness/native-query/unique inventory. The immutable
  // capability is now honest: complete handles use the sidecar route, while pending/failed
  // handles still remain on the authoritative fallback path.
  secondaryIndexes: true,
  // The base remains fail-closed; each factory instance derives an immutable `changeFeed` value
  // only after realm-default factory and BroadcastChannel admission succeeds below.
  changeFeed: false,
  maxValueBytes: undefined,
  opaqueEntries: false
})

/** Convert current cancellation state into an IndexedDB-owned error without throwing from events. */
const indexedDbSignalFailure = (
  signal: AbortSignal | undefined
): StorageError | StorageContractError | undefined => {
  try {
    throwIfAborted(signal)
    return undefined
  } catch (cause) {
    if (cause instanceof StorageError)
      return new StorageError(cause.code, {
        backend: StorageBackend.indexedDb,
        cause: cause.cause ?? cause
      })
    if (isStorageContractError(cause)) return cause
    return new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause
    })
  }
}

export type IIndexedDbOptions = {
  readonly dbName?: string
  readonly kvStoreName?: string
  readonly bytesStoreName?: string
  readonly recordsStoreName?: string
  /** Explicit release-time opt-in to delete the legacy `documents` object store after migration. */
  readonly cleanupLegacyRecords?: boolean
  /** 注入点：测试环境（jsdom 没有 IndexedDB）与非浏览器环境用。 */
  readonly factory?: IDBFactory
  /**
   * 注入点：`IDBKeyRange` 构造器。jsdom 完全不提供 IndexedDB，测试环境下 必须和 `factory` 一起从 fake-indexeddb
   * 显式传入；真实浏览器默认取 `globalThis.IDBKeyRange`。
   */
  readonly keyRange?: typeof IDBKeyRange
}

const REVISIONS_STORE_NAME = '__storage_web_revisions__'
const META_STORE_NAME = 'storage-web:meta'
/** Private metadata namespace; public string metadata keys must never authorize backend state. */
const INTERNAL_META_NAMESPACE = '__storage_web_internal__'
const META_SCHEMA_KEY: IDBValidKey = [INTERNAL_META_NAMESPACE, 'schema']
/** Historical mirror retained for non-authoritative inspection of existing databases. */
const LEGACY_META_SCHEMA_KEY = 'schema'
const CURRENT_SCHEMA_VERSION = 3
const LEGACY_RECORDS_STORE_NAME = 'documents'
const INDEX_RECORDS_STORE_NAME = 'storage-web:index-records'
/** Build the immutable physical-layout identity shared by same-page and wire coordination. */
const indexedDbLayoutFingerprint = (
  kvStoreName: string,
  bytesStoreName: string,
  recordsStoreName: string
): string =>
  JSON.stringify({
    schema: CURRENT_SCHEMA_VERSION,
    stores: [
      kvStoreName,
      bytesStoreName,
      recordsStoreName,
      REVISIONS_STORE_NAME,
      META_STORE_NAME,
      INDEX_RECORDS_STORE_NAME
    ],
    sidecar: {
      keyPath: ['scope', 'indexName', 'generation', 'indexValue', 'recordKey'],
      indexes: {
        lookup: ['scope', 'indexName', 'generation', 'indexValue'],
        record: ['scope', 'generation', 'recordKey']
      }
    }
  })
const LEGACY_RECORDS_MIGRATION_KEY: IDBValidKey = [
  INTERNAL_META_NAMESPACE,
  'migration:records-v1-to-v2'
]
/** Historical epoch key is not authority and remains stable for existing revision diagnostics. */
const RECORD_EPOCH_KEY = '__storage_web_record_epoch__'
/** Historical migration mirror is never read to authorize a current migration. */
const LEGACY_RECORDS_MIGRATION_MIRROR_KEY = 'migration:records-v1-to-v2'
const LEGACY_MIGRATION_BATCH_SIZE = 128
/** Bounds `iterateRecordIndex` candidates per short readonly page transaction (SWV2-D26). */
const INDEX_QUERY_PAGE_SIZE = 64
/** Soft decoded-value cap for one backfill page. */
const INDEX_BACKFILL_SOFT_CAP_BYTES = 1024 * 1024
/** Hard row cap for one backfill commit, before any sidecar write. */
const INDEX_BACKFILL_PROJECTION_ROW_CAP = 4096
/** Hard canonical encoded-key byte cap for one backfill commit. */
const INDEX_BACKFILL_PROJECTION_BYTE_CAP = 2 * 1024 * 1024
/** Hard row cap for one prepared record, matching the entity projection contract. */
const INDEX_BACKFILL_RECORD_ROW_CAP = 1024
/** Fixed private backfill batch lower bound required by SWV2-D25/T40. */
const INDEX_BACKFILL_MIN_BATCH_SIZE = 1
/** Fixed private backfill batch upper bound required by SWV2-D25/T40. */
const INDEX_BACKFILL_MAX_BATCH_SIZE = 512
/** Fixed private lease lower bound in milliseconds required by SWV2-D25/T40. */
const INDEX_BACKFILL_MIN_LEASE_MS = 5_000
/** Fixed private lease upper bound in milliseconds required by SWV2-D25/T40. */
const INDEX_BACKFILL_MAX_LEASE_MS = 120_000
/** Default lease duration in milliseconds. */
const INDEX_BACKFILL_DEFAULT_LEASE_MS = 30_000
/** Default bound for user transaction callbacks that do not honor cancellation. */
const TRANSACTION_CALLBACK_DEADLINE_MS = 5_000

/** Persisted owner authority; duration is captured at acquisition and never wall-clock derived. */
type IBackfillLease = {
  readonly ownerToken: string
  readonly heartbeatRevision: number
  readonly leaseMs: number
}

/** Provides a clamped monotonic sample; missing performance APIs fail closed by never advancing. */
const createMonotonicClock = (): (() => number) => {
  let last = 0
  return () => {
    const sample =
      typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : last
    if (Number.isFinite(sample) && sample > last) last = sample
    return last
  }
}
const INTERNAL_STORE_NAMES = new Set([
  REVISIONS_STORE_NAME,
  META_STORE_NAME,
  INDEX_RECORDS_STORE_NAME
])

/** 判断 IndexedDB 数据库/对象仓库名称是否满足构造期契约。 */
const isValidStoreName = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

/** Bounds private generation tokens so the native prefix-successor proof cannot depend on user data. */
const INDEX_GENERATION_MAX_LENGTH = 128

/** Accept only the bounded NUL-free grammar used by backend-owned index generations. */
const isValidIndexGeneration = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= INDEX_GENERATION_MAX_LENGTH &&
  /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value)

/** Create one independent backend-owned generation token for a new or rotated index. */
const createIndexGeneration = (): string => {
  const generation = createStorageToken()
  if (!isValidIndexGeneration(generation))
    throw new StorageError(StorageErrorCode.invalidConfig, { backend: StorageBackend.indexedDb })
  return generation
}

const toIdbKey = (key: IStorageKey): IDBValidKey => key as IDBValidKey

type IBackfillProjectionMetrics = {
  readonly rows: number
  readonly bytes: number
}

/** Count projected rows and canonical key bytes before a backfill can issue or commit work. */
const estimateBackfillProjectionMetrics = (
  projection: IRecordIndexProjection | undefined,
  recordKey: IStorageKey,
  scope: string,
  generation: string
): IBackfillProjectionMetrics => {
  if (projection === undefined) return { rows: 0, bytes: 0 }
  let rows = 0
  let bytes = 0
  for (const [indexName, entry] of Object.entries(projection)) {
    if (entry === undefined) continue
    const values = entry.kind === 'multiple' ? entry.keys : [entry.key]
    for (const indexValue of values) {
      rows += 1
      const persistedPrimaryKey: IStorageKey = [scope, indexName, generation, indexValue, recordKey]
      bytes += utf8ByteLength(encodeFlatStorageKey(persistedPrimaryKey))
    }
  }
  return { rows, bytes }
}

/** Reject bounded backfill work without exposing record keys or values in the error detail. */
const assertBackfillProjectionLimits = (
  metrics: IBackfillProjectionMetrics,
  scope: 'record' | 'batch'
): void => {
  const rowLimit =
    scope === 'record' ? INDEX_BACKFILL_RECORD_ROW_CAP : INDEX_BACKFILL_PROJECTION_ROW_CAP
  if (metrics.rows > rowLimit || metrics.bytes > INDEX_BACKFILL_PROJECTION_BYTE_CAP)
    throw new StorageError(StorageErrorCode.valueTooLarge, {
      backend: StorageBackend.indexedDb,
      cause: new RangeError(StorageErrorText.indexBackfillProjectionTooLarge)
    })
}

/** Preserve contract cancellation identity when `withTimeout` reports through its utils error. */
const normalizeTransactionCallbackError = (error: unknown): StorageContractError | StorageError => {
  if (error instanceof UtilsAbortError)
    return new StorageContractError(StorageContractErrorCode.aborted, {
      backend: StorageBackend.indexedDb,
      cause: error.cause
    })
  if (
    error !== null &&
    typeof error === 'object' &&
    'source' in error &&
    error.source === '@migaia/utils' &&
    'code' in error &&
    error.code === UtilsErrorCode.deadlineExceeded
  )
    return new StorageContractError(StorageContractErrorCode.aborted, {
      backend: StorageBackend.indexedDb,
      cause: error
    })
  if (isStorageErrorFamily(error)) return error
  return new StorageError(StorageErrorCode.transactionFailed, {
    backend: StorageBackend.indexedDb,
    cause: error
  })
}

/** Create the canonical bounded decoded-payload failure without exposing record data. */
const backfillDecodedTooLarge = (): StorageError =>
  new StorageError(StorageErrorCode.valueTooLarge, {
    backend: StorageBackend.indexedDb,
    cause: new RangeError(StorageErrorText.indexBackfillDecodedTooLarge)
  })

/** Detach mutable record/byte payloads before the first asynchronous backend boundary. */
const snapshotWriteValue = <T>(value: T, key: IStorageKey): T => {
  try {
    return structuredClone(value)
  } catch (cause) {
    throw new StorageError(StorageErrorCode.serializeFailed, {
      backend: StorageBackend.indexedDb,
      key,
      cause
    })
  }
}

/**
 * IndexedDB 的结构化克隆可能在与调用方不同的 realm 里重建 ArrayBuffer（测试环境下 fake-indexeddb 与 jsdom 就是典型场景）。通用 guard 通过
 * intrinsic 内部槽判定真实品牌， 避免 `instanceof` 的跨 realm 假阴性和 `constructor.name` / tag 伪造的假阳性。
 */
const isRawArrayBuffer = (value: unknown): value is ArrayBuffer => isArrayBuffer(value)

const toIdbRange = (
  range: IKeyRange | undefined,
  KeyRange: typeof IDBKeyRange | undefined
): IDBKeyRange | undefined => {
  const rangeSnapshot = snapshotKeyRange(range, StorageBackend.indexedDb)
  if (!rangeSnapshot) return undefined
  if (!KeyRange)
    throw new StorageError(StorageErrorCode.unavailable, {
      backend: StorageBackend.indexedDb,
      cause: new Error('IDBKeyRange is unavailable; pass options.keyRange explicitly')
    })
  if (rangeSnapshot.lower !== undefined && rangeSnapshot.upper !== undefined)
    return KeyRange.bound(
      toIdbKey(rangeSnapshot.lower),
      toIdbKey(rangeSnapshot.upper),
      rangeSnapshot.lowerOpen ?? false,
      rangeSnapshot.upperOpen ?? false
    )
  if (rangeSnapshot.lower !== undefined)
    return KeyRange.lowerBound(toIdbKey(rangeSnapshot.lower), rangeSnapshot.lowerOpen ?? false)
  if (rangeSnapshot.upper !== undefined)
    return KeyRange.upperBound(toIdbKey(rangeSnapshot.upper), rangeSnapshot.upperOpen ?? false)
  return undefined
}

/** Compile one logical index range into the physical lookup-key range. */
const toIdbRecordIndexRange = (
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

/**
 * IndexedDB 后端：唯一原样存字节、支持索引与事务的浏览器存储。
 *
 * 连接管理、写入-等-commit、onblocked/onversionchange 处理，都是从早期 实现直接搬运的已验证坑位处理，未改动核心逻辑，详见各处注释。
 */
export const indexedDbHost = <TValue = unknown>(
  options: IIndexedDbOptions = {}
): IRecordStore<TValue> & ISecondaryIndexRecordStore<TValue> & IChangeFeedStore => {
  if (options === null || typeof options !== 'object' || Array.isArray(options))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError('IndexedDB options must be an object')
    })
  let configuredDbName: string | undefined
  let configuredKvStoreName: string | undefined
  let configuredBytesStoreName: string | undefined
  let configuredRecordsStoreName: string | undefined
  let configuredCleanupLegacyRecords: boolean | undefined
  let configuredFactory: IDBFactory | undefined
  let configuredKeyRange: typeof IDBKeyRange | undefined
  try {
    configuredDbName = options.dbName
    configuredKvStoreName = options.kvStoreName
    configuredBytesStoreName = options.bytesStoreName
    configuredRecordsStoreName = options.recordsStoreName
    configuredCleanupLegacyRecords = options.cleanupLegacyRecords
    configuredFactory = options.factory
    configuredKeyRange = options.keyRange
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause
    })
  }
  /** Snapshot the realm default factory once for capability admission and data-universe identity. */
  let realmDefaultFactory: IDBFactory | undefined
  try {
    realmDefaultFactory = (globalThis as { indexedDB?: IDBFactory }).indexedDB
  } catch {
    realmDefaultFactory = undefined
  }
  /** Snapshot the realm BroadcastChannel constructor once; construction must not open a database. */
  let broadcastChannel: typeof BroadcastChannel | undefined
  try {
    broadcastChannel = (globalThis as { BroadcastChannel?: typeof BroadcastChannel })
      .BroadcastChannel
  } catch {
    broadcastChannel = undefined
  }
  const dbName = configuredDbName === undefined ? 'storage-web' : configuredDbName
  const kvStoreName = configuredKvStoreName === undefined ? 'kv' : configuredKvStoreName
  const bytesStoreName = configuredBytesStoreName === undefined ? 'bytes' : configuredBytesStoreName
  const recordsStoreName =
    configuredRecordsStoreName === undefined ? 'records' : configuredRecordsStoreName
  const cleanupLegacyRecords =
    configuredCleanupLegacyRecords === undefined ? false : configuredCleanupLegacyRecords
  const factory = configuredFactory === undefined ? realmDefaultFactory : configuredFactory
  const keyRange =
    configuredKeyRange === undefined
      ? (globalThis as { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange
      : configuredKeyRange

  if (typeof cleanupLegacyRecords !== 'boolean')
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError('cleanupLegacyRecords must be a boolean')
    })

  if (!factory)
    throw new StorageError(StorageErrorCode.unavailable, { backend: StorageBackend.indexedDb })
  if (
    (typeof factory !== 'object' && typeof factory !== 'function') ||
    factory === null ||
    typeof (factory as { open?: unknown }).open !== 'function'
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError('IndexedDB factory must provide open()')
    })
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
    })
  const configuredStoreNames = [kvStoreName, bytesStoreName, recordsStoreName]
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
    })

  const recordRevisionKey = (key: IStorageKey): IDBValidKey => [
    recordsStoreName,
    encodeFlatStorageKey(key)
  ]

  /** Private array key for the current index generation; public metadata strings are data only. */
  const indexMetadataKey = (scope: string): IDBValidKey => [INTERNAL_META_NAMESPACE, 'index', scope]

  /** Recover an internally-owned index scope without trusting forgeable public string keys. */
  const readInternalIndexScope = (key: IDBValidKey): string | undefined =>
    Array.isArray(key) &&
    key.length === 3 &&
    key[0] === INTERNAL_META_NAMESPACE &&
    key[1] === 'index' &&
    typeof key[2] === 'string'
      ? key[2]
      : undefined

  /** One local monotonic clock shared by all private sessions in this store instance. */
  const backfillMonotonicNow = createMonotonicClock()

  /**
   * Context-local observations cannot cross realms because `performance.now()` origins are
   * incomparable.
   */
  const backfillTakeoverObservations = new Map<string, number>()

  /** Identifies one observed owner heartbeat within this IndexedDB context. */
  const backfillTakeoverObservationKey = (
    scope: string,
    generation: string,
    ownerToken: string,
    heartbeatRevision: number
  ): string => `${scope}\u0000${generation}\u0000${ownerToken}\u0000${heartbeatRevision}`

  /** Discard observations invalidated by a heartbeat revision or generation change. */
  const clearBackfillTakeoverObservations = (scope: string, generation: string): void => {
    const prefix = `${scope}\u0000${generation}\u0000`
    for (const key of backfillTakeoverObservations.keys())
      if (key.startsWith(prefix)) backfillTakeoverObservations.delete(key)
  }

  /** Names an archived generation without colliding with the current scope pointer. */
  const indexGenerationMetadataKey = (scope: string, generation: string): IDBValidKey => [
    INTERNAL_META_NAMESPACE,
    'index-stale',
    scope,
    encodeFlatStorageKey(generation)
  ]

  /** Creates the public error used when a raw mutation has rotated an index handle. */
  const staleIndexHandleError = (): StorageError =>
    new StorageError(
      StorageErrorCode.indexBackfillStale,
      { backend: StorageBackend.indexedDb },
      StorageErrorText.indexBackfillStale
    )

  /**
   * Scope component of the `{global, scope}` mutation-epoch vector required by SWV2-D26/E19. Bumped
   * atomically with every `runIndexedTransaction` commit that mutates this scope's sidecar rows, so
   * a paginated `iterateRecordIndex` can detect an in-flight write between pages without
   * re-scanning the whole index.
   */
  const indexScopeEpochKey = (scope: string): IDBValidKey => ['__storage_web_index_epoch__', scope]

  /** Separate raw-firewall invalidations from planner writes during backfill. */
  const indexRawEpochKey = (scope: string): IDBValidKey => ['__storage_web_raw_epoch__', scope]

  /**
   * Scoped `META_STORE_NAME` cleanup for a raw `clearRecords`/`clearAll` (SWV2-D27/§4.4): deletes
   * only the index-handle/readiness (`index:<scope>`) and repository migration-checkpoint
   * (`repository:<name>:migration`) keys this backend owns, inside the caller's existing
   * transaction. Never touches the backend's own legacy v1-to-v2 migration checkpoint
   * (`LEGACY_RECORDS_MIGRATION_KEY`) — deleting it would make `migrateLegacyRecords` silently
   * re-copy already-cleared legacy `documents` rows back into `records` on the next open
   * (SOL-SWV2-035) — and never touches arbitrary public `metadata` entries, which share this store
   * but are not backend-owned (SOL-SWV2-036).
   */
  const deleteOwnedMetaKeys = async (
    metaStore: IDBObjectStore,
    signal: AbortSignal | undefined,
    runtime: IStorageOperationRuntime
  ): Promise<void> => {
    const keys = (await fromIdbRequest(
      metaStore.getAllKeys(),
      { signal },
      runtime
    )) as IDBValidKey[]
    for (const key of keys) {
      if (readInternalIndexScope(key) !== undefined) {
        metaStore.delete(key)
        continue
      }
      if (Array.isArray(key)) continue
      if (typeof key !== 'string') continue
      if (key === LEGACY_RECORDS_MIGRATION_MIRROR_KEY) continue
      if (key.startsWith('index:') || /^repository:.+:migration$/.test(key)) metaStore.delete(key)
    }
  }

  /**
   * Scoped `REVISIONS_STORE_NAME` cleanup for a raw `clearRecords`/`clearAll` (§4.4): clears every
   * per-record and per-scope revision/epoch entry, but leaves the global `RECORD_EPOCH_KEY` counter
   * for the caller to read-and-bump atomically in the same transaction (SOL-SWV2-037).
   */
  const deleteOwnedRevisionKeys = async (
    revisionStore: IDBObjectStore,
    signal: AbortSignal | undefined,
    runtime: IStorageOperationRuntime
  ): Promise<void> => {
    const keys = (await fromIdbRequest(
      revisionStore.getAllKeys(),
      { signal },
      runtime
    )) as IDBValidKey[]
    for (const key of keys) {
      if (key === RECORD_EPOCH_KEY) continue
      revisionStore.delete(key)
    }
  }

  /** Archives the old terminal metadata before publishing a new current-generation pointer. */
  const archiveIndexGeneration = (
    metaStore: IDBObjectStore,
    state: Record<string, unknown> | undefined,
    nextGeneration: string
  ): void => {
    if (state === undefined) return
    const handle = state.handle as IRecordIndexHandle | undefined
    if (handle === undefined) return
    metaStore.put(
      {
        ...state,
        currentGeneration: handle.generation,
        stale: true,
        staleBy: nextGeneration,
        lease: undefined,
        issued: undefined
      },
      indexGenerationMetadataKey(handle.scope, handle.generation)
    )
  }

  /** Rotates one registered scope atomically and returns both generations for sidecar cleanup. */
  const rotateIndexGeneration = (
    metaStore: IDBObjectStore,
    metadataKey: IDBValidKey,
    state: Record<string, unknown> | undefined
  ):
    | { readonly oldHandle: IRecordIndexHandle; readonly newHandle: IRecordIndexHandle }
    | undefined => {
    if (state === undefined) return undefined
    const oldHandle = state.handle as IRecordIndexHandle | undefined
    if (oldHandle === undefined) return undefined
    const newHandle = Object.freeze({
      scope: oldHandle.scope,
      generation: createIndexGeneration(),
      fingerprint: oldHandle.fingerprint
    })
    archiveIndexGeneration(metaStore, state, newHandle.generation)
    metaStore.put(
      {
        handle: newHandle,
        currentGeneration: newHandle.generation,
        readiness: { status: 'pending', scanned: 0, indexed: 0 }
      },
      metadataKey
    )
    return { oldHandle, newHandle }
  }

  /**
   * SWV2-D27 raw-record firewall for `putRecord`/`deleteRecord`: a raw mutation bypasses the entity
   * repository's projection-aware planner, so any index built over the affected data may now be
   * wrong. Called inside the caller's existing readwrite transaction after the record write/delete
   * itself has been staged but before commit. Canonical entity keys affect only their own scope;
   * every other valid storage-key domain conservatively invalidates every registered scope because
   * a raw adapter cannot prove which entity projection it bypassed.
   */
  type IRawMutationAuthority = {
    readonly canonicalScopes: readonly string[]
    readonly unscopedPresent: boolean
  }

  /** Classify a complete legacy batch once, independent of its physical key ordering. */
  const classifyLegacyMutationBatch = (keys: readonly IStorageKey[]): IRawMutationAuthority => {
    const scopes = new Set<string>()
    let unscopedPresent = false
    for (const key of keys) {
      if (
        Array.isArray(key) &&
        key.length === 3 &&
        key[0] === REPOSITORY_KEY_PREFIX &&
        typeof key[1] === 'string' &&
        typeof key[2] === 'string'
      )
        scopes.add(key[1])
      else unscopedPresent = true
    }
    return {
      canonicalScopes: [...scopes].sort(),
      unscopedPresent
    }
  }

  const applyRawMutationFirewall = async (
    metaStore: IDBObjectStore,
    revisionStore: IDBObjectStore,
    sidecarStore: IDBObjectStore,
    key: IStorageKey | undefined,
    signal: AbortSignal | undefined,
    runtime: IStorageOperationRuntime,
    authority?: IRawMutationAuthority
  ): Promise<void> => {
    const effectiveAuthority =
      authority ?? classifyLegacyMutationBatch(key === undefined ? [] : [key])
    if (effectiveAuthority.unscopedPresent) {
      const metadataKeys = (await fromIdbRequest(
        metaStore.getAllKeys(),
        { signal },
        runtime
      )) as IDBValidKey[]
      sidecarStore.clear()
      for (const metadataKey of metadataKeys) {
        const metadataScope = readInternalIndexScope(metadataKey)
        if (metadataScope === undefined) continue
        const state = (await fromIdbRequest(metaStore.get(metadataKey), { signal }, runtime)) as
          | Record<string, unknown>
          | undefined
        const handle = state?.handle as IRecordIndexHandle | undefined
        if (handle === undefined || metadataScope !== handle.scope) continue
        rotateIndexGeneration(metaStore, metadataKey, state)
        const scope = handle.scope
        const rawEpoch = (await fromIdbRequest(
          revisionStore.get(indexRawEpochKey(scope)) as IDBRequest<number | undefined>,
          { signal },
          runtime
        )) as number | undefined
        revisionStore.put((rawEpoch ?? 0) + 1, indexRawEpochKey(scope))
        const scopeEpoch = (await fromIdbRequest(
          revisionStore.get(indexScopeEpochKey(scope)) as IDBRequest<number | undefined>,
          { signal },
          runtime
        )) as number | undefined
        revisionStore.put((scopeEpoch ?? 0) + 1, indexScopeEpochKey(scope))
      }
      for (const metadataKey of metadataKeys) {
        if (typeof metadataKey === 'string' && /^repository:.+:migration$/.test(metadataKey))
          metaStore.delete(metadataKey)
      }
      return
    }
    for (const canonicalScope of effectiveAuthority.canonicalScopes) {
      const scopeKey = indexMetadataKey(canonicalScope)
      const state = (await fromIdbRequest(metaStore.get(scopeKey), { signal }, runtime)) as
        | Record<string, unknown>
        | undefined
      const handle = state?.handle as IRecordIndexHandle | undefined
      if (handle === undefined) continue
      if (key !== undefined) {
        const oldRows = await fromIdbRequest(
          sidecarStore
            .index('record')
            .getAllKeys([canonicalScope, handle.generation, toIdbKey(key)]),
          { signal },
          runtime
        )
        for (const oldRow of oldRows as IDBValidKey[]) sidecarStore.delete(oldRow)
      }
      rotateIndexGeneration(metaStore, scopeKey, state)
      metaStore.delete(repositoryMigrationKey(canonicalScope))
      const epochKey = indexScopeEpochKey(canonicalScope)
      const epoch = (await fromIdbRequest(
        revisionStore.get(epochKey) as IDBRequest<number | undefined>,
        { signal },
        runtime
      )) as number | undefined
      revisionStore.put((epoch ?? 0) + 1, epochKey)
      const rawEpoch = (await fromIdbRequest(
        revisionStore.get(indexRawEpochKey(canonicalScope)) as IDBRequest<number | undefined>,
        { signal },
        runtime
      )) as number | undefined
      revisionStore.put((rawEpoch ?? 0) + 1, indexRawEpochKey(canonicalScope))
    }
  }

  const ensureRecordIndexes = async (
    scope: string,
    definitions: readonly IRecordIndexDefinition[],
    _ctx?: IOperationContext
  ): Promise<IRecordIndexHandle> =>
    withMutationLease(async (lease) => {
      assertLive()
      const operation = snapshotOperationContext(_ctx)
      throwIfAborted(operation?.signal)
      const fingerprint = JSON.stringify(definitions)
      const runtime = createStorageOperationRuntime()
      const database = await open(runtime, lease)
      /** The readwrite metadata transaction is the cross-connection linearization point. */
      const transaction = createTransaction(database, META_STORE_NAME, 'readwrite')
      const metadata = transaction.objectStore(META_STORE_NAME)
      const existing = (await fromIdbRequest(
        metadata.get(indexMetadataKey(scope)),
        { signal: operation?.signal },
        runtime
      )) as (Record<string, unknown> & { readonly handle?: IRecordIndexHandle }) | undefined
      const existingReadiness = existing?.readiness as IRecordIndexReadiness | undefined
      if (
        isValidIndexGeneration(existing?.handle?.generation) &&
        existing?.handle?.fingerprint === fingerprint &&
        existingReadiness?.status !== 'failed'
      ) {
        await idbTransactionCommit(transaction, { signal: operation?.signal }, runtime)
        return existing.handle
      }
      const generation = createIndexGeneration()
      const handle = Object.freeze({ scope, generation, fingerprint })
      if (existing?.handle !== undefined) archiveIndexGeneration(metadata, existing, generation)
      metadata.put(
        {
          handle,
          currentGeneration: generation,
          readiness: { status: 'pending', scanned: 0, indexed: 0 }
        },
        indexMetadataKey(scope)
      )
      await idbTransactionCommit(transaction, { signal: operation?.signal }, runtime)
      return handle
    })

  /** Open one metadata-owned backfill lease and expose immutable record batches. */
  const openBackfillSession = async (
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
  ): Promise<import('./indexed-db-backfill.js').IIndexedDbBackfillSession<TValue>> => {
    return withMutationLease(async (mutationLease) => {
      assertLive()
      if (!isValidIndexGeneration(handle.generation)) throw staleIndexHandleError()
      const operation = snapshotOperationContext(ctx)
      throwIfAborted(operation?.signal)
      if (options === null || typeof options !== 'object' || Array.isArray(options))
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.indexedDb
        })
      const physicalRange = snapshotKeyRange(options.range, StorageBackend.indexedDb)
      const legacyPhysicalRange = snapshotKeyRange(options.legacyRange, StorageBackend.indexedDb)
      const includeLegacy = options.includeLegacy === true
      if (
        physicalRange?.lower === undefined ||
        physicalRange.upper === undefined ||
        typeof options.allowComplete !== 'boolean'
      )
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.indexedDb
        })
      const batchSize = options.batchSize ?? LEGACY_MIGRATION_BATCH_SIZE
      const leaseMs = options.leaseMs ?? INDEX_BACKFILL_DEFAULT_LEASE_MS
      if (
        !Number.isSafeInteger(batchSize) ||
        batchSize < INDEX_BACKFILL_MIN_BATCH_SIZE ||
        batchSize > INDEX_BACKFILL_MAX_BATCH_SIZE
      )
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.indexedDb
        })
      if (
        !Number.isSafeInteger(leaseMs) ||
        leaseMs < INDEX_BACKFILL_MIN_LEASE_MS ||
        leaseMs > INDEX_BACKFILL_MAX_LEASE_MS
      )
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.indexedDb
        })
      const runtime = createStorageOperationRuntime()
      const database = await open(runtime, mutationLease)
      const ownerToken = createStorageToken()
      const acquire = createTransaction(
        database,
        [META_STORE_NAME, REVISIONS_STORE_NAME],
        'readwrite'
      )
      const metadata = acquire.objectStore(META_STORE_NAME)
      const current = (await fromIdbRequest(
        metadata.get(indexMetadataKey(handle.scope)),
        {
          signal: operation?.signal
        },
        runtime
      )) as
        | {
            handle?: IRecordIndexHandle
            readiness?: IRecordIndexReadiness
            checkpoint?: IStorageKey
            phase?: IIndexedDbBackfillPhase
            lease?: IBackfillLease
            scanStartRawEpoch?: number
          }
        | undefined
      if (current?.handle?.generation !== handle.generation) throw staleIndexHandleError()
      const readiness = current.readiness ?? { status: 'pending', scanned: 0, indexed: 0 }
      if (readiness.status === 'complete') throw staleIndexHandleError()
      const phase = current.phase ?? IndexedDbBackfillPhase.canonical
      if (phase !== IndexedDbBackfillPhase.canonical && phase !== IndexedDbBackfillPhase.legacy)
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.indexedDb
        })
      if (phase === IndexedDbBackfillPhase.legacy && !includeLegacy)
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.indexedDb
        })
      const currentLease = current.lease
      let lease: IBackfillLease
      if (currentLease !== undefined) {
        const currentRevision = currentLease.heartbeatRevision ?? 0
        const currentLeaseMs = currentLease.leaseMs ?? INDEX_BACKFILL_DEFAULT_LEASE_MS
        const observationKey = backfillTakeoverObservationKey(
          handle.scope,
          handle.generation,
          currentLease.ownerToken,
          currentRevision
        )
        const observedAtMonotonic = backfillTakeoverObservations.get(observationKey)
        const nowMonotonic = backfillMonotonicNow()
        if (
          observedAtMonotonic === undefined ||
          nowMonotonic - observedAtMonotonic < currentLeaseMs
        ) {
          if (observedAtMonotonic === undefined) {
            clearBackfillTakeoverObservations(handle.scope, handle.generation)
            backfillTakeoverObservations.set(observationKey, nowMonotonic)
          }
          try {
            acquire.abort()
          } catch {
            /* The transaction may already have settled while the contender was reading. */
          }
          throw createBackfillContentionFailure()
        }
        clearBackfillTakeoverObservations(handle.scope, handle.generation)
        // The readwrite transaction is the compare-and-swap boundary for takeover.
        lease = {
          ownerToken,
          heartbeatRevision: currentRevision + 1,
          leaseMs: currentLeaseMs
        }
      } else {
        clearBackfillTakeoverObservations(handle.scope, handle.generation)
        lease = { ownerToken, heartbeatRevision: 0, leaseMs }
      }
      /**
       * SOL-SWV2-040/042: only a genuinely fresh scan (starting from the range's beginning, i.e. no
       * checkpoint yet) takes a new raw-firewall epoch snapshot; a resumed session preserves the
       * one from when this scan actually began, so a raw write from an earlier resumed batch is
       * still caught at completion in `commitBatch`.
       */
      const scanStartRawEpoch =
        current.scanStartRawEpoch === undefined
          ? (((await fromIdbRequest(
              acquire
                .objectStore(REVISIONS_STORE_NAME)
                .get(indexRawEpochKey(handle.scope)) as IDBRequest<number | undefined>,
              { signal: operation?.signal },
              runtime
            )) as number | undefined) ?? 0)
          : current.scanStartRawEpoch
      metadata.put(
        {
          ...current,
          handle,
          readiness: { ...readiness, status: 'running' },
          lease,
          checkpoint: current.checkpoint,
          phase,
          issued: undefined,
          scanStartRawEpoch,
          lastBatchReceipt: undefined
        },
        indexMetadataKey(handle.scope)
      )
      await idbTransactionCommit(acquire, { signal: operation?.signal }, runtime)
      let checkpoint: IStorageKey | undefined = current.checkpoint
      let currentPhase = phase
      let sessionHeartbeatRevision = lease.heartbeatRevision
      let released = false

      const assertSession = (): void => {
        if (released)
          throw new StorageContractError(StorageContractErrorCode.disposed, {
            backend: StorageBackend.indexedDb
          })
      }
      const readBatch = async (
        readCtx?: IOperationContext,
        readOptions?: IIndexedDbBackfillReadOptions<TValue>,
        inheritedLease?: IMutationLeaseContext
      ): Promise<Awaited<ReturnType<IIndexedDbBackfillSession<TValue>['readBatch']>>> => {
        assertSession()
        const readOperation = snapshotOperationContext(readCtx)
        throwIfAborted(readOperation?.signal)
        const readRuntime = createStorageOperationRuntime()
        const readDatabase = await open(readRuntime, inheritedLease)
        const transaction = createTransaction(
          readDatabase,
          [recordsStoreName, REVISIONS_STORE_NAME],
          'readonly'
        )
        const activeRange =
          currentPhase === IndexedDbBackfillPhase.legacy ? legacyPhysicalRange : physicalRange
        const range = toIdbRange(
          checkpoint === undefined
            ? activeRange
            : activeRange === undefined
              ? { lower: checkpoint, lowerOpen: true }
              : { ...activeRange, lower: checkpoint, lowerOpen: true },
          keyRange
        )
        const keys = (await fromIdbRequest(
          transaction.objectStore(recordsStoreName).getAllKeys(range, batchSize + 1),
          { signal: readOperation?.signal },
          readRuntime
        )) as IDBValidKey[]
        const values = (await fromIdbRequest(
          transaction.objectStore(recordsStoreName).getAll(range, batchSize + 1),
          { signal: readOperation?.signal },
          readRuntime
        )) as TValue[]
        const rawCandidates: IIndexedDbBackfillCandidate<TValue>[] = []
        const candidateCount = Math.min(keys.length, batchSize)
        for (let index = 0; index < candidateCount; index += 1) {
          const key = snapshotStorageKey(keys[index] as IStorageKey, StorageBackend.indexedDb)
          const revision = (await fromIdbRequest(
            transaction.objectStore(REVISIONS_STORE_NAME).get(recordRevisionKey(key)),
            { signal: readOperation?.signal },
            readRuntime
          )) as number | undefined
          const raw = snapshotWriteValue(values[index], key)
          rawCandidates.push(
            Object.freeze({
              key,
              raw,
              revision: revision ?? 0,
              phase: currentPhase
            })
          )
        }
        const candidates: IIndexedDbBackfillCandidate<TValue>[] = []
        const preparations: IIndexedDbBackfillPreparation[] = []
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
              handle.scope,
              handle.generation
            )
            assertBackfillProjectionLimits(metrics, 'record')
            if (preparation.decodedBytes > INDEX_BACKFILL_SOFT_CAP_BYTES)
              throw backfillDecodedTooLarge()
            if (decodedBytes + preparation.decodedBytes > INDEX_BACKFILL_SOFT_CAP_BYTES)
              throw backfillDecodedTooLarge()
            candidates.push(candidate)
            preparations.push(preparation)
            decodedBytes += preparation.decodedBytes
          }
        } else {
          for (const candidate of rawCandidates) {
            const valueBytes = safeJsonPayloadByteLength(candidate.raw)
            if (decodedBytes + valueBytes > INDEX_BACKFILL_SOFT_CAP_BYTES)
              throw backfillDecodedTooLarge()
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
            handle.scope,
            handle.generation
          )
          preparedProjectionRows += metrics.rows
          preparedProjectionBytes += metrics.bytes
        }
        assertBackfillProjectionLimits(
          { rows: preparedProjectionRows, bytes: preparedProjectionBytes },
          'batch'
        )
        // `release()` may race an entity decoder; never publish an issued manifest after release.
        assertSession()
        const endOfScan = candidates.length === keys.length
        const metadataTransaction = createTransaction(readDatabase, META_STORE_NAME, 'readwrite')
        const metadataStore = metadataTransaction.objectStore(META_STORE_NAME)
        const metadataState = (await fromIdbRequest(
          metadataStore.get(indexMetadataKey(handle.scope)),
          { signal: readOperation?.signal },
          readRuntime
        )) as Record<string, unknown> | undefined
        if (
          (metadataState?.handle as IRecordIndexHandle | undefined)?.generation !==
          handle.generation
        )
          throw staleIndexHandleError()
        if (
          ((metadataState?.phase as IIndexedDbBackfillPhase | undefined) ??
            IndexedDbBackfillPhase.canonical) !== currentPhase
        )
          throw staleIndexHandleError()
        if (
          metadataState === undefined ||
          (metadataState.lease as { ownerToken?: string } | undefined)?.ownerToken !== ownerToken
        )
          throw new StorageError(StorageErrorCode.unavailable, {
            backend: StorageBackend.indexedDb
          })
        metadataStore.put(
          {
            ...metadataState,
            issued: {
              ownerToken,
              phase: currentPhase,
              checkpoint: checkpoint === undefined ? undefined : encodeFlatStorageKey(checkpoint),
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
          indexMetadataKey(handle.scope)
        )
        await idbTransactionCommit(
          metadataTransaction,
          { signal: readOperation?.signal },
          readRuntime
        )
        return Object.freeze({
          phase: currentPhase,
          checkpoint,
          endOfScan,
          candidates: Object.freeze(candidates),
          preparations: readOptions?.prepare === undefined ? undefined : Object.freeze(preparations)
        })
      }
      const session: IIndexedDbBackfillSession<TValue> = {
        generation: handle.generation,
        ownerToken,
        renew: (renewCtx) =>
          withMutationLease(async (lease) => {
            assertSession()
            assertLive()
            const renewOperation = snapshotOperationContext(renewCtx)
            throwIfAborted(renewOperation?.signal)
            const renewRuntime = createStorageOperationRuntime()
            const renewDatabase = await open(renewRuntime, lease)
            const transaction = createTransaction(renewDatabase, META_STORE_NAME, 'readwrite')
            const metadata = transaction.objectStore(META_STORE_NAME)
            const state = (await fromIdbRequest(
              metadata.get(indexMetadataKey(handle.scope)),
              { signal: renewOperation?.signal },
              renewRuntime
            )) as
              | {
                  handle?: IRecordIndexHandle
                  lease?: IBackfillLease
                }
              | undefined
            if (
              state?.handle?.generation !== handle.generation ||
              state.lease?.ownerToken !== ownerToken
            )
              throw state?.handle?.generation !== handle.generation
                ? staleIndexHandleError()
                : new StorageError(StorageErrorCode.unavailable, {
                    backend: StorageBackend.indexedDb
                  })
            const currentLease = state.lease
            const nextHeartbeatRevision = (currentLease?.heartbeatRevision ?? 0) + 1
            sessionHeartbeatRevision = nextHeartbeatRevision
            metadata.put(
              {
                ...state,
                lease: {
                  ownerToken,
                  heartbeatRevision: nextHeartbeatRevision,
                  leaseMs: currentLease?.leaseMs ?? leaseMs
                }
              },
              indexMetadataKey(handle.scope)
            )
            await idbTransactionCommit(
              transaction,
              { signal: renewOperation?.signal },
              renewRuntime
            )
          }),
        readBatch: (readCtx, readOptions) =>
          withMutationLease((lease) => readBatch(readCtx, readOptions, lease)),
        commitBatch: (batch: IIndexedDbBackfillBatch, commitCtx) =>
          withMutationLease(async (lease) => {
            assertSession()
            const commitOperation = snapshotOperationContext(commitCtx)
            throwIfAborted(commitOperation?.signal)
            const batchPhase = batch.phase ?? IndexedDbBackfillPhase.canonical
            if (
              batchPhase !== currentPhase ||
              batch.generation !== handle.generation ||
              batch.ownerToken !== ownerToken
            )
              throw new StorageError(StorageErrorCode.invalidConfig, {
                backend: StorageBackend.indexedDb
              })
            const batchIdentity = JSON.stringify({
              phase: batchPhase,
              generation: batch.generation,
              ownerToken: batch.ownerToken,
              checkpoint:
                batch.checkpoint === undefined ? undefined : encodeFlatStorageKey(batch.checkpoint),
              nextCheckpoint:
                batch.nextCheckpoint === undefined
                  ? undefined
                  : encodeFlatStorageKey(batch.nextCheckpoint),
              endOfScan: batch.endOfScan,
              projections: batch.projections.map((projection) => ({
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
            const commitRuntime = createStorageOperationRuntime()
            const commitDatabase = await open(commitRuntime, lease)
            const transaction = createTransaction(
              commitDatabase,
              [recordsStoreName, INDEX_RECORDS_STORE_NAME, REVISIONS_STORE_NAME, META_STORE_NAME],
              'readwrite'
            )
            const committed = idbTransactionCommit(
              transaction,
              { signal: commitOperation?.signal },
              commitRuntime
            )
            void committed.catch(() => {})
            try {
              const metadata = transaction.objectStore(META_STORE_NAME)
              const state = (await fromIdbRequest(
                metadata.get(indexMetadataKey(handle.scope)),
                { signal: commitOperation?.signal },
                commitRuntime
              )) as
                | {
                    handle?: IRecordIndexHandle
                    checkpoint?: IStorageKey
                    phase?: IIndexedDbBackfillPhase
                    readiness?: IRecordIndexReadiness
                    lastBatch?: string
                    lastBatchReceipt?: IIndexedDbBackfillRetryReceipt
                    issued?: {
                      ownerToken: string
                      phase: IIndexedDbBackfillPhase
                      checkpoint?: string
                      endOfScan: boolean
                      finalKey?: string
                      entries: readonly { key: string; revision: number }[]
                    }
                    lease?: IBackfillLease
                    scanStartRawEpoch?: number
                  }
                | undefined
              if (state?.handle?.generation !== handle.generation) throw staleIndexHandleError()
              if (
                ((state?.phase as IIndexedDbBackfillPhase | undefined) ??
                  IndexedDbBackfillPhase.canonical) !== batchPhase
              )
                throw staleIndexHandleError()
              if (state?.readiness?.status === 'complete') throw staleIndexHandleError()
              const activeLease = state?.lease
              const retryReceipt = state?.lastBatchReceipt
              const isExactRetry =
                activeLease === undefined &&
                retryReceipt?.ownerToken === ownerToken &&
                retryReceipt.heartbeatRevision === sessionHeartbeatRevision &&
                retryReceipt.batchIdentity === batchIdentity
              if (activeLease?.ownerToken !== ownerToken && !isExactRetry)
                throw staleIndexHandleError()
              if (isExactRetry) {
                await committed
                return state.readiness ?? { status: 'running', scanned: 0, indexed: 0 }
              }
              if (
                (state.checkpoint === undefined
                  ? batch.checkpoint !== undefined
                  : batch.checkpoint === undefined ||
                    encodeFlatStorageKey(state.checkpoint) !==
                      encodeFlatStorageKey(batch.checkpoint)) ||
                (state.checkpoint !== undefined &&
                  batch.nextCheckpoint !== undefined &&
                  compareStorageKeys(batch.nextCheckpoint, state.checkpoint) <= 0)
              )
                throw new StorageError(StorageErrorCode.invalidConfig, {
                  backend: StorageBackend.indexedDb
                })
              const issuedManifest = state.issued
              const issued = issuedManifest?.entries ?? []
              if (
                issuedManifest?.ownerToken !== ownerToken ||
                issuedManifest.phase !== batchPhase ||
                issuedManifest.checkpoint !==
                  (batch.checkpoint === undefined
                    ? undefined
                    : encodeFlatStorageKey(batch.checkpoint)) ||
                issuedManifest.endOfScan !== batch.endOfScan ||
                issuedManifest.finalKey !==
                  (batch.nextCheckpoint === undefined
                    ? undefined
                    : encodeFlatStorageKey(batch.nextCheckpoint)) ||
                issued.length !== batch.projections.length ||
                batch.projections.some(
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
                (batch.nextCheckpoint === undefined ||
                  encodeFlatStorageKey(batch.nextCheckpoint) !== issued[issued.length - 1]!.key)
              )
                throw new StorageError(StorageErrorCode.invalidConfig, {
                  backend: StorageBackend.indexedDb
                })
              let projectionRows = 0
              let projectionBytes = 0
              for (const projection of batch.projections) {
                const metrics = estimateBackfillProjectionMetrics(
                  projection.projection,
                  projection.key,
                  handle.scope,
                  handle.generation
                )
                assertBackfillProjectionLimits(metrics, 'record')
                projectionRows += metrics.rows
                projectionBytes += metrics.bytes
              }
              assertBackfillProjectionLimits(
                { rows: projectionRows, bytes: projectionBytes },
                'batch'
              )
              const sidecar = transaction.objectStore(INDEX_RECORDS_STORE_NAME)
              const revisions = transaction.objectStore(REVISIONS_STORE_NAME)
              let indexed = 0
              // A projection skipped here because its revision moved (the record was mutated after
              // this batch's `readBatch`, at a key that will never be re-scanned once past the
              // checkpoint) must not be re-projected with stale data; completeness for the whole scan
              // is separately gated below by the raw-firewall epoch, not by tracking this locally.
              for (const projection of batch.projections) {
                const currentRevision =
                  ((await fromIdbRequest(
                    revisions.get(recordRevisionKey(projection.key)),
                    { signal: commitOperation?.signal },
                    commitRuntime
                  )) as number | undefined) ?? 0
                if (currentRevision !== projection.expectedRevision) continue
                // A full legacy scan also visits canonical and foreign physical keys. They advance
                // the bounded cursor but must not delete sidecar rows produced by the canonical phase.
                if (projection.counted === false) continue
                const oldRows = await fromIdbRequest(
                  sidecar
                    .index('record')
                    .getAllKeys([handle.scope, handle.generation, toIdbKey(projection.key)]),
                  { signal: commitOperation?.signal },
                  commitRuntime
                )
                for (const oldRow of oldRows as IDBValidKey[]) sidecar.delete(oldRow)
                if (projection.outcome !== 'indexed' || projection.projection === undefined)
                  continue
                for (const [indexName, entry] of Object.entries(projection.projection)) {
                  if (entry === undefined) continue
                  const values = entry.kind === 'multiple' ? entry.keys : [entry.key]
                  for (const indexValue of values) {
                    sidecar.put({
                      scope: handle.scope,
                      generation: handle.generation,
                      indexName,
                      indexValue: toIdbKey(indexValue),
                      recordKey: toIdbKey(projection.key)
                    })
                    indexed += 1
                  }
                }
              }
              const activeRange =
                batchPhase === IndexedDbBackfillPhase.legacy ? legacyPhysicalRange : physicalRange
              const suffixRange = toIdbRange(
                batch.nextCheckpoint === undefined
                  ? activeRange
                  : activeRange === undefined
                    ? { lower: batch.nextCheckpoint, lowerOpen: true }
                    : { ...activeRange, lower: batch.nextCheckpoint, lowerOpen: true },
                keyRange
              )
              const suffix = await fromIdbRequest(
                transaction.objectStore(recordsStoreName).getAllKeys(suffixRange, 1),
                { signal: commitOperation?.signal },
                commitRuntime
              )
              const previous = state.readiness ?? { status: 'running', scanned: 0, indexed: 0 }
              /**
               * SOL-SWV2-040/042: a scan can only be trusted `complete` if the raw-firewall epoch
               * (bumped by every canonical or legacy-shaped raw write in
               * `applyRawMutationFirewall`, at _any_ readiness state, not only `complete`) still
               * matches the snapshot taken when this scan genuinely restarted from the range's
               * beginning. This catches an interleaved raw write regardless of whether it landed
               * inside this batch or between two commits, and regardless of its position relative
               * to the checkpoint — the batch-local flag this replaced could only see the former.
               * It is also recoverable: a later fresh full re-scan takes a new snapshot, and if
               * nothing else mutates the scope during that new scan, the epochs match again and
               * `complete` is reachable — unlike a sticky boolean with no legitimate reset path.
               */
              const currentRawEpoch =
                ((await fromIdbRequest(
                  revisions.get(indexRawEpochKey(handle.scope)) as IDBRequest<number | undefined>,
                  { signal: commitOperation?.signal },
                  commitRuntime
                )) as number | undefined) ?? 0
              const scanUnchanged =
                state.scanStartRawEpoch !== undefined && currentRawEpoch === state.scanStartRawEpoch
              const reachedPhaseEnd = batch.endOfScan && (suffix as IDBValidKey[]).length === 0
              const entersLegacyPhase =
                batchPhase === IndexedDbBackfillPhase.canonical && includeLegacy && reachedPhaseEnd
              const reachedScanEnd =
                options.allowComplete &&
                (batchPhase === IndexedDbBackfillPhase.legacy || !includeLegacy) &&
                reachedPhaseEnd
              const nextReadiness: IRecordIndexReadiness = {
                status: reachedScanEnd && scanUnchanged ? 'complete' : 'running',
                scanned:
                  previous.scanned +
                  batch.projections.filter((projection) => projection.counted !== false).length,
                indexed: previous.indexed + indexed
              }
              /**
               * SOL-SWV2-042: the scan reached its natural end (nothing left to scan) but could not
               * be trusted `complete` only because the epoch moved underneath it. Holding onto a
               * checkpoint at the very end of the range with no way to advance further would wedge
               * this generation permanently `running` — the next `openBackfillSession` would see a
               * defined checkpoint and treat it as a resume, never re-snapshotting the raw-firewall
               * epoch. Clearing the checkpoint here instead makes the _next_ session a genuinely
               * fresh start (per the raw-firewall epoch logic in `openBackfillSession`), so a later
               * clean full re-scan can still reach `complete`.
               */
              const nextPhase = entersLegacyPhase ? IndexedDbBackfillPhase.legacy : batchPhase
              const nextCheckpoint =
                entersLegacyPhase || (reachedScanEnd && !scanUnchanged)
                  ? undefined
                  : batch.nextCheckpoint
              const heartbeatRevision = activeLease?.heartbeatRevision ?? sessionHeartbeatRevision
              metadata.put(
                {
                  ...state,
                  phase: nextPhase,
                  readiness: nextReadiness,
                  checkpoint: nextCheckpoint,
                  lastBatch: batchIdentity,
                  lastBatchReceipt: {
                    ownerToken,
                    heartbeatRevision,
                    batchIdentity
                  },
                  issued: undefined,
                  lease: undefined
                },
                indexMetadataKey(handle.scope)
              )
              await committed
              checkpoint = nextCheckpoint
              currentPhase = nextPhase
              return nextReadiness
            } catch (cause) {
              try {
                transaction.abort()
              } catch {
                /* Transaction already settled. */
              }
              await committed.catch(() => {})
              throw cause
            }
          }),
        fail: (cause, failCtx) =>
          withMutationLease(async (lease) => {
            assertSession()
            const failOperation = snapshotOperationContext(failCtx)
            throwIfAborted(failOperation?.signal)
            const failRuntime = createStorageOperationRuntime()
            const failDatabase = await open(failRuntime, lease)
            const transaction = createTransaction(failDatabase, META_STORE_NAME, 'readwrite')
            const metadata = transaction.objectStore(META_STORE_NAME)
            const state = (await fromIdbRequest(
              metadata.get(indexMetadataKey(handle.scope)),
              { signal: failOperation?.signal },
              failRuntime
            )) as
              | {
                  handle?: IRecordIndexHandle
                  lease?: IBackfillLease
                }
              | undefined
            if (
              state?.handle?.generation !== handle.generation ||
              state?.lease?.ownerToken !== ownerToken
            )
              throw state?.handle?.generation !== handle.generation
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
              indexMetadataKey(handle.scope)
            )
            failRuntime.reporter(cause)
            try {
              await idbTransactionCommit(
                transaction,
                { signal: failOperation?.signal },
                failRuntime
              )
            } catch (persistFailure) {
              throw new AggregateError([cause, persistFailure])
            }
            released = true
          }),
        release: () => {
          released = true
        }
      }
      return session
    })
  }

  const assertLive = (): void => {
    controller.assertLive()
  }

  /** Private commit-after controller shared by direct and Host-created exact stores. */
  const controller = createBackendReactiveController({
    backend: StorageBackend.indexedDb,
    platform: factory,
    options: Object.freeze({ dbName, kvStoreName, bytesStoreName, recordsStoreName }),
    origin: `indexeddb:${createStorageToken()}`,
    finalize: async () => {
      coordination.dispose()
      const pending = connection
      const recoveryDatabase = activeDatabase
      connection = undefined
      activeDatabase = undefined
      let pendingDatabase: IDBDatabase | undefined
      if (pending) {
        try {
          pendingDatabase = await pending
          tryCloseDatabase(pendingDatabase)
        } catch {
          // 失败/正在打开的连接已不可用，dispose 是尽力而为。
        }
      }
      if (recoveryDatabase && recoveryDatabase !== pendingDatabase)
        tryCloseDatabase(recoveryDatabase)
    }
  })

  /** Report-only owner for malformed or unavailable coordination transport behavior. */
  const coordinationReporter = createStorageOperationReporter()
  /** One private registry member shared by every exact store in this physical data universe. */
  const coordination = acquireIndexedDbCoordination({
    factory,
    realmDefaultFactory,
    broadcastChannel,
    dbName,
    layoutFingerprint: indexedDbLayoutFingerprint(kvStoreName, bytesStoreName, recordsStoreName),
    ownOrigin: controller.origin,
    onChange: (change) => controller.publishExternal(change),
    report: (error) => reportCleanupError(coordinationReporter, error)
  })
  /** Immutable capabilities reflect construction-time transport admission and never mutate later. */
  const capabilities: IStorageCapabilities = Object.freeze({
    ...CAPABILITIES,
    changeFeed: coordination.admitted
  })

  /** Reject work after disposal begins without invalidating already admitted transactions. */
  const assertMutationAdmission = (): void => {
    controller.assertLive()
  }

  /** Brands the private context that an already-admitted logical operation may reuse. */
  const mutationLeaseBrand = Symbol('indexeddb-mutation-lease')
  type IMutationLeaseContext = { readonly [mutationLeaseBrand]: true }

  /** Creates the package-private context passed through nested preparation work. */
  const createMutationLeaseContext = (): IMutationLeaseContext =>
    ({ [mutationLeaseBrand]: true }) as IMutationLeaseContext

  /** Serialize a mutation's complete planner/firewall lifetime under one top-level lease. */
  const withMutationLease = async <T>(
    run: (lease: IMutationLeaseContext) => Promise<T>
  ): Promise<T> => {
    assertMutationAdmission()
    const release = controller.beginMutation()
    const lease = createMutationLeaseContext()
    try {
      return await run(lease)
    } finally {
      release()
    }
  }

  /** Reuses an admitted lease for nested preparation, or owns one for standalone maintenance. */
  const withInternalMutationLease = async <T>(
    run: (lease: IMutationLeaseContext) => Promise<T>,
    inheritedLease?: IMutationLeaseContext
  ): Promise<T> => {
    if (inheritedLease !== undefined) return run(inheritedLease)
    const release = controller.beginMutation()
    const lease = createMutationLeaseContext()
    try {
      return await run(lease)
    } finally {
      release()
    }
  }

  /**
   * SWV2-B05/§4.6/§5.3 change feed: local commit publication plus metadata-only coordination hints.
   * Every publish here happens only after the owning `IDBTransaction` has actually committed
   * (`await committed`), never before, so an aborted/rolled-back IndexedDB transaction fires
   * nothing.
   */
  /** Route existing post-commit events through the one private controller owner. */
  const publishChange = (change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>): void => {
    const event = controller.publish(change)
    if (event !== undefined) coordination.publish(event)
  }

  // 只开一次库，之后所有事务复用同一个连接。失败时要清掉缓存，否则一次瞬时
  // 故障（另一个标签页正卡在旧版本上）会把这个实例永久毒死。
  let connection: Promise<IDBDatabase> | undefined
  type IPrepareState = 'idle' | 'running' | 'ready' | 'terminal' | 'disposed'
  /** Shared preparation state; callers await the same attempt but own cancellation locally. */
  let prepareState: IPrepareState = 'idle'
  let terminalPrepareFailure: unknown
  /** Identifies the connection currently allowed to invalidate the cache. */
  let activeDatabase: IDBDatabase | undefined

  /** Attempt a host close without allowing it to replace the caller's owning failure. */
  const tryCloseDatabase = (database: IDBDatabase): unknown | undefined => {
    try {
      database.close()
      return undefined
    } catch (cause) {
      return cause
    }
  }

  /** Close before a required state transition, retaining ownership when the host refuses. */
  const closeForTransition = (database: IDBDatabase): void => {
    const cause = tryCloseDatabase(database)
    if (cause !== undefined) {
      activeDatabase = database
      throw new StorageError(StorageErrorCode.unavailable, {
        backend: StorageBackend.indexedDb,
        operation: StorageOperation.indexedDbClose,
        cause
      })
    }
    if (activeDatabase === database) activeDatabase = undefined
  }

  /** Validate the fixed native layout before any metadata can influence backend authority. */
  const validatePhysicalLayout = (database: IDBDatabase): void => {
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
    try {
      const transaction = database.transaction(
        [kvStoreName, bytesStoreName, recordsStoreName, REVISIONS_STORE_NAME, META_STORE_NAME],
        'readonly'
      )
      for (const storeName of [kvStoreName, bytesStoreName, recordsStoreName]) {
        if (transaction.objectStore(storeName).keyPath !== null)
          throw new StorageError(StorageErrorCode.invalidConfig, {
            backend: StorageBackend.indexedDb,
            operation: StorageOperation.indexedDbSchema,
            cause: new TypeError('IndexedDB channel stores must use caller-supplied keys')
          })
      }
      for (const storeName of [REVISIONS_STORE_NAME, META_STORE_NAME]) {
        if (transaction.objectStore(storeName).keyPath !== null)
          throw new StorageError(StorageErrorCode.invalidConfig, {
            backend: StorageBackend.indexedDb,
            operation: StorageOperation.indexedDbSchema,
            cause: new TypeError('IndexedDB internal stores must use private keys')
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
    } catch (cause) {
      if (isStorageErrorFamily(cause)) throw cause
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: StorageBackend.indexedDb,
        operation: StorageOperation.indexedDbSchema,
        cause
      })
    }
  }

  /**
   * Layout/version conflicts are stable until an operator changes the database; other failures
   * retry.
   */
  const isTerminalPrepareFailure = (cause: unknown): boolean =>
    cause instanceof StorageError &&
    (cause.code === StorageErrorCode.invalidConfig ||
      cause.code === StorageErrorCode.versionUnsupported)

  const ensureStores = (
    database: IDBDatabase
  ): { readonly created: boolean; readonly recordsCreated: boolean } => {
    let created = false
    let recordsCreated = false
    if (!database.objectStoreNames.contains(kvStoreName)) {
      database.createObjectStore(kvStoreName)
      created = true
    }
    if (!database.objectStoreNames.contains(recordsStoreName)) {
      database.createObjectStore(recordsStoreName)
      created = true
      recordsCreated = true
    }
    if (!database.objectStoreNames.contains(bytesStoreName)) {
      database.createObjectStore(bytesStoreName)
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
    return { created, recordsCreated }
  }

  /** Copy the historical store in restartable read/write batches. */
  const migrateLegacyRecords = async (
    database: IDBDatabase,
    runtime: IStorageOperationRuntime,
    inheritedLease?: IMutationLeaseContext
  ): Promise<void> =>
    withInternalMutationLease(async () => {
      if (!database.objectStoreNames.contains(LEGACY_RECORDS_STORE_NAME)) return
      if (!database.objectStoreNames.contains(recordsStoreName)) return
      if (recordsStoreName === LEGACY_RECORDS_STORE_NAME) return
      const state = (await readFromMetadata(database, LEGACY_RECORDS_MIGRATION_KEY, runtime)) as
        | { status?: unknown; to?: unknown; lastKey?: IDBValidKey }
        | undefined
      if (state?.status === 'complete' && state.to === recordsStoreName) return
      let lastKey = state?.lastKey
      while (true) {
        const batch = await readLegacyBatch(database, lastKey)
        if (batch.length === 0) {
          await writeLegacyMigrationState(
            database,
            {
              status: StorageMigrationStatus.complete,
              from: LEGACY_RECORDS_STORE_NAME,
              to: recordsStoreName
            },
            runtime
          )
          return
        }
        const transaction = createTransaction(
          database,
          [
            LEGACY_RECORDS_STORE_NAME,
            recordsStoreName,
            REVISIONS_STORE_NAME,
            INDEX_RECORDS_STORE_NAME,
            META_STORE_NAME
          ],
          'readwrite'
        )
        const committed = idbTransactionCommit(transaction, undefined, runtime)
        void committed.catch(() => {})
        const source = transaction.objectStore(LEGACY_RECORDS_STORE_NAME)
        const target = transaction.objectStore(recordsStoreName)
        const revisions = transaction.objectStore(REVISIONS_STORE_NAME)
        const meta = transaction.objectStore(META_STORE_NAME)
        const sidecar = transaction.objectStore(INDEX_RECORDS_STORE_NAME)
        /**
         * SOL-SWV2-053: only the entries this batch actually copies (not skipped as pre-existing or
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
              revisions.get(recordRevisionKey(migratedKey)) as IDBRequest<number | undefined>,
              {},
              runtime
            )) as number | undefined
            revisions.put((revision ?? 0) + 1, recordRevisionKey(migratedKey))
            migratedKeys.push(migratedKey)
          }
          // Legacy keys cannot be projected by the canonical entity planner. Invalidate every
          // existing projection in this same transaction before publishing the migration checkpoint.
          if (migratedKeys.length > 0) {
            const authority = classifyLegacyMutationBatch(migratedKeys)
            await applyRawMutationFirewall(
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
              to: recordsStoreName,
              lastKey: batch[batch.length - 1]!.key
            },
            LEGACY_RECORDS_MIGRATION_KEY
          )
          await committed
          // SOL-SWV2-053: this backend's own record-mutating route, previously entirely silent —
          // a subscriber must learn that records materialized in the store it is watching, exactly
          // as any other route that commits records does.
          if (migratedKeys.length > 0)
            publishChange({ channel: 'record', kind: 'batch', keys: migratedKeys })
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
    }, inheritedLease)

  const readFromMetadata = async (
    database: IDBDatabase,
    key: IDBValidKey,
    runtime: IStorageOperationRuntime
  ): Promise<unknown | undefined> => {
    const transaction = createTransaction(database, META_STORE_NAME, 'readonly')
    return fromIdbRequest(transaction.objectStore(META_STORE_NAME).get(key), {}, runtime)
  }

  const writeLegacyMigrationState = async (
    database: IDBDatabase,
    state: unknown,
    runtime: IStorageOperationRuntime
  ): Promise<void> => {
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

  const readLegacyBatch = async (
    database: IDBDatabase,
    lastKey: IDBValidKey | undefined
  ): Promise<Array<{ readonly key: IDBValidKey; readonly value: unknown }>> => {
    if (lastKey !== undefined && !keyRange)
      throw new StorageError(StorageErrorCode.unavailable, {
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
        lastKey === undefined ? undefined : (keyRange?.lowerBound(lastKey, true) ?? undefined)
      request = store.openCursor(range)
    } catch (cause) {
      throw normalizeError(
        cause,
        StorageBackend.indexedDb,
        StorageErrorCode.transactionFailed,
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
         * Preserve the host failure while assigning this cursor boundary's operation metadata. Only
         * a web `StorageError` bridge wrapper is unwrapped; a contract error stays whole so
         * `normalizeError` lets it penetrate (rule §4.4).
         */
        const rootCause = cause instanceof StorageError ? (cause.cause ?? cause) : cause
        reject(
          normalizeError(
            rootCause,
            StorageBackend.indexedDb,
            StorageErrorCode.transactionFailed,
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
  const cleanupLegacyRecordStore = (
    database: IDBDatabase,
    transaction: IDBTransaction,
    onFailure: (cause: unknown) => void
  ): void => {
    if (!cleanupLegacyRecords || !database.objectStoreNames.contains(LEGACY_RECORDS_STORE_NAME))
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
          if (state?.status === 'complete' && state.to === recordsStoreName)
            database.deleteObjectStore(LEGACY_RECORDS_STORE_NAME)
        } catch (cause) {
          onFailure(cause)
        }
      },
      () => onFailure(readIdbRequestError(request))
    )
  }

  const openOnce = (version?: number): Promise<IDBDatabase> =>
    new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false
      let request: IDBOpenDBRequest
      /** Reject this open attempt once while preserving the owning operation metadata. */
      const rejectOpen = (cause: unknown): void => {
        if (settled) return
        settled = true
        /**
         * Remove an intermediate web bridge wrapper before assigning open semantics; a contract
         * error is never unwrapped so `normalizeError` lets it penetrate (rule §4.4).
         */
        const rootCause = cause instanceof StorageError ? (cause.cause ?? cause) : cause
        reject(
          normalizeError(
            rootCause,
            StorageBackend.indexedDb,
            StorageErrorCode.unavailable,
            StorageOperation.indexedDbOpen
          )
        )
      }
      try {
        request = version === undefined ? factory.open(dbName) : factory.open(dbName, version)
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
                throw new Error('IndexedDB upgrade event is missing its transaction')
              ensureStores(database)
              cleanupLegacyRecordStore(database, transaction, failUpgrade)
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
            rejectOpen(cause ?? new Error('[storage-web] IndexedDB open failed'))
          }
        )
      } catch (cause) {
        failUpgrade(cause)
      }
    })

  const open = (
    runtime: IStorageOperationRuntime,
    inheritedLease?: IMutationLeaseContext
  ): Promise<IDBDatabase> => {
    if (prepareState === 'disposed') {
      return Promise.reject(
        new StorageContractError(StorageContractErrorCode.disposed, {
          backend: StorageBackend.indexedDb
        })
      )
    }
    if (prepareState === 'terminal') return Promise.reject(terminalPrepareFailure)
    if (connection !== undefined) return connection
    prepareState = 'running'
    connection = withInternalMutationLease(async (lease) => {
      const recoveryDatabase = activeDatabase
      if (recoveryDatabase) closeForTransition(recoveryDatabase)
      // 不写死版本号：同一个 dbName 可能已被别处用别的 storeName 建过，
      // 硬开 version 1 不会触发 upgrade，之后 transaction(storeName) 直接
      // 抛 NotFoundError。先按当前版本开，缺 store 再升一版补建。
      let database = await openOnce()
      const attachConnectionHandlers = (connected: IDBDatabase): void => {
        try {
          // 别的标签页要升级时必须让路，否则对方会一直 blocked。
          connected.onversionchange = () => {
            try {
              connected.close()
            } catch {
              /* Host close failures must not retain a stale connection cache. */
            } finally {
              if (activeDatabase === connected) {
                activeDatabase = undefined
                connection = undefined
                if (prepareState === 'ready') prepareState = 'idle'
              }
            }
          }
          connected.onclose = () => {
            // A stale close event from an older connection must not evict a newer cache entry.
            if (activeDatabase === connected) {
              activeDatabase = undefined
              connection = undefined
              if (prepareState === 'ready') prepareState = 'idle'
            }
          }
          activeDatabase = connected
        } catch (cause) {
          throw normalizeError(
            cause,
            StorageBackend.indexedDb,
            StorageErrorCode.unavailable,
            StorageOperation.indexedDbOpen
          )
        }
      }
      try {
        if (
          !database.objectStoreNames.contains(kvStoreName) ||
          !database.objectStoreNames.contains(recordsStoreName) ||
          !database.objectStoreNames.contains(bytesStoreName) ||
          !database.objectStoreNames.contains(REVISIONS_STORE_NAME) ||
          !database.objectStoreNames.contains(META_STORE_NAME) ||
          !database.objectStoreNames.contains(INDEX_RECORDS_STORE_NAME)
        ) {
          const nextVersion = database.version + 1
          closeForTransition(database)
          database = await openOnce(nextVersion)
        }
        attachConnectionHandlers(database)
        validatePhysicalLayout(database)
        await ensureMeta(database, runtime)
        await migrateLegacyRecords(database, runtime, lease)
        if (cleanupLegacyRecords && database.objectStoreNames.contains(LEGACY_RECORDS_STORE_NAME)) {
          const nextVersion = database.version + 1
          closeForTransition(database)
          database = await openOnce(nextVersion)
          attachConnectionHandlers(database)
        }
        return database
      } catch (cause) {
        const closeCause = tryCloseDatabase(database)
        if (closeCause !== undefined) activeDatabase = database
        else if (activeDatabase === database) activeDatabase = undefined
        throw isStorageErrorFamily(cause)
          ? cause
          : normalizeError(
              cause,
              StorageBackend.indexedDb,
              StorageErrorCode.unavailable,
              StorageOperation.indexedDbOpen
            )
      }
    }, inheritedLease)
      .then((database) => {
        if (prepareState !== 'disposed') prepareState = 'ready'
        return database
      })
      .catch((error: unknown) => {
        connection = undefined
        if (prepareState === 'disposed') throw error
        if (isTerminalPrepareFailure(error)) {
          prepareState = 'terminal'
          terminalPrepareFailure = error
        } else prepareState = 'idle'
        throw error
      })
    return connection
  }

  const createTransaction = (
    database: IDBDatabase,
    stores: string | string[],
    mode: IDBTransactionMode
  ): IDBTransaction => {
    try {
      return database.transaction(stores, mode)
    } catch (cause) {
      throw normalizeError(
        cause,
        StorageBackend.indexedDb,
        StorageErrorCode.transactionFailed,
        StorageOperation.indexedDbTransaction
      )
    }
  }

  /** Persist the schema checkpoint so future upgrades can distinguish initialized v2 stores. */
  const ensureMeta = async (
    database: IDBDatabase,
    runtime: IStorageOperationRuntime
  ): Promise<void> => {
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
        throw new StorageError(StorageErrorCode.versionUnsupported, {
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

  const readFrom = async <T>(
    storeName: string,
    run: (store: IDBObjectStore) => IDBRequest<T>,
    signal: AbortSignal | undefined,
    runtime: IStorageOperationRuntime
  ): Promise<T> => {
    const database = await open(runtime)
    assertLive()
    const transaction = createTransaction(database, storeName, 'readonly')
    const committed = idbTransactionCommit(transaction, { signal }, runtime)
    void committed.catch(() => {})
    try {
      const request = fromIdbRequest(run(transaction.objectStore(storeName)), { signal }, runtime)
      const [value] = await Promise.all([request, committed])
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
        StorageErrorCode.transactionFailed,
        StorageOperation.indexedDbRead
      )
    }
  }

  /** 写入等事务 commit，而不是等单条请求 success。 */
  const writeTo = async (
    storeName: string,
    run: (store: IDBObjectStore) => unknown,
    signal: AbortSignal | undefined,
    runtime: IStorageOperationRuntime,
    inheritedLease?: IMutationLeaseContext
  ): Promise<void> => {
    const database = await open(runtime, inheritedLease)
    assertLive()
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
      throw new StorageError(StorageErrorCode.transactionFailed, {
        backend: StorageBackend.indexedDb,
        cause
      })
    }
    await committed
  }

  const writeWithConflict = async (
    channel: 'value' | 'bytes' | 'record',
    key: IStorageKey,
    value: unknown,
    signal: AbortSignal | undefined,
    policy: (typeof StorageConflictPolicy)[keyof typeof StorageConflictPolicy] = StorageConflictPolicy.conflict,
    runtime: IStorageOperationRuntime,
    inheritedLease?: IMutationLeaseContext
  ): Promise<void> => {
    const valueSnapshot = channel === StorageChannel.value ? value : snapshotWriteValue(value, key)
    const database = await open(runtime, inheritedLease)
    // A top-level lease admits the complete operation before disposal starts.
    // Rechecking global liveness after asynchronous preparation would reject
    // that admitted write while dispose is correctly waiting for its lease.
    if (inheritedLease === undefined) assertLive()
    const transaction = createTransaction(
      database,
      [
        kvStoreName,
        bytesStoreName,
        recordsStoreName,
        REVISIONS_STORE_NAME,
        INDEX_RECORDS_STORE_NAME,
        META_STORE_NAME
      ],
      'readwrite'
    )
    const committed = idbTransactionCommit(transaction, { signal }, runtime)
    void committed.catch(() => {})
    try {
      const stringKey = typeof key === 'string' ? key : undefined
      const kvRequest =
        stringKey === undefined ? undefined : transaction.objectStore(kvStoreName).get(stringKey)
      const bytesRequest =
        stringKey === undefined ? undefined : transaction.objectStore(bytesStoreName).get(stringKey)
      const recordRequest = transaction.objectStore(recordsStoreName).getKey(toIdbKey(key))
      const [kvExisting, bytesExisting, recordExisting] = await Promise.all([
        kvRequest ? fromIdbRequest(kvRequest, { signal }, runtime) : Promise.resolve(undefined),
        bytesRequest
          ? fromIdbRequest(bytesRequest, { signal }, runtime)
          : Promise.resolve(undefined),
        fromIdbRequest(recordRequest, { signal }, runtime)
      ])
      const existing = new Set<'value' | 'bytes' | 'record'>()
      if (kvExisting !== undefined) existing.add('value')
      if (bytesExisting !== undefined) existing.add('bytes')
      if (recordExisting !== undefined) existing.add('record')
      const plan = planChannelWrite(key, channel, existing, policy, StorageBackend.indexedDb)
      for (const removal of plan.remove) {
        if (removal === StorageChannel.value && stringKey !== undefined)
          transaction.objectStore(kvStoreName).delete(stringKey)
        if (removal === StorageChannel.bytes && stringKey !== undefined)
          transaction.objectStore(bytesStoreName).delete(stringKey)
        if (removal === 'record') transaction.objectStore(recordsStoreName).delete(toIdbKey(key))
      }
      const target =
        channel === StorageChannel.value
          ? kvStoreName
          : channel === StorageChannel.bytes
            ? bytesStoreName
            : recordsStoreName
      const targetKey = channel === 'record' ? toIdbKey(key) : (key as string)
      transaction.objectStore(target).put(valueSnapshot, targetKey)
      if (channel === 'record') {
        const revisionStore = transaction.objectStore(REVISIONS_STORE_NAME)
        const revision = await fromIdbRequest(
          revisionStore.get(recordRevisionKey(key)) as IDBRequest<number | undefined>,
          { signal },
          runtime
        )
        revisionStore.put((revision ?? 0) + 1, recordRevisionKey(key))
      }
      if (plan.remove.includes('record') && channel !== 'record') {
        const revisionStore = transaction.objectStore(REVISIONS_STORE_NAME)
        const encoded = recordRevisionKey(key)
        const revision = await fromIdbRequest(
          revisionStore.get(encoded) as IDBRequest<number | undefined>,
          { signal },
          runtime
        )
        revisionStore.put((revision ?? 0) + 1, encoded)
      }
      if (channel === 'record' || plan.remove.includes('record')) {
        const revisionStore = transaction.objectStore(REVISIONS_STORE_NAME)
        const epoch = await fromIdbRequest(
          revisionStore.get(RECORD_EPOCH_KEY) as IDBRequest<number | undefined>,
          { signal },
          runtime
        )
        revisionStore.put((epoch ?? 0) + 1, RECORD_EPOCH_KEY)
        // SWV2-D27 raw-record firewall: this write staged, replaced, or removed a `record` entry
        // outside the entity repository's planner, so any index built over it may now be wrong.
        await applyRawMutationFirewall(
          transaction.objectStore(META_STORE_NAME),
          revisionStore,
          transaction.objectStore(INDEX_RECORDS_STORE_NAME),
          key,
          signal,
          runtime
        )
      }
      await committed
      // SWV2-B05: only after the IDBTransaction has actually committed — an aborted/rolled-back
      // transaction (the `catch` below) must fire nothing.
      publishChange({ channel, kind: 'put', keys: [key] })
      // SOL-SWV2-050/055: a `conflictPolicy:'replace'` write can silently evict whatever other
      // channel already held this key — that eviction is itself a real mutation on its own
      // channel and must publish its own `remove`, mirroring the memory backend's
      // `checkCrossChannel`. Only the evicted channel's own event fires here; the attempted
      // channel's `put` above already covers the write itself.
      if (plan.remove.includes('value') && channel !== 'value')
        publishChange({ channel: 'value', kind: 'remove', keys: [key] })
      if (plan.remove.includes('bytes') && channel !== 'bytes')
        publishChange({ channel: 'bytes', kind: 'remove', keys: [key] })
      if (plan.remove.includes('record') && channel !== 'record')
        publishChange({ channel: 'record', kind: 'remove', keys: [key] })
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

  const runTransaction = async <T>(
    run: (tx: ITransactionScope<TValue>) => Promise<T>,
    signal: AbortSignal | undefined,
    runtime: IStorageOperationRuntime,
    context?: { readonly timeoutMs?: number },
    inheritedLease?: IMutationLeaseContext
  ): Promise<T> => {
    const database = await open(runtime, inheritedLease)
    /** Scope remains usable only while the transaction callback is pending. */
    let scopeActive = true
    const tombstone = Symbol('indexeddb-transaction-tombstone')
    const draft = new Map<
      string,
      [IStorageKey, TValue, 'conflict' | 'replace'] | [IStorageKey, typeof tombstone]
    >()
    const readRevisions = new Map<
      string,
      { readonly key: IStorageKey; readonly revision: number }
    >()
    const readSnapshots = new Map<string, TValue | undefined>()
    let snapshotEpoch: number | undefined
    const readRevision = async (key: IStorageKey): Promise<void> => {
      const encoded = encodeFlatStorageKey(key)
      if (readRevisions.has(encoded)) return
      const revisionTx = createTransaction(
        database,
        [REVISIONS_STORE_NAME, recordsStoreName],
        'readonly'
      )
      const epoch = await fromIdbRequest(
        revisionTx.objectStore(REVISIONS_STORE_NAME).get(RECORD_EPOCH_KEY) as IDBRequest<
          number | undefined
        >,
        { signal },
        runtime
      )
      const revision = await fromIdbRequest(
        revisionTx.objectStore(REVISIONS_STORE_NAME).get(recordRevisionKey(key)) as IDBRequest<
          number | undefined
        >,
        { signal },
        runtime
      )
      const value = await fromIdbRequest(
        revisionTx.objectStore(recordsStoreName).get(toIdbKey(key)) as IDBRequest<
          TValue | undefined
        >,
        { signal },
        runtime
      )
      if (snapshotEpoch === undefined) {
        snapshotEpoch = epoch ?? 0
      }
      readRevisions.set(encoded, { key, revision: revision ?? 0 })
      readSnapshots.set(encoded, value === undefined ? undefined : structuredClone(value))
    }
    const scope: ITransactionScope<TValue> = {
      get: async (key) => {
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb)
        const keySnapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
        await readRevision(keySnapshot)
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb)
        const entry = draft.get(encodeFlatStorageKey(keySnapshot))
        if (entry !== undefined && entry.length === 2 && entry[1] === tombstone) return undefined
        if (entry !== undefined) return structuredClone(entry[1] as TValue)
        const snapshot = readSnapshots.get(encodeFlatStorageKey(keySnapshot))
        return snapshot === undefined ? undefined : structuredClone(snapshot)
      },
      put: async (value, key, options) => {
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb)
        const conflictPolicy = readTransactionConflictPolicy(options, StorageBackend.indexedDb)
        const resolvedKey = key ?? createStorageToken()
        const keySnapshot = snapshotStorageKey(resolvedKey, StorageBackend.indexedDb)
        const valueSnapshot = snapshotWriteValue(value, keySnapshot)
        await readRevision(keySnapshot)
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb)
        draft.set(encodeFlatStorageKey(keySnapshot), [keySnapshot, valueSnapshot, conflictPolicy])
        return resolvedKey
      },
      delete: async (key) => {
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb)
        const keySnapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
        await readRevision(keySnapshot)
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb)
        draft.set(encodeFlatStorageKey(keySnapshot), [keySnapshot, tombstone])
      }
    }
    let result: T
    try {
      result = await withTimeout(() => run(scope), {
        timeoutMs: context?.timeoutMs ?? TRANSACTION_CALLBACK_DEADLINE_MS,
        signal,
        report: runtime.reporter
      })
    } catch (error) {
      throw normalizeTransactionCallbackError(error)
    } finally {
      scopeActive = false
    }
    throwIfAborted(signal)
    assertLive()
    throwIfAborted(signal)
    const idbTx = createTransaction(
      database,
      [
        kvStoreName,
        bytesStoreName,
        recordsStoreName,
        REVISIONS_STORE_NAME,
        INDEX_RECORDS_STORE_NAME,
        META_STORE_NAME
      ],
      'readwrite'
    )
    const committed = idbTransactionCommit(idbTx, { signal }, runtime)
    void committed.catch(() => {})
    const revisionStore = idbTx.objectStore(REVISIONS_STORE_NAME)
    const currentEpoch =
      (await fromIdbRequest(
        revisionStore.get(RECORD_EPOCH_KEY) as IDBRequest<number | undefined>,
        {
          signal
        },
        runtime
      )) ?? 0
    if (snapshotEpoch !== undefined && currentEpoch !== snapshotEpoch) {
      idbTx.abort()
      await committed.catch(() => {})
      throw new StorageError(StorageErrorCode.transactionConflict, {
        backend: StorageBackend.indexedDb,
        operation: StorageOperation.transactionCommit,
        cause: new Error('record epoch changed')
      })
    }
    for (const { key, revision: expected } of readRevisions.values()) {
      const actual =
        (await fromIdbRequest(
          revisionStore.get(recordRevisionKey(key)) as IDBRequest<number | undefined>,
          {
            signal
          },
          runtime
        )) ?? 0
      if (actual !== expected) {
        idbTx.abort()
        await committed.catch(() => {})
        throw new StorageError(StorageErrorCode.transactionConflict, {
          backend: StorageBackend.indexedDb,
          operation: StorageOperation.transactionCommit,
          cause: new Error(`record revision changed from ${expected} to ${actual}`)
        })
      }
    }
    let recordMutation = false
    const committedTransactionKeys: IStorageKey[] = []
    for (const entry of draft.values()) {
      if (entry.length === 2 && entry[1] === tombstone) {
        const key = entry[0] as IStorageKey
        recordMutation = true
        committedTransactionKeys.push(key)
        idbTx.objectStore(recordsStoreName).delete(toIdbKey(key))
        const current =
          (await fromIdbRequest(
            revisionStore.get(recordRevisionKey(key)) as IDBRequest<number | undefined>,
            {
              signal
            },
            runtime
          )) ?? 0
        revisionStore.put(current + 1, recordRevisionKey(key))
        continue
      }
      const [key, value, policy] = entry
      recordMutation = true
      committedTransactionKeys.push(key)
      const stringKey = typeof key === 'string' ? key : undefined
      const kvExisting = stringKey
        ? await fromIdbRequest(idbTx.objectStore(kvStoreName).get(stringKey), { signal }, runtime)
        : undefined
      const bytesExisting = stringKey
        ? await fromIdbRequest(
            idbTx.objectStore(bytesStoreName).get(stringKey),
            { signal },
            runtime
          )
        : undefined
      const conflict =
        (kvExisting !== undefined && 'value') || (bytesExisting !== undefined && 'bytes')
      if (conflict && policy !== 'replace') {
        idbTx.abort()
        await committed.catch(() => {})
        throw new StorageError(StorageErrorCode.duplicateKey, {
          backend: StorageBackend.indexedDb,
          key,
          existingChannel: conflict,
          attemptedChannel: 'record'
        })
      }
      if (policy === 'replace' && stringKey !== undefined) {
        idbTx.objectStore(kvStoreName).delete(stringKey)
        idbTx.objectStore(bytesStoreName).delete(stringKey)
      }
      idbTx.objectStore(recordsStoreName).put(value, toIdbKey(key))
      const current =
        (await fromIdbRequest(
          revisionStore.get(recordRevisionKey(key)) as IDBRequest<number | undefined>,
          {
            signal
          },
          runtime
        )) ?? 0
      revisionStore.put(current + 1, recordRevisionKey(key))
    }
    if (recordMutation) {
      const metaStore = idbTx.objectStore(META_STORE_NAME)
      const sidecarStore = idbTx.objectStore(INDEX_RECORDS_STORE_NAME)
      for (const key of committedTransactionKeys)
        await applyRawMutationFirewall(metaStore, revisionStore, sidecarStore, key, signal, runtime)
      revisionStore.put(currentEpoch + 1, RECORD_EPOCH_KEY)
    }
    await committed
    // SOL-SWV2-050: mirrors the memory backend's `runTransaction` — the whole batch fanouts as
    // one `kind:'batch'` event after every entry above committed, never per key, and only when
    // reached at all (rollback via any `throw` above ⇒ no event; a read-only transaction with
    // `recordMutation` still `false` has nothing to report).
    if (recordMutation)
      publishChange({ channel: 'record', kind: 'batch', keys: committedTransactionKeys })
    return result
  }

  type IIndexedMutation =
    | { readonly kind: 'delete'; readonly key: IStorageKey }
    | {
        readonly kind: 'put'
        readonly key: IStorageKey
        readonly value: TValue
        readonly projection: IRecordIndexProjection
      }

  /** Stage asynchronous indexed work, then atomically validate and commit records and sidecars. */
  const runIndexedTransaction = async <T>(
    handle: IRecordIndexHandle,
    run: (tx: ISecondaryIndexTransactionScope<TValue>) => Promise<T>,
    signal: AbortSignal | undefined,
    runtime: IStorageOperationRuntime,
    context?: { readonly timeoutMs?: number },
    inheritedLease?: IMutationLeaseContext
  ): Promise<T> => {
    assertLive()
    if (!isValidIndexGeneration(handle.generation)) throw staleIndexHandleError()
    assertTransactionCallback(run, StorageBackend.indexedDb)
    const database = await open(runtime, inheritedLease)
    /** Staged final mutation per canonical record key. */
    const mutations = new Map<string, IIndexedMutation>()
    /** Optimistic revisions and value snapshots observed by the callback. */
    const reads = new Map<
      string,
      { readonly key: IStorageKey; readonly revision: number; readonly value: TValue | undefined }
    >()
    let scopeActive = true
    const read = async (
      key: IStorageKey
    ): Promise<typeof reads extends Map<string, infer V> ? V : never> => {
      const identity = encodeFlatStorageKey(key)
      const existing = reads.get(identity)
      if (existing !== undefined) return existing
      const transaction = createTransaction(
        database,
        [recordsStoreName, REVISIONS_STORE_NAME],
        'readonly'
      )
      const revision =
        ((await fromIdbRequest(
          transaction.objectStore(REVISIONS_STORE_NAME).get(recordRevisionKey(key)) as IDBRequest<
            number | undefined
          >,
          { signal },
          runtime
        )) as number | undefined) ?? 0
      const value = (await fromIdbRequest(
        transaction.objectStore(recordsStoreName).get(toIdbKey(key)) as IDBRequest<
          TValue | undefined
        >,
        { signal },
        runtime
      )) as TValue | undefined
      const snapshot = {
        key,
        revision,
        value: value === undefined ? undefined : snapshotWriteValue(value, key)
      }
      reads.set(identity, snapshot)
      return snapshot
    }
    const scope: ISecondaryIndexTransactionScope<TValue> = {
      get: async (key) => {
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb)
        const keySnapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
        const mutation = mutations.get(encodeFlatStorageKey(keySnapshot))
        if (mutation?.kind === 'delete') return undefined
        if (mutation?.kind === 'put') return snapshotWriteValue(mutation.value, keySnapshot)
        const snapshot = await read(keySnapshot)
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb)
        return snapshot.value
      },
      put: async (value, key, projection) => {
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb)
        const keySnapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
        await read(keySnapshot)
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb)
        mutations.set(encodeFlatStorageKey(keySnapshot), {
          kind: 'put',
          key: keySnapshot,
          value: snapshotWriteValue(value, keySnapshot),
          projection
        })
        return keySnapshot
      },
      delete: async (key) => {
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb)
        const keySnapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
        await read(keySnapshot)
        assertTransactionScopeActive(scopeActive, StorageBackend.indexedDb)
        mutations.set(encodeFlatStorageKey(keySnapshot), { kind: 'delete', key: keySnapshot })
      }
    }
    let result: T
    try {
      result = await withTimeout(() => run(scope), {
        timeoutMs: context?.timeoutMs ?? TRANSACTION_CALLBACK_DEADLINE_MS,
        signal,
        report: runtime.reporter
      })
    } catch (cause) {
      throw normalizeTransactionCallbackError(cause)
    } finally {
      scopeActive = false
    }
    throwIfAborted(signal)
    const transaction = createTransaction(
      database,
      [recordsStoreName, INDEX_RECORDS_STORE_NAME, REVISIONS_STORE_NAME, META_STORE_NAME],
      'readwrite'
    )
    const committed = idbTransactionCommit(transaction, { signal }, runtime)
    void committed.catch(() => {})
    try {
      const metadata = transaction.objectStore(META_STORE_NAME)
      const state = (await fromIdbRequest(
        metadata.get(indexMetadataKey(handle.scope)),
        { signal },
        runtime
      )) as { handle?: IRecordIndexHandle } | undefined
      if (
        state?.handle?.generation !== handle.generation ||
        state.handle.fingerprint !== handle.fingerprint
      )
        throw staleIndexHandleError()
      const definitions = JSON.parse(handle.fingerprint) as IRecordIndexDefinition[]
      const definitionsByName = new Map(
        definitions.map((definition) => [definition.name, definition])
      )
      const uniqueOwners = new Map<
        string,
        { readonly indexName: string; readonly indexValue: IStorageKey; readonly owner: string }
      >()
      for (const mutation of mutations.values()) {
        if (mutation.kind !== 'put') continue
        for (const [indexName, entry] of Object.entries(mutation.projection)) {
          const definition = definitionsByName.get(indexName)
          if (definition === undefined)
            throw new StorageError(StorageErrorCode.invalidConfig, {
              backend: StorageBackend.indexedDb
            })
          if (!definition.unique || entry === undefined) continue
          const values = entry.kind === 'multiple' ? entry.keys : [entry.key]
          for (const indexValue of values) {
            const identity = JSON.stringify([indexName, encodeFlatStorageKey(indexValue)])
            const recordIdentity = encodeFlatStorageKey(mutation.key)
            const existingOwner = uniqueOwners.get(identity)
            if (existingOwner !== undefined && existingOwner.owner !== recordIdentity)
              throw new StorageError(
                StorageErrorCode.indexUniqueConflict,
                { backend: StorageBackend.indexedDb, key: mutation.key },
                indexUniqueConflictText(indexName)
              )
            uniqueOwners.set(identity, {
              indexName,
              indexValue,
              owner: recordIdentity
            })
          }
        }
      }
      const sidecar = transaction.objectStore(INDEX_RECORDS_STORE_NAME)
      const draftedRecords = new Set(mutations.keys())
      for (const { indexName, indexValue, owner } of uniqueOwners.values()) {
        const lookupKey = [handle.scope, indexName, handle.generation, toIdbKey(indexValue)]
        const existing = await fromIdbRequest(
          sidecar.index('lookup').getAllKeys(keyRange?.bound(lookupKey, lookupKey)),
          { signal },
          runtime
        )
        if (
          existing.some((key) => {
            const recordIdentity = encodeFlatStorageKey((key as IDBValidKey[])[4] as IStorageKey)
            return recordIdentity !== owner && !draftedRecords.has(recordIdentity)
          })
        )
          throw new StorageError(
            StorageErrorCode.indexUniqueConflict,
            { backend: StorageBackend.indexedDb },
            indexUniqueConflictText(indexName)
          )
      }
      const revisions = transaction.objectStore(REVISIONS_STORE_NAME)
      for (const snapshot of reads.values()) {
        const actual =
          ((await fromIdbRequest(
            revisions.get(recordRevisionKey(snapshot.key)) as IDBRequest<number | undefined>,
            { signal },
            runtime
          )) as number | undefined) ?? 0
        if (actual !== snapshot.revision)
          throw new StorageError(StorageErrorCode.transactionConflict, {
            backend: StorageBackend.indexedDb
          })
      }
      for (const mutation of mutations.values()) {
        const oldRows = await fromIdbRequest(
          sidecar
            .index('record')
            .getAllKeys([handle.scope, handle.generation, toIdbKey(mutation.key)]),
          { signal },
          runtime
        )
        for (const oldRow of oldRows) sidecar.delete(oldRow)
        if (mutation.kind === 'delete')
          transaction.objectStore(recordsStoreName).delete(toIdbKey(mutation.key))
        else {
          transaction
            .objectStore(recordsStoreName)
            .put(snapshotWriteValue(mutation.value, mutation.key), toIdbKey(mutation.key))
          for (const [indexName, entry] of Object.entries(mutation.projection)) {
            if (entry === undefined) continue
            const values = entry.kind === 'multiple' ? entry.keys : [entry.key]
            for (const indexValue of values)
              sidecar.put({
                scope: handle.scope,
                generation: handle.generation,
                indexName,
                indexValue: toIdbKey(indexValue),
                recordKey: toIdbKey(mutation.key)
              })
          }
        }
        const previous = reads.get(encodeFlatStorageKey(mutation.key))?.revision ?? 0
        revisions.put(previous + 1, recordRevisionKey(mutation.key))
      }
      if (mutations.size > 0) {
        const scopeEpoch =
          ((await fromIdbRequest(
            revisions.get(indexScopeEpochKey(handle.scope)) as IDBRequest<number | undefined>,
            { signal },
            runtime
          )) as number | undefined) ?? 0
        revisions.put(scopeEpoch + 1, indexScopeEpochKey(handle.scope))
      }
      await committed
      // SOL-SWV2-050 (planner half): the last unwired record-mutating route. Same "batch
      // one-event, only for what actually committed" contract as `transaction()` and the memory
      // backend — one `record:batch` for every record this call put/deleted, published only
      // after the owning `IDBTransaction` has actually committed, never on the `catch` below.
      if (mutations.size > 0)
        publishChange({
          channel: 'record',
          kind: 'batch',
          keys: [...mutations.values()].map((mutation) => mutation.key)
        })
      return result
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

  const store: IRecordStore<TValue> &
    ISecondaryIndexRecordStore<TValue> &
    IChangeFeedStore &
    Record<PropertyKey, unknown> = {
    backend: StorageBackend.indexedDb,
    capabilities,
    ensureRecordIndexes,
    getRecordIndexReadiness: (handle: IRecordIndexHandle, ctx?: IOperationContext) =>
      withAbort(ctx, async (_signal, _context, runtime) => {
        if (!isValidIndexGeneration(handle.generation)) throw staleIndexHandleError()
        const database = await open(runtime)
        const transaction = createTransaction(database, META_STORE_NAME, 'readonly')
        const state = (await fromIdbRequest(
          transaction.objectStore(META_STORE_NAME).get(indexMetadataKey(handle.scope)),
          {},
          runtime
        )) as { handle?: IRecordIndexHandle; readiness?: IRecordIndexReadiness } | undefined
        if (state?.handle?.generation !== handle.generation) throw staleIndexHandleError()
        return state.readiness ?? { status: 'pending', scanned: 0, indexed: 0 }
      }),
    putIndexedRecord: (
      value: TValue,
      key: IStorageKey,
      handle: IRecordIndexHandle,
      projection: IRecordIndexProjection,
      ctx?: IWriteOptions
    ) =>
      withMutationLease((lease) =>
        withAbort(ctx, (signal, _context, runtime) =>
          runIndexedTransaction(
            handle,
            async (transaction) => transaction.put(value, key, projection),
            signal,
            runtime,
            undefined,
            lease
          )
        )
      ),
    iterateRecordIndex: async function* (query: IRecordIndexQuery, _ctx?: IOperationContext) {
      assertLive()
      if (!isValidIndexGeneration(query.handle.generation)) throw staleIndexHandleError()
      const operation = snapshotOperationContext(_ctx)
      const signal = operation?.signal
      throwIfAborted(signal)
      if (!keyRange)
        throw new StorageError(StorageErrorCode.unavailable, {
          backend: StorageBackend.indexedDb,
          cause: new Error('IDBKeyRange is unavailable; pass options.keyRange explicitly')
        })
      const range = snapshotKeyRange(query.range, StorageBackend.indexedDb)
      const direction: IDBCursorDirection = query.direction === 'prev' ? 'prev' : 'next'
      const prefix: IDBValidKey[] = [query.handle.scope, query.index, query.handle.generation]
      /** Bounded per short readonly transaction; keeps SWV2-D26 pages small and predictable. */
      const pageSize = INDEX_QUERY_PAGE_SIZE
      /**
       * `{global, scope}` mutation-epoch vector observed on the first page; every later page must
       * match.
       */
      let expectedEpoch: { readonly global: number; readonly scope: number } | undefined
      /**
       * Full sidecar primary key ([scope, indexName, generation, indexValue, recordKey]) of the
       * last cursor position visited. The `lookup` index key alone ([scope, indexName, generation,
       * indexValue]) is not unique when an index value is shared by multiple records, so a page
       * boundary falling inside such a tied group must resume by primary key, not by index key: the
       * next page's range is bounded _inclusively_ at the boundary group's index key (so remaining
       * ties are not dropped), and every cursor entry already emitted is then skipped by comparing
       * full primary keys until this position is passed.
       */
      let continuation: IDBValidKey[] | undefined
      let emitted = 0
      let exhausted = false
      while (!exhausted) {
        assertLive()
        throwIfAborted(signal)
        if (query.limit !== undefined && emitted >= query.limit) break
        const runtime = createStorageOperationRuntime()
        const database = await open(runtime)
        const transaction = createTransaction(
          database,
          [recordsStoreName, INDEX_RECORDS_STORE_NAME, META_STORE_NAME, REVISIONS_STORE_NAME],
          'readonly'
        )
        const committed = idbTransactionCommit(transaction, { signal }, runtime)
        void committed.catch(() => {})
        const page: Array<[IStorageKey, TValue]> = []
        let cursorExhausted = true
        try {
          const revisionsStore = transaction.objectStore(REVISIONS_STORE_NAME)
          const globalEpoch =
            ((await fromIdbRequest(
              revisionsStore.get(RECORD_EPOCH_KEY) as IDBRequest<number | undefined>,
              { signal },
              runtime
            )) as number | undefined) ?? 0
          const scopeEpoch =
            ((await fromIdbRequest(
              revisionsStore.get(indexScopeEpochKey(query.handle.scope)) as IDBRequest<
                number | undefined
              >,
              { signal },
              runtime
            )) as number | undefined) ?? 0
          if (expectedEpoch === undefined)
            expectedEpoch = { global: globalEpoch, scope: scopeEpoch }
          else if (expectedEpoch.global !== globalEpoch || expectedEpoch.scope !== scopeEpoch)
            throw new StorageError(
              StorageErrorCode.indexQueryInvalidated,
              { backend: StorageBackend.indexedDb },
              StorageErrorText.indexQueryInvalidated
            )
          const state = (await fromIdbRequest(
            transaction.objectStore(META_STORE_NAME).get(indexMetadataKey(query.handle.scope)),
            { signal },
            runtime
          )) as { handle?: IRecordIndexHandle; readiness?: IRecordIndexReadiness } | undefined
          if (state?.handle?.generation !== query.handle.generation) throw staleIndexHandleError()
          if (state.readiness?.status !== 'complete')
            throw new StorageError(StorageErrorCode.unavailable, {
              backend: StorageBackend.indexedDb,
              cause: new Error('record index is not complete; caller must use fallback scan')
            })
          const index = transaction.objectStore(INDEX_RECORDS_STORE_NAME).index('lookup')
          /**
           * The boundary group's index key ([scope, indexName, generation, indexValue]) is bound
           * inclusively so records tied with the last-visited entry are not dropped;
           * already-visited ties are skipped below by comparing full primary keys.
           */
          const continuationIndexKey = continuation?.slice(0, 4)
          const cursorRange = toIdbRecordIndexRange(
            range,
            prefix,
            keyRange,
            direction,
            continuation
          )
          const cursorRequest = index.openKeyCursor(cursorRange, direction)
          let cursor = (await fromIdbRequest(
            cursorRequest,
            { signal },
            runtime
          )) as IDBCursor | null
          if (cursor !== null && continuation !== undefined && continuationIndexKey !== undefined) {
            /**
             * The inclusive range may land the fresh cursor before, exactly at, or already past the
             * last-visited entry, and each case needs different handling: `continuePrimaryKey`
             * throws `DataError` if asked to move to a position at-or-before the cursor's _current_
             * one (per spec, even requesting the cursor's own exact position is rejected), so an
             * exact match must use a plain single-step `continue()` instead, and an already-past
             * position needs no skip at all. When the cursor is still strictly before the previous
             * continuation (earlier not-yet-skipped ties in the same index-key group),
             * `continuePrimaryKey` jumps straight past it in one engine-side seek. Either branch is
             * O(1) regardless of tie-group size, unlike a JS walk over every already-emitted tied
             * entry, which would be `Θ(G)` per page and quadratic across a group spanning multiple
             * pages (SWV2-D26/§4.8 require `O(pageSize)` per page; SWV2-SEC06 resource
             * exhaustion).
             */
            const currentPrimaryKey = cursor.primaryKey as IDBValidKey[]
            const comparison = compareStorageKeys(
              currentPrimaryKey as unknown as IStorageKey,
              continuation as unknown as IStorageKey
            )
            const isBeforeContinuation = direction === 'prev' ? comparison > 0 : comparison < 0
            if (isBeforeContinuation) {
              /**
               * `continuePrimaryKey` finds the first record whose (index key, primary key) is
               * _inclusive_ of the given pair — it may land exactly back on `continuation` itself
               * if that sidecar row still exists, not strictly past it. The single `.continue()`
               * correction below then steps past it deterministically.
               */
              cursor.continuePrimaryKey(
                continuationIndexKey,
                continuation as unknown as IDBValidKey
              )
              cursor = (await fromIdbRequest(
                cursorRequest,
                { signal },
                runtime
              )) as IDBCursor | null
            }
            if (cursor !== null) {
              const landedPrimaryKey = cursor.primaryKey as IDBValidKey[]
              const stillAtContinuation =
                compareStorageKeys(
                  landedPrimaryKey as unknown as IStorageKey,
                  continuation as unknown as IStorageKey
                ) === 0
              if (stillAtContinuation) {
                cursor.continue()
                cursor = (await fromIdbRequest(
                  cursorRequest,
                  { signal },
                  runtime
                )) as IDBCursor | null
              }
            }
          }
          let scannedInPage = 0
          while (cursor !== null && scannedInPage < pageSize) {
            assertLive()
            throwIfAborted(signal)
            scannedInPage += 1
            const lookupKey = cursor.key
            if (
              !Array.isArray(lookupKey) ||
              lookupKey.length !== 4 ||
              lookupKey[0] !== prefix[0] ||
              lookupKey[1] !== prefix[1] ||
              lookupKey[2] !== prefix[2]
            ) {
              cursor.continue()
              cursor = (await fromIdbRequest(
                cursorRequest,
                { signal },
                runtime
              )) as IDBCursor | null
              continue
            }
            const primaryKey = cursor.primaryKey as IDBValidKey[]
            continuation = primaryKey
            const recordKey = primaryKey[4] as IStorageKey
            const indexValue = primaryKey[3] as IStorageKey
            if (isStorageKeyInRange(indexValue, range)) {
              const value = await fromIdbRequest(
                transaction.objectStore(recordsStoreName).get(toIdbKey(recordKey)) as IDBRequest<
                  TValue | undefined
                >,
                { signal },
                runtime
              )
              if (value === undefined)
                runtime.reporter(
                  new StorageError(
                    StorageErrorCode.indexOrphan,
                    { backend: StorageBackend.indexedDb, key: recordKey },
                    StorageErrorText.indexOrphan
                  )
                )
              else page.push([recordKey, value])
            }
            cursor.continue()
            cursor = (await fromIdbRequest(cursorRequest, { signal }, runtime)) as IDBCursor | null
          }
          cursorExhausted = cursor === null
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
        for (const entry of page) {
          if (query.limit !== undefined && emitted >= query.limit) {
            exhausted = true
            break
          }
          emitted += 1
          yield entry
        }
        if (cursorExhausted) exhausted = true
      }
    },
    transactionIndexed: <T>(
      handle: IRecordIndexHandle,
      run: (tx: ISecondaryIndexTransactionScope<TValue>) => Promise<T>,
      ctx?: IOperationContext
    ): Promise<T> =>
      withMutationLease((lease) =>
        withAbort(ctx, (signal, context, runtime) =>
          runIndexedTransaction(handle, run, signal, runtime, context, lease)
        )
      ),
    // sync 未定义：IndexedDB 无同步 API。

    dispose: () => {
      prepareState = 'disposed'
      return controller.dispose()
    },

    get: (key, ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive()
        assertStringStorageKey(key, StorageBackend.indexedDb)
        const value = await readFrom(
          kvStoreName,
          (store) => store.get(key) as IDBRequest<unknown>,
          signal,
          runtime
        )
        return typeof value === 'string' ? value : null
      }),
    set: (key, value, ctx) =>
      withMutationLease((lease) =>
        withAbort(ctx, async (signal, context, runtime) => {
          assertLive()
          assertStringStorageKey(key, StorageBackend.indexedDb)
          if (typeof value !== 'string')
            throw new StorageError(StorageErrorCode.invalidConfig, {
              backend: StorageBackend.indexedDb,
              key,
              cause: new TypeError('storage value must be a string')
            })
          await writeWithConflict(
            'value',
            key,
            value,
            signal,
            context?.conflictPolicy,
            runtime,
            lease
          )
        })
      ),
    remove: (key, ctx) =>
      withMutationLease((lease) =>
        withAbort(ctx, async (signal, _context, runtime) => {
          assertLive()
          assertStringStorageKey(key, StorageBackend.indexedDb)
          const database = await open(runtime, lease)
          assertLive()
          const transaction = createTransaction(database, kvStoreName, 'readwrite')
          const committed = idbTransactionCommit(transaction, { signal }, runtime)
          void committed.catch(() => {})
          try {
            const store = transaction.objectStore(kvStoreName)
            const existingKey = await fromIdbRequest(store.getKey(key), { signal }, runtime)
            store.delete(key)
            await committed
            // SOL-SWV2-047: removing an absent key changed nothing, so it must not publish.
            if (existingKey !== undefined)
              publishChange({ channel: 'value', kind: 'remove', keys: [key] })
          } catch (cause) {
            try {
              transaction.abort()
            } catch {
              /* transaction already settled */
            }
            await committed.catch(() => {})
            throw cause
          }
        })
      ),
    has: (key, ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive()
        assertStringStorageKey(key, StorageBackend.indexedDb)
        const value = await readFrom(
          kvStoreName,
          (store) => store.get(key) as IDBRequest<unknown>,
          signal,
          runtime
        )
        return value !== undefined
      }),
    keys: (ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive()
        const raw = await readFrom(kvStoreName, (store) => store.getAllKeys(), signal, runtime)
        return raw.map((key) => {
          assertStringStorageKey(key, StorageBackend.indexedDb, 'persisted value key')
          return key
        })
      }),
    clearValues: (ctx) =>
      withMutationLease((lease) =>
        withAbort(ctx, async (signal, _context, runtime) => {
          assertLive()
          const database = await open(runtime, lease)
          assertLive()
          const transaction = createTransaction(database, kvStoreName, 'readwrite')
          const committed = idbTransactionCommit(transaction, { signal }, runtime)
          void committed.catch(() => {})
          try {
            const store = transaction.objectStore(kvStoreName)
            const count = await fromIdbRequest(store.count(), { signal }, runtime)
            store.clear()
            await committed
            // SOL-SWV2-047: clearing an already-empty store changed nothing.
            if ((count ?? 0) > 0) publishChange({ channel: 'value', kind: 'clear' })
          } catch (cause) {
            try {
              transaction.abort()
            } catch {
              /* transaction already settled */
            }
            await committed.catch(() => {})
            throw cause
          }
        })
      ),
    clearAll: (ctx) =>
      withMutationLease((lease) =>
        withAbort(ctx, async (signal, _context, runtime) => {
          assertLive()
          const database = await open(runtime, lease)
          assertLive()
          throwIfAborted(signal)
          const transaction = createTransaction(
            database,
            [
              kvStoreName,
              bytesStoreName,
              recordsStoreName,
              REVISIONS_STORE_NAME,
              INDEX_RECORDS_STORE_NAME,
              META_STORE_NAME
            ],
            'readwrite'
          )
          const committed = idbTransactionCommit(transaction, { signal }, runtime)
          void committed.catch(() => {})
          try {
            const revisionStore = transaction.objectStore(REVISIONS_STORE_NAME)
            const metaStore = transaction.objectStore(META_STORE_NAME)
            const revision = (await fromIdbRequest(
              revisionStore.get(RECORD_EPOCH_KEY) as IDBRequest<number | undefined>,
              { signal },
              runtime
            )) as number | undefined
            const [kvCount, bytesCount, recordCount] = (await Promise.all([
              fromIdbRequest(transaction.objectStore(kvStoreName).count(), { signal }, runtime),
              fromIdbRequest(transaction.objectStore(bytesStoreName).count(), { signal }, runtime),
              fromIdbRequest(transaction.objectStore(recordsStoreName).count(), { signal }, runtime)
            ])) as number[]
            transaction.objectStore(kvStoreName).clear()
            transaction.objectStore(bytesStoreName).clear()
            transaction.objectStore(recordsStoreName).clear()
            // SWV2-D27 raw-record firewall: see `clearRecords` for why the sidecar must be wiped
            // atomically with the record store, and why the meta/revisions cleanup is scoped
            // (`deleteOwnedMetaKeys`/`deleteOwnedRevisionKeys`) rather than a wholesale `.clear()`.
            transaction.objectStore(INDEX_RECORDS_STORE_NAME).clear()
            await deleteOwnedMetaKeys(metaStore, signal, runtime)
            await deleteOwnedRevisionKeys(revisionStore, signal, runtime)
            revisionStore.put((revision ?? 0) + 1, RECORD_EPOCH_KEY)
            await committed
            if ((kvCount ?? 0) + (bytesCount ?? 0) + (recordCount ?? 0) > 0)
              publishChange({ channel: 'all', kind: 'clear' })
          } catch (cause) {
            try {
              transaction.abort()
            } catch {
              /* transaction already settled */
            }
            await committed.catch(() => {})
            throw cause
          }
        })
      ),
    /**
     * SWV2-B05: every mutation route is wired — `record` (`putRecord`/`deleteRecord`/
     * `clearRecords`/`transaction`/`transactionIndexed`/`migrateLegacyRecords`), `value`/`bytes`
     * (`set`/`remove`/`clearValues`/`setBytes`/`clearBytes`, including `writeWithConflict`'s
     * cross-channel eviction deletes), and `all` (`clearAll`) — each proven post-commit-only
     * against a real `IDBTransaction` (fires after `await committed`, never before, so an
     * aborted/rolled-back transaction is silent) and no-op-suppressed (SOL-SWV2-047: a delete of an
     * absent key or a clear of an empty store publishes nothing). One deliberate exception,
     * matching the memory backend's own `checkCrossChannel(..., emitEvent: false)`: `transaction()`
     * evicting a `value`/`bytes` entry as a side effect of a `replace`-policy record write does not
     * publish its own event, on both backends, because that eviction is folded into the
     * transaction's single `record:batch` event rather than firing a standalone one mid-batch. That
     * local matrix is complete; admitted R09 coordination additionally delivers a bounded
     * metadata-only hint to same-page handles and the realm transport, while non-admitted factories
     * remain fail-closed through the immutable capability snapshot.
     */
    subscribeChanges: (listener) => {
      assertLive()
      return controller.subscribe(listener)
    },
    metadata: {
      get: (key, ctx) =>
        withAbort(ctx, async (signal, _context, runtime) => {
          assertLive()
          assertStringStorageKey(key, StorageBackend.indexedDb, 'metadata key')
          return readFrom(META_STORE_NAME, (store) => store.get(key), signal, runtime)
        }),
      set: (key, value, ctx) =>
        withMutationLease((lease) =>
          withAbort(ctx, async (signal, _context, runtime) => {
            assertLive()
            assertStringStorageKey(key, StorageBackend.indexedDb, 'metadata key')
            await writeTo(META_STORE_NAME, (store) => store.put(value, key), signal, runtime, lease)
          })
        ),
      delete: (key, ctx) =>
        withMutationLease((lease) =>
          withAbort(ctx, async (signal, _context, runtime) => {
            assertLive()
            assertStringStorageKey(key, StorageBackend.indexedDb, 'metadata key')
            await writeTo(META_STORE_NAME, (store) => store.delete(key), signal, runtime, lease)
          })
        )
    },

    getBytes: (key, ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive()
        assertStringStorageKey(key, StorageBackend.indexedDb)
        const value = await readFrom(
          bytesStoreName,
          (store) => store.get(key) as IDBRequest<unknown>,
          signal,
          runtime
        )
        if (isUint8Array(value))
          return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        // IndexedDB 可能把它还原成 ArrayBuffer，取决于实现。
        if (isRawArrayBuffer(value)) return new Uint8Array(value)
        return null
      }),
    setBytes: (key, value, ctx) =>
      withMutationLease((lease) =>
        withAbort(ctx, async (signal, context, runtime) => {
          assertLive()
          assertStringStorageKey(key, StorageBackend.indexedDb)
          if (!isUint8Array(value))
            throw new StorageError(StorageErrorCode.invalidConfig, {
              backend: StorageBackend.indexedDb,
              key,
              cause: new TypeError('bytes value must be a Uint8Array')
            })
          await writeWithConflict(
            'bytes',
            key,
            value,
            signal,
            context?.conflictPolicy,
            runtime,
            lease
          )
        })
      ),
    clearBytes: (ctx) =>
      withMutationLease((lease) =>
        withAbort(ctx, async (signal, _context, runtime) => {
          assertLive()
          const database = await open(runtime, lease)
          assertLive()
          const transaction = createTransaction(database, bytesStoreName, 'readwrite')
          const committed = idbTransactionCommit(transaction, { signal }, runtime)
          void committed.catch(() => {})
          try {
            const store = transaction.objectStore(bytesStoreName)
            const count = await fromIdbRequest(store.count(), { signal }, runtime)
            store.clear()
            await committed
            // SOL-SWV2-047: clearing an already-empty store changed nothing.
            if ((count ?? 0) > 0) publishChange({ channel: 'bytes', kind: 'clear' })
          } catch (cause) {
            try {
              transaction.abort()
            } catch {
              /* transaction already settled */
            }
            await committed.catch(() => {})
            throw cause
          }
        })
      ),

    getRecord: (key, ctx) =>
      withAbort(ctx, async (signal, _context, runtime) => {
        assertLive()
        const keySnapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
        return readFrom(
          recordsStoreName,
          (store) => store.get(toIdbKey(keySnapshot)) as IDBRequest<TValue | undefined>,
          signal,
          runtime
        )
      }),
    putRecord: (value, key, ctx) =>
      withMutationLease((lease) =>
        withAbort(ctx, async (signal, context, runtime) => {
          assertLive()
          const resolvedKey = key ?? createStorageToken()
          const keySnapshot = snapshotStorageKey(resolvedKey, StorageBackend.indexedDb)
          await writeWithConflict(
            'record',
            keySnapshot,
            value,
            signal,
            context?.conflictPolicy,
            runtime,
            lease
          )
          return resolvedKey
        })
      ),
    deleteRecord: (key, ctx) =>
      withMutationLease((lease) =>
        withAbort(ctx, async (signal, _context, runtime) => {
          assertLive()
          const keySnapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
          const database = await open(runtime, lease)
          throwIfAborted(signal)
          const transaction = createTransaction(
            database,
            [recordsStoreName, REVISIONS_STORE_NAME, INDEX_RECORDS_STORE_NAME, META_STORE_NAME],
            'readwrite'
          )
          const committed = idbTransactionCommit(transaction, { signal }, runtime)
          void committed.catch(() => {})
          try {
            const revisionStore = transaction.objectStore(REVISIONS_STORE_NAME)
            const existingKey = await fromIdbRequest(
              transaction.objectStore(recordsStoreName).getKey(toIdbKey(keySnapshot)),
              { signal },
              runtime
            )
            const revision = (await fromIdbRequest(
              revisionStore.get(recordRevisionKey(keySnapshot)) as IDBRequest<number | undefined>,
              { signal },
              runtime
            )) as number | undefined
            transaction.objectStore(recordsStoreName).delete(toIdbKey(keySnapshot))
            revisionStore.put((revision ?? 0) + 1, recordRevisionKey(keySnapshot))
            const epoch = (await fromIdbRequest(
              revisionStore.get(RECORD_EPOCH_KEY) as IDBRequest<number | undefined>,
              { signal },
              runtime
            )) as number | undefined
            revisionStore.put((epoch ?? 0) + 1, RECORD_EPOCH_KEY)
            // SWV2-D27 raw-record firewall: see `writeWithConflict` for why any record-affecting
            // raw mutation must run this before commit.
            await applyRawMutationFirewall(
              transaction.objectStore(META_STORE_NAME),
              revisionStore,
              transaction.objectStore(INDEX_RECORDS_STORE_NAME),
              keySnapshot,
              signal,
              runtime
            )
            await committed
            // SWV2-B05/SOL-SWV2-047: only when the key actually existed (a no-op delete must not
            // publish) and only after real commit.
            if (existingKey !== undefined)
              publishChange({ channel: 'record', kind: 'remove', keys: [keySnapshot] })
          } catch (cause) {
            try {
              transaction.abort()
            } catch {
              /* transaction already settled */
            }
            await committed.catch(() => {})
            throw cause
          }
        })
      ),
    clearRecords: (ctx) =>
      withMutationLease((lease) =>
        withAbort(ctx, async (signal, _context, runtime) => {
          assertLive()
          const database = await open(runtime, lease)
          throwIfAborted(signal)
          const transaction = createTransaction(
            database,
            [recordsStoreName, REVISIONS_STORE_NAME, INDEX_RECORDS_STORE_NAME, META_STORE_NAME],
            'readwrite'
          )
          const committed = idbTransactionCommit(transaction, { signal }, runtime)
          void committed.catch(() => {})
          try {
            const revisionStore = transaction.objectStore(REVISIONS_STORE_NAME)
            const metaStore = transaction.objectStore(META_STORE_NAME)
            const revision = (await fromIdbRequest(
              revisionStore.get(RECORD_EPOCH_KEY) as IDBRequest<number | undefined>,
              { signal },
              runtime
            )) as number | undefined
            const recordCount = (await fromIdbRequest(
              transaction.objectStore(recordsStoreName).count(),
              { signal },
              runtime
            )) as number
            transaction.objectStore(recordsStoreName).clear()
            /**
             * SWV2-D27 raw-record firewall: a raw `clearRecords()` bypasses the entity
             * put/remove/batch/migrate planner, so every existing sidecar projection row and every
             * scope's index generation/readiness handle becomes stale in the same atomic step as
             * the record wipe. Any handle a caller already holds stops matching stored state, so
             * `iterateRecordIndex`/readiness reads fail closed and callers must re-`ensureRecord
             * Indexes` and backfill from scratch — no complete handle can silently keep answering
             * queries against data that no longer exists. `deleteOwnedMetaKeys`/
             * `deleteOwnedRevisionKeys` scope this to only backend-owned bookkeeping (never the
             * legacy migration checkpoint or public `metadata`/other revisions) — see their doc
             * comments for SOL-SWV2-035/036/037.
             */
            transaction.objectStore(INDEX_RECORDS_STORE_NAME).clear()
            await deleteOwnedMetaKeys(metaStore, signal, runtime)
            await deleteOwnedRevisionKeys(revisionStore, signal, runtime)
            revisionStore.put((revision ?? 0) + 1, RECORD_EPOCH_KEY)
            await committed
            if (recordCount > 0) publishChange({ channel: 'record', kind: 'clear' })
          } catch (cause) {
            try {
              transaction.abort()
            } catch {
              /* transaction already settled */
            }
            await committed.catch(() => {})
            throw cause
          }
        })
      ),
    iterateRecords: async function* (range, ctx) {
      const rangeSnapshot = snapshotKeyRange(range, StorageBackend.indexedDb)
      assertLive()
      /** One reporter shared by every abort subscription inside this iteration operation. */
      const runtime = createStorageOperationRuntime()
      const { signal, dispose: disposeSignal, context } = mergeSignals(ctx, runtime.reporter)
      const pageSize = context?.pageSize ?? 128
      let lower = rangeSnapshot?.lower
      let lowerOpen = rangeSnapshot?.lowerOpen
      try {
        while (true) {
          throwIfAborted(signal)
          const pageRange =
            lower === undefined && rangeSnapshot?.upper === undefined
              ? undefined
              : {
                  lower,
                  lowerOpen,
                  upper: rangeSnapshot?.upper,
                  upperOpen: rangeSnapshot?.upperOpen
                }
          const database = await open(runtime)
          assertLive()
          const transaction = createTransaction(database, recordsStoreName, 'readonly')
          const store = transaction.objectStore(recordsStoreName)
          const idbRange = toIdbRange(pageRange, keyRange)
          const request = idbRange ? store.openCursor(idbRange) : store.openCursor()
          const page = await new Promise<Array<[IStorageKey, TValue]>>((resolve, reject) => {
            const values: Array<[IStorageKey, TValue]> = []
            let cursorFinished = false
            let settled = false
            let cancelled = false
            let abortReason: unknown
            /** Owns the cursor abort subscription and is safe before registration completes. */
            let disposeAbort = (): void => {}
            const finish = (callback: () => void): void => {
              if (settled) return
              settled = true
              disposeAbort()
              callback()
            }
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
                  })
            const abort = (): void => {
              cancelled = true
              abortReason = readAbortReason(signal)
              finish(() =>
                reject(
                  new StorageContractError(StorageContractErrorCode.aborted, { cause: abortReason })
                )
              )
            }
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
                      )
                      return
                    }
                    if (!cursorFinished) {
                      reject(
                        cursorFailure(
                          new Error('IndexedDB transaction completed before cursor finished')
                        )
                      )
                      return
                    }
                    resolve(values)
                  })
                },
                () => finish(() => reject(cursorFailure(readIdbTransactionError(transaction)))),
                () => finish(() => reject(cursorFailure(readIdbTransactionError(transaction))))
              )
              installIdbRequestHandlers(
                request,
                () => {
                  try {
                    const cursor = readIdbRequestResult(request)
                    if (!cursor || values.length >= pageSize) {
                      cursorFinished = true
                      finish(() => resolve(values))
                      return
                    }
                    values.push([cursor.key as IStorageKey, cursor.value as TValue])
                    if (values.length < pageSize) cursor.continue()
                    else cursorFinished = true
                  } catch (cause) {
                    finish(() => reject(cursorFailure(cause)))
                  }
                },
                () => finish(() => reject(cursorFailure(readIdbRequestError(request))))
              )
              disposeAbort = subscribeToAbort(signal, abort, runtime.reporter)
            } catch (cause) {
              finish(() =>
                reject(
                  isStorageContractError(cause) ||
                    (cause instanceof StorageError && cause.code === StorageErrorCode.invalidConfig)
                    ? cause
                    : cursorFailure(cause)
                )
              )
              try {
                transaction.abort()
              } catch {
                /* setup failure already owns the result */
              }
            }
          })
          if (page.length === 0) return
          for (const entry of page) {
            throwIfAborted(signal)
            yield entry
          }
          if (page.length < pageSize) return
          lower = page[page.length - 1]![0]
          lowerOpen = true
        }
      } finally {
        disposeSignal()
      }
    },
    transaction: (run, ctx) => {
      assertLive()
      return withMutationLease((lease) =>
        withAbort(ctx, (signal, context, runtime) => {
          assertTransactionCallback(run, StorageBackend.indexedDb)
          return runTransaction(run, signal, runtime, context, lease)
        })
      )
    }
  }
  registerIndexedDbBackfillStore(store, {
    prepare: async () => {
      await open(createStorageOperationRuntime())
    },
    ensureRecordIndexes,
    getRecordIndexReadiness: store.getRecordIndexReadiness,
    openBackfillSession
  })
  registerBackendReactiveController(store, controller)
  return store
}

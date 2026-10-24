import { bindBrowserExecution } from './execution.js'
import {
  createIndexedDbJournalImages,
  indexedDbJournalTarget,
  isIndexedDbJournalRevision
} from './indexed-db-images.js'
import {
  createIndexedDbJournalTerminal,
  createIndexedDbJournalView,
  IndexedDbJournalLayout
} from './indexed-db-journal.js'
import {
  captureIndexedDbTtlClock,
  createIndexedDbTtlAccess,
  IndexedDbTtlLayout
} from './indexed-db-ttl.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  isStorageContractError,
  createTransactionOwner,
  assertTransactionOwner,
  runTransactionOperation,
  runWithConcurrency,
  implement,
  kv,
  records,
  ttl,
  snapshotStorageTtlTarget,
  assertStorageTtlDuration,
  type ITtlTarget,
  type ITtlApi,
  type ITransactionTtlApi,
  createRecordQuery,
  snapshotStorageKeyPrefix,
  snapshotStorageBatchKeys,
  snapshotConcurrencyLockRange,
  readConcurrencyLockIdentities,
  lockKey,
  useTransactionCapability,
  createTransactionBuilder,
  TransactionActivityMode,
  TransactionBeforeStage,
  TransactionObservedStage,
  ConcurrencyHolderState,
  ConcurrencyPolicy,
  type ITransactionOptions,
  type IConcurrencyAttempt,
  type ILockKey,
  type ITransactionBuilder,
  type ILockHolding,
  type ICapabilityStore,
  type ICapabilityImpl,
  type IRecordsApi,
  type ITransactionRecordsApi,
  type ITransactionStageObserver,
  type IStorageIterator,
  type IChangeFeedStore,
  type IStorageChange
} from '@migaia/storage-contract'
import { isStorageErrorFamily, type IStorageErrorFamily } from './errors.js'
import {
  createBackendChangeIterator,
  createBackendJournalNamespace,
  storageJournalLockKey,
  StorageJournalLock,
  encodeStorageJournalImage,
  decodeStorageJournalImage,
  type IBackendJournalTransaction,
  createStorageOperationReporter,
  createStorageOperationRuntime,
  reportCleanupError,
  resolveStorageNamespace,
  type IStorageOperationRuntime
} from '@migaia/storage-host/authoring/backend'
import type {
  IStorageJournalBackendBinding,
  IStorageJournalImage,
  IStorageJournalTarget,
  IStorageJournalAttempt
} from '@migaia/storage-host'
import {
  createStorageAggregateError,
  StorageError,
  StorageErrorCode,
  createStorageError
} from '../types/errors.js'
import {
  indexUniqueConflictText,
  indexBackfillFailureText,
  StorageErrorText
} from '../error-text.js'
import {
  StorageBackend,
  BrowserTtlMethod,
  StorageBrowserOwnerLabel,
  StorageConflictPolicy,
  StorageMigrationStatus,
  StorageOperation,
  StorageTransactionOperation,
  storageBackendOperation
} from '../constants.js'
import {
  mergeSignals,
  readAbortReason,
  throwIfAborted,
  withAbort
} from '@migaia/storage-host/authoring/backend'
import { subscribeToAbort } from './errors.js'
import { snapshotOperationContext } from '@migaia/storage-contract'
import {
  assertStringStorageKey,
  compareStorageKeys,
  snapshotStorageKey
} from '@migaia/storage-contract'
import { encodeFlatStorageKey, snapshotKeyRange } from '@migaia/storage-host/authoring/backend'
import { planChannelWrite } from './errors.js'
/**
 * 's raw-record firewall must distinguish a "canonical entity key" from an unclassifiable/legacy
 * one by physical key shape. `REPOSITORY_KEY_PREFIX` is the one constant that shape depends on; it
 * is a leaf-level string with no dependency back onto this backend module, so importing it here
 * does not create a cycle with `entity/repository.ts` (which does depend on this file).
 */
import { REPOSITORY_KEY_PREFIX, repositoryMigrationKey } from '@migaia/storage-host/entity'
import { isArrayBuffer, isUint8Array } from '@migaia/utils/bytes'
import { normalizeError } from './errors.js'
import { collectUniqueIndexOwners } from './errors.js'
import { isStorageKeyInRange } from '@migaia/storage-host/authoring/backend'
import { UtilsAbortError, raceWithAbort } from '@migaia/utils/promise'
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
  readTransactionConflictPolicy,
  type ITransactionScope
} from '@migaia/storage-contract'
import type { IStorageCapabilities } from '../types/capabilities.js'
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
import { acquireIndexedDbCoordination } from './indexed-db-coordination.js'
import { safeJsonPayloadByteLength } from '@migaia/storage-host/authoring/backend'
import { createStorageToken } from '@migaia/storage-host/authoring/backend'
import { createBackfillContentionFailure } from './errors.js'
import {
  provideBackendConstruction,
  browserKeyValueApi,
  type IBrowserKeyValueApi,
  type IBackendConstruction,
  type IBackendRuntime,
  type IBrowserBatchApi
} from './construction.js'
import { BrowserBatchMethod, observeBrowserBatch, snapshotBrowserBatchEntries } from './batch.js'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { withStorageIteratorResource } from '../utils/storage-iterator.js'
import { observeIndexedDbStage, runNativeIndexedDbTransaction } from './indexed-db-transaction.js'
import { createBrowserOrgBinding } from './organizations.js'

/** Public vector TTL is not supported by an IndexedDB backend with no vector collection source. */
function captureTtlTarget(input: ITtlTarget): Exclude<ITtlTarget, { readonly channel: 'vector' }> {
  /** The original lock/key owner captures and validates every supported target field once. */
  const target = snapshotStorageTtlTarget(input, StorageBackend.indexedDb)
  if (target.channel === 'vector')
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: StorageBackend.indexedDb
    })
  return target
}

/** Both record APIs declare the same native support; each query captures its own planner facts. */
const recordQueryPushdown = {
  source: StorageBackend.indexedDb,
  operations: [],
  operators: []
} as const

const CAPABILITIES: IStorageCapabilities = Object.freeze({
  syncRead: false,
  binary: true,
  records: true,
  transactions: true,
  iteration: true,
  // Closes the full planner/readiness/native-query/unique inventory. The immutable
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

/**
 * IndexedDB physical layout and optional native factory inputs, captured before lazy database
 * acquisition.
 */
export type IIndexedDbOptions = {
  /** Declare only a genuinely realm-private injected factory, never a persistent wrapper. */
  readonly journalFactoryIsPrivate?: true
  /** Database name; defaults to storage-web. */
  readonly dbName?: string
  /** Text-value object store; defaults to kv. */
  readonly kvStoreName?: string
  /** Byte-value object store; defaults to bytes. */
  readonly bytesStoreName?: string
  /** Authoritative record object store; defaults to records. */
  readonly recordsStoreName?: string
  /**
   * Defaults to false; explicit release-time opt-in deletes the legacy documents object store after
   * migration.
   */
  readonly cleanupLegacyRecords?: boolean
  /**
   * Optional IndexedDB factory for tests/non-browser hosts; defaults to the captured realm
   * indexedDB. No fallback Store is selected when the factory is unavailable.
   */
  readonly factory?: IDBFactory
  /**
   * Injects the `IDBKeyRange` constructor. Since jsdom does not provide IndexedDB, tests supply it
   * explicitly with `factory` from fake-indexeddb. Browsers default to `globalThis.IDBKeyRange`.
   */
  readonly keyRange?: typeof IDBKeyRange
  /** Human-readable lock holder label; browser stores default to browser. */
  readonly owner?: { readonly label?: string }
}

/** Selected Features declare stores before opening and borrow only an authorized native scope. */
export type IIndexedDbFeatureExpose = {
  requireObjectStore(name: string): void
  getTransactionClient(scope: ITransactionScope<unknown>): IDBTransaction
  /** Resolve only the exact original scope of this immutable physical organization. */
  getTransactionClientForOrg(scope: object, orgId: string): IDBTransaction
}

/** Physical client access shares the original opener and exact native transaction registry. */
type IIndexedDbPhysical<TValue> = IBackendConstruction<
  IIndexedDbProvidedStore<TValue>,
  IDBDatabase
> & {
  readonly journalBinding: IStorageJournalBackendBinding
  getPreparedClient(): IDBDatabase | Promise<IDBDatabase>
  getTransactionClient(scope: object): IDBTransaction
}
/** Fixed-org Feature resolution never exposes construction or resource ownership. */
type IIndexedDbConstruction<TValue> = IIndexedDbPhysical<TValue> & {
  getOrgClient(orgId: string): IDBDatabase | Promise<IDBDatabase>
  getOrgTransactionClient(scope: object, orgId: string): IDBTransaction
}

/** The native store retains its complete transaction scope in the shared immutable builder. */
type IIndexedDbStore<TValue> = Omit<
  IRecordStore<TValue> & ISecondaryIndexRecordStore<TValue>,
  'transaction' | 'transactionIndexed'
> &
  IChangeFeedStore & {
    transaction<TResult>(
      run: (scope: IIndexedDbTransactionScope<TValue>) => TResult,
      ctx?: ITransactionOptions
    ): Promise<Awaited<TResult>>
    transactionIndexed<TResult>(
      handle: IRecordIndexHandle,
      run: (scope: IIndexedDbTransactionScope<TValue>) => TResult,
      ctx?: ITransactionOptions
    ): Promise<Awaited<TResult>>
    tx(): ITransactionBuilder<IIndexedDbTransactionScope<TValue>>
    inspectLocks(ctx?: IOperationContext): Promise<readonly ILockHolding[]>
    undo?(txId: string, ctx?: IOperationContext): Promise<{ readonly txId: string }>
  }

/** Native views retain the exact records capability granted by their original backend. */
type IIndexedDbTransactionScope<TValue> = Omit<ISecondaryIndexTransactionScope<TValue>, 'use'> &
  ITransactionScope<TValue, typeof records | typeof ttl>

/** The original provided object carries both real native capabilities and their exact APIs. */
type IIndexedDbProvidedStore<TValue> = ICapabilityStore<
  IIndexedDbStore<TValue>,
  typeof kv | typeof records | typeof ttl,
  readonly [
    ICapabilityImpl<typeof kv, IBrowserKeyValueApi<IIndexedDbStore<TValue>>>,
    ICapabilityImpl<typeof records, IRecordsApi<TValue>>,
    ICapabilityImpl<typeof ttl, ITtlApi>
  ]
>

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
    ttl: IndexedDbTtlLayout,
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
/** Bounds `iterateRecordIndex` candidates per short readonly page transaction. */
const INDEX_QUERY_PAGE_SIZE = 64
/** Soft decoded-value cap for one backfill page. */
const INDEX_BACKFILL_SOFT_CAP_BYTES = 1024 * 1024
/** Hard row cap for one backfill commit, before any sidecar write. */
const INDEX_BACKFILL_PROJECTION_ROW_CAP = 4096
/** Hard canonical encoded-key byte cap for one backfill commit. */
const INDEX_BACKFILL_PROJECTION_BYTE_CAP = 2 * 1024 * 1024
/** Hard row cap for one prepared record, matching the entity projection contract. */
const INDEX_BACKFILL_RECORD_ROW_CAP = 1024
/** Fixed private backfill batch lower bound. */
const INDEX_BACKFILL_MIN_BATCH_SIZE = 1
/** Fixed private backfill batch upper bound. */
const INDEX_BACKFILL_MAX_BATCH_SIZE = 512
/** Fixed private lease lower bound in milliseconds. */
const INDEX_BACKFILL_MIN_LEASE_MS = 5_000
/** Fixed private lease upper bound in milliseconds. */
const INDEX_BACKFILL_MAX_LEASE_MS = 120_000
/** Default lease duration in milliseconds. */
const INDEX_BACKFILL_DEFAULT_LEASE_MS = 30_000

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
const normalizeIndexedDbOperationError = (
  error: unknown,
  expiredScope?: true
): IStorageErrorFamily => {
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
    operation: expiredScope ? StorageOperation.transactionScope : undefined,
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

/** Root and transaction reads interpret the same native-cloned binary payload shapes. */
const readIndexedDbBytes = (value: unknown): Uint8Array | null => {
  if (isUint8Array(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (isRawArrayBuffer(value)) return new Uint8Array(value)
  return null
}

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
 * Create a lazily opened IndexedDB Store with text, byte and structured-record channels, atomic
 * transactions and entity secondary indexes. Writes settle after transaction commit. Configuration
 * rejects invalid factories/layouts before use; transaction, quota and version failures keep their
 * original causes. Dispose seals admission, waits owned mutation work and closes connection/
 * coordination resources; it does not delete the database.
 */
export const indexedDbHost = <TValue = unknown>(
  options: IIndexedDbOptions,
  runtime: IBackendRuntime,
  declaredObjectStores: readonly string[] = [],
  bindOrganizations = true
): IIndexedDbConstruction<TValue> => {
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
  /** Caller declaration never follows from a factory object's identity or wrapper shape. */
  let journalFactoryIsPrivate: true | undefined
  let configuredKeyRange: typeof IDBKeyRange | undefined
  /** Holder diagnostics are snapshotted independently from mutable caller configuration. */
  let ownerLabel: string
  try {
    configuredDbName = options.dbName
    configuredKvStoreName = options.kvStoreName
    configuredBytesStoreName = options.bytesStoreName
    configuredRecordsStoreName = options.recordsStoreName
    configuredCleanupLegacyRecords = options.cleanupLegacyRecords
    configuredFactory = options.factory
    journalFactoryIsPrivate = options.journalFactoryIsPrivate
    if (journalFactoryIsPrivate !== undefined && journalFactoryIsPrivate !== true)
      throw new TypeError(StorageErrorText.indexedDbJournalFactoryIsolationInvalid)
    configuredKeyRange = options.keyRange
    /** Read the optional owner and its label only once during this store's construction. */
    const owner = options.owner
    if (
      owner !== undefined &&
      (typeof owner !== 'object' || owner === null || Array.isArray(owner))
    )
      throw new TypeError(StorageErrorText.indexedDbOwnerInvalid)
    ownerLabel = owner?.label ?? StorageBrowserOwnerLabel
    if (typeof ownerLabel !== 'string') throw new TypeError(StorageErrorText.indexedDbOwnerInvalid)
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
  /** Real persistent databases need the browser's native lifetime lock across participating pages. */
  let webLocks: LockManager | undefined
  try {
    webLocks = globalThis.navigator?.locks
  } catch {
    webLocks = undefined
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
  if (
    journalFactoryIsPrivate === true &&
    (configuredFactory === undefined || factory === realmDefaultFactory)
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError(StorageErrorText.indexedDbJournalFactoryMustBeInjected)
    })

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
  /** Schema requirements are captured once before the existing opener can perform any I/O. */
  const featureStoreNames = [...declaredObjectStores]
  if (
    !isValidStoreName(dbName) ||
    configuredStoreNames.some((storeName) => !isValidStoreName(storeName)) ||
    new Set(configuredStoreNames).size !== configuredStoreNames.length ||
    configuredStoreNames.some((storeName) => INTERNAL_STORE_NAMES.has(storeName)) ||
    featureStoreNames.some(
      (name) =>
        !isValidStoreName(name) ||
        INTERNAL_STORE_NAMES.has(name) ||
        configuredStoreNames.includes(name)
    ) ||
    new Set(featureStoreNames).size !== featureStoreNames.length
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError(
        'IndexedDB channel store names must be non-empty, unique, and non-reserved'
      )
    })

  /** Preserve original name validation, then reject reserved org suffixes before native I/O. */
  if (bindOrganizations) resolveStorageNamespace(dbName, runtime.defaultOrgId, runtime.defaultOrgId)

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
   * Scope component of the `{global, scope}` mutation-epoch vector. Bumped atomically with every
   * `runIndexedTransaction` commit that mutates this scope's sidecar rows, so a paginated
   * `iterateRecordIndex` can detect an in-flight write between pages without re-scanning the whole
   * index.
   */
  const indexScopeEpochKey = (scope: string): IDBValidKey => ['__storage_web_index_epoch__', scope]

  /** Separate raw-firewall invalidations from planner writes during backfill. */
  const indexRawEpochKey = (scope: string): IDBValidKey => ['__storage_web_raw_epoch__', scope]

  /**
   * Scoped `META_STORE_NAME` cleanup for a raw `clearRecords`/`clearAll`: deletes only the
   * index-handle/readiness (`index:<scope>`) and repository migration-checkpoint
   * (`repository:<name>:migration`) keys this backend owns, inside the caller's existing
   * transaction. Never touches the backend's own legacy v1-to-v2 migration checkpoint
   * (`LEGACY_RECORDS_MIGRATION_KEY`) — deleting it would make `migrateLegacyRecords` silently
   * re-copy already-cleared legacy `documents` rows back into `records` on the next open — and
   * never touches arbitrary public `metadata` entries, which share this store but are not
   * backend-owned.
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
   * Scoped `REVISIONS_STORE_NAME` cleanup for a raw `clearRecords`/`clearAll`: clears every
   * per-record and per-scope revision/epoch entry, but leaves the global `RECORD_EPOCH_KEY` counter
   * for the caller to read-and-bump atomically in the same transaction.
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
      if (isIndexedDbJournalRevision(key, INTERNAL_META_NAMESPACE)) continue
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
   * Raw-record firewall for `putRecord`/`deleteRecord`: a raw mutation bypasses the entity
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
    withMutationLease((lease) =>
      withAbort(_ctx, async (signal, _context, runtime) => {
        assertLive()
        throwIfAborted(signal)
        const fingerprint = JSON.stringify(definitions)
        const database = await (
          signal === undefined
            ? open(runtime, lease)
            : raceWithAbort(() => open(runtime, lease), {
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
        await idbTransactionCommit(transaction, { signal }, runtime)
        return handle
      })
    )

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
  ): Promise<import('@migaia/storage-host/entity').IRecordIndexBackfillSession<TValue>> => {
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
            phase?: IRecordIndexBackfillPhase
            lease?: IBackfillLease
            scanStartRawEpoch?: number
          }
        | undefined
      if (current?.handle?.generation !== handle.generation) throw staleIndexHandleError()
      const readiness = current.readiness ?? { status: 'pending', scanned: 0, indexed: 0 }
      if (readiness.status === 'complete') throw staleIndexHandleError()
      const phase = current.phase ?? RecordIndexBackfillPhase.canonical
      if (phase !== RecordIndexBackfillPhase.canonical && phase !== RecordIndexBackfillPhase.legacy)
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.indexedDb
        })
      if (phase === RecordIndexBackfillPhase.legacy && !includeLegacy)
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
       * /042: only a genuinely fresh scan (starting from the range's beginning, i.e. no checkpoint
       * yet) takes a new raw-firewall epoch snapshot; a resumed session preserves the one from when
       * this scan actually began, so a raw write from an earlier resumed batch is still caught at
       * completion in `commitBatch`.
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
        readOptions?: IRecordIndexBackfillReadOptions<TValue>,
        inheritedLease?: IMutationLeaseContext
      ): Promise<Awaited<ReturnType<IRecordIndexBackfillSession<TValue>['readBatch']>>> => {
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
          currentPhase === RecordIndexBackfillPhase.legacy ? legacyPhysicalRange : physicalRange
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
        const rawCandidates: IRecordIndexBackfillCandidate<TValue>[] = []
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
          ((metadataState?.phase as IRecordIndexBackfillPhase | undefined) ??
            RecordIndexBackfillPhase.canonical) !== currentPhase
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
      const session: IRecordIndexBackfillSession<TValue> = {
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
        commitBatch: (batch: IRecordIndexBackfillBatch, commitCtx) =>
          withMutationLease(async (lease) => {
            assertSession()
            const commitOperation = snapshotOperationContext(commitCtx)
            throwIfAborted(commitOperation?.signal)
            const batchPhase = batch.phase ?? RecordIndexBackfillPhase.canonical
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
              if (state?.handle?.generation !== handle.generation) throw staleIndexHandleError()
              if (
                ((state?.phase as IRecordIndexBackfillPhase | undefined) ??
                  RecordIndexBackfillPhase.canonical) !== batchPhase
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
                batchPhase === RecordIndexBackfillPhase.legacy ? legacyPhysicalRange : physicalRange
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
               * /042: a scan can only be trusted `complete` if the raw-firewall epoch (bumped by
               * every canonical or legacy-shaped raw write in `applyRawMutationFirewall`, at _any_
               * readiness state, not only `complete`) still matches the snapshot taken when this
               * scan genuinely restarted from the range's beginning. This catches an interleaved
               * raw write regardless of whether it landed inside this batch or between two commits,
               * and regardless of its position relative to the checkpoint — the batch-local flag
               * this replaced could only see the former. It is also recoverable: a later fresh full
               * re-scan takes a new snapshot, and if nothing else mutates the scope during that new
               * scan, the epochs match again and `complete` is reachable — unlike a sticky boolean
               * with no legitimate reset path.
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
                batchPhase === RecordIndexBackfillPhase.canonical &&
                includeLegacy &&
                reachedPhaseEnd
              const reachedScanEnd =
                options.allowComplete &&
                (batchPhase === RecordIndexBackfillPhase.legacy || !includeLegacy) &&
                reachedPhaseEnd
              const nextReadiness: IRecordIndexReadiness = {
                status: reachedScanEnd && scanUnchanged ? 'complete' : 'running',
                scanned:
                  previous.scanned +
                  batch.projections.filter((projection) => projection.counted !== false).length,
                indexed: previous.indexed + indexed
              }
              /**
               * The scan reached its natural end (nothing left to scan) but could not be trusted
               * `complete` only because the epoch moved underneath it. Holding onto a checkpoint at
               * the very end of the range with no way to advance further would wedge this
               * generation permanently `running` — the next `openBackfillSession` would see a
               * defined checkpoint and treat it as a resume, never re-snapshotting the raw-firewall
               * epoch. Clearing the checkpoint here instead makes the _next_ session a genuinely
               * fresh start (per the raw-firewall epoch logic in `openBackfillSession`), so a later
               * clean full re-scan can still reach `complete`.
               */
              const nextPhase = entersLegacyPhase ? RecordIndexBackfillPhase.legacy : batchPhase
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
              throw createStorageAggregateError(
                StorageErrorCode.indexBackfillFailed,
                indexBackfillFailureText(handle.scope),
                [cause, persistFailure]
              )
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
  /** Physical deletion invalidates cached private log indexes without replacing the borrowed view. */
  let journalGeneration = Object.freeze({})

  /** Private commit-after controller shared by direct and Host-created exact stores. */
  const controller = runtime.createChangeController({
    backend: StorageBackend.indexedDb,
    platform: factory,
    options: Object.freeze({ dbName, kvStoreName, bytesStoreName, recordsStoreName }),
    origin: `indexeddb:${createStorageToken()}`,
    finalize: async () => {
      /** Cleanup keeps transport and native connection failures in their original order. */
      const failures: unknown[] = []
      if (deleting !== undefined) {
        try {
          await deleting
        } catch (cause) {
          failures.push(cause)
        }
      }
      try {
        await coordination.dispose()
      } catch (cause) {
        failures.push(cause)
      }
      /** Detach cached references once; the original controller still owns this cleanup attempt. */
      const pending = connection
      const recoveryDatabase = activeDatabase
      connection = undefined
      activeDatabase = undefined
      let pendingDatabase: IDBDatabase | undefined
      if (pending) {
        // A rejected opening is already observed by preparation; it acquired no closeable result.
        pendingDatabase = await pending.then(
          (database) => database,
          () => undefined
        )
        if (pendingDatabase) {
          const cause = tryCloseDatabase(pendingDatabase)
          if (cause !== undefined) failures.push(cause)
        }
      }
      if (recoveryDatabase && recoveryDatabase !== pendingDatabase) {
        const cause = tryCloseDatabase(recoveryDatabase)
        if (cause !== undefined) failures.push(cause)
      }
      if (failures.length > 0)
        throw createStorageAggregateError(
          StorageErrorCode.backendDisposeFailed,
          StorageErrorText.backendDisposeFailed,
          failures
        )
    }
  })
  /** Symbol cleanup shares the controller's primary cleanup without exposing its rejection. */
  let symbolicDispose: Promise<void> | undefined

  /** The original installation owns the physical database's default organization identity. */
  const orgId = runtime.defaultOrgId
  /** One native epoch anchor retains the original installed scheduler as the elapsed-time owner. */
  const ttlNow = captureIndexedDbTtlClock(runtime.featureExpose.getScheduler())

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
    orgId,
    onChange: (change) => controller.publishExternal(change),
    report: (error) => reportCleanupError(coordinationReporter, error),
    createKeyLockPort: () => runtime.createKeyLockPort()
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
   * / change feed: local commit publication plus metadata-only coordination hints. Every publish
   * here happens only after the owning `IDBTransaction` has actually committed (`await committed`),
   * never before, so an aborted/rolled-back IndexedDB transaction fires nothing.
   */
  /** Route existing post-commit events through the one private controller owner. */
  const publishChange = (change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>): void => {
    const event = controller.publish({ ...change, orgId })
    if (event !== undefined) coordination.publish(event)
  }

  // 只开一次库，之后所有事务复用同一个连接。失败时要清掉缓存，否则一次瞬时
  // 故障（另一个标签页正卡在旧版本上）会把这个实例永久毒死。
  let connection: Promise<IDBDatabase> | undefined
  /** The original opener waits for its native delete request before admitting a new connection. */
  let deleting: Promise<void> | undefined
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
    database: IDBDatabase,
    transaction: IDBTransaction
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
    /** Deadline lookup extends the original META layout without rewriting any existing data. */
    const ttlMetadata = transaction.objectStore(META_STORE_NAME)
    if (!ttlMetadata.indexNames.contains(IndexedDbTtlLayout.index)) {
      ttlMetadata.createIndex(IndexedDbTtlLayout.index, IndexedDbTtlLayout.expiresAt)
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
    for (const name of featureStoreNames) {
      if (database.objectStoreNames.contains(name)) continue
      database.createObjectStore(name)
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
          // This backend's own record-mutating route, previously entirely silent —
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
         * `normalizeError` lets it penetrate (rule).
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
         * error is never unwrapped so `normalizeError` lets it penetrate (rule).
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
                throw createStorageError(
                  StorageErrorCode.transactionFailed,
                  StorageErrorText.indexedDbUpgradeTransactionMissing
                )
              ensureStores(database, transaction)
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
    if (deleting !== undefined) return deleting.then(() => open(runtime, inheritedLease))
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
            journalGeneration = Object.freeze({})
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
          !database.objectStoreNames.contains(INDEX_RECORDS_STORE_NAME) ||
          !database
            .transaction(META_STORE_NAME, 'readonly')
            .objectStore(META_STORE_NAME)
            .indexNames.contains(IndexedDbTtlLayout.index) ||
          featureStoreNames.some((name) => !database.objectStoreNames.contains(name))
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

  /**
   * Keep the original read lifetime; data projections may lazily expire through its same native
   * snapshot.
   */
  const readFrom = async <T>(
    storeName: string,
    run: (store: IDBObjectStore) => IDBRequest<T>,
    signal: AbortSignal | undefined,
    runtime: IStorageOperationRuntime,
    project?: (value: T, access: ReturnType<typeof createNativeDataAccess>) => Promise<T>
  ): Promise<T> => {
    const database = await open(runtime)
    assertLive()
    const transaction = createTransaction(
      database,
      project === undefined
        ? storeName
        : [
            kvStoreName,
            bytesStoreName,
            recordsStoreName,
            META_STORE_NAME,
            REVISIONS_STORE_NAME,
            INDEX_RECORDS_STORE_NAME
          ],
      project === undefined ? 'readonly' : 'readwrite'
    )
    const access =
      project === undefined
        ? undefined
        : createNativeDataAccess(
            transaction,
            undefined,
            runtime,
            (make) => fromIdbRequest(make(), undefined, runtime),
            assertExpiryRemoval
          )
    /** Native setup cannot leak a mutation lease; the existing controller owns actual accepted I/O. */
    const release = project === undefined ? () => {} : controller.beginMutation()
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
          if (keys.size > 0) publishChange({ channel, kind: 'remove', keys: [...keys.values()] })
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
    } finally {
      release()
    }
  }

  /** Every caller already holds a mutation lease; resolve only after the native write commits. */
  const writeTo = async (
    storeName: string,
    run: (store: IDBObjectStore) => unknown,
    signal: AbortSignal | undefined,
    runtime: IStorageOperationRuntime,
    inheritedLease: IMutationLeaseContext
  ): Promise<void> => {
    const database = await open(runtime, inheritedLease)
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
      const failure = new StorageError(StorageErrorCode.transactionFailed, {
        backend: StorageBackend.indexedDb,
        cause
      })
      await committed.catch(() => {})
      throw failure
    }
    await committed
  }

  /** The canonical owner is created once after the original provider refines this exact store. */
  let transactionOwner!: ReturnType<typeof createTransactionOwner<TValue>>

  /** Native handles are indexed only after contract ownership has authorized their live views. */
  const nativeTransactions = new Map<
    string,
    {
      readonly native: IDBTransaction
      readonly journal: (
        scope: Omit<ITransactionScope, 'use'>,
        prefix: string
      ) => IBackendJournalTransaction
      readonly images: {
        readonly changes: ReturnType<typeof createIndexedDbJournalImages>['changes']
        readImage(target: IStorageJournalTarget): Promise<IStorageJournalImage>
        writeImage(target: IStorageJournalTarget, image: IStorageJournalImage): Promise<void>
        readonly readRevision: (
          target: IStorageJournalTarget
        ) => ReturnType<ReturnType<typeof createIndexedDbJournalImages>['revision']>
      }
      readonly abort: () => void
      readonly clearRoot: (channel: 'value' | 'bytes' | 'record' | undefined) => Promise<void>
      readonly readKeys: () => Promise<string[]>
      readonly ttl: (scope: ITransactionScope) => ITransactionTtlApi
      readonly expiredRecord: (key: IStorageKey) => Promise<boolean>
      readonly recordEpoch: (
        scope: string
      ) => Promise<{ readonly global: number; readonly scope: number }>
      readonly removeRecordsByPrefix: (
        scope: ITransactionScope<unknown>,
        prefix: IStorageKey
      ) => Promise<number>
    }
  >()
  /** Private journal methods authenticate exact live views through this original native registry. */
  const journalNative = (scope: Omit<ITransactionScope, 'use'>) => {
    const { id } = assertTransactionOwner(construction.store, scope)
    const current = nativeTransactions.get(id)
    if (current === undefined)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    return current
  }

  /** Lazy expiry is a write only when a live native target is actually removed. */
  const assertExpiryRemoval = (
    channel: 'value' | 'bytes' | 'record',
    key: IStorageKey,
    context?: Parameters<typeof coordination.keyPort.probe>[2]
  ): void => {
    const lockChannel = channel === 'value' ? 'text' : channel
    const range = snapshotConcurrencyLockRange(
      { channel: lockChannel, prefix: key },
      StorageBackend.indexedDb
    )
    const held = coordination.keyPort.probe([], [{ channel: lockChannel, ...range }], context)
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
  const createNativeDataAccess = (
    native: IDBTransaction,
    signal: AbortSignal | undefined,
    operationRuntime: IStorageOperationRuntime,
    request: <R>(make: () => IDBRequest<R>) => Promise<R>,
    assertRemoval?: (channel: 'value' | 'bytes' | 'record', key: IStorageKey) => void
  ) => {
    /** Per-channel insertion order gives one post-commit batch with no duplicate keys. */
    const changed = new Map<'value' | 'bytes' | 'record', Map<string, IStorageKey>>()
    /** Indexed writes update one scope epoch in this same transaction. */
    const indexedScopes = new Set<string>()
    /**
     * Complete point revisions share this existing native revision store, including non-journal
     * writers.
     */
    const journalImages = createIndexedDbJournalImages({
      namespace: INTERNAL_META_NAMESPACE,
      revisions: native.objectStore(REVISIONS_STORE_NAME),
      request,
      read: async (channel, key) => {
        const target = native.objectStore(
          channel === 'value'
            ? kvStoreName
            : channel === 'bytes'
              ? bytesStoreName
              : recordsStoreName
        )
        const value: unknown = await request(() => target.get(toIdbKey(key)))
        const present =
          value !== undefined || (await request(() => target.getKey(toIdbKey(key)))) !== undefined
        return { present, value: channel === 'bytes' ? readIndexedDbBytes(value) : value }
      }
    })

    /** Mark an actual mutation without publishing before native commit. */
    const markChanged = (channel: 'value' | 'bytes' | 'record', key: IStorageKey): void => {
      let keys = changed.get(channel)
      if (keys === undefined) {
        keys = new Map()
        changed.set(channel, keys)
      }
      keys.set(encodeFlatStorageKey(key), key)
    }
    /** Revisions and record invalidation retain their existing physical keys and firewall. */
    const reviseRecord = async (key: IStorageKey, raw: boolean): Promise<void> => {
      const revisions = native.objectStore(REVISIONS_STORE_NAME)
      const revision = (await request(() => revisions.get(recordRevisionKey(key)))) as
        | number
        | undefined
      revisions.put((revision ?? 0) + 1, recordRevisionKey(key))
      const epoch = (await request(() => revisions.get(RECORD_EPOCH_KEY))) as number | undefined
      revisions.put((epoch ?? 0) + 1, RECORD_EPOCH_KEY)
      if (raw)
        await applyRawMutationFirewall(
          native.objectStore(META_STORE_NAME),
          revisions,
          native.objectStore(INDEX_RECORDS_STORE_NAME),
          key,
          signal,
          operationRuntime
        )
    }
    /** Canonical deletion can maintain existing sidecars without knowing a new projection. */
    const deleteRecordSidecars = async (key: IStorageKey): Promise<boolean> => {
      /** Reuse the existing key classifier rather than granting a new indexed-delete mode. */
      const authority = classifyLegacyMutationBatch([key])
      if (authority.unscopedPresent) return false
      for (const scope of authority.canonicalScopes) {
        /** The current handle and its rows are read in this same native transaction. */
        const state = (await request(() =>
          native.objectStore(META_STORE_NAME).get(indexMetadataKey(scope))
        )) as { handle?: IRecordIndexHandle } | undefined
        const handle = state?.handle
        if (handle === undefined) continue
        /** The record index locates only this record's existing projected rows. */
        const sidecar = native.objectStore(INDEX_RECORDS_STORE_NAME)
        const rows = await request(() =>
          sidecar.index('record').getAllKeys([scope, handle.generation, toIdbKey(key)])
        )
        for (const row of rows) await request(() => sidecar.delete(row))
        indexedScopes.add(scope)
      }
      return true
    }
    /** Missing entries do not mutate revisions or emit a post-commit batch. */
    const removeNative = async (
      channel: 'value' | 'bytes' | 'record',
      key: IStorageKey
    ): Promise<void> => {
      const name =
        channel === 'value' ? kvStoreName : channel === 'bytes' ? bytesStoreName : recordsStoreName
      const existing = await request(() => native.objectStore(name).getKey(toIdbKey(key)))
      if (existing === undefined) return
      assertRemoval?.(channel, key)
      await journalImages.mutate(channel, key, false, undefined, () =>
        request(() => native.objectStore(name).delete(toIdbKey(key)))
      )
      markChanged(channel, key)
      if (channel === 'record') await reviseRecord(key, !(await deleteRecordSidecars(key)))
    }
    /** Snapshot metadata borrows the same original physical request/deletion path. */
    const ttlAccess = createIndexedDbTtlAccess({
      metadata: native.objectStore(META_STORE_NAME),
      namespace: INTERNAL_META_NAMESPACE,
      keyRange,
      request,
      now: ttlNow,
      present: async (channel, key) =>
        (await request(() =>
          native
            .objectStore(
              channel === 'value'
                ? kvStoreName
                : channel === 'bytes'
                  ? bytesStoreName
                  : recordsStoreName
            )
            .getKey(toIdbKey(key))
        )) !== undefined,
      remove: removeNative,
      changed: markChanged,
      deadline: journalImages.deadline
    })

    /** Scope epochs advance once per native transaction, including cursor-driven expiry. */
    const finishIndexes = async (): Promise<void> => {
      const revisions = native.objectStore(REVISIONS_STORE_NAME)
      for (const scope of indexedScopes) {
        const epoch = (await request(() => revisions.get(indexScopeEpochKey(scope)))) as
          | number
          | undefined
        revisions.put((epoch ?? 0) + 1, indexScopeEpochKey(scope))
      }
    }
    return {
      changed,
      indexedScopes,
      markChanged,
      reviseRecord,
      deleteRecordSidecars,
      removeNative,
      journalImages,
      ttlAccess,
      finishIndexes
    }
  }

  /** Native root calls retain only their original endpoint input, notification and lock derivation. */
  type IRootMode<R> = {
    /** Read endpoints probe existing holders only when TTL actually removes a point. */
    readonly read?: true
    readonly executeAttempt: (context: IWriteOptions, proceed: () => Promise<R>) => PromiseLike<R>
    readonly lock: (context: IWriteOptions) => readonly ILockKey[]
    readonly ranges: () => readonly {
      readonly channel: ILockKey['channel']
      readonly lower: string
      readonly upper: string
    }[]
    readonly notification: {
      readonly channel: 'value' | 'bytes' | 'record' | 'all'
      readonly kind: 'put' | 'remove' | 'clear' | 'batch'
      readonly displacedKind?: 'remove' | 'batch'
    }
  }

  /** Run one genuine native attempt; no record draft or callback timeout owner remains here. */
  const runTransaction = <T>(
    run: (tx: IIndexedDbTransactionScope<TValue>) => T,
    options: ITransactionOptions | undefined,
    lease: IMutationLeaseContext,
    pipeline = true,
    root?: IRootMode<Awaited<T>>,
    journaled = true
  ): Promise<Awaited<T>> => {
    assertTransactionCallback(run, StorageBackend.indexedDb)
    /** Private log transactions opt out before the original prepare and head-lock derivation. */
    const selectedJournal = journaled ? runtime.journal : undefined
    /** The shared loop captures the raw option once and retains inherited attempt identity. */
    return runWithConcurrency(
      {
        store,
        options: options === undefined ? {} : options,
        prepare: selectedJournal === undefined ? undefined : () => selectedJournal.prepare(),
        executeAttempt: root?.executeAttempt,
        lock:
          selectedJournal === undefined
            ? root?.lock
            : (context) => [...(root?.lock(context) ?? []), ...selectedJournal.headLocks()]
      },
      {
        attempt: (context) =>
          coordination.keyPort.attempt(
            context,
            {
              status: ConcurrencyHolderState.held,
              owner: controller.origin,
              label: ownerLabel,
              scope: 'local',
              /** The provider captures the actual acquisition time after any logical wait. */
              get since() {
                return Date.now()
              }
            },
            {
              attempt: async (context) => {
                /** A final native conflict is normalized only after its original pipeline unwinds. */
                let commitConflict: IConcurrencyAttempt<Awaited<T>> | undefined
                /** Only rethrowing this exact failure permits the canonical policy to retry. */
                let commitFailure: StorageContractError | undefined
                /** Public transactions have one outer endpoint; internal roots use their operation. */
                const attemptNative = async (
                  run: (scope: IIndexedDbTransactionScope<TValue>) => T
                ): Promise<Awaited<T>> => {
                  assertTransactionCallback(run, StorageBackend.indexedDb)
                  /** An accepted waiter may drain after disposal but cannot start new native I/O. */
                  assertLive()
                  /**
                   * Database preparation precedes native admission and never runs in the active
                   * callback.
                   */
                  const operationRuntime = createStorageOperationRuntime()
                  /**
                   * These waits retain the original overall deadline rather than opening a second
                   * one.
                   */
                  const database = await context.waitPhysical(open(operationRuntime, lease))
                  /** Every public channel and index sidecar belongs to this same native transaction. */
                  const native = createTransaction(
                    database,
                    [
                      kvStoreName,
                      bytesStoreName,
                      recordsStoreName,
                      REVISIONS_STORE_NAME,
                      INDEX_RECORDS_STORE_NAME,
                      META_STORE_NAME,
                      ...featureStoreNames
                    ],
                    'readwrite'
                  )
                  /** Signals are already captured by the canonical attempt context. */
                  const signal = context.signal as AbortSignal | undefined
                  /** The original provider has already refined this exact base object in place. */
                  const stages =
                    root === undefined
                      ? runtime.stageBindings.transactionStages(construction.store)
                      : undefined
                  /**
                   * Request rejection reuses the native adapter's first failure, including
                   * cancellation.
                   */
                  let attemptFailure: IStorageErrorFamily | undefined
                  /** Final unique checks inspect the final sidecar state after swaps and deletions. */
                  const uniqueChecks = new Map<
                    string,
                    {
                      readonly handle: IRecordIndexHandle
                      readonly indexName: string
                      readonly indexValue: IStorageKey
                    }
                  >()
                  /**
                   * A current operation issues its own native request directly, including after
                   * awaits.
                   */
                  const request = <R>(make: () => IDBRequest<R>): Promise<R> =>
                    fromIdbRequest(make(), { signal }, operationRuntime).catch((cause) => {
                      throw attemptFailure ?? cause
                    })
                  /**
                   * Allocate terminal channels only when an admitted private namespace borrows this
                   * attempt.
                   */
                  let journalTerminal: ReturnType<typeof createIndexedDbJournalTerminal> | undefined
                  /** Actual commit-only external work drains after this same native terminal. */
                  let journalAttempt: IStorageJournalAttempt | undefined
                  /** One physical access owns all data/deadline mutations in this native attempt. */
                  const {
                    changed,
                    indexedScopes,
                    markChanged,
                    reviseRecord,
                    deleteRecordSidecars,
                    removeNative,
                    journalImages,
                    ttlAccess,
                    finishIndexes
                  } = createNativeDataAccess(
                    native,
                    signal,
                    operationRuntime,
                    request,
                    root?.read
                      ? (channel, key) => assertExpiryRemoval(channel, key, context)
                      : undefined
                  )
                  /**
                   * The same physical writer owns data, image order, raw-record sidecars and
                   * revisions.
                   */
                  const putNative = async (
                    channel: 'value' | 'bytes' | 'record',
                    key: IStorageKey,
                    value: unknown,
                    indexed = false
                  ): Promise<void> => {
                    const name =
                      channel === 'value'
                        ? kvStoreName
                        : channel === 'bytes'
                          ? bytesStoreName
                          : recordsStoreName
                    await journalImages.mutate(
                      channel,
                      key,
                      true,
                      channel === 'bytes' ? readIndexedDbBytes(value) : value,
                      () => request(() => native.objectStore(name).put(value, toIdbKey(key)))
                    )
                    markChanged(channel, key)
                    if (channel === 'record') await reviseRecord(key, !indexed)
                  }
                  /** Resolve the existing cross-channel policy inside this same native transaction. */
                  const write = async (
                    channel: 'value' | 'bytes' | 'record',
                    key: IStorageKey,
                    value: unknown,
                    conflictPolicy: 'conflict' | 'replace',
                    indexed = false
                  ): Promise<void> => {
                    const stringKey = typeof key === 'string' ? key : undefined
                    /**
                     * Expired conflicting channels are removed inside this same original native
                     * write.
                     */
                    await Promise.all([
                      ttlAccess.present('value', key),
                      ttlAccess.present('record', key),
                      ...(stringKey === undefined ? [] : [ttlAccess.present('bytes', key)])
                    ])
                    const reads = [
                      request(() => native.objectStore(kvStoreName).get(toIdbKey(key))),
                      stringKey === undefined
                        ? Promise.resolve(undefined)
                        : request(() => native.objectStore(bytesStoreName).get(stringKey)),
                      request(() => native.objectStore(recordsStoreName).getKey(toIdbKey(key)))
                    ]
                    const [text, bytes, record] = await Promise.all(reads)
                    const existing = new Set<'value' | 'bytes' | 'record'>()
                    if (text !== undefined) existing.add('value')
                    if (bytes !== undefined) existing.add('bytes')
                    if (record !== undefined) existing.add('record')
                    const plan = planChannelWrite(
                      key,
                      channel,
                      existing,
                      conflictPolicy,
                      StorageBackend.indexedDb
                    )
                    for (const removal of plan.remove) {
                      const name =
                        removal === 'value'
                          ? kvStoreName
                          : removal === 'bytes'
                            ? bytesStoreName
                            : recordsStoreName
                      await journalImages.mutate(removal, key, false, undefined, () =>
                        request(() => native.objectStore(name).delete(toIdbKey(key)))
                      )
                      await ttlAccess.removed(removal, key)
                      markChanged(removal, key)
                      if (removal === 'record')
                        await reviseRecord(key, !(await deleteRecordSidecars(key)))
                    }
                    await putNative(channel, key, value, indexed)
                    await ttlAccess.written(channel, key)
                  }
                  /** Explicit removal clears the old target deadline in the same native transaction. */
                  const remove = async (
                    channel: 'value' | 'bytes' | 'record',
                    key: IStorageKey
                  ): Promise<void> => {
                    await removeNative(channel, key)
                    await ttlAccess.removed(channel, key)
                  }
                  /** Root clears reuse this transaction's stores, revisions and raw-record firewall. */
                  const clearRoot = async (
                    channel: 'value' | 'bytes' | 'record' | undefined
                  ): Promise<void> => {
                    const channels =
                      channel === undefined ? (['value', 'bytes', 'record'] as const) : [channel]
                    const revisions = native.objectStore(REVISIONS_STORE_NAME)
                    const epoch = channels.includes('record')
                      ? ((await request(() => revisions.get(RECORD_EPOCH_KEY))) as
                          | number
                          | undefined)
                      : undefined
                    for (const target of channels) {
                      const name =
                        target === 'value'
                          ? kvStoreName
                          : target === 'bytes'
                            ? bytesStoreName
                            : recordsStoreName
                      const physical = native.objectStore(name)
                      const keys = await request(() => physical.getAllKeys())
                      const count = keys.length
                      await journalImages.clear(target, keys as IStorageKey[], () =>
                        request(() => physical.clear())
                      )
                      await ttlAccess.clear(target)
                      if (count > 0) changed.set(target, new Map())
                    }
                    if (channels.includes('record')) {
                      await request(() => native.objectStore(INDEX_RECORDS_STORE_NAME).clear())
                      await deleteOwnedMetaKeys(
                        native.objectStore(META_STORE_NAME),
                        signal,
                        operationRuntime
                      )
                      await deleteOwnedRevisionKeys(revisions, signal, operationRuntime)
                      revisions.put((epoch ?? 0) + 1, RECORD_EPOCH_KEY)
                    }
                  }
                  /** Delete one canonical prefix through the existing ordered native cursor. */
                  const removePrefix = async (
                    channel: 'value' | 'record',
                    prefix: ReturnType<typeof snapshotStorageKeyPrefix>
                  ): Promise<number> => {
                    /** The same physical store and native transaction own the complete range. */
                    const target = native.objectStore(
                      channel === 'value' ? kvStoreName : recordsStoreName
                    )
                    /** Optional injected range support only changes the first native seek. */
                    const cursorRequest = target.openCursor(
                      keyRange?.lowerBound(toIdbKey(prefix.key))
                    )
                    /**
                     * Cursor continuation seeks directly when the injected factory lacks
                     * IDBKeyRange.
                     */
                    let cursor = await request(() => cursorRequest)
                    if (
                      keyRange === undefined &&
                      cursor !== null &&
                      compareStorageKeys(cursor.key as IStorageKey, prefix.key) < 0
                    )
                      cursor = await request(() => {
                        cursor!.continue(toIdbKey(prefix.key))
                        return cursorRequest
                      })
                    /** Each matching native entry is deleted once and counted once. */
                    let removed = 0
                    while (cursor !== null && prefix.matches(cursor.key as IStorageKey)) {
                      const key = cursor.key as IStorageKey
                      if (await ttlAccess.present(channel, key)) {
                        await journalImages.mutate(channel, key, false, undefined, () =>
                          request(() => cursor!.delete())
                        )
                        await ttlAccess.removed(channel, key)
                        markChanged(channel, key)
                        if (channel === 'record')
                          await reviseRecord(key, !(await deleteRecordSidecars(key)))
                        removed += 1
                      }
                      cursor = await request(() => {
                        cursor!.continue()
                        return cursorRequest
                      })
                    }
                    return removed
                  }
                  /** Validate one index handle against this transaction's current metadata. */
                  const assertHandle = async (handle: IRecordIndexHandle): Promise<void> => {
                    if (!isValidIndexGeneration(handle.generation)) throw staleIndexHandleError()
                    const state = (await request(() =>
                      native.objectStore(META_STORE_NAME).get(indexMetadataKey(handle.scope))
                    )) as { handle?: IRecordIndexHandle } | undefined
                    if (
                      state?.handle?.generation !== handle.generation ||
                      state.handle.fingerprint !== handle.fingerprint
                    )
                      throw staleIndexHandleError()
                  }
                  /**
                   * Execute only an already-authorized short-lived view through the original
                   * pipeline.
                   */
                  const executeOperation = <TScope extends ITransactionScope<unknown>, TInput, R>(
                    view: TScope,
                    name: string,
                    input: TInput,
                    run: (view: TScope, input: TInput) => R,
                    batch?: { readonly count?: number }
                  ): Promise<Awaited<R>> => {
                    /** Root batch observation already encloses this same native scope. */
                    const invoke = (): Promise<Awaited<R>> =>
                      root !== undefined
                        ? Promise.resolve(run(view, input))
                        : runtime.execution.run<TInput, Awaited<R>>(
                            { operation: name, input, ctx: context, scope: view },
                            async (captured): Promise<Awaited<R>> => {
                              /**
                               * Observer failures report without changing the admitted native
                               * operation.
                               */
                              let operationStages: ITransactionStageObserver | undefined
                              try {
                                operationStages = stages?.forTransaction(view)
                              } catch (cause) {
                                reportCleanupError(operationRuntime.reporter, cause)
                              }
                              observeIndexedDbStage(
                                operationStages,
                                TransactionBeforeStage.beforeTxOperation,
                                operationRuntime,
                                name
                              )
                              const value = await run(view, captured)
                              observeIndexedDbStage(
                                operationStages,
                                TransactionObservedStage.afterTxOperation,
                                operationRuntime,
                                name
                              )
                              return value
                            }
                          )
                    return batch !== undefined && root === undefined
                      ? observeBrowserBatch(
                          runtime,
                          construction.store,
                          name,
                          batch.count,
                          invoke,
                          view
                        )
                      : invoke()
                  }
                  /**
                   * One same-transaction cursor is advanced only by an authorized fresh operation
                   * view.
                   */
                  const recordIterator = (
                    scope: ITransactionScope<TValue>,
                    range: IKeyRange | undefined,
                    query?: IRecordIndexQuery
                  ): IStorageIterator<[IStorageKey, TValue]> => {
                    /**
                     * Capture arguments during the first authorized advance, like the root
                     * generator.
                     */
                    let rangeSnapshot: IKeyRange | undefined
                    let cursorRequest: IDBRequest<IDBCursorWithValue | null> | undefined
                    let cursor: IDBCursorWithValue | undefined
                    let emitted = 0
                    return transactionOwner.registerIterator<
                      ITransactionScope<TValue>,
                      [IStorageKey, TValue]
                    >(scope, {
                      next: (view) =>
                        executeOperation(
                          view,
                          query === undefined
                            ? StorageTransactionOperation.iterateRecords
                            : StorageTransactionOperation.iterateRecordIndex,
                          undefined,
                          async (): Promise<IteratorResult<[IStorageKey, TValue], undefined>> => {
                            if (query?.limit !== undefined && emitted >= query.limit)
                              return { done: true, value: undefined }
                            if (cursorRequest === undefined) {
                              rangeSnapshot = snapshotKeyRange(range, StorageBackend.indexedDb)
                              if (query === undefined)
                                cursorRequest = native
                                  .objectStore(recordsStoreName)
                                  .openCursor(toIdbRange(rangeSnapshot, keyRange))
                              else {
                                await assertHandle(query.handle)
                                if (keyRange === undefined)
                                  throw new StorageError(StorageErrorCode.unavailable, {
                                    backend: StorageBackend.indexedDb
                                  })
                                const direction = query.direction === 'prev' ? 'prev' : 'next'
                                const prefix = [
                                  query.handle.scope,
                                  query.index,
                                  query.handle.generation
                                ]
                                cursorRequest = native
                                  .objectStore(INDEX_RECORDS_STORE_NAME)
                                  .index('lookup')
                                  .openCursor(
                                    toIdbRecordIndexRange(
                                      rangeSnapshot,
                                      prefix,
                                      keyRange,
                                      direction,
                                      undefined
                                    ),
                                    direction
                                  )
                              }
                            } else cursor?.continue()
                            let next = await request(() => cursorRequest!)
                            while (next !== null) {
                              cursor = next
                              const recordKey =
                                query === undefined
                                  ? (next.key as IStorageKey)
                                  : (next.value as { recordKey: IStorageKey }).recordKey
                              if (await ttlAccess.present('record', recordKey)) {
                                emitted += 1
                                if (query === undefined)
                                  return { done: false, value: [recordKey, next.value as TValue] }
                                const value = (await request(() =>
                                  native.objectStore(recordsStoreName).get(toIdbKey(recordKey))
                                )) as TValue | undefined
                                if (value === undefined)
                                  throw new StorageError(
                                    StorageErrorCode.indexOrphan,
                                    { backend: StorageBackend.indexedDb },
                                    StorageErrorText.indexOrphan
                                  )
                                return { done: false, value: [recordKey, value] }
                              }
                              if (
                                query !== undefined &&
                                !(await ttlAccess.expired('record', recordKey))
                              )
                                throw new StorageError(
                                  StorageErrorCode.indexOrphan,
                                  { backend: StorageBackend.indexedDb },
                                  StorageErrorText.indexOrphan
                                )
                              cursor.continue()
                              next = await request(() => cursorRequest!)
                            }
                            return { done: true, value: undefined }
                          }
                        ),
                      close: () => {
                        cursor = undefined
                        cursorRequest = undefined
                      }
                    })
                  }
                  /**
                   * Every short-lived view closes over the same native transaction and complete
                   * method set.
                   */
                  const createScope = (): IIndexedDbTransactionScope<TValue> => {
                    let scope!: IIndexedDbTransactionScope<TValue>
                    /**
                     * Register before any input projection, clone, stage callback or native request
                     * begins.
                     */
                    const operation = <TInput, R>(
                      name: string,
                      input: TInput,
                      run: (view: IIndexedDbTransactionScope<TValue>, input: TInput) => R
                    ): Promise<Awaited<R>> =>
                      runTransactionOperation(scope, (view) =>
                        executeOperation(view, name, input, run)
                      )
                    scope = {
                      use: (capability) => useTransactionCapability(scope, capability),
                      removeByPrefix: (prefix) =>
                        runTransactionOperation(scope, (view) => {
                          const captured = snapshotStorageKeyPrefix(
                            prefix,
                            StorageBackend.indexedDb
                          )
                          return executeOperation(
                            view,
                            StorageTransactionOperation.removeByPrefix,
                            undefined,
                            () => removePrefix('value', captured),
                            {}
                          )
                        }),
                      getMany: (keys) =>
                        runTransactionOperation(scope, (view) => {
                          const captured = snapshotStorageBatchKeys(keys, StorageBackend.indexedDb)
                          if (captured.length === 0) return []
                          return executeOperation(
                            view,
                            StorageTransactionOperation.getMany,
                            { count: captured.length },
                            async () => {
                              /** Repeated positions reuse one native read in this snapshot. */
                              const reads: Promise<string | undefined>[] = []
                              return Promise.all(
                                captured.map(({ key, firstIndex }, index) => {
                                  const pending =
                                    firstIndex === index
                                      ? (async () => {
                                          if (!(await ttlAccess.present('value', key)))
                                            return undefined
                                          const value = await request(() =>
                                            native.objectStore(kvStoreName).get(toIdbKey(key))
                                          )
                                          return typeof value === 'string' ? value : undefined
                                        })()
                                      : reads[firstIndex]!
                                  reads.push(pending)
                                  return pending
                                })
                              )
                            },
                            { count: captured.length }
                          )
                        }),
                      setMany: (entries) =>
                        runTransactionOperation(scope, (view) => {
                          /**
                           * Every entry is captured and validated before the batch issues its first
                           * write.
                           */
                          const captured = snapshotBrowserBatchEntries(
                            entries,
                            StorageBackend.indexedDb,
                            true
                          )
                          if (captured.length === 0) return
                          return executeOperation(
                            view,
                            StorageTransactionOperation.setMany,
                            { count: captured.length },
                            async () => {
                              for (const { key, value, ttlMs } of captured) {
                                await write('value', key, value, StorageConflictPolicy.conflict)
                                if (ttlMs !== undefined) await ttlAccess.expire('value', key, ttlMs)
                              }
                            },
                            { count: captured.length }
                          )
                        }),
                      removeMany: (keys) =>
                        runTransactionOperation(scope, (view) => {
                          const captured = snapshotStorageBatchKeys(keys, StorageBackend.indexedDb)
                          if (captured.length === 0) return 0
                          return executeOperation(
                            view,
                            StorageTransactionOperation.removeMany,
                            { count: captured.length },
                            async () => {
                              let removed = 0
                              for (let index = 0; index < captured.length; index += 1) {
                                const { key, firstIndex } = captured[index]!
                                if (firstIndex !== index) continue
                                if (!(await ttlAccess.present('value', key))) continue
                                await remove('value', key)
                                removed += 1
                              }
                              return removed
                            },
                            { count: captured.length }
                          )
                        }),
                      get: (key) =>
                        operation(StorageTransactionOperation.get, key, async (_view, key) => {
                          assertStringStorageKey(key, StorageBackend.indexedDb)
                          if (!(await ttlAccess.present('value', key))) return null
                          const value = await request(() =>
                            native.objectStore(kvStoreName).get(key)
                          )
                          return typeof value === 'string' ? value : null
                        }),
                      set: (key, value, options) =>
                        operation(
                          StorageTransactionOperation.set,
                          { key, value, options },
                          (_view, { key, value, options }) => {
                            assertStringStorageKey(key, StorageBackend.indexedDb)
                            if (typeof value !== 'string')
                              throw new StorageError(StorageErrorCode.invalidConfig, {
                                backend: StorageBackend.indexedDb,
                                key,
                                cause: new TypeError(StorageErrorText.storageValueInvalid)
                              })
                            return write(
                              'value',
                              key,
                              value,
                              readTransactionConflictPolicy(options, StorageBackend.indexedDb)
                            )
                          }
                        ),
                      remove: (key) =>
                        operation(StorageTransactionOperation.remove, key, (_view, key) => {
                          assertStringStorageKey(key, StorageBackend.indexedDb)
                          return remove('value', key)
                        }),
                      has: (key) =>
                        operation(StorageTransactionOperation.has, key, async (_view, key) => {
                          assertStringStorageKey(key, StorageBackend.indexedDb)
                          return ttlAccess.present('value', key)
                        }),
                      getBytes: (key) =>
                        operation(StorageTransactionOperation.getBytes, key, async (_view, key) => {
                          assertStringStorageKey(key, StorageBackend.indexedDb)
                          if (!(await ttlAccess.present('bytes', key))) return null
                          const value = await request(() =>
                            native.objectStore(bytesStoreName).get(key)
                          )
                          return readIndexedDbBytes(value)
                        }),
                      setBytes: (key, value, options) =>
                        operation(
                          StorageTransactionOperation.setBytes,
                          { key, value, options },
                          (_view, { key, value, options }) => {
                            assertStringStorageKey(key, StorageBackend.indexedDb)
                            if (!isUint8Array(value))
                              throw new StorageError(StorageErrorCode.invalidConfig, {
                                backend: StorageBackend.indexedDb,
                                key,
                                cause: new TypeError(StorageErrorText.storageBytesInvalid)
                              })
                            const snapshot = root === undefined ? value.slice() : value
                            return write(
                              'bytes',
                              key,
                              snapshot,
                              readTransactionConflictPolicy(options, StorageBackend.indexedDb)
                            )
                          }
                        ),
                      removeBytes: (key) =>
                        operation(StorageTransactionOperation.removeBytes, key, (_view, key) => {
                          assertStringStorageKey(key, StorageBackend.indexedDb)
                          return remove('bytes', key)
                        }),
                      getRecord: (key) =>
                        operation(
                          StorageTransactionOperation.getRecord,
                          key,
                          async (_view, key) => {
                            const snapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
                            if (!(await ttlAccess.present('record', snapshot))) return undefined
                            return request(() =>
                              native.objectStore(recordsStoreName).get(toIdbKey(snapshot))
                            ) as Promise<TValue | undefined>
                          }
                        ),
                      putRecord: (value, key, options) =>
                        operation(
                          StorageTransactionOperation.putRecord,
                          { value, key, options },
                          async (_view, { value, key, options }) => {
                            const snapshot = snapshotStorageKey(
                              key ?? createStorageToken(),
                              StorageBackend.indexedDb
                            )
                            const copy =
                              root === undefined ? snapshotWriteValue(value, snapshot) : value
                            await write(
                              'record',
                              snapshot,
                              copy,
                              readTransactionConflictPolicy(options, StorageBackend.indexedDb)
                            )
                            return snapshot
                          }
                        ),
                      deleteRecord: (key) =>
                        operation(StorageTransactionOperation.deleteRecord, key, (_view, key) => {
                          const snapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
                          return remove('record', snapshot)
                        }),
                      iterateRecords: (range) => recordIterator(scope, range),
                      isRecordIndexReady: (handle) =>
                        operation(
                          StorageTransactionOperation.isRecordIndexReady,
                          handle,
                          async (_view, handle) => {
                            /**
                             * A cached repository handle grants no readiness across native
                             * snapshots.
                             */
                            const { scope, generation, fingerprint } = handle
                            const state = (await request(() =>
                              native.objectStore(META_STORE_NAME).get(indexMetadataKey(scope))
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
                        operation(
                          StorageTransactionOperation.putIndexedRecord,
                          { value, key, handle, projection, options },
                          async (_view, { value, key, handle, projection, options }) => {
                            const snapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
                            const copy =
                              root === undefined ? snapshotWriteValue(value, snapshot) : value
                            const projected =
                              root === undefined
                                ? snapshotWriteValue(projection, snapshot)
                                : projection
                            const conflictPolicy = readTransactionConflictPolicy(
                              options,
                              StorageBackend.indexedDb
                            )
                            await assertHandle(handle)
                            const definitions = JSON.parse(
                              handle.fingerprint
                            ) as IRecordIndexDefinition[]
                            const owners = collectUniqueIndexOwners(
                              definitions,
                              [{ key: snapshot, projection: projected }],
                              StorageBackend.indexedDb
                            )
                            for (const [identity, unique] of owners)
                              uniqueChecks.set(
                                JSON.stringify([handle.scope, handle.generation, identity]),
                                {
                                  handle,
                                  indexName: unique.indexName,
                                  indexValue: unique.indexValue
                                }
                              )
                            const sidecar = native.objectStore(INDEX_RECORDS_STORE_NAME)
                            const rows = await request(() =>
                              sidecar
                                .index('record')
                                .getAllKeys([handle.scope, handle.generation, toIdbKey(snapshot)])
                            )
                            for (const row of rows) await request(() => sidecar.delete(row))
                            await write('record', snapshot, copy, conflictPolicy, true)
                            for (const [indexName, entry] of Object.entries(projected)) {
                              if (entry === undefined) continue
                              const keys = entry.kind === 'multiple' ? entry.keys : [entry.key]
                              for (const indexValue of keys)
                                await request(() =>
                                  sidecar.put({
                                    scope: handle.scope,
                                    generation: handle.generation,
                                    indexName,
                                    indexValue: toIdbKey(indexValue),
                                    recordKey: toIdbKey(snapshot)
                                  })
                                )
                            }
                            indexedScopes.add(handle.scope)
                            return snapshot
                          }
                        ),
                      iterateRecordIndex: (query) => recordIterator(scope, query.range, query)
                    }
                    /**
                     * Selected Feature methods are attached to this original complete view before
                     * freezing.
                     */
                    const api = runtime.createTransactionApi(scope)
                    if (api !== undefined)
                      Object.defineProperty(scope, 'api', { value: api, enumerable: true })
                    return Object.freeze(scope)
                  }
                  /** Original observer factories may synchronously start accepted scope operations. */
                  if (selectedJournal?.active()) journalImages.changes()
                  const result = await runNativeIndexedDbTransaction({
                    transaction: native,
                    guardStoreName: REVISIONS_STORE_NAME,
                    guardKey: RECORD_EPOCH_KEY,
                    owner: transactionOwner,
                    createScope,
                    run,
                    signal,
                    context,
                    runtime: operationRuntime,
                    normalizeFailure: (cause) =>
                      (attemptFailure ??= normalizeIndexedDbOperationError(cause)),
                    observer: stages,
                    waitPhysical: (pending) => context.waitPhysical(pending),
                    registerNative: (scope, abort) => {
                      const { id } = assertTransactionOwner(store, scope)
                      nativeTransactions.set(id, {
                        native,
                        readKeys: async () => {
                          const keys = await request(() =>
                            native.objectStore(kvStoreName).getAllKeys()
                          )
                          const live: string[] = []
                          for (const key of keys) {
                            assertStringStorageKey(
                              key,
                              StorageBackend.indexedDb,
                              'persisted value key'
                            )
                            if (await ttlAccess.present('value', key)) live.push(key)
                          }
                          return live
                        },
                        journal: (view, prefix) => {
                          journalTerminal ??= createIndexedDbJournalTerminal((error) =>
                            reportCleanupError(operationRuntime.reporter, error)
                          )
                          /** No raw native handle or commit right leaves this physical owner. */
                          const metadata = createIndexedDbJournalView({
                            scope: view,
                            metadata: native.objectStore(META_STORE_NAME),
                            namespace: INTERNAL_META_NAMESPACE,
                            prefix,
                            keyRange: keyRange!,
                            request
                          })
                          return {
                            onCommit: journalTerminal.onCommit,
                            onRollback: journalTerminal.onRollback,
                            onEnd: journalTerminal.onEnd,
                            run: (work) => runTransactionOperation(view, () => work(metadata))
                          }
                        },
                        images: {
                          changes: journalImages.changes,
                          readImage: async (target) => {
                            const row = indexedDbJournalTarget(target)
                            if (row.metadata) {
                              const deadline = await ttlAccess.deadline(row.channel, row.key)
                              return encodeStorageJournalImage(deadline !== undefined, deadline)
                            }
                            const name =
                              row.channel === 'value'
                                ? kvStoreName
                                : row.channel === 'bytes'
                                  ? bytesStoreName
                                  : recordsStoreName
                            const targetStore = native.objectStore(name)
                            const value: unknown = await request(() =>
                              targetStore.get(toIdbKey(row.key))
                            )
                            const present =
                              value !== undefined ||
                              (await request(() => targetStore.getKey(toIdbKey(row.key)))) !==
                                undefined
                            return encodeStorageJournalImage(
                              present,
                              row.channel === 'bytes' ? readIndexedDbBytes(value) : value,
                              row.channel === 'bytes'
                            )
                          },
                          writeImage: async (target, image) => {
                            const row = indexedDbJournalTarget(target)
                            const decoded = decodeStorageJournalImage(
                              image,
                              row.channel === 'bytes' && !row.metadata
                            )
                            if (row.metadata) {
                              if (
                                decoded.present &&
                                (typeof decoded.value !== 'number' ||
                                  !Number.isFinite(decoded.value))
                              )
                                throw new StorageContractError(
                                  StorageContractErrorCode.invalidArgument
                                )
                              await ttlAccess.restore(
                                row.channel,
                                row.key,
                                decoded.present ? (decoded.value as number) : undefined
                              )
                            } else if (!decoded.present) await removeNative(row.channel, row.key)
                            else {
                              if (row.channel === 'value' && typeof decoded.value !== 'string')
                                throw new StorageContractError(
                                  StorageContractErrorCode.invalidArgument
                                )
                              await putNative(row.channel, row.key, decoded.value)
                            }
                          },
                          readRevision: (target) => {
                            const row = indexedDbJournalTarget(target)
                            return journalImages.revision(row.channel, row.key)
                          }
                        },
                        abort,
                        clearRoot,
                        expiredRecord: (key) => ttlAccess.expired('record', key),
                        recordEpoch: async (scope) => ({
                          global:
                            ((await request(() =>
                              native.objectStore(REVISIONS_STORE_NAME).get(RECORD_EPOCH_KEY)
                            )) as number) ?? 0,
                          scope:
                            (((await request(() =>
                              native
                                .objectStore(REVISIONS_STORE_NAME)
                                .get(indexScopeEpochKey(scope))
                            )) as number) ?? 0) + (indexedScopes.has(scope) ? 1 : 0)
                        }),
                        ttl: (scope) => ({
                          expire: (target, ms) =>
                            runTransactionOperation(scope, (view) =>
                              executeOperation(
                                view,
                                StorageTransactionOperation.ttlExpire,
                                { target, ms },
                                async (_view, input) => {
                                  const target = captureTtlTarget(input.target)
                                  assertStorageTtlDuration(input.ms, StorageBackend.indexedDb)
                                  return ttlAccess.expire(
                                    target.channel === 'text' ? 'value' : target.channel,
                                    target.key,
                                    input.ms
                                  )
                                }
                              )
                            ),
                          remaining: (target) =>
                            runTransactionOperation(scope, (view) =>
                              executeOperation(
                                view,
                                StorageTransactionOperation.ttlRemaining,
                                target,
                                (_view, input) => {
                                  const target = captureTtlTarget(input)
                                  return ttlAccess.remaining(
                                    target.channel === 'text' ? 'value' : target.channel,
                                    target.key
                                  )
                                }
                              )
                            ),
                          persist: (target) =>
                            runTransactionOperation(scope, (view) =>
                              executeOperation(
                                view,
                                StorageTransactionOperation.ttlPersist,
                                target,
                                (_view, input) => {
                                  const target = captureTtlTarget(input)
                                  return ttlAccess.persist(
                                    target.channel === 'text' ? 'value' : target.channel,
                                    target.key
                                  )
                                }
                              )
                            )
                        }),
                        removeRecordsByPrefix: (scope, prefix) =>
                          runTransactionOperation(scope, (view) => {
                            const captured = snapshotStorageKeyPrefix(
                              prefix,
                              StorageBackend.indexedDb
                            )
                            return executeOperation(
                              view,
                              StorageTransactionOperation.removeRecordsByPrefix,
                              undefined,
                              () => removePrefix('record', captured)
                            )
                          })
                      })
                      return () => {
                        nativeTransactions.delete(id)
                      }
                    },
                    onNativeEnd: (committed) => journalTerminal?.complete(committed),
                    onRegistered: (scope) => {
                      journalAttempt = selectedJournal?.begin(scope)
                    },
                    beforeCommit: async (scope) => {
                      for (const { handle, indexName, indexValue } of uniqueChecks.values()) {
                        const owners = await request(() =>
                          native
                            .objectStore(INDEX_RECORDS_STORE_NAME)
                            .index('lookup')
                            .getAllKeys([
                              handle.scope,
                              indexName,
                              handle.generation,
                              toIdbKey(indexValue)
                            ])
                        )
                        let liveOwners = 0
                        for (const owner of owners) {
                          const key = (owner as IDBValidKey[])[4] as IStorageKey
                          if (await ttlAccess.present('record', key)) liveOwners += 1
                        }
                        if (liveOwners > 1)
                          throw new StorageError(
                            StorageErrorCode.indexUniqueConflict,
                            { backend: StorageBackend.indexedDb },
                            indexUniqueConflictText(indexName)
                          )
                      }
                      await finishIndexes()
                      await journalAttempt?.record(scope)
                    },
                    validateCommit: () => {
                      /** A retained value whose deadline elapsed cannot be committed as still live. */
                      const expired = ttlAccess.expiredObservation()
                      if (expired !== undefined) {
                        const key =
                          expired.channel === 'value'
                            ? lockKey.text(expired.key)
                            : expired.channel === 'record'
                              ? lockKey.record(expired.key)
                              : lockKey.bytes(expired.key as string)
                        commitFailure = new StorageContractError(
                          StorageContractErrorCode.writeConflict,
                          { backend: StorageBackend.indexedDb, keys: [key] }
                        )
                        commitConflict = {
                          status: 'conflict',
                          phase: 'commit',
                          keys: [key],
                          holder: undefined,
                          cause: commitFailure
                        }
                        throw commitFailure
                      }
                      /** New logical holders are checked after real native work and before commit. */
                      const held = coordination.keyPort.probe(
                        readConcurrencyLockIdentities(context),
                        root?.ranges(),
                        context
                      )
                      if (held !== undefined) {
                        commitFailure = new StorageContractError(
                          StorageContractErrorCode.writeConflict,
                          {
                            backend: StorageBackend.indexedDb,
                            keys: [held.key],
                            holder: held.holder
                          }
                        )
                        commitConflict = {
                          status: 'conflict',
                          phase: 'commit',
                          keys: [held.key],
                          holder: held.holder,
                          cause: commitFailure
                        }
                        throw commitFailure
                      }
                    },
                    changedKeys: () =>
                      [...changed.values()].reduce((count, keys) => count + keys.size, 0),
                    afterCommit: () => {
                      if (root !== undefined) {
                        /** Root publication retains its existing kind, order and no-op suppression. */
                        const notification = root.notification
                        if (notification.channel === 'all') {
                          if (changed.size > 0) publishChange({ channel: 'all', kind: 'clear' })
                          return
                        }
                        const keys = changed.get(notification.channel)
                        if (keys !== undefined)
                          publishChange({
                            channel: notification.channel,
                            kind: notification.kind,
                            ...(notification.kind === 'clear' ? {} : { keys: [...keys.values()] })
                          })
                        for (const channel of ['value', 'bytes', 'record'] as const) {
                          if (channel === notification.channel) continue
                          const displaced = changed.get(channel)
                          if (displaced !== undefined && displaced.size > 0)
                            publishChange({
                              channel,
                              kind: notification.displacedKind ?? 'remove',
                              keys: [...displaced.values()]
                            })
                        }
                        return
                      }
                      for (const channel of ['value', 'bytes', 'record'] as const) {
                        const keys = changed.get(channel)
                        if (keys !== undefined && keys.size > 0)
                          publishChange({ channel, kind: 'batch', keys: [...keys.values()] })
                      }
                    }
                  })
                  await journalAttempt?.settle?.()
                  return result
                }
                try {
                  const value = pipeline
                    ? await runtime.execution.run(
                        {
                          operation: StorageOperation.indexedDbTransaction,
                          input: run,
                          ctx: context
                        },
                        attemptNative
                      )
                    : await attemptNative(run)
                  return { status: 'committed', value }
                } catch (cause) {
                  if (commitConflict !== undefined && cause === commitFailure) return commitConflict
                  throw cause
                }
              }
            },
            runtime.stageBindings.concurrencyStages(construction.store),
            controller.closingSignal,
            root?.ranges()
          )
      }
    )
  }

  /**
   * Iterator pages reuse the same optional backend journal port without shadowing operation
   * runtime.
   */
  const runtimeJournal = runtime.journal

  /** Each real root attempt captures its payload before logical admission; acquire waits reuse it. */
  type IRootPrepared<R> = {
    readonly keys: readonly ILockKey[]
    readonly ranges?: ReturnType<IRootMode<Awaited<R>>['ranges']>
    readonly run: (scope: IIndexedDbTransactionScope<TValue>) => R
  }
  /** Root execution uses one complete pipeline per native attempt in the original loop/owner. */
  const rootMutation = <I, R>(
    method: string,
    input: I,
    options: IWriteOptions | undefined,
    notification: IRootMode<Awaited<R>>['notification'],
    prepare: (input: I, context: IWriteOptions) => IRootPrepared<R>,
    read = false
  ): Promise<Awaited<R>> => {
    /** Pipeline output is fixed before implicit key/range derivation can run. */
    let capturedInput = input
    /** One native attempt derives detached arguments once, including across acquire waits. */
    let prepared!: IRootPrepared<R>
    return withMutationLease((lease) =>
      runTransaction((scope) => prepared.run(scope), options, lease, false, {
        ...(read ? { read: true as const } : {}),
        executeAttempt: (context, proceed) =>
          runtime.execution.run(
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
  /**
   * Selected reads prepare the original org once and capture lazy expiry in the same native
   * attempt.
   */
  const rootRead = <I, R>(
    method: string,
    input: I,
    context: IOperationContext | undefined,
    channel: 'value' | 'bytes' | 'record',
    run: (scope: IIndexedDbTransactionScope<TValue>, input: I) => R
  ): Promise<Awaited<R>> =>
    rootMutation(
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

  /** Replace protects all channels that the existing native write may displace. */
  const rootKeys = (
    channel: 'value' | 'bytes' | 'record',
    key: IStorageKey,
    context: IWriteOptions
  ): readonly ILockKey[] =>
    (context.conflictPolicy === 'replace'
      ? (['value', 'bytes', 'record'] as const)
      : [channel]
    ).flatMap<ILockKey>((target) =>
      target === 'value'
        ? [lockKey.text(key)]
        : target === 'record'
          ? [lockKey.record(key)]
          : typeof key === 'string'
            ? [lockKey.bytes(key)]
            : []
    )

  /** Channel/range identity is prepared once, before the original provider may wait. */
  const rootClear = (
    method: string,
    channel: 'value' | 'bytes' | 'record' | undefined,
    ctx?: IWriteOptions
  ): Promise<void> =>
    rootMutation(
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
          const { id } = assertTransactionOwner(construction.store, scope)
          const transaction = nativeTransactions.get(id)
          if (transaction === undefined)
            throw new StorageContractError(StorageContractErrorCode.invalidArgument)
          return transaction.clearRoot(captured)
        }
      })
    )

  const store: IIndexedDbStore<TValue> = {
    backend: StorageBackend.indexedDb,
    capabilities,
    inspectLocks: (ctx) =>
      withAbort(ctx, async (_signal, _context, operationRuntime) => {
        assertLive()
        /** Inspections observe this registration while the physical port remains shared by the DB. */
        const stages = runtime.stageBindings.concurrencyStages(construction.store)
        observeIndexedDbStage(stages, 'beforeLockInspect', operationRuntime)
        try {
          const locks = coordination.keyPort.inspectLocks()
          observeIndexedDbStage(stages, 'afterLockInspect', operationRuntime, locks.length)
          return locks
        } catch (error) {
          const failure = normalizeIndexedDbOperationError(error)
          observeIndexedDbStage(stages, 'onLockInspectError', operationRuntime, failure.code)
          throw failure
        }
      }),
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
    putIndexedRecord: (value, key, handle, projection, ctx) =>
      rootMutation(
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
    iterateRecordIndex: (query, ctx) =>
      withStorageIteratorResource(
        (async function* (query: IRecordIndexQuery, _ctx?: IOperationContext) {
          assertLive()
          if (!isValidIndexGeneration(query.handle.generation)) throw staleIndexHandleError()
          /** One deadline and abort subscription belong to the entire iterator, including yields. */
          const runtime = createStorageOperationRuntime()
          const { signal, dispose: disposeSignal, context } = mergeSignals(_ctx, runtime.reporter)
          try {
            throwIfAborted(signal)
            if (!keyRange)
              throw new StorageError(StorageErrorCode.unavailable, {
                backend: StorageBackend.indexedDb,
                cause: new Error('IDBKeyRange is unavailable; pass options.keyRange explicitly')
              })
            const range = snapshotKeyRange(query.range, StorageBackend.indexedDb)
            const direction: IDBCursorDirection = query.direction === 'prev' ? 'prev' : 'next'
            const prefix: IDBValidKey[] = [query.handle.scope, query.index, query.handle.generation]
            /** Bounded per short readonly transaction; keeps pages small and predictable. */
            const pageSize = INDEX_QUERY_PAGE_SIZE
            /**
             * `{global, scope}` mutation-epoch vector observed on the first page; every later page
             * must match.
             */
            let expectedEpoch: { readonly global: number; readonly scope: number } | undefined
            /**
             * Full sidecar primary key ([scope, indexName, generation, indexValue, recordKey]) of
             * the last cursor position visited. The `lookup` index key alone ([scope, indexName,
             * generation, indexValue]) is not unique when an index value is shared by multiple
             * records, so a page boundary falling inside such a tied group must resume by primary
             * key, not by index key: the next page's range is bounded _inclusively_ at the boundary
             * group's index key (so remaining ties are not dropped), and every cursor entry already
             * emitted is then skipped by comparing full primary keys until this position is
             * passed.
             */
            let continuation: IDBValidKey[] | undefined
            let emitted = 0
            let exhausted = false
            while (!exhausted) {
              assertLive()
              throwIfAborted(signal)
              if (query.limit !== undefined && emitted >= query.limit) break
              const page: Array<[IStorageKey, TValue]> = []
              let cursorExhausted = true
              await withMutationLease((lease) =>
                runTransaction(
                  async (scope) => {
                    const { id } = assertTransactionOwner(construction.store, scope)
                    const nativeState = nativeTransactions.get(id)
                    if (nativeState === undefined)
                      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
                    const transaction = nativeState.native
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
                    else if (
                      expectedEpoch.global !== globalEpoch ||
                      expectedEpoch.scope !== scopeEpoch
                    )
                      throw new StorageError(
                        StorageErrorCode.indexQueryInvalidated,
                        { backend: StorageBackend.indexedDb },
                        StorageErrorText.indexQueryInvalidated
                      )
                    const state = (await fromIdbRequest(
                      transaction
                        .objectStore(META_STORE_NAME)
                        .get(indexMetadataKey(query.handle.scope)),
                      { signal },
                      runtime
                    )) as
                      | { handle?: IRecordIndexHandle; readiness?: IRecordIndexReadiness }
                      | undefined
                    if (state?.handle?.generation !== query.handle.generation)
                      throw staleIndexHandleError()
                    if (state.readiness?.status !== 'complete')
                      throw new StorageError(StorageErrorCode.unavailable, {
                        backend: StorageBackend.indexedDb,
                        cause: new Error(
                          'record index is not complete; caller must use fallback scan'
                        )
                      })
                    const index = transaction.objectStore(INDEX_RECORDS_STORE_NAME).index('lookup')
                    /**
                     * The boundary group's index key ([scope, indexName, generation, indexValue])
                     * is bound inclusively so records tied with the last-visited entry are not
                     * dropped; already-visited ties are skipped below by comparing full primary
                     * keys.
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
                    if (
                      cursor !== null &&
                      continuation !== undefined &&
                      continuationIndexKey !== undefined
                    ) {
                      /**
                       * The inclusive range may land the fresh cursor before, exactly at, or
                       * already past the last-visited entry, and each case needs different
                       * handling: `continuePrimaryKey` throws `DataError` if asked to move to a
                       * position at-or-before the cursor's _current_ one (per spec, even requesting
                       * the cursor's own exact position is rejected), so an exact match must use a
                       * plain single-step `continue()` instead, and an already-past position needs
                       * no skip at all. When the cursor is still strictly before the previous
                       * continuation (earlier not-yet-skipped ties in the same index-key group),
                       * `continuePrimaryKey` jumps straight past it in one engine-side seek. Either
                       * branch is O(1) regardless of tie-group size, unlike a JS walk over every
                       * already-emitted tied entry, which would be `Θ(G)` per page and quadratic
                       * across a group spanning multiple pages (paging requires `O(pageSize)` per
                       * page to avoid resource exhaustion).
                       */
                      const currentPrimaryKey = cursor.primaryKey as IDBValidKey[]
                      const comparison = compareStorageKeys(
                        currentPrimaryKey as unknown as IStorageKey,
                        continuation as unknown as IStorageKey
                      )
                      const isBeforeContinuation =
                        direction === 'prev' ? comparison > 0 : comparison < 0
                      if (isBeforeContinuation) {
                        /**
                         * `continuePrimaryKey` finds the first record whose (index key, primary
                         * key) is _inclusive_ of the given pair — it may land exactly back on
                         * `continuation` itself if that sidecar row still exists, not strictly past
                         * it. The single `.continue()` correction below then steps past it
                         * deterministically.
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
                        const value = await scope.getRecord(recordKey)
                        if (value === undefined && !(await nativeState.expiredRecord(recordKey)))
                          runtime.reporter(
                            new StorageError(
                              StorageErrorCode.indexOrphan,
                              { backend: StorageBackend.indexedDb, key: recordKey },
                              StorageErrorText.indexOrphan
                            )
                          )
                        else if (value !== undefined) page.push([recordKey, value])
                      }
                      cursor.continue()
                      cursor = (await fromIdbRequest(
                        cursorRequest,
                        { signal },
                        runtime
                      )) as IDBCursor | null
                    }
                    cursorExhausted = cursor === null
                    // Account only this page's own TTL removals; unrelated between-page mutations still invalidate.
                    expectedEpoch = await nativeState.recordEpoch(query.handle.scope)
                  },
                  { signal, ...(context?.orgId === undefined ? {} : { orgId: context.orgId }) },
                  lease,
                  false,
                  {
                    executeAttempt: (_context, proceed) => proceed(),
                    lock: () => [],
                    ranges: () => [
                      {
                        channel: 'record',
                        ...snapshotConcurrencyLockRange(
                          { channel: 'record' },
                          StorageBackend.indexedDb
                        )
                      }
                    ],
                    notification: { channel: 'record', kind: 'remove' }
                  }
                )
              )
              for (const entry of page) {
                throwIfAborted(signal)
                if (query.limit !== undefined && emitted >= query.limit) {
                  exhausted = true
                  break
                }
                emitted += 1
                yield entry
              }
              if (cursorExhausted) exhausted = true
            }
          } finally {
            disposeSignal()
          }
        })(query, ctx),
        { execution: runtime.execution, operation: StorageOperation.indexedDbCursor, ctx }
      ),
    transactionIndexed: (handle, run, ctx) =>
      withMutationLease((lease) =>
        runTransaction(
          (scope) => {
            if (!isValidIndexGeneration(handle.generation)) throw staleIndexHandleError()
            return run(scope)
          },
          ctx,
          lease
        )
      ),
    /** Only the original native builder executes restored images; core journal owns undo validation. */
    ...(runtime.journal === undefined
      ? {}
      : {
          undo: async (txId: string, ctx?: IOperationContext) => {
            assertLive()
            const release = controller.beginMutation()
            return runWithConcurrency<{ readonly txId: string }>(
              {
                store,
                options: ctx ?? {},
                prepare: () => runtime.journal!.prepare()
              },
              {
                attempt: async (context) => ({
                  status: 'committed',
                  value: await runtime.journal!.undo(txId, (keys, work) =>
                    createTransactionBuilder(store, context, runtime.getChainMethods('tx'))
                      .lock(keys[0]!, ...keys.slice(1))
                      .run(work)
                  )
                })
              }
            ).finally(release)
          }
        }),
    // sync 未定义：IndexedDB 无同步 API。

    dispose: () => {
      prepareState = 'disposed'
      for (const transaction of nativeTransactions.values()) transaction.abort()
      return controller.dispose()
    },
    [asyncDisposeKey]: () =>
      (symbolicDispose ??= store
        .dispose()
        .catch((error) => reportCleanupError(createStorageOperationReporter(), error))),

    get: (key, ctx) =>
      runtime.journal !== undefined
        ? rootRead('get', [key, ctx] as const, ctx, 'value', (scope, [key]) => scope.get(key))
        : withAbort(ctx, async (signal, _context, runtime) => {
            assertLive()
            assertStringStorageKey(key, StorageBackend.indexedDb)
            const value = await readFrom(
              kvStoreName,
              (store) => store.get(key) as IDBRequest<unknown>,
              signal,
              runtime,
              async (value, access) =>
                (await access.ttlAccess.present('value', key)) ? value : undefined
            )
            return typeof value === 'string' ? value : null
          }),
    set: (key, value, ctx) =>
      rootMutation(
        'set',
        { key, value },
        ctx,
        { channel: 'value', kind: 'put' },
        ({ key, value }, context) => {
          assertStringStorageKey(key, StorageBackend.indexedDb)
          if (typeof value !== 'string')
            throw new StorageError(StorageErrorCode.invalidConfig, {
              backend: StorageBackend.indexedDb,
              key,
              cause: new TypeError(StorageErrorText.storageValueInvalid)
            })
          return {
            keys: rootKeys('value', key, context),
            run: (scope) => scope.set(key, value, context)
          }
        }
      ),
    remove: (key, ctx) =>
      rootMutation('remove', key, ctx, { channel: 'value', kind: 'remove' }, (key) => {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        return { keys: [lockKey.text(key)], run: (scope) => scope.remove(key) }
      }),
    has: (key, ctx) =>
      runtime.journal !== undefined
        ? rootRead('has', [key, ctx] as const, ctx, 'value', (scope, [key]) => scope.has(key))
        : withAbort(ctx, async (signal, _context, runtime) => {
            assertLive()
            assertStringStorageKey(key, StorageBackend.indexedDb)
            const value = await readFrom(
              kvStoreName,
              (store) => store.get(key) as IDBRequest<unknown>,
              signal,
              runtime,
              async (value, access) =>
                (await access.ttlAccess.present('value', key)) ? value : undefined
            )
            return value !== undefined
          }),
    keys: (ctx) =>
      runtime.journal !== undefined
        ? rootRead('keys', [ctx] as const, ctx, 'value', (scope) => journalNative(scope).readKeys())
        : withAbort(ctx, async (signal, _context, runtime) => {
            assertLive()
            const raw = await readFrom(
              kvStoreName,
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
          }),
    clearValues: (ctx) => rootClear('clearValues', 'value', ctx),
    clearAll: (ctx) => rootClear('clearAll', undefined, ctx),
    /**
     * Every mutation route is wired — `record` (`putRecord`/`deleteRecord`/
     * `clearRecords`/`transaction`/`transactionIndexed`/`migrateLegacyRecords`), `value`/`bytes`
     * (`set`/`remove`/`clearValues`/`setBytes`/`clearBytes`, including `writeWithConflict`'s
     * cross-channel eviction deletes), and `all` (`clearAll`) — each proven post-commit-only
     * against a real `IDBTransaction` (fires after `await committed`, never before, so an
     * aborted/rolled-back transaction is silent) and no-op-suppressed (a delete of an absent key or
     * a clear of an empty store publishes nothing). One deliberate exception, matching the memory
     * backend's own `checkCrossChannel(..., emitEvent: false)`: `transaction()` evicting a
     * `value`/`bytes` entry as a side effect of a `replace`-policy record write does not publish
     * its own event, on both backends, because that eviction is folded into the transaction's
     * single `record:batch` event rather than firing a standalone one mid-batch. That local matrix
     * is complete; admitted cross-page coordination additionally delivers a bounded metadata-only
     * hint to same-page handles and the realm transport, while non-admitted factories remain
     * fail-closed through the immutable capability snapshot.
     */
    /** Native text invalidations borrow the original controller and iterator resource owner. */
    watch: (key, ctx) => {
      assertLive()
      if (!capabilities.changeFeed)
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: StorageBackend.indexedDb
        })
      assertStringStorageKey(key, StorageBackend.indexedDb, 'watch key')
      return createBackendChangeIterator(controller, {
        orgId,
        channel: 'value',
        key,
        ctx,
        execute: (advance, context) =>
          runtime.execution.run(
            {
              operation: storageBackendOperation(StorageBackend.indexedDb, 'watch'),
              input: key,
              ctx: context
            },
            advance
          )
      })
    },
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
      runtime.journal !== undefined
        ? rootRead('getBytes', [key, ctx] as const, ctx, 'bytes', (scope, [key]) =>
            scope.getBytes(key)
          )
        : withAbort(ctx, async (signal, _context, runtime) => {
            assertLive()
            assertStringStorageKey(key, StorageBackend.indexedDb)
            const value = await readFrom(
              bytesStoreName,
              (store) => store.get(key) as IDBRequest<unknown>,
              signal,
              runtime,
              async (value, access) =>
                (await access.ttlAccess.present('bytes', key)) ? value : undefined
            )
            return readIndexedDbBytes(value)
          }),
    setBytes: (key, value, ctx) =>
      rootMutation(
        'setBytes',
        { key, value },
        ctx,
        { channel: 'bytes', kind: 'put' },
        ({ key, value }, context) => {
          assertStringStorageKey(key, StorageBackend.indexedDb)
          if (!isUint8Array(value))
            throw new StorageError(StorageErrorCode.invalidConfig, {
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
      ),
    /** Root bytes removal retains the exact native owner and no-op publication suppression. */
    removeBytes: (key, ctx) =>
      rootMutation('removeBytes', key, ctx, { channel: 'bytes', kind: 'remove' }, (key) => {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        return { keys: [lockKey.bytes(key)], run: (scope) => scope.removeBytes(key) }
      }),
    clearBytes: (ctx) => rootClear('clearBytes', 'bytes', ctx),

    getRecord: (key, ctx) =>
      runtime.journal !== undefined
        ? rootRead('getRecord', [key, ctx] as const, ctx, 'record', (scope, [key]) =>
            scope.getRecord(key)
          )
        : withAbort(ctx, async (signal, _context, runtime) => {
            assertLive()
            const keySnapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
            return readFrom(
              recordsStoreName,
              (store) => store.get(toIdbKey(keySnapshot)) as IDBRequest<TValue | undefined>,
              signal,
              runtime,
              async (value, access) =>
                (await access.ttlAccess.present('record', keySnapshot)) ? value : undefined
            )
          }),
    putRecord: (value, key, ctx) =>
      rootMutation(
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
      ),
    deleteRecord: (key, ctx) =>
      rootMutation('deleteRecord', key, ctx, { channel: 'record', kind: 'remove' }, (key) => {
        const captured = snapshotStorageKey(key, StorageBackend.indexedDb)
        return { keys: [lockKey.record(captured)], run: (scope) => scope.deleteRecord(captured) }
      }),
    clearRecords: (ctx) => rootClear('clearRecords', 'record', ctx),

    iterateRecords: (range, ctx) =>
      withStorageIteratorResource(
        (async function* (range?: IKeyRange, ctx?: IOperationContext) {
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
              const page = await withMutationLease(async (lease) => {
                if (runtimeJournal !== undefined)
                  return runTransaction(
                    async (scope) => {
                      const values: Array<[IStorageKey, TValue]> = []
                      for await (const entry of scope.iterateRecords(pageRange)) {
                        values.push(entry)
                        if (values.length >= pageSize) break
                      }
                      return values
                    },
                    { ...context, signal },
                    lease,
                    false,
                    {
                      read: true,
                      executeAttempt: (_context, proceed) => proceed(),
                      lock: () => [],
                      ranges: () => [],
                      notification: { channel: 'record', kind: 'remove' }
                    }
                  )
                const database = await open(runtime, lease)
                assertLive()
                const transaction = createTransaction(
                  database,
                  [
                    kvStoreName,
                    bytesStoreName,
                    recordsStoreName,
                    META_STORE_NAME,
                    REVISIONS_STORE_NAME,
                    INDEX_RECORDS_STORE_NAME
                  ],
                  'readwrite'
                )
                /**
                 * The original cursor owns this native lifetime; only physical mutations are
                 * shared.
                 */
                const access = createNativeDataAccess(
                  transaction,
                  undefined,
                  runtime,
                  (make) => fromIdbRequest(make(), undefined, runtime),
                  assertExpiryRemoval
                )
                const store = transaction.objectStore(recordsStoreName)
                const idbRange = toIdbRange(pageRange, keyRange)
                const request = idbRange ? store.openCursor(idbRange) : store.openCursor()
                const values = await new Promise<Array<[IStorageKey, TValue]>>(
                  (resolve, reject) => {
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
                     * Normalize every non-cancellation cursor failure at its owning operation
                     * boundary. A contract error penetrates whole (rule); only a web `StorageError`
                     * bridge wrapper is unwrapped before the cursor boundary assigns its own
                     * metadata.
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
                      try {
                        transaction.abort()
                      } catch {
                        finish(() =>
                          reject(
                            new StorageContractError(StorageContractErrorCode.aborted, {
                              cause: abortReason
                            })
                          )
                        )
                      }
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
                                  new Error(
                                    'IndexedDB transaction completed before cursor finished'
                                  )
                                )
                              )
                              return
                            }
                            for (const [channel, keys] of access.changed)
                              if (keys.size > 0)
                                publishChange({ channel, kind: 'remove', keys: [...keys.values()] })
                            resolve(values)
                          })
                        },
                        () =>
                          finish(() => reject(cursorFailure(readIdbTransactionError(transaction)))),
                        () =>
                          finish(() =>
                            reject(
                              cancelled
                                ? new StorageContractError(StorageContractErrorCode.aborted, {
                                    cause: abortReason
                                  })
                                : cursorFailure(readIdbTransactionError(transaction))
                            )
                          )
                      )
                      installIdbRequestHandlers(
                        request,
                        () => {
                          /**
                           * Native request callbacks retain their original activity window and
                           * error boundary.
                           */
                          void (async () => {
                            const cursor = readIdbRequestResult(request)
                            if (cursor === null || values.length >= pageSize) {
                              await access.finishIndexes()
                              cursorFinished = true
                              return
                            }
                            /** Read the original cursor fields before any extra TTL request can run. */
                            const key = cursor.key as IStorageKey
                            const value = cursor.value as TValue
                            if (await access.ttlAccess.present('record', key))
                              values.push([key, value])
                            if (values.length < pageSize) cursor.continue()
                            else {
                              await access.finishIndexes()
                              cursorFinished = true
                            }
                          })().catch((cause) => {
                            finish(() => reject(cursorFailure(cause)))
                            try {
                              transaction.abort()
                            } catch {
                              /* Native end already owns cleanup. */
                            }
                          })
                        },
                        () => finish(() => reject(cursorFailure(readIdbRequestError(request))))
                      )
                      disposeAbort = subscribeToAbort(signal, abort, runtime.reporter)
                    } catch (cause) {
                      finish(() =>
                        reject(
                          isStorageContractError(cause) ||
                            (cause instanceof StorageError &&
                              cause.code === StorageErrorCode.invalidConfig)
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
                  }
                )
                return values
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
        })(range, ctx),
        { execution: runtime.execution, operation: StorageOperation.indexedDbCursor, ctx }
      ),
    tx: () =>
      createTransactionBuilder(construction.store, undefined, runtime.getChainMethods('tx')),
    transaction: (run, ctx) => {
      assertLive()
      return withMutationLease((lease) => runTransaction(run, ctx, lease))
    }
  }
  registerRecordIndexBackfillStore(store, {
    prepare: async () => {
      await open(createStorageOperationRuntime())
    },
    ensureRecordIndexes,
    getRecordIndexReadiness: store.getRecordIndexReadiness,
    openBackfillSession
  })
  /** Queries use the shared planner and the original native cursor rather than another executor. */
  const recordApi: IRecordsApi<TValue> = {
    query: <R = TValue>() =>
      createRecordQuery<R>(
        {
          asyncDisposeKey,
          pushdown: recordQueryPushdown,
          execute: ({ ctx }) => store.iterateRecords(undefined, ctx)
        },
        runtime.getChainMethods('query')
      ),
    removeByPrefix: (prefix, ctx) =>
      rootMutation(
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
  /** A bound record API borrows only the exact view authorized by the canonical owner. */
  const transactionRecordApi = (scope: ITransactionScope): ITransactionRecordsApi<TValue> => ({
    query: <R = TValue>() =>
      createRecordQuery<R, undefined>(
        {
          pushdown: recordQueryPushdown,
          execute: () => scope.iterateRecords()
        },
        runtime.getChainMethods('query')
      ),
    removeByPrefix: (prefix) => {
      /** The native map grants no authority; membership is proved before the original handle lookup. */
      const { id } = assertTransactionOwner(construction.store, scope)
      /** This is the same record that owns native abort and physical termination. */
      const native = nativeTransactions.get(id)
      if (native === undefined)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      return native.removeRecordsByPrefix(scope, prefix)
    }
  })
  /** The real native handle is borrowed only after the original owner authorizes this view. */
  const transactionTtlApi = (scope: ITransactionScope): ITransactionTtlApi => {
    const { id } = assertTransactionOwner(construction.store, scope)
    const native = nativeTransactions.get(id)
    if (native === undefined)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    return native.ttl(scope)
  }
  /** Root TTL endpoints retain one original policy, native transaction and complete pipeline. */
  const ttlApi: ITtlApi = {
    expire: (target, ms, ctx) => {
      let channel: 'value' | 'bytes' | 'record' = 'value'
      return rootMutation(
        BrowserTtlMethod.expire,
        { target, ms },
        ctx,
        {
          get channel() {
            return channel
          },
          kind: 'batch'
        },
        (input) => {
          const captured = captureTtlTarget(input.target)
          assertStorageTtlDuration(input.ms, StorageBackend.indexedDb)
          channel = captured.channel === 'text' ? 'value' : captured.channel
          return { keys: [captured], run: (scope) => scope.use(ttl).expire(captured, input.ms) }
        }
      )
    },
    remaining: (target, ctx) => {
      let channel: 'value' | 'bytes' | 'record' = 'value'
      return rootMutation(
        BrowserTtlMethod.remaining,
        target,
        ctx,
        {
          get channel() {
            return channel
          },
          kind: 'batch'
        },
        (input) => {
          const captured = captureTtlTarget(input)
          channel = captured.channel === 'text' ? 'value' : captured.channel
          return { keys: [captured], run: (scope) => scope.use(ttl).remaining(captured) }
        }
      )
    },
    persist: (target, ctx) => {
      let channel: 'value' | 'bytes' | 'record' = 'value'
      return rootMutation(
        BrowserTtlMethod.persist,
        target,
        ctx,
        {
          get channel() {
            return channel
          },
          kind: 'batch'
        },
        (input) => {
          const captured = captureTtlTarget(input)
          channel = captured.channel === 'text' ? 'value' : captured.channel
          return { keys: [captured], run: (scope) => scope.use(ttl).persist(captured) }
        }
      )
    }
  }
  /** Counted observations enclose the original native root pipeline without another executor. */
  const runRootBatch = <I, R>(
    method: string,
    input: I,
    ctx: IWriteOptions | undefined,
    count: number | undefined,
    prepare: (input: I, context: IWriteOptions) => IRootPrepared<R>
  ): Promise<Awaited<R>> =>
    observeBrowserBatch(
      runtime,
      construction.store,
      storageBackendOperation(StorageBackend.indexedDb, method),
      count,
      () => rootMutation(method, input, ctx, { channel: 'value', kind: 'batch' }, prepare)
    )

  /** Standard root batches reuse the same native views and original concurrency/pipeline owner. */
  const batchApi: IBrowserBatchApi = {
    getMany: async (keys, ctx) => {
      assertLive()
      const captured = snapshotStorageBatchKeys(keys, StorageBackend.indexedDb)
      if (captured.length === 0) return []
      return runRootBatch(
        BrowserBatchMethod.getMany,
        captured.map((entry) => entry.key),
        ctx,
        captured.length,
        (keys) => {
          const entries = snapshotStorageBatchKeys(keys, StorageBackend.indexedDb)
          return {
            keys: entries
              .filter((entry, index) => entry.firstIndex === index)
              .map((entry) => lockKey.text(entry.key)),
            run: (scope) => scope.getMany(entries.map((entry) => entry.key))
          }
        }
      )
    },
    setMany: async (entries, ctx) => {
      assertLive()
      const captured = snapshotBrowserBatchEntries(entries, StorageBackend.indexedDb, true)
      if (captured.length === 0) return
      return runRootBatch(
        BrowserBatchMethod.setMany,
        captured.map(({ key, value, ttlMs }) => ({
          key,
          value,
          ...(ttlMs === undefined ? {} : { ttlMs })
        })),
        ctx,
        captured.length,
        (entries, context) => {
          const values = snapshotBrowserBatchEntries(entries, StorageBackend.indexedDb, true)
          return {
            keys: values.flatMap((entry) => rootKeys('value', entry.key, context)),
            run: (scope) => scope.setMany(values)
          }
        }
      )
    },
    removeMany: async (keys, ctx) => {
      assertLive()
      const captured = snapshotStorageBatchKeys(keys, StorageBackend.indexedDb)
      if (captured.length === 0) return 0
      return runRootBatch(
        BrowserBatchMethod.removeMany,
        captured.map((entry) => entry.key),
        ctx,
        captured.length,
        (keys) => {
          const entries = snapshotStorageBatchKeys(keys, StorageBackend.indexedDb)
          return {
            keys: entries
              .filter((entry, index) => entry.firstIndex === index)
              .map((entry) => lockKey.text(entry.key)),
            run: (scope) => scope.removeMany(entries.map((entry) => entry.key))
          }
        }
      )
    },
    removeByPrefix: async (prefix, ctx) => {
      assertLive()
      const captured = snapshotStorageKeyPrefix(prefix, StorageBackend.indexedDb)
      return runRootBatch(
        BrowserBatchMethod.removeByPrefix,
        captured.key,
        ctx,
        undefined,
        (prefix) => {
          const range = snapshotStorageKeyPrefix(prefix, StorageBackend.indexedDb)
          return {
            keys: [],
            ranges: [
              {
                channel: 'text',
                ...snapshotConcurrencyLockRange(
                  { channel: 'text', prefix: range.key },
                  StorageBackend.indexedDb
                )
              }
            ],
            run: (scope) => scope.removeByPrefix(range.key)
          }
        }
      )
    }
  }
  const construction = provideBackendConstruction(
    bindBrowserExecution(store, runtime, [
      'set',
      'remove',
      'setBytes',
      'removeBytes',
      'putRecord',
      'deleteRecord',
      'clearValues',
      'clearAll',
      'clearBytes',
      'clearRecords',
      'putIndexedRecord',
      ...(runtime.journal === undefined ? [] : ['get', 'has', 'keys', 'getBytes', 'getRecord'])
    ]),
    [
      implement(kv, browserKeyValueApi(store, batchApi), { forTransaction: (scope) => scope }),
      implement(records, recordApi, { forTransaction: transactionRecordApi }),
      implement(ttl, ttlApi, { forTransaction: transactionTtlApi })
    ],
    controller,
    () => {
      if (activeDatabase === undefined)
        throw new StorageError(StorageErrorCode.unavailable, { backend: StorageBackend.indexedDb })
      return activeDatabase
    },
    async () => {
      await open(createStorageOperationRuntime())
    }
  )
  transactionOwner = createTransactionOwner<TValue>(
    construction.store,
    normalizeIndexedDbOperationError,
    {
      activityMode: TransactionActivityMode.native,
      asyncDisposeKey,
      concurrencyStages: runtime.stageBindings.concurrencyStages(construction.store)
    }
  )
  /** Native close-pending drains existing transactions; deletion keeps the original opener sealed. */
  const dropData = (): Promise<void> => {
    assertLive()
    if (deleting !== undefined) return deleting
    /** Capture an opening already owned by this exact physical organization. */
    const pending = connection
    deleting = Promise.resolve()
      .then(async () => {
        /** A failed preparation acquired no successful connection and must not prevent deletion. */
        const opened = await pending?.then(
          (database) => database,
          () => undefined
        )
        const active = activeDatabase
        if (opened !== undefined) closeForTransition(opened)
        if (active !== undefined && active !== opened) closeForTransition(active)
        connection = undefined
        if (prepareState !== 'disposed') prepareState = 'idle'
        terminalPrepareFailure = undefined
        await new Promise<void>((resolve, reject) => {
          try {
            /** The native request waits for close-pending transactions and cooperating connections. */
            const request = factory.deleteDatabase(dbName)
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
            StorageErrorCode.unavailable,
            StorageOperation.indexedDbDelete
          )
        })
        journalGeneration = Object.freeze({})
        publishChange({ channel: 'all', kind: 'clear' })
      })
      .finally(() => {
        deleting = undefined
      })
    return deleting
  }
  /** Retain the original provider, transaction owner, and native deletion closure for every org. */
  const physical: IIndexedDbPhysical<TValue> = {
    ...construction,
    journalBinding: {
      requiresIndexedDbUndo: true,
      forOrg: (orgId) => (orgBinding?.resolve(orgId) ?? physical).journalBinding,
      lockTarget: (target) => indexedDbJournalTarget(target).lock,
      changes: (scope) => journalNative(scope).images.changes(),
      readImage: (scope, target) =>
        runTransactionOperation(scope, () => journalNative(scope).images.readImage(target)),
      writeImage: (scope, target, image) =>
        runTransactionOperation(scope, () => journalNative(scope).images.writeImage(target, image)),
      readRevision: (scope, target) =>
        runTransactionOperation(scope, () => journalNative(scope).images.readRevision(target)),
      openNamespace: async (prefix) => {
        assertLive()
        if (typeof prefix !== 'string' || prefix.length === 0)
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        if (keyRange === undefined)
          throw new StorageContractError(StorageContractErrorCode.unsupported)
        /** Private methods and cached index reads retain this original physical generation. */
        const generation = journalGeneration
        const authenticate = (scope: Omit<ITransactionScope, 'use'>) => {
          const info = assertTransactionOwner(construction.store, scope)
          const current = nativeTransactions.get(info.id)
          if (current === undefined)
            throw new StorageContractError(StorageContractErrorCode.invalidArgument)
          return { info, port: current.journal(scope, prefix) }
        }
        return createBackendJournalNamespace({
          assertLive: () => {
            assertLive()
            if (generation !== journalGeneration)
              throw new StorageContractError(StorageContractErrorCode.disposed)
          },
          closingSignal: controller.closingSignal,
          backend: StorageBackend.indexedDb,
          report: (error) => reportCleanupError(coordinationReporter, error),
          nativeAtomic: true,
          indexExclusive:
            webLocks === undefined && journalFactoryIsPrivate !== true ? false : undefined,
          reserve: (hold) =>
            runWithConcurrency(
              {
                store,
                options: { lock: [storageJournalLockKey(prefix, StorageJournalLock.resource)] },
                policy: ConcurrencyPolicy.fail()
              },
              {
                attempt: (context) =>
                  coordination.keyPort.attemptMetadata(
                    context,
                    {
                      status: ConcurrencyHolderState.held,
                      owner: controller.origin,
                      label: ownerLabel,
                      scope: 'local',
                      since: Date.now()
                    },
                    {
                      attempt: async () => {
                        if (webLocks !== undefined) {
                          /**
                           * Native Web Locks owns lifetime exclusion; no expiring metadata lease is
                           * substituted.
                           */
                          const name = encodeFlatStorageKey([
                            IndexedDbJournalLayout.resource,
                            dbName,
                            prefix
                          ])
                          await webLocks
                            .request(
                              name,
                              { mode: 'exclusive', ifAvailable: true },
                              async (lock) => {
                                if (lock === null)
                                  throw new StorageContractError(
                                    StorageContractErrorCode.lockRejected
                                  )
                                await hold()
                              }
                            )
                            .catch((cause: unknown) => {
                              throw normalizeIndexedDbOperationError(cause)
                            })
                        } else await hold()
                        return { status: 'committed', value: undefined }
                      }
                    },
                    runtime.stageBindings.concurrencyStages(construction.store),
                    controller.closingSignal
                  )
              }
            ),
          authenticate,
          transaction: (work) =>
            withMutationLease((lease) =>
              runTransaction(
                (scope) => work(authenticate(scope).port),
                { lock: [storageJournalLockKey(prefix, StorageJournalLock.head)] },
                lease,
                false,
                undefined,
                false
              )
            )
        })
      }
    },
    dropData,
    getPreparedClient: () => {
      assertLive()
      /** The original Feature executor already awaits this accessor inside its operation budget. */
      const prepared = () => {
        if (runtime.journal?.active())
          throw new StorageContractError(StorageContractErrorCode.unsupported, {
            backend: StorageBackend.indexedDb
          })
        /** A prepared physical connection retains its original identity and synchronous fast path. */
        if (prepareState === 'ready' && deleting === undefined && activeDatabase !== undefined)
          return activeDatabase
        return open(createStorageOperationRuntime())
      }
      return runtime.journal === undefined ? prepared() : runtime.journal.prepare().then(prepared)
    },
    getTransactionClient: (scope: object) => {
      /** Only the canonical owner can authorize a live view for this exact provided store. */
      const { id } = assertTransactionOwner(construction.store, scope)
      /** This lookup exposes the already-open native transaction and grants no new authority. */
      const native = nativeTransactions.get(id)
      if (native === undefined)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      /** Raw native Feature writes cannot bypass the selected commit image protocol. */
      if (runtime.journal?.active())
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: StorageBackend.indexedDb
        })
      return native.native
    }
  }
  /** Original organization constructions also supply exact native Feature clients. */
  const orgBinding = bindOrganizations
    ? createBrowserOrgBinding<
        IIndexedDbProvidedStore<TValue>,
        IDBDatabase,
        IIndexedDbPhysical<TValue>
      >(runtime, dbName, physical, (target, ports) =>
        indexedDbHost<TValue>(
          {
            dbName: target,
            kvStoreName,
            bytesStoreName,
            recordsStoreName,
            cleanupLegacyRecords,
            factory,
            journalFactoryIsPrivate,
            keyRange,
            owner: { label: ownerLabel }
          },
          ports,
          featureStoreNames,
          false
        )
      )
    : undefined
  return {
    ...physical,
    ...(orgBinding === undefined ? {} : { orgBinding }),
    getOrgClient: (orgId) => (orgBinding?.resolve(orgId) ?? physical).getPreparedClient(),
    getOrgTransactionClient: (scope, orgId) =>
      (orgBinding?.resolve(orgId) ?? physical).getTransactionClient(scope)
  }
}

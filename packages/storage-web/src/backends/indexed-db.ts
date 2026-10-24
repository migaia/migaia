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
  type IConcurrencyAttemptContext,
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

const CAPABILITIES: IStorageCapabilities = {
  batch: true,
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
}

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

/**
 * Raw-record firewall for `putRecord`/`deleteRecord`: a raw mutation bypasses the entity
 * repository's projection-aware planner, so any index built over the affected data may now be
 * wrong. Called inside the caller's existing readwrite transaction after the record write/delete
 * itself has been staged but before commit. Canonical entity keys affect only their own scope;
 * every other valid storage-key domain conservatively invalidates every registered scope because a
 * raw adapter cannot prove which entity projection it bypassed.
 */
type IRawMutationAuthority = {
  readonly canonicalScopes: readonly string[]
  readonly unscopedPresent: boolean
}
/** Marks an already admitted logical mutation; the controller owns its actual lease. */
type IMutationLeaseContext = object

type IPrepareState = 'idle' | 'running' | 'ready' | 'terminal' | 'disposed'

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

/** Each real root attempt captures its payload before logical admission; acquire waits reuse it. */
type IRootPrepared<TValue, R> = {
  readonly keys: readonly ILockKey[]
  readonly ranges?: ReturnType<IRootMode<Awaited<R>>['ranges']>
  readonly run: (scope: IIndexedDbTransactionScope<TValue>) => R
}
/** A physical IndexedDB construction owns its connection, layout, coordination and native ports. */
type IIndexedDbContext<TValue> = {
  /** Original options is captured before native construction begins. */
  readonly options: IIndexedDbOptions
  /** Original runtime is captured before native construction begins. */
  readonly runtime: IBackendRuntime
  /** Original declaredObjectStores is captured before native construction begins. */
  readonly declaredObjectStores: readonly string[]
  /** Original bindOrganizations is captured before native construction begins. */
  readonly bindOrganizations: boolean

  configuredDbName: string | undefined

  configuredKvStoreName: string | undefined

  configuredBytesStoreName: string | undefined

  configuredRecordsStoreName: string | undefined

  configuredCleanupLegacyRecords: boolean | undefined

  configuredFactory: IDBFactory | undefined

  /** Caller declaration never follows from a factory object's identity or wrapper shape. */
  journalFactoryIsPrivate: true | undefined

  configuredKeyRange: typeof IDBKeyRange | undefined

  /** Holder diagnostics are snapshotted independently from mutable caller configuration. */
  ownerLabel: string

  /** Snapshot the realm default factory once for capability admission and data-universe identity. */
  realmDefaultFactory: IDBFactory | undefined

  /** Snapshot the realm BroadcastChannel constructor once; construction must not open a database. */
  broadcastChannel: typeof BroadcastChannel | undefined

  /** Real persistent databases need the browser's native lifetime lock across participating pages. */
  webLocks: LockManager | undefined

  dbName: string

  kvStoreName: string

  bytesStoreName: string

  recordsStoreName: string

  cleanupLegacyRecords: boolean

  factory: IDBFactory

  keyRange: typeof IDBKeyRange | undefined

  configuredStoreNames: string[]

  /** Schema requirements are captured once before the existing opener can perform any I/O. */
  featureStoreNames: string[]

  /** One local monotonic clock shared by all private sessions in this store instance. */
  backfillMonotonicNow: ReturnType<typeof createMonotonicClock>

  /**
   * Context-local observations cannot cross realms because `performance.now()` origins are
   * incomparable.
   */
  backfillTakeoverObservations: Map<string, number>

  /** Physical deletion invalidates cached private log indexes without replacing the borrowed view. */
  journalGeneration: object

  /** Private commit-after controller shared by direct and Host-created exact stores. */
  controller: ReturnType<IBackendRuntime['createChangeController']>

  /** Symbol cleanup shares the controller's primary cleanup without exposing its rejection. */
  symbolicDispose: Promise<void> | undefined

  /** The original installation owns the physical database's default organization identity. */
  orgId: IBackendRuntime['defaultOrgId']

  /** One native epoch anchor retains the original installed scheduler as the elapsed-time owner. */
  ttlNow: ReturnType<typeof captureIndexedDbTtlClock>

  /** Report-only owner for malformed or unavailable coordination transport behavior. */
  coordinationReporter: ReturnType<typeof createStorageOperationReporter>

  /** One private registry member shared by every exact store in this physical data universe. */
  coordination: ReturnType<typeof acquireIndexedDbCoordination>

  /** Immutable capabilities reflect construction-time transport admission and never mutate later. */
  capabilities: IStorageCapabilities

  /** Brands the private context that an already-admitted logical operation may reuse. */
  mutationLeaseBrand: symbol

  // 只开一次库，之后所有事务复用同一个连接。失败时要清掉缓存，否则一次瞬时
  // 故障（另一个标签页正卡在旧版本上）会把这个实例永久毒死。
  connection: Promise<IDBDatabase> | undefined

  /** The original opener waits for its native delete request before admitting a new connection. */
  deleting: Promise<void> | undefined

  /** Shared preparation state; callers await the same attempt but own cancellation locally. */
  prepareState: IPrepareState

  terminalPrepareFailure: unknown

  /** Identifies the connection currently allowed to invalidate the cache. */
  activeDatabase: IDBDatabase | undefined

  /** The canonical owner is created once after the original provider refines this exact store. */
  transactionOwner: ReturnType<typeof createTransactionOwner<TValue>>

  /** Native handles are indexed only after contract ownership has authorized their live views. */
  nativeTransactions: Map<
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
  >

  /**
   * Iterator pages reuse the same optional backend journal port without shadowing operation
   * runtime.
   */
  runtimeJournal: IBackendRuntime['journal']

  store: IIndexedDbStore<TValue>

  /** Queries use the shared planner and the original native cursor rather than another executor. */
  recordApi: IRecordsApi<TValue>

  /** Root TTL endpoints retain one original policy, native transaction and complete pipeline. */
  ttlApi: ITtlApi

  /** Standard root batches reuse the same native views and original concurrency/pipeline owner. */
  batchApi: IBrowserBatchApi

  construction: IBackendConstruction<IIndexedDbProvidedStore<TValue>, IDBDatabase>

  /** Retain the original provider, transaction owner, and native deletion closure for every org. */
  physical: IIndexedDbPhysical<TValue>

  /** Original organization constructions also supply exact native Feature clients. */
  orgBinding:
    | ReturnType<
        typeof createBrowserOrgBinding<
          IIndexedDbProvidedStore<TValue>,
          IDBDatabase,
          IIndexedDbPhysical<TValue>
        >
      >
    | undefined
}
export function indexedDbHost<TValue = unknown>(
  options: IIndexedDbOptions,
  runtime: IBackendRuntime,
  declaredObjectStores: readonly string[] = [],
  bindOrganizations = true
): IIndexedDbConstruction<TValue> {
  /** Initialize native facts in original construction order before publishing any port. */
  const indexedDbContext = {
    options,
    runtime,
    declaredObjectStores,
    bindOrganizations
  } as IIndexedDbContext<TValue>

  captureIndexedDbConfiguration(indexedDbContext)

  resolveIndexedDbLayout(indexedDbContext)

  /** One local monotonic clock shared by all private sessions in this store instance. */
  initializeIndexedDbNativeState(indexedDbContext)
  indexedDbContext.store = createIndexedDbStore(indexedDbContext)

  /** Exact-store registries bind the public execution projection before capability publication. */
  indexedDbContext.store = bindBrowserExecution(indexedDbContext.store, indexedDbContext.runtime, [
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
    ...(indexedDbContext.runtime.journal === undefined
      ? []
      : ['get', 'has', 'keys', 'getBytes', 'getRecord'])
  ])

  registerIndexedDbBackfill(indexedDbContext)
  indexedDbContext.recordApi = createIndexedDbRecordApi(indexedDbContext)
  indexedDbContext.ttlApi = createIndexedDbTtlApi(indexedDbContext)
  indexedDbContext.batchApi = createIndexedDbBatchApi(indexedDbContext)

  indexedDbContext.construction = createIndexedDbConstruction(indexedDbContext)

  indexedDbContext.transactionOwner = createIndexedDbTransactionOwner(indexedDbContext)
  indexedDbContext.physical = createIndexedDbPhysical(indexedDbContext)

  /** Original organization constructions also supply exact native Feature clients. */
  indexedDbContext.orgBinding = createIndexedDbOrgBinding(indexedDbContext)
  return {
    ...indexedDbContext.physical,
    ...(indexedDbContext.orgBinding === undefined
      ? {}
      : { orgBinding: indexedDbContext.orgBinding }),
    getOrgClient: (orgId) =>
      (
        indexedDbContext.orgBinding?.resolve(orgId) ?? indexedDbContext.physical
      ).getPreparedClient(),
    getOrgTransactionClient: (scope, orgId) =>
      (
        indexedDbContext.orgBinding?.resolve(orgId) ?? indexedDbContext.physical
      ).getTransactionClient(scope)
  }
}

function recordRevisionKey<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  key: IStorageKey
): IDBValidKey {
  return [indexedDbContext.recordsStoreName, encodeFlatStorageKey(key)]
}

/** Private array key for the current index generation; public metadata strings are data only. */
function indexMetadataKey(scope: string): IDBValidKey {
  return [INTERNAL_META_NAMESPACE, 'index', scope]
}

/** Recover an internally-owned index scope without trusting forgeable public string keys. */
function readInternalIndexScope(key: IDBValidKey): string | undefined {
  return Array.isArray(key) &&
    key.length === 3 &&
    key[0] === INTERNAL_META_NAMESPACE &&
    key[1] === 'index' &&
    typeof key[2] === 'string'
    ? key[2]
    : undefined
}

/** Identifies one observed owner heartbeat within this IndexedDB context. */
function backfillTakeoverObservationKey(
  scope: string,
  generation: string,
  ownerToken: string,
  heartbeatRevision: number
): string {
  return `${scope}\u0000${generation}\u0000${ownerToken}\u0000${heartbeatRevision}`
}

/** Discard observations invalidated by a heartbeat revision or generation change. */
function clearBackfillTakeoverObservations<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  scope: string,
  generation: string
): void {
  const prefix = `${scope}\u0000${generation}\u0000`
  for (const key of indexedDbContext.backfillTakeoverObservations.keys())
    if (key.startsWith(prefix)) indexedDbContext.backfillTakeoverObservations.delete(key)
}

/** Names an archived generation without colliding with the current scope pointer. */
function indexGenerationMetadataKey(scope: string, generation: string): IDBValidKey {
  return [INTERNAL_META_NAMESPACE, 'index-stale', scope, encodeFlatStorageKey(generation)]
}

/** Creates the public error used when a raw mutation has rotated an index handle. */
function staleIndexHandleError(): StorageError {
  return new StorageError(
    StorageErrorCode.indexBackfillStale,
    { backend: StorageBackend.indexedDb },
    StorageErrorText.indexBackfillStale
  )
}

/**
 * Scope component of the `{global, scope}` mutation-epoch vector. Bumped atomically with every
 * `runIndexedTransaction` commit that mutates this scope's sidecar rows, so a paginated
 * `iterateRecordIndex` can detect an in-flight write between pages without re-scanning the whole
 * index.
 */
function indexScopeEpochKey(scope: string): IDBValidKey {
  return ['__storage_web_index_epoch__', scope]
}

/** Separate raw-firewall invalidations from planner writes during backfill. */
function indexRawEpochKey(scope: string): IDBValidKey {
  return ['__storage_web_raw_epoch__', scope]
}

/**
 * Scoped `META_STORE_NAME` cleanup for a raw `clearRecords`/`clearAll`: deletes only the
 * index-handle/readiness (`index:<scope>`) and repository migration-checkpoint
 * (`repository:<name>:migration`) keys this backend owns, inside the caller's existing transaction.
 * Never touches the backend's own legacy v1-to-v2 migration checkpoint
 * (`LEGACY_RECORDS_MIGRATION_KEY`) — deleting it would make `migrateLegacyRecords` silently re-copy
 * already-cleared legacy `documents` rows back into `records` on the next open — and never touches
 * arbitrary public `metadata` entries, which share this store but are not backend-owned.
 */
async function deleteOwnedMetaKeys<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  metaStore: IDBObjectStore,
  signal: AbortSignal | undefined,
  runtime: IStorageOperationRuntime
): Promise<void> {
  const keys = (await fromIdbRequest(metaStore.getAllKeys(), { signal }, runtime)) as IDBValidKey[]
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
async function deleteOwnedRevisionKeys(
  revisionStore: IDBObjectStore,
  signal: AbortSignal | undefined,
  runtime: IStorageOperationRuntime
): Promise<void> {
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
function archiveIndexGeneration<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  metaStore: IDBObjectStore,
  state: Record<string, unknown> | undefined,
  nextGeneration: string
): void {
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
function rotateIndexGeneration<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  metaStore: IDBObjectStore,
  metadataKey: IDBValidKey,
  state: Record<string, unknown> | undefined
): { readonly oldHandle: IRecordIndexHandle; readonly newHandle: IRecordIndexHandle } | undefined {
  if (state === undefined) return undefined
  const oldHandle = state.handle as IRecordIndexHandle | undefined
  if (oldHandle === undefined) return undefined
  const newHandle = {
    scope: oldHandle.scope,
    generation: createIndexGeneration(),
    fingerprint: oldHandle.fingerprint
  }
  archiveIndexGeneration(indexedDbContext, metaStore, state, newHandle.generation)
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

/** Classify a complete legacy batch once, independent of its physical key ordering. */
function classifyLegacyMutationBatch(keys: readonly IStorageKey[]): IRawMutationAuthority {
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

async function applyRawMutationFirewall<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  metaStore: IDBObjectStore,
  revisionStore: IDBObjectStore,
  sidecarStore: IDBObjectStore,
  key: IStorageKey | undefined,
  signal: AbortSignal | undefined,
  runtime: IStorageOperationRuntime,
  authority?: IRawMutationAuthority
): Promise<void> {
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
      rotateIndexGeneration(indexedDbContext, metaStore, metadataKey, state)
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
        sidecarStore.index('record').getAllKeys([canonicalScope, handle.generation, toIdbKey(key)]),
        { signal },
        runtime
      )
      for (const oldRow of oldRows as IDBValidKey[]) sidecarStore.delete(oldRow)
    }
    rotateIndexGeneration(indexedDbContext, metaStore, scopeKey, state)
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

async function ensureRecordIndexes<TValue>(
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

/** Open one metadata-owned backfill lease and expose immutable record batches. */
/** A native backfill session owns its existing lease token, heartbeat and checkpoint facts. */
type IIndexedDbBackfillSession<TValue> = {
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
/** Acquire a backfill session through the original controller mutation lease. */
async function openBackfillSession<TValue>(
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
/** Acquire and publish the same metadata-owned session in original native order. */
async function initializeIndexedDbBackfillSession<TValue>(
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

function assertSession<TValue>(sessionState: IIndexedDbBackfillSession<TValue>): void {
  if (sessionState.released)
    throw new StorageContractError(StorageContractErrorCode.disposed, {
      backend: StorageBackend.indexedDb
    })
}

async function readBatch<TValue>(
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
    throw new StorageError(StorageErrorCode.unavailable, {
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
/** Publish this acquired native session's original maintenance methods. */
function createIndexedDbBackfillMethods<TValue>(
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

function assertLive<TValue>(indexedDbContext: IIndexedDbContext<TValue>): void {
  indexedDbContext.controller.assertLive()
}

/** Private commit-after controller shared by direct and Host-created exact stores. */
function createIndexedDbController<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['controller'] {
  return indexedDbContext.runtime.createChangeController({
    backend: StorageBackend.indexedDb,
    platform: indexedDbContext.factory,
    options: {
      dbName: indexedDbContext.dbName,
      kvStoreName: indexedDbContext.kvStoreName,
      bytesStoreName: indexedDbContext.bytesStoreName,
      recordsStoreName: indexedDbContext.recordsStoreName
    },
    origin: `indexeddb:${createStorageToken()}`,
    finalize: async () => {
      /** Cleanup keeps transport and native connection failures in their original order. */
      const failures: unknown[] = []
      if (indexedDbContext.deleting !== undefined) {
        try {
          await indexedDbContext.deleting
        } catch (cause) {
          failures.push(cause)
        }
      }
      try {
        await indexedDbContext.coordination.dispose()
      } catch (cause) {
        failures.push(cause)
      }
      /** Detach cached references once; the original controller still owns this cleanup attempt. */
      const pending = indexedDbContext.connection
      const recoveryDatabase = indexedDbContext.activeDatabase
      indexedDbContext.connection = undefined
      indexedDbContext.activeDatabase = undefined
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
}

/** Reject work after disposal begins without invalidating already admitted transactions. */
function assertMutationAdmission<TValue>(indexedDbContext: IIndexedDbContext<TValue>): void {
  indexedDbContext.controller.assertLive()
}

/** Creates the package-private context passed through nested preparation work. */
function createMutationLeaseContext<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IMutationLeaseContext {
  return { [indexedDbContext.mutationLeaseBrand]: true } as IMutationLeaseContext
}

/** Serialize a mutation's complete planner/firewall lifetime under one top-level lease. */
async function withMutationLease<TValue, T>(
  indexedDbContext: IIndexedDbContext<TValue>,
  run: (lease: IMutationLeaseContext) => Promise<T>
): Promise<T> {
  assertMutationAdmission(indexedDbContext)
  const release = indexedDbContext.controller.beginMutation()
  const lease = createMutationLeaseContext(indexedDbContext)
  try {
    return await run(lease)
  } finally {
    release()
  }
}

/** Reuses an admitted lease for nested preparation, or owns one for standalone maintenance. */
async function withInternalMutationLease<TValue, T>(
  indexedDbContext: IIndexedDbContext<TValue>,
  run: (lease: IMutationLeaseContext) => Promise<T>,
  inheritedLease?: IMutationLeaseContext
): Promise<T> {
  if (inheritedLease !== undefined) return run(inheritedLease)
  const release = indexedDbContext.controller.beginMutation()
  const lease = createMutationLeaseContext(indexedDbContext)
  try {
    return await run(lease)
  } finally {
    release()
  }
}

/**
 * / change feed: local commit publication plus metadata-only coordination hints. Every publish here
 * happens only after the owning `IDBTransaction` has actually committed (`await committed`), never
 * before, so an aborted/rolled-back IndexedDB transaction fires nothing.
 */
/** Route existing post-commit events through the one private controller owner. */
function publishChange<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>
): void {
  const event = indexedDbContext.controller.publish({ ...change, orgId: indexedDbContext.orgId })
  if (event !== undefined) indexedDbContext.coordination.publish(event)
}

/** Attempt a host close without allowing it to replace the caller's owning failure. */
function tryCloseDatabase(database: IDBDatabase): unknown | undefined {
  try {
    database.close()
    return undefined
  } catch (cause) {
    return cause
  }
}

/** Close before a required state transition, retaining ownership when the host refuses. */
function closeForTransition<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  database: IDBDatabase
): void {
  const cause = tryCloseDatabase(database)
  if (cause !== undefined) {
    indexedDbContext.activeDatabase = database
    throw new StorageError(StorageErrorCode.unavailable, {
      backend: StorageBackend.indexedDb,
      operation: StorageOperation.indexedDbClose,
      cause
    })
  }
  if (indexedDbContext.activeDatabase === database) indexedDbContext.activeDatabase = undefined
}

/** Validate the fixed native layout before any metadata can influence backend authority. */
function validatePhysicalLayout<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  database: IDBDatabase
): void {
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

/** Layout/version conflicts are stable until an operator changes the database; other failures retry. */
function isTerminalPrepareFailure(cause: unknown): boolean {
  return (
    cause instanceof StorageError &&
    (cause.code === StorageErrorCode.invalidConfig ||
      cause.code === StorageErrorCode.versionUnsupported)
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
      if (!database.objectStoreNames.contains(indexedDbContext.recordsStoreName)) return
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
            INDEX_RECORDS_STORE_NAME,
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
      lastKey === undefined
        ? undefined
        : (indexedDbContext.keyRange?.lowerBound(lastKey, true) ?? undefined)
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
       * Preserve the host failure while assigning this cursor boundary's operation metadata. Only a
       * web `StorageError` bridge wrapper is unwrapped; a contract error stays whole so
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
          StorageErrorCode.unavailable,
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
                StorageErrorCode.transactionFailed,
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
          rejectOpen(cause ?? new Error('[storage-web] IndexedDB open failed'))
        }
      )
    } catch (cause) {
      failUpgrade(cause)
    }
  })
}

function open<TValue>(
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
          connected.onversionchange = () => {
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
          }
          connected.onclose = () => {
            // A stale close event from an older connection must not evict a newer cache entry.
            if (indexedDbContext.activeDatabase === connected) {
              indexedDbContext.activeDatabase = undefined
              indexedDbContext.connection = undefined
              if (indexedDbContext.prepareState === 'ready') indexedDbContext.prepareState = 'idle'
            }
          }
          indexedDbContext.activeDatabase = connected
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
          !database.objectStoreNames.contains(indexedDbContext.kvStoreName) ||
          !database.objectStoreNames.contains(indexedDbContext.recordsStoreName) ||
          !database.objectStoreNames.contains(indexedDbContext.bytesStoreName) ||
          !database.objectStoreNames.contains(REVISIONS_STORE_NAME) ||
          !database.objectStoreNames.contains(META_STORE_NAME) ||
          !database.objectStoreNames.contains(INDEX_RECORDS_STORE_NAME) ||
          !database
            .transaction(META_STORE_NAME, 'readonly')
            .objectStore(META_STORE_NAME)
            .indexNames.contains(IndexedDbTtlLayout.index) ||
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
              StorageErrorCode.unavailable,
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

function createTransaction(
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
      StorageErrorCode.transactionFailed,
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
async function readFrom<TValue, T>(
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
          INDEX_RECORDS_STORE_NAME
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
      StorageErrorCode.transactionFailed,
      StorageOperation.indexedDbRead
    )
  } finally {
    release()
  }
}

/** Every caller already holds a mutation lease; resolve only after the native write commits. */
async function writeTo<TValue>(
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
    const failure = new StorageError(StorageErrorCode.transactionFailed, {
      backend: StorageBackend.indexedDb,
      cause
    })
    await committed.catch(() => {})
    throw failure
  }
  await committed
}

/** Private journal methods authenticate exact live views through this original native registry. */
function journalNative<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  scope: Omit<ITransactionScope, 'use'>
) {
  const { id } = assertTransactionOwner(indexedDbContext.construction.store, scope)
  const current = indexedDbContext.nativeTransactions.get(id)
  if (current === undefined)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  return current
}

/** Lazy expiry is a write only when a live native target is actually removed. */
function assertExpiryRemoval<TValue>(
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
    this.journalImages = createIndexedDbJournalImages({
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
    this.ttlAccess = createIndexedDbTtlAccess({
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
        this.#native.objectStore(INDEX_RECORDS_STORE_NAME),
        key,
        this.#signal,
        this.#operationRuntime
      )
  }

  /** Canonical deletion can maintain existing sidecars without knowing a new projection. */
  deleteRecordSidecars = async (key: IStorageKey): Promise<boolean> => {
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
function createNativeDataAccess<TValue>(
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
type IIndexedDbLogicalTransaction<TValue, T> = {
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
function runTransaction<TValue, T>(
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
function rootMutation<TValue, I, R>(
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
function rootRead<TValue, I, R>(
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
function rootKeys(
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
function rootClear<TValue>(
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

function createIndexedDbStore<TValue>(
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
    ...createIndexedDbStoreIndexes(indexedDbContext),
    ...(indexedDbContext.runtime.journal === undefined
      ? {}
      : {
          undo: async (txId: string, ctx?: IOperationContext) => {
            assertLive(indexedDbContext)
            const release = indexedDbContext.controller.beginMutation()
            return runWithConcurrency<{ readonly txId: string }>(
              {
                store: indexedDbContext.store,
                options: ctx ?? {},
                prepare: () => indexedDbContext.runtime.journal!.prepare()
              },
              {
                attempt: async (context) => ({
                  status: 'committed',
                  value: await indexedDbContext.runtime.journal!.undo(txId, (keys, work) =>
                    createTransactionBuilder(
                      indexedDbContext.store,
                      context,
                      indexedDbContext.runtime.getChainMethods('tx')
                    )
                      .lock(keys[0]!, ...keys.slice(1))
                      .run(work)
                  )
                })
              }
            ).finally(release)
          }
        }),
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
function createIndexedDbRecordApi<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['recordApi'] {
  return {
    query: <R = TValue>() =>
      createRecordQuery<R>(
        {
          asyncDisposeKey,
          pushdown: recordQueryPushdown,
          execute: ({ ctx }) => indexedDbContext.store.iterateRecords(undefined, ctx)
        },
        indexedDbContext.runtime.getChainMethods('query')
      ),
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
function transactionRecordApi<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  scope: ITransactionScope
): ITransactionRecordsApi<TValue> {
  return {
    query: <R = TValue>() =>
      createRecordQuery<R, undefined>(
        {
          pushdown: recordQueryPushdown,
          execute: () => scope.iterateRecords()
        },
        indexedDbContext.runtime.getChainMethods('query')
      ),
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

/** The real native handle is borrowed only after the original owner authorizes this view. */
function transactionTtlApi<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  scope: ITransactionScope
): ITransactionTtlApi {
  const { id } = assertTransactionOwner(indexedDbContext.construction.store, scope)
  const native = indexedDbContext.nativeTransactions.get(id)
  if (native === undefined) throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  return native.ttl(scope)
}

/** Root TTL endpoints retain one original policy, native transaction and complete pipeline. */
function createIndexedDbTtlApi<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['ttlApi'] {
  return {
    expire: (target, ms, ctx) => {
      let channel: 'value' | 'bytes' | 'record' = 'value'
      return rootMutation(
        indexedDbContext,
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
        indexedDbContext,
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
        indexedDbContext,
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
}

/** Counted observations enclose the original native root pipeline without another executor. */
function runRootBatch<TValue, I, R>(
  indexedDbContext: IIndexedDbContext<TValue>,
  method: string,
  input: I,
  ctx: IWriteOptions | undefined,
  count: number | undefined,
  prepare: (input: I, context: IWriteOptions) => IRootPrepared<TValue, R>
): Promise<Awaited<R>> {
  return observeBrowserBatch(
    indexedDbContext.runtime,
    indexedDbContext.construction.store,
    storageBackendOperation(StorageBackend.indexedDb, method),
    count,
    () =>
      rootMutation(
        indexedDbContext,
        method,
        input,
        ctx,
        { channel: 'value', kind: 'batch' },
        prepare
      )
  )
}

/** Standard root batches reuse the same native views and original concurrency/pipeline owner. */
function createIndexedDbBatchApi<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['batchApi'] {
  return {
    getMany: async (keys, ctx) => {
      assertLive(indexedDbContext)
      const captured = snapshotStorageBatchKeys(keys, StorageBackend.indexedDb)
      if (captured.length === 0) return []
      return runRootBatch(
        indexedDbContext,
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
      assertLive(indexedDbContext)
      const captured = snapshotBrowserBatchEntries(entries, StorageBackend.indexedDb, true)
      if (captured.length === 0) return
      return runRootBatch(
        indexedDbContext,
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
      assertLive(indexedDbContext)
      const captured = snapshotStorageBatchKeys(keys, StorageBackend.indexedDb)
      if (captured.length === 0) return 0
      return runRootBatch(
        indexedDbContext,
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
      assertLive(indexedDbContext)
      const captured = snapshotStorageKeyPrefix(prefix, StorageBackend.indexedDb)
      return runRootBatch(
        indexedDbContext,
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
}

/** Native close-pending drains existing transactions; deletion keeps the original opener sealed. */
function dropData<TValue>(indexedDbContext: IIndexedDbContext<TValue>): Promise<void> {
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
          StorageErrorCode.unavailable,
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

/** Retain the original provider, transaction owner, and native deletion closure for every org. */
function createIndexedDbPhysical<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['physical'] {
  return {
    ...indexedDbContext.construction,
    journalBinding: createIndexedDbPhysicalJournal(indexedDbContext),
    dropData: () => dropData(indexedDbContext),
    getPreparedClient: () => {
      assertLive(indexedDbContext)
      /** The original Feature executor already awaits this accessor inside its operation budget. */
      const prepared = () => {
        if (indexedDbContext.runtime.journal?.active())
          throw new StorageContractError(StorageContractErrorCode.unsupported, {
            backend: StorageBackend.indexedDb
          })
        /** A prepared physical connection retains its original identity and synchronous fast path. */
        if (
          indexedDbContext.prepareState === 'ready' &&
          indexedDbContext.deleting === undefined &&
          indexedDbContext.activeDatabase !== undefined
        )
          return indexedDbContext.activeDatabase
        return open(indexedDbContext, createStorageOperationRuntime())
      }
      return indexedDbContext.runtime.journal === undefined
        ? prepared()
        : indexedDbContext.runtime.journal.prepare().then(prepared)
    },
    getTransactionClient: (scope: object) => {
      /** Only the canonical owner can authorize a live view for this exact provided store. */
      const { id } = assertTransactionOwner(indexedDbContext.construction.store, scope)
      /** This lookup exposes the already-open native transaction and grants no new authority. */
      const native = indexedDbContext.nativeTransactions.get(id)
      if (native === undefined)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      /** Raw native Feature writes cannot bypass the selected commit image protocol. */
      if (indexedDbContext.runtime.journal?.active())
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: StorageBackend.indexedDb
        })
      return native.native
    }
  }
}

/** Capture construction options and the supported realm ports before any native acquisition. */
function captureIndexedDbConfiguration<TValue>(indexedDbContext: IIndexedDbContext<TValue>): void {
  if (
    indexedDbContext.options === null ||
    typeof indexedDbContext.options !== 'object' ||
    Array.isArray(indexedDbContext.options)
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError('IndexedDB options must be an object')
    })

  try {
    indexedDbContext.configuredDbName = indexedDbContext.options.dbName
    indexedDbContext.configuredKvStoreName = indexedDbContext.options.kvStoreName
    indexedDbContext.configuredBytesStoreName = indexedDbContext.options.bytesStoreName
    indexedDbContext.configuredRecordsStoreName = indexedDbContext.options.recordsStoreName
    indexedDbContext.configuredCleanupLegacyRecords = indexedDbContext.options.cleanupLegacyRecords
    indexedDbContext.configuredFactory = indexedDbContext.options.factory
    indexedDbContext.journalFactoryIsPrivate = indexedDbContext.options.journalFactoryIsPrivate
    if (
      indexedDbContext.journalFactoryIsPrivate !== undefined &&
      indexedDbContext.journalFactoryIsPrivate !== true
    )
      throw new TypeError(StorageErrorText.indexedDbJournalFactoryIsolationInvalid)
    indexedDbContext.configuredKeyRange = indexedDbContext.options.keyRange
    /** Read the optional owner and its label only once during this store's construction. */
    const owner = indexedDbContext.options.owner
    if (
      owner !== undefined &&
      (typeof owner !== 'object' || owner === null || Array.isArray(owner))
    )
      throw new TypeError(StorageErrorText.indexedDbOwnerInvalid)
    indexedDbContext.ownerLabel = owner?.label ?? StorageBrowserOwnerLabel
    if (typeof indexedDbContext.ownerLabel !== 'string')
      throw new TypeError(StorageErrorText.indexedDbOwnerInvalid)
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause
    })
  }

  try {
    indexedDbContext.realmDefaultFactory = (globalThis as { indexedDB?: IDBFactory }).indexedDB
  } catch {
    indexedDbContext.realmDefaultFactory = undefined
  }

  try {
    indexedDbContext.broadcastChannel = (
      globalThis as { BroadcastChannel?: typeof BroadcastChannel }
    ).BroadcastChannel
  } catch {
    indexedDbContext.broadcastChannel = undefined
  }

  try {
    indexedDbContext.webLocks = globalThis.navigator?.locks
  } catch {
    indexedDbContext.webLocks = undefined
  }
}
/** Resolve and validate the original database layout before opening or binding resources. */
function resolveIndexedDbLayout<TValue>(indexedDbContext: IIndexedDbContext<TValue>): void {
  indexedDbContext.dbName =
    indexedDbContext.configuredDbName === undefined
      ? 'storage-web'
      : indexedDbContext.configuredDbName

  indexedDbContext.kvStoreName =
    indexedDbContext.configuredKvStoreName === undefined
      ? 'kv'
      : indexedDbContext.configuredKvStoreName

  indexedDbContext.bytesStoreName =
    indexedDbContext.configuredBytesStoreName === undefined
      ? 'bytes'
      : indexedDbContext.configuredBytesStoreName

  indexedDbContext.recordsStoreName =
    indexedDbContext.configuredRecordsStoreName === undefined
      ? 'records'
      : indexedDbContext.configuredRecordsStoreName

  indexedDbContext.cleanupLegacyRecords =
    indexedDbContext.configuredCleanupLegacyRecords === undefined
      ? false
      : indexedDbContext.configuredCleanupLegacyRecords

  indexedDbContext.factory = (
    indexedDbContext.configuredFactory === undefined
      ? indexedDbContext.realmDefaultFactory
      : indexedDbContext.configuredFactory
  ) as IDBFactory

  indexedDbContext.keyRange =
    indexedDbContext.configuredKeyRange === undefined
      ? (globalThis as { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange
      : indexedDbContext.configuredKeyRange

  if (
    indexedDbContext.journalFactoryIsPrivate === true &&
    (indexedDbContext.configuredFactory === undefined ||
      indexedDbContext.factory === indexedDbContext.realmDefaultFactory)
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError(StorageErrorText.indexedDbJournalFactoryMustBeInjected)
    })

  if (typeof indexedDbContext.cleanupLegacyRecords !== 'boolean')
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError('cleanupLegacyRecords must be a boolean')
    })

  if (!indexedDbContext.factory)
    throw new StorageError(StorageErrorCode.unavailable, { backend: StorageBackend.indexedDb })

  if (
    (typeof indexedDbContext.factory !== 'object' &&
      typeof indexedDbContext.factory !== 'function') ||
    indexedDbContext.factory === null ||
    typeof (indexedDbContext.factory as { open?: unknown }).open !== 'function'
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError('IndexedDB factory must provide open()')
    })

  if (
    indexedDbContext.keyRange !== undefined &&
    (typeof indexedDbContext.keyRange !== 'function' ||
      typeof (indexedDbContext.keyRange as typeof IDBKeyRange).bound !== 'function' ||
      typeof (indexedDbContext.keyRange as typeof IDBKeyRange).lowerBound !== 'function' ||
      typeof (indexedDbContext.keyRange as typeof IDBKeyRange).upperBound !== 'function')
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError('IDBKeyRange must provide bound/lowerBound/upperBound')
    })

  indexedDbContext.configuredStoreNames = [
    indexedDbContext.kvStoreName,
    indexedDbContext.bytesStoreName,
    indexedDbContext.recordsStoreName
  ]

  /** Schema requirements are captured once before the existing opener can perform any I/O. */
  indexedDbContext.featureStoreNames = [...indexedDbContext.declaredObjectStores]

  if (
    !isValidStoreName(indexedDbContext.dbName) ||
    indexedDbContext.configuredStoreNames.some((storeName) => !isValidStoreName(storeName)) ||
    new Set(indexedDbContext.configuredStoreNames).size !==
      indexedDbContext.configuredStoreNames.length ||
    indexedDbContext.configuredStoreNames.some((storeName) =>
      INTERNAL_STORE_NAMES.has(storeName)
    ) ||
    indexedDbContext.featureStoreNames.some(
      (name) =>
        !isValidStoreName(name) ||
        INTERNAL_STORE_NAMES.has(name) ||
        indexedDbContext.configuredStoreNames.includes(name)
    ) ||
    new Set(indexedDbContext.featureStoreNames).size !== indexedDbContext.featureStoreNames.length
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError(
        'IndexedDB channel store names must be non-empty, unique, and non-reserved'
      )
    })

  /** Preserve original name validation, then reject reserved org suffixes before native I/O. */
  if (indexedDbContext.bindOrganizations)
    resolveStorageNamespace(
      indexedDbContext.dbName,
      indexedDbContext.runtime.defaultOrgId,
      indexedDbContext.runtime.defaultOrgId
    )
}
/** Allocate the original connection, coordination and transaction registries in construction order. */
function initializeIndexedDbNativeState<TValue>(indexedDbContext: IIndexedDbContext<TValue>): void {
  indexedDbContext.backfillMonotonicNow = createMonotonicClock()

  /**
   * Context-local observations cannot cross realms because `performance.now()` origins are
   * incomparable.
   */
  indexedDbContext.backfillTakeoverObservations = new Map<string, number>()

  /** Physical deletion invalidates cached private log indexes without replacing the borrowed view. */
  indexedDbContext.journalGeneration = {}
  indexedDbContext.controller = createIndexedDbController(indexedDbContext)

  /** The original installation owns the physical database's default organization identity. */
  indexedDbContext.orgId = indexedDbContext.runtime.defaultOrgId

  /** One native epoch anchor retains the original installed scheduler as the elapsed-time owner. */
  indexedDbContext.ttlNow = captureIndexedDbTtlClock(
    indexedDbContext.runtime.featureExpose.getScheduler()
  )

  /** Report-only owner for malformed or unavailable coordination transport behavior. */
  indexedDbContext.coordinationReporter = createStorageOperationReporter()

  /** One private registry member shared by every exact store in this physical data universe. */
  indexedDbContext.coordination = acquireIndexedDbCoordination({
    factory: indexedDbContext.factory,
    realmDefaultFactory: indexedDbContext.realmDefaultFactory,
    broadcastChannel: indexedDbContext.broadcastChannel,
    dbName: indexedDbContext.dbName,
    layoutFingerprint: indexedDbLayoutFingerprint(
      indexedDbContext.kvStoreName,
      indexedDbContext.bytesStoreName,
      indexedDbContext.recordsStoreName
    ),
    ownOrigin: indexedDbContext.controller.origin,
    orgId: indexedDbContext.orgId,
    onChange: (change) => indexedDbContext.controller.publishExternal(change),
    report: (error) => reportCleanupError(indexedDbContext.coordinationReporter, error),
    createKeyLockPort: () => indexedDbContext.runtime.createKeyLockPort()
  })

  /** Immutable capabilities reflect construction-time transport admission and never mutate later. */
  indexedDbContext.capabilities = {
    ...CAPABILITIES,
    changeFeed: indexedDbContext.coordination.admitted
  }

  /** Brands the private context that an already-admitted logical operation may reuse. */
  indexedDbContext.mutationLeaseBrand = Symbol('indexeddb-mutation-lease')

  /** Shared preparation state; callers await the same attempt but own cancellation locally. */
  indexedDbContext.prepareState = 'idle'

  /** Native handles are indexed only after contract ownership has authorized their live views. */
  indexedDbContext.nativeTransactions = new Map<
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

  /**
   * Iterator pages reuse the same optional backend journal port without shadowing operation
   * runtime.
   */
  indexedDbContext.runtimeJournal = indexedDbContext.runtime.journal
}
/** Construct the original construction after its prerequisite native ports exist. */
function createIndexedDbConstruction<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['construction'] {
  return provideBackendConstruction(
    indexedDbContext.store,
    [
      implement(kv, browserKeyValueApi(indexedDbContext.store, indexedDbContext.batchApi), {
        forTransaction: (scope) => scope
      }),
      implement(records, indexedDbContext.recordApi, {
        forTransaction: (scope: ITransactionScope) => transactionRecordApi(indexedDbContext, scope)
      }),
      implement(ttl, indexedDbContext.ttlApi, {
        forTransaction: (scope: ITransactionScope) => transactionTtlApi(indexedDbContext, scope)
      })
    ],
    indexedDbContext.controller,
    () => {
      if (indexedDbContext.activeDatabase === undefined)
        throw new StorageError(StorageErrorCode.unavailable, { backend: StorageBackend.indexedDb })
      return indexedDbContext.activeDatabase
    },
    async () => {
      await open(indexedDbContext, createStorageOperationRuntime())
    }
  )
}
/** Construct the original transactionOwner after its prerequisite native ports exist. */
function createIndexedDbTransactionOwner<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['transactionOwner'] {
  return createTransactionOwner<TValue>(
    indexedDbContext.construction.store,
    normalizeIndexedDbOperationError,
    {
      activityMode: TransactionActivityMode.native,
      asyncDisposeKey,
      concurrencyStages: indexedDbContext.runtime.stageBindings.concurrencyStages(
        indexedDbContext.construction.store
      )
    }
  )
}
/** Construct the original orgBinding after its prerequisite native ports exist. */
function createIndexedDbOrgBinding<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['orgBinding'] {
  return indexedDbContext.bindOrganizations
    ? createBrowserOrgBinding<
        IIndexedDbProvidedStore<TValue>,
        IDBDatabase,
        IIndexedDbPhysical<TValue>
      >(
        indexedDbContext.runtime,
        indexedDbContext.dbName,
        indexedDbContext.physical,
        (target, ports) =>
          indexedDbHost<TValue>(
            {
              dbName: target,
              kvStoreName: indexedDbContext.kvStoreName,
              bytesStoreName: indexedDbContext.bytesStoreName,
              recordsStoreName: indexedDbContext.recordsStoreName,
              cleanupLegacyRecords: indexedDbContext.cleanupLegacyRecords,
              factory: indexedDbContext.factory,
              journalFactoryIsPrivate: indexedDbContext.journalFactoryIsPrivate,
              keyRange: indexedDbContext.keyRange,
              owner: { label: indexedDbContext.ownerLabel }
            },
            ports,
            indexedDbContext.featureStoreNames,
            false
          )
      )
    : undefined
}
/** Register backfill operations on the same native record store before capability publication. */
function registerIndexedDbBackfill<TValue>(indexedDbContext: IIndexedDbContext<TValue>): void {
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

/** Acquire through the original provider before invoking one native attempt. */
function runIndexedDbConcurrencyAttempt<TValue, T>(
  logicalTransaction: IIndexedDbLogicalTransaction<TValue, T>,
  context: IConcurrencyAttemptContext
): Promise<IConcurrencyAttempt<Awaited<T>>> {
  return logicalTransaction.indexedDbContext.coordination.keyPort.attempt(
    context,
    {
      status: ConcurrencyHolderState.held,
      owner: logicalTransaction.indexedDbContext.controller.origin,
      label: logicalTransaction.indexedDbContext.ownerLabel,
      scope: 'local',
      /** The provider captures the actual acquisition time after any logical wait. */
      get since() {
        return Date.now()
      }
    },
    {
      attempt: (context) => runIndexedDbAdmittedAttempt(logicalTransaction, context)
    },
    logicalTransaction.indexedDbContext.runtime.stageBindings.concurrencyStages(
      logicalTransaction.indexedDbContext.construction.store
    ),
    logicalTransaction.indexedDbContext.controller.closingSignal,
    logicalTransaction.root?.ranges()
  )
}
/** Run the original endpoint pipeline around exactly one admitted native callback. */
/** One admitted attempt owns native commit classification without changing retry policy. */
type IIndexedDbAdmittedAttempt<TValue, T> = {
  /** Original logicalTransaction belongs to this admitted provider attempt. */
  readonly logicalTransaction: IIndexedDbLogicalTransaction<TValue, T>
  /** Original context belongs to this admitted provider attempt. */
  readonly context: IConcurrencyAttemptContext

  /** The fixed journal selection belongs to the original logical operation. */
  selectedJournal: IBackendRuntime['journal']

  /** A final native conflict is normalized only after its original pipeline unwinds. */
  commitConflict: IConcurrencyAttempt<Awaited<T>> | undefined

  /** Only rethrowing this exact failure permits the canonical policy to retry. */
  commitFailure: StorageContractError | undefined
}
/** Execute exactly one admitted native callback through its original public pipeline. */
async function runIndexedDbAdmittedAttempt<TValue, T>(
  logicalTransaction: IIndexedDbLogicalTransaction<TValue, T>,
  context: IConcurrencyAttemptContext
): Promise<IConcurrencyAttempt<Awaited<T>>> {
  /** Commit classification stays private to this same provider attempt. */
  const attemptState = { logicalTransaction, context } as IIndexedDbAdmittedAttempt<TValue, T>
  attemptState.selectedJournal = attemptState.logicalTransaction.selectedJournal

  try {
    const value = attemptState.logicalTransaction.pipeline
      ? await attemptState.logicalTransaction.indexedDbContext.runtime.execution.run(
          {
            operation: StorageOperation.indexedDbTransaction,
            input: attemptState.logicalTransaction.run,
            ctx: attemptState.context
          },
          (run: (scope: IIndexedDbTransactionScope<TValue>) => T) =>
            attemptNative(attemptState, run)
        )
      : await attemptNative(attemptState, attemptState.logicalTransaction.run)
    return { status: 'committed', value }
  } catch (cause) {
    if (attemptState.commitConflict !== undefined && cause === attemptState.commitFailure)
      return attemptState.commitConflict
    throw cause
  }
}

/** Public transactions have one outer endpoint; internal roots use their operation. */
/** One native callback owns physical requests, private images and its original draft views. */
type IIndexedDbNativeCallback<TValue, T> = {
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
async function attemptNative<TValue, T>(
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
      INDEX_RECORDS_STORE_NAME,
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
    afterCommit: () => indexedDbNativeAfterCommit(nativeState)
  })

  await nativeState.journalAttempt?.settle?.()
  return nativeState.result
}

/** A current operation issues its own native request directly, including after awaits. */
function request<TValue, T, R>(
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
async function putNative<TValue, T>(
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
async function write<TValue, T>(
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
async function remove<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  channel: 'value' | 'bytes' | 'record',
  key: IStorageKey
): Promise<void> {
  await nativeState.removeNative(channel, key)
  await nativeState.ttlAccess.removed(channel, key)
}

/** Root clears reuse this transaction's stores, revisions and raw-record firewall. */
async function clearRoot<TValue, T>(
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
async function removePrefix<TValue, T>(
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
async function assertHandle<TValue, T>(
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

/** Execute only an already-authorized short-lived view through the original pipeline. */
function executeOperation<TValue, T, TScope extends ITransactionScope<unknown>, TInput, R>(
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
    ? observeBrowserBatch(
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
function recordIterator<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  scope: ITransactionScope<TValue>,
  range: IKeyRange | undefined,
  query?: IRecordIndexQuery
): IStorageIterator<[IStorageKey, TValue]> {
  /** Capture arguments during the first authorized advance, like the root generator. */
  let rangeSnapshot: IKeyRange | undefined
  let cursorRequest: IDBRequest<IDBCursorWithValue | null> | undefined
  let cursor: IDBCursorWithValue | undefined
  let emitted = 0
  return nativeState.attemptState.logicalTransaction.indexedDbContext.transactionOwner.registerIterator<
    ITransactionScope<TValue>,
    [IStorageKey, TValue]
  >(scope, {
    next: (view) =>
      executeOperation(
        nativeState,
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
              cursorRequest = nativeState.native
                .objectStore(
                  nativeState.attemptState.logicalTransaction.indexedDbContext.recordsStoreName
                )
                .openCursor(
                  toIdbRange(
                    rangeSnapshot,
                    nativeState.attemptState.logicalTransaction.indexedDbContext.keyRange
                  )
                )
            else {
              await assertHandle(nativeState, query.handle)
              if (
                nativeState.attemptState.logicalTransaction.indexedDbContext.keyRange === undefined
              )
                throw new StorageError(StorageErrorCode.unavailable, {
                  backend: StorageBackend.indexedDb
                })
              const direction = query.direction === 'prev' ? 'prev' : 'next'
              const prefix = [query.handle.scope, query.index, query.handle.generation]
              cursorRequest = nativeState.native
                .objectStore(INDEX_RECORDS_STORE_NAME)
                .index('lookup')
                .openCursor(
                  toIdbRecordIndexRange(
                    rangeSnapshot,
                    prefix,
                    nativeState.attemptState.logicalTransaction.indexedDbContext.keyRange,
                    direction,
                    undefined
                  ),
                  direction
                )
            }
          } else cursor?.continue()
          let next = await request(nativeState, () => cursorRequest!)
          while (next !== null) {
            cursor = next
            const recordKey =
              query === undefined
                ? (next.key as IStorageKey)
                : (next.value as { recordKey: IStorageKey }).recordKey
            if (await nativeState.ttlAccess.present('record', recordKey)) {
              emitted += 1
              if (query === undefined)
                return { done: false, value: [recordKey, next.value as TValue] }
              const value = (await request(nativeState, () =>
                nativeState.native
                  .objectStore(
                    nativeState.attemptState.logicalTransaction.indexedDbContext.recordsStoreName
                  )
                  .get(toIdbKey(recordKey))
              )) as TValue | undefined
              if (value === undefined)
                throw new StorageError(
                  StorageErrorCode.indexOrphan,
                  { backend: StorageBackend.indexedDb },
                  StorageErrorText.indexOrphan
                )
              return { done: false, value: [recordKey, value] }
            }
            if (query !== undefined && !(await nativeState.ttlAccess.expired('record', recordKey)))
              throw new StorageError(
                StorageErrorCode.indexOrphan,
                { backend: StorageBackend.indexedDb },
                StorageErrorText.indexOrphan
              )
            cursor.continue()
            next = await request(nativeState, () => cursorRequest!)
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

/** Every short-lived view closes over the same native transaction and complete method set. */
/** Each complete view borrows the same original native callback and transaction admission. */
type IIndexedDbScopeContext<TValue, T> = {
  /** The physical callback owns native data, signal, stages and terminal outcome. */
  readonly nativeState: IIndexedDbNativeCallback<TValue, T>
  /** The original transaction owner authenticates this exact public view. */
  scope: IIndexedDbTransactionScope<TValue>
}
/** Publish all native channel methods before adding the selected Feature API. */
function createScope<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>
): IIndexedDbTransactionScope<TValue> {
  /** No callback runs before this original view has finished construction. */
  const scopeState = { nativeState } as IIndexedDbScopeContext<TValue, T>
  scopeState.scope = {
    use: (capability) => useTransactionCapability(scopeState.scope, capability),
    ...createIndexedDbScopeBatch(scopeState),
    ...createIndexedDbScopeText(scopeState),
    ...createIndexedDbScopeBytes(scopeState),
    ...createIndexedDbScopeRecords(scopeState),
    ...createIndexedDbScopeIndexes(scopeState)
  }
  /** Feature methods attach to the same authentic native view. */
  const api =
    nativeState.attemptState.logicalTransaction.indexedDbContext.runtime.createTransactionApi(
      scopeState.scope
    )
  if (api !== undefined)
    Object.defineProperty(scopeState.scope, 'api', { value: api, enumerable: true })
  return scopeState.scope
}
/** Compose this authentic native scope's batch operations. */
function createIndexedDbScopeBatch<TValue, T>(
  scopeState: IIndexedDbScopeContext<TValue, T>
): Pick<
  IIndexedDbTransactionScope<TValue>,
  'removeByPrefix' | 'getMany' | 'setMany' | 'removeMany'
> {
  return {
    removeByPrefix: (prefix) =>
      runTransactionOperation(scopeState.scope, (view) => {
        const captured = snapshotStorageKeyPrefix(prefix, StorageBackend.indexedDb)
        return executeOperation(
          scopeState.nativeState,
          view,
          StorageTransactionOperation.removeByPrefix,
          undefined,
          () => removePrefix(scopeState.nativeState, 'value', captured),
          {}
        )
      }),
    getMany: (keys) =>
      runTransactionOperation(scopeState.scope, (view) => {
        const captured = snapshotStorageBatchKeys(keys, StorageBackend.indexedDb)
        if (captured.length === 0) return []
        return executeOperation(
          scopeState.nativeState,
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
                        if (!(await scopeState.nativeState.ttlAccess.present('value', key)))
                          return undefined
                        const value = await request(scopeState.nativeState, () =>
                          scopeState.nativeState.native
                            .objectStore(
                              scopeState.nativeState.attemptState.logicalTransaction
                                .indexedDbContext.kvStoreName
                            )
                            .get(toIdbKey(key))
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
      runTransactionOperation(scopeState.scope, (view) => {
        /** Every entry is captured and validated before the batch issues its first write. */
        const captured = snapshotBrowserBatchEntries(entries, StorageBackend.indexedDb, true)
        if (captured.length === 0) return
        return executeOperation(
          scopeState.nativeState,
          view,
          StorageTransactionOperation.setMany,
          { count: captured.length },
          async () => {
            for (const { key, value, ttlMs } of captured) {
              await write(
                scopeState.nativeState,
                'value',
                key,
                value,
                StorageConflictPolicy.conflict
              )
              if (ttlMs !== undefined)
                await scopeState.nativeState.ttlAccess.expire('value', key, ttlMs)
            }
          },
          { count: captured.length }
        )
      }),
    removeMany: (keys) =>
      runTransactionOperation(scopeState.scope, (view) => {
        const captured = snapshotStorageBatchKeys(keys, StorageBackend.indexedDb)
        if (captured.length === 0) return 0
        return executeOperation(
          scopeState.nativeState,
          view,
          StorageTransactionOperation.removeMany,
          { count: captured.length },
          async () => {
            let removed = 0
            for (let index = 0; index < captured.length; index += 1) {
              const { key, firstIndex } = captured[index]!
              if (firstIndex !== index) continue
              if (!(await scopeState.nativeState.ttlAccess.present('value', key))) continue
              await remove(scopeState.nativeState, 'value', key)
              removed += 1
            }
            return removed
          },
          { count: captured.length }
        )
      })
  }
}
/** Compose this authentic native scope's text operations. */
function createIndexedDbScopeText<TValue, T>(
  scopeState: IIndexedDbScopeContext<TValue, T>
): Pick<IIndexedDbTransactionScope<TValue>, 'get' | 'set' | 'remove' | 'has'> {
  return {
    get: (key) =>
      indexedDbScopeOperation(
        scopeState,
        StorageTransactionOperation.get,
        key,
        async (_view, key) => {
          assertStringStorageKey(key, StorageBackend.indexedDb)
          if (!(await scopeState.nativeState.ttlAccess.present('value', key))) return null
          const value = await request(scopeState.nativeState, () =>
            scopeState.nativeState.native
              .objectStore(
                scopeState.nativeState.attemptState.logicalTransaction.indexedDbContext.kvStoreName
              )
              .get(key)
          )
          return typeof value === 'string' ? value : null
        }
      ),
    set: (key, value, options) =>
      indexedDbScopeOperation(
        scopeState,
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
            scopeState.nativeState,
            'value',
            key,
            value,
            readTransactionConflictPolicy(options, StorageBackend.indexedDb)
          )
        }
      ),
    remove: (key) =>
      indexedDbScopeOperation(scopeState, StorageTransactionOperation.remove, key, (_view, key) => {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        return remove(scopeState.nativeState, 'value', key)
      }),
    has: (key) =>
      indexedDbScopeOperation(
        scopeState,
        StorageTransactionOperation.has,
        key,
        async (_view, key) => {
          assertStringStorageKey(key, StorageBackend.indexedDb)
          return scopeState.nativeState.ttlAccess.present('value', key)
        }
      )
  }
}
/** Compose this authentic native scope's bytes operations. */
function createIndexedDbScopeBytes<TValue, T>(
  scopeState: IIndexedDbScopeContext<TValue, T>
): Pick<IIndexedDbTransactionScope<TValue>, 'getBytes' | 'setBytes' | 'removeBytes'> {
  return {
    getBytes: (key) =>
      indexedDbScopeOperation(
        scopeState,
        StorageTransactionOperation.getBytes,
        key,
        async (_view, key) => {
          assertStringStorageKey(key, StorageBackend.indexedDb)
          if (!(await scopeState.nativeState.ttlAccess.present('bytes', key))) return null
          const value = await request(scopeState.nativeState, () =>
            scopeState.nativeState.native
              .objectStore(
                scopeState.nativeState.attemptState.logicalTransaction.indexedDbContext
                  .bytesStoreName
              )
              .get(key)
          )
          return readIndexedDbBytes(value)
        }
      ),
    setBytes: (key, value, options) =>
      indexedDbScopeOperation(
        scopeState,
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
          const snapshot =
            scopeState.nativeState.attemptState.logicalTransaction.root === undefined
              ? value.slice()
              : value
          return write(
            scopeState.nativeState,
            'bytes',
            key,
            snapshot,
            readTransactionConflictPolicy(options, StorageBackend.indexedDb)
          )
        }
      ),
    removeBytes: (key) =>
      indexedDbScopeOperation(
        scopeState,
        StorageTransactionOperation.removeBytes,
        key,
        (_view, key) => {
          assertStringStorageKey(key, StorageBackend.indexedDb)
          return remove(scopeState.nativeState, 'bytes', key)
        }
      )
  }
}
/** Compose this authentic native scope's records operations. */
function createIndexedDbScopeRecords<TValue, T>(
  scopeState: IIndexedDbScopeContext<TValue, T>
): Pick<
  IIndexedDbTransactionScope<TValue>,
  'getRecord' | 'putRecord' | 'deleteRecord' | 'iterateRecords'
> {
  return {
    getRecord: (key) =>
      indexedDbScopeOperation(
        scopeState,
        StorageTransactionOperation.getRecord,
        key,
        async (_view, key) => {
          const snapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
          if (!(await scopeState.nativeState.ttlAccess.present('record', snapshot)))
            return undefined
          return request(scopeState.nativeState, () =>
            scopeState.nativeState.native
              .objectStore(
                scopeState.nativeState.attemptState.logicalTransaction.indexedDbContext
                  .recordsStoreName
              )
              .get(toIdbKey(snapshot))
          ) as Promise<TValue | undefined>
        }
      ),
    putRecord: (value, key, options) =>
      indexedDbScopeOperation(
        scopeState,
        StorageTransactionOperation.putRecord,
        { value, key, options },
        async (_view, { value, key, options }) => {
          const snapshot = snapshotStorageKey(key ?? createStorageToken(), StorageBackend.indexedDb)
          const copy =
            scopeState.nativeState.attemptState.logicalTransaction.root === undefined
              ? snapshotWriteValue(value, snapshot)
              : value
          await write(
            scopeState.nativeState,
            'record',
            snapshot,
            copy,
            readTransactionConflictPolicy(options, StorageBackend.indexedDb)
          )
          return snapshot
        }
      ),
    deleteRecord: (key) =>
      indexedDbScopeOperation(
        scopeState,
        StorageTransactionOperation.deleteRecord,
        key,
        (_view, key) => {
          const snapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
          return remove(scopeState.nativeState, 'record', snapshot)
        }
      ),
    iterateRecords: (range) => recordIterator(scopeState.nativeState, scopeState.scope, range)
  }
}
/** Compose this authentic native scope's indexes operations. */
function createIndexedDbScopeIndexes<TValue, T>(
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
      recordIterator(scopeState.nativeState, scopeState.scope, query.range, query)
  }
}
/** Admit one scope operation before the original pipeline and native request. */
function indexedDbScopeOperation<TValue, T, TInput, R>(
  scopeState: IIndexedDbScopeContext<TValue, T>,
  name: string,
  input: TInput,
  run: (view: IIndexedDbTransactionScope<TValue>, input: TInput) => R
): Promise<Awaited<R>> {
  return runTransactionOperation(scopeState.scope, (view) =>
    executeOperation(scopeState.nativeState, view, name, input, run)
  )
}

/** The original native runner's callbacks retain the actual complete transaction scope. */
type IIndexedDbNativeRun<TValue, T> = Parameters<
  typeof runNativeIndexedDbTransaction<TValue, T, IIndexedDbTransactionScope<TValue>>
>[0]
/** Execute the original native registerNative phase under its existing transaction owner. */
function indexedDbNativeRegisterNative<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  ...args: Parameters<NonNullable<IIndexedDbNativeRun<TValue, T>['registerNative']>>
): ReturnType<NonNullable<IIndexedDbNativeRun<TValue, T>['registerNative']>> {
  const [scope, abort] = args
  const { id } = assertTransactionOwner(
    nativeState.attemptState.logicalTransaction.indexedDbContext.store,
    scope
  )
  nativeState.attemptState.logicalTransaction.indexedDbContext.nativeTransactions.set(
    id,
    createIndexedDbNativeRegistration(nativeState, abort)
  )
  return () => {
    nativeState.attemptState.logicalTransaction.indexedDbContext.nativeTransactions.delete(id)
  }
}
/** Execute the original native beforeCommit phase under its existing transaction owner. */
async function indexedDbNativeBeforeCommit<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  ...args: Parameters<NonNullable<IIndexedDbNativeRun<TValue, T>['beforeCommit']>>
): Promise<void> {
  const [scope] = args
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
        StorageErrorCode.indexUniqueConflict,
        { backend: StorageBackend.indexedDb },
        indexUniqueConflictText(indexName)
      )
  }
  await nativeState.finishIndexes()
  await nativeState.journalAttempt?.record(scope)
}
/** Execute the original native validateCommit phase under its existing transaction owner. */
function indexedDbNativeValidateCommit<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>
): ReturnType<NonNullable<IIndexedDbNativeRun<TValue, T>['validateCommit']>> {
  /** A retained value whose deadline elapsed cannot be committed as still live. */
  const expired = nativeState.ttlAccess.expiredObservation()
  if (expired !== undefined) {
    const key =
      expired.channel === 'value'
        ? lockKey.text(expired.key)
        : expired.channel === 'record'
          ? lockKey.record(expired.key)
          : lockKey.bytes(expired.key as string)
    nativeState.attemptState.commitFailure = new StorageContractError(
      StorageContractErrorCode.writeConflict,
      {
        backend: StorageBackend.indexedDb,
        keys: [key]
      }
    )
    nativeState.attemptState.commitConflict = {
      status: 'conflict',
      phase: 'commit',
      keys: [key],
      holder: undefined,
      cause: nativeState.attemptState.commitFailure
    }
    throw nativeState.attemptState.commitFailure
  }
  /** New logical holders are checked after real native work and before commit. */
  const held =
    nativeState.attemptState.logicalTransaction.indexedDbContext.coordination.keyPort.probe(
      readConcurrencyLockIdentities(nativeState.attemptState.context),
      nativeState.attemptState.logicalTransaction.root?.ranges(),
      nativeState.attemptState.context
    )
  if (held !== undefined) {
    nativeState.attemptState.commitFailure = new StorageContractError(
      StorageContractErrorCode.writeConflict,
      {
        backend: StorageBackend.indexedDb,
        keys: [held.key],
        holder: held.holder
      }
    )
    nativeState.attemptState.commitConflict = {
      status: 'conflict',
      phase: 'commit',
      keys: [held.key],
      holder: held.holder,
      cause: nativeState.attemptState.commitFailure
    }
    throw nativeState.attemptState.commitFailure
  }
}
/** Execute the original native afterCommit phase under its existing transaction owner. */
function indexedDbNativeAfterCommit<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>
): ReturnType<NonNullable<IIndexedDbNativeRun<TValue, T>['afterCommit']>> {
  if (nativeState.attemptState.logicalTransaction.root !== undefined) {
    /** Root publication retains its existing kind, order and no-op suppression. */
    const notification = nativeState.attemptState.logicalTransaction.root.notification
    if (notification.channel === 'all') {
      if (nativeState.changed.size > 0)
        publishChange(nativeState.attemptState.logicalTransaction.indexedDbContext, {
          channel: 'all',
          kind: 'clear'
        })
      return
    }
    const keys = nativeState.changed.get(notification.channel)
    if (keys !== undefined)
      publishChange(nativeState.attemptState.logicalTransaction.indexedDbContext, {
        channel: notification.channel,
        kind: notification.kind,
        ...(notification.kind === 'clear' ? {} : { keys: [...keys.values()] })
      })
    for (const channel of ['value', 'bytes', 'record'] as const) {
      if (channel === notification.channel) continue
      const displaced = nativeState.changed.get(channel)
      if (displaced !== undefined && displaced.size > 0)
        publishChange(nativeState.attemptState.logicalTransaction.indexedDbContext, {
          channel,
          kind: notification.displacedKind ?? 'remove',
          keys: [...displaced.values()]
        })
    }
    return
  }
  for (const channel of ['value', 'bytes', 'record'] as const) {
    const keys = nativeState.changed.get(channel)
    if (keys !== undefined && keys.size > 0)
      publishChange(nativeState.attemptState.logicalTransaction.indexedDbContext, {
        channel,
        kind: 'batch',
        keys: [...keys.values()]
      })
  }
}

/** The physical registry stores exactly the existing native operation table. */
type IIndexedDbNativeRegistration<TValue> =
  IIndexedDbContext<TValue>['nativeTransactions'] extends Map<string, infer V> ? V : never
/** Borrow the same native registration's readKeys operations without adding a resource owner. */
async function indexedDbRegistrationReadKeys<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>
): Promise<string[]> {
  const keys = await request(nativeState, () =>
    nativeState.native
      .objectStore(nativeState.attemptState.logicalTransaction.indexedDbContext.kvStoreName)
      .getAllKeys()
  )
  const live: string[] = []
  for (const key of keys) {
    assertStringStorageKey(key, StorageBackend.indexedDb, 'persisted value key')
    if (await nativeState.ttlAccess.present('value', key)) live.push(key)
  }
  return live
}
/** Borrow the same native registration's journal operations without adding a resource owner. */
function indexedDbRegistrationJournal<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  ...args: Parameters<IIndexedDbNativeRegistration<TValue>['journal']>
): ReturnType<IIndexedDbNativeRegistration<TValue>['journal']> {
  const [view, prefix] = args
  nativeState.journalTerminal ??= createIndexedDbJournalTerminal((error) =>
    reportCleanupError(nativeState.operationRuntime.reporter, error)
  )
  /** No raw native handle or commit right leaves this physical owner. */
  const metadata = createIndexedDbJournalView({
    scope: view,
    metadata: nativeState.native.objectStore(META_STORE_NAME),
    namespace: INTERNAL_META_NAMESPACE,
    prefix,
    keyRange: nativeState.attemptState.logicalTransaction.indexedDbContext.keyRange!,
    request: <R>(make: () => IDBRequest<R>) => request(nativeState, make)
  })
  return {
    onCommit: nativeState.journalTerminal.onCommit,
    onRollback: nativeState.journalTerminal.onRollback,
    onEnd: nativeState.journalTerminal.onEnd,
    run: (work) => runTransactionOperation(view, () => work(metadata))
  }
}
/** Private image methods use the registration's existing physical access and journal order. */
function createIndexedDbRegistrationImages<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>
): IIndexedDbNativeRegistration<TValue>['images'] {
  return {
    changes: nativeState.journalImages.changes,
    readImage: async (target) => {
      const row = indexedDbJournalTarget(target)
      if (row.metadata) {
        const deadline = await nativeState.ttlAccess.deadline(row.channel, row.key)
        return encodeStorageJournalImage(deadline !== undefined, deadline)
      }
      const name =
        row.channel === 'value'
          ? nativeState.attemptState.logicalTransaction.indexedDbContext.kvStoreName
          : row.channel === 'bytes'
            ? nativeState.attemptState.logicalTransaction.indexedDbContext.bytesStoreName
            : nativeState.attemptState.logicalTransaction.indexedDbContext.recordsStoreName
      const targetStore = nativeState.native.objectStore(name)
      const value: unknown = await request(nativeState, () => targetStore.get(toIdbKey(row.key)))
      const present =
        value !== undefined ||
        (await request(nativeState, () => targetStore.getKey(toIdbKey(row.key)))) !== undefined
      return encodeStorageJournalImage(
        present,
        row.channel === 'bytes' ? readIndexedDbBytes(value) : value,
        row.channel === 'bytes'
      )
    },
    writeImage: async (target, image) => {
      const row = indexedDbJournalTarget(target)
      const decoded = decodeStorageJournalImage(image, row.channel === 'bytes' && !row.metadata)
      if (row.metadata) {
        if (
          decoded.present &&
          (typeof decoded.value !== 'number' || !Number.isFinite(decoded.value))
        )
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        await nativeState.ttlAccess.restore(
          row.channel,
          row.key,
          decoded.present ? (decoded.value as number) : undefined
        )
      } else if (!decoded.present) await nativeState.removeNative(row.channel, row.key)
      else {
        if (row.channel === 'value' && typeof decoded.value !== 'string')
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        await putNative(nativeState, row.channel, row.key, decoded.value)
      }
    },
    readRevision: (target) => {
      const row = indexedDbJournalTarget(target)
      return nativeState.journalImages.revision(row.channel, row.key)
    }
  }
}
/** Borrow the same native registration's ttl operations without adding a resource owner. */
function indexedDbRegistrationTtl<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  ...args: Parameters<IIndexedDbNativeRegistration<TValue>['ttl']>
): ReturnType<IIndexedDbNativeRegistration<TValue>['ttl']> {
  const [scope] = args
  return {
    expire: (target, ms) =>
      runTransactionOperation(scope, (view) =>
        executeOperation(
          nativeState,
          view,
          StorageTransactionOperation.ttlExpire,
          { target, ms },
          async (_view, input) => {
            const target = captureTtlTarget(input.target)
            assertStorageTtlDuration(input.ms, StorageBackend.indexedDb)
            return nativeState.ttlAccess.expire(
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
          nativeState,
          view,
          StorageTransactionOperation.ttlRemaining,
          target,
          (_view, input) => {
            const target = captureTtlTarget(input)
            return nativeState.ttlAccess.remaining(
              target.channel === 'text' ? 'value' : target.channel,
              target.key
            )
          }
        )
      ),
    persist: (target) =>
      runTransactionOperation(scope, (view) =>
        executeOperation(
          nativeState,
          view,
          StorageTransactionOperation.ttlPersist,
          target,
          (_view, input) => {
            const target = captureTtlTarget(input)
            return nativeState.ttlAccess.persist(
              target.channel === 'text' ? 'value' : target.channel,
              target.key
            )
          }
        )
      )
  }
}
/** Assemble only the original native transaction's retained operation ports. */
function createIndexedDbNativeRegistration<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  abort: Parameters<NonNullable<IIndexedDbNativeRun<TValue, T>['registerNative']>>[1]
): IIndexedDbNativeRegistration<TValue> {
  return {
    native: nativeState.native,
    readKeys: () => indexedDbRegistrationReadKeys(nativeState),
    journal: (...args) => indexedDbRegistrationJournal(nativeState, ...args),
    images: createIndexedDbRegistrationImages(nativeState),
    abort,
    clearRoot: (channel: 'value' | 'bytes' | 'record' | undefined) =>
      clearRoot(nativeState, channel),
    expiredRecord: (key) => nativeState.ttlAccess.expired('record', key),
    recordEpoch: async (scope) => ({
      global:
        ((await request(nativeState, () =>
          nativeState.native.objectStore(REVISIONS_STORE_NAME).get(RECORD_EPOCH_KEY)
        )) as number) ?? 0,
      scope:
        (((await request(nativeState, () =>
          nativeState.native.objectStore(REVISIONS_STORE_NAME).get(indexScopeEpochKey(scope))
        )) as number) ?? 0) + (nativeState.indexedScopes.has(scope) ? 1 : 0)
    }),
    ttl: (...args) => indexedDbRegistrationTtl(nativeState, ...args),
    removeRecordsByPrefix: (scope, prefix) =>
      runTransactionOperation(scope, (view) => {
        const captured = snapshotStorageKeyPrefix(prefix, StorageBackend.indexedDb)
        return executeOperation(
          nativeState,
          view,
          StorageTransactionOperation.removeRecordsByPrefix,
          undefined,
          () => removePrefix(nativeState, 'record', captured)
        )
      })
  }
}

/** Execute the original session renew with its existing controller lease and native metadata. */
function indexedDbBackfillRenew<TValue>(
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
        : new StorageError(StorageErrorCode.unavailable, {
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
/** Execute the original session commitBatch with its existing controller lease and native metadata. */
/** One acquired native commit owns batch validation, sidecar writes and metadata publication. */
type IIndexedDbBackfillCommit<TValue> = {
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
/** Retain the session's existing mutation lease for the original complete native commit. */
function indexedDbBackfillCommitBatch<TValue>(
  sessionState: IIndexedDbBackfillSession<TValue>,
  batch: IRecordIndexBackfillBatch,
  commitCtx?: IOperationContext
): ReturnType<IRecordIndexBackfillSession<TValue>['commitBatch']> {
  return withMutationLease(sessionState.indexedDbContext, (lease) =>
    commitIndexedDbBackfillNative(sessionState, batch, commitCtx, lease)
  )
}
/** Commit the issued batch through its original IndexedDB transaction and failure cleanup. */
async function commitIndexedDbBackfillNative<TValue>(
  sessionState: IIndexedDbBackfillSession<TValue>,
  batch: IRecordIndexBackfillBatch,
  commitCtx: IOperationContext | undefined,
  lease: IMutationLeaseContext
): ReturnType<IRecordIndexBackfillSession<TValue>['commitBatch']> {
  /** Commit-local facts cannot outlive this original controller lease. */
  const commitState = { sessionState, batch, commitCtx, lease } as IIndexedDbBackfillCommit<TValue>

  assertSession(commitState.sessionState)

  commitState.commitOperation = snapshotOperationContext(commitState.commitCtx)

  throwIfAborted(commitState.commitOperation?.signal)

  commitState.batchPhase = commitState.batch.phase ?? RecordIndexBackfillPhase.canonical

  if (
    commitState.batchPhase !== commitState.sessionState.currentPhase ||
    commitState.batch.generation !== commitState.sessionState.handle.generation ||
    commitState.batch.ownerToken !== commitState.sessionState.ownerToken
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })

  commitState.batchIdentity = JSON.stringify({
    phase: commitState.batchPhase,
    generation: commitState.batch.generation,
    ownerToken: commitState.batch.ownerToken,
    checkpoint:
      commitState.batch.checkpoint === undefined
        ? undefined
        : encodeFlatStorageKey(commitState.batch.checkpoint),
    nextCheckpoint:
      commitState.batch.nextCheckpoint === undefined
        ? undefined
        : encodeFlatStorageKey(commitState.batch.nextCheckpoint),
    endOfScan: commitState.batch.endOfScan,
    projections: commitState.batch.projections.map((projection) => ({
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

  commitState.commitRuntime = createStorageOperationRuntime()

  commitState.commitDatabase = await open(
    commitState.sessionState.indexedDbContext,
    commitState.commitRuntime,
    commitState.lease
  )

  commitState.transaction = createTransaction(
    commitState.commitDatabase,
    [
      commitState.sessionState.indexedDbContext.recordsStoreName,
      INDEX_RECORDS_STORE_NAME,
      REVISIONS_STORE_NAME,
      META_STORE_NAME
    ],
    'readwrite'
  )

  commitState.committed = idbTransactionCommit(
    commitState.transaction,
    { signal: commitState.commitOperation?.signal },
    commitState.commitRuntime
  )

  void commitState.committed.catch(() => {})

  try {
    /** Exact retries settle the original transaction without rewriting its sidecars. */
    const retried = await validateIndexedDbBackfillCommit(commitState)
    if (retried !== undefined) return retried
    /** All projection writes precede the original readiness and checkpoint publication. */
    const indexed = await applyIndexedDbBackfillProjection(commitState)
    return await finishIndexedDbBackfillCommit(commitState, indexed)
  } catch (cause) {
    try {
      commitState.transaction.abort()
    } catch {
      /* Transaction already settled. */
    }
    await commitState.committed.catch(() => {})
    throw cause
  }
}
/** Execute the original session fail with its existing controller lease and native metadata. */
function indexedDbBackfillFail<TValue>(
  sessionState: IIndexedDbBackfillSession<TValue>,
  ...args: Parameters<IRecordIndexBackfillSession<TValue>['fail']>
): ReturnType<IRecordIndexBackfillSession<TValue>['fail']> {
  const [cause, failCtx] = args
  return withMutationLease(sessionState.indexedDbContext, async (lease) => {
    assertSession(sessionState)
    const failOperation = snapshotOperationContext(failCtx)
    throwIfAborted(failOperation?.signal)
    const failRuntime = createStorageOperationRuntime()
    const failDatabase = await open(sessionState.indexedDbContext, failRuntime, lease)
    const transaction = createTransaction(failDatabase, META_STORE_NAME, 'readwrite')
    const metadata = transaction.objectStore(META_STORE_NAME)
    const state = (await fromIdbRequest(
      metadata.get(indexMetadataKey(sessionState.handle.scope)),
      { signal: failOperation?.signal },
      failRuntime
    )) as
      | {
          handle?: IRecordIndexHandle
          lease?: IBackfillLease
        }
      | undefined
    if (
      state?.handle?.generation !== sessionState.handle.generation ||
      state?.lease?.ownerToken !== sessionState.ownerToken
    )
      throw state?.handle?.generation !== sessionState.handle.generation
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
      indexMetadataKey(sessionState.handle.scope)
    )
    failRuntime.reporter(cause)
    try {
      await idbTransactionCommit(transaction, { signal: failOperation?.signal }, failRuntime)
    } catch (persistFailure) {
      throw createStorageAggregateError(
        StorageErrorCode.indexBackfillFailed,
        indexBackfillFailureText(sessionState.handle.scope),
        [cause, persistFailure]
      )
    }
    sessionState.released = true
  })
}
/** Admit the native scan domain and capture bounds before opening the database. */
function validateIndexedDbBackfillSession<TValue>(
  sessionState: IIndexedDbBackfillSession<TValue>
): void {
  assertLive(sessionState.indexedDbContext)

  if (!isValidIndexGeneration(sessionState.handle.generation)) throw staleIndexHandleError()

  sessionState.operation = snapshotOperationContext(sessionState.ctx)

  throwIfAborted(sessionState.operation?.signal)

  if (
    sessionState.options === null ||
    typeof sessionState.options !== 'object' ||
    Array.isArray(sessionState.options)
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })

  sessionState.physicalRange = snapshotKeyRange(
    sessionState.options.range,
    StorageBackend.indexedDb
  )

  sessionState.legacyPhysicalRange = snapshotKeyRange(
    sessionState.options.legacyRange,
    StorageBackend.indexedDb
  )

  sessionState.includeLegacy = sessionState.options.includeLegacy === true

  if (
    sessionState.physicalRange?.lower === undefined ||
    sessionState.physicalRange.upper === undefined ||
    typeof sessionState.options.allowComplete !== 'boolean'
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })

  sessionState.batchSize = sessionState.options.batchSize ?? LEGACY_MIGRATION_BATCH_SIZE

  sessionState.leaseMs = sessionState.options.leaseMs ?? INDEX_BACKFILL_DEFAULT_LEASE_MS

  if (
    !Number.isSafeInteger(sessionState.batchSize) ||
    sessionState.batchSize < INDEX_BACKFILL_MIN_BATCH_SIZE ||
    sessionState.batchSize > INDEX_BACKFILL_MAX_BATCH_SIZE
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })

  if (
    !Number.isSafeInteger(sessionState.leaseMs) ||
    sessionState.leaseMs < INDEX_BACKFILL_MIN_LEASE_MS ||
    sessionState.leaseMs > INDEX_BACKFILL_MAX_LEASE_MS
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })
}
/** Compare generation and heartbeat ownership in the original readwrite acquisition transaction. */
async function acquireIndexedDbBackfillLease<TValue>(
  sessionState: IIndexedDbBackfillSession<TValue>
): Promise<void> {
  if (sessionState.current?.handle?.generation !== sessionState.handle.generation)
    throw staleIndexHandleError()

  sessionState.readiness = sessionState.current.readiness ?? {
    status: 'pending',
    scanned: 0,
    indexed: 0
  }

  if (sessionState.readiness.status === 'complete') throw staleIndexHandleError()

  sessionState.phase = sessionState.current.phase ?? RecordIndexBackfillPhase.canonical

  if (
    sessionState.phase !== RecordIndexBackfillPhase.canonical &&
    sessionState.phase !== RecordIndexBackfillPhase.legacy
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })

  if (sessionState.phase === RecordIndexBackfillPhase.legacy && !sessionState.includeLegacy)
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })

  sessionState.currentLease = sessionState.current.lease

  if (sessionState.currentLease !== undefined) {
    const currentRevision = sessionState.currentLease.heartbeatRevision ?? 0
    const currentLeaseMs = sessionState.currentLease.leaseMs ?? INDEX_BACKFILL_DEFAULT_LEASE_MS
    const observationKey = backfillTakeoverObservationKey(
      sessionState.handle.scope,
      sessionState.handle.generation,
      sessionState.currentLease.ownerToken,
      currentRevision
    )
    const observedAtMonotonic =
      sessionState.indexedDbContext.backfillTakeoverObservations.get(observationKey)
    const nowMonotonic = sessionState.indexedDbContext.backfillMonotonicNow()
    if (observedAtMonotonic === undefined || nowMonotonic - observedAtMonotonic < currentLeaseMs) {
      if (observedAtMonotonic === undefined) {
        clearBackfillTakeoverObservations(
          sessionState.indexedDbContext,
          sessionState.handle.scope,
          sessionState.handle.generation
        )
        sessionState.indexedDbContext.backfillTakeoverObservations.set(observationKey, nowMonotonic)
      }
      try {
        sessionState.acquire.abort()
      } catch {
        /* The transaction may already have settled while the contender was reading. */
      }
      throw createBackfillContentionFailure()
    }
    clearBackfillTakeoverObservations(
      sessionState.indexedDbContext,
      sessionState.handle.scope,
      sessionState.handle.generation
    )
    // The readwrite transaction is the compare-and-swap boundary for takeover.
    sessionState.lease = {
      ownerToken: sessionState.ownerToken,
      heartbeatRevision: currentRevision + 1,
      leaseMs: currentLeaseMs
    }
  } else {
    clearBackfillTakeoverObservations(
      sessionState.indexedDbContext,
      sessionState.handle.scope,
      sessionState.handle.generation
    )
    sessionState.lease = {
      ownerToken: sessionState.ownerToken,
      heartbeatRevision: 0,
      leaseMs: sessionState.leaseMs
    }
  }

  /**
   * /042: only a genuinely fresh scan (starting from the range's beginning, i.e. no checkpoint yet)
   * takes a new raw-firewall epoch snapshot; a resumed session preserves the one from when this
   * scan actually began, so a raw write from an earlier resumed batch is still caught at completion
   * in `commitBatch`.
   */
  sessionState.scanStartRawEpoch =
    sessionState.current.scanStartRawEpoch === undefined
      ? (((await fromIdbRequest(
          sessionState.acquire
            .objectStore(REVISIONS_STORE_NAME)
            .get(indexRawEpochKey(sessionState.handle.scope)) as IDBRequest<number | undefined>,
          { signal: sessionState.operation?.signal },
          sessionState.runtime
        )) as number | undefined) ?? 0)
      : sessionState.current.scanStartRawEpoch
}
/** Prepare caller-decoded candidate projections within the original row and batch limits. */
async function prepareIndexedDbBackfillCandidates<TValue>(
  sessionState: IIndexedDbBackfillSession<TValue>,
  rawCandidates: readonly IRecordIndexBackfillCandidate<TValue>[],
  readOptions: IRecordIndexBackfillReadOptions<TValue> | undefined
) {
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
        sessionState.handle.scope,
        sessionState.handle.generation
      )
      assertBackfillProjectionLimits(metrics, 'record')
      if (preparation.decodedBytes > INDEX_BACKFILL_SOFT_CAP_BYTES) throw backfillDecodedTooLarge()
      if (decodedBytes + preparation.decodedBytes > INDEX_BACKFILL_SOFT_CAP_BYTES)
        throw backfillDecodedTooLarge()
      candidates.push(candidate)
      preparations.push(preparation)
      decodedBytes += preparation.decodedBytes
    }
  } else {
    for (const candidate of rawCandidates) {
      const valueBytes = safeJsonPayloadByteLength(candidate.raw)
      if (decodedBytes + valueBytes > INDEX_BACKFILL_SOFT_CAP_BYTES) throw backfillDecodedTooLarge()
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
      sessionState.handle.scope,
      sessionState.handle.generation
    )
    preparedProjectionRows += metrics.rows
    preparedProjectionBytes += metrics.bytes
  }
  assertBackfillProjectionLimits(
    { rows: preparedProjectionRows, bytes: preparedProjectionBytes },
    'batch'
  )
  return { candidates, preparations }
}

/** Validate current generation, lease, checkpoint, issued manifest and bounded projections. */
async function validateIndexedDbBackfillCommit<TValue>(
  commitState: IIndexedDbBackfillCommit<TValue>
): Promise<IRecordIndexReadiness | undefined> {
  commitState.metadata = commitState.transaction.objectStore(META_STORE_NAME)
  commitState.state = (await fromIdbRequest(
    commitState.metadata.get(indexMetadataKey(commitState.sessionState.handle.scope)),
    { signal: commitState.commitOperation?.signal },
    commitState.commitRuntime
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
  if (commitState.state?.handle?.generation !== commitState.sessionState.handle.generation)
    throw staleIndexHandleError()
  if (
    ((commitState.state?.phase as IRecordIndexBackfillPhase | undefined) ??
      RecordIndexBackfillPhase.canonical) !== commitState.batchPhase
  )
    throw staleIndexHandleError()
  if (commitState.state?.readiness?.status === 'complete') throw staleIndexHandleError()
  commitState.activeLease = commitState.state?.lease
  const retryReceipt = commitState.state?.lastBatchReceipt
  const isExactRetry =
    commitState.activeLease === undefined &&
    retryReceipt?.ownerToken === commitState.sessionState.ownerToken &&
    retryReceipt.heartbeatRevision === commitState.sessionState.sessionHeartbeatRevision &&
    retryReceipt.batchIdentity === commitState.batchIdentity
  if (commitState.activeLease?.ownerToken !== commitState.sessionState.ownerToken && !isExactRetry)
    throw staleIndexHandleError()
  if (isExactRetry) {
    await commitState.committed
    return commitState.state.readiness ?? { status: 'running', scanned: 0, indexed: 0 }
  }
  if (
    (commitState.state.checkpoint === undefined
      ? commitState.batch.checkpoint !== undefined
      : commitState.batch.checkpoint === undefined ||
        encodeFlatStorageKey(commitState.state.checkpoint) !==
          encodeFlatStorageKey(commitState.batch.checkpoint)) ||
    (commitState.state.checkpoint !== undefined &&
      commitState.batch.nextCheckpoint !== undefined &&
      compareStorageKeys(commitState.batch.nextCheckpoint, commitState.state.checkpoint) <= 0)
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })
  const issuedManifest = commitState.state.issued
  const issued = issuedManifest?.entries ?? []
  if (
    issuedManifest?.ownerToken !== commitState.sessionState.ownerToken ||
    issuedManifest.phase !== commitState.batchPhase ||
    issuedManifest.checkpoint !==
      (commitState.batch.checkpoint === undefined
        ? undefined
        : encodeFlatStorageKey(commitState.batch.checkpoint)) ||
    issuedManifest.endOfScan !== commitState.batch.endOfScan ||
    issuedManifest.finalKey !==
      (commitState.batch.nextCheckpoint === undefined
        ? undefined
        : encodeFlatStorageKey(commitState.batch.nextCheckpoint)) ||
    issued.length !== commitState.batch.projections.length ||
    commitState.batch.projections.some(
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
    (commitState.batch.nextCheckpoint === undefined ||
      encodeFlatStorageKey(commitState.batch.nextCheckpoint) !== issued[issued.length - 1]!.key)
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })
  let projectionRows = 0
  let projectionBytes = 0
  for (const projection of commitState.batch.projections) {
    const metrics = estimateBackfillProjectionMetrics(
      projection.projection,
      projection.key,
      commitState.sessionState.handle.scope,
      commitState.sessionState.handle.generation
    )
    assertBackfillProjectionLimits(metrics, 'record')
    projectionRows += metrics.rows
    projectionBytes += metrics.bytes
  }
  assertBackfillProjectionLimits({ rows: projectionRows, bytes: projectionBytes }, 'batch')
  return undefined
}
/** Apply only revision-matching projections in the original sidecar write order. */
async function applyIndexedDbBackfillProjection<TValue>(
  commitState: IIndexedDbBackfillCommit<TValue>
): Promise<number> {
  commitState.sidecar = commitState.transaction.objectStore(INDEX_RECORDS_STORE_NAME)
  commitState.revisions = commitState.transaction.objectStore(REVISIONS_STORE_NAME)
  let indexed = 0
  // A projection skipped here because its revision moved (the record was mutated after
  // this batch's `readBatch`, at a key that will never be re-scanned once past the
  // checkpoint) must not be re-projected with stale data; completeness for the whole scan
  // is separately gated below by the raw-firewall epoch, not by tracking this locally.
  for (const projection of commitState.batch.projections) {
    const currentRevision =
      ((await fromIdbRequest(
        commitState.revisions.get(
          recordRevisionKey(commitState.sessionState.indexedDbContext, projection.key)
        ),
        { signal: commitState.commitOperation?.signal },
        commitState.commitRuntime
      )) as number | undefined) ?? 0
    if (currentRevision !== projection.expectedRevision) continue
    // A full legacy scan also visits canonical and foreign physical keys. They advance
    // the bounded cursor but must not delete sidecar rows produced by the canonical phase.
    if (projection.counted === false) continue
    const oldRows = await fromIdbRequest(
      commitState.sidecar
        .index('record')
        .getAllKeys([
          commitState.sessionState.handle.scope,
          commitState.sessionState.handle.generation,
          toIdbKey(projection.key)
        ]),
      { signal: commitState.commitOperation?.signal },
      commitState.commitRuntime
    )
    for (const oldRow of oldRows as IDBValidKey[]) commitState.sidecar.delete(oldRow)
    if (projection.outcome !== 'indexed' || projection.projection === undefined) continue
    for (const [indexName, entry] of Object.entries(projection.projection)) {
      if (entry === undefined) continue
      const values = entry.kind === 'multiple' ? entry.keys : [entry.key]
      for (const indexValue of values) {
        commitState.sidecar.put({
          scope: commitState.sessionState.handle.scope,
          generation: commitState.sessionState.handle.generation,
          indexName,
          indexValue: toIdbKey(indexValue),
          recordKey: toIdbKey(projection.key)
        })
        indexed += 1
      }
    }
  }
  return indexed
}
/** Publish readiness and checkpoints only after the original native transaction commits. */
async function finishIndexedDbBackfillCommit<TValue>(
  commitState: IIndexedDbBackfillCommit<TValue>,
  indexed: number
): Promise<IRecordIndexReadiness> {
  /** Validation already rejected missing or stale metadata for this native commit. */
  const state = commitState.state!
  const activeRange =
    commitState.batchPhase === RecordIndexBackfillPhase.legacy
      ? commitState.sessionState.legacyPhysicalRange
      : commitState.sessionState.physicalRange
  const suffixRange = toIdbRange(
    commitState.batch.nextCheckpoint === undefined
      ? activeRange
      : activeRange === undefined
        ? { lower: commitState.batch.nextCheckpoint, lowerOpen: true }
        : { ...activeRange, lower: commitState.batch.nextCheckpoint, lowerOpen: true },
    commitState.sessionState.indexedDbContext.keyRange
  )
  const suffix = await fromIdbRequest(
    commitState.transaction
      .objectStore(commitState.sessionState.indexedDbContext.recordsStoreName)
      .getAllKeys(suffixRange, 1),
    { signal: commitState.commitOperation?.signal },
    commitState.commitRuntime
  )
  const previous = state.readiness ?? { status: 'running', scanned: 0, indexed: 0 }
  /**
   * /042: a scan can only be trusted `complete` if the raw-firewall epoch (bumped by every
   * canonical or legacy-shaped raw write in `applyRawMutationFirewall`, at _any_ readiness state,
   * not only `complete`) still matches the snapshot taken when this scan genuinely restarted from
   * the range's beginning. This catches an interleaved raw write regardless of whether it landed
   * inside this batch or between two commits, and regardless of its position relative to the
   * checkpoint — the batch-local flag this replaced could only see the former. It is also
   * recoverable: a later fresh full re-scan takes a new snapshot, and if nothing else mutates the
   * scope during that new scan, the epochs match again and `complete` is reachable — unlike a
   * sticky boolean with no legitimate reset path.
   */
  const currentRawEpoch =
    ((await fromIdbRequest(
      commitState.revisions.get(
        indexRawEpochKey(commitState.sessionState.handle.scope)
      ) as IDBRequest<number | undefined>,
      { signal: commitState.commitOperation?.signal },
      commitState.commitRuntime
    )) as number | undefined) ?? 0
  const scanUnchanged =
    state.scanStartRawEpoch !== undefined && currentRawEpoch === state.scanStartRawEpoch
  const reachedPhaseEnd = commitState.batch.endOfScan && (suffix as IDBValidKey[]).length === 0
  const entersLegacyPhase =
    commitState.batchPhase === RecordIndexBackfillPhase.canonical &&
    commitState.sessionState.includeLegacy &&
    reachedPhaseEnd
  const reachedScanEnd =
    commitState.sessionState.options.allowComplete &&
    (commitState.batchPhase === RecordIndexBackfillPhase.legacy ||
      !commitState.sessionState.includeLegacy) &&
    reachedPhaseEnd
  const nextReadiness: IRecordIndexReadiness = {
    status: reachedScanEnd && scanUnchanged ? 'complete' : 'running',
    scanned:
      previous.scanned +
      commitState.batch.projections.filter((projection) => projection.counted !== false).length,
    indexed: previous.indexed + indexed
  }
  /**
   * The scan reached its natural end (nothing left to scan) but could not be trusted `complete`
   * only because the epoch moved underneath it. Holding onto a checkpoint at the very end of the
   * range with no way to advance further would wedge this generation permanently `running` — the
   * next `openBackfillSession` would see a defined checkpoint and treat it as a resume, never
   * re-snapshotting the raw-firewall epoch. Clearing the checkpoint here instead makes the _next_
   * session a genuinely fresh start (per the raw-firewall epoch logic in `openBackfillSession`), so
   * a later clean full re-scan can still reach `complete`.
   */
  const nextPhase = entersLegacyPhase ? RecordIndexBackfillPhase.legacy : commitState.batchPhase
  const nextCheckpoint =
    entersLegacyPhase || (reachedScanEnd && !scanUnchanged)
      ? undefined
      : commitState.batch.nextCheckpoint
  const heartbeatRevision =
    commitState.activeLease?.heartbeatRevision ?? commitState.sessionState.sessionHeartbeatRevision
  commitState.metadata.put(
    {
      ...state,
      phase: nextPhase,
      readiness: nextReadiness,
      checkpoint: nextCheckpoint,
      lastBatch: commitState.batchIdentity,
      lastBatchReceipt: {
        ownerToken: commitState.sessionState.ownerToken,
        heartbeatRevision,
        batchIdentity: commitState.batchIdentity
      },
      issued: undefined,
      lease: undefined
    },
    indexMetadataKey(commitState.sessionState.handle.scope)
  )
  await commitState.committed
  commitState.sessionState.checkpoint = nextCheckpoint
  commitState.sessionState.currentPhase = nextPhase
  return nextReadiness
}

/**
 * Run the original bounded native iterateRecordIndex cursor with its existing signal and resource
 * owner.
 */
function iterateIndexedDbIndex<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  ...args: Parameters<NonNullable<IIndexedDbStore<TValue>['iterateRecordIndex']>>
): ReturnType<NonNullable<IIndexedDbStore<TValue>['iterateRecordIndex']>> {
  const [query, ctx] = args
  return withStorageIteratorResource(indexedDbIndexRows(indexedDbContext, query, ctx), {
    execution: indexedDbContext.runtime.execution,
    operation: StorageOperation.indexedDbCursor,
    ctx
  })
}
/** Compose root indexes access from the existing native backend ports. */
function createIndexedDbStoreIndexes<TValue>(
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
/** Compose root text access from the existing native backend ports. */
function createIndexedDbStoreText<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): Pick<
  IIndexedDbStore<TValue>,
  'get' | 'set' | 'remove' | 'has' | 'keys' | 'clearValues' | 'clearAll'
> {
  return {
    get: (key, ctx) =>
      indexedDbContext.runtime.journal !== undefined
        ? rootRead(indexedDbContext, 'get', [key, ctx] as const, ctx, 'value', (scope, [key]) =>
            scope.get(key)
          )
        : withAbort(ctx, async (signal, _context, runtime) => {
            assertLive(indexedDbContext)
            assertStringStorageKey(key, StorageBackend.indexedDb)
            const value = await readFrom(
              indexedDbContext,
              indexedDbContext.kvStoreName,
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
        indexedDbContext,
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
      rootMutation(
        indexedDbContext,
        'remove',
        key,
        ctx,
        { channel: 'value', kind: 'remove' },
        (key) => {
          assertStringStorageKey(key, StorageBackend.indexedDb)
          return { keys: [lockKey.text(key)], run: (scope) => scope.remove(key) }
        }
      ),
    has: (key, ctx) =>
      indexedDbContext.runtime.journal !== undefined
        ? rootRead(indexedDbContext, 'has', [key, ctx] as const, ctx, 'value', (scope, [key]) =>
            scope.has(key)
          )
        : withAbort(ctx, async (signal, _context, runtime) => {
            assertLive(indexedDbContext)
            assertStringStorageKey(key, StorageBackend.indexedDb)
            const value = await readFrom(
              indexedDbContext,
              indexedDbContext.kvStoreName,
              (store) => store.get(key) as IDBRequest<unknown>,
              signal,
              runtime,
              async (value, access) =>
                (await access.ttlAccess.present('value', key)) ? value : undefined
            )
            return value !== undefined
          }),
    keys: (ctx) =>
      indexedDbContext.runtime.journal !== undefined
        ? rootRead(indexedDbContext, 'keys', [ctx] as const, ctx, 'value', (scope) =>
            journalNative(indexedDbContext, scope).readKeys()
          )
        : withAbort(ctx, async (signal, _context, runtime) => {
            assertLive(indexedDbContext)
            const raw = await readFrom(
              indexedDbContext,
              indexedDbContext.kvStoreName,
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
    clearValues: (ctx) => rootClear(indexedDbContext, 'clearValues', 'value', ctx),
    clearAll: (ctx) => rootClear(indexedDbContext, 'clearAll', undefined, ctx)
  }
}
/** Compose root observation access from the existing native backend ports. */
function createIndexedDbStoreObservation<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): Pick<IIndexedDbStore<TValue>, 'watch' | 'subscribeChanges'> {
  return {
    watch: (key, ctx) => {
      assertLive(indexedDbContext)
      if (!indexedDbContext.capabilities.changeFeed)
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: StorageBackend.indexedDb
        })
      assertStringStorageKey(key, StorageBackend.indexedDb, 'watch key')
      return createBackendChangeIterator(indexedDbContext.controller, {
        orgId: indexedDbContext.orgId,
        channel: 'value',
        key,
        ctx,
        execute: (advance, context) =>
          indexedDbContext.runtime.execution.run(
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
      assertLive(indexedDbContext)
      return indexedDbContext.controller.subscribe(listener)
    }
  }
}
/** Metadata operations borrow the original physical store and mutation lease paths. */
function createIndexedDbMetadata<TValue>(
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
/** Compose root bytes access from the existing native backend ports. */
function createIndexedDbStoreBytes<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): Pick<IIndexedDbStore<TValue>, 'getBytes' | 'setBytes' | 'removeBytes' | 'clearBytes'> {
  return {
    getBytes: (key, ctx) =>
      indexedDbContext.runtime.journal !== undefined
        ? rootRead(
            indexedDbContext,
            'getBytes',
            [key, ctx] as const,
            ctx,
            'bytes',
            (scope, [key]) => scope.getBytes(key)
          )
        : withAbort(ctx, async (signal, _context, runtime) => {
            assertLive(indexedDbContext)
            assertStringStorageKey(key, StorageBackend.indexedDb)
            const value = await readFrom(
              indexedDbContext,
              indexedDbContext.bytesStoreName,
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
        indexedDbContext,
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
    removeBytes: (key, ctx) =>
      rootMutation(
        indexedDbContext,
        'removeBytes',
        key,
        ctx,
        { channel: 'bytes', kind: 'remove' },
        (key) => {
          assertStringStorageKey(key, StorageBackend.indexedDb)
          return { keys: [lockKey.bytes(key)], run: (scope) => scope.removeBytes(key) }
        }
      ),
    clearBytes: (ctx) => rootClear(indexedDbContext, 'clearBytes', 'bytes', ctx)
  }
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
/** Compose root records access from the existing native backend ports. */
function createIndexedDbStoreRecords<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): Pick<
  IIndexedDbStore<TValue>,
  'getRecord' | 'putRecord' | 'deleteRecord' | 'clearRecords' | 'iterateRecords'
> {
  return {
    getRecord: (key, ctx) =>
      indexedDbContext.runtime.journal !== undefined
        ? rootRead(
            indexedDbContext,
            'getRecord',
            [key, ctx] as const,
            ctx,
            'record',
            (scope, [key]) => scope.getRecord(key)
          )
        : withAbort(ctx, async (signal, _context, runtime) => {
            assertLive(indexedDbContext)
            const keySnapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
            return readFrom(
              indexedDbContext,
              indexedDbContext.recordsStoreName,
              (store) => store.get(toIdbKey(keySnapshot)) as IDBRequest<TValue | undefined>,
              signal,
              runtime,
              async (value, access) =>
                (await access.ttlAccess.present('record', keySnapshot)) ? value : undefined
            )
          }),
    putRecord: (value, key, ctx) =>
      rootMutation(
        indexedDbContext,
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
      rootMutation(
        indexedDbContext,
        'deleteRecord',
        key,
        ctx,
        { channel: 'record', kind: 'remove' },
        (key) => {
          const captured = snapshotStorageKey(key, StorageBackend.indexedDb)
          return { keys: [lockKey.record(captured)], run: (scope) => scope.deleteRecord(captured) }
        }
      ),
    clearRecords: (ctx) => rootClear(indexedDbContext, 'clearRecords', 'record', ctx),
    iterateRecords: (...args) => iterateIndexedDbRecords(indexedDbContext, ...args)
  }
}
/** Compose root transactions access from the existing native backend ports. */
function createIndexedDbStoreTransactions<TValue>(
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

/** Advance the original bounded native cursor while retaining its signal and page ownership. */
/** One bounded index iterator owns continuation, epoch observations and its existing signal. */
type IIndexedDbIndexIterator<TValue> = {
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
/** Advance the original native index pages without adding a cursor or transaction lifecycle. */
async function* indexedDbIndexRows<TValue>(
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
      throw new StorageError(StorageErrorCode.unavailable, {
        backend: StorageBackend.indexedDb,
        cause: new Error('IDBKeyRange is unavailable; pass options.keyRange explicitly')
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
/** Advance the original bounded native cursor while retaining its signal and page ownership. */
/** One bounded record iterator owns continuation and its original signal across native pages. */
type IIndexedDbRecordIterator<TValue> = {
  /** Original indexedDbContext belongs to this bounded native iterator. */
  readonly indexedDbContext: IIndexedDbContext<TValue>
  /** Original range belongs to this bounded native iterator. */
  readonly range?: IKeyRange
  /** Original ctx belongs to this bounded native iterator. */
  readonly ctx?: IOperationContext

  rangeSnapshot: ReturnType<typeof snapshotKeyRange>

  /** One reporter shared by every abort subscription inside this iteration operation. */
  runtime: IStorageOperationRuntime
  /** The same merged signal owns cancellation and cleanup for the full iterator. */
  merged: ReturnType<typeof mergeSignals>
  /** The original merged signal port belongs to this iterator only. */
  signal: ReturnType<typeof mergeSignals>['signal']
  /** The original merged dispose port belongs to this iterator only. */
  disposeSignal: ReturnType<typeof mergeSignals>['dispose']
  /** The original merged context port belongs to this iterator only. */
  context: ReturnType<typeof mergeSignals>['context']

  pageSize: number

  lower: IStorageKey | undefined

  lowerOpen: boolean | undefined
}
/** Advance the original native index pages without adding a cursor or transaction lifecycle. */
async function* indexedDbRecordRows<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  range?: IKeyRange,
  ctx?: IOperationContext
): AsyncGenerator<[IStorageKey, TValue], void, unknown> {
  /** State initializes on the first native advance, preserving the original lazy input boundary. */
  const iteratorState = { indexedDbContext, range, ctx } as IIndexedDbRecordIterator<TValue>

  iteratorState.rangeSnapshot = snapshotKeyRange(iteratorState.range, StorageBackend.indexedDb)

  assertLive(iteratorState.indexedDbContext)

  /** One reporter shared by every abort subscription inside this iteration operation. */
  iteratorState.runtime = createStorageOperationRuntime()
  iteratorState.merged = mergeSignals(iteratorState.ctx, iteratorState.runtime.reporter)
  iteratorState.signal = iteratorState.merged.signal
  iteratorState.disposeSignal = iteratorState.merged.dispose
  iteratorState.context = iteratorState.merged.context

  iteratorState.pageSize = iteratorState.context?.pageSize ?? 128

  iteratorState.lower = iteratorState.rangeSnapshot?.lower

  iteratorState.lowerOpen = iteratorState.rangeSnapshot?.lowerOpen

  try {
    while (true) {
      throwIfAborted(iteratorState.signal)
      const pageRange =
        iteratorState.lower === undefined && iteratorState.rangeSnapshot?.upper === undefined
          ? undefined
          : {
              lower: iteratorState.lower,
              lowerOpen: iteratorState.lowerOpen,
              upper: iteratorState.rangeSnapshot?.upper,
              upperOpen: iteratorState.rangeSnapshot?.upperOpen
            }
      const page = await withMutationLease(iteratorState.indexedDbContext, (lease) =>
        readIndexedDbRecordPage(iteratorState, pageRange, lease)
      )
      if (page.length === 0) return
      for (const entry of page) {
        throwIfAborted(iteratorState.signal)
        yield entry
      }
      if (page.length < iteratorState.pageSize) return
      iteratorState.lower = page[page.length - 1]![0]
      iteratorState.lowerOpen = true
    }
  } finally {
    iteratorState.disposeSignal()
  }
}
/** Bind private journal operations to the original physical database and generation. */
function createIndexedDbPhysicalJournal<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IStorageJournalBackendBinding {
  return {
    requiresIndexedDbUndo: true,
    forOrg: (orgId) =>
      (indexedDbContext.orgBinding?.resolve(orgId) ?? indexedDbContext.physical).journalBinding,
    lockTarget: (target) => indexedDbJournalTarget(target).lock,
    changes: (scope) => journalNative(indexedDbContext, scope).images.changes(),
    readImage: (scope, target) =>
      runTransactionOperation(scope, () =>
        journalNative(indexedDbContext, scope).images.readImage(target)
      ),
    writeImage: (scope, target, image) =>
      runTransactionOperation(scope, () =>
        journalNative(indexedDbContext, scope).images.writeImage(target, image)
      ),
    readRevision: (scope, target) =>
      runTransactionOperation(scope, () =>
        journalNative(indexedDbContext, scope).images.readRevision(target)
      ),
    openNamespace: async (prefix) => {
      assertLive(indexedDbContext)
      if (typeof prefix !== 'string' || prefix.length === 0)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      if (indexedDbContext.keyRange === undefined)
        throw new StorageContractError(StorageContractErrorCode.unsupported)
      /** Private methods and cached index reads retain this original physical generation. */
      const generation = indexedDbContext.journalGeneration
      const authenticate = (scope: Omit<ITransactionScope, 'use'>) => {
        const info = assertTransactionOwner(indexedDbContext.construction.store, scope)
        const current = indexedDbContext.nativeTransactions.get(info.id)
        if (current === undefined)
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        return { info, port: current.journal(scope, prefix) }
      }
      return createBackendJournalNamespace({
        assertLive: () => {
          assertLive(indexedDbContext)
          if (generation !== indexedDbContext.journalGeneration)
            throw new StorageContractError(StorageContractErrorCode.disposed)
        },
        closingSignal: indexedDbContext.controller.closingSignal,
        backend: StorageBackend.indexedDb,
        report: (error) => reportCleanupError(indexedDbContext.coordinationReporter, error),
        nativeAtomic: true,
        indexExclusive:
          indexedDbContext.webLocks === undefined &&
          indexedDbContext.journalFactoryIsPrivate !== true
            ? false
            : undefined,
        reserve: (hold) =>
          indexedDbContext.webLocks === undefined &&
          indexedDbContext.journalFactoryIsPrivate !== true
            ? hold()
            : runWithConcurrency(
                {
                  store: indexedDbContext.store,
                  options: { lock: [storageJournalLockKey(prefix, StorageJournalLock.resource)] },
                  policy: ConcurrencyPolicy.fail()
                },
                {
                  attempt: (context) =>
                    indexedDbContext.coordination.keyPort.attemptMetadata(
                      context,
                      {
                        status: ConcurrencyHolderState.held,
                        owner: indexedDbContext.controller.origin,
                        label: indexedDbContext.ownerLabel,
                        scope: 'local',
                        since: Date.now()
                      },
                      {
                        attempt: async () => {
                          if (indexedDbContext.webLocks !== undefined) {
                            /**
                             * Native Web Locks owns lifetime exclusion; no expiring metadata lease
                             * is substituted.
                             */
                            const name = encodeFlatStorageKey([
                              IndexedDbJournalLayout.resource,
                              indexedDbContext.dbName,
                              prefix
                            ])
                            await indexedDbContext.webLocks
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
                      indexedDbContext.runtime.stageBindings.concurrencyStages(
                        indexedDbContext.construction.store
                      ),
                      indexedDbContext.controller.closingSignal
                    )
                }
              ),
        authenticate,
        transaction: (work) =>
          withMutationLease(indexedDbContext, (lease) =>
            runTransaction(
              indexedDbContext,
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
  }
}

/** A native page owns only its selected rows and exhaustion result. */
type IIndexedDbIndexPage<TValue> = {
  /** Continuation, cancellation and epochs remain with the original iterator. */
  readonly iteratorState: IIndexedDbIndexIterator<TValue>
  /** At most the original page bound of selected native values is retained. */
  readonly page: Array<[IStorageKey, TValue]>
  /** The original native cursor reports whether another page can exist. */
  cursorExhausted: boolean
}
/** Read one original native index page through the same mutation lease and canonical transaction. */
function readIndexedDbIndexPage<TValue>(pageState: IIndexedDbIndexPage<TValue>): Promise<void> {
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

/** Scan one authenticated native index page in its original transaction. */
async function readIndexedDbIndexNativePage<TValue>(
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
            StorageErrorCode.indexOrphan,
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

/** Reject epoch, generation or readiness changes before this page opens its original cursor. */
async function assertIndexedDbIndexPage<TValue>(
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
      StorageErrorCode.indexQueryInvalidated,
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
    throw new StorageError(StorageErrorCode.unavailable, {
      backend: StorageBackend.indexedDb,
      cause: new Error('record index is not complete; caller must use fallback scan')
    })
}
/** Seek past the prior physical continuation with the original inclusive native-key rules. */
async function seekIndexedDbIndexCursor<TValue>(
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

/** Native record-cursor inputs borrow the original transaction, deadline access and reporter. */
type IIndexedDbRecordCursorOptions<TValue> = {
  readonly indexedDbContext: IIndexedDbContext<TValue>
  readonly transaction: IDBTransaction
  readonly request: IDBRequest<IDBCursorWithValue | null>
  readonly access: ReturnType<typeof createNativeDataAccess<TValue>>
  readonly signal: ReturnType<typeof mergeSignals>['signal']
  readonly runtime: IStorageOperationRuntime
  readonly pageSize: number
}

/** Own one original cursor terminal without adding another native transaction or resource scope. */
class IndexedDbRecordCursor<TValue> {
  /** Native ports retain exactly the page transaction and request already opened by the iterator. */
  #options: IIndexedDbRecordCursorOptions<TValue>
  /** Selected live records remain bounded by the original native page size. */
  #values: Array<[IStorageKey, TValue]> = []
  /** Native completion succeeds only after cursor exhaustion or the original page boundary. */
  #cursorFinished = false
  /** Exactly one native outcome releases the abort subscription and settles this page. */
  #settled = false
  /** Cancellation retains its original reason until the native abort event chooses the result. */
  #cancelled = false
  /** The original abort reason remains reachable on the contract error. */
  #abortReason: unknown
  /** Native setup may settle before abort subscription registration completes. */
  #disposeAbort: () => void = () => {}
  /** The sole page promise resolves after physical completion and commit-only notifications. */
  #resolve!: (values: Array<[IStorageKey, TValue]>) => void
  /** The sole page promise rejects with the original cursor error policy. */
  #reject!: (cause: unknown) => void

  /** Borrow existing native ports; no handlers or subscriptions are installed until run. */
  constructor(options: IIndexedDbRecordCursorOptions<TValue>) {
    this.#options = options
  }

  /** Install handlers synchronously inside the original page promise executor. */
  run(): Promise<Array<[IStorageKey, TValue]>> {
    return new Promise((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
      this.#install()
    })
  }

  /** Settle the original terminal once and release its exact abort subscription first. */
  #finish(callback: () => void): void {
    if (this.#settled) return
    this.#settled = true
    this.#disposeAbort()
    callback()
  }

  /** Preserve contract errors and the existing native cursor normalization boundary. */
  #failure(cause: unknown): StorageError | StorageContractError {
    return isStorageContractError(cause)
      ? cause
      : new StorageError(StorageErrorCode.transactionFailed, {
          backend: StorageBackend.indexedDb,
          operation: StorageOperation.indexedDbCursor,
          cause: cause instanceof StorageError ? (cause.cause ?? cause) : cause
        })
  }

  /** Request original native rollback while retaining cancellation as the primary outcome. */
  #abort(): void {
    this.#cancelled = true
    this.#abortReason = readAbortReason(this.#options.signal)
    try {
      this.#options.transaction.abort()
    } catch {
      this.#finish(() =>
        this.#reject(
          new StorageContractError(StorageContractErrorCode.aborted, { cause: this.#abortReason })
        )
      )
    }
  }

  /** Publish original expiry removals only after the page transaction physically completes. */
  #complete(): void {
    this.#finish(() => {
      if (this.#cancelled) {
        this.#reject(
          new StorageContractError(StorageContractErrorCode.aborted, { cause: this.#abortReason })
        )
        return
      }
      if (!this.#cursorFinished) {
        this.#reject(
          this.#failure(new Error('IndexedDB transaction completed before cursor finished'))
        )
        return
      }
      for (const [channel, keys] of this.#options.access.changed)
        if (keys.size > 0)
          publishChange(this.#options.indexedDbContext, {
            channel,
            kind: 'remove',
            keys: [...keys.values()]
          })
      this.#resolve(this.#values)
    })
  }

  /** Preserve the original native error event and its cursor-owned failure metadata. */
  #nativeError(): void {
    this.#finish(() =>
      this.#reject(this.#failure(readIdbTransactionError(this.#options.transaction)))
    )
  }

  /** Native abort selects cancellation only when the original signal requested it. */
  #nativeAbort(): void {
    this.#finish(() =>
      this.#reject(
        this.#cancelled
          ? new StorageContractError(StorageContractErrorCode.aborted, { cause: this.#abortReason })
          : this.#failure(readIdbTransactionError(this.#options.transaction))
      )
    )
  }

  /** Keep native request activity and asynchronous TTL removal on the original callback path. */
  #requestSuccess(): void {
    void this.#advance().catch((cause) => {
      this.#finish(() => this.#reject(this.#failure(cause)))
      try {
        this.#options.transaction.abort()
      } catch {
        /* Native end already owns cleanup. */
      }
    })
  }

  /** Read cursor fields before TTL work and finish indexes at the original page boundary. */
  async #advance(): Promise<void> {
    /** Native cursor identity belongs to the current request activity window. */
    const cursor = readIdbRequestResult(this.#options.request)
    if (cursor === null || this.#values.length >= this.#options.pageSize) {
      await this.#options.access.finishIndexes()
      this.#cursorFinished = true
      return
    }
    /** Original key and value detach from cursor movement before any TTL request can run. */
    const key = cursor.key as IStorageKey
    /** Native structured-clone output remains the row yielded by this page. */
    const value = cursor.value as TValue
    if (await this.#options.access.ttlAccess.present('record', key)) this.#values.push([key, value])
    if (this.#values.length < this.#options.pageSize) cursor.continue()
    else {
      await this.#options.access.finishIndexes()
      this.#cursorFinished = true
    }
  }

  /** Request errors settle through the same original cursor normalization path. */
  #requestFailure(): void {
    this.#finish(() => this.#reject(this.#failure(readIdbRequestError(this.#options.request))))
  }

  /** Native setup keeps its original handler order, subscription point and rollback behavior. */
  #install(): void {
    try {
      installIdbTransactionHandlers(
        this.#options.transaction,
        () => this.#complete(),
        () => this.#nativeError(),
        () => this.#nativeAbort()
      )
      installIdbRequestHandlers(
        this.#options.request,
        () => this.#requestSuccess(),
        () => this.#requestFailure()
      )
      this.#disposeAbort = subscribeToAbort(
        this.#options.signal,
        () => this.#abort(),
        this.#options.runtime.reporter
      )
    } catch (cause) {
      this.#finish(() =>
        this.#reject(
          isStorageContractError(cause) ||
            (cause instanceof StorageError && cause.code === StorageErrorCode.invalidConfig)
            ? cause
            : this.#failure(cause)
        )
      )
      try {
        this.#options.transaction.abort()
      } catch {
        /* Setup failure already owns the result. */
      }
    }
  }
}

/** Read one native record page on the original journal or direct cursor path. */
async function readIndexedDbRecordPage<TValue>(
  iteratorState: IIndexedDbRecordIterator<TValue>,
  pageRange: IKeyRange | undefined,
  lease: IMutationLeaseContext
): Promise<Array<[IStorageKey, TValue]>> {
  if (iteratorState.indexedDbContext.runtimeJournal !== undefined)
    return runTransaction(
      iteratorState.indexedDbContext,
      async (scope) => {
        const values: Array<[IStorageKey, TValue]> = []
        for await (const entry of scope.iterateRecords(pageRange)) {
          values.push(entry)
          if (values.length >= iteratorState.pageSize) break
        }
        return values
      },
      { ...iteratorState.context, signal: iteratorState.signal },
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
  const database = await open(iteratorState.indexedDbContext, iteratorState.runtime, lease)
  assertLive(iteratorState.indexedDbContext)
  const transaction = createTransaction(
    database,
    [
      iteratorState.indexedDbContext.kvStoreName,
      iteratorState.indexedDbContext.bytesStoreName,
      iteratorState.indexedDbContext.recordsStoreName,
      META_STORE_NAME,
      REVISIONS_STORE_NAME,
      INDEX_RECORDS_STORE_NAME
    ],
    'readwrite'
  )
  /** The original cursor owns this native lifetime; only physical mutations are shared. */
  const access = createNativeDataAccess(
    iteratorState.indexedDbContext,
    transaction,
    undefined,
    iteratorState.runtime,
    (make) => fromIdbRequest(make(), undefined, iteratorState.runtime),
    (
      channel: 'value' | 'bytes' | 'record',
      key: IStorageKey,
      context?: Parameters<IIndexedDbContext<TValue>['coordination']['keyPort']['probe']>[2]
    ) => assertExpiryRemoval(iteratorState.indexedDbContext, channel, key, context)
  )
  const store = transaction.objectStore(iteratorState.indexedDbContext.recordsStoreName)
  const idbRange = toIdbRange(pageRange, iteratorState.indexedDbContext.keyRange)
  const request = idbRange ? store.openCursor(idbRange) : store.openCursor()
  const values = await new IndexedDbRecordCursor<TValue>({
    indexedDbContext: iteratorState.indexedDbContext,
    transaction,
    request,
    access,
    signal: iteratorState.signal,
    runtime: iteratorState.runtime,
    pageSize: iteratorState.pageSize
  }).run()
  return values
}

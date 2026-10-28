import type { IStorageChange } from '@migaia/storage-contract'
import { bindBrowserExecution } from './execution.ts'
import type { createIndexedDbJournalImages } from './indexed-db-images.ts'
import type { captureIndexedDbTtlClock } from './indexed-db-ttl.ts'
import {
  StorageContractError,
  StorageContractErrorCode,
  isStorageContractError,
  kv,
  records,
  ttl,
  type ITtlApi,
  type ITransactionTtlApi,
  type ITransactionOptions,
  type ILockKey,
  type ITransactionBuilder,
  type ILockHolding,
  type ICapabilityStore,
  type ICapabilityImpl,
  type IRecordsApi,
  type IChangeFeedStore
} from '@migaia/storage-contract'
import {
  createTransactionOwner,
  assertTransactionOwner,
  type IBackendJournalTransaction,
  createStorageOperationReporter,
  throwIfAborted
} from '@migaia/storage-host/sdk'
import type {
  IStorageJournalBackendBinding,
  IStorageJournalImage,
  IStorageJournalTarget
} from '@migaia/storage-host'
import { StorageError } from '../types/errors.ts'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageBackend } from '../constants.ts'
import type { IOperationContext, IStorageKey, IWriteOptions } from '../types/context.ts'
import type { IRecordStore } from '../types/storage.ts'
import type {
  IRecordIndexHandle,
  ISecondaryIndexTransactionScope,
  ISecondaryIndexRecordStore
} from '@migaia/storage-contract'
import type { ITransactionScope } from '@migaia/storage-contract'
import type { IStorageCapabilities } from '../types/capabilities.ts'
import type { acquireIndexedDbCoordination } from './indexed-db-coordination.ts'
import type { IBackendLifecycleController } from '@migaia/storage-host/sdk'
import { indexedDbFeatureMissing } from './indexed-db-base-access.ts'
import type { IIndexedDbAssemblyPlan } from './indexed-db-assembly.ts'
import type {
  IBrowserKeyValueApi,
  IBackendConstruction,
  IBackendRuntime,
  IBrowserBatchApi
} from './construction.ts'
import { createBrowserOrgBinding } from './organizations.ts'
import {
  captureIndexedDbConfiguration,
  resolveIndexedDbLayout,
  initializeIndexedDbNativeState,
  createIndexedDbConstruction,
  createIndexedDbTransactionOwner,
  createIndexedDbPhysical,
  createIndexedDbOrgBinding
} from './indexed-db-construction.ts'
import { createMonotonicClock } from './indexed-db-layout.ts'
import { createIndexedDbStore, createIndexedDbRecordApi } from './indexed-db-root.ts'

/** Both record APIs declare the same native support; each query captures its own planner facts. */
export const recordQueryPushdown = {
  source: StorageBackend.indexedDb,
  operations: [],
  operators: []
} as const

export const CAPABILITIES: IStorageCapabilities = {
  batch: false,
  syncRead: false,
  binary: true,
  records: true,
  transactions: true,
  iteration: true,
  // Closes the full planner/readiness/native-query/unique inventory. The immutable
  // capability is now honest: complete handles use the sidecar route, while pending/failed
  // handles still remain on the authoritative fallback path.
  secondaryIndexes: false,
  // The base remains fail-closed; each factory instance derives an immutable `changeFeed` value
  // only after realm-default factory and BroadcastChannel admission succeeds below.
  changeFeed: false,
  maxValueBytes: undefined,
  opaqueEntries: false
}

/** Convert current cancellation state into an IndexedDB-owned error without throwing from events. */
export const indexedDbSignalFailure = (
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
    return new StorageError(StorageBrowserErrorCode.invalidConfig, {
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
  /** Database name; defaults to storage-plugin-browser. */
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
  /**
   * Install one named optional owner before native opening; no capability is automatically
   * selected.
   */
  installAssembly<K extends keyof IIndexedDbAssemblyPlan>(
    name: K,
    owner: NonNullable<IIndexedDbAssemblyPlan[K]>
  ): void
  requireObjectStore(name: string): void
  getTransactionClient(scope: ITransactionScope<unknown>): IDBTransaction
  /** Resolve only the exact original scope of this immutable physical organization. */
  getTransactionClientForOrg(scope: object, orgId: string): IDBTransaction
}

/** Physical client access shares the original opener and exact native transaction registry. */
export type IIndexedDbPhysical<TValue> = IBackendConstruction<
  IIndexedDbProvidedStore<TValue>,
  IDBDatabase
> & {
  readonly journalBinding?: IStorageJournalBackendBinding
  getPreparedClient(): IDBDatabase | Promise<IDBDatabase>
  getTransactionClient(scope: object): IDBTransaction
}
/** Fixed-org Feature resolution never exposes construction or resource ownership. */
type IIndexedDbConstruction<TValue> = IIndexedDbPhysical<TValue> & {
  getOrgClient(orgId: string): IDBDatabase | Promise<IDBDatabase>
  getOrgTransactionClient(scope: object, orgId: string): IDBTransaction
}

/** The native store retains its complete transaction scope in the shared immutable builder. */
export type IIndexedDbStore<TValue> = Omit<
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
export type IIndexedDbTransactionScope<TValue> = Omit<
  ISecondaryIndexTransactionScope<TValue>,
  'use'
> &
  ITransactionScope<TValue, typeof records | typeof ttl>

/** The original provided object carries both real native capabilities and their exact APIs. */
export type IIndexedDbProvidedStore<TValue> = ICapabilityStore<
  IIndexedDbStore<TValue>,
  typeof kv | typeof records | typeof ttl,
  readonly [
    ICapabilityImpl<typeof kv, IBrowserKeyValueApi<IIndexedDbStore<TValue>>>,
    ICapabilityImpl<typeof records, IRecordsApi<TValue>>,
    ...ICapabilityImpl<typeof ttl, ITtlApi>[]
  ]
>

/** Compile one logical index range into the physical lookup-key range. */

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
export type IRawMutationAuthority = {
  readonly canonicalScopes: readonly string[]
  readonly unscopedPresent: boolean
}
/** Marks an already admitted logical mutation; the controller owns its actual lease. */
export type IMutationLeaseContext = object

type IPrepareState = 'idle' | 'running' | 'ready' | 'terminal' | 'disposed'

/** Native root calls retain only their original endpoint input, notification and lock derivation. */
export type IRootMode<R> = {
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
export type IRootPrepared<TValue, R> = {
  readonly keys: readonly ILockKey[]
  readonly ranges?: ReturnType<IRootMode<Awaited<R>>['ranges']>
  readonly run: (scope: IIndexedDbTransactionScope<TValue>) => R
}
/** A physical IndexedDB construction owns its connection, layout, coordination and native ports. */
export type IIndexedDbContext<TValue> = {
  /** Original options is captured before native construction begins. */
  readonly options: IIndexedDbOptions
  /** Original runtime is captured before native construction begins. */
  readonly runtime: IBackendRuntime
  /** Original declaredObjectStores is captured before native construction begins. */
  readonly declaredObjectStores: readonly string[]
  /** Explicit Feature owners captured before native opening. */
  readonly assemblies: IIndexedDbAssemblyPlan
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
  controller: IBackendLifecycleController

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

  ttlApi: ITtlApi

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
  bindOrganizations = true,
  assemblies: IIndexedDbAssemblyPlan = {}
): IIndexedDbConstruction<TValue> {
  /** Initialize native facts in original construction order before publishing any port. */
  const indexedDbContext = {
    options,
    runtime,
    declaredObjectStores,
    bindOrganizations,
    assemblies
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

  indexedDbContext.assemblies.indexes?.register(indexedDbContext)
  indexedDbContext.recordApi = createIndexedDbRecordApi(indexedDbContext)
  indexedDbContext.ttlApi = indexedDbContext.assemblies.ttl?.api(indexedDbContext) as ITtlApi
  indexedDbContext.batchApi =
    indexedDbContext.assemblies.batch?.api(indexedDbContext) ?? indexedDbFeatureMissing.batch()

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

/** Optional publication runs only when the notification Feature supplies its event owner. */
export function publishChange<T>(
  context: IIndexedDbContext<T>,
  change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>
): void {
  context.assemblies.notifications?.publish(context, change)
}

export function journalNative<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  scope: Omit<ITransactionScope, 'use'>
) {
  const { id } = assertTransactionOwner(indexedDbContext.construction.store, scope)
  const current = indexedDbContext.nativeTransactions.get(id)
  if (current === undefined)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  return current
}
export {
  REVISIONS_STORE_NAME,
  META_STORE_NAME,
  INTERNAL_META_NAMESPACE,
  INDEX_RECORDS_STORE_NAME,
  RECORD_EPOCH_KEY,
  LEGACY_MIGRATION_BATCH_SIZE,
  INDEX_QUERY_PAGE_SIZE,
  INDEX_BACKFILL_SOFT_CAP_BYTES,
  INDEX_BACKFILL_MIN_BATCH_SIZE,
  INDEX_BACKFILL_MAX_BATCH_SIZE,
  INDEX_BACKFILL_MIN_LEASE_MS,
  INDEX_BACKFILL_MAX_LEASE_MS,
  INDEX_BACKFILL_DEFAULT_LEASE_MS,
  createMonotonicClock,
  isValidIndexGeneration,
  createIndexGeneration,
  toIdbKey,
  estimateBackfillProjectionMetrics,
  assertBackfillProjectionLimits,
  normalizeIndexedDbOperationError,
  backfillDecodedTooLarge,
  snapshotWriteValue,
  readIndexedDbBytes,
  toIdbRange
} from './indexed-db-layout.ts'
export type { IBackfillLease } from './indexed-db-layout.ts'
export {
  recordRevisionKey,
  indexMetadataKey,
  backfillTakeoverObservationKey,
  clearBackfillTakeoverObservations,
  staleIndexHandleError,
  indexScopeEpochKey,
  indexRawEpochKey,
  archiveIndexGeneration,
  applyRawMutationFirewall,
  assertLive,
  withMutationLease
} from './indexed-db-lifecycle.ts'
export { open, createTransaction } from './indexed-db-open.ts'
export { runTransaction, rootMutation, rootKeys } from './indexed-db-root.ts'
export {
  request,
  putNative,
  write,
  remove,
  removePrefix,
  executeOperation,
  recordIterator
} from './indexed-db-attempt.ts'
export type {
  IIndexedDbNativeCallback,
  IIndexedDbTransactionRecordSource
} from './indexed-db-attempt.ts'
export { indexedDbScopeOperation } from './indexed-db-scope.ts'
export type {
  IIndexedDbScopeContext,
  IIndexedDbNativeRun,
  IIndexedDbNativeRegistration
} from './indexed-db-scope.ts'

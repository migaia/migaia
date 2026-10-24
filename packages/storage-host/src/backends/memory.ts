import { asyncDisposeKey } from '@migaia/plugin-host'
import { createBackendRevisionPort } from './revisions.js'
import { createBackendKeyLockPort } from './key-locks.js'
import type { IBackendChangeController } from '../core/change-controller.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  ConcurrencyPolicy,
  assertStringStorageKey,
  snapshotStorageKey,
  snapshotStorageBatchKeys,
  createStorageBatchKeyCapture,
  snapshotStorageTtlTarget,
  assertStorageTtlDuration,
  snapshotStorageCounterIncrement,
  snapshotSyncWriteOptions,
  encodeOrderedStorageKey,
  createTransactionOwner,
  assertTransactionOwner,
  runTransactionOperation,
  useTransactionCapability,
  snapshotStorageKeyPrefix,
  snapshotConcurrencyLockKeys,
  snapshotConcurrencyLockRange,
  readConcurrencyLockIdentities,
  lockKey,
  type ITransactionRecordsApi,
  assertTransactionCallback,
  readTransactionConflictPolicy,
  createTransactionBuilder,
  runWithConcurrency,
  createRecordQuery,
  provideCapabilities,
  implement,
  kv,
  records,
  ttl,
  counter,
  vector,
  rdf,
  blob,
  snapshotStorageBlobPut,
  snapshotStorageBlobGet,
  snapshotStorageBlobList,
  createStorageBlobObject,
  createStorageBlobBodyReader,
  prefixStorageOrgKey,
  type ICapabilityStore,
  type ICapabilityImpl,
  type IRecordsApi,
  type IBlobApi,
  type IBlobInfo,
  type IBlobObject,
  createRdfQuery,
  snapshotStorageRdfQuad,
  snapshotStorageRdfPattern,
  prefixStorageOrgGraph,
  unprefixStorageOrgGraph,
  encodeStorageRdfQuad,
  type IQuad,
  type IRdfApi,
  type ITransactionRdfApi,
  createVectorQuery,
  compileStorageWhere,
  compileStorageQueryCondition,
  QueryOperator,
  QueryOperation,
  VectorQueryOriginKind,
  type IVectorQueryOrigin,
  DeleteCountMode,
  snapshotStorageVectorCollection,
  snapshotStorageVector,
  snapshotStorageVectorUpsert,
  snapshotStorageVectorSearch,
  type IStorageVectorPoint,
  type IStorageVectorConfiguration,
  type IVectorApi,
  type IVectorCollection,
  type IVectorHit,
  type IVectorFilter,
  type IQueryCondition,
  type IRecordQuerySource,
  type IRdfQuerySource,
  type IVectorQuerySource,
  type IVectorQueryInput,
  type IQueryDelete,
  type ITtlTarget,
  type ITtlApi,
  type ICounterApi,
  type ITransactionCounterApi,
  type ITransactionTtlApi,
  type IKeyValueApi,
  type ITransactionKeyValueApi,
  type IStorageKey,
  type IStorageIterator,
  type ITransactionScope,
  type ITransactionOptions,
  type IWriteConcurrencyOptions,
  type IWriteOptions,
  type IOperationContextSnapshot,
  type ILockKey,
  type ITransactionBuilder,
  type IRecordStore,
  type ISyncCapableStore,
  type IChangeFeedStore,
  type IStorageChange,
  type ICapabilityInstallPort,
  type IConcurrencyPolicy,
  type IConcurrencyAttempt,
  type IConcurrencyAttemptContext,
  type IConcurrencyHolder,
  type ILockHolding,
  type IOperationContext,
  type IConflictPolicy,
  type IKeyRange
} from '@migaia/storage-contract'
import { parseObjectPath } from '@migaia/utils/object-path'
import { rankMemoryVectors, recommendStorageVector } from './vector-core.js'
import { createMemoryRdfIndex, memoryRdfKeys, type IMemoryRdfKeys } from './rdf-core.js'
import { createMemoryBlobData } from './memory-blob.js'
import { createMemoryJournalData, type IMemoryJournalTransaction } from './memory-journal.js'
import { memoryJournalDeadlineTarget, snapshotMemoryJournalTarget } from './memory-journal-image.js'
import type {
  IStorageJournalBackendBinding,
  IStorageJournalChange,
  IStorageJournalImage,
  IStorageJournalTarget
} from '../journal/types.js'
import type { ILogPayload } from '@migaia/logger/plugins/durable'
import { storageJournalLockKey, StorageJournalLock } from '../journal/keys.js'
import { encodeStorageJournalImage, decodeStorageJournalImage } from '../journal/image.js'
import { detectServerRuntime } from '@migaia/utils'
import { isUint8Array, utf8ByteLength } from '@migaia/utils/bytes'
import { StorageError, StorageErrorCode, type IStorageChannel } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import type { IStoragePluginCore } from '../types.js'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.js'
import { MemoryOperation, MemoryState } from './memory-constants.js'
import { encodeFlatStorageKey, snapshotKeyRange } from '../core/key-domain.js'
import { createStorageToken } from '../core/storage-token.js'
import {
  createOrderedRecordIndex,
  compareRecordIndexKeys,
  type IOrderedRecordRange
} from '../core/ordered-record-index.js'
import { planChannelWrite } from '../core/channel-write.js'
import { isStorageErrorFamily } from '../core/error-family.js'
import { resolveStorageNamespace } from '../core/namespace.js'
import {
  throwIfAborted,
  mergeSignals,
  withAbort,
  subscribeToAbort,
  readAbortReason
} from '../core/operation.js'
import { createStorageOperationReporter, reportCleanupError } from '../core/operation-reporter.js'
import { observeStorageBatch } from '../core/batch-observation.js'
import { createBackendChangeIterator } from '../core/change-iterator.js'
import { StorageHookName } from '../hook-names.js'
import {
  snapshotMemoryCapacity,
  createMemoryCapacityIndex,
  memoryCapacityValueBytes,
  type IMemoryCapacity,
  type IMemoryCapacityOptions,
  type IMemoryCapacityChange
} from './memory-capacity.js'

/** Memory options retain one private data universe for this concrete plugin instance. */
export type IMemoryOptions = {
  readonly namespace?: string
  readonly capacity?: IMemoryCapacityOptions
  readonly concurrency?: IConcurrencyPolicy
  readonly owner?: { readonly label?: string }
}
/** The native scope and builder remain the original contract's complete three-channel shape. */
/**
 * A native per-view method lets the original provider bind record prefix deletion without another
 * registry.
 */
const recordPrefix = Symbol()
/** The original capability binder borrows only this current native view's TTL methods. */
const ttlOperations = Symbol()
/** The counter binder borrows the same accepted operation and text draft from its fresh view. */
const counterOperations = Symbol()
/** The RDF binder borrows the same original draft and accepted operation view. */
const rdfOperations = Symbol()
/** Query writes borrow this exact native scope's existing draft, never a second writer. */
const queryDraft = Symbol()
/** The record binder keeps the current scope's actual query factory and accepted operation. */
const recordQueries = Symbol()
/** Journal metadata borrows this authentic view's original draft and terminal callbacks only. */
const journalOperations = Symbol()
/** One private selector keeps the native ranking algorithm shared by read and write cursors. */
type IMemoryVectorSelection<P> = (
  input: IVectorQueryInput,
  points: Iterable<IStorageVectorPoint<P>>,
  point: (id: string) => IStorageVectorPoint<P> | undefined
) => Iterable<readonly [IStorageKey, IVectorHit<P, boolean>]>
/** Internal query selection supplies original native rows and consumes accepted draft mutations. */
type IMemoryQueryDraft = {
  readonly record: NonNullable<IRecordQuerySource['mutate']>
  readonly rdf: NonNullable<IRdfQuerySource['mutate']>
  vector<P>(
    collection: string,
    request: IQueryDelete,
    run: Parameters<NonNullable<IVectorQuerySource<P>['mutate']>>[1],
    select: IMemoryVectorSelection<P>
  ): Promise<number>
}
/**
 * This private member runs through the same original operation owner as every other native scope
 * method.
 */
type IMemoryScope<T> = ITransactionScope<
  T,
  typeof records | typeof ttl | typeof counter | typeof rdf
> & {
  [recordPrefix](prefix: IStorageKey): Promise<number>
  readonly [ttlOperations]: ITransactionTtlApi
  readonly [counterOperations]: ITransactionCounterApi
  readonly [rdfOperations]: ITransactionRdfApi
  readonly [queryDraft]: IMemoryQueryDraft
  readonly [recordQueries]: ITransactionRecordsApi['query']
  readonly [journalOperations]: IMemoryJournalTransaction & {
    changes(): readonly IStorageJournalChange[]
    readImage(target: IStorageJournalTarget): Promise<IStorageJournalImage>
    writeImage(target: IStorageJournalTarget, image: IStorageJournalImage): Promise<void>
    readRevision(target: IStorageJournalTarget): Promise<ILogPayload>
  }
}
/** The original store retains the concrete complete native transaction view. */
type IMemoryBase<T> = Omit<ISyncCapableStore<IRecordStore<T>>, 'transaction'> &
  IChangeFeedStore & {
    /** The original native source already provides record, vector and RDF invalidation watchers. */
    readonly capabilities: IRecordStore<T>['capabilities'] & { readonly changeFeed: true }
    transaction<R>(
      run: (scope: IMemoryScope<T>) => R,
      options?: ITransactionOptions
    ): Promise<Awaited<R>>
    tx(): ITransactionBuilder<IMemoryScope<T>>
    inspectLocks(ctx?: IOperationContext): Promise<readonly ILockHolding[]>
    undo?(txId: string, ctx?: IOperationContext): Promise<{ readonly txId: string }>
  }
/** Canonical keys and committed values belong to their actual memory channel. */
type IMemoryEntry = {
  readonly key: IStorageKey
  readonly value: unknown
  readonly ordered: Uint8Array
  readonly bytes?: number
  readonly rdfKeys?: IMemoryRdfKeys
  readonly rdfLock?: ILockKey
}
/** Native vector and RDF rows share the maps and draft without legacy channel replacement. */
type IMemoryChannel = IStorageChannel | 'vector' | 'rdf'
/** Blobs share capacity and invalidation, while remaining outside generic transactions and locks. */
type IMemoryPhysicalChannel = IMemoryChannel | 'blob'
/** A transaction retains its first deadline beside the existing detached value snapshot. */
type IMemorySnapshot = IMemoryEntry & { readonly deadline?: number }
/** This native unit supports only its actual three physical value channels. */
type IMemoryTtlTarget = ITtlTarget
/** A draft deletion remains distinct from an untouched identity. */
type IMemoryDraft = IMemorySnapshot & {
  readonly channel: IMemoryChannel
  readonly remove: boolean
  readonly encoded: string
}
/** A prepared RDF row keeps physical graph identity and the user's namespace-local logical lock. */
type IMemoryRdfEntry = IMemoryEntry & {
  readonly encoded: string
  readonly rdfKeys: IMemoryRdfKeys
  readonly rdfLock: ILockKey
}

/** Prepared root work owns detached inputs while borrowing the original admission and budget. */
type IMemoryRootMutation<R> = {
  readonly keys: readonly ILockKey[]
  readonly ranges?: readonly {
    readonly channel: ILockKey['channel']
    readonly lower: string
    readonly upper: string
  }[]
  readonly capacityChanges?: () => readonly IMemoryCapacityChange[]
  /** Opt-in journaling runs this same prepared mutation in the original native draft. */
  readonly invoke?: (draft: IMemoryTextDraft) => R
  run(): R
}
/** Text batches retain detached canonical keys and prepared values before lock admission. */
type IMemoryTextEntry = {
  readonly key: IStorageKey
  readonly value: string
  readonly ttlMs?: number
}
/** Only original native draft functions are passed to an internal batch callback. */
type IMemoryTextDraft = {
  write(channel: IStorageChannel, key: IStorageKey, value: unknown, policy: IConflictPolicy): void
  remove(channel: IStorageChannel | 'vector', key: IStorageKey): boolean
  clear(channel?: IStorageChannel): void
  ttl(target: IMemoryTtlTarget, ms: number | undefined, persist: boolean): boolean
  increment(key: string, increment: ReturnType<typeof snapshotStorageCounterIncrement>): number
  upsertVector(
    collection: string,
    points: readonly IStorageVectorPoint<unknown>[],
    sizes: readonly number[],
    ttlMs?: number
  ): void
  deleteVector(
    collection: string,
    predicate: (point: IStorageVectorPoint<unknown>) => boolean
  ): number
  rdf(quads: readonly IQuad[], remove: boolean): void
  setMany(entries: readonly IMemoryTextEntry[]): void
  removeMany(keys: readonly IStorageKey[]): number
  removeByPrefix(prefix: IStorageKey, channel?: IStorageChannel): number
}
/** One prepared batch reuses the original transaction attempt and its fixed input locks. */
type IMemoryAtomicWork<T, R> = {
  readonly keys?: readonly ILockKey[]
  readonly ranges?: IMemoryRootMutation<unknown>['ranges']
  readonly invoke: (scope: IMemoryScope<T>, draft: IMemoryTextDraft) => R
}

/** Create the real native backend only from its original installed core. */
export function createMemoryBackend<T = unknown>(
  core: IStoragePluginCore,
  options: IMemoryOptions,
  capacity: IMemoryCapacity | undefined = snapshotMemoryCapacity(options)
) {
  return new MemoryBackendOwner<T>(core, options, capacity).construct()
}

/** One installed memory backend owns physical organization namespaces and their lifecycle. */
class MemoryBackendOwner<T> {
  /** Original installed ports retain execution, journal and organization ownership. */
  readonly #core: IStoragePluginCore
  /** Validated options apply uniformly to every physical organization namespace. */
  readonly #options: IMemoryOptions
  /** Optional capacity policy belongs to each namespace, with no cross-org accounting. */
  readonly #capacity: IMemoryCapacity | undefined
  /** The validated root namespace determines the physical key for every org projection. */
  readonly #namespace: string
  /** Existing physical views are reused until the original controller finalizes them. */
  readonly #namespaces = new Map<string, ReturnType<typeof createMemoryNamespace<T>>>()
  /** One original controller governs admission and cleanup across the physical namespaces. */
  readonly #controller: IBackendChangeController

  /** Validate the physical namespace before allocating its original lifecycle controller. */
  constructor(
    core: IStoragePluginCore,
    options: IMemoryOptions,
    capacity: IMemoryCapacity | undefined
  ) {
    this.#core = core
    this.#options = options
    this.#capacity = capacity
    this.#namespace = resolveStorageNamespace(
      options.namespace ?? MemoryState.defaultNamespace,
      core.defaultOrgId,
      core.defaultOrgId
    )
    this.#controller = core.createChangeController({
      backend: STORAGE_MEMORY_BACKEND,
      options: { namespace: this.#namespace },
      finalize: () => this.#finalize()
    })
  }

  /** Construct the default view and publish only the original native registration ports. */
  construct() {
    /** Default host calls and explicit default-org views share one physical namespace. */
    const physical = this.forOrg(this.#core.defaultOrgId)
    return {
      ...physical,
      controller: this.#controller,
      orgBinding: {
        backend: (orgId: string) => this.forOrg(orgId).store,
        drop: (orgId: string) => this.#dropOrg(orgId)
      },
      journalBinding: new MemoryJournalBinding(this, this.#core.defaultOrgId),
      assertScope: (scope: ITransactionScope) => this.#assertScope(physical, scope)
    }
  }

  /** Allocate an org's physical data only on its first real lookup, without new lifetimes or DDL. */
  forOrg(orgId: string) {
    this.#controller.assertLive()
    /** Namespace resolution preserves the original root and explicit-org identity rules. */
    const target = resolveStorageNamespace(this.#namespace, orgId, this.#core.defaultOrgId)
    /** Existing views retain exactly their original store and journal identity. */
    const existing = this.#namespaces.get(target)
    if (existing !== undefined) return existing
    /** Org ports supply the original fixed-org execution and journal configuration. */
    const ports = this.#core.getOrgContext(orgId)
    /** Each physical namespace borrows the single parent controller. */
    const physical = createMemoryNamespace<T>(
      { ...this.#core, ...ports },
      this.#options,
      this.#controller,
      orgId,
      orgId === this.#core.defaultOrgId,
      this.#capacity
    )
    this.#namespaces.set(target, physical)
    return physical
  }

  /** Drop only the selected physical org through the original journal-aware clear path. */
  async #dropOrg(orgId: string): Promise<void> {
    /** Resolving an unseen org follows the original on-demand native projection behavior. */
    const current = this.forOrg(orgId)
    if (this.#core.journal !== undefined) return current.drop()
    await current.store.clearAll()
    current.journal.clear()
  }

  /** Authenticate a genuine scope against the existing physical stores, preserving other failures. */
  #assertScope(
    physical: ReturnType<typeof createMemoryNamespace<T>>,
    scope: ITransactionScope
  ): void {
    for (const namespace of this.#namespaces.values()) {
      try {
        assertTransactionOwner(namespace.store, scope)
        return
      } catch (error) {
        if (
          !(error instanceof StorageContractError) ||
          error.code !== StorageContractErrorCode.invalidArgument
        )
          throw error
      }
    }
    assertTransactionOwner(physical.store, scope)
  }

  /** Drain and clear every allocated namespace once under the original controller disposal. */
  async #finalize(): Promise<void> {
    for (const physical of this.#namespaces.values()) await physical.finalize()
    this.#namespaces.clear()
  }
}

/** A fixed-org journal binding delegates to its original physical namespace without a new owner. */
class MemoryJournalBinding<T> implements IStorageJournalBackendBinding {
  /** The original backend resolves and reuses every physical organization namespace. */
  readonly #backend: MemoryBackendOwner<T>
  /** This binding never borrows a mutable current-organization value. */
  readonly #orgId: string
  /** Native memory transactions use the existing external WAL protocol. */
  readonly externalWal = true

  /** Retain only the backend and immutable organization identity. */
  constructor(backend: MemoryBackendOwner<T>, orgId: string) {
    this.#backend = backend
    this.#orgId = orgId
  }

  /** Project another fixed organization through the same original backend. */
  forOrg = (orgId: string): IStorageJournalBackendBinding => {
    return new MemoryJournalBinding(this.#backend, orgId)
  }
  /** Resolve the canonical native journal lock without changing its target semantics. */
  lockTarget = (target: IStorageJournalTarget) => {
    return snapshotMemoryJournalTarget(target).lock
  }
  /** Open a private namespace owned by the original physical journal. */
  openNamespace = (prefix: string) => {
    return this.#backend.forOrg(this.#orgId).journal.open(prefix)
  }
  /** Read the exact accepted native scope's ordered journal changes. */
  changes = (scope: Omit<ITransactionScope, 'use'>) => {
    return this.#backend.forOrg(this.#orgId).journalImages.changes(scope)
  }
  /** Read a target image through the authenticated original native scope. */
  readImage = (scope: Omit<ITransactionScope, 'use'>, target: IStorageJournalTarget) => {
    return this.#backend.forOrg(this.#orgId).journalImages.readImage(scope, target)
  }
  /** Restore a target image through the same original native attempt. */
  writeImage = (
    scope: Omit<ITransactionScope, 'use'>,
    target: IStorageJournalTarget,
    image: IStorageJournalImage
  ) => {
    return this.#backend.forOrg(this.#orgId).journalImages.writeImage(scope, target, image)
  }
  /** Read a target's revision without creating an independent journal view. */
  readRevision = (scope: Omit<ITransactionScope, 'use'>, target: IStorageJournalTarget) => {
    return this.#backend.forOrg(this.#orgId).journalImages.readRevision(scope, target)
  }
  /** Write the original transaction's commit marker into this physical org. */
  writeCommitMarker = (scope: Omit<ITransactionScope, 'use'>, txId: string) => {
    return this.#backend.forOrg(this.#orgId).journal.writeMarker(scope, txId)
  }
  /** Observe only markers belonging to this fixed physical organization. */
  hasCommitMarker = (txId: string) => {
    return this.#backend.forOrg(this.#orgId).journal.hasMarker(txId)
  }
  /** Remove a completed marker using the original journal's terminal path. */
  removeCommitMarker = (txId: string) => {
    return this.#backend.forOrg(this.#orgId).journal.removeMarker(txId)
  }
}

/** Build native operations over one namespace while borrowing its registration's original lifetime. */
/** The exact built-in capability tuple preserves the original public store inference. */
type IMemoryCapabilityStore<T> = ICapabilityStore<
  IMemoryBase<T>,
  | typeof kv
  | typeof ttl
  | typeof vector
  | typeof blob
  | typeof rdf
  | typeof counter
  | typeof records,
  readonly [
    ICapabilityImpl<typeof kv, IKeyValueApi>,
    ICapabilityImpl<typeof ttl, ITtlApi>,
    ICapabilityImpl<typeof vector, IVectorApi>,
    ICapabilityImpl<typeof blob, IBlobApi>,
    ICapabilityImpl<typeof rdf, IRdfApi>,
    ICapabilityImpl<typeof counter, ICounterApi>,
    ICapabilityImpl<typeof records, IRecordsApi<T>>
  ]
>
/** Explicit physical namespace state is shared by named module operations. */
type IMemoryNamespaceContext<T> = {
  /** Original core belongs to this physical namespace. */
  readonly core: IStoragePluginCore
  /** Original options belongs to this physical namespace. */
  readonly options: IMemoryOptions
  /** Original controller belongs to this physical namespace. */
  readonly controller: IBackendChangeController
  /** Original orgId belongs to this physical namespace. */
  readonly orgId: string
  /** Original root belongs to this physical namespace. */
  readonly root: boolean
  /** Original capacity belongs to this physical namespace. */
  readonly capacity: IMemoryCapacity | undefined

  /** Physical membership, ordered ranges, deadline facts and lock admission share this namespace. */
  data: Record<IMemoryChannel, Map<string, IMemoryEntry>>

  /** Collection metadata is private to this namespace and consumes no second physical entry. */
  vectorCollections: Map<string, IStorageVectorConfiguration>

  /** Opaque objects keep independent native identity under the same namespace and controller. */
  blobs: ReturnType<typeof createMemoryBlobData>

  /** Full clears include native families; legacy key replacement remains three-channel. */
  physicalChannels: readonly IMemoryChannel[]

  /** Only live expiring identities retain deadline metadata. */
  deadlines: Map<string, number>

  /** Optional policy metadata belongs only to this namespace's original physical rows. */
  capacityIndex: ReturnType<typeof createMemoryCapacityIndex> | undefined

  /** Capacity can reclaim actual elapsed deadlines through the same compressed radix owner. */
  expiring:
    | ReturnType<
        typeof createOrderedRecordIndex<{
          readonly channel: IMemoryChannel
          readonly encoded: string
        }>
      >
    | undefined

  /** Ordered leaves index the same native data entries. */
  ordered: Record<IMemoryChannel, ReturnType<typeof createOrderedRecordIndex<IMemoryEntry>>>

  /** RDF permutations index the same physical entries under this namespace and lifecycle. */
  rdfIndex: ReturnType<typeof createMemoryRdfIndex<IMemoryEntry>>

  /** These original internal algorithms own only physical facts, without installation authority. */
  revisions: ReturnType<typeof createBackendRevisionPort>

  /** Each namespace has independent canonical locks under the one parent lifecycle. */
  locks: ReturnType<typeof createBackendKeyLockPort>

  /** Existing cleanup diagnostics retain their original reporter. */
  report: ReturnType<typeof createStorageOperationReporter>

  /** Native deadlines use the original captured scheduler. */
  scheduler: ReturnType<IStoragePluginCore['featureExpose']['getScheduler']>

  /** Symbol cleanup retains its cached reporting derivative. */
  symbolic: Promise<void> | undefined

  /** Feature publication borrows this native provider's original installer. */
  installer: ICapabilityInstallPort

  /** Native transaction views share this namespace's original canonical owner. */
  owner: ReturnType<typeof createTransactionOwner<T>>

  /** Private metadata uses this same physical namespace, original native attempt and owner. */
  journal: ReturnType<typeof createMemoryJournalData>

  /** The existing token helper retains one opaque owner identity for the physical store. */
  ownerId: ReturnType<typeof createStorageToken>

  /** Runtime detection reuses the neutral utils owner rather than importing a host client. */
  runtime: ReturnType<typeof detectServerRuntime>

  /** Native process identity is captured once for this physical instance's lock diagnostics. */
  nativeHost: { process?: { pid?: number }; Deno?: { pid?: number } }

  /** The chosen runtime decides which already-present native pid owns this physical process. */
  pid: number | undefined

  /** Explicit labels and runtime defaults stay stable through every native retry. */
  label: string

  /**
   * Explicit capacity holds only this native turn's events until all data and victims are
   * committed.
   */
  pendingChanges:
    | {
        readonly channel: IMemoryPhysicalChannel
        readonly kind: IStorageChange['kind']
        readonly keys?: readonly IStorageKey[]
      }[]
    | undefined

  /** Native store construction keeps public sync methods separate from internal asynchronous calls. */
  base: IMemoryBase<T>

  /**
   * Retain the original native KV members before provider publication replaces the root has
   * overload.
   */
  keyValue: IKeyValueApi

  /** TTL reads and writes use the original root pipeline, implicit locks and operation budget. */
  timeToLive: ITtlApi

  /** A native counter read and write occupy the same original synchronous admitted mutation. */
  counters: ICounterApi

  /** Each collection borrows this namespace's original execution, data and resource lifetime. */
  vectors: IVectorApi

  /** Native RDF writes use the original mutation runner, canonical locks and final synchronous turn. */
  rdfApi: IRdfApi

  /** Opaque objects use the same original operation runner and physical capacity commit. */
  objects: IBlobApi

  /** Publish the real built-in APIs on the original resource, never a copied base. */
  store: IMemoryCapabilityStore<T>

  /** Only this original registration can forward image operations to an authenticated native scope. */
  journalImages: {
    changes(scope: Omit<ITransactionScope, 'use'>): readonly IStorageJournalChange[]
    readImage(
      scope: Omit<ITransactionScope, 'use'>,
      target: IStorageJournalTarget
    ): Promise<IStorageJournalImage>
    writeImage(
      scope: Omit<ITransactionScope, 'use'>,
      target: IStorageJournalTarget,
      image: IStorageJournalImage
    ): Promise<void>
    readRevision(
      scope: Omit<ITransactionScope, 'use'>,
      target: IStorageJournalTarget
    ): Promise<ILogPayload>
  }
}
function createMemoryNamespace<T>(
  core: IStoragePluginCore,
  options: IMemoryOptions,
  controller: IBackendChangeController,
  orgId: string,
  root: boolean,
  capacity: IMemoryCapacity | undefined
) {
  /** Initialize in the original order before the completed store can escape. */
  const namespaceContext = {
    core,
    options,
    controller,
    orgId,
    root,
    capacity
  } as IMemoryNamespaceContext<T>
  namespaceContext.data = {
    value: new Map<string, IMemoryEntry>(),
    bytes: new Map<string, IMemoryEntry>(),
    record: new Map<string, IMemoryEntry>(),
    vector: new Map<string, IMemoryEntry>(),
    rdf: new Map<string, IMemoryEntry>()
  }
  namespaceContext.vectorCollections = new Map<string, IStorageVectorConfiguration>()
  namespaceContext.blobs = createMemoryBlobData(namespaceContext.orgId)
  namespaceContext.physicalChannels = [...MemoryState.channels, 'vector', 'rdf'] as const
  namespaceContext.deadlines = new Map<string, number>()
  namespaceContext.capacityIndex =
    namespaceContext.capacity === undefined
      ? undefined
      : createMemoryCapacityIndex(namespaceContext.capacity)
  namespaceContext.expiring =
    namespaceContext.capacity === undefined
      ? undefined
      : createOrderedRecordIndex<{
          readonly channel: IMemoryChannel
          readonly encoded: string
        }>()
  namespaceContext.ordered = {
    value: createOrderedRecordIndex<IMemoryEntry>(),
    bytes: createOrderedRecordIndex<IMemoryEntry>(),
    record: createOrderedRecordIndex<IMemoryEntry>(),
    vector: createOrderedRecordIndex<IMemoryEntry>(),
    rdf: createOrderedRecordIndex<IMemoryEntry>()
  }
  namespaceContext.rdfIndex = createMemoryRdfIndex(namespaceContext.ordered.rdf)
  namespaceContext.revisions = createBackendRevisionPort()
  namespaceContext.locks = createBackendKeyLockPort()
  namespaceContext.report = createStorageOperationReporter()
  namespaceContext.scheduler = namespaceContext.core.featureExpose.getScheduler()
  namespaceContext.journal = createMemoryNamespaceJournal(namespaceContext)
  namespaceContext.ownerId = createStorageToken()
  namespaceContext.runtime = detectServerRuntime()
  namespaceContext.nativeHost = globalThis as unknown as {
    process?: { pid?: number }
    Deno?: { pid?: number }
  }
  namespaceContext.pid =
    namespaceContext.runtime === 'deno'
      ? namespaceContext.nativeHost.Deno?.pid
      : namespaceContext.nativeHost.process?.pid
  namespaceContext.label =
    namespaceContext.options.owner?.label ??
    MemoryState.ownerLabel(namespaceContext.runtime, namespaceContext.pid)
  namespaceContext.base = createMemoryNamespaceBase(namespaceContext)
  namespaceContext.keyValue = createMemoryNamespaceKeyValue(namespaceContext)
  namespaceContext.timeToLive = createMemoryNamespaceTimeToLive(namespaceContext)
  namespaceContext.counters = createMemoryNamespaceCounters(namespaceContext)
  namespaceContext.vectors = createMemoryNamespaceVectors(namespaceContext)
  namespaceContext.rdfApi = createMemoryNamespaceRdfApi(namespaceContext)
  namespaceContext.objects = createMemoryNamespaceObjects(namespaceContext)
  namespaceContext.store = createMemoryNamespaceStore(namespaceContext)

  namespaceContext.owner = createTransactionOwner<T>(
    namespaceContext.store,
    (cause: unknown, expiredScope?: true) => normalize(namespaceContext, cause, expiredScope),
    {
      asyncDisposeKey,
      defaultPolicy: namespaceContext.options.concurrency,
      concurrencyStages: namespaceContext.core.stageBindings.concurrencyStages(
        namespaceContext.store
      )
    }
  )
  namespaceContext.journalImages = createMemoryNamespaceJournalImages(namespaceContext)
  return {
    store: namespaceContext.store,
    controller: namespaceContext.controller,
    installer: namespaceContext.installer,
    finalize: () => finalize(namespaceContext),
    journal: namespaceContext.journal,
    journalImages: namespaceContext.journalImages,
    /** Only selected global journals need generation invalidation inside the original clear turn. */
    drop: () =>
      mutationEntry(
        namespaceContext,
        MemoryOperation.clearAll,
        undefined,
        undefined,
        () => ({
          keys: [],
          ranges: mutationRanges(namespaceContext, namespaceContext.physicalChannels),
          run: () => {
            namespaceContext.controller.assertLive()
            namespaceContext.journal.clear()
            clearAll(namespaceContext)
          }
        }),
        false
      )
  }
}

/** Private metadata uses this same physical namespace, original native attempt and owner. */
function createMemoryNamespaceJournal<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['journal'] {
  return createMemoryJournalData({
    assertLive: namespaceContext.controller.assertLive,
    report: (error) => reportCleanupError(namespaceContext.report, error),
    closingSignal: namespaceContext.controller.closingSignal,
    reserve: (prefix, run) =>
      runWithConcurrency(
        {
          store: namespaceContext.base,
          options: { lock: [storageJournalLockKey(prefix, StorageJournalLock.resource)] },
          policy: ConcurrencyPolicy.fail()
        },
        {
          attempt: (context) =>
            namespaceContext.locks.attemptMetadata(
              context,
              holding(namespaceContext),
              {
                attempt: async () => {
                  await run()
                  return { status: 'committed', value: undefined }
                }
              },
              namespaceContext.core.stageBindings.concurrencyStages(namespaceContext.store),
              namespaceContext.controller.closingSignal
            )
        }
      ),
    transaction: (prefix, work) =>
      atomicEntry(
        namespaceContext,
        MemoryOperation.transaction,
        () => work,
        undefined,
        (captured) => ({
          keys: [storageJournalLockKey(prefix, StorageJournalLock.head)],
          invoke: (scope) => captured(scope[journalOperations])
        }),
        false
      ),
    scope: (scope) => ({
      info: assertTransactionOwner(namespaceContext.store, scope),
      port: (scope as IMemoryScope<T>)[journalOperations]
    })
  })
}

/** Root lifecycle finalization releases each namespace's physical facts exactly once. */
async function finalize<T>(namespaceContext: IMemoryNamespaceContext<T>) {
  await namespaceContext.locks.dispose()
  for (const channel of namespaceContext.physicalChannels) {
    namespaceContext.data[channel].clear()
    namespaceContext.ordered[channel].clear()
    namespaceContext.revisions.clear(channel === 'value' ? 'text' : channel)
  }
  namespaceContext.deadlines.clear()
  namespaceContext.expiring?.clear()
  namespaceContext.capacityIndex?.clear()
  namespaceContext.vectorCollections.clear()
  namespaceContext.rdfIndex.clear()
  namespaceContext.blobs.clear()
  namespaceContext.journal.clear()
}

/** Unknown backend callback failures gain their original memory transaction boundary. */
function normalize<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  cause: unknown,
  expiredScope?: true
) {
  return isStorageErrorFamily(cause)
    ? cause
    : new StorageError(StorageErrorCode.transactionFailed, {
        backend: STORAGE_MEMORY_BACKEND,
        ...(expiredScope ? { operation: MemoryOperation.transactionScope } : {}),
        cause
      })
}

/** One active attempt captures the actual store identity rather than the transaction callback. */
function holding<T>(namespaceContext: IMemoryNamespaceContext<T>): IConcurrencyHolder {
  return {
    status: 'held',
    owner: namespaceContext.ownerId,
    label: namespaceContext.label,
    scope: 'local',
    since: Date.now(),
    ...(namespaceContext.pid === undefined ? {} : { pid: namespaceContext.pid })
  }
}

/** One physical channel plus the existing flat wire gives an unambiguous revision identity. */
function identity<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryPhysicalChannel,
  encoded: string
): string {
  return MemoryState.identity(channel, encoded)
}

/** Revision changes remain independent of whether an entry is currently present. */
function revision<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryChannel,
  encoded: string
): number {
  return namespaceContext.revisions.read(channel === 'value' ? 'text' : channel, encoded)
}

/** Every successful physical change advances only its own channel's original revision. */
function bump<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryChannel,
  encoded: string
): void {
  namespaceContext.revisions.write(channel === 'value' ? 'text' : channel, encoded)
}

/** One deadline mutation keeps the original Map and optional candidate index synchronized. */
function setDeadline<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryChannel,
  encoded: string,
  deadline: number | undefined
): void {
  /** Existing canonical identity and old clock fact identify the exact expiry leaf to replace. */
  const id = identity(namespaceContext, channel, encoded)
  /** No secondary expiry structure exists on the original unbounded path. */
  const previous = namespaceContext.deadlines.get(id)
  if (namespaceContext.expiring !== undefined && previous !== undefined)
    namespaceContext.expiring.delete(
      encodeOrderedStorageKey([previous, channel, encoded], STORAGE_MEMORY_BACKEND)
    )
  if (deadline === undefined) namespaceContext.deadlines.delete(id)
  else {
    namespaceContext.deadlines.set(id, deadline)
    namespaceContext.expiring?.set(
      encodeOrderedStorageKey([deadline, channel, encoded], STORAGE_MEMORY_BACKEND),
      {
        channel,
        encoded
      }
    )
  }
}

/** Accounting never inspects record values unless the explicit byte limit needs their encoding. */
function entryBytes<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryChannel,
  value: unknown
): number {
  if (namespaceContext.capacity?.maxBytes === undefined) return 0
  if (channel === 'value') return utf8ByteLength(value as string)
  if (channel === 'bytes') return (value as Uint8Array).byteLength
  if (channel === 'vector') {
    /** Native JS number components are binary64; this is accounting, not a portable vector wire. */
    const point = value as IStorageVectorPoint<unknown>
    return (
      point.vector.length * Float64Array.BYTES_PER_ELEMENT +
      (point.payload === undefined ? 0 : memoryCapacityValueBytes(point.payload))
    )
  }
  if (channel === 'rdf')
    return encodeStorageRdfQuad(value as IQuad, STORAGE_MEMORY_BACKEND).byteLength
  return memoryCapacityValueBytes(value)
}

/** One already owned physical identity is shared by the native entry and its policy metadata. */
function capacityFact<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryPhysicalChannel,
  key: IStorageKey,
  bytes?: number,
  rdfLock?: ILockKey
): IMemoryCapacityChange {
  /** RDF already owns its original canonical identity; other channels retain the flat-key owner. */
  const encoded = channel === 'rdf' ? (key as string) : encodeFlatStorageKey(key)
  return {
    id: identity(namespaceContext, channel, encoded),
    channel,
    encoded,
    key,
    bytes,
    lock: rdfLock
  }
}

/** Capacity uses only native physical channels already known to this namespace. */
function capacityLock<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  entry: IMemoryCapacityChange
): ILockKey | undefined {
  if (entry.channel === 'blob') return undefined
  if (entry.channel === 'value') return lockKey.text(entry.key)
  if (entry.channel === 'bytes') return lockKey.bytes(entry.key as string)
  if (entry.channel === 'rdf') return entry.lock!
  if (entry.channel === 'vector') {
    /** Vector rows already own the canonical collection/id tuple used by their lock owner. */
    const key = entry.key as readonly [string, string]
    return lockKey.vector(key[0], key[1])
  }
  return lockKey.record(entry.key)
}

/** Derive only elapsed deadline leaves, followed by actual policy victims of proposed writes. */
function planCapacity<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  changes: readonly IMemoryCapacityChange[]
) {
  /** An omitted capacity never allocates accounting or candidate work. */
  if (namespaceContext.capacityIndex === undefined || namespaceContext.expiring === undefined)
    return undefined
  /** Inclusive now is expressed through the original tuple-prefix upper bound. */
  const upper = snapshotStorageKeyPrefix(
    [namespaceContext.scheduler.now()],
    STORAGE_MEMORY_BACKEND
  ).upper
  /** Actual expired rows alone enter the removal plan; no live-key table scan occurs. */
  const expired: IMemoryCapacityChange[] = []
  for (const leaf of namespaceContext.expiring.range({ upper, upperOpen: true })) {
    const { channel, encoded } = leaf.value
    const entry = namespaceContext.data[channel].get(encoded)
    if (entry !== undefined) expired.push(capacityFact(namespaceContext, channel, entry.key))
  }
  /** Preview restores the exact policy links before any lock wait or user callback can happen. */
  const victims = namespaceContext.capacityIndex.preview([...expired, ...changes])
  /** Canonical point identities feed only the existing physical lock owner and its original FIFO. */
  const identities = snapshotConcurrencyLockKeys(
    [...expired, ...victims]
      .map((entry: IMemoryCapacityChange) => capacityLock(namespaceContext, entry))
      .filter((key): key is ILockKey => key !== undefined),
    STORAGE_MEMORY_BACKEND
  ).identities
  return { expired, victims, identities }
}

/** Native metadata deletion is shared by expiry, explicit removal and committed capacity victims. */
function deletePhysical<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryPhysicalChannel,
  encoded: string
): IMemoryEntry | undefined {
  if (channel === 'blob') {
    const entry = namespaceContext.blobs.removeEncoded(encoded)
    if (entry !== undefined)
      namespaceContext.capacityIndex?.remove(identity(namespaceContext, channel, encoded))
    return entry
  }
  const entry = namespaceContext.data[channel].get(encoded)
  if (entry === undefined) return undefined
  namespaceContext.data[channel].delete(encoded)
  if (channel === 'rdf') namespaceContext.rdfIndex.delete(entry.rdfKeys!)
  else namespaceContext.ordered[channel].delete(entry.ordered)
  setDeadline(namespaceContext, channel, encoded, undefined)
  namespaceContext.capacityIndex?.remove(identity(namespaceContext, channel, encoded))
  bump(namespaceContext, channel, encoded)
  return entry
}

/** Records and bytes detach ownership before an eviction or committed mutation occurs. */
function clone<T, V>(namespaceContext: IMemoryNamespaceContext<T>, value: V, key?: IStorageKey): V {
  try {
    return (globalThis as unknown as { structuredClone<W>(input: W): W }).structuredClone(value)
  } catch (cause) {
    throw new StorageError(StorageErrorCode.serializeFailed, {
      backend: STORAGE_MEMORY_BACKEND,
      key,
      cause
    })
  }
}

/** Memory values use one original clone rule for reads, writes and drafts. */
function copyValue<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryChannel,
  value: unknown,
  key: IStorageKey
): unknown {
  return channel === 'value' || channel === 'rdf'
    ? value
    : channel === 'bytes'
      ? cloneBytes(namespaceContext, value as Uint8Array, key)
      : clone(namespaceContext, value, key)
}

/** Byte carriers preserve the original cross-realm guard and detached view-copy rule. */
function cloneBytes<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  value: Uint8Array,
  key: IStorageKey
): Uint8Array {
  try {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()
  } catch (cause) {
    throw new StorageError(StorageErrorCode.serializeFailed, {
      backend: STORAGE_MEMORY_BACKEND,
      key,
      cause
    })
  }
}

/** Public scalar and byte writes retain their existing runtime input errors. */
function prepare<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IStorageChannel,
  value: unknown,
  key: IStorageKey
): unknown {
  if (channel === 'value' && typeof value !== 'string')
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: STORAGE_MEMORY_BACKEND,
      key,
      cause: new TypeError(StorageErrorText.memoryTextValue)
    })
  if (channel === 'bytes' && !isUint8Array(value))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: STORAGE_MEMORY_BACKEND,
      key,
      cause: new TypeError(StorageErrorText.memoryBytesValue)
    })
  return copyValue(namespaceContext, channel, value, key)
}

/** Notifications retain original commit-after eviction order. */
function publish<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryPhysicalChannel,
  kind: IStorageChange['kind'],
  keys?: readonly IStorageKey[]
): void {
  if (namespaceContext.pendingChanges !== undefined) {
    namespaceContext.pendingChanges.push({ channel, kind, keys })
    return
  }
  namespaceContext.controller.publish({
    channel: channel === 'vector' || channel === 'rdf' || channel === 'blob' ? 'all' : channel,
    kind,
    orgId: namespaceContext.orgId,
    // Broad RDF/object invalidations never expose physical graph or organization key envelopes.
    ...(keys === undefined || channel === 'rdf' || channel === 'blob' ? {} : { keys })
  })
}

/** Capacity mutations and their events share the original final synchronous native turn. */
function commitCapacity<T, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  plan: ReturnType<typeof planCapacity>,
  run: () => R,
  committed?: () => void
): R {
  if (plan === undefined) {
    const result = run()
    committed?.()
    return result
  }
  namespaceContext.pendingChanges = []
  /** Counts retain only actual capacity removals, never ordinary expiry or user values. */
  const counts = new Map<IMemoryPhysicalChannel, number>()
  try {
    for (const entry of plan.expired) {
      const removed = deletePhysical(
        namespaceContext,
        entry.channel as IMemoryChannel,
        entry.encoded
      )
      if (removed !== undefined)
        publish(namespaceContext, entry.channel as IMemoryChannel, 'remove', [removed.key])
    }
    /** Input preparation and final lock checks have already completed before this callback. */
    const result = run()
    for (const entry of plan.victims) {
      const channel = entry.channel as IMemoryPhysicalChannel
      const removed = deletePhysical(namespaceContext, channel, entry.encoded)
      if (removed === undefined) continue
      publish(namespaceContext, channel, 'remove', [removed.key])
      counts.set(channel, (counts.get(channel) ?? 0) + 1)
    }
    committed?.()
    return result
  } finally {
    /** Clear the native event buffer before observers can synchronously reenter this store. */
    const changes = namespaceContext.pendingChanges
    namespaceContext.pendingChanges = undefined
    for (const change of changes)
      publish(namespaceContext, change.channel, change.kind, change.keys)
    for (const [channel, count] of counts)
      namespaceContext.core.emit(StorageHookName.onEvict, () => ({
        backendId: namespaceContext.core.getBackendId(),
        backend: STORAGE_MEMORY_BACKEND,
        orgId: namespaceContext.orgId,
        channel,
        count
      }))
  }
}

/** Every physical access shares one deadline check and the original removal/revision path. */
function liveEntry<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryChannel,
  encoded: string
): IMemoryEntry | undefined {
  /** Physical membership and deadline use the same canonical channel/key identity. */
  const entry = namespaceContext.data[channel].get(encoded)
  /** Omitted deadlines remain unlimited, including keys first written before TTL is used. */
  const id = identity(namespaceContext, channel, encoded)
  /** The original monotonic clock is consulted once for this physical access. */
  const deadline = namespaceContext.deadlines.get(id)
  if (
    entry !== undefined &&
    deadline !== undefined &&
    deadline <= namespaceContext.scheduler.now()
  ) {
    deletePhysical(namespaceContext, channel, encoded)
    publish(namespaceContext, channel, 'remove', [entry.key])
    return undefined
  }
  return entry
}

/** Apply one already prepared root write synchronously, then publish its complete result. */
function write<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IStorageChannel,
  key: IStorageKey,
  value: unknown,
  policy: IConflictPolicy = 'conflict',
  bytes = entryBytes(namespaceContext, channel, value)
): void {
  namespaceContext.controller.assertLive()
  /** Snapshot and prepare before touching any conflicting channel. */
  const captured = key
  /** All data channels share the same existing flat logical-key identity. */
  const encoded = encodeFlatStorageKey(captured)
  /** Cloning completed before lock admission, so no borrowed getter can reopen this final turn. */
  const prepared = value
  /** One canonical ordered encoding is retained by the live entry and affected native indexes. */
  const encodedBytes = encodeOrderedStorageKey(captured, STORAGE_MEMORY_BACKEND)
  /** Overwrite keeps the already retained live bytes for the exact canonical identity. */
  const keyBytes = namespaceContext.ordered[channel].get(encodedBytes)?.key ?? encodedBytes
  /** Actual physical membership alone determines channel replacement. */
  const existing = new Set(
    MemoryState.channels.filter(
      (current) => liveEntry(namespaceContext, current, encoded) !== undefined
    )
  )
  /** Shared conflict policy owns one removal order for all backends. */
  const plan = planChannelWrite(captured, channel, existing, policy, STORAGE_MEMORY_BACKEND)
  for (const previous of plan.remove) {
    deletePhysical(namespaceContext, previous, encoded)
  }
  /** The hash and radix owners share this exact committed entry reference. */
  const entry = { key: captured, value: prepared, ordered: keyBytes, bytes }
  namespaceContext.data[channel].set(encoded, entry)
  namespaceContext.ordered[channel].set(keyBytes, entry)
  namespaceContext.capacityIndex?.put({
    ...capacityFact(namespaceContext, channel, captured),
    bytes
  })
  bump(namespaceContext, channel, encoded)
  for (const previous of plan.remove) publish(namespaceContext, previous, 'remove', [captured])
  publish(namespaceContext, channel, 'put', [captured])
}

/** Root deletes remain genuine no-ops when the original channel has no such key. */
function remove<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IStorageChannel,
  key: IStorageKey
): void {
  namespaceContext.controller.assertLive()
  /** Deletes detach caller-owned key objects before recording a committed event. */
  const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
  /** The same wire identity is used by reads, writes and revision tombstones. */
  const encoded = encodeFlatStorageKey(captured)
  /** The actual entry already owns the canonical ordered bytes needed for removal. */
  const entry = liveEntry(namespaceContext, channel, encoded)
  if (!entry) return
  deletePhysical(namespaceContext, channel, encoded)
  publish(namespaceContext, channel, 'remove', [captured])
}

/** Clear invalidates the actual channel snapshot even when membership was already empty. */
function clear<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IStorageChannel,
  notify = true
): void {
  namespaceContext.controller.assertLive()
  /** Preserve the original rule that an empty clear emits no notification. */
  const changed = namespaceContext.data[channel].size !== 0
  for (const encoded of namespaceContext.data[channel].keys()) {
    setDeadline(namespaceContext, channel, encoded, undefined)
    namespaceContext.capacityIndex?.remove(identity(namespaceContext, channel, encoded))
  }
  namespaceContext.data[channel].clear()
  namespaceContext.ordered[channel].clear()
  namespaceContext.revisions.clear(channel === 'value' ? 'text' : channel)
  if (changed && notify) publish(namespaceContext, channel, 'clear')
}

/** All flat reads retain string-only validation and old null/undefined missing results. */
function read<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IStorageChannel,
  key: IStorageKey
): unknown {
  namespaceContext.controller.assertLive()
  /** Record keys remain structured; flat text and bytes remain string-only. */
  const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
  /** Reading never allocates a revision or changes physical membership. */
  const entry = liveEntry(namespaceContext, channel, encodeFlatStorageKey(captured))
  if (entry !== undefined)
    namespaceContext.capacityIndex?.touch(
      identity(namespaceContext, channel, encodeFlatStorageKey(captured))
    )
  return entry === undefined
    ? undefined
    : copyValue(namespaceContext, channel, entry.value, captured)
}

/** Replace admits every possible displaced channel in the same fixed canonical order. */
function mutationKeys<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IStorageChannel,
  key: IStorageKey,
  policy?: IConflictPolicy
): readonly ILockKey[] {
  return (policy === 'replace' ? MemoryState.channels : [channel]).flatMap<ILockKey>((current) =>
    current === 'value'
      ? [lockKey.text(key)]
      : current === 'record'
        ? [lockKey.record(key)]
        : typeof key === 'string'
          ? [lockKey.bytes(key)]
          : []
  )
}

/** One finite range per affected channel uses the original contract's encoded identity bounds. */
function mutationRanges<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channels: readonly IMemoryChannel[]
) {
  return channels.map((channel) => {
    /** Physical text identity is shared by scalar and typed transaction text keys. */
    const target: ILockKey['channel'] = channel === 'value' ? 'text' : channel
    return {
      channel: target,
      ...snapshotConcurrencyLockRange({ channel: target }, STORAGE_MEMORY_BACKEND)
    }
  })
}

/** Busy synchronous writes cannot run a policy or wait; diagnostics identify the actual holder. */
function assertUnlocked<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  keys: readonly ILockKey[],
  ranges?: IMemoryRootMutation<unknown>['ranges']
): void {
  /** Canonical admission pairs detached keys with the sole original identity representation. */
  const captured = snapshotConcurrencyLockKeys(keys, STORAGE_MEMORY_BACKEND)
  /** Point checks perform only fixed-channel Map lookups; clear examines its affected bucket. */
  const held = namespaceContext.locks.probe(captured.identities, ranges)
  if (held !== undefined)
    throw new StorageContractError(StorageContractErrorCode.lockRejected, {
      backend: STORAGE_MEMORY_BACKEND,
      keys: [held.key],
      holder: held.holder
    })
}

/** Capture borrowed payload before admission; the eventual physical mutation never calls it again. */
function prepareWrite<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IStorageChannel,
  key: IStorageKey,
  value: unknown,
  policy?: IConflictPolicy
): IMemoryRootMutation<void> {
  /** Caller-owned key segments and record/byte values detach before waiting can begin. */
  const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
  /** A clone failure cannot remove a displaced row or acquire a logical key. */
  const prepared = prepare(namespaceContext, channel, value, captured)
  /** Byte-domain admission precedes every possible displaced channel or draft mutation. */
  const bytes = entryBytes(namespaceContext, channel, prepared)
  return {
    keys: mutationKeys(namespaceContext, channel, captured, policy),
    capacityChanges:
      namespaceContext.capacity === undefined
        ? undefined
        : () => {
            /** Only the same logical key's original conflict channels participate in replacement. */
            const changes: IMemoryCapacityChange[] =
              policy === 'replace'
                ? MemoryState.channels
                    .filter((current) => current !== channel)
                    .map((current) => capacityFact(namespaceContext, current, captured))
                : []
            changes.push(capacityFact(namespaceContext, channel, captured, bytes))
            return changes
          },
    invoke: (draft) => draft.write(channel, captured, prepared, policy ?? 'conflict'),
    run: () => write(namespaceContext, channel, captured, prepared, policy, bytes)
  }
}

/** Root writes reuse the original execution list, policy loop, member lease and lock provider. */
function mutationEntry<T, I, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  operation: string,
  input: I,
  ctx: IWriteOptions | undefined,
  prepareMutation: (captured: I, context: IOperationContextSnapshot) => IMemoryRootMutation<R>,
  journaled = true
): Promise<R> {
  /** Original metadata/drop operations must not recursively journal their own invalidation. */
  const selectedJournal = journaled ? namespaceContext.core.journal : undefined
  /** Pipeline intervention fixes this input before the original loop derives affected keys. */
  let capturedInput = input
  /** The sole derivation captures inputs and affected keys once, before any native attempt. */
  let mutation!: IMemoryRootMutation<R>
  /** The last readonly preflight is consumed immediately by the same native synchronous terminal. */
  let capacityPlan: ReturnType<typeof planCapacity>
  /** Only this selected native attempt's real victim identities enter the original lock provider. */
  let capacityIdentities: readonly string[] = []
  /** Preparation is accepted work of this original controller, including close races. */
  const preparing =
    selectedJournal === undefined ? undefined : namespaceContext.controller.beginMutation()
  const pending = runWithConcurrency<R>(
    {
      store: namespaceContext.base,
      options: ctx === undefined ? {} : ctx,
      prepare: selectedJournal === undefined ? undefined : () => selectedJournal!.prepare(),
      execute: (context, invoke) =>
        namespaceContext.core.execution.run(
          {
            operation,
            input,
            ctx: context,
            keys: () => mutation?.keys ?? [],
            internal: journaled ? undefined : true
          },
          (captured) => {
            namespaceContext.controller.assertLive()
            /** Direct closure retains accepted work until queued/native admission truly finishes. */
            const release = namespaceContext.controller.beginMutation()
            capturedInput = captured
            try {
              return invoke().finally(release)
            } catch (cause) {
              /** Input/implicit-lock admission can reject before the loop returns its Promise. */
              release()
              throw cause
            }
          }
        ),
      lock: (context) => {
        mutation = prepareMutation(capturedInput, context)
        return selectedJournal === undefined
          ? mutation.keys
          : [...mutation.keys, ...selectedJournal.headLocks()]
      }
    },
    {
      attempt: (attempt) => {
        if (selectedJournal?.active()) {
          if (mutation.invoke === undefined)
            throw new StorageContractError(StorageContractErrorCode.unsupported)
          return namespaceContext.locks.attempt(
            attempt,
            holding(namespaceContext),
            {
              attempt: () =>
                transact(
                  namespaceContext,
                  (_scope, draft) => mutation.invoke!(draft),
                  attempt,
                  mutation.ranges,
                  (identities) => {
                    capacityIdentities = identities
                  }
                )
            },
            namespaceContext.core.stageBindings.concurrencyStages(namespaceContext.store),
            namespaceContext.controller.closingSignal,
            mutation.ranges,
            namespaceContext.capacity === undefined ? undefined : () => capacityIdentities
          )
        }
        return namespaceContext.locks.attemptWrite(
          attempt,
          holding(namespaceContext),
          () => commitCapacity(namespaceContext, capacityPlan, mutation.run),
          namespaceContext.core.stageBindings.concurrencyStages(namespaceContext.store),
          namespaceContext.controller.closingSignal,
          mutation.ranges,
          undefined,
          namespaceContext.capacity === undefined
            ? undefined
            : () => {
                capacityPlan =
                  mutation.capacityChanges === undefined
                    ? undefined
                    : planCapacity(namespaceContext, mutation.capacityChanges())
                return capacityPlan?.identities ?? []
              }
        )
      }
    }
  )
  return preparing === undefined ? pending : pending.finally(preparing)
}

/** All-channel clearing retains its original one coarse event after one synchronous merge. */
function clearAll<T>(namespaceContext: IMemoryNamespaceContext<T>, notify = true): void {
  namespaceContext.controller.assertLive()
  /** Empty physical channels still advance epochs without manufacturing change notifications. */
  const changed =
    namespaceContext.blobs.size !== 0 ||
    namespaceContext.physicalChannels.some((channel) => namespaceContext.data[channel].size !== 0)
  for (const channel of namespaceContext.physicalChannels) {
    namespaceContext.data[channel].clear()
    namespaceContext.ordered[channel].clear()
    namespaceContext.revisions.clear(channel === 'value' ? 'text' : channel)
  }
  namespaceContext.deadlines.clear()
  namespaceContext.expiring?.clear()
  namespaceContext.capacityIndex?.clear()
  namespaceContext.rdfIndex.clear()
  namespaceContext.blobs.clear()
  if (changed && notify)
    namespaceContext.controller.publish({
      channel: 'all',
      kind: 'clear',
      orgId: namespaceContext.orgId
    })
}

/** Channel selection is captured before the shared provider's final synchronous range check. */
function clearEntry<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  operation: string,
  channel: IStorageChannel | undefined,
  ctx: IWriteOptions | undefined
): Promise<void> {
  return mutationEntry(namespaceContext, operation, channel, ctx, (captured) => ({
    keys: [],
    ranges: mutationRanges(
      namespaceContext,
      captured === undefined ? namespaceContext.physicalChannels : [captured]
    ),
    invoke: (draft) => draft.clear(captured),
    run: () =>
      captured === undefined ? clearAll(namespaceContext) : clear(namespaceContext, captured)
  }))
}

/** One existing runner owns every asynchronous public endpoint. */
function asyncEntry<T, I, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  operation: string,
  input: I,
  ctx: IOperationContext | undefined,
  run: (captured: I) => R,
  keys?: (captured: I) => readonly ILockKey[]
): Promise<R> {
  /** The original pipeline's actual captured input is read only if telemetry requests keys. */
  let current = input
  const invoke = (captured: I) => {
    current = captured
    return run(captured)
  }
  const describeKeys = () => keys?.(current) ?? []
  if (namespaceContext.core.journal === undefined)
    return namespaceContext.core.execution.run(
      { operation, input, ctx, keys: describeKeys },
      (captured) => withAbort(ctx, async () => invoke(captured))
    )
  /** The original controller drains lazy org preparation before its native cleanup can finish. */
  const release = namespaceContext.controller.beginMutation()
  return runWithConcurrency<R>(
    {
      store: namespaceContext.base,
      options: ctx ?? {},
      prepare: () => namespaceContext.core.journal!.prepare()
    },
    {
      attempt: async (context) => ({
        status: 'committed',
        value: await namespaceContext.core.execution.run(
          { operation, input, ctx: context, keys: describeKeys },
          (captured) => withAbort(context, async () => invoke(captured))
        )
      })
    }
  ).finally(release)
}

/** Native feeds share one original subscription bridge and the backend's per-next pipeline. */
function watchChanges<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IStorageChange['channel'],
  ctx: IOperationContext | undefined,
  key?: string
): IStorageIterator<IStorageChange> {
  return createBackendChangeIterator(namespaceContext.controller, {
    orgId: namespaceContext.orgId,
    channel,
    key,
    ctx,
    execute: (advance, context) =>
      namespaceContext.core.execution.run(
        { operation: MemoryOperation.watch, input: key, ctx: context },
        advance
      )
  })
}

/** Empty batches have no pipeline or native transaction, while resource expiry still applies. */
function batchSize<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  input: readonly unknown[]
): number {
  namespaceContext.controller.assertLive()
  return (() => {
    if (!Array.isArray(input))
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend: STORAGE_MEMORY_BACKEND
      })
    return input.length
  })()
}

/** One high-level batch reports one observation without exposing per-key native work. */
function observeBatch<T, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  operation: string,
  count: number | undefined,
  invoke: () => R | Promise<R>,
  scope?: IMemoryScope<T>
): Promise<R> {
  /** Observation remains on the original registration and authentic transaction view. */
  const root = namespaceContext.core.stageBindings.operationStages(namespaceContext.store)
  /** A scoped observer captures its real transaction identity before that view expires. */
  const stages = scope === undefined ? root : root.forTransaction(scope)
  return observeStorageBatch(stages, namespaceContext.scheduler, operation, count, invoke)
}

/** Both root and scoped batches capture the same keys and reject duplicates before staging. */
function captureTextEntries<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  entries: Parameters<ITransactionKeyValueApi['setMany']>[0]
): readonly IMemoryTextEntry[] {
  /** The canonical owner captures identities at the original per-entry validation boundary. */
  const capture = createStorageBatchKeyCapture(STORAGE_MEMORY_BACKEND)
  return entries.map((entry, index) => {
    /** Borrowed fields and payload detach once before a policy can wait or a draft can change. */
    const fact = capture(entry.key)
    if (fact.firstIndex !== index)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend: STORAGE_MEMORY_BACKEND
      })
    /** Each optional duration is captured once before any native draft mutation. */
    const ttlMs = entry.ttlMs
    if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, STORAGE_MEMORY_BACKEND)
    return {
      key: fact.key,
      value: prepare(namespaceContext, 'value', entry.value, fact.key) as string,
      ttlMs
    }
  })
}

/** Every duplicate position reuses its first result in both native root and scoped snapshots. */
function readTextBatch<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  keys: readonly IStorageKey[],
  readValue: (key: IStorageKey) => string | undefined
): Array<string | undefined> {
  /** The canonical owner alone validates keys and records their first positions. */
  const captured = snapshotStorageBatchKeys(keys, STORAGE_MEMORY_BACKEND)
  /** Positions are retained without a second identity map or a repeated native read. */
  const values: Array<string | undefined> = []
  for (const [index, fact] of captured.entries())
    values.push(fact.firstIndex === index ? readValue(fact.key) : values[fact.firstIndex])
  return values
}

/** Public transactions and native batches use one original loop, pipeline and attempt owner. */
function atomicEntry<T, I, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  operation: string,
  input: (context: IOperationContextSnapshot) => I,
  ctx: ITransactionOptions | undefined,
  prepare: (captured: I, admit: () => void) => IMemoryAtomicWork<T, R>,
  journaled = true
): Promise<Awaited<R>> {
  /** Private metadata work keeps its original draft and never recursively journals itself. */
  const selectedJournal = journaled ? namespaceContext.core.journal : undefined
  /** One accepted lifetime spans every real attempt and all original pipeline settlement. */
  let release: (() => void) | undefined
  /** The existing lease admits once, including the original callback-capture boundary. */
  const admit = (): void => {
    release ??= namespaceContext.controller.beginMutation()
  }
  if (selectedJournal !== undefined) admit()
  /** Each pipeline fixes this attempt's original callback or detached native batch. */
  let work: IMemoryAtomicWork<T, R>
  /** Only the final original pipeline payload belongs to the one public operation observation. */
  let observedInput: I | undefined
  /** Actual final native facts are copied only for explicitly enabled observation. */
  let observing = false
  let observedKeys: readonly ILockKey[] | undefined
  /** Only actual previous-attempt victim identities feed the original policy's waiting admission. */
  let capacityIdentities: readonly string[] = []
  const execute = () =>
    runWithConcurrency<Awaited<R>>(
      {
        store: namespaceContext.base,
        options: ctx === undefined ? {} : ctx,
        prepare: selectedJournal === undefined ? undefined : () => selectedJournal.prepare(),
        executeAttempt: (context, invoke) =>
          namespaceContext.core.execution.run(
            { operation, input: input(context), ctx: context, internal: true },
            (captured) => {
              namespaceContext.controller.assertLive()
              observedInput = captured
              work = prepare(captured, admit)
              admit()
              return invoke()
            }
          ),
        lock: () =>
          selectedJournal === undefined
            ? (work.keys ?? [])
            : [...(work.keys ?? []), ...selectedJournal.headLocks()]
      },
      {
        attempt: (attempt) =>
          namespaceContext.locks.attempt(
            attempt,
            holding(namespaceContext),
            {
              attempt: () =>
                transact(
                  namespaceContext,
                  work.invoke,
                  attempt,
                  work.ranges,
                  (identities) => {
                    capacityIdentities = identities
                  },
                  journaled,
                  observing
                    ? (keys) => {
                        observedKeys = keys
                      }
                    : undefined
                )
            },
            namespaceContext.core.stageBindings.concurrencyStages(namespaceContext.store),
            namespaceContext.controller.closingSignal,
            work.ranges,
            namespaceContext.capacity === undefined ? undefined : () => capacityIdentities
          )
      }
    ).finally(() => release?.())
  return namespaceContext.core.execution.observe === undefined
    ? execute()
    : namespaceContext.core.execution.observe(
        () => ({
          operation,
          input: observedInput,
          keys: () => observedKeys ?? work?.keys ?? [],
          internal: journaled ? undefined : true
        }),
        (enabled) => {
          observing = enabled
          return execute()
        }
      )
}

/** Native store construction keeps public sync methods separate from internal asynchronous calls. */
function createMemoryNamespaceBase<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['base'] {
  return {
    backend: STORAGE_MEMORY_BACKEND,
    capabilities: {
      batch: true,
      syncRead: true,
      binary: true,
      records: true,
      transactions: true,
      iteration: true,
      secondaryIndexes: false,
      changeFeed: true,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    sync: createMemoryNamespaceSync(namespaceContext),
    ...createMemoryNamespaceBaseText(namespaceContext),
    ...createMemoryNamespaceBaseBytes(namespaceContext),
    ...createMemoryNamespaceBaseRecords(namespaceContext),
    ...createMemoryNamespaceBaseTransactions(namespaceContext),
    ...(namespaceContext.core.journal === undefined
      ? {}
      : {
          undo: async (txId: string, ctx?: IOperationContext) => {
            namespaceContext.controller.assertLive()
            /** The existing controller drains accepted image lookup and the actual native commit. */
            const release = namespaceContext.controller.beginMutation()
            /**
             * This outer call supplies only the original shared budget; the builder owns all locks,
             * retries, the one pipeline and native data transaction.
             */
            return runWithConcurrency<{ readonly txId: string }>(
              {
                store: namespaceContext.base,
                options: ctx === undefined ? {} : ctx,
                prepare: () => namespaceContext.core.journal!.prepare()
              },
              {
                attempt: async (context) => ({
                  status: 'committed',
                  value: await namespaceContext.core.journal!.undo(txId, (keys, work) =>
                    createTransactionBuilder(
                      namespaceContext.store,
                      context,
                      namespaceContext.core.getChainMethods('tx')
                    )
                      .lock(keys[0]!, ...keys.slice(1))
                      .run(work)
                  )
                })
              }
            ).finally(release)
          }
        }),
    ...createMemoryNamespaceBaseObservation(namespaceContext),
    [asyncDisposeKey]: () =>
      (namespaceContext.symbolic ??= namespaceContext.controller
        .dispose()
        .catch((error) => reportCleanupError(namespaceContext.report, error)))
  }
}

/** Bound bytes are independently held and reused for radix localization rather than full scans. */
function orderedRange<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  range: IKeyRange | undefined
): IOrderedRecordRange {
  /** The original range owner captures every caller getter and mutable logical bound. */
  const captured = snapshotKeyRange(range, STORAGE_MEMORY_BACKEND)
  return {
    lower:
      captured?.lower === undefined
        ? undefined
        : encodeOrderedStorageKey(captured.lower, STORAGE_MEMORY_BACKEND),
    upper:
      captured?.upper === undefined
        ? undefined
        : encodeOrderedStorageKey(captured.upper, STORAGE_MEMORY_BACKEND),
    lowerOpen: captured?.lowerOpen,
    upperOpen: captured?.upperOpen
  }
}

/** RDF graph projection reuses the one contract owner while keeping this namespace immutable. */
function physicalRdfPattern<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  pattern: Readonly<Partial<IQuad>>
): Readonly<Partial<IQuad>> {
  return pattern.graph === undefined
    ? pattern
    : { ...pattern, graph: prefixStorageOrgGraph(namespaceContext.orgId, pattern.graph) }
}

/** Physical graph envelopes never escape a native organization view. */
function logicalRdfQuad<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  entry: IMemoryEntry
): IQuad {
  /** Native RDF entries own detached ground terms and an organization-prefixed named graph. */
  const quad = entry.value as IQuad
  return {
    ...quad,
    graph: unprefixStorageOrgGraph(
      namespaceContext.orgId,
      quad.graph as Parameters<typeof unprefixStorageOrgGraph>[1]
    )
  }
}

/** Full-batch canonical capture finishes before any logical lock or physical mutation. */
function captureRdfEntries<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  input: readonly IQuad[]
): readonly IMemoryRdfEntry[] {
  return (() => {
    if (!Array.isArray(input))
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend: STORAGE_MEMORY_BACKEND
      })
    /** Borrowed array bounds are captured once before validating any member or changing data. */
    const length = input.length
    /** Duplicate quads share one eventual physical change after every input has been admitted. */
    const entries = new Map<string, IMemoryRdfEntry>()
    for (let index = 0; index < length; index++) {
      /** The contract alone owns ground position rules and detached term identity. */
      const logical = snapshotStorageRdfQuad(input[index]!, STORAGE_MEMORY_BACKEND)
      /** Each namespace stores real organization graphs even though its maps are also isolated. */
      const value = {
        ...logical,
        graph: prefixStorageOrgGraph(namespaceContext.orgId, logical.graph)
      }
      /** Explicit user locks and additional capacity victims must meet on this logical quad. */
      const rdfLock = lockKey.rdf(logical)
      /** A string row key avoids reclassifying large canonical RDF bytes as public binary keys. */
      const encoded = snapshotConcurrencyLockKeys([lockKey.rdf(value)], STORAGE_MEMORY_BACKEND)
        .identities[0]!
      /** Six physical permutations retain only the canonical term writer's independent bytes. */
      const rdfKeys = memoryRdfKeys(value)
      entries.set(encoded, {
        key: encoded,
        encoded,
        value,
        ordered: rdfKeys[0]!,
        rdfKeys,
        rdfLock,
        bytes: entryBytes(namespaceContext, 'rdf', value)
      })
    }
    return [...entries.values()]
  })()
}

/** Root pattern reads stream only the selected native prefix and retain safe leaf advancement. */
function* rdfRows<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  pattern: Readonly<Partial<IQuad>>
): IterableIterator<IMemoryEntry> {
  for (const row of namespaceContext.rdfIndex.match(
    physicalRdfPattern(namespaceContext, pattern)
  )) {
    namespaceContext.capacityIndex?.touch(identity(namespaceContext, 'rdf', row.key as string))
    yield row
  }
}

/** Root RDF queries expose truthful pattern access; traversal, sorting and cursors keep their owner. */
function rootRdfQuery<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  pattern: Partial<IQuad>
): ReturnType<IRdfApi['match']> {
  namespaceContext.controller.assertLive()
  /** Caller getters detach at construction; native execution later receives this trusted shape. */
  const captured = snapshotStorageRdfPattern(pattern, STORAGE_MEMORY_BACKEND)
  return createRdfQuery(
    {
      asyncDisposeKey,
      cursorSource: namespaceContext.store,
      watch: ({ ctx }) => watchChanges(namespaceContext, 'all', ctx),
      mutate: (request, run) =>
        atomicEntry(
          namespaceContext,
          request.operation === 'delete'
            ? MemoryOperation.rdfQueryDelete
            : MemoryOperation.rdfQueryReplace,
          () => ({ ...request }),
          { ...request.ctx, concurrency: request.concurrency },
          (input) => ({ invoke: (scope) => scope[queryDraft].rdf(input, run) })
        ),
      pushdown: {
        source: MemoryState.querySource,
        index: namespaceContext.rdfIndex.select(physicalRdfPattern(namespaceContext, captured))
          .name,
        operations: [],
        operators: []
      },
      execute: (input) =>
        nativeIterator(
          namespaceContext,
          MemoryOperation.rdfMatch,
          input.ctx,
          () => rdfRows(namespaceContext, input.pattern),
          (row): readonly [IStorageKey, IQuad] => [row.key, logicalRdfQuad(namespaceContext, row)]
        )
    },
    captured,
    namespaceContext.core.getChainMethods('rdf')
  )
}

/** Root scans retain one actual native generator and one cached cleanup path. */
function rootIterator<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  range: IKeyRange | undefined,
  ctx: IOperationContext | undefined
): IStorageIterator<[IStorageKey, T]> {
  /** Bounds capture at construction; data membership and values capture on the first actual next. */
  const captured = orderedRange(namespaceContext, range)
  return nativeIterator(
    namespaceContext,
    MemoryOperation.iterateRecords,
    ctx,
    () =>
      [...namespaceContext.ordered.record.range(captured)]
        .map((leaf) => {
          const encoded = encodeFlatStorageKey(leaf.value.key)
          const entry = liveEntry(namespaceContext, 'record', encoded)
          if (entry !== undefined)
            namespaceContext.capacityIndex?.touch(identity(namespaceContext, 'record', encoded))
          return entry
        })
        .filter((entry): entry is IMemoryEntry => entry !== undefined),
    (row): [IStorageKey, T] => [
      clone(namespaceContext, row.key),
      clone(namespaceContext, row.value) as T
    ]
  )
}

/** Native families reuse this original memory generator and its cached cleanup/signal owner. */
function nativeIterator<T, V, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  operation: string,
  ctx: IOperationContext | undefined,
  select: () => Iterable<V>,
  project: (row: V) => R,
  beforeNext?: () => void
): IStorageIterator<R> {
  /** This actual iterator alone owns its timeout and caller abort subscriptions. */
  const merged = mergeSignals(ctx, namespaceContext.report)
  /** The primary cleanup Promise seals further native advances synchronously. */
  let disposal: Promise<void> | undefined
  /** Symbolic disposal reports once through its separately cached derivative. */
  let symbolic: Promise<void> | undefined
  /** Iterator return shares the same cleanup while retaining its own result Promise. */
  let returned: Promise<IteratorResult<R>> | undefined
  /** The generator supplies serialization of native next/return without another resource queue. */
  const native = (async function* () {
    namespaceContext.controller.assertLive()
    throwIfAborted(merged.signal)
    /** Committed values are immutable to callers and snapshot with native membership. */
    const rows = select()
    for (const row of rows) {
      namespaceContext.controller.assertLive()
      throwIfAborted(merged.signal)
      yield project(row)
    }
  })()
  /** Explicit return, natural completion and disposal release this same generator and signal owner. */
  const dispose = (): Promise<void> =>
    (disposal ??= Promise.resolve().then(async () => {
      try {
        await native.return(undefined)
      } finally {
        merged.dispose()
      }
    }))
  return {
    next: () => {
      try {
        beforeNext?.()
        return namespaceContext.core.execution.run(
          { operation, input: undefined, ctx },
          async () => {
            if (disposal) {
              await disposal
              return { done: true, value: undefined }
            }
            try {
              /** Each original native advancement completes before its result is exposed. */
              const result = await native.next()
              if (result.done) await dispose()
              return result
            } catch (cause) {
              await dispose()
              throw cause
            }
          }
        )
      } catch (cause) {
        return Promise.reject(cause)
      }
    },
    return: (value) => (returned ??= dispose().then(() => ({ done: true, value }))),
    dispose,
    [asyncDisposeKey]: () =>
      (symbolic ??= dispose().catch((error) => reportCleanupError(namespaceContext.report, error))),
    [Symbol.asyncIterator]() {
      return this
    }
  }
}

/** One accepted native attempt owns its draft, repeatable reads and original scope controls. */
type IMemoryTransactionContext<T, R> = {
  /** Original namespaceContext belongs to this accepted transaction attempt. */
  readonly namespaceContext: IMemoryNamespaceContext<T>
  /** Original run belongs to this accepted transaction attempt. */
  readonly run: (scope: IMemoryScope<T>, draft: IMemoryTextDraft) => R
  /** Original ctx belongs to this accepted transaction attempt. */
  readonly ctx: IConcurrencyAttemptContext
  /** Original protectedRanges belongs to this accepted transaction attempt. */
  readonly protectedRanges: IMemoryRootMutation<unknown>['ranges']
  /** Original setCapacityIdentities belongs to this accepted transaction attempt. */
  readonly setCapacityIdentities?: (identities: readonly string[]) => void
  /** Original journaled belongs to this accepted transaction attempt. */
  readonly journaled: boolean
  /** Original observeKeys belongs to this accepted transaction attempt. */
  readonly observeKeys?: (keys: readonly ILockKey[]) => void

  /** Private log writes and terminal effects belong to this exact original native attempt. */
  journalDraft: ReturnType<IMemoryNamespaceContext<T>['journal']['draft']> | undefined

  /** Only touched identities retain draft entries; rollback never rewrites committed maps. */
  draft: Map<string, IMemoryDraft>

  /** Opt-in ordered facts exist only for this authentic attempt, never for ordinary memory work. */
  journalChanges: Array<Omit<IStorageJournalChange, 'afterRevision'>> | undefined

  /** Only journal-selected policy victims gain draft tombstones before the same final commit. */
  journalVictims: Set<string> | undefined

  /** The original capacity plan must still select these same rows after asynchronous append. */
  journalCapacity: ReturnType<typeof planCapacity>

  /** Root clear keeps the original coarse epoch transition, without exposing a new scope method. */
  clearedChannels: readonly IMemoryChannel[] | undefined

  /** The original all-channel clear publishes one broad event instead of per-channel batches. */
  clearAllRequested: boolean

  /** Preserve whether the original physical clear has an event, even if capture prunes expiry. */
  clearChanged: boolean

  /** Each channel draft reuses the same compressed radix implementation, including tombstones. */
  draftOrdered: Record<IMemoryChannel, ReturnType<typeof createOrderedRecordIndex<IMemoryDraft>>>

  /** Proposed RDF entries and tombstones use the same six native permutations. */
  draftRdfIndex: ReturnType<typeof createMemoryRdfIndex<IMemoryDraft>>

  /** First reads are repeatable until a write in this attempt replaces their snapshot. */
  snapshots: Map<string, IMemorySnapshot | undefined>

  /** Per-key tombstone revisions detect delete/reinsert and other ABA writes. */
  expected: Map<
    string,
    { channel: IMemoryChannel; encoded: string; key: IStorageKey; revision: number }
  >

  /** A clear invalidates only channels already observed by this native attempt. */
  snapshotEpochs: Map<IMemoryChannel, number>

  /** The original owner retains the first asynchronous operation failure. */
  failure: (Error & { readonly source: string; readonly code: string }) | undefined

  /** Native text batches stage only into this attempt's existing draft and revision baseline. */
  textDraft: IMemoryTextDraft

  /** The initial callback view is created and registered by the original owner exactly once. */
  scope: IMemoryScope<T>

  /** Original registration authenticates this same scope before any journal capture is enabled. */
  journalAttempt: ReturnType<NonNullable<IStoragePluginCore['journal']>['begin']>

  /** Final checks receive fresh complete native views under the same transaction identity. */
  control: ReturnType<IMemoryNamespaceContext<T>['owner']['register']>

  /** Terminal observations retain identity captured while the original scope was valid. */
  stage: ReturnType<
    ReturnType<IStoragePluginCore['stageBindings']['transactionStages']>['forTransaction']
  >
}
/** Execute one isolated attempt while the shared contract owner controls policy and retry. */
async function transact<T, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  run: (scope: IMemoryScope<T>, draft: IMemoryTextDraft) => R,
  ctx: IConcurrencyAttemptContext,
  protectedRanges?: IMemoryRootMutation<unknown>['ranges'],
  setCapacityIdentities?: (identities: readonly string[]) => void,
  journaled = true,
  observeKeys?: (keys: readonly ILockKey[]) => void
): Promise<IConcurrencyAttempt<Awaited<R>>> {
  /** Native attempt state is complete before callback admission begins. */
  const transactionContext = createMemoryTransactionContext(
    namespaceContext,
    run,
    ctx,
    protectedRanges,
    setCapacityIdentities,
    journaled,
    observeKeys
  )
  try {
    if (transactionContext.journaled)
      transactionContext.journalAttempt = transactionContext.namespaceContext.core.journal?.begin(
        transactionContext.scope
      )
    void transactionContext.stage.beforeTransaction?.()
    void transactionContext.stage.onTransactionStart?.()
    /** The callback itself is an accepted operation, so its failure cannot bypass first-error state. */
    const value = await runTransactionOperation(transactionContext.scope, (current) =>
      transactionContext.run(current, transactionContext.textDraft)
    )
    transactionContext.control.stopAdmission()
    await transactionContext.control.runFinalizers()
    transactionContext.namespaceContext.controller.assertLive()
    throwIfAborted(transactionContext.ctx.signal)
    /** Return the same conflict before changing any committed row. */
    const conflict = memoryTransactionConflict(transactionContext)
    if (conflict !== undefined) return conflict
    /** Final capacity admission shares the same original attempt, locks and no-await commit turn. */
    const capacityPlan = draftCapacityPlan(transactionContext)
    /** Capacity retains the existing original-attempt admission point. */
    const capacityConflict = memoryTransactionCapacityConflict(transactionContext, capacityPlan)
    if (capacityConflict !== undefined) return capacityConflict
    /** Each channel reports one batch after all physical draft rows have committed. */
    commitMemoryTransaction(transactionContext, capacityPlan)
    return { status: 'committed', value }
  } catch (cause) {
    /** The original owner combines cleanup after the first failure without replacing its cause. */
    let primary =
      transactionContext.failure ?? normalize(transactionContext.namespaceContext, cause)
    try {
      await transactionContext.control.closeIterators()
    } catch (cleanup) {
      primary = normalize(transactionContext.namespaceContext, cleanup)
    }
    void transactionContext.stage.afterRollback?.(primary.code)
    throw primary
  } finally {
    transactionContext.journalDraft?.complete(false)
    if (transactionContext.journalAttempt?.settle !== undefined)
      await transactionContext.journalAttempt.settle()
    transactionContext.control.close()
    if (transactionContext.observeKeys !== undefined)
      transactionContext.observeKeys(
        [...transactionContext.expected.values()]
          .map((entry) => {
            const physical =
              transactionContext.draft.get(
                identity(transactionContext.namespaceContext, entry.channel, entry.encoded)
              ) ?? transactionContext.namespaceContext.data[entry.channel].get(entry.encoded)
            return capacityLock(
              transactionContext.namespaceContext,
              capacityFact(
                transactionContext.namespaceContext,
                entry.channel,
                entry.key,
                undefined,
                physical?.rdfLock
              )
            )
          })
          .filter((key): key is ILockKey => key !== undefined)
      )
    transactionContext.draft.clear()
    transactionContext.snapshots.clear()
    transactionContext.expected.clear()
    transactionContext.snapshotEpochs.clear()
    for (const channel of transactionContext.namespaceContext.physicalChannels)
      transactionContext.draftOrdered[channel].clear()
    transactionContext.draftRdfIndex.clear()
    void transactionContext.stage.onTransactionClose?.()
  }
}

/** Ordinary transactions allocate no private metadata rows or terminal channels until used. */
function privateJournal<T, R>(transactionContext: IMemoryTransactionContext<T, R>) {
  return (transactionContext.journalDraft ??= transactionContext.namespaceContext.journal.draft())
}

/** Capture the real revision once, before any draft read or write. */
function track<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  channel: IMemoryChannel,
  encoded: string,
  key: IStorageKey
): string {
  if (!transactionContext.snapshotEpochs.has(channel))
    transactionContext.snapshotEpochs.set(
      channel,
      transactionContext.namespaceContext.revisions.epoch(channel === 'value' ? 'text' : channel)
    )
  /** Channel plus original flat key identifies one actual native row. */
  const id = identity(transactionContext.namespaceContext, channel, encoded)
  if (!transactionContext.expected.has(id))
    transactionContext.expected.set(id, {
      channel,
      encoded,
      key,
      revision: revision(transactionContext.namespaceContext, channel, encoded)
    })
  return id
}

/** First access captures value, deadline and revision once; later reads retain that snapshot. */
function txSnapshot<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  channel: IMemoryChannel,
  encoded: string,
  key: IStorageKey
): IMemorySnapshot | undefined {
  /** Existing observations are never refreshed from a later clock or physical mutation. */
  const id = identity(transactionContext.namespaceContext, channel, encoded)
  if (!transactionContext.snapshots.has(id)) {
    /** Expiry removes the physical row before its revision baseline is observed. */
    const current = liveEntry(transactionContext.namespaceContext, channel, encoded)
    track(transactionContext, channel, encoded, key)
    transactionContext.snapshots.set(
      id,
      current === undefined
        ? undefined
        : {
            key,
            value: copyValue(transactionContext.namespaceContext, channel, current.value, key),
            ordered: current.ordered,
            bytes: current.bytes,
            rdfKeys: current.rdfKeys,
            rdfLock: current.rdfLock,
            deadline: transactionContext.namespaceContext.deadlines.get(id)
          }
    )
  }
  return transactionContext.snapshots.get(id)
}

/** Read own writes first; otherwise retain the first committed value in this attempt. */
function txEntry<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  channel: IMemoryChannel,
  key: IStorageKey
): IMemorySnapshot | undefined {
  /** Caller-owned keys detach before contributing to revision or draft identity. */
  const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
  /** Every channel uses the same canonical logical-key wire. */
  const encoded = encodeFlatStorageKey(captured)
  /** A draft row replaces the previous read snapshot immediately. */
  const proposed = transactionContext.draft.get(
    identity(transactionContext.namespaceContext, channel, encoded)
  )
  return proposed
    ? proposed.remove
      ? undefined
      : proposed
    : txSnapshot(transactionContext, channel, encoded, captured)
}

/** Every mutable value returned from a retained native snapshot has independent ownership. */
function txRead<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  channel: IMemoryChannel,
  key: IStorageKey
): unknown {
  /** Membership and an undefined-valued record remain separate facts. */
  const current = txEntry(transactionContext, channel, key)
  if (current !== undefined)
    transactionContext.namespaceContext.capacityIndex?.touch(
      identity(transactionContext.namespaceContext, channel, encodeFlatStorageKey(current.key))
    )
  return current === undefined
    ? undefined
    : copyValue(transactionContext.namespaceContext, channel, current.value, current.key)
}

/** Membership shares the same first snapshot, including undefined-valued records. */
function txHas<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  channel: IMemoryChannel,
  encoded: string,
  key: IStorageKey
): boolean {
  /** A tombstone masks physical membership until the attempt commits. */
  const proposed = transactionContext.draft.get(
    identity(transactionContext.namespaceContext, channel, encoded)
  )
  return proposed
    ? !proposed.remove
    : txSnapshot(transactionContext, channel, encoded, key) !== undefined
}

/** Draft hash and ordered range lookup retain one actual proposed row reference. */
function stageDraft<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  entry: IMemoryDraft,
  metadataOnly = false
): void {
  captureJournalStage(transactionContext, entry, metadataOnly)
  /** Replacing one draft value keeps its original independently owned key encoding. */
  const proposed = {
    ...entry,
    ordered: transactionContext.draftOrdered[entry.channel].get(entry.ordered)?.key ?? entry.ordered
  }
  transactionContext.draft.set(
    track(transactionContext, proposed.channel, proposed.encoded, proposed.key),
    proposed
  )
  if (proposed.channel === 'rdf') transactionContext.draftRdfIndex.set(proposed.rdfKeys!, proposed)
  else transactionContext.draftOrdered[proposed.channel].set(proposed.ordered, proposed)
}

/** Prepare first, then stage eviction and put atomically within this native draft. */
function txWrite<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  channel: IStorageChannel,
  key: IStorageKey,
  value: unknown,
  policy: IConflictPolicy,
  ttlMs?: number
): void {
  /** Preparation can reject before any prior channel loses draft membership. */
  const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
  /** One logical-key encoding serves all affected channels. */
  const encoded = encodeFlatStorageKey(captured)
  /** Clone caller-owned payload before mutating the draft. */
  const prepared = prepare(transactionContext.namespaceContext, channel, value, captured)
  /** Explicit byte-domain failure happens before staging any replacement or native victim. */
  const bytes = entryBytes(transactionContext.namespaceContext, channel, prepared)
  /** Channel conflict semantics are owned by the same shared plan as root writes. */
  const existing = new Set(
    MemoryState.channels.filter((current) => txHas(transactionContext, current, encoded, captured))
  )
  /** The canonical plan retains eviction order and the existing duplicate-key diagnostic. */
  const plan = planChannelWrite(captured, channel, existing, policy, STORAGE_MEMORY_BACKEND)
  /** Encode this logical key once for all affected channel draft entries. */
  const keyBytes = encodeOrderedStorageKey(captured, STORAGE_MEMORY_BACKEND)
  for (const previous of plan.remove)
    stageDraft(transactionContext, {
      channel: previous,
      key: captured,
      value: undefined,
      remove: true,
      encoded,
      ordered: keyBytes
    })
  /** Overwriting a live row retains its deadline unless this batch supplies a new duration. */
  const current = txEntry(transactionContext, channel, captured)
  stageDraft(transactionContext, {
    channel,
    key: captured,
    value: prepared,
    bytes,
    remove: false,
    encoded,
    ordered: keyBytes,
    deadline:
      ttlMs === undefined
        ? current?.deadline
        : transactionContext.namespaceContext.scheduler.now() + ttlMs
  })
}

/** Delete returns actual draft membership, so repeated keys count at most once. */
function txRemove<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  channel: IStorageChannel | 'vector',
  key: IStorageKey
): boolean {
  /** Delete keys follow the same detached canonical domain as reads and writes. */
  const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
  /** One encoding serves membership and the resulting tombstone. */
  const encoded = encodeFlatStorageKey(captured)
  if (!txHas(transactionContext, channel, encoded, captured)) return false
  /** Existing physical or proposed membership already owns this exact ordered identity. */
  const current =
    transactionContext.draft.get(identity(transactionContext.namespaceContext, channel, encoded)) ??
    txSnapshot(transactionContext, channel, encoded, captured)!
  stageDraft(transactionContext, {
    channel,
    key: captured,
    value: undefined,
    remove: true,
    encoded,
    ordered: current.ordered
  })
  return true
}

/** Localize both physical and draft trees, then merge only their actual range candidates. */
function txRows<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  channel: IStorageChannel,
  range?: IOrderedRecordRange
): IMemoryEntry[] {
  if (!transactionContext.snapshotEpochs.has(channel))
    transactionContext.snapshotEpochs.set(
      channel,
      transactionContext.namespaceContext.revisions.epoch(channel === 'value' ? 'text' : channel)
    )
  /** Independent owner iterators begin at the same lower bound, without scanning other draft keys. */
  const physical = transactionContext.namespaceContext.ordered[channel].range(range)
  const proposed = transactionContext.draftOrdered[channel].range(range)
  /** The native scan captures only candidates selected by these actual bounds. */
  const rows: IMemoryEntry[] = []
  let left = physical.next()
  let right = proposed.next()
  while (!left.done || !right.done) {
    /** Equal canonical identities are decided by the draft, including its tombstone. */
    const comparison = left.done
      ? 1
      : right.done
        ? -1
        : compareRecordIndexKeys(left.value.key, right.value.key)
    if (comparison < 0) {
      /** First range access uses the same repeatable membership and deadline as point reads. */
      const row = left.value!.value
      /** Expiry unlinks this leaf, so retain the next original candidate before pruning it. */
      left = physical.next()
      const current = txSnapshot(
        transactionContext,
        channel,
        encodeFlatStorageKey(row.key),
        row.key
      )
      if (current !== undefined) rows.push(current)
    } else {
      if (!right.value!.value.remove) rows.push(right.value!.value)
      if (comparison === 0) left = physical.next()
      right = proposed.next()
    }
  }
  return rows
}

/** RDF writes retain the same original draft, first-read revisions and logical lock facts. */
function txRdfWrite<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  input: readonly IQuad[],
  remove: boolean
): void {
  /** Admission of the entire batch precedes even the first draft tombstone. */
  const entries = captureRdfEntries(transactionContext.namespaceContext, input)
  for (const entry of entries) {
    /** Draft and first-read membership share the original channel identity. */
    const id = identity(transactionContext.namespaceContext, 'rdf', entry.encoded)
    /** Own writes mask physical membership without introducing another transaction owner. */
    const proposed = transactionContext.draft.get(id)
    /** The original first-read owner records even absence for ABA conflict checks. */
    const current = proposed
      ? proposed.remove
        ? undefined
        : proposed
      : txSnapshot(transactionContext, 'rdf', entry.encoded, entry.key)
    if (remove ? current === undefined : current !== undefined) continue
    stageDraft(transactionContext, { ...entry, channel: 'rdf', remove })
  }
}

/** Physical and proposed prefix scans merge by identity without materializing complete results. */
function* txRdfRows<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  pattern: Readonly<Partial<IQuad>>
): IterableIterator<IMemoryEntry> {
  if (!transactionContext.snapshotEpochs.has('rdf'))
    transactionContext.snapshotEpochs.set(
      'rdf',
      transactionContext.namespaceContext.revisions.epoch('rdf')
    )
  /** Both trees receive one identical bound graph envelope and access-path choice. */
  const physical = physicalRdfPattern(transactionContext.namespaceContext, pattern)
  for (const row of transactionContext.namespaceContext.rdfIndex.match(physical)) {
    /** The original physical key remains a string even for a large literal. */
    const encoded = row.key as string
    if (transactionContext.draft.has(identity(transactionContext.namespaceContext, 'rdf', encoded)))
      continue
    /** Repeat reads retain the first physical snapshot and original revision. */
    const current = txSnapshot(transactionContext, 'rdf', encoded, row.key)
    if (current !== undefined) {
      transactionContext.namespaceContext.capacityIndex?.touch(
        identity(transactionContext.namespaceContext, 'rdf', encoded)
      )
      yield current
    }
  }
  for (const row of transactionContext.draftRdfIndex.match(physical)) if (!row.remove) yield row
}

/** The original transaction owner admits each native advance and closes the actual generator. */
function rdfQuery<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  pattern: Partial<IQuad>,
  scope: ITransactionScope<T>,
  mutate: NonNullable<IRdfQuerySource<ITransactionScope<T>>['mutate']>
): ReturnType<ITransactionRdfApi['match']> {
  /** The shared planner owns subsequent query snapshots and operation-scope rebinding. */
  const captured = snapshotStorageRdfPattern(pattern, STORAGE_MEMORY_BACKEND)
  return createRdfQuery<undefined, Record<never, never>, ITransactionScope<T>>(
    {
      asyncDisposeKey,
      cursorSource: scope,
      mutate,
      pushdown: {
        source: MemoryState.querySource,
        index: transactionContext.namespaceContext.rdfIndex.select(
          physicalRdfPattern(transactionContext.namespaceContext, captured)
        ).name,
        operations: [],
        operators: []
      },
      execute: (input) => {
        /** This actual generator, including client traversal children, has one native owner. */
        const iterator = (async function* () {
          for (const row of txRdfRows(transactionContext, input.pattern)) {
            transactionContext.namespaceContext.controller.assertLive()
            throwIfAborted(transactionContext.ctx.signal)
            yield [row.key, logicalRdfQuad(transactionContext.namespaceContext, row)] as const
          }
        })()
        return transactionContext.namespaceContext.owner.registerIterator(
          input.operationScope ?? scope,
          {
            next: (current) =>
              transactionContext.namespaceContext.core.execution.run(
                {
                  operation: MemoryOperation.rdfMatch,
                  input: input.pattern,
                  scope: current,
                  ctx: transactionContext.ctx
                },
                () => iterator.next()
              ),
            close: async () => {
              await iterator.return(undefined)
            }
          }
        )
      }
    },
    captured,
    transactionContext.namespaceContext.core.getChainMethods('rdf')
  )
}

/** Query selection borrows the original iterator owner without a second operation pipeline. */
function queryIterator<T, R, V>(
  transactionContext: IMemoryTransactionContext<T, R>,
  scope: ITransactionScope<T>,
  rows: () => Iterable<readonly [IStorageKey, V]>
): IStorageIterator<readonly [IStorageKey, V]> {
  assertTransactionOwner(transactionContext.namespaceContext.store, scope)
  /** The actual generator is drained and closed by this existing native transaction owner. */
  const iterator = (async function* () {
    for (const row of rows()) {
      transactionContext.namespaceContext.controller.assertLive()
      throwIfAborted(transactionContext.ctx.signal)
      yield row
    }
  })()
  return transactionContext.namespaceContext.owner.registerIterator(scope, {
    next: () => iterator.next(),
    close: async () => {
      await iterator.return(undefined)
    }
  })
}

/** A vector write attempt streams native candidates while retaining the original read set. */
function* txVectorPoints<T, R, P>(
  transactionContext: IMemoryTransactionContext<T, R>,
  collection: string
): IterableIterator<IStorageVectorPoint<P>> {
  if (!transactionContext.snapshotEpochs.has('vector'))
    transactionContext.snapshotEpochs.set(
      'vector',
      transactionContext.namespaceContext.revisions.epoch('vector')
    )
  /** Physical and proposed rows use the same canonical collection tuple prefix. */
  const bounds = snapshotStorageKeyPrefix([collection], STORAGE_MEMORY_BACKEND)
  let leaf = transactionContext.namespaceContext.ordered.vector.lowerBound(bounds.lower)
  while (leaf !== undefined && compareRecordIndexKeys(leaf.key, bounds.upper) < 0) {
    /** Expiry can unlink this row before the generator advances again. */
    const next = leaf.next
    const key = leaf.value.key
    const encoded = encodeFlatStorageKey(key)
    if (
      !transactionContext.draft.has(
        identity(transactionContext.namespaceContext, 'vector', encoded)
      )
    ) {
      const current = txSnapshot(transactionContext, 'vector', encoded, key)
      if (current !== undefined) yield current.value as IStorageVectorPoint<P>
    }
    leaf = next
  }
  for (const row of transactionContext.draftOrdered.vector.range({
    lower: bounds.lower,
    upper: bounds.upper,
    upperOpen: true
  }))
    if (!row.value.remove) yield row.value.value as IStorageVectorPoint<P>
}

/** Native text batches stage only into this attempt's existing draft and revision baseline. */
function createMemoryTransactionTextDraft<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>
): IMemoryTransactionContext<T, R>['textDraft'] {
  return {
    write: (
      channel: IStorageChannel,
      key: IStorageKey,
      value: unknown,
      policy: IConflictPolicy,
      ttlMs?: number
    ) => txWrite(transactionContext, channel, key, value, policy, ttlMs),
    remove: (channel: IStorageChannel | 'vector', key: IStorageKey) =>
      txRemove(transactionContext, channel, key),
    clear: (channel) => {
      /** Blob has no shared image target, so an all-channel clear must not silently delete it. */
      if (channel === undefined && transactionContext.namespaceContext.blobs.size !== 0)
        throw new StorageContractError(StorageContractErrorCode.unsupported)
      transactionContext.clearedChannels =
        channel === undefined ? transactionContext.namespaceContext.physicalChannels : [channel]
      transactionContext.clearAllRequested = channel === undefined
      transactionContext.clearChanged = transactionContext.clearedChannels.some(
        (current) => transactionContext.namespaceContext.data[current].size !== 0
      )
      for (const current of transactionContext.clearedChannels) {
        if (!transactionContext.snapshotEpochs.has(current))
          transactionContext.snapshotEpochs.set(
            current,
            transactionContext.namespaceContext.revisions.epoch(
              current === 'value' ? 'text' : current
            )
          )
        /** Native Map iteration advances safely when the original TTL owner prunes an entry. */
        for (const [encoded, entry] of transactionContext.namespaceContext.data[current]) {
          const snapshot = txSnapshot(transactionContext, current, encoded, entry.key)
          if (snapshot !== undefined)
            stageDraft(transactionContext, { ...snapshot, channel: current, encoded, remove: true })
        }
      }
    },
    ttl: (target, ms, persist) => txTtl(transactionContext, target, ms, persist),
    increment: (key, increment) => {
      const result = increment(txRead(transactionContext, 'value', key) as string | undefined)
      txWrite(transactionContext, 'value', key, String(result), 'conflict')
      return result
    },
    upsertVector: (collection, points, sizes, ttlMs) => {
      /** Captured vector inputs enter the existing native draft without a second public pipeline. */
      const now = transactionContext.namespaceContext.scheduler.now()
      for (const [index, point] of points.entries()) {
        const key = vectorKey(transactionContext.namespaceContext, collection, point.id)
        const encoded = encodeFlatStorageKey(key)
        const current = txEntry(transactionContext, 'vector', key)
        const deadline = ttlMs === undefined ? current?.deadline : now + ttlMs
        if (deadline !== undefined && deadline <= now) {
          txRemove(transactionContext, 'vector', key)
          continue
        }
        stageDraft(transactionContext, {
          channel: 'vector',
          key,
          encoded,
          value: point,
          remove: false,
          ordered: current?.ordered ?? encodeOrderedStorageKey(key, STORAGE_MEMORY_BACKEND),
          bytes: sizes[index],
          deadline
        })
      }
    },
    deleteVector: (collection, predicate) => {
      let count = 0
      for (const point of txVectorPoints(transactionContext, collection))
        if (
          predicate(point) &&
          txRemove(
            transactionContext,
            'vector',
            vectorKey(transactionContext.namespaceContext, collection, point.id)
          )
        )
          count++
      return count
    },
    rdf: (input: readonly IQuad[], remove: boolean) =>
      txRdfWrite(transactionContext, input, remove),
    setMany: (entries) => {
      for (const entry of entries)
        txWrite(transactionContext, 'value', entry.key, entry.value, 'conflict', entry.ttlMs)
    },
    removeMany: (keys) => {
      /** Duplicate identities can only remove the first still-present draft entry. */
      let count = 0
      for (const key of keys) if (txRemove(transactionContext, 'value', key)) count++
      return count
    },
    removeByPrefix: (prefix, channel = 'value') => {
      /** Native prefix localization reuses the original canonical bounds and ordered draft merge. */
      const captured = snapshotStorageKeyPrefix(prefix, STORAGE_MEMORY_BACKEND)
      /** Count only actual removals in this channel and this native attempt. */
      let count = 0
      for (const row of txRows(transactionContext, channel, {
        lower: captured.lower,
        upper: captured.upper,
        upperOpen: true
      }))
        if (captured.matches(row.key) && txRemove(transactionContext, channel, row.key)) count++
      return count
    }
  }
}

/** TTL metadata changes stage beside the original value and never create a second draft. */
function txTtl<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  target: IMemoryTtlTarget,
  ms: number | undefined,
  persist: boolean
): boolean {
  /** A TTL target has already been captured by the original contract lock owner. */
  const channel = ttlChannel(transactionContext.namespaceContext, target)
  const current = txEntry(
    transactionContext,
    channel,
    ttlKey(transactionContext.namespaceContext, target)
  )
  if (current === undefined || (persist && current.deadline === undefined)) return false
  stageDraft(
    transactionContext,
    {
      ...current,
      channel,
      encoded: encodeFlatStorageKey(current.key),
      remove: ms === 0,
      deadline: persist ? undefined : transactionContext.namespaceContext.scheduler.now() + ms!
    },
    true
  )
  return true
}

/** Remaining duration observes the same retained transaction value and captured deadline. */
function txRemaining<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  target: IMemoryTtlTarget
): number | undefined {
  /** Missing and unlimited rows share the documented undefined result. */
  const current = txEntry(
    transactionContext,
    ttlChannel(transactionContext.namespaceContext, target),
    ttlKey(transactionContext.namespaceContext, target)
  )
  return current?.deadline === undefined
    ? undefined
    : Math.max(0, current.deadline - transactionContext.namespaceContext.scheduler.now())
}

/** Resolve logical journal identities through this exact org's existing physical key mapping. */
function journalRow<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  input: IStorageJournalTarget
) {
  const captured = snapshotMemoryJournalTarget(input)
  const target = captured.lock
  const channel: IMemoryChannel = target.channel === 'text' ? 'value' : target.channel
  const key =
    target.channel === 'rdf'
      ? captureRdfEntries(transactionContext.namespaceContext, [target.quad])[0]!.key
      : target.channel === 'vector'
        ? vectorKey(transactionContext.namespaceContext, target.collection, target.id)
        : target.key
  const encoded = target.channel === 'rdf' ? (key as string) : encodeFlatStorageKey(key)
  const proposed = transactionContext.draft.get(
    identity(transactionContext.namespaceContext, channel, encoded)
  )
  const current =
    target.channel === 'rdf'
      ? proposed
        ? proposed.remove
          ? undefined
          : proposed
        : txSnapshot(transactionContext, channel, encoded, key)
      : txEntry(transactionContext, channel, key)
  return { ...captured, channel, key, encoded, current }
}

/** Images observe the same draft and deadline as this native transaction's final physical row. */
function readJournalImage<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  input: IStorageJournalTarget
): IStorageJournalImage {
  const row = journalRow(transactionContext, input)
  const current = row.current
  const present =
    current !== undefined &&
    (current.deadline === undefined ||
      current.deadline > transactionContext.namespaceContext.scheduler.now())
  return row.metadata
    ? encodeStorageJournalImage(present && current!.deadline !== undefined, current?.deadline)
    : encodeStorageJournalImage(
        present,
        row.channel === 'rdf' ? true : current?.value,
        row.channel === 'bytes'
      )
}

/** Restore through original staging, cloning, channel-conflict, TTL and RDF admission owners. */
function writeJournalImage<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  input: IStorageJournalTarget,
  image: IStorageJournalImage
): void {
  const row = journalRow(transactionContext, input)
  const captured = decodeStorageJournalImage(image, row.channel === 'bytes' && !row.metadata)
  const value = captured.value
  if (row.metadata) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value)))
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    if (row.current === undefined) {
      if (value === undefined) return
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    }
    stageDraft(
      transactionContext,
      {
        ...row.current,
        channel: row.channel,
        encoded: row.encoded,
        remove: value !== undefined && value <= transactionContext.namespaceContext.scheduler.now(),
        deadline: value as number | undefined
      },
      true
    )
    return
  }
  if (row.lock.channel === 'rdf') {
    if (captured.present && value !== true)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    txRdfWrite(transactionContext, [row.lock.quad], !captured.present)
    return
  }
  if (!captured.present) {
    txRemove(transactionContext, row.channel as IStorageChannel | 'vector', row.key)
    return
  }
  if (row.lock.channel === 'vector') {
    const configuration = transactionContext.namespaceContext.vectorCollections.get(
      row.lock.collection
    )
    if (configuration === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    /** The canonical upsert capture validates this decoded wire before any row is staged. */
    const point = snapshotStorageVectorUpsert(
      [value as IStorageVectorPoint<unknown>],
      configuration,
      STORAGE_MEMORY_BACKEND
    )[0]!
    if (point.id !== row.lock.id)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    stageDraft(transactionContext, {
      channel: 'vector',
      key: row.key,
      encoded: row.encoded,
      ordered: row.current?.ordered ?? encodeOrderedStorageKey(row.key, STORAGE_MEMORY_BACKEND),
      value: point,
      bytes: entryBytes(transactionContext.namespaceContext, 'vector', point),
      remove: false,
      deadline: row.current?.deadline
    })
    return
  }
  txWrite(transactionContext, row.channel as IStorageChannel, row.key, value, 'replace')
}

/** Full revisions include the original clear generation and the final draft's tombstone effect. */
function readJournalRevision<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  input: IStorageJournalTarget
) {
  const row = journalRow(transactionContext, input)
  const id = identity(transactionContext.namespaceContext, row.channel, row.encoded)
  const proposed = transactionContext.draft.get(id)
  const removes =
    proposed?.remove === true ||
    (proposed?.deadline !== undefined &&
      proposed.deadline <= transactionContext.namespaceContext.scheduler.now())
  const changed =
    proposed !== undefined && (!removes || transactionContext.snapshots.get(id) !== undefined)
  if (transactionContext.clearedChannels?.includes(row.channel))
    return {
      epoch: transactionContext.snapshotEpochs.get(row.channel)! + 1,
      revision: 0
    }
  return {
    epoch: transactionContext.snapshotEpochs.get(row.channel)!,
    revision: transactionContext.expected.get(id)!.revision + (changed ? 1 : 0)
  }
}

/** Capture each actual native staging step before it changes this attempt's existing draft. */
function captureJournalStage<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  entry: IMemoryDraft,
  metadataOnly: boolean
): void {
  if (transactionContext.journalChanges === undefined) return
  const id = identity(transactionContext.namespaceContext, entry.channel, entry.encoded)
  const previous = transactionContext.draft.get(id)
  const before = previous
    ? previous.remove
      ? undefined
      : previous
    : txSnapshot(transactionContext, entry.channel, entry.encoded, entry.key)
  const target =
    entry.channel === 'value'
      ? lockKey.text(entry.key)
      : entry.channel === 'bytes'
        ? lockKey.bytes(entry.key as string)
        : entry.channel === 'record'
          ? lockKey.record(entry.key)
          : entry.channel === 'vector'
            ? lockKey.vector(
                (entry.key as readonly [string, string])[0],
                (entry.key as readonly [string, string])[1]
              )
            : entry.rdfLock!
  const after = entry.remove ? undefined : entry
  /** All image encoding finishes before either a draft row or the ordered fact list changes. */
  const proposed: Array<Omit<IStorageJournalChange, 'afterRevision'>> = []
  if (!metadataOnly || entry.remove) {
    const beforeImage = encodeStorageJournalImage(
      before !== undefined,
      entry.channel === 'rdf' ? true : before?.value,
      entry.channel === 'bytes'
    )
    const afterImage = encodeStorageJournalImage(
      after !== undefined,
      entry.channel === 'rdf' ? true : after?.value,
      entry.channel === 'bytes'
    )
    if (beforeImage.present || afterImage.present)
      proposed.push({ target, before: beforeImage, after: afterImage })
  }
  if (target.channel !== 'rdf' && before?.deadline !== after?.deadline)
    proposed.push({
      target: memoryJournalDeadlineTarget(target),
      before: encodeStorageJournalImage(before?.deadline !== undefined, before?.deadline),
      after: encodeStorageJournalImage(after?.deadline !== undefined, after?.deadline)
    })
  transactionContext.journalChanges.push(...proposed)
}

/** Begin capture before the first write, then return detached ordered facts with final revisions. */
function changes<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>
): readonly IStorageJournalChange[] {
  if (transactionContext.journalChanges === undefined) {
    if (transactionContext.draft.size !== 0)
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    transactionContext.journalChanges = []
  }
  const result: IStorageJournalChange[] = []
  for (const change of transactionContext.journalChanges) {
    const row = journalRow(transactionContext, change.target)
    const afterRevision = readJournalRevision(transactionContext, change.target)
    /** A new row removed again leaves no physical mutation or storage.commit to describe. */
    if (
      afterRevision.revision ===
      transactionContext.expected.get(
        identity(transactionContext.namespaceContext, row.channel, row.encoded)
      )!.revision
    )
      continue
    result.push({ ...change, afterRevision })
  }
  return result
}

/** The same physical scope factory serves callbacks, nested operations and final checks. */
/** One published view borrows the original attempt and authentic native scope. */
type IMemoryScopeContext<T, R> = {
  /** The accepted transaction owns draft rows, stages and lifetime. */
  readonly transactionContext: IMemoryTransactionContext<T, R>
  /** Every method uses this published view for owner admission. */
  scope: IMemoryScope<T>
}
/** Publish native channel methods before attaching the original feature API. */
function createScope<T, R>(transactionContext: IMemoryTransactionContext<T, R>): IMemoryScope<T> {
  /** Channel callbacks access the scope only after construction completes. */
  const scopeContext = { transactionContext } as IMemoryScopeContext<T, R>
  scopeContext.scope = {
    [journalOperations]: createMemoryScopeJournal(scopeContext),
    [queryDraft]: createMemoryScopeQueryDraft(scopeContext),
    [recordQueries]: createMemoryScopeRecordQuery(scopeContext),
    [ttlOperations]: createMemoryScopeTtl(scopeContext),
    [counterOperations]: createMemoryScopeCounter(scopeContext),
    [rdfOperations]: createMemoryScopeRdf(scopeContext),
    [recordPrefix]: createMemoryScopeRecordPrefix(scopeContext),
    use: (capability) => useTransactionCapability(scopeContext.scope, capability),
    ...createMemoryScopeText(scopeContext),
    ...createMemoryScopeBytes(scopeContext),
    ...createMemoryScopeRecords(scopeContext)
  }
  /** Feature assembly receives the same authentic native view. */
  const api = transactionContext.namespaceContext.core.createTransactionApi(scopeContext.scope)
  if (api !== undefined)
    Object.defineProperty(scopeContext.scope, 'api', { value: api, enumerable: true })
  return scopeContext.scope
}
/** Admit one native operation before pipeline evaluation and stage observation. */
function memoryScopeOperation<T, R, I, V>(
  scopeContext: IMemoryScopeContext<T, R>,
  name: string,
  input: I,
  invoke: (captured: I) => V,
  settle?: true
): Promise<Awaited<V>> {
  return runTransactionOperation(scopeContext.scope, (current) =>
    acceptedMemoryScopeOperation(scopeContext, name, input, invoke, current, settle)
  )
}
/** Run already-admitted draft work through the sole pipeline and original stage pair. */
function acceptedMemoryScopeOperation<T, R, I, V>(
  scopeContext: IMemoryScopeContext<T, R>,
  name: string,
  input: I,
  invoke: (captured: I) => V,
  current: ITransactionScope,
  settle?: true
): Promise<V> {
  return scopeContext.transactionContext.namespaceContext.core.execution.run(
    { operation: name, input, scope: current, ctx: scopeContext.transactionContext.ctx },
    async (captured) => {
      scopeContext.transactionContext.namespaceContext.controller.assertLive()
      throwIfAborted(scopeContext.transactionContext.ctx.signal)
      /** This current scope is authentic for exactly this operation's original lifetime. */
      const stage = scopeContext.transactionContext.namespaceContext.core.stageBindings
        .transactionStages(scopeContext.transactionContext.namespaceContext.store)
        .forTransaction(current)
      void stage.beforeTxOperation?.(name)
      /** Native memory operations mutate only the private isolated draft. */
      const result = invoke(captured)
      if (settle) {
        /** Query writes finish their existing asynchronous reader before the after stage. */
        const completed = await result
        void stage.afterTxOperation?.(name)
        return completed
      }
      void stage.afterTxOperation?.(name)
      return result
    }
  )
}
/** Empty batches retain owner admission while skipping pipeline and batch observation. */
function memoryScopeBatchOperation<T, R, I extends readonly unknown[], V>(
  scopeContext: IMemoryScopeContext<T, R>,
  name: string,
  input: I,
  invoke: (captured: I) => V
): Promise<Awaited<V>> {
  return runTransactionOperation(scopeContext.scope, (current) => {
    if (batchSize(scopeContext.transactionContext.namespaceContext, input) === 0)
      return invoke(input)
    return acceptedMemoryScopeOperation(
      scopeContext,
      name,
      input,
      (captured) =>
        observeBatch(
          scopeContext.transactionContext.namespaceContext,
          name,
          captured.length,
          () => invoke(captured),
          scopeContext.scope
        ),
      current
    )
  })
}
/** Compose the current native view's Journal channel. */
function createMemoryScopeJournal<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): IMemoryScope<T>[typeof journalOperations] {
  return {
    changes: () => {
      assertTransactionOwner(
        scopeContext.transactionContext.namespaceContext.store,
        scopeContext.scope
      )
      return changes(scopeContext.transactionContext)
    },
    readImage: (target) =>
      runTransactionOperation(scopeContext.scope, () =>
        readJournalImage(scopeContext.transactionContext, target)
      ),
    writeImage: (target, image) =>
      runTransactionOperation(scopeContext.scope, () =>
        writeJournalImage(scopeContext.transactionContext, target, image)
      ),
    readRevision: (target) =>
      runTransactionOperation(scopeContext.scope, () =>
        readJournalRevision(scopeContext.transactionContext, target)
      ),
    run: (prefix, work) =>
      runTransactionOperation(scopeContext.scope, (current) =>
        privateJournal(scopeContext.transactionContext).port.run(prefix, work, (run) =>
          runTransactionOperation(current, run)
        )
      ),
    onCommit: (effect) => {
      assertTransactionOwner(
        scopeContext.transactionContext.namespaceContext.store,
        scopeContext.scope
      )
      return privateJournal(scopeContext.transactionContext).port.onCommit(effect)
    },
    onRollback: (effect) => {
      assertTransactionOwner(
        scopeContext.transactionContext.namespaceContext.store,
        scopeContext.scope
      )
      return privateJournal(scopeContext.transactionContext).port.onRollback(effect)
    }
  }
}
/** Compose the current native view's QueryDraft channel. */
function createMemoryScopeQueryDraft<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): IMemoryScope<T>[typeof queryDraft] {
  return {
    record: (...args) => memoryScopeQueryRecord(scopeContext, ...args),
    rdf: (...args) => memoryScopeQueryRdf(scopeContext, ...args),
    vector: <P>(
      collection: string,
      _request: IQueryDelete,
      run: Parameters<NonNullable<IVectorQuerySource<P>['mutate']>>[1],
      select: IMemoryVectorSelection<P>
    ) => {
      assertTransactionOwner(
        scopeContext.transactionContext.namespaceContext.store,
        scopeContext.scope
      )
      return run({
        execute: (input) =>
          queryIterator(scopeContext.transactionContext, scopeContext.scope, () =>
            select(
              input,
              txVectorPoints<T, R, P>(scopeContext.transactionContext, collection),
              (id) =>
                txRead(
                  scopeContext.transactionContext,
                  'vector',
                  vectorKey(scopeContext.transactionContext.namespaceContext, collection, id)
                ) as IStorageVectorPoint<P> | undefined
            )
          ),
        accept: (_key, hit) => {
          assertTransactionOwner(
            scopeContext.transactionContext.namespaceContext.store,
            scopeContext.scope
          )
          return txRemove(
            scopeContext.transactionContext,
            'vector',
            vectorKey(scopeContext.transactionContext.namespaceContext, collection, hit.id)
          )
        }
      })
    }
  }
}
/** Compose the current native view's RecordQuery channel. */
function createMemoryScopeRecordQuery<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): IMemoryScope<T>[typeof recordQueries] {
  return <R>() =>
    createRecordQuery<R>(
      {
        asyncDisposeKey,
        cursorSource: scopeContext.scope,
        pushdown: { source: MemoryState.querySource, operations: [], operators: [] },
        execute: () => scopeContext.scope.iterateRecords(),
        mutate: (request, run) =>
          memoryScopeOperation(
            scopeContext,
            request.operation === 'delete'
              ? MemoryOperation.recordQueryDelete
              : MemoryOperation.recordQueryUpdate,
            request,
            (captured) => scopeContext.scope[queryDraft].record(captured, run),
            true
          )
      },
      scopeContext.transactionContext.namespaceContext.core.getChainMethods('query')
    )
}
/** Compose the current native view's Ttl channel. */
function createMemoryScopeTtl<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): IMemoryScope<T>[typeof ttlOperations] {
  return {
    expire: (target, ms) =>
      acceptedMemoryScopeOperation(
        scopeContext,
        MemoryOperation.ttlExpire,
        { target, ms },
        (input) => {
          /** Validation stays inside the one operation already admitted by tx.use(ttl). */
          const target = captureTtlTarget(
            scopeContext.transactionContext.namespaceContext,
            input.target
          )
          /** Preserve this pipeline-provided duration while the native operation settles. */
          const ms = input.ms
          assertStorageTtlDuration(ms, STORAGE_MEMORY_BACKEND)
          return txTtl(scopeContext.transactionContext, target, ms, false)
        },
        scopeContext.scope
      ),
    remaining: (target) =>
      acceptedMemoryScopeOperation(
        scopeContext,
        MemoryOperation.ttlRemaining,
        target,
        (input) =>
          txRemaining(
            scopeContext.transactionContext,
            captureTtlTarget(scopeContext.transactionContext.namespaceContext, input)
          ),
        scopeContext.scope
      ),
    persist: (target) =>
      acceptedMemoryScopeOperation(
        scopeContext,
        MemoryOperation.ttlPersist,
        target,
        (input) =>
          txTtl(
            scopeContext.transactionContext,
            captureTtlTarget(scopeContext.transactionContext.namespaceContext, input),
            undefined,
            true
          ),
        scopeContext.scope
      )
  }
}
/** Compose the current native view's Counter channel. */
function createMemoryScopeCounter<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): IMemoryScope<T>[typeof counterOperations] {
  return {
    increment: (key, by) =>
      acceptedMemoryScopeOperation(
        scopeContext,
        MemoryOperation.counterIncrement,
        { key, by },
        (input) => {
          /** Snapshot pipeline-provided identity before any native text access. */
          const key = input.key
          assertStringStorageKey(key, STORAGE_MEMORY_BACKEND)
          /** The pure contract calculation runs against this native text draft only. */
          const increment = snapshotStorageCounterIncrement(input.by, STORAGE_MEMORY_BACKEND)
          const result = increment(
            txRead(scopeContext.transactionContext, 'value', key) as string | undefined
          )
          txWrite(scopeContext.transactionContext, 'value', key, String(result), 'conflict')
          return result
        },
        scopeContext.scope
      )
  }
}
/** Compose the current native view's Rdf channel. */
function createMemoryScopeRdf<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): IMemoryScope<T>[typeof rdfOperations] {
  return {
    add: (quads) =>
      acceptedMemoryScopeOperation(
        scopeContext,
        MemoryOperation.rdfAdd,
        quads,
        (input) => txRdfWrite(scopeContext.transactionContext, input, false),
        scopeContext.scope
      ),
    delete: (quads) =>
      acceptedMemoryScopeOperation(
        scopeContext,
        MemoryOperation.rdfDelete,
        quads,
        (input) => txRdfWrite(scopeContext.transactionContext, input, true),
        scopeContext.scope
      ),
    match: (pattern) =>
      rdfQuery(scopeContext.transactionContext, pattern, scopeContext.scope, (request, run) =>
        memoryScopeOperation(
          scopeContext,
          request.operation === 'delete'
            ? MemoryOperation.rdfQueryDelete
            : MemoryOperation.rdfQueryReplace,
          request,
          (captured) => scopeContext.scope[queryDraft].rdf(captured, run),
          true
        )
      )
  }
}
/** Compose the current native view's RecordPrefix channel. */
function createMemoryScopeRecordPrefix<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): IMemoryScope<T>[typeof recordPrefix] {
  return (prefix) =>
    memoryScopeOperation(scopeContext, MemoryOperation.recordRemoveByPrefix, prefix, (current) => {
      /** Native record prefix deletion uses the same bounded draft merge as record iteration. */
      const captured = snapshotStorageKeyPrefix(current, STORAGE_MEMORY_BACKEND)
      let count = 0
      for (const row of txRows(scopeContext.transactionContext, 'record', {
        lower: captured.lower,
        upper: captured.upper,
        upperOpen: true
      }))
        if (txRemove(scopeContext.transactionContext, 'record', row.key)) count++
      return count
    })
}
/** Compose the current native view's text methods. */
function createMemoryScopeText<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): Pick<
  IMemoryScope<T>,
  'get' | 'set' | 'remove' | 'has' | 'getMany' | 'setMany' | 'removeMany' | 'removeByPrefix'
> {
  return {
    get: (key) =>
      memoryScopeOperation(scopeContext, MemoryOperation.get, key, (current) => {
        assertStringStorageKey(current, STORAGE_MEMORY_BACKEND)
        return (
          (txRead(scopeContext.transactionContext, 'value', current) as string | undefined) ?? null
        )
      }),
    set: (key, value, options) =>
      memoryScopeOperation(
        scopeContext,
        MemoryOperation.set,
        { key, value, options },
        (current) => {
          assertStringStorageKey(current.key, STORAGE_MEMORY_BACKEND)
          txWrite(
            scopeContext.transactionContext,
            'value',
            current.key,
            current.value,
            readTransactionConflictPolicy(current.options, STORAGE_MEMORY_BACKEND)
          )
        }
      ),
    remove: (key) =>
      memoryScopeOperation(scopeContext, MemoryOperation.remove, key, (current) => {
        assertStringStorageKey(current, STORAGE_MEMORY_BACKEND)
        txRemove(scopeContext.transactionContext, 'value', current)
      }),
    has: (key) =>
      memoryScopeOperation(scopeContext, MemoryOperation.has, key, (current) => {
        assertStringStorageKey(current, STORAGE_MEMORY_BACKEND)
        return txRead(scopeContext.transactionContext, 'value', current) !== undefined
      }),
    getMany: (keys) =>
      memoryScopeBatchOperation(scopeContext, MemoryOperation.getMany, keys, (current) =>
        readTextBatch(
          scopeContext.transactionContext.namespaceContext,
          current,
          (key) => txRead(scopeContext.transactionContext, 'value', key) as string | undefined
        )
      ),
    setMany: (entries) =>
      memoryScopeBatchOperation(scopeContext, MemoryOperation.setMany, entries, (current) =>
        scopeContext.transactionContext.textDraft.setMany(
          captureTextEntries(scopeContext.transactionContext.namespaceContext, current)
        )
      ),
    removeMany: (keys) =>
      memoryScopeBatchOperation(scopeContext, MemoryOperation.removeMany, keys, (current) => {
        /** Validate every key before applying the batch's first tombstone. */
        const captured = snapshotStorageBatchKeys(current, STORAGE_MEMORY_BACKEND)
          .filter(({ firstIndex }, index) => firstIndex === index)
          .map(({ key }) => key)
        return scopeContext.transactionContext.textDraft.removeMany(captured)
      }),
    removeByPrefix: (prefix) =>
      memoryScopeOperation(scopeContext, MemoryOperation.removeByPrefix, prefix, (current) =>
        observeBatch(
          scopeContext.transactionContext.namespaceContext,
          MemoryOperation.removeByPrefix,
          undefined,
          () => scopeContext.transactionContext.textDraft.removeByPrefix(current),
          scopeContext.scope
        )
      )
  }
}
/** Compose the current native view's bytes methods. */
function createMemoryScopeBytes<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): Pick<IMemoryScope<T>, 'getBytes' | 'setBytes' | 'removeBytes'> {
  return {
    getBytes: (key) =>
      memoryScopeOperation(scopeContext, MemoryOperation.getBytes, key, (current) => {
        assertStringStorageKey(current, STORAGE_MEMORY_BACKEND)
        return (
          (txRead(scopeContext.transactionContext, 'bytes', current) as Uint8Array | undefined) ??
          null
        )
      }),
    setBytes: (key, value, options) =>
      memoryScopeOperation(
        scopeContext,
        MemoryOperation.setBytes,
        { key, value, options },
        (current) => {
          assertStringStorageKey(current.key, STORAGE_MEMORY_BACKEND)
          txWrite(
            scopeContext.transactionContext,
            'bytes',
            current.key,
            current.value,
            readTransactionConflictPolicy(current.options, STORAGE_MEMORY_BACKEND)
          )
        }
      ),
    removeBytes: (key) =>
      memoryScopeOperation(scopeContext, MemoryOperation.removeBytes, key, (current) => {
        assertStringStorageKey(current, STORAGE_MEMORY_BACKEND)
        txRemove(scopeContext.transactionContext, 'bytes', current)
      })
  }
}
/** Compose the current native view's records methods. */
function createMemoryScopeRecords<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): Pick<IMemoryScope<T>, 'getRecord' | 'putRecord' | 'deleteRecord' | 'iterateRecords'> {
  return {
    getRecord: (key) =>
      memoryScopeOperation(
        scopeContext,
        MemoryOperation.getRecord,
        key,
        (current) => txRead(scopeContext.transactionContext, 'record', current) as T | undefined
      ),
    putRecord: (value, key, options) =>
      memoryScopeOperation(
        scopeContext,
        MemoryOperation.putRecord,
        { value, key, options },
        (current) => {
          /** Opaque generated record identities use the existing native entropy helper. */
          const resolved = current.key ?? createStorageToken()
          txWrite(
            scopeContext.transactionContext,
            'record',
            resolved,
            current.value,
            readTransactionConflictPolicy(current.options, STORAGE_MEMORY_BACKEND)
          )
          return resolved
        }
      ),
    deleteRecord: (key) =>
      memoryScopeOperation(scopeContext, MemoryOperation.deleteRecord, key, (current) => {
        txRemove(scopeContext.transactionContext, 'record', current)
      }),
    iterateRecords: (range) => {
      /** Bounds are captured at construction; native rows are snapshotted at first advance. */
      const captured = orderedRange(scopeContext.transactionContext.namespaceContext, range)
      /** The actual native iterator is registered once with the original transaction owner. */
      const iterator = (async function* () {
        /** Snapshot values together with membership on the first actual native advance. */
        const rows = txRows(scopeContext.transactionContext, 'record', captured).map(
          (row) =>
            [
              clone(scopeContext.transactionContext.namespaceContext, row.key),
              txRead(scopeContext.transactionContext, 'record', row.key) as T
            ] as [IStorageKey, T]
        )
        for (const [key, value] of rows) {
          scopeContext.transactionContext.namespaceContext.controller.assertLive()
          throwIfAborted(scopeContext.transactionContext.ctx.signal)
          yield [
            clone(scopeContext.transactionContext.namespaceContext, key),
            clone(scopeContext.transactionContext.namespaceContext, value)
          ] as [IStorageKey, T]
        }
      })()
      return scopeContext.transactionContext.namespaceContext.owner.registerIterator(
        scopeContext.scope,
        {
          next: (current) =>
            scopeContext.transactionContext.namespaceContext.core.execution.run(
              {
                operation: MemoryOperation.iterateRecords,
                input: undefined,
                scope: current,
                ctx: scopeContext.transactionContext.ctx
              },
              () => iterator.next()
            ),
          close: async () => {
            await iterator.return(undefined)
          }
        }
      )
    }
  }
}

/** Preview the original business draft, excluding only journal's own planned victim facts. */
function draftCapacityPlan<T, R>(transactionContext: IMemoryTransactionContext<T, R>) {
  return transactionContext.namespaceContext.capacity === undefined
    ? undefined
    : planCapacity(
        transactionContext.namespaceContext,
        [...transactionContext.draft.values()]
          .filter(
            (proposed) =>
              !transactionContext.journalVictims?.has(
                identity(transactionContext.namespaceContext, proposed.channel, proposed.encoded)
              )
          )
          .map((proposed) =>
            capacityFact(
              transactionContext.namespaceContext,
              proposed.channel,
              proposed.key,
              proposed.remove ||
                (proposed.deadline !== undefined &&
                  proposed.deadline <= transactionContext.namespaceContext.scheduler.now())
                ? undefined
                : (proposed.bytes ?? 0),
              proposed.rdfLock
            )
          )
      )
}

/** Records capability binding composes only the supplied original transaction's real methods. */
function bindRecords<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  scope: ITransactionScope
): ITransactionRecordsApi {
  return {
    query: (scope as IMemoryScope<unknown>)[recordQueries],
    removeByPrefix: (prefix) => (scope as IMemoryScope<unknown>)[recordPrefix](prefix)
  }
}

/** Retain the original native KV members before provider publication replaces the root has overload. */
function createMemoryNamespaceKeyValue<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['keyValue'] {
  return {
    get: namespaceContext.base.get,
    set: namespaceContext.base.set,
    remove: namespaceContext.base.remove,
    has: namespaceContext.base.has,
    keys: namespaceContext.base.keys,
    clearValues: namespaceContext.base.clearValues,
    clearAll: namespaceContext.base.clearAll,
    sync: namespaceContext.base.sync,
    getMany: async (keys, ctx) => {
      const count = batchSize(namespaceContext, keys)
      if (count === 0) return []
      return observeBatch(namespaceContext, MemoryOperation.getMany, count, () =>
        asyncEntry(namespaceContext, MemoryOperation.getMany, keys, ctx, (input) =>
          readTextBatch(
            namespaceContext,
            input,
            (key) => read(namespaceContext, 'value', key) as string | undefined
          )
        )
      )
    },
    setMany: async (entries, ctx) => {
      const count = batchSize(namespaceContext, entries)
      if (count === 0) return
      return observeBatch(namespaceContext, MemoryOperation.setMany, count, () =>
        atomicEntry(
          namespaceContext,
          MemoryOperation.setMany,
          () => entries,
          ctx,
          (input) => {
            /** Preparation precedes implicit lock derivation and the sole native transaction. */
            const captured = captureTextEntries(namespaceContext, input)
            return {
              keys: captured.map((entry) => lockKey.text(entry.key)),
              ranges: [],
              invoke: (_scope, draft) => draft.setMany(captured)
            }
          }
        )
      )
    },
    removeMany: async (keys, ctx) => {
      const count = batchSize(namespaceContext, keys)
      if (count === 0) return 0
      return observeBatch(namespaceContext, MemoryOperation.removeMany, count, () =>
        atomicEntry(
          namespaceContext,
          MemoryOperation.removeMany,
          () => keys,
          ctx,
          (input) => {
            /** Every structural identity detaches before native admission or any removal. */
            const captured = snapshotStorageBatchKeys(input, STORAGE_MEMORY_BACKEND)
              .filter(({ firstIndex }, index) => firstIndex === index)
              .map(({ key }) => key)
            return {
              keys: captured.map((key) => lockKey.text(key)),
              ranges: [],
              invoke: (_scope, draft) => draft.removeMany(captured)
            }
          }
        )
      )
    },
    removeByPrefix: (prefix, ctx) =>
      observeBatch(namespaceContext, MemoryOperation.removeByPrefix, undefined, () =>
        atomicEntry(
          namespaceContext,
          MemoryOperation.removeByPrefix,
          () => prefix,
          ctx,
          (input) => {
            /** The same prefix owner supplies native radix bounds and the original range lock probe. */
            const captured = snapshotStorageKeyPrefix(input, STORAGE_MEMORY_BACKEND)
            return {
              ranges: [
                {
                  channel: 'text',
                  ...snapshotConcurrencyLockRange(
                    { channel: 'text', prefix: captured.key },
                    STORAGE_MEMORY_BACKEND
                  )
                }
              ],
              invoke: (_scope, draft) => draft.removeByPrefix(captured.key)
            }
          }
        )
      )
  }
}

/** Capture canonical target identity and reject channels that this native unit does not implement. */
function captureTtlTarget<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  input: ITtlTarget
): IMemoryTtlTarget {
  /** The original lock owner validates and detaches the complete channel-specific identity. */
  const target = snapshotStorageTtlTarget(input, STORAGE_MEMORY_BACKEND)
  return target
}

/** Only text differs from the original physical channel spelling. */
function ttlChannel<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  target: IMemoryTtlTarget
): IMemoryChannel {
  return target.channel === 'text' ? 'value' : target.channel
}

/** Vector locks and deadlines identify the same independently tagged collection/point key. */
function ttlKey<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  target: IMemoryTtlTarget
): IStorageKey {
  return target.channel === 'vector' ? [target.collection, target.id] : target.key
}

/** One metadata mutation keeps the same physical value, revision and local notification owner. */
function changeDeadline<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  target: IMemoryTtlTarget,
  ms: number | undefined,
  persist: boolean
): boolean {
  /** Canonical target snapshot has already detached every mutable key segment. */
  const channel = ttlChannel(namespaceContext, target)
  const encoded = encodeFlatStorageKey(ttlKey(namespaceContext, target))
  const current = liveEntry(namespaceContext, channel, encoded)
  const id = identity(namespaceContext, channel, encoded)
  if (current === undefined || (persist && !namespaceContext.deadlines.has(id))) return false
  setDeadline(
    namespaceContext,
    channel,
    encoded,
    persist ? undefined : namespaceContext.scheduler.now() + ms!
  )
  if (ms === 0) liveEntry(namespaceContext, channel, encoded)
  else {
    bump(namespaceContext, channel, encoded)
    publish(namespaceContext, channel, 'put', [current.key])
  }
  return true
}

/** TTL reads and writes use the original root pipeline, implicit locks and operation budget. */
function createMemoryNamespaceTimeToLive<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['timeToLive'] {
  return {
    expire: (target, ms, ctx) =>
      mutationEntry(namespaceContext, MemoryOperation.ttlExpire, { target, ms }, ctx, (input) => {
        const target = captureTtlTarget(namespaceContext, input.target)
        /** The supplied duration remains fixed while the original policy waits for admission. */
        const ms = input.ms
        assertStorageTtlDuration(ms, STORAGE_MEMORY_BACKEND)
        return {
          keys: [target],
          invoke: (draft) => draft.ttl(target, ms, false),
          run: () => changeDeadline(namespaceContext, target, ms, false)
        }
      }),
    remaining: (target, ctx) =>
      asyncEntry(namespaceContext, MemoryOperation.ttlRemaining, target, ctx, (input) => {
        const target = captureTtlTarget(namespaceContext, input)
        const channel = ttlChannel(namespaceContext, target)
        const encoded = encodeFlatStorageKey(ttlKey(namespaceContext, target))
        if (liveEntry(namespaceContext, channel, encoded) === undefined) return undefined
        const deadline = namespaceContext.deadlines.get(
          identity(namespaceContext, channel, encoded)
        )
        return deadline === undefined
          ? undefined
          : Math.max(0, deadline - namespaceContext.scheduler.now())
      }),
    persist: (target, ctx) =>
      mutationEntry(namespaceContext, MemoryOperation.ttlPersist, target, ctx, (input) => {
        const target = captureTtlTarget(namespaceContext, input)
        return {
          keys: [target],
          invoke: (draft) => draft.ttl(target, undefined, true),
          run: () => changeDeadline(namespaceContext, target, undefined, true)
        }
      })
  }
}

/** A native counter read and write occupy the same original synchronous admitted mutation. */
function createMemoryNamespaceCounters<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['counters'] {
  return {
    increment: (key, by, ctx) =>
      mutationEntry(
        namespaceContext,
        MemoryOperation.counterIncrement,
        { key, by },
        ctx,
        (input) => {
          /** Capture a pipeline-provided identity before lock derivation and native work. */
          const key = input.key
          assertStringStorageKey(key, STORAGE_MEMORY_BACKEND)
          /** Decimal and overflow validation stays with the original contract helper. */
          const increment = snapshotStorageCounterIncrement(input.by, STORAGE_MEMORY_BACKEND)
          /**
           * The capacity preflight retains this attempt's exact native calculation for its final
           * turn.
           */
          let capacityResult: ReturnType<typeof increment> | undefined
          return {
            keys: [lockKey.text(key)],
            invoke: (draft) => draft.increment(key, increment),
            capacityChanges:
              namespaceContext.capacity === undefined
                ? undefined
                : () => {
                    const encoded = encodeFlatStorageKey(key)
                    const deadline = namespaceContext.deadlines.get(
                      identity(namespaceContext, 'value', encoded)
                    )
                    const current =
                      deadline !== undefined && deadline <= namespaceContext.scheduler.now()
                        ? undefined
                        : (namespaceContext.data.value.get(encoded)?.value as string | undefined)
                    capacityResult = increment(current)
                    return [
                      capacityFact(
                        namespaceContext,
                        'value',
                        key,
                        entryBytes(namespaceContext, 'value', String(capacityResult))
                      )
                    ]
                  },
            run: () => {
              /** This calculation and its write share one synchronous admitted native turn. */
              const result =
                capacityResult ??
                increment(read(namespaceContext, 'value', key) as string | undefined)
              write(namespaceContext, 'value', key, String(result))
              return result
            }
          }
        }
      )
  }
}

/** New native capability calls check the same controller before the original registration runner. */
function vectorOperation<T, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  invoke: () => Promise<R>
): Promise<R> {
  try {
    namespaceContext.controller.assertLive()
    return invoke()
  } catch (cause) {
    return Promise.reject(cause)
  }
}

/** Vector admission errors retain the shared contract identity and the actual native backend. */
function invalidVector(): never {
  throw new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend: STORAGE_MEMORY_BACKEND },
    StorageErrorText.memoryVectorArgument
  )
}

/** Canonical payload filter translation reuses the original query compiler and membership Set. */
function vectorCondition(filter: IVectorFilter): IQueryCondition {
  if ('all' in filter)
    return {
      kind: 'and',
      conditions: filter.all.map((filter: IVectorFilter) => vectorCondition(filter))
    }
  if ('any' in filter)
    return {
      kind: 'or',
      conditions: filter.any.map((filter: IVectorFilter) => vectorCondition(filter))
    }
  if ('not' in filter) return { kind: 'not', condition: vectorCondition(filter.not) }
  /** The canonical path owner retains field segments and rejects inherited access. */
  const path = parseObjectPath(filter.field).map(String)
  if ('eq' in filter) return { kind: 'field', path, operator: QueryOperator.eq, value: filter.eq }
  if ('in' in filter) return { kind: 'field', path, operator: QueryOperator.in, value: filter.in }
  /** Two range operands remain one conjunction rather than a second evaluator. */
  const conditions: IQueryCondition[] = []
  if (filter.gte !== undefined)
    conditions.push({ kind: 'field', path, operator: QueryOperator.gte, value: filter.gte })
  if (filter.lte !== undefined)
    conditions.push({ kind: 'field', path, operator: QueryOperator.lte, value: filter.lte })
  return { kind: 'and', conditions }
}

/** One canonical tuple identifies the same vector row, revision, deadline and lock point. */
function vectorKey<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  collection: string,
  id: string
): readonly [string, string] {
  return [collection, id]
}

/** Native IDs detach through the original key batch capture before any policy may wait. */
function vectorIds<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  ids: readonly string[]
): readonly string[] {
  /** The existing batch owner rejects malformed arrays without a second parser. */
  const facts = snapshotStorageBatchKeys(ids, STORAGE_MEMORY_BACKEND)
  /** Only first occurrences enter physical admission; repeated public IDs remain harmless. */
  const result: string[] = []
  for (const [index, fact] of facts.entries()) {
    assertStringStorageKey(fact.key, STORAGE_MEMORY_BACKEND)
    if (fact.firstIndex === index) result.push(fact.key)
  }
  return result
}

/** Physical deletion includes lazy-expired rows and changes the original revision once. */
function removeVector<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  collection: string,
  id: string
): boolean {
  /** Each prepared ID uses the original key encoding without a new point registry. */
  const encoded = encodeFlatStorageKey(vectorKey(namespaceContext, collection, id))
  /** The actual physical row determines whether this delete contributes to the result. */
  const current = namespaceContext.data.vector.get(encoded)
  if (current === undefined) return false
  deletePhysical(namespaceContext, 'vector', encoded)
  return true
}

/** A collection descriptor borrows namespace rows and keeps its validated query metadata. */
type IMemoryVectorContext<T> = {
  /** Namespace ports and physical rows remain owned by the original namespace. */ namespaceContext: IMemoryNamespaceContext<T>

  /** Optional configuration capture performs no lookup or native operation by itself. */
  captured: ReturnType<typeof snapshotStorageVectorCollection>

  /** Repeated descriptors resolve the same metadata, while incompatible declarations reject. */
  existing: IStorageVectorConfiguration | undefined

  /** New collections require real dimensions and never infer them from a later write. */
  configuration: IStorageVectorConfiguration

  /** Prefix bytes localize only this collection in the existing physical vector radix. */
  bounds: ReturnType<typeof snapshotStorageKeyPrefix>
}
/** Resolve collection metadata once without creating a second physical owner. */
function createMemoryVectorCollection<T, TPayload>(
  namespaceContext: IMemoryNamespaceContext<T>,
  name: string,
  options?: IStorageVectorConfiguration
): IVectorCollection<TPayload> {
  /** Initialization completes before the collection API publishes these facts. */
  const vectorContext = { namespaceContext } as IMemoryVectorContext<T>

  vectorContext.namespaceContext.controller.assertLive()

  /** Optional configuration capture performs no lookup or native operation by itself. */
  vectorContext.captured = snapshotStorageVectorCollection(name, options, STORAGE_MEMORY_BACKEND)

  /** Repeated descriptors resolve the same metadata, while incompatible declarations reject. */
  vectorContext.existing = vectorContext.namespaceContext.vectorCollections.get(
    vectorContext.captured.name
  )

  /** New collections require real dimensions and never infer them from a later write. */
  const configuration = vectorContext.existing ?? vectorContext.captured.options

  if (
    configuration === undefined ||
    (vectorContext.existing !== undefined &&
      vectorContext.captured.options !== undefined &&
      (vectorContext.existing.dimensions !== vectorContext.captured.options.dimensions ||
        vectorContext.existing.metric !== vectorContext.captured.options.metric))
  )
    invalidVector()

  vectorContext.configuration = configuration

  vectorContext.namespaceContext.vectorCollections.set(
    vectorContext.captured.name,
    vectorContext.configuration
  )

  /** Prefix bytes localize only this collection in the existing physical vector radix. */
  vectorContext.bounds = snapshotStorageKeyPrefix(
    [vectorContext.captured.name],
    STORAGE_MEMORY_BACKEND
  )
  return {
    near: (...args) => memoryVectorCollectionNear<T, TPayload>(vectorContext, ...args),
    similarTo: (...args) => memoryVectorCollectionSimilarTo<T, TPayload>(vectorContext, ...args),
    recommend: (...args) => memoryVectorCollectionRecommend<T, TPayload>(vectorContext, ...args),
    upsert: (...args) => memoryVectorCollectionUpsert<T, TPayload>(vectorContext, ...args),
    delete: (...args) => memoryVectorCollectionDelete<T, TPayload>(vectorContext, ...args),
    deleteWhere: (...args) =>
      memoryVectorCollectionDeleteWhere<T, TPayload>(vectorContext, ...args),
    search: (...args) => memoryVectorCollectionSearch<T, TPayload>(vectorContext, ...args)
  }
}

/** Stored point values are canonical snapshots and remain inaccessible to application code. */
function memoryVectorPoint<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  id: string
): IStorageVectorPoint<TPayload> | undefined {
  const encoded = encodeFlatStorageKey(
    vectorKey(vectorContext.namespaceContext, vectorContext.captured.name, id)
  )
  const entry = liveEntry(vectorContext.namespaceContext, 'vector', encoded)
  if (entry !== undefined)
    vectorContext.namespaceContext.capacityIndex?.touch(
      identity(vectorContext.namespaceContext, 'vector', encoded)
    )
  return entry?.value as IStorageVectorPoint<TPayload> | undefined
}

/** Search removes expired rows before filtering/scoring; physical deleteWhere retains them. */
function* memoryVectorPoints<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  physical = false
): IterableIterator<IStorageVectorPoint<TPayload>> {
  /** The original radix locates this collection without retaining all candidate references. */
  let leaf = vectorContext.namespaceContext.ordered.vector.lowerBound(vectorContext.bounds.lower)
  while (leaf !== undefined && compareRecordIndexKeys(leaf.key, vectorContext.bounds.upper) < 0) {
    /** Expiry or a caller delete can unlink this leaf before the generator resumes. */
    const next = leaf.next
    /** Physical deletion includes expired matches; ranking reclaims them before scoring. */
    const entry = physical
      ? leaf.value
      : liveEntry(vectorContext.namespaceContext, 'vector', encodeFlatStorageKey(leaf.value.key))
    if (entry !== undefined) {
      if (!physical)
        vectorContext.namespaceContext.capacityIndex?.touch(
          identity(vectorContext.namespaceContext, 'vector', encodeFlatStorageKey(entry.key))
        )
      yield entry.value as IStorageVectorPoint<TPayload>
    }
    leaf = next
  }
}

/** Output payloads/vectors detach only for selected native hits, preserving bounded work. */
function memoryVectorOutput<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  hit: ReturnType<typeof rankMemoryVectors<TPayload>>[number],
  withVector: boolean,
  withPayload: boolean
): IVectorHit<TPayload, boolean> {
  return {
    id: hit.point.id,
    score: hit.score,
    ...(withPayload && hit.point.payload !== undefined
      ? { payload: clone(vectorContext.namespaceContext, hit.point.payload) }
      : {}),
    ...(withVector ? { vector: [...hit.point.vector] } : {})
  }
}

/** A source keeps one immutable resolver; canonical query nodes still own every refinement. */
function memoryVectorQuery<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  resolve: (lookup: (id: string) => IStorageVectorPoint<TPayload> | undefined) => {
    query: readonly number[]
    exclude: ReadonlySet<string>
  },
  metric: IStorageVectorConfiguration['metric'],
  origin: IVectorQueryOrigin
) {
  /** Native ranking is shared verbatim by reads and this original transaction draft. */
  const select: IMemoryVectorSelection<TPayload> = (input, values, lookup) => {
    /** Samples resolve once inside the actual read or write attempt. */
    const selected = resolve(lookup)
    if (input.topK === 0) return []
    /** Canonical conditions retain the sole compiler and original membership Sets. */
    const predicates = input.conditions.map((condition) =>
      compileStorageQueryCondition<TPayload | undefined>(condition)
    )
    return rankMemoryVectors(
      values,
      selected.query,
      metric,
      input.topK,
      input.minScore,
      (point) =>
        !selected.exclude.has(point.id) && predicates.every((predicate) => predicate(point.payload))
    ).map((hit): readonly [IStorageKey, IVectorHit<TPayload, boolean>] => [
      hit.point.id,
      memoryVectorOutput<T, TPayload>(vectorContext, hit, input.withVector, true)
    ])
  }
  return createVectorQuery<TPayload>(
    {
      asyncDisposeKey,
      exact: true,
      origin,
      beginOperation: () => vectorContext.namespaceContext.controller.beginMutation(),
      watch: ({ ctx }) => watchChanges(vectorContext.namespaceContext, 'all', ctx),
      mutate: (request, run) =>
        atomicEntry(
          vectorContext.namespaceContext,
          MemoryOperation.vectorQueryDelete,
          () => ({ ...request }),
          { ...request.ctx, concurrency: request.concurrency },
          (input) => ({
            invoke: (scope) =>
              scope[queryDraft].vector(vectorContext.captured.name, input, run, select)
          })
        ),
      pushdown: {
        source: MemoryState.querySource,
        operations: [QueryOperation.where, QueryOperation.topK, QueryOperation.minScore],
        operators: Object.values(QueryOperator)
      },
      execute: (input) => {
        vectorContext.namespaceContext.controller.assertLive()
        return nativeIterator(
          vectorContext.namespaceContext,
          MemoryOperation.vectorSearch,
          input.ctx,
          () =>
            select(input, memoryVectorPoints<T, TPayload>(vectorContext), (id: string) =>
              memoryVectorPoint<T, TPayload>(vectorContext, id)
            ),
          (row) => row,
          () => vectorContext.namespaceContext.controller.assertLive()
        )
      }
    },
    vectorContext.namespaceContext.core.getChainMethods('vector')
  )
}
/** Execute the collection's original near against explicit collection facts. */
function memoryVectorCollectionNear<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  ...args: Parameters<IVectorCollection<TPayload>['near']>
): ReturnType<IVectorCollection<TPayload>['near']> {
  const [input, options] = args
  vectorContext.namespaceContext.controller.assertLive()
  return (() => {
    if (
      options !== undefined &&
      (typeof options !== 'object' || options === null || Array.isArray(options))
    )
      invalidVector()
    /** Optional request fields are read once before the immutable source captures them. */
    const inputMetric = options?.metric
    const metric = inputMetric === undefined ? vectorContext.configuration.metric : inputMetric
    /** Memory is exact for either request; malformed explicit options still reject. */
    const exact = options?.exact
    if (exact !== undefined && typeof exact !== 'boolean') invalidVector()
    /** The original component owner snapshots the query and the requested metric. */
    const components = snapshotStorageVector(
      input,
      { dimensions: vectorContext.configuration.dimensions, metric },
      STORAGE_MEMORY_BACKEND
    )
    return memoryVectorQuery<T, TPayload>(
      vectorContext,
      () => ({ query: components, exclude: new Set<string>() }),
      metric,
      {
        kind: VectorQueryOriginKind.near,
        vector: components
      }
    )
  })()
}
/** Execute the collection's original similarTo against explicit collection facts. */
function memoryVectorCollectionSimilarTo<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  ...args: Parameters<IVectorCollection<TPayload>['similarTo']>
): ReturnType<IVectorCollection<TPayload>['similarTo']> {
  const [id] = args
  vectorContext.namespaceContext.controller.assertLive()
  assertStringStorageKey(id, STORAGE_MEMORY_BACKEND)
  return memoryVectorQuery<T, TPayload>(
    vectorContext,
    (lookup) => {
      /** A missing/expired sample is rejected before native candidates are ranked. */
      const sample = lookup(id)
      if (sample === undefined) invalidVector()
      return {
        query: snapshotStorageVector(
          sample.vector,
          vectorContext.configuration,
          STORAGE_MEMORY_BACKEND
        ),
        exclude: new Set([id])
      }
    },
    vectorContext.configuration.metric,
    { kind: VectorQueryOriginKind.similarTo, id }
  )
}
/** Execute the collection's original recommend against explicit collection facts. */
function memoryVectorCollectionRecommend<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  ...args: Parameters<IVectorCollection<TPayload>['recommend']>
): ReturnType<IVectorCollection<TPayload>['recommend']> {
  const [input] = args
  vectorContext.namespaceContext.controller.assertLive()
  /** The original key batch owner detaches ID arrays before their asynchronous use. */
  const samples = (() => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) invalidVector()
    const { positive, negative } = input
    const positiveIds = vectorIds(vectorContext.namespaceContext, positive)
    const negativeIds = vectorIds(
      vectorContext.namespaceContext,
      negative === undefined ? [] : negative
    )
    if (positiveIds.length === 0) invalidVector()
    const exclude = new Set([...positiveIds, ...negativeIds])
    if (exclude.size !== positiveIds.length + negativeIds.length) invalidVector()
    return { positiveIds, negativeIds, exclude }
  })()
  return memoryVectorQuery<T, TPayload>(
    vectorContext,
    (lookup) => {
      /** Every requested sample resolves against this collection and immutable organization. */
      const load = (id: string): readonly number[] => {
        const sample = lookup(id)
        if (sample === undefined) invalidVector()
        return sample.vector
      }
      const positive = samples.positiveIds.map(load)
      const negative = samples.negativeIds.map(load)
      const combined = recommendStorageVector(
        positive as [readonly number[], ...(readonly number[])[]],
        negative
      )
      return {
        query: snapshotStorageVector(combined, vectorContext.configuration, STORAGE_MEMORY_BACKEND),
        exclude: samples.exclude
      }
    },
    vectorContext.configuration.metric,
    {
      kind: VectorQueryOriginKind.recommend,
      positive: samples.positiveIds,
      negative: samples.negativeIds
    }
  )
}
/** Execute the collection's original upsert against explicit collection facts. */
function memoryVectorCollectionUpsert<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  ...args: Parameters<IVectorCollection<TPayload>['upsert']>
): ReturnType<IVectorCollection<TPayload>['upsert']> {
  const [points, ctx] = args
  return vectorOperation(vectorContext.namespaceContext, () =>
    mutationEntry(
      vectorContext.namespaceContext,
      MemoryOperation.vectorUpsert,
      points,
      ctx,
      (input, context) => {
        /** Full-batch capture occurs before any original lock wait or physical mutation. */
        const prepared = snapshotStorageVectorUpsert(
          input,
          vectorContext.configuration,
          STORAGE_MEMORY_BACKEND
        )
        /** Complete canonical payload encoding also finishes before the first native put. */
        const sizes = prepared.map((point) =>
          entryBytes(vectorContext.namespaceContext, 'vector', point)
        )
        /** Extension fields came from the original concurrency snapshot, never a second raw read. */
        const ttlMs = Reflect.get(context, 'ttlMs') as number | undefined
        if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, STORAGE_MEMORY_BACKEND)
        return {
          keys: prepared.map((point) => lockKey.vector(vectorContext.captured.name, point.id)),
          invoke: (draft) =>
            draft.upsertVector(vectorContext.captured.name, prepared, sizes, ttlMs),
          capacityChanges:
            vectorContext.namespaceContext.capacity === undefined
              ? undefined
              : () =>
                  prepared.map((point, index) => {
                    const key = vectorKey(
                      vectorContext.namespaceContext,
                      vectorContext.captured.name,
                      point.id
                    )
                    const deadline =
                      ttlMs === undefined
                        ? vectorContext.namespaceContext.deadlines.get(
                            identity(
                              vectorContext.namespaceContext,
                              'vector',
                              encodeFlatStorageKey(key)
                            )
                          )
                        : vectorContext.namespaceContext.scheduler.now() + ttlMs
                    return capacityFact(
                      vectorContext.namespaceContext,
                      'vector',
                      key,
                      ttlMs !== undefined &&
                        deadline !== undefined &&
                        deadline <= vectorContext.namespaceContext.scheduler.now()
                        ? undefined
                        : sizes[index]
                    )
                  }),
          run: () => {
            /** One monotonic clock observation applies to this synchronous admitted batch. */
            const now = vectorContext.namespaceContext.scheduler.now()
            for (const [index, point] of prepared.entries()) {
              const key = vectorKey(
                vectorContext.namespaceContext,
                vectorContext.captured.name,
                point.id
              )
              const encoded = encodeFlatStorageKey(key)
              const current = liveEntry(vectorContext.namespaceContext, 'vector', encoded)
              const orderedKey =
                current?.ordered ?? encodeOrderedStorageKey(key, STORAGE_MEMORY_BACKEND)
              const deadline =
                ttlMs === undefined
                  ? vectorContext.namespaceContext.deadlines.get(
                      identity(vectorContext.namespaceContext, 'vector', encoded)
                    )
                  : now + ttlMs
              if (deadline !== undefined && deadline <= now) {
                removeVector(vectorContext.namespaceContext, vectorContext.captured.name, point.id)
                continue
              }
              const entry = { key, ordered: orderedKey, value: point, bytes: sizes[index] }
              vectorContext.namespaceContext.data.vector.set(encoded, entry)
              vectorContext.namespaceContext.ordered.vector.set(orderedKey, entry)
              setDeadline(vectorContext.namespaceContext, 'vector', encoded, deadline)
              vectorContext.namespaceContext.capacityIndex?.put({
                ...capacityFact(vectorContext.namespaceContext, 'vector', key),
                bytes: sizes[index]!
              })
              bump(vectorContext.namespaceContext, 'vector', encoded)
            }
            if (prepared.length > 0) publish(vectorContext.namespaceContext, 'vector', 'batch')
          }
        }
      }
    )
  )
}
/** Execute the collection's original delete against explicit collection facts. */
function memoryVectorCollectionDelete<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  ...args: Parameters<IVectorCollection<TPayload>['delete']>
): ReturnType<IVectorCollection<TPayload>['delete']> {
  const [ids, ctx] = args
  return vectorOperation(vectorContext.namespaceContext, () =>
    mutationEntry(
      vectorContext.namespaceContext,
      MemoryOperation.vectorDelete,
      ids,
      ctx,
      (input) => {
        const capturedIds = vectorIds(vectorContext.namespaceContext, input)
        return {
          keys: capturedIds.map((id) => lockKey.vector(vectorContext.captured.name, id)),
          invoke: (draft) => {
            for (const id of capturedIds)
              draft.remove(
                'vector',
                vectorKey(vectorContext.namespaceContext, vectorContext.captured.name, id)
              )
          },
          run: () => {
            let count = 0
            for (const id of capturedIds)
              if (removeVector(vectorContext.namespaceContext, vectorContext.captured.name, id))
                count++
            if (count > 0) publish(vectorContext.namespaceContext, 'vector', 'batch')
          }
        }
      }
    )
  )
}
/** Execute the collection's original deleteWhere against explicit collection facts. */
function memoryVectorCollectionDeleteWhere<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  ...args: Parameters<IVectorCollection<TPayload>['deleteWhere']>
): ReturnType<IVectorCollection<TPayload>['deleteWhere']> {
  const [where, ctx] = args
  return vectorOperation(vectorContext.namespaceContext, () =>
    mutationEntry(
      vectorContext.namespaceContext,
      MemoryOperation.vectorDeleteWhere,
      where,
      ctx,
      (input, context) => {
        const count = Reflect.get(context, 'count')
        if (
          count !== undefined &&
          count !== DeleteCountMode.precount &&
          count !== DeleteCountMode.scroll
        )
          invalidVector()
        const predicate = compileStorageWhere<TPayload | undefined>(input)
        return {
          keys: [],
          invoke: (draft) =>
            draft.deleteVector(vectorContext.captured.name, (point) =>
              predicate(point.payload as TPayload | undefined)
            ),
          ranges: [
            {
              channel: 'vector',
              ...snapshotConcurrencyLockRange({ channel: 'vector' }, STORAGE_MEMORY_BACKEND)
            }
          ],
          run: () => {
            let count = 0
            for (const point of memoryVectorPoints<T, TPayload>(vectorContext, true))
              if (
                predicate(point.payload) &&
                removeVector(vectorContext.namespaceContext, vectorContext.captured.name, point.id)
              )
                count++
            if (count > 0) publish(vectorContext.namespaceContext, 'vector', 'batch')
            return count
          }
        }
      }
    )
  )
}
/** Execute the collection's original search against explicit collection facts. */
function memoryVectorCollectionSearch<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  ...args: Parameters<IVectorCollection<TPayload>['search']>
): ReturnType<IVectorCollection<TPayload>['search']> {
  const [query, options, ctx] = args
  return vectorOperation(vectorContext.namespaceContext, () =>
    asyncEntry(
      vectorContext.namespaceContext,
      MemoryOperation.vectorSearch,
      { query, options },
      ctx,
      (input) => {
        vectorContext.namespaceContext.controller.assertLive()
        const request = snapshotStorageVectorSearch(
          input.query,
          input.options,
          vectorContext.configuration,
          STORAGE_MEMORY_BACKEND
        )
        if (request.options.k === 0) return []
        const filter =
          request.options.filter === undefined
            ? undefined
            : compileStorageQueryCondition<TPayload | undefined>(
                vectorCondition(request.options.filter)
              )
        return rankMemoryVectors(
          memoryVectorPoints<T, TPayload>(vectorContext),
          request.query,
          vectorContext.configuration.metric,
          request.options.k,
          undefined,
          (point) => filter === undefined || filter(point.payload)
        ).map((hit) =>
          memoryVectorOutput<T, TPayload>(vectorContext, hit, false, request.options.withPayload)
        )
      }
    )
  )
}
function createMemoryNamespaceVectors<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['vectors'] {
  return {
    collection: <TPayload>(
      name: string,
      options?: IStorageVectorConfiguration
    ): IVectorCollection<TPayload> => createMemoryVectorCollection(namespaceContext, name, options)
  }
}

/** Native RDF writes use the original mutation runner, canonical locks and final synchronous turn. */
function createMemoryNamespaceRdfApi<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['rdfApi'] {
  return {
    add: (quads, ctx) =>
      mutationEntry(namespaceContext, MemoryOperation.rdfAdd, quads, ctx, (input) => {
        /** Full canonical admission precedes root lock acquisition and the final physical turn. */
        const entries = captureRdfEntries(namespaceContext, input)
        return {
          keys: entries.map((entry) => entry.rdfLock),
          invoke: (draft) =>
            draft.rdf(
              entries.map((entry: IMemoryEntry) => logicalRdfQuad(namespaceContext, entry)),
              false
            ),
          capacityChanges:
            namespaceContext.capacity === undefined
              ? undefined
              : () =>
                  entries.map((entry) =>
                    capacityFact(namespaceContext, 'rdf', entry.key, entry.bytes, entry.rdfLock)
                  ),
          run: () => {
            /** Idempotent additions publish only when physical membership really changes. */
            let changed = false
            for (const entry of entries) {
              if (namespaceContext.data.rdf.has(entry.encoded)) {
                namespaceContext.capacityIndex?.touch(
                  identity(namespaceContext, 'rdf', entry.encoded)
                )
                continue
              }
              namespaceContext.data.rdf.set(entry.encoded, entry)
              namespaceContext.rdfIndex.set(entry.rdfKeys, entry)
              namespaceContext.capacityIndex?.put({
                ...capacityFact(namespaceContext, 'rdf', entry.key, undefined, entry.rdfLock),
                bytes: entry.bytes ?? 0
              })
              bump(namespaceContext, 'rdf', entry.encoded)
              changed = true
            }
            if (changed) publish(namespaceContext, 'rdf', 'batch')
          }
        }
      }),
    delete: (quads, ctx) =>
      mutationEntry(namespaceContext, MemoryOperation.rdfDelete, quads, ctx, (input) => {
        /** All supplied quads validate before an existing point can be removed. */
        const entries = captureRdfEntries(namespaceContext, input)
        return {
          keys: entries.map((entry) => entry.rdfLock),
          invoke: (draft) =>
            draft.rdf(
              entries.map((entry: IMemoryEntry) => logicalRdfQuad(namespaceContext, entry)),
              true
            ),
          run: () => {
            /** Repeated or absent deletions do not manufacture revisions or events. */
            let changed = false
            for (const entry of entries)
              if (deletePhysical(namespaceContext, 'rdf', entry.encoded) !== undefined)
                changed = true
            if (changed) publish(namespaceContext, 'rdf', 'batch')
          }
        }
      }),
    match: (pattern: Partial<IQuad>) => rootRdfQuery(namespaceContext, pattern)
  }
}

/** Native object failures reuse the existing memory serialization boundary and original cause. */
function blobFailure<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  cause: unknown,
  key?: string
) {
  return isStorageErrorFamily(cause)
    ? cause
    : new StorageError(StorageErrorCode.serializeFailed, {
        backend: STORAGE_MEMORY_BACKEND,
        key,
        cause
      })
}

/** Conditions inspect the current native generation both before reading and in the final turn. */
function assertBlobCondition<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  input: ReturnType<typeof snapshotStorageBlobPut>
): void {
  /** The current opaque generation is observed without taking reader ownership. */
  const current = namespaceContext.blobs.get(input.key)
  if (
    (input.options.ifMatch !== undefined && current?.value.info.etag !== input.options.ifMatch) ||
    (input.options.ifNoneMatch === true && current !== undefined)
  )
    throw new StorageContractError(StorageContractErrorCode.writeConflict, {
      backend: STORAGE_MEMORY_BACKEND
    })
}

/** Only the native sink buffers the complete object; reader lifecycle stays in the contract owner. */
async function loadBlobBody<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  input: ReturnType<typeof snapshotStorageBlobPut>,
  signal: IOperationContext['signal']
): Promise<Uint8Array> {
  if (isUint8Array(input.body)) return input.body
  /** Upload consumption and cancellation reuse the sole shared body-reader resource owner. */
  const reader = createStorageBlobBodyReader(input.body, {
    report: namespaceContext.report,
    backend: STORAGE_MEMORY_BACKEND,
    normalizeFailure: (cause) => blobFailure(namespaceContext, cause, input.key)
  })
  /** Only memory's native sink buffers complete content; server sinks keep their own backpressure. */
  const chunks: Uint8Array[] = []
  /** Byte accounting belongs to the completed native body rather than metadata or indexes. */
  let size = 0
  /** A primary read/abort/close failure must remain reachable if cleanup also fails. */
  let failed = false
  /** Cleanup failure becomes primary only when the body itself completed successfully. */
  let cleanupFailed = false
  /** Undefined rejection is still preserved when the shared cleanup rejects with it. */
  let cleanupFailure: unknown
  /** A fully collected body remains private until cleanup and the final CAS both succeed. */
  let body!: Uint8Array
  /** Context and host closure each release their original signal listener during settlement. */
  let stopContext: () => void = () => undefined
  /** Root closure wakes an unfinished read before the original mutation lease drains it. */
  let stopClosing: () => void = () => undefined
  /** The original dispose below consumes cancellation errors after the blocked read wakes. */
  const cancel = (target: IOperationContext['signal']) => {
    void reader.return!(readAbortReason(target)).catch(() => undefined)
  }
  try {
    stopContext = subscribeToAbort(signal, () => cancel(signal), namespaceContext.report)
    stopClosing = subscribeToAbort(
      namespaceContext.controller.closingSignal,
      () => cancel(namespaceContext.controller.closingSignal),
      namespaceContext.report
    )
    for (;;) {
      throwIfAborted(signal)
      namespaceContext.controller.assertLive()
      /** The original reader returns a detached byte chunk or its stable EOF result. */
      const next = await reader.next()
      throwIfAborted(signal)
      namespaceContext.controller.assertLive()
      if (next.done) break
      chunks.push(next.value)
      size += next.value.byteLength
    }
    body = new Uint8Array(size)
    /** A single final allocation owns the bytes installed by the synchronous native commit. */
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
  } catch (cause) {
    failed = true
    throwIfAborted(signal)
    namespaceContext.controller.assertLive()
    throw cause
  } finally {
    stopContext()
    stopClosing()
    try {
      await reader.dispose()
    } catch (cause) {
      if (failed) reportCleanupError(namespaceContext.report, cause)
      else {
        cleanupFailed = true
        cleanupFailure = cause
      }
    }
  }
  if (cleanupFailed) throw cleanupFailure
  return body
}

/** Opaque objects use the same original operation runner and physical capacity commit. */
function createMemoryNamespaceObjects<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['objects'] {
  return {
    put: (...args) => memoryBlobPut(namespaceContext, ...args),
    get: (...args) => memoryBlobGet(namespaceContext, ...args),
    head: (key, ctx) =>
      asyncEntry(namespaceContext, MemoryOperation.blobHead, key, ctx, (captured) => {
        namespaceContext.controller.assertLive()
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        const entry = namespaceContext.blobs.get(captured)
        if (entry !== undefined)
          namespaceContext.capacityIndex?.touch(identity(namespaceContext, 'blob', entry.encoded))
        return entry?.value.info
      }),
    remove: (key, ctx) =>
      mutationEntry(namespaceContext, MemoryOperation.blobRemove, key, ctx, (captured) => {
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return {
          keys: [],
          run: () => {
            const entry = deletePhysical(
              namespaceContext,
              'blob',
              namespaceContext.blobs.encodedOf(captured)
            )
            if (entry !== undefined) publish(namespaceContext, 'blob', 'remove')
            return entry !== undefined
          }
        }
      }),
    async list(options, ctx) {
      const request = snapshotStorageBlobList(options, ctx, STORAGE_MEMORY_BACKEND)
      return asyncEntry(
        namespaceContext,
        MemoryOperation.blobList,
        { ...request },
        request.ctx,
        (captured) => {
          namespaceContext.controller.assertLive()
          const input = snapshotStorageBlobList(captured, request.ctx, STORAGE_MEMORY_BACKEND)
          const result = namespaceContext.blobs.list(input.prefix, input.after, input.limit)
          for (const info of result.items)
            namespaceContext.capacityIndex?.touch(
              identity(namespaceContext, 'blob', namespaceContext.blobs.encodedOf(info.key))
            )
          return result
        }
      )
    },
    removeByPrefix: (prefix, ctx) =>
      mutationEntry(
        namespaceContext,
        MemoryOperation.blobRemoveByPrefix,
        prefix,
        ctx,
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return {
            keys: [],
            run: () => {
              let count = 0
              for (const entry of namespaceContext.blobs.rows(captured))
                if (deletePhysical(namespaceContext, 'blob', entry.encoded) !== undefined) count++
              if (count > 0) publish(namespaceContext, 'blob', 'batch')
              return count
            }
          }
        }
      )
  }
}

/** Publish the real built-in APIs on the original resource, never a copied base. */
function createMemoryNamespaceStore<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['store'] {
  return provideCapabilities(
    namespaceContext.base,
    [
      implement(kv, namespaceContext.keyValue, { forTransaction: (scope) => scope }),
      implement(ttl, namespaceContext.timeToLive, {
        forTransaction: (scope) => (scope as IMemoryScope<T>)[ttlOperations]
      }),
      implement(vector, namespaceContext.vectors),
      implement(blob, namespaceContext.objects),
      implement(rdf, namespaceContext.rdfApi, {
        forTransaction: (scope) => (scope as IMemoryScope<T>)[rdfOperations]
      }),
      implement(counter, namespaceContext.counters, {
        forTransaction: (scope) => (scope as IMemoryScope<T>)[counterOperations]
      }),
      implement(
        records,
        {
          query: <R = T>() =>
            createRecordQuery<R>(
              {
                asyncDisposeKey,
                watch: ({ ctx }) => watchChanges(namespaceContext, 'record', ctx),
                mutate: (request, run) =>
                  atomicEntry(
                    namespaceContext,
                    request.operation === 'delete'
                      ? MemoryOperation.recordQueryDelete
                      : MemoryOperation.recordQueryUpdate,
                    () => ({ ...request }),
                    { ...request.ctx, concurrency: request.concurrency },
                    (input) => ({ invoke: (scope) => scope[queryDraft].record(input, run) })
                  ),
                pushdown: { source: MemoryState.querySource, operations: [], operators: [] },
                execute: ({ ctx }) => namespaceContext.base.iterateRecords(undefined, ctx)
              },
              namespaceContext.core.getChainMethods('query')
            ),
          removeByPrefix: (prefix, ctx?: IOperationContext & IWriteConcurrencyOptions) =>
            mutationEntry(
              namespaceContext,
              MemoryOperation.recordRemoveByPrefix,
              prefix,
              ctx,
              (input) => {
                /** Native membership is localized by the same canonical prefix bounds as queries. */
                const captured = snapshotStorageKeyPrefix(input, STORAGE_MEMORY_BACKEND)
                return {
                  keys: [],
                  invoke: (draft) => draft.removeByPrefix(captured.key, 'record'),
                  ranges: [
                    {
                      channel: 'record',
                      ...snapshotConcurrencyLockRange(
                        { channel: 'record', prefix: captured.key },
                        STORAGE_MEMORY_BACKEND
                      )
                    }
                  ],
                  run: () => {
                    namespaceContext.controller.assertLive()
                    /** Capture only matching native leaves before unlinking their adjacency links. */
                    const rows = [
                      ...namespaceContext.ordered.record.range({
                        lower: captured.lower,
                        upper: captured.upper,
                        upperOpen: true
                      })
                    ]
                      .map((leaf) =>
                        liveEntry(namespaceContext, 'record', encodeFlatStorageKey(leaf.value.key))
                      )
                      .filter((entry): entry is IMemoryEntry => entry !== undefined)
                    for (const row of rows) {
                      /** Every selected live row shares the original hash/radix/revision identity. */
                      const encoded = encodeFlatStorageKey(row.key)
                      deletePhysical(namespaceContext, 'record', encoded)
                    }
                    if (rows.length > 0)
                      publish(
                        namespaceContext,
                        'record',
                        'batch',
                        rows.map((row) => row.key)
                      )
                    return rows.length
                  }
                }
              }
            )
        },
        { forTransaction: (scope: ITransactionScope) => bindRecords(namespaceContext, scope) }
      )
    ],
    {
      onInstaller: (value) => {
        namespaceContext.installer = value
      }
    }
  )
}

/** Only this original registration can forward image operations to an authenticated native scope. */
function createMemoryNamespaceJournalImages<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['journalImages'] {
  return {
    changes: (scope: Omit<ITransactionScope, 'use'>) => {
      assertTransactionOwner(namespaceContext.store, scope)
      return (scope as IMemoryScope<T>)[journalOperations].changes()
    },
    readImage: (scope: Omit<ITransactionScope, 'use'>, target: IStorageJournalTarget) => {
      assertTransactionOwner(namespaceContext.store, scope)
      return (scope as IMemoryScope<T>)[journalOperations].readImage(target)
    },
    writeImage: (
      scope: Omit<ITransactionScope, 'use'>,
      target: IStorageJournalTarget,
      image: IStorageJournalImage
    ) => {
      assertTransactionOwner(namespaceContext.store, scope)
      return (scope as IMemoryScope<T>)[journalOperations].writeImage(target, image)
    },
    readRevision: (scope: Omit<ITransactionScope, 'use'>, target: IStorageJournalTarget) => {
      assertTransactionOwner(namespaceContext.store, scope)
      return (scope as IMemoryScope<T>)[journalOperations].readRevision(target)
    }
  }
}

/** Precise native store shape is retained by the first-party plugin factory. */
export type IMemoryBackendStore<T = unknown> = Omit<
  ReturnType<typeof createMemoryBackend<T>>['store'],
  'undo'
>

/** Initialize one native attempt before any business or journal work is admitted. */
function createMemoryTransactionContext<T, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  run: (scope: IMemoryScope<T>, draft: IMemoryTextDraft) => R,
  ctx: IConcurrencyAttemptContext,
  protectedRanges?: IMemoryRootMutation<unknown>['ranges'],
  setCapacityIdentities?: (identities: readonly string[]) => void,
  journaled = true,
  observeKeys?: (keys: readonly ILockKey[]) => void
): IMemoryTransactionContext<T, R> {
  /** Initialize attempt-local facts before publishing its original native scope. */
  const transactionContext = {
    namespaceContext,
    run,
    ctx,
    protectedRanges,
    setCapacityIdentities,
    journaled,
    observeKeys
  } as IMemoryTransactionContext<T, R>

  transactionContext.namespaceContext.controller.assertLive()

  throwIfAborted(transactionContext.ctx.signal)

  transactionContext.setCapacityIdentities?.([])
  transactionContext.draft = new Map<string, IMemoryDraft>()
  transactionContext.clearAllRequested = false
  transactionContext.clearChanged = false
  transactionContext.draftOrdered = {
    value: createOrderedRecordIndex<IMemoryDraft>(),
    bytes: createOrderedRecordIndex<IMemoryDraft>(),
    record: createOrderedRecordIndex<IMemoryDraft>(),
    vector: createOrderedRecordIndex<IMemoryDraft>(),
    rdf: createOrderedRecordIndex<IMemoryDraft>()
  }
  transactionContext.draftRdfIndex = createMemoryRdfIndex(transactionContext.draftOrdered.rdf)
  transactionContext.snapshots = new Map<string, IMemorySnapshot | undefined>()
  transactionContext.expected = new Map<
    string,
    { channel: IMemoryChannel; encoded: string; key: IStorageKey; revision: number }
  >()
  transactionContext.snapshotEpochs = new Map<IMemoryChannel, number>()
  transactionContext.textDraft = createMemoryTransactionTextDraft(transactionContext)
  transactionContext.scope = createScope(transactionContext)
  transactionContext.control = transactionContext.namespaceContext.owner.register(
    transactionContext.scope,
    {
      context: transactionContext.ctx,
      createScope: () => createScope(transactionContext),
      onFailure: (error) => {
        transactionContext.failure ??= error
      },
      beforeCommit: (current) => {
        transactionContext.namespaceContext.controller.assertLive()
        throwIfAborted(transactionContext.ctx.signal)
        void transactionContext.namespaceContext.core.stageBindings
          .transactionStages(transactionContext.namespaceContext.store)
          .forTransaction(current)
          .beforeCommit?.()
        if (transactionContext.journalAttempt === undefined) return
        transactionContext.journalCapacity = draftCapacityPlan(transactionContext)
        for (const victim of transactionContext.journalCapacity?.victims ?? []) {
          /** Blob has no shared transaction target; never fabricate a logical blob lock/image. */
          if (victim.channel === 'blob')
            throw new StorageContractError(StorageContractErrorCode.unsupported)
          const channel = victim.channel as IMemoryChannel
          const current = txSnapshot(transactionContext, channel, victim.encoded, victim.key)
          if (current === undefined) continue
          ;(transactionContext.journalVictims ??= new Set()).add(victim.id)
          stageDraft(transactionContext, {
            ...current,
            channel,
            encoded: victim.encoded,
            remove: true
          })
        }
        return transactionContext.journalAttempt.record(current)
      }
    }
  )
  transactionContext.stage = transactionContext.namespaceContext.core.stageBindings
    .transactionStages(transactionContext.namespaceContext.store)
    .forTransaction(transactionContext.scope)

  return transactionContext
}
/** Detect existing range, journal, key and epoch conflicts before native commit admission. */
function memoryTransactionConflict<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>
): IConcurrencyAttempt<never> | undefined {
  if (transactionContext.protectedRanges !== undefined) {
    /** Batch commits cannot bypass a holder admitted while this original draft was preparing. */
    const held = transactionContext.namespaceContext.locks.probe(
      readConcurrencyLockIdentities(transactionContext.ctx),
      transactionContext.protectedRanges,
      transactionContext.ctx
    )
    if (held !== undefined) {
      void transactionContext.stage.afterRollback?.(StorageContractErrorCode.lockRejected)
      return { status: 'conflict', phase: 'acquire', keys: [held.key], holder: held.holder }
    }
  }
  /** Expiry after an observed read changes the same original revision before commit checks. */
  for (const entry of transactionContext.expected.values())
    liveEntry(transactionContext.namespaceContext, entry.channel, entry.encoded)
  /** The same original retry owner handles concurrent private-head changes and drop/reopen. */
  const journalConflict = transactionContext.journalDraft?.conflict()
  if (journalConflict !== undefined) {
    void transactionContext.stage.afterRollback?.(StorageContractErrorCode.writeConflict)
    return { status: 'conflict', phase: 'commit', keys: [], holder: undefined }
  }
  /** Conflict identities are collected before the synchronous all-channel draft merge. */
  const conflicts = [...transactionContext.expected.values()].filter(
    (entry) =>
      revision(transactionContext.namespaceContext, entry.channel, entry.encoded) !==
        entry.revision ||
      transactionContext.namespaceContext.revisions.epoch(
        entry.channel === 'value' ? 'text' : entry.channel
      ) !== transactionContext.snapshotEpochs.get(entry.channel)
  )
  if (
    conflicts.length !== 0 ||
    [...transactionContext.snapshotEpochs].some(
      ([channel, epoch]) =>
        transactionContext.namespaceContext.revisions.epoch(
          channel === 'value' ? 'text' : channel
        ) !== epoch
    )
  ) {
    void transactionContext.stage.afterRollback?.(StorageContractErrorCode.writeConflict)
    return {
      status: 'conflict',
      phase: 'commit',
      keys: conflicts.map((entry) =>
        entry.channel === 'value'
          ? lockKey.text(entry.key)
          : entry.channel === 'bytes'
            ? lockKey.bytes(entry.key as string)
            : entry.channel === 'vector'
              ? lockKey.vector(
                  (entry.key as readonly [string, string])[0],
                  (entry.key as readonly [string, string])[1]
                )
              : entry.channel === 'rdf'
                ? (transactionContext.draft.get(
                    identity(transactionContext.namespaceContext, 'rdf', entry.encoded)
                  ) ??
                    transactionContext.snapshots.get(
                      identity(transactionContext.namespaceContext, 'rdf', entry.encoded)
                    ))!.rdfLock!
                : lockKey.record(entry.key)
      ),
      holder: undefined,
      cause: new Error(
        conflicts[0] &&
          revision(
            transactionContext.namespaceContext,
            conflicts[0].channel,
            conflicts[0].encoded
          ) !== conflicts[0].revision
          ? StorageErrorText.memoryRevisionChanged(
              conflicts[0].revision,
              revision(
                transactionContext.namespaceContext,
                conflicts[0].channel,
                conflicts[0].encoded
              )
            )
          : StorageErrorText.memoryEpochChanged
      )
    }
  }
  return undefined
}
/** Check the finalized capacity proposal against the existing journal and lock owners. */
function memoryTransactionCapacityConflict<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  capacityPlan: ReturnType<typeof draftCapacityPlan<T, R>>
): IConcurrencyAttempt<never> | undefined {
  if (
    transactionContext.journalAttempt !== undefined &&
    (capacityPlan?.expired.length !== transactionContext.journalCapacity?.expired.length ||
      capacityPlan?.victims.length !== transactionContext.journalCapacity?.victims.length ||
      capacityPlan?.expired.some(
        (entry, index) => entry.id !== transactionContext.journalCapacity!.expired[index]!.id
      ) ||
      capacityPlan?.victims.some(
        (entry, index) => entry.id !== transactionContext.journalCapacity!.victims[index]!.id
      ))
  ) {
    void transactionContext.stage.afterRollback?.(StorageContractErrorCode.writeConflict)
    return { status: 'conflict', phase: 'commit', keys: [], holder: undefined }
  }
  transactionContext.setCapacityIdentities?.(capacityPlan?.identities ?? [])
  const capacityHeld =
    capacityPlan === undefined
      ? undefined
      : transactionContext.namespaceContext.locks.probe(
          capacityPlan.identities,
          undefined,
          transactionContext.ctx
        )
  if (capacityHeld !== undefined) {
    void transactionContext.stage.afterRollback?.(StorageContractErrorCode.lockRejected)
    return {
      status: 'conflict',
      phase: 'acquire',
      keys: [capacityHeld.key],
      holder: capacityHeld.holder
    }
  }
  return undefined
}
/** Apply every draft row during the original synchronous capacity commit turn. */
function applyMemoryTransactionDraft<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  capacityPlan: ReturnType<typeof draftCapacityPlan<T, R>>,
  changed: Record<IMemoryChannel, IStorageKey[]>
): void {
  /** Clear's physical maps, revisions and accounting remain owned by their original turn. */
  if (transactionContext.clearedChannels !== undefined) {
    if (transactionContext.clearAllRequested) clearAll(transactionContext.namespaceContext, false)
    else
      clear(
        transactionContext.namespaceContext,
        transactionContext.clearedChannels[0] as IStorageChannel,
        false
      )
  }
  for (const proposed of transactionContext.draft.values()) {
    if (transactionContext.clearedChannels?.includes(proposed.channel)) {
      changed[proposed.channel].push(proposed.key)
      continue
    }
    /** Policy eviction remains owned by commitCapacity, including revision and onEvict. */
    if (
      transactionContext.journalVictims?.has(
        identity(transactionContext.namespaceContext, proposed.channel, proposed.encoded)
      )
    )
      continue
    /** Existing draft identities retain their already captured logical key. */
    const encoded = proposed.encoded
    /** New deadlines that elapsed within this draft commit as immediate absence. */
    if (
      proposed.remove ||
      (proposed.deadline !== undefined &&
        proposed.deadline <= transactionContext.namespaceContext.scheduler.now())
    ) {
      setDeadline(transactionContext.namespaceContext, proposed.channel, encoded, undefined)
      transactionContext.namespaceContext.capacityIndex?.remove(
        identity(transactionContext.namespaceContext, proposed.channel, encoded)
      )
      if (!transactionContext.namespaceContext.data[proposed.channel].delete(encoded)) continue
      if (proposed.channel === 'rdf')
        transactionContext.namespaceContext.rdfIndex.delete(proposed.rdfKeys!)
      else transactionContext.namespaceContext.ordered[proposed.channel].delete(proposed.ordered)
    } else {
      /**
       * An overwrite retains its original live ordered encoding instead of keeping duplicate key
       * bytes.
       */
      const keyBytes =
        transactionContext.namespaceContext.ordered[proposed.channel].get(proposed.ordered)?.key ??
        proposed.ordered
      const entry = {
        key: proposed.key,
        value: proposed.value,
        ordered: keyBytes,
        bytes: proposed.bytes,
        rdfKeys: proposed.rdfKeys,
        rdfLock: proposed.rdfLock
      }
      transactionContext.namespaceContext.data[proposed.channel].set(encoded, entry)
      if (proposed.channel === 'rdf')
        transactionContext.namespaceContext.rdfIndex.set(proposed.rdfKeys!, entry)
      else transactionContext.namespaceContext.ordered[proposed.channel].set(keyBytes, entry)
      setDeadline(transactionContext.namespaceContext, proposed.channel, encoded, proposed.deadline)
      transactionContext.namespaceContext.capacityIndex?.put({
        ...capacityFact(
          transactionContext.namespaceContext,
          proposed.channel,
          proposed.key,
          undefined,
          proposed.rdfLock
        ),
        bytes: proposed.bytes ?? 0
      })
    }
    bump(transactionContext.namespaceContext, proposed.channel, encoded)
    changed[proposed.channel].push(proposed.key)
  }
  /** The original capacity buffer preserves batch-before-victim notification order. */
  if (capacityPlan !== undefined)
    for (const channel of transactionContext.namespaceContext.physicalChannels)
      if (!transactionContext.clearedChannels?.includes(channel) && changed[channel].length !== 0)
        publish(transactionContext.namespaceContext, channel, 'batch', changed[channel])
}
/** Publish journal completion and channel notifications after physical commit. */
function completeMemoryTransactionDraft<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  capacityPlan: ReturnType<typeof draftCapacityPlan<T, R>>,
  changed: Record<IMemoryChannel, IStorageKey[]>
): void {
  /** Actual data and capacity victims are final before private indexes become visible. */
  transactionContext.journalDraft?.commit()
  transactionContext.journalDraft?.complete(true)
  if (transactionContext.clearChanged) {
    if (transactionContext.clearAllRequested)
      transactionContext.namespaceContext.controller.publish({
        channel: 'all',
        kind: 'clear',
        orgId: transactionContext.namespaceContext.orgId
      })
    else
      publish(transactionContext.namespaceContext, transactionContext.clearedChannels![0]!, 'clear')
  }
  if (capacityPlan === undefined)
    for (const channel of transactionContext.namespaceContext.physicalChannels)
      if (!transactionContext.clearedChannels?.includes(channel) && changed[channel].length !== 0)
        publish(transactionContext.namespaceContext, channel, 'batch', changed[channel])
}
/** Commit channels and report the original count without admitting another operation. */
function commitMemoryTransaction<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  capacityPlan: ReturnType<typeof draftCapacityPlan<T, R>>
): void {
  const changed = {
    value: [] as IStorageKey[],
    bytes: [] as IStorageKey[],
    record: [] as IStorageKey[],
    vector: [] as IStorageKey[],
    rdf: [] as IStorageKey[]
  }
  commitCapacity(
    transactionContext.namespaceContext,
    capacityPlan,
    () => applyMemoryTransactionDraft(transactionContext, capacityPlan, changed),
    () => completeMemoryTransactionDraft(transactionContext, capacityPlan, changed)
  )
  void transactionContext.stage.afterCommit?.(
    transactionContext.namespaceContext.physicalChannels.reduce(
      (count, channel) => count + changed[channel].length,
      0
    ) +
      (capacityPlan?.expired.length ?? 0) +
      (capacityPlan?.victims.length ?? 0)
  )
}

/** Construct synchronous native access without entering asynchronous concurrency. */
function createMemoryNamespaceSync<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['base']['sync'] {
  return {
    get: (key) =>
      namespaceContext.core.execution.runSync(
        { operation: MemoryOperation.get, input: key },
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return (read(namespaceContext, 'value', captured) as string | undefined) ?? null
        }
      ),
    set: (key, value, options) =>
      namespaceContext.core.execution.runSync(
        { operation: MemoryOperation.set, input: { key, value, options } },
        (captured) => {
          assertStringStorageKey(captured.key, STORAGE_MEMORY_BACKEND)
          /** Sync policy capture never calls the asynchronous concurrency callback. */
          const options = snapshotSyncWriteOptions(captured.options)
          /** Payload preparation precedes the final active-key probe. */
          const mutation = prepareWrite(
            namespaceContext,
            'value',
            captured.key,
            captured.value,
            options.conflictPolicy
          )
          assertUnlocked(namespaceContext, mutation.keys)
          /**
           * Synchronous writes share exact victim planning but reject a busy victim without
           * waiting.
           */
          const plan =
            mutation.capacityChanges === undefined
              ? undefined
              : planCapacity(namespaceContext, mutation.capacityChanges())
          const held =
            plan === undefined ? undefined : namespaceContext.locks.probe(plan.identities)
          if (held !== undefined)
            throw new StorageContractError(StorageContractErrorCode.lockRejected, {
              backend: STORAGE_MEMORY_BACKEND,
              keys: [held.key],
              holder: held.holder
            })
          commitCapacity(namespaceContext, plan, mutation.run)
        }
      ),
    remove: (key) =>
      namespaceContext.core.execution.runSync(
        { operation: MemoryOperation.remove, input: key },
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          assertUnlocked(namespaceContext, [lockKey.text(captured)])
          remove(namespaceContext, 'value', captured)
        }
      ),
    has: (key) =>
      namespaceContext.core.execution.runSync(
        { operation: MemoryOperation.has, input: key },
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return read(namespaceContext, 'value', captured) !== undefined
        }
      ),
    keys: () =>
      namespaceContext.core.execution.runSync(
        { operation: MemoryOperation.keys, input: undefined },
        () => {
          namespaceContext.controller.assertLive()
          return [...namespaceContext.data.value.entries()]
            .filter(([encoded]) => liveEntry(namespaceContext, 'value', encoded) !== undefined)
            .map(([, entry]) => entry.key)
            .filter((key): key is string => typeof key === 'string')
        }
      ),
    clearValues: () =>
      namespaceContext.core.execution.runSync(
        { operation: MemoryOperation.clearValues, input: undefined },
        () => {
          namespaceContext.controller.assertLive()
          assertUnlocked(namespaceContext, [], mutationRanges(namespaceContext, ['value']))
          clear(namespaceContext, 'value')
        }
      )
  }
}
/** Compose the namespace's original text operations. */
function createMemoryNamespaceBaseText<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): Pick<
  IMemoryNamespaceContext<T>['base'],
  'get' | 'set' | 'remove' | 'has' | 'keys' | 'clearValues' | 'clearAll'
> {
  return {
    get: (key, ctx) =>
      asyncEntry(
        namespaceContext,
        MemoryOperation.get,
        key,
        ctx,
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return (read(namespaceContext, 'value', captured) as string | undefined) ?? null
        },
        (captured) => [lockKey.text(captured)]
      ),
    set: (key, value, ctx) =>
      mutationEntry(
        namespaceContext,
        MemoryOperation.set,
        { key, value },
        ctx,
        (captured, context) => {
          assertStringStorageKey(captured.key, STORAGE_MEMORY_BACKEND)
          return prepareWrite(
            namespaceContext,
            'value',
            captured.key,
            captured.value,
            context.conflictPolicy
          )
        }
      ),
    remove: (key, ctx) =>
      mutationEntry(namespaceContext, MemoryOperation.remove, key, ctx, (captured) => {
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return {
          keys: [lockKey.text(captured)],
          invoke: (draft) => {
            draft.remove('value', captured)
          },
          run: () => remove(namespaceContext, 'value', captured)
        }
      }),
    has: (key, ctx) =>
      asyncEntry(
        namespaceContext,
        MemoryOperation.has,
        key,
        ctx,
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return read(namespaceContext, 'value', captured) !== undefined
        },
        (captured) => [lockKey.text(captured)]
      ),
    keys: (ctx) =>
      asyncEntry(namespaceContext, MemoryOperation.keys, undefined, ctx, () => {
        namespaceContext.controller.assertLive()
        return [...namespaceContext.data.value.entries()]
          .filter(([encoded]) => liveEntry(namespaceContext, 'value', encoded) !== undefined)
          .map(([, entry]) => entry.key)
          .filter((key): key is string => typeof key === 'string')
      }),
    clearValues: (ctx) => clearEntry(namespaceContext, MemoryOperation.clearValues, 'value', ctx),
    clearAll: (ctx) => clearEntry(namespaceContext, MemoryOperation.clearAll, undefined, ctx)
  }
}
/** Compose the namespace's original bytes operations. */
function createMemoryNamespaceBaseBytes<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): Pick<
  IMemoryNamespaceContext<T>['base'],
  'getBytes' | 'setBytes' | 'removeBytes' | 'clearBytes'
> {
  return {
    getBytes: (key, ctx) =>
      asyncEntry(
        namespaceContext,
        MemoryOperation.getBytes,
        key,
        ctx,
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return (read(namespaceContext, 'bytes', captured) as Uint8Array | undefined) ?? null
        },
        (captured) => [lockKey.bytes(captured)]
      ),
    setBytes: (key, value, ctx) =>
      mutationEntry(
        namespaceContext,
        MemoryOperation.setBytes,
        { key, value },
        ctx,
        (captured, context) => {
          assertStringStorageKey(captured.key, STORAGE_MEMORY_BACKEND)
          return prepareWrite(
            namespaceContext,
            'bytes',
            captured.key,
            captured.value,
            context.conflictPolicy
          )
        }
      ),
    removeBytes: (key, ctx) =>
      mutationEntry(namespaceContext, MemoryOperation.removeBytes, key, ctx, (captured) => {
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return {
          keys: [lockKey.bytes(captured)],
          invoke: (draft) => {
            draft.remove('bytes', captured)
          },
          run: () => remove(namespaceContext, 'bytes', captured)
        }
      }),
    clearBytes: (ctx) => clearEntry(namespaceContext, MemoryOperation.clearBytes, 'bytes', ctx)
  }
}
/** Compose the namespace's original records operations. */
function createMemoryNamespaceBaseRecords<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): Pick<
  IMemoryNamespaceContext<T>['base'],
  'getRecord' | 'putRecord' | 'deleteRecord' | 'clearRecords' | 'iterateRecords'
> {
  return {
    getRecord: (key, ctx) =>
      asyncEntry(
        namespaceContext,
        MemoryOperation.getRecord,
        key,
        ctx,
        (captured) => read(namespaceContext, 'record', captured) as T | undefined,
        (captured) => [lockKey.record(captured)]
      ),
    putRecord: (value, key, ctx) =>
      mutationEntry(
        namespaceContext,
        MemoryOperation.putRecord,
        { value, key },
        ctx,
        (captured, context) => {
          /** Generated identity is fixed once for the logical write, including retries and waiting. */
          const resolved = snapshotStorageKey(
            captured.key ?? createStorageToken(),
            STORAGE_MEMORY_BACKEND
          )
          /** The mutation retains the same detached identity that its implicit locks protect. */
          const mutation = prepareWrite(
            namespaceContext,
            'record',
            resolved,
            captured.value,
            context.conflictPolicy
          )
          return {
            ...mutation,
            invoke: (draft) => {
              mutation.invoke!(draft)
              return resolved
            },
            run: () => {
              mutation.run()
              return resolved
            }
          }
        }
      ),
    deleteRecord: (key, ctx) =>
      mutationEntry(namespaceContext, MemoryOperation.deleteRecord, key, ctx, (captured) => {
        /** Mutable record identity detaches before the original policy can wait. */
        const key = snapshotStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return {
          keys: [lockKey.record(key)],
          invoke: (draft) => {
            draft.remove('record', key)
          },
          run: () => remove(namespaceContext, 'record', key)
        }
      }),
    clearRecords: (ctx) =>
      clearEntry(namespaceContext, MemoryOperation.clearRecords, 'record', ctx),
    iterateRecords: (range, ctx) => rootIterator(namespaceContext, range, ctx)
  }
}
/** Compose the namespace's original transactions operations. */
function createMemoryNamespaceBaseTransactions<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): Pick<IMemoryNamespaceContext<T>['base'], 'transaction' | 'tx'> {
  return {
    transaction: <R>(
      run: (scope: IMemoryScope<T>) => R,
      ctx?: ITransactionOptions
    ): Promise<Awaited<R>> =>
      atomicEntry(
        namespaceContext,
        MemoryOperation.transaction,
        (context) => ({ run, ctx: context }),
        ctx,
        (input, admit) => {
          assertTransactionCallback(input.run, STORAGE_MEMORY_BACKEND)
          admit()
          /**
           * Keep the original second read before waiting, with no receiver or private draft
           * argument.
           */
          const callback = input.run
          return { invoke: (scope) => callback(scope) }
        }
      ),
    tx: () =>
      createTransactionBuilder(
        namespaceContext.store,
        undefined,
        namespaceContext.core.getChainMethods('tx')
      )
  }
}
/** Compose the namespace's original observation operations. */
function createMemoryNamespaceBaseObservation<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): Pick<
  IMemoryNamespaceContext<T>['base'],
  'inspectLocks' | 'watch' | 'subscribeChanges' | 'dispose'
> {
  return {
    inspectLocks: (ctx) =>
      asyncEntry(namespaceContext, MemoryOperation.inspectLocks, undefined, ctx, () => {
        namespaceContext.controller.assertLive()
        return namespaceContext.locks.inspectLocks()
      }),
    watch: (key, ctx) => {
      namespaceContext.controller.assertLive()
      assertStringStorageKey(key, STORAGE_MEMORY_BACKEND)
      return watchChanges(namespaceContext, 'value', ctx, key)
    },
    subscribeChanges: (listener) => {
      namespaceContext.controller.assertLive()
      return namespaceContext.controller.subscribe((change) => {
        if (namespaceContext.root || change.orgId === namespaceContext.orgId)
          return listener(change)
      })
    },
    dispose: () => namespaceContext.controller.dispose()
  }
}
/** Execute the native blob put with the original streaming and resource behavior. */
async function memoryBlobPut<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  ...args: Parameters<IMemoryNamespaceContext<T>['objects']['put']>
): ReturnType<IMemoryNamespaceContext<T>['objects']['put']> {
  const [key, body, options] = args
  namespaceContext.controller.assertLive()
  /** Caller-owned body/options are captured before the original operation pipeline can await. */
  const input = snapshotStorageBlobPut(key, body, options, STORAGE_MEMORY_BACKEND)
  /** Pipeline intervention receives owned writable fields without reviving caller getters. */
  const pipelineInput = { ...input, options: { ...input.options } }
  /** Pipeline-provided fields are captured once before upload starts or native admission waits. */
  let prepared: ReturnType<typeof snapshotStorageBlobPut>
  /** Complete content remains private through lock waits and the final generation recheck. */
  let bytes: Uint8Array
  /** Opaque generation metadata is prepared before capacity can remove any original entry. */
  let info: IBlobInfo
  /** Capacity uses the same shared physical tuple as this namespace's native object map. */
  let physicalKey: IStorageKey
  /** The original lock owner's final synchronous preflight selects the exact capacity victims. */
  let plan: ReturnType<typeof planCapacity>
  /** Selected preparation remains accepted original-controller work even when rejected. */
  const preparing =
    namespaceContext.core.journal === undefined
      ? undefined
      : namespaceContext.controller.beginMutation()
  const pending = runWithConcurrency<IBlobInfo>(
    {
      store: namespaceContext.base,
      options: input.options.ctx ?? {},
      prepare:
        namespaceContext.core.journal === undefined
          ? undefined
          : async () => {
              await namespaceContext.core.journal!.prepare()
              /** Blob has no shared journal target; reject before taking upload reader ownership. */
              if (namespaceContext.core.journal!.active())
                throw new StorageContractError(StorageContractErrorCode.unsupported)
            },
      execute: (context, invoke) =>
        namespaceContext.core.execution.run(
          { operation: MemoryOperation.blobPut, input: pipelineInput, ctx: context },
          async (captured) => {
            namespaceContext.controller.assertLive()
            /** Accepted uploads drain through the existing controller's mutation lease. */
            const release = namespaceContext.controller.beginMutation()
            try {
              prepared = snapshotStorageBlobPut(
                captured.key,
                captured.body,
                captured.options,
                STORAGE_MEMORY_BACKEND
              )
              assertBlobCondition(namespaceContext, prepared)
              bytes = await loadBlobBody(namespaceContext, prepared, context.signal)
              throwIfAborted(context.signal)
              namespaceContext.controller.assertLive()
              physicalKey = prefixStorageOrgKey(namespaceContext.orgId, prepared.key)
              info = {
                key: prepared.key,
                size: bytes.byteLength,
                etag: createStorageToken(),
                contentType: prepared.options.contentType,
                metadata: prepared.options.metadata ?? {},
                updatedAt: Date.now()
              }
              return await invoke()
            } catch (cause) {
              throw blobFailure(namespaceContext, cause, input.key)
            } finally {
              release()
            }
          }
        ),
      lock: () => []
    },
    {
      attempt: (attempt) =>
        namespaceContext.locks.attemptWrite(
          attempt,
          holding(namespaceContext),
          () => {
            assertBlobCondition(namespaceContext, prepared)
            return commitCapacity(namespaceContext, plan, () => {
              /** All failure-prone input and body work precedes this final synchronous turn. */
              const entry = namespaceContext.blobs.put(bytes, info)
              namespaceContext.capacityIndex?.put({
                ...capacityFact(namespaceContext, 'blob', entry.key),
                bytes: bytes.byteLength
              })
              publish(namespaceContext, 'blob', 'put')
              return info
            })
          },
          namespaceContext.core.stageBindings.concurrencyStages(namespaceContext.store),
          namespaceContext.controller.closingSignal,
          undefined,
          undefined,
          () => {
            assertBlobCondition(namespaceContext, prepared)
            plan =
              namespaceContext.capacity === undefined
                ? undefined
                : planCapacity(namespaceContext, [
                    capacityFact(namespaceContext, 'blob', physicalKey, bytes.byteLength)
                  ])
            return plan?.identities ?? []
          }
        )
    }
  )
  return preparing === undefined ? pending : pending.finally(preparing)
}
/** Execute the native blob get with the original streaming and resource behavior. */
async function memoryBlobGet<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  ...args: Parameters<IMemoryNamespaceContext<T>['objects']['get']>
): ReturnType<IMemoryNamespaceContext<T>['objects']['get']> {
  const [key, options] = args
  namespaceContext.controller.assertLive()
  /** Range and caller context are admitted before any native object snapshot is opened. */
  const input = snapshotStorageBlobGet(key, options, STORAGE_MEMORY_BACKEND)
  /** The original pipeline may replace or mutate this owned request before native admission. */
  const pipelineInput = { ...input, options: { ...input.options } }
  /** This original timeout/context lifetime transfers to the returned shared object resource. */
  const merged = mergeSignals(input.options.ctx, namespaceContext.report)
  /** A pipeline failure after opening content still disposes that exact original resource. */
  let resource: IBlobObject | undefined
  try {
    throwIfAborted(merged.signal)
    return await namespaceContext.core.execution.run(
      { operation: MemoryOperation.blobGet, input: pipelineInput, ctx: merged.context },
      async (captured) => {
        namespaceContext.controller.assertLive()
        throwIfAborted(merged.signal)
        /** Re-capture pipeline changes even when it retained the same request object identity. */
        const request = snapshotStorageBlobGet(
          captured.key,
          captured.options,
          STORAGE_MEMORY_BACKEND
        )
        /** Native metadata and body come from the same immutable committed generation. */
        const entry = namespaceContext.blobs.get(request.key)
        if (entry === undefined) {
          merged.dispose()
          return undefined
        }
        namespaceContext.capacityIndex?.touch(identity(namespaceContext, 'blob', entry.encoded))
        /** Inclusive public range bounds become a detached native slice. */
        const range = request.options.range
        /** A clipped endpoint also makes reads beyond EOF return an empty body. */
        const end =
          range?.end === undefined
            ? entry.value.body.byteLength
            : Math.min(entry.value.body.byteLength, range.end + 1)
        /** Future overwrites, removal and capacity eviction cannot change returned content. */
        const snapshot = entry.value.body.slice(range?.start ?? 0, end)
        /** Native pull opens no second lifecycle or storage subscription. */
        const source = new ReadableStream<Uint8Array>(
          {
            pull(native) {
              namespaceContext.controller.assertLive()
              throwIfAborted(merged.signal)
              native.enqueue(snapshot)
              native.close()
            }
          },
          { highWaterMark: 0 }
        )
        resource = createStorageBlobObject(entry.value.info, source, {
          close: () => merged.dispose(),
          report: namespaceContext.report,
          backend: STORAGE_MEMORY_BACKEND,
          normalizeFailure: (cause) => blobFailure(namespaceContext, cause, request.key)
        })
        return resource
      }
    )
  } catch (cause) {
    try {
      await resource?.dispose()
    } catch (cleanup) {
      reportCleanupError(namespaceContext.report, cleanup)
    }
    merged.dispose()
    throw blobFailure(namespaceContext, cause, input.key)
  }
}
/** Apply the original record query mutation to the same accepted scope draft. */
function memoryScopeQueryRecord<T, R>(
  scopeContext: IMemoryScopeContext<T, R>,
  ...args: Parameters<IMemoryQueryDraft['record']>
): ReturnType<IMemoryQueryDraft['record']> {
  const [request, run] = args
  assertTransactionOwner(scopeContext.transactionContext.namespaceContext.store, scopeContext.scope)
  /** Pipeline-provided patches detach once before selection can touch any draft row. */
  const patch =
    request.operation === 'update'
      ? clone(scopeContext.transactionContext.namespaceContext, request.patch)
      : undefined
  if (
    request.operation !== 'delete' &&
    (request.operation !== 'update' ||
      typeof patch !== 'object' ||
      patch === null ||
      Array.isArray(patch))
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: STORAGE_MEMORY_BACKEND
    })
  return run({
    execute: () =>
      queryIterator(scopeContext.transactionContext, scopeContext.scope, function* () {
        for (const row of txRows(scopeContext.transactionContext, 'record'))
          yield [
            clone(scopeContext.transactionContext.namespaceContext, row.key),
            copyValue(
              scopeContext.transactionContext.namespaceContext,
              'record',
              row.value,
              row.key
            )
          ] as const
      }),
    accept: (key) => {
      assertTransactionOwner(
        scopeContext.transactionContext.namespaceContext.store,
        scopeContext.scope
      )
      if (request.operation === 'delete')
        return txRemove(scopeContext.transactionContext, 'record', key)
      /** Query projections never become replacement values; patch the actual draft row. */
      const current = txEntry(scopeContext.transactionContext, 'record', key)
      if (current === undefined) return false
      if (typeof current.value !== 'object' || current.value === null)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
          backend: STORAGE_MEMORY_BACKEND
        })
      /** Existing native cloning preserves Date/Map values admitted by memory. */
      const value = clone(scopeContext.transactionContext.namespaceContext, current.value, key)
      for (const field of Object.keys(patch!)) {
        /** Existing native fields such as Array.length retain their original descriptors. */
        const descriptor = Object.getOwnPropertyDescriptor(value, field)
        Object.defineProperty(
          value,
          field,
          descriptor === undefined
            ? {
                value: patch![field],
                enumerable: true,
                configurable: true,
                writable: true
              }
            : { ...descriptor, value: patch![field] }
        )
      }
      txWrite(scopeContext.transactionContext, 'record', key, value, 'replace')
      return true
    }
  })
}
/** Apply the original rdf query mutation to the same accepted scope draft. */
function memoryScopeQueryRdf<T, R>(
  scopeContext: IMemoryScopeContext<T, R>,
  ...args: Parameters<IMemoryQueryDraft['rdf']>
): ReturnType<IMemoryQueryDraft['rdf']> {
  const [request, run] = args
  assertTransactionOwner(scopeContext.transactionContext.namespaceContext.store, scopeContext.scope)
  /** Replacement admission precedes selection or any draft tombstone. */
  const replacement =
    request.operation === 'replace'
      ? captureRdfEntries(scopeContext.transactionContext.namespaceContext, [request.newQuad])[0]
      : undefined
  return run({
    execute: (input) =>
      queryIterator(scopeContext.transactionContext, scopeContext.scope, function* () {
        for (const row of txRdfRows(scopeContext.transactionContext, input.pattern))
          yield [
            row.key,
            logicalRdfQuad(scopeContext.transactionContext.namespaceContext, row)
          ] as const
      }),
    accept: (_key, quad) => {
      assertTransactionOwner(
        scopeContext.transactionContext.namespaceContext.store,
        scopeContext.scope
      )
      /** The original physical identity resolves actual draft membership and no-op replacement. */
      const entry = captureRdfEntries(scopeContext.transactionContext.namespaceContext, [quad])[0]!
      const proposed = scopeContext.transactionContext.draft.get(
        identity(scopeContext.transactionContext.namespaceContext, 'rdf', entry.encoded)
      )
      const current = proposed
        ? proposed.remove
          ? undefined
          : proposed
        : txSnapshot(scopeContext.transactionContext, 'rdf', entry.encoded, entry.key)
      if (current === undefined || replacement?.encoded === entry.encoded) return false
      txRdfWrite(scopeContext.transactionContext, [quad], true)
      if (replacement !== undefined)
        txRdfWrite(
          scopeContext.transactionContext,
          [logicalRdfQuad(scopeContext.transactionContext.namespaceContext, replacement)],
          false
        )
      return true
    }
  })
}

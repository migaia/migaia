import { asyncDisposeKey } from '@migaia/plugin-host'
import { createBackendRevisionPort } from './revisions.ts'
import { createBackendKeyLockPort } from './key-locks.ts'
import type { IBackendChangeController } from '../core/change-types.ts'
import {
  StorageContractError,
  StorageContractErrorCode,
  type ITransactionRecordsApi,
  kv,
  records,
  ttl,
  counter,
  vector,
  rdf,
  blob,
  type ICapabilityStore,
  type ICapabilityImpl,
  type IRecordsApi,
  type IBlobApi,
  type IQuad,
  type IRdfApi,
  type ITransactionRdfApi,
  type IStorageVectorPoint,
  type IStorageVectorConfiguration,
  type IVectorApi,
  type IVectorHit,
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
  type IStorageKey,
  type ITransactionScope,
  type ITransactionOptions,
  type ILockKey,
  type ITransactionBuilder,
  type IRecordStore,
  type ISyncCapableStore,
  type IChangeFeedStore,
  type IStorageChange,
  type ICapabilityInstallPort,
  type IConcurrencyPolicy,
  type ILockHolding,
  type IOperationContext,
  type IConflictPolicy
} from '@migaia/storage-contract'
import { ConcurrencyPolicy, runWithConcurrency } from '../authoring/concurrency.ts'
import { snapshotStorageCounterIncrement } from '../authoring/counter.ts'
import { createTransactionOwner, assertTransactionOwner } from '../authoring/transaction.ts'
import { createMemoryRdfIndex, type IMemoryRdfKeys } from './rdf-core.ts'
import { createMemoryBlobData } from './memory-blob.ts'
import { createMemoryJournalData, type IMemoryJournalTransaction } from './memory-journal.ts'
import { snapshotMemoryJournalTarget } from './memory-journal-image.ts'
import type {
  IStorageJournalBackendBinding,
  IStorageJournalChange,
  IStorageJournalImage,
  IStorageJournalTarget
} from '../journal/types.ts'
import type { ILogPayload } from '@migaia/log-plugin-durable'
import { storageJournalLockKey, StorageJournalLock } from '../journal/keys.ts'
import { detectServerRuntime } from '@migaia/utils'
import { StorageError, type IStorageChannel } from '../errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.ts'
import type { IStoragePluginCore } from '../types.ts'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.ts'
import { MemoryOperation, MemoryState } from './memory-constants.ts'
import { createStorageToken } from '../core/storage-token.ts'
import { createOrderedRecordIndex } from '../core/ordered-record-index.ts'
import { resolveStorageNamespace } from '../core/namespace.ts'
import { createStorageOperationReporter, reportCleanupError } from '../core/operation-reporter.ts'
import type { IMemoryAssembly } from './memory-assembly.ts'
import { createMemoryLifecycleController } from './memory-lifecycle.ts'
import {
  snapshotMemoryCapacity,
  createMemoryCapacityIndex,
  type IMemoryCapacity,
  type IMemoryCapacityOptions,
  type IMemoryCapacityChange
} from './memory-capacity.ts'
import {
  normalize,
  finalize,
  mutationEntry,
  mutationRanges,
  clearAll,
  holding
} from './memory-entries.ts'
import {
  createMemoryNamespaceKeyValue,
  createMemoryNamespaceTimeToLive,
  createMemoryNamespaceCounters
} from './memory-keyvalue.ts'
import { createMemoryNamespaceBase, atomicEntry } from './memory-namespace-base.ts'
import {
  createMemoryNamespaceRdfApi,
  createMemoryNamespaceStore,
  createMemoryNamespaceJournalImages
} from './memory-namespace-store.ts'
import { createMemoryNamespaceObjects } from './memory-objects.ts'
import { createMemoryNamespaceVectors } from './memory-vector.ts'

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
export const recordPrefix = Symbol()
/** The original capability binder borrows only this current native view's TTL methods. */
export const ttlOperations = Symbol()
/** The counter binder borrows the same accepted operation and text draft from its fresh view. */
export const counterOperations = Symbol()
/** The RDF binder borrows the same original draft and accepted operation view. */
export const rdfOperations = Symbol()
/** Query writes borrow this exact native scope's existing draft, never a second writer. */
export const queryDraft = Symbol()
/** The record binder keeps the current scope's actual query factory and accepted operation. */
export const recordQueries = Symbol()
/** Journal metadata borrows this authentic view's original draft and terminal callbacks only. */
export const journalOperations = Symbol()
/** One private selector keeps the native ranking algorithm shared by read and write cursors. */
export type IMemoryVectorSelection<P> = (
  input: IVectorQueryInput,
  points: Iterable<IStorageVectorPoint<P>>,
  point: (id: string) => IStorageVectorPoint<P> | undefined
) => Iterable<readonly [IStorageKey, IVectorHit<P, boolean>]>
/** Internal query selection supplies original native rows and consumes accepted draft mutations. */
export type IMemoryQueryDraft = {
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
export type IMemoryScope<T> = ITransactionScope<
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
    readonly capabilities: IRecordStore<T>['capabilities'] & { readonly changeFeed: boolean }
    transaction<R>(
      run: (scope: IMemoryScope<T>) => R,
      options?: ITransactionOptions
    ): Promise<Awaited<R>>
    tx(): ITransactionBuilder<IMemoryScope<T>>
    inspectLocks(ctx?: IOperationContext): Promise<readonly ILockHolding[]>
    undo?(txId: string, ctx?: IOperationContext): Promise<{ readonly txId: string }>
  }
/** Canonical keys and committed values belong to their actual memory channel. */
export type IMemoryEntry = {
  readonly key: IStorageKey
  readonly value: unknown
  readonly ordered: Uint8Array
  readonly bytes?: number
  readonly rdfKeys?: IMemoryRdfKeys
  readonly rdfLock?: ILockKey
}
/** Native vector and RDF rows share the maps and draft without legacy channel replacement. */
export type IMemoryChannel = IStorageChannel | 'vector' | 'rdf'
/** Blobs share capacity and invalidation, while remaining outside generic transactions and locks. */
export type IMemoryPhysicalChannel = IMemoryChannel | 'blob'
/** A transaction retains its first deadline beside the existing detached value snapshot. */
export type IMemorySnapshot = IMemoryEntry & { readonly deadline?: number }
/** This native unit supports only its actual three physical value channels. */
export type IMemoryTtlTarget = ITtlTarget
/** A draft deletion remains distinct from an untouched identity. */
export type IMemoryDraft = IMemorySnapshot & {
  readonly channel: IMemoryChannel
  readonly remove: boolean
  readonly encoded: string
}
/** A prepared RDF row keeps physical graph identity and the user's namespace-local logical lock. */
export type IMemoryRdfEntry = IMemoryEntry & {
  readonly encoded: string
  readonly rdfKeys: IMemoryRdfKeys
  readonly rdfLock: ILockKey
}

/** Prepared root work owns detached inputs while borrowing the original admission and budget. */
export type IMemoryRootMutation<R> = {
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
export type IMemoryTextEntry = {
  readonly key: IStorageKey
  readonly value: string
  readonly ttlMs?: number
}
/** Only original native draft functions are passed to an internal batch callback. */
export type IMemoryTextDraft = {
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
export type IMemoryAtomicWork<T, R> = {
  readonly keys?: readonly ILockKey[]
  readonly ranges?: IMemoryRootMutation<unknown>['ranges']
  readonly invoke: (scope: IMemoryScope<T>, draft: IMemoryTextDraft) => R
}

/** Create the real native backend only from its original installed core. */
export function createMemoryBackend<T = unknown>(
  core: IStoragePluginCore,
  options: IMemoryOptions,
  capacity: IMemoryCapacity | undefined = snapshotMemoryCapacity(options),
  assembly: IMemoryAssembly = {}
) {
  return new MemoryBackendOwner<T>(core, options, capacity, assembly).construct()
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
  /** Explicit Feature roots select optional notification and iterator owners. */
  readonly #assembly: IMemoryAssembly

  /** Validate the physical namespace before allocating its original lifecycle controller. */
  constructor(
    core: IStoragePluginCore,
    options: IMemoryOptions,
    capacity: IMemoryCapacity | undefined,
    assembly: IMemoryAssembly
  ) {
    this.#core = core
    this.#assembly = assembly
    this.#options = options
    this.#capacity = capacity
    this.#namespace = resolveStorageNamespace(
      options.namespace ?? MemoryState.defaultNamespace,
      core.defaultOrgId,
      core.defaultOrgId
    )
    /** Base memory has no event channel; selected roots opt into the original notification owner. */
    const controllerOptions = {
      backend: STORAGE_MEMORY_BACKEND,
      options: { namespace: this.#namespace },
      finalize: () => this.#finalize()
    }
    if (assembly.iterator !== undefined && assembly.controller === undefined)
      throw new StorageError(
        StorageHostErrorCode.changeControllerNotAssembled,
        {},
        StorageErrorText.changeControllerNotAssembled
      )
    this.#controller =
      assembly.controller === undefined
        ? createMemoryLifecycleController(controllerOptions)
        : core.createChangeController(controllerOptions, assembly.controller)
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
      this.#capacity,
      this.#assembly
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
export type IMemoryNamespaceContext<T> = {
  /** Original core belongs to this physical namespace. */
  readonly core: IStoragePluginCore
  /** Original options belongs to this physical namespace. */
  readonly options: IMemoryOptions
  /** Original controller belongs to this physical namespace. */
  readonly controller: IBackendChangeController
  /** Optional Feature owners were captured before native construction. */
  readonly assembly: IMemoryAssembly
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
  capacity: IMemoryCapacity | undefined,
  assembly: IMemoryAssembly
) {
  /** Initialize in the original order before the completed store can escape. */
  const namespaceContext = {
    core,
    options,
    controller,
    orgId,
    root,
    capacity,
    assembly
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

/** Precise native store shape is retained by the first-party plugin factory. */
export type IMemoryBackendStore<T = unknown> = Omit<
  ReturnType<typeof createMemoryBackend<T>>['store'],
  'undo'
>

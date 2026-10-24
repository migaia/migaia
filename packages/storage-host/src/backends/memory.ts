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
  /** Validate the configured target before allocating data or acquiring any native resource. */
  const namespace = resolveStorageNamespace(
    options.namespace ?? MemoryState.defaultNamespace,
    core.defaultOrgId,
    core.defaultOrgId
  )
  /** Every namespace belongs to this installed physical backend and its one lifecycle controller. */
  const namespaces = new Map<string, ReturnType<typeof createMemoryNamespace<T>>>()
  /** One controller owns admission, event sequence and final cleanup for all native namespaces. */
  const controller = core.createChangeController({
    backend: STORAGE_MEMORY_BACKEND,
    options: { namespace },
    finalize: async () => {
      for (const physical of namespaces.values()) await physical.finalize()
      namespaces.clear()
    }
  })
  /** Native projections allocate data only on demand, without DDL, registry writes or new lifetimes. */
  const forOrg = (orgId: string) => {
    controller.assertLive()
    const target = resolveStorageNamespace(namespace, orgId, core.defaultOrgId)
    const existing = namespaces.get(target)
    if (existing !== undefined) return existing
    const ports = core.getOrgContext(orgId)
    const physical = createMemoryNamespace<T>(
      { ...core, ...ports },
      options,
      controller,
      orgId,
      orgId === core.defaultOrgId,
      capacity
    )
    namespaces.set(target, physical)
    return physical
  }
  /** Default host calls and explicit default-org views resolve the exact same physical namespace. */
  const physical = forOrg(core.defaultOrgId)
  return {
    ...physical,
    controller,
    orgBinding: {
      backend: (orgId: string) => forOrg(orgId).store,
      drop: async (orgId: string) => {
        const current = forOrg(orgId)
        if (core.journal !== undefined) return current.drop()
        await current.store.clearAll()
        current.journal.clear()
      }
    },
    journalBinding: (() => {
      /** The descriptor owns one projector; every result closes over one existing physical org. */
      const binding = (orgId: string): IStorageJournalBackendBinding => ({
        externalWal: true,
        lockTarget: (target) => snapshotMemoryJournalTarget(target).lock,
        forOrg: binding,
        openNamespace: (prefix) => forOrg(orgId).journal.open(prefix),
        changes: (scope) => forOrg(orgId).journalImages.changes(scope),
        readImage: (scope, target) => forOrg(orgId).journalImages.readImage(scope, target),
        writeImage: (scope, target, image) =>
          forOrg(orgId).journalImages.writeImage(scope, target, image),
        readRevision: (scope, target) => forOrg(orgId).journalImages.readRevision(scope, target),
        writeCommitMarker: (scope, txId) => forOrg(orgId).journal.writeMarker(scope, txId),
        hasCommitMarker: (txId) => forOrg(orgId).journal.hasMarker(txId),
        removeCommitMarker: (txId) => forOrg(orgId).journal.removeMarker(txId)
      })
      return binding(core.defaultOrgId)
    })(),
    assertScope: (scope: ITransactionScope) => {
      for (const physical of namespaces.values()) {
        try {
          assertTransactionOwner(physical.store, scope)
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
  }
}

/** Build native operations over one namespace while borrowing its registration's original lifetime. */
function createMemoryNamespace<T>(
  core: IStoragePluginCore,
  options: IMemoryOptions,
  controller: IBackendChangeController,
  orgId: string,
  root: boolean,
  capacity: IMemoryCapacity | undefined
) {
  /** Physical membership, ordered ranges, deadline facts and lock admission share this namespace. */
  const data = {
    value: new Map<string, IMemoryEntry>(),
    bytes: new Map<string, IMemoryEntry>(),
    record: new Map<string, IMemoryEntry>(),
    vector: new Map<string, IMemoryEntry>(),
    rdf: new Map<string, IMemoryEntry>()
  }
  /** Collection metadata is private to this namespace and consumes no second physical entry. */
  const vectorCollections = new Map<string, IStorageVectorConfiguration>()
  /** Opaque objects keep independent native identity under the same namespace and controller. */
  const blobs = createMemoryBlobData(orgId)
  /** Full clears include native families; legacy key replacement remains three-channel. */
  const physicalChannels = [...MemoryState.channels, 'vector', 'rdf'] as const
  /** Only live expiring identities retain deadline metadata. */
  const deadlines = new Map<string, number>()
  /** Optional policy metadata belongs only to this namespace's original physical rows. */
  const capacityIndex = capacity === undefined ? undefined : createMemoryCapacityIndex(capacity)
  /** Capacity can reclaim actual elapsed deadlines through the same compressed radix owner. */
  const expiring =
    capacity === undefined
      ? undefined
      : createOrderedRecordIndex<{
          readonly channel: IMemoryChannel
          readonly encoded: string
        }>()
  /** Ordered leaves index the same native data entries. */
  const ordered = {
    value: createOrderedRecordIndex<IMemoryEntry>(),
    bytes: createOrderedRecordIndex<IMemoryEntry>(),
    record: createOrderedRecordIndex<IMemoryEntry>(),
    vector: createOrderedRecordIndex<IMemoryEntry>(),
    rdf: createOrderedRecordIndex<IMemoryEntry>()
  }
  /** RDF permutations index the same physical entries under this namespace and lifecycle. */
  const rdfIndex = createMemoryRdfIndex(ordered.rdf)
  /** These original internal algorithms own only physical facts, without installation authority. */
  const revisions = createBackendRevisionPort()
  /** Each namespace has independent canonical locks under the one parent lifecycle. */
  const locks = createBackendKeyLockPort()
  /** Existing cleanup diagnostics retain their original reporter. */
  const report = createStorageOperationReporter()
  /** Native deadlines use the original captured scheduler. */
  const scheduler = core.featureExpose.getScheduler()
  /** Symbol cleanup retains its cached reporting derivative. */
  let symbolic: Promise<void> | undefined
  /** Feature publication borrows this native provider's original installer. */
  let installer!: ICapabilityInstallPort
  /** Native transaction views share this namespace's original canonical owner. */
  let owner!: ReturnType<typeof createTransactionOwner<T>>
  /** Private metadata uses this same physical namespace, original native attempt and owner. */
  const journal = createMemoryJournalData({
    assertLive: controller.assertLive,
    report: (error) => reportCleanupError(report, error),
    closingSignal: controller.closingSignal,
    reserve: (prefix, run) =>
      runWithConcurrency(
        {
          store: base,
          options: { lock: [storageJournalLockKey(prefix, StorageJournalLock.resource)] },
          policy: ConcurrencyPolicy.fail()
        },
        {
          attempt: (context) =>
            locks.attemptMetadata(
              context,
              holding(),
              {
                attempt: async () => {
                  await run()
                  return { status: 'committed', value: undefined }
                }
              },
              core.stageBindings.concurrencyStages(store),
              controller.closingSignal
            )
        }
      ),
    transaction: (prefix, work) =>
      atomicEntry(
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
      info: assertTransactionOwner(store, scope),
      port: (scope as IMemoryScope<T>)[journalOperations]
    })
  })
  /** Root lifecycle finalization releases each namespace's physical facts exactly once. */
  const finalize = async () => {
    await locks.dispose()
    for (const channel of physicalChannels) {
      data[channel].clear()
      ordered[channel].clear()
      revisions.clear(channel === 'value' ? 'text' : channel)
    }
    deadlines.clear()
    expiring?.clear()
    capacityIndex?.clear()
    vectorCollections.clear()
    rdfIndex.clear()
    blobs.clear()
    journal.clear()
  }
  /** Unknown backend callback failures gain their original memory transaction boundary. */
  const normalize = (cause: unknown, expiredScope?: true) =>
    isStorageErrorFamily(cause)
      ? cause
      : new StorageError(StorageErrorCode.transactionFailed, {
          backend: STORAGE_MEMORY_BACKEND,
          ...(expiredScope ? { operation: MemoryOperation.transactionScope } : {}),
          cause
        })
  /** The existing token helper retains one opaque owner identity for the physical store. */
  const ownerId = createStorageToken()
  /** Runtime detection reuses the neutral utils owner rather than importing a host client. */
  const runtime = detectServerRuntime()
  /** Native process identity is captured once for this physical instance's lock diagnostics. */
  const nativeHost = globalThis as unknown as {
    process?: { pid?: number }
    Deno?: { pid?: number }
  }
  /** The chosen runtime decides which already-present native pid owns this physical process. */
  const pid = runtime === 'deno' ? nativeHost.Deno?.pid : nativeHost.process?.pid
  /** Explicit labels and runtime defaults stay stable through every native retry. */
  const label = options.owner?.label ?? MemoryState.ownerLabel(runtime, pid)
  /** One active attempt captures the actual store identity rather than the transaction callback. */
  const holding = (): IConcurrencyHolder => ({
    status: 'held',
    owner: ownerId,
    label,
    scope: 'local',
    since: Date.now(),
    ...(pid === undefined ? {} : { pid })
  })
  /** One physical channel plus the existing flat wire gives an unambiguous revision identity. */
  const identity = (channel: IMemoryPhysicalChannel, encoded: string): string =>
    MemoryState.identity(channel, encoded)
  /** Revision changes remain independent of whether an entry is currently present. */
  const revision = (channel: IMemoryChannel, encoded: string): number =>
    revisions.read(channel === 'value' ? 'text' : channel, encoded)
  /** Every successful physical change advances only its own channel's original revision. */
  const bump = (channel: IMemoryChannel, encoded: string): void => {
    revisions.write(channel === 'value' ? 'text' : channel, encoded)
  }
  /** One deadline mutation keeps the original Map and optional candidate index synchronized. */
  const setDeadline = (
    channel: IMemoryChannel,
    encoded: string,
    deadline: number | undefined
  ): void => {
    /** Existing canonical identity and old clock fact identify the exact expiry leaf to replace. */
    const id = identity(channel, encoded)
    /** No secondary expiry structure exists on the original unbounded path. */
    const previous = deadlines.get(id)
    if (expiring !== undefined && previous !== undefined)
      expiring.delete(encodeOrderedStorageKey([previous, channel, encoded], STORAGE_MEMORY_BACKEND))
    if (deadline === undefined) deadlines.delete(id)
    else {
      deadlines.set(id, deadline)
      expiring?.set(encodeOrderedStorageKey([deadline, channel, encoded], STORAGE_MEMORY_BACKEND), {
        channel,
        encoded
      })
    }
  }
  /** Accounting never inspects record values unless the explicit byte limit needs their encoding. */
  const entryBytes = (channel: IMemoryChannel, value: unknown): number => {
    if (capacity?.maxBytes === undefined) return 0
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
  const capacityFact = (
    channel: IMemoryPhysicalChannel,
    key: IStorageKey,
    bytes?: number,
    rdfLock?: ILockKey
  ): IMemoryCapacityChange => {
    /** RDF already owns its original canonical identity; other channels retain the flat-key owner. */
    const encoded = channel === 'rdf' ? (key as string) : encodeFlatStorageKey(key)
    return { id: identity(channel, encoded), channel, encoded, key, bytes, lock: rdfLock }
  }
  /** Capacity uses only native physical channels already known to this namespace. */
  const capacityLock = (entry: IMemoryCapacityChange): ILockKey | undefined => {
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
  const planCapacity = (changes: readonly IMemoryCapacityChange[]) => {
    /** An omitted capacity never allocates accounting or candidate work. */
    if (capacityIndex === undefined || expiring === undefined) return undefined
    /** Inclusive now is expressed through the original tuple-prefix upper bound. */
    const upper = snapshotStorageKeyPrefix([scheduler.now()], STORAGE_MEMORY_BACKEND).upper
    /** Actual expired rows alone enter the removal plan; no live-key table scan occurs. */
    const expired: IMemoryCapacityChange[] = []
    for (const leaf of expiring.range({ upper, upperOpen: true })) {
      const { channel, encoded } = leaf.value
      const entry = data[channel].get(encoded)
      if (entry !== undefined) expired.push(capacityFact(channel, entry.key))
    }
    /** Preview restores the exact policy links before any lock wait or user callback can happen. */
    const victims = capacityIndex.preview([...expired, ...changes])
    /** Canonical point identities feed only the existing physical lock owner and its original FIFO. */
    const identities = snapshotConcurrencyLockKeys(
      [...expired, ...victims]
        .map(capacityLock)
        .filter((key): key is ILockKey => key !== undefined),
      STORAGE_MEMORY_BACKEND
    ).identities
    return { expired, victims, identities }
  }
  /** Native metadata deletion is shared by expiry, explicit removal and committed capacity victims. */
  const deletePhysical = (
    channel: IMemoryPhysicalChannel,
    encoded: string
  ): IMemoryEntry | undefined => {
    if (channel === 'blob') {
      const entry = blobs.removeEncoded(encoded)
      if (entry !== undefined) capacityIndex?.remove(identity(channel, encoded))
      return entry
    }
    const entry = data[channel].get(encoded)
    if (entry === undefined) return undefined
    data[channel].delete(encoded)
    if (channel === 'rdf') rdfIndex.delete(entry.rdfKeys!)
    else ordered[channel].delete(entry.ordered)
    setDeadline(channel, encoded, undefined)
    capacityIndex?.remove(identity(channel, encoded))
    bump(channel, encoded)
    return entry
  }
  /** Records and bytes detach ownership before an eviction or committed mutation occurs. */
  const clone = <V>(value: V, key?: IStorageKey): V => {
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
  const copyValue = (channel: IMemoryChannel, value: unknown, key: IStorageKey): unknown =>
    channel === 'value' || channel === 'rdf'
      ? value
      : channel === 'bytes'
        ? cloneBytes(value as Uint8Array, key)
        : clone(value, key)
  /** Byte carriers preserve the original cross-realm guard and detached view-copy rule. */
  const cloneBytes = (value: Uint8Array, key: IStorageKey): Uint8Array => {
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
  const prepare = (channel: IStorageChannel, value: unknown, key: IStorageKey): unknown => {
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
    return copyValue(channel, value, key)
  }
  /**
   * Explicit capacity holds only this native turn's events until all data and victims are
   * committed.
   */
  let pendingChanges:
    | {
        readonly channel: IMemoryPhysicalChannel
        readonly kind: IStorageChange['kind']
        readonly keys?: readonly IStorageKey[]
      }[]
    | undefined
  /** Notifications retain original commit-after eviction order. */
  const publish = (
    channel: IMemoryPhysicalChannel,
    kind: IStorageChange['kind'],
    keys?: readonly IStorageKey[]
  ): void => {
    if (pendingChanges !== undefined) {
      pendingChanges.push({ channel, kind, keys })
      return
    }
    controller.publish({
      channel: channel === 'vector' || channel === 'rdf' || channel === 'blob' ? 'all' : channel,
      kind,
      orgId,
      // Broad RDF/object invalidations never expose physical graph or organization key envelopes.
      ...(keys === undefined || channel === 'rdf' || channel === 'blob' ? {} : { keys })
    })
  }
  /** Capacity mutations and their events share the original final synchronous native turn. */
  const commitCapacity = <R>(
    plan: ReturnType<typeof planCapacity>,
    run: () => R,
    committed?: () => void
  ): R => {
    if (plan === undefined) {
      const result = run()
      committed?.()
      return result
    }
    pendingChanges = []
    /** Counts retain only actual capacity removals, never ordinary expiry or user values. */
    const counts = new Map<IMemoryPhysicalChannel, number>()
    try {
      for (const entry of plan.expired) {
        const removed = deletePhysical(entry.channel as IMemoryChannel, entry.encoded)
        if (removed !== undefined) publish(entry.channel as IMemoryChannel, 'remove', [removed.key])
      }
      /** Input preparation and final lock checks have already completed before this callback. */
      const result = run()
      for (const entry of plan.victims) {
        const channel = entry.channel as IMemoryPhysicalChannel
        const removed = deletePhysical(channel, entry.encoded)
        if (removed === undefined) continue
        publish(channel, 'remove', [removed.key])
        counts.set(channel, (counts.get(channel) ?? 0) + 1)
      }
      committed?.()
      return result
    } finally {
      /** Clear the native event buffer before observers can synchronously reenter this store. */
      const changes = pendingChanges
      pendingChanges = undefined
      for (const change of changes) publish(change.channel, change.kind, change.keys)
      for (const [channel, count] of counts)
        core.emit(StorageHookName.onEvict, () => ({
          backendId: core.getBackendId(),
          backend: STORAGE_MEMORY_BACKEND,
          orgId,
          channel,
          count
        }))
    }
  }
  /** Every physical access shares one deadline check and the original removal/revision path. */
  const liveEntry = (channel: IMemoryChannel, encoded: string): IMemoryEntry | undefined => {
    /** Physical membership and deadline use the same canonical channel/key identity. */
    const entry = data[channel].get(encoded)
    /** Omitted deadlines remain unlimited, including keys first written before TTL is used. */
    const id = identity(channel, encoded)
    /** The original monotonic clock is consulted once for this physical access. */
    const deadline = deadlines.get(id)
    if (entry !== undefined && deadline !== undefined && deadline <= scheduler.now()) {
      deletePhysical(channel, encoded)
      publish(channel, 'remove', [entry.key])
      return undefined
    }
    return entry
  }
  /** Apply one already prepared root write synchronously, then publish its complete result. */
  const write = (
    channel: IStorageChannel,
    key: IStorageKey,
    value: unknown,
    policy: IConflictPolicy = 'conflict',
    bytes = entryBytes(channel, value)
  ): void => {
    controller.assertLive()
    /** Snapshot and prepare before touching any conflicting channel. */
    const captured = key
    /** All data channels share the same existing flat logical-key identity. */
    const encoded = encodeFlatStorageKey(captured)
    /** Cloning completed before lock admission, so no borrowed getter can reopen this final turn. */
    const prepared = value
    /** One canonical ordered encoding is retained by the live entry and affected native indexes. */
    const encodedBytes = encodeOrderedStorageKey(captured, STORAGE_MEMORY_BACKEND)
    /** Overwrite keeps the already retained live bytes for the exact canonical identity. */
    const keyBytes = ordered[channel].get(encodedBytes)?.key ?? encodedBytes
    /** Actual physical membership alone determines channel replacement. */
    const existing = new Set(
      MemoryState.channels.filter((current) => liveEntry(current, encoded) !== undefined)
    )
    /** Shared conflict policy owns one removal order for all backends. */
    const plan = planChannelWrite(captured, channel, existing, policy, STORAGE_MEMORY_BACKEND)
    for (const previous of plan.remove) {
      deletePhysical(previous, encoded)
    }
    /** The hash and radix owners share this exact committed entry reference. */
    const entry = { key: captured, value: prepared, ordered: keyBytes, bytes }
    data[channel].set(encoded, entry)
    ordered[channel].set(keyBytes, entry)
    capacityIndex?.put({ ...capacityFact(channel, captured), bytes })
    bump(channel, encoded)
    for (const previous of plan.remove) publish(previous, 'remove', [captured])
    publish(channel, 'put', [captured])
  }
  /** Root deletes remain genuine no-ops when the original channel has no such key. */
  const remove = (channel: IStorageChannel, key: IStorageKey): void => {
    controller.assertLive()
    /** Deletes detach caller-owned key objects before recording a committed event. */
    const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
    /** The same wire identity is used by reads, writes and revision tombstones. */
    const encoded = encodeFlatStorageKey(captured)
    /** The actual entry already owns the canonical ordered bytes needed for removal. */
    const entry = liveEntry(channel, encoded)
    if (!entry) return
    deletePhysical(channel, encoded)
    publish(channel, 'remove', [captured])
  }
  /** Clear invalidates the actual channel snapshot even when membership was already empty. */
  const clear = (channel: IStorageChannel, notify = true): void => {
    controller.assertLive()
    /** Preserve the original rule that an empty clear emits no notification. */
    const changed = data[channel].size !== 0
    for (const encoded of data[channel].keys()) {
      setDeadline(channel, encoded, undefined)
      capacityIndex?.remove(identity(channel, encoded))
    }
    data[channel].clear()
    ordered[channel].clear()
    revisions.clear(channel === 'value' ? 'text' : channel)
    if (changed && notify) publish(channel, 'clear')
  }
  /** All flat reads retain string-only validation and old null/undefined missing results. */
  const read = (channel: IStorageChannel, key: IStorageKey): unknown => {
    controller.assertLive()
    /** Record keys remain structured; flat text and bytes remain string-only. */
    const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
    /** Reading never allocates a revision or changes physical membership. */
    const entry = liveEntry(channel, encodeFlatStorageKey(captured))
    if (entry !== undefined) capacityIndex?.touch(identity(channel, encodeFlatStorageKey(captured)))
    return entry === undefined ? undefined : copyValue(channel, entry.value, captured)
  }
  /** Replace admits every possible displaced channel in the same fixed canonical order. */
  const mutationKeys = (
    channel: IStorageChannel,
    key: IStorageKey,
    policy?: IConflictPolicy
  ): readonly ILockKey[] =>
    (policy === 'replace' ? MemoryState.channels : [channel]).flatMap<ILockKey>((current) =>
      current === 'value'
        ? [lockKey.text(key)]
        : current === 'record'
          ? [lockKey.record(key)]
          : typeof key === 'string'
            ? [lockKey.bytes(key)]
            : []
    )
  /** One finite range per affected channel uses the original contract's encoded identity bounds. */
  const mutationRanges = (channels: readonly IMemoryChannel[]) =>
    channels.map((channel) => {
      /** Physical text identity is shared by scalar and typed transaction text keys. */
      const target: ILockKey['channel'] = channel === 'value' ? 'text' : channel
      return {
        channel: target,
        ...snapshotConcurrencyLockRange({ channel: target }, STORAGE_MEMORY_BACKEND)
      }
    })
  /** Busy synchronous writes cannot run a policy or wait; diagnostics identify the actual holder. */
  const assertUnlocked = (
    keys: readonly ILockKey[],
    ranges?: IMemoryRootMutation<unknown>['ranges']
  ): void => {
    /** Canonical admission pairs detached keys with the sole original identity representation. */
    const captured = snapshotConcurrencyLockKeys(keys, STORAGE_MEMORY_BACKEND)
    /** Point checks perform only fixed-channel Map lookups; clear examines its affected bucket. */
    const held = locks.probe(captured.identities, ranges)
    if (held !== undefined)
      throw new StorageContractError(StorageContractErrorCode.lockRejected, {
        backend: STORAGE_MEMORY_BACKEND,
        keys: [held.key],
        holder: held.holder
      })
  }
  /** Capture borrowed payload before admission; the eventual physical mutation never calls it again. */
  const prepareWrite = (
    channel: IStorageChannel,
    key: IStorageKey,
    value: unknown,
    policy?: IConflictPolicy
  ): IMemoryRootMutation<void> => {
    /** Caller-owned key segments and record/byte values detach before waiting can begin. */
    const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
    /** A clone failure cannot remove a displaced row or acquire a logical key. */
    const prepared = prepare(channel, value, captured)
    /** Byte-domain admission precedes every possible displaced channel or draft mutation. */
    const bytes = entryBytes(channel, prepared)
    return {
      keys: mutationKeys(channel, captured, policy),
      capacityChanges:
        capacity === undefined
          ? undefined
          : () => {
              /** Only the same logical key's original conflict channels participate in replacement. */
              const changes: IMemoryCapacityChange[] =
                policy === 'replace'
                  ? MemoryState.channels
                      .filter((current) => current !== channel)
                      .map((current) => capacityFact(current, captured))
                  : []
              changes.push(capacityFact(channel, captured, bytes))
              return changes
            },
      invoke: (draft) => draft.write(channel, captured, prepared, policy ?? 'conflict'),
      run: () => write(channel, captured, prepared, policy, bytes)
    }
  }
  /** Root writes reuse the original execution list, policy loop, member lease and lock provider. */
  const mutationEntry = <I, R>(
    operation: string,
    input: I,
    ctx: IWriteOptions | undefined,
    prepareMutation: (captured: I, context: IOperationContextSnapshot) => IMemoryRootMutation<R>,
    journaled = true
  ): Promise<R> => {
    /** Original metadata/drop operations must not recursively journal their own invalidation. */
    const selectedJournal = journaled ? core.journal : undefined
    /** Pipeline intervention fixes this input before the original loop derives affected keys. */
    let capturedInput = input
    /** The sole derivation captures inputs and affected keys once, before any native attempt. */
    let mutation!: IMemoryRootMutation<R>
    /** The last readonly preflight is consumed immediately by the same native synchronous terminal. */
    let capacityPlan: ReturnType<typeof planCapacity>
    /** Only this selected native attempt's real victim identities enter the original lock provider. */
    let capacityIdentities: readonly string[] = []
    /** Preparation is accepted work of this original controller, including close races. */
    const preparing = selectedJournal === undefined ? undefined : controller.beginMutation()
    const pending = runWithConcurrency<R>(
      {
        store: base,
        options: ctx === undefined ? {} : ctx,
        prepare: selectedJournal === undefined ? undefined : () => selectedJournal!.prepare(),
        execute: (context, invoke) =>
          core.execution.run(
            {
              operation,
              input,
              ctx: context,
              keys: () => mutation?.keys ?? [],
              internal: journaled ? undefined : true
            },
            (captured) => {
              controller.assertLive()
              /** Direct closure retains accepted work until queued/native admission truly finishes. */
              const release = controller.beginMutation()
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
            return locks.attempt(
              attempt,
              holding(),
              {
                attempt: () =>
                  transact(
                    (_scope, draft) => mutation.invoke!(draft),
                    attempt,
                    mutation.ranges,
                    (identities) => {
                      capacityIdentities = identities
                    }
                  )
              },
              core.stageBindings.concurrencyStages(store),
              controller.closingSignal,
              mutation.ranges,
              capacity === undefined ? undefined : () => capacityIdentities
            )
          }
          return locks.attemptWrite(
            attempt,
            holding(),
            () => commitCapacity(capacityPlan, mutation.run),
            core.stageBindings.concurrencyStages(store),
            controller.closingSignal,
            mutation.ranges,
            undefined,
            capacity === undefined
              ? undefined
              : () => {
                  capacityPlan =
                    mutation.capacityChanges === undefined
                      ? undefined
                      : planCapacity(mutation.capacityChanges())
                  return capacityPlan?.identities ?? []
                }
          )
        }
      }
    )
    return preparing === undefined ? pending : pending.finally(preparing)
  }
  /** All-channel clearing retains its original one coarse event after one synchronous merge. */
  const clearAll = (notify = true): void => {
    controller.assertLive()
    /** Empty physical channels still advance epochs without manufacturing change notifications. */
    const changed = blobs.size !== 0 || physicalChannels.some((channel) => data[channel].size !== 0)
    for (const channel of physicalChannels) {
      data[channel].clear()
      ordered[channel].clear()
      revisions.clear(channel === 'value' ? 'text' : channel)
    }
    deadlines.clear()
    expiring?.clear()
    capacityIndex?.clear()
    rdfIndex.clear()
    blobs.clear()
    if (changed && notify) controller.publish({ channel: 'all', kind: 'clear', orgId })
  }
  /** Channel selection is captured before the shared provider's final synchronous range check. */
  const clearEntry = (
    operation: string,
    channel: IStorageChannel | undefined,
    ctx: IWriteOptions | undefined
  ): Promise<void> =>
    mutationEntry(operation, channel, ctx, (captured) => ({
      keys: [],
      ranges: mutationRanges(captured === undefined ? physicalChannels : [captured]),
      invoke: (draft) => draft.clear(captured),
      run: () => (captured === undefined ? clearAll() : clear(captured))
    }))

  /** One existing runner owns every asynchronous public endpoint. */
  const asyncEntry = <I, R>(
    operation: string,
    input: I,
    ctx: IOperationContext | undefined,
    run: (captured: I) => R,
    keys?: (captured: I) => readonly ILockKey[]
  ): Promise<R> => {
    /** The original pipeline's actual captured input is read only if telemetry requests keys. */
    let current = input
    const invoke = (captured: I) => {
      current = captured
      return run(captured)
    }
    const describeKeys = () => keys?.(current) ?? []
    if (core.journal === undefined)
      return core.execution.run({ operation, input, ctx, keys: describeKeys }, (captured) =>
        withAbort(ctx, async () => invoke(captured))
      )
    /** The original controller drains lazy org preparation before its native cleanup can finish. */
    const release = controller.beginMutation()
    return runWithConcurrency<R>(
      {
        store: base,
        options: ctx ?? {},
        prepare: () => core.journal!.prepare()
      },
      {
        attempt: async (context) => ({
          status: 'committed',
          value: await core.execution.run(
            { operation, input, ctx: context, keys: describeKeys },
            (captured) => withAbort(context, async () => invoke(captured))
          )
        })
      }
    ).finally(release)
  }

  /** Native feeds share one original subscription bridge and the backend's per-next pipeline. */
  function watchChanges(
    channel: IStorageChange['channel'],
    ctx: IOperationContext | undefined,
    key?: string
  ): IStorageIterator<IStorageChange> {
    return createBackendChangeIterator(controller, {
      orgId,
      channel,
      key,
      ctx,
      execute: (advance, context) =>
        core.execution.run({ operation: MemoryOperation.watch, input: key, ctx: context }, advance)
    })
  }

  /** New root batch admission keeps borrowed accessor failures on the contract error chain. */
  const captureBatch = <R>(capture: () => R): R => {
    try {
      return capture()
    } catch (cause) {
      if (isStorageErrorFamily(cause)) throw cause
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend: STORAGE_MEMORY_BACKEND,
        cause
      })
    }
  }
  /** Empty batches have no pipeline or native transaction, while resource expiry still applies. */
  const batchSize = (input: readonly unknown[]): number => {
    controller.assertLive()
    return captureBatch(() => {
      if (!Array.isArray(input))
        throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
          backend: STORAGE_MEMORY_BACKEND
        })
      return input.length
    })
  }
  /** One high-level batch reports one observation without exposing per-key native work. */
  const observeBatch = <R>(
    operation: string,
    count: number | undefined,
    invoke: () => R | Promise<R>,
    scope?: IMemoryScope<T>
  ): Promise<R> => {
    /** Observation remains on the original registration and authentic transaction view. */
    const root = core.stageBindings.operationStages(store)
    /** A scoped observer captures its real transaction identity before that view expires. */
    const stages = scope === undefined ? root : root.forTransaction(scope)
    return observeStorageBatch(stages, scheduler, operation, count, invoke)
  }
  /** Both root and scoped batches capture the same keys and reject duplicates before staging. */
  const captureTextEntries = (
    entries: Parameters<ITransactionKeyValueApi['setMany']>[0]
  ): readonly IMemoryTextEntry[] => {
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
      return { key: fact.key, value: prepare('value', entry.value, fact.key) as string, ttlMs }
    })
  }
  /** Every duplicate position reuses its first result in both native root and scoped snapshots. */
  const readTextBatch = (
    keys: readonly IStorageKey[],
    readValue: (key: IStorageKey) => string | undefined
  ): Array<string | undefined> => {
    /** The canonical owner alone validates keys and records their first positions. */
    const captured = snapshotStorageBatchKeys(keys, STORAGE_MEMORY_BACKEND)
    /** Positions are retained without a second identity map or a repeated native read. */
    const values: Array<string | undefined> = []
    for (const [index, fact] of captured.entries())
      values.push(fact.firstIndex === index ? readValue(fact.key) : values[fact.firstIndex])
    return values
  }
  /** Public transactions and native batches use one original loop, pipeline and attempt owner. */
  const atomicEntry = <I, R>(
    operation: string,
    input: (context: IOperationContextSnapshot) => I,
    ctx: ITransactionOptions | undefined,
    prepare: (captured: I, admit: () => void) => IMemoryAtomicWork<T, R>,
    journaled = true
  ): Promise<Awaited<R>> => {
    /** Private metadata work keeps its original draft and never recursively journals itself. */
    const selectedJournal = journaled ? core.journal : undefined
    /** One accepted lifetime spans every real attempt and all original pipeline settlement. */
    let release: (() => void) | undefined
    /** The existing lease admits once, including the original callback-capture boundary. */
    const admit = (): void => {
      release ??= controller.beginMutation()
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
          store: base,
          options: ctx === undefined ? {} : ctx,
          prepare: selectedJournal === undefined ? undefined : () => selectedJournal.prepare(),
          executeAttempt: (context, invoke) =>
            core.execution.run(
              { operation, input: input(context), ctx: context, internal: true },
              (captured) => {
                controller.assertLive()
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
            locks.attempt(
              attempt,
              holding(),
              {
                attempt: () =>
                  transact(
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
              core.stageBindings.concurrencyStages(store),
              controller.closingSignal,
              work.ranges,
              capacity === undefined ? undefined : () => capacityIdentities
            )
        }
      ).finally(() => release?.())
    return core.execution.observe === undefined
      ? execute()
      : core.execution.observe(
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
  const base: IMemoryBase<T> = {
    backend: STORAGE_MEMORY_BACKEND,
    capabilities: Object.freeze({
      syncRead: true,
      binary: true,
      records: true,
      transactions: true,
      iteration: true,
      secondaryIndexes: false,
      changeFeed: true,
      maxValueBytes: undefined,
      opaqueEntries: false
    }),
    sync: {
      get: (key) =>
        core.execution.runSync({ operation: MemoryOperation.get, input: key }, (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return (read('value', captured) as string | undefined) ?? null
        }),
      set: (key, value, options) =>
        core.execution.runSync(
          { operation: MemoryOperation.set, input: { key, value, options } },
          (captured) => {
            assertStringStorageKey(captured.key, STORAGE_MEMORY_BACKEND)
            /** Sync policy capture never calls the asynchronous concurrency callback. */
            const options = snapshotSyncWriteOptions(captured.options)
            /** Payload preparation precedes the final active-key probe. */
            const mutation = prepareWrite(
              'value',
              captured.key,
              captured.value,
              options.conflictPolicy
            )
            assertUnlocked(mutation.keys)
            /**
             * Synchronous writes share exact victim planning but reject a busy victim without
             * waiting.
             */
            const plan =
              mutation.capacityChanges === undefined
                ? undefined
                : planCapacity(mutation.capacityChanges())
            const held = plan === undefined ? undefined : locks.probe(plan.identities)
            if (held !== undefined)
              throw new StorageContractError(StorageContractErrorCode.lockRejected, {
                backend: STORAGE_MEMORY_BACKEND,
                keys: [held.key],
                holder: held.holder
              })
            commitCapacity(plan, mutation.run)
          }
        ),
      remove: (key) =>
        core.execution.runSync({ operation: MemoryOperation.remove, input: key }, (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          assertUnlocked([lockKey.text(captured)])
          remove('value', captured)
        }),
      has: (key) =>
        core.execution.runSync({ operation: MemoryOperation.has, input: key }, (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return read('value', captured) !== undefined
        }),
      keys: () =>
        core.execution.runSync({ operation: MemoryOperation.keys, input: undefined }, () => {
          controller.assertLive()
          return [...data.value.entries()]
            .filter(([encoded]) => liveEntry('value', encoded) !== undefined)
            .map(([, entry]) => entry.key)
            .filter((key): key is string => typeof key === 'string')
        }),
      clearValues: () =>
        core.execution.runSync({ operation: MemoryOperation.clearValues, input: undefined }, () => {
          controller.assertLive()
          assertUnlocked([], mutationRanges(['value']))
          clear('value')
        })
    },
    get: (key, ctx) =>
      asyncEntry(
        MemoryOperation.get,
        key,
        ctx,
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return (read('value', captured) as string | undefined) ?? null
        },
        (captured) => [lockKey.text(captured)]
      ),
    set: (key, value, ctx) =>
      mutationEntry(MemoryOperation.set, { key, value }, ctx, (captured, context) => {
        assertStringStorageKey(captured.key, STORAGE_MEMORY_BACKEND)
        return prepareWrite('value', captured.key, captured.value, context.conflictPolicy)
      }),
    remove: (key, ctx) =>
      mutationEntry(MemoryOperation.remove, key, ctx, (captured) => {
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return {
          keys: [lockKey.text(captured)],
          invoke: (draft) => {
            draft.remove('value', captured)
          },
          run: () => remove('value', captured)
        }
      }),
    has: (key, ctx) =>
      asyncEntry(
        MemoryOperation.has,
        key,
        ctx,
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return read('value', captured) !== undefined
        },
        (captured) => [lockKey.text(captured)]
      ),
    keys: (ctx) =>
      asyncEntry(MemoryOperation.keys, undefined, ctx, () => {
        controller.assertLive()
        return [...data.value.entries()]
          .filter(([encoded]) => liveEntry('value', encoded) !== undefined)
          .map(([, entry]) => entry.key)
          .filter((key): key is string => typeof key === 'string')
      }),
    clearValues: (ctx) => clearEntry(MemoryOperation.clearValues, 'value', ctx),
    clearAll: (ctx) => clearEntry(MemoryOperation.clearAll, undefined, ctx),
    getBytes: (key, ctx) =>
      asyncEntry(
        MemoryOperation.getBytes,
        key,
        ctx,
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return (read('bytes', captured) as Uint8Array | undefined) ?? null
        },
        (captured) => [lockKey.bytes(captured)]
      ),
    setBytes: (key, value, ctx) =>
      mutationEntry(MemoryOperation.setBytes, { key, value }, ctx, (captured, context) => {
        assertStringStorageKey(captured.key, STORAGE_MEMORY_BACKEND)
        return prepareWrite('bytes', captured.key, captured.value, context.conflictPolicy)
      }),
    removeBytes: (key, ctx) =>
      mutationEntry(MemoryOperation.removeBytes, key, ctx, (captured) => {
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return {
          keys: [lockKey.bytes(captured)],
          invoke: (draft) => {
            draft.remove('bytes', captured)
          },
          run: () => remove('bytes', captured)
        }
      }),
    clearBytes: (ctx) => clearEntry(MemoryOperation.clearBytes, 'bytes', ctx),
    getRecord: (key, ctx) =>
      asyncEntry(
        MemoryOperation.getRecord,
        key,
        ctx,
        (captured) => read('record', captured) as T | undefined,
        (captured) => [lockKey.record(captured)]
      ),
    putRecord: (value, key, ctx) =>
      mutationEntry(MemoryOperation.putRecord, { value, key }, ctx, (captured, context) => {
        /** Generated identity is fixed once for the logical write, including retries and waiting. */
        const resolved = snapshotStorageKey(
          captured.key ?? createStorageToken(),
          STORAGE_MEMORY_BACKEND
        )
        /** The mutation retains the same detached identity that its implicit locks protect. */
        const mutation = prepareWrite('record', resolved, captured.value, context.conflictPolicy)
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
      }),
    deleteRecord: (key, ctx) =>
      mutationEntry(MemoryOperation.deleteRecord, key, ctx, (captured) => {
        /** Mutable record identity detaches before the original policy can wait. */
        const key = snapshotStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return {
          keys: [lockKey.record(key)],
          invoke: (draft) => {
            draft.remove('record', key)
          },
          run: () => remove('record', key)
        }
      }),
    clearRecords: (ctx) => clearEntry(MemoryOperation.clearRecords, 'record', ctx),
    iterateRecords: (range, ctx) => rootIterator(range, ctx),
    transaction: <R>(
      run: (scope: IMemoryScope<T>) => R,
      ctx?: ITransactionOptions
    ): Promise<Awaited<R>> =>
      atomicEntry(
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
    tx: () => createTransactionBuilder(store, undefined, core.getChainMethods('tx')),
    /** Backend construction alone publishes undo; the host never patches a frozen root base. */
    ...(core.journal === undefined
      ? {}
      : {
          undo: async (txId: string, ctx?: IOperationContext) => {
            controller.assertLive()
            /** The existing controller drains accepted image lookup and the actual native commit. */
            const release = controller.beginMutation()
            /**
             * This outer call supplies only the original shared budget; the builder owns all locks,
             * retries, the one pipeline and native data transaction.
             */
            return runWithConcurrency<{ readonly txId: string }>(
              {
                store: base,
                options: ctx === undefined ? {} : ctx,
                prepare: () => core.journal!.prepare()
              },
              {
                attempt: async (context) => ({
                  status: 'committed',
                  value: await core.journal!.undo(txId, (keys, work) =>
                    createTransactionBuilder(store, context, core.getChainMethods('tx'))
                      .lock(keys[0]!, ...keys.slice(1))
                      .run(work)
                  )
                })
              }
            ).finally(release)
          }
        }),
    inspectLocks: (ctx) =>
      asyncEntry(MemoryOperation.inspectLocks, undefined, ctx, () => {
        controller.assertLive()
        return locks.inspectLocks()
      }),
    watch: (key, ctx) => {
      controller.assertLive()
      assertStringStorageKey(key, STORAGE_MEMORY_BACKEND)
      return watchChanges('value', ctx, key)
    },
    subscribeChanges: (listener) => {
      controller.assertLive()
      return controller.subscribe((change) => {
        if (root || change.orgId === orgId) return listener(change)
      })
    },
    dispose: () => controller.dispose(),
    [asyncDisposeKey]: () =>
      (symbolic ??= controller.dispose().catch((error) => reportCleanupError(report, error)))
  }

  /** Bound bytes are independently held and reused for radix localization rather than full scans. */
  function orderedRange(range: IKeyRange | undefined): IOrderedRecordRange {
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
  function physicalRdfPattern(pattern: Readonly<Partial<IQuad>>): Readonly<Partial<IQuad>> {
    return pattern.graph === undefined
      ? pattern
      : { ...pattern, graph: prefixStorageOrgGraph(orgId, pattern.graph) }
  }
  /** Physical graph envelopes never escape a native organization view. */
  function logicalRdfQuad(entry: IMemoryEntry): IQuad {
    /** Native RDF entries own frozen ground terms and an organization-prefixed named graph. */
    const quad = entry.value as IQuad
    return Object.freeze({
      ...quad,
      graph: unprefixStorageOrgGraph(
        orgId,
        quad.graph as Parameters<typeof unprefixStorageOrgGraph>[1]
      )
    })
  }
  /** Full-batch canonical capture finishes before any logical lock or physical mutation. */
  function captureRdfEntries(input: readonly IQuad[]): readonly IMemoryRdfEntry[] {
    return captureBatch(() => {
      if (!Array.isArray(input))
        throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
          backend: STORAGE_MEMORY_BACKEND
        })
      /** Borrowed array bounds are captured once before validating any member or changing data. */
      const length = input.length
      if (!Number.isSafeInteger(length) || length < 0)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
          backend: STORAGE_MEMORY_BACKEND
        })
      /** Duplicate quads share one eventual physical change after every input has been admitted. */
      const entries = new Map<string, IMemoryRdfEntry>()
      for (let index = 0; index < length; index++) {
        /** The contract alone owns ground position rules and detached term identity. */
        const logical = snapshotStorageRdfQuad(input[index]!, STORAGE_MEMORY_BACKEND)
        /** Each namespace stores real organization graphs even though its maps are also isolated. */
        const value = Object.freeze({
          ...logical,
          graph: prefixStorageOrgGraph(orgId, logical.graph)
        })
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
          bytes: entryBytes('rdf', value)
        })
      }
      return [...entries.values()]
    })
  }
  /** Root pattern reads stream only the selected native prefix and retain safe leaf advancement. */
  function* rdfRows(pattern: Readonly<Partial<IQuad>>): IterableIterator<IMemoryEntry> {
    for (const row of rdfIndex.match(physicalRdfPattern(pattern))) {
      capacityIndex?.touch(identity('rdf', row.key as string))
      yield row
    }
  }
  /**
   * Root RDF queries expose truthful pattern access; traversal, sorting and cursors keep their
   * owner.
   */
  function rootRdfQuery(pattern: Partial<IQuad>): ReturnType<IRdfApi['match']> {
    controller.assertLive()
    /** Caller getters detach at construction; native execution later receives this trusted shape. */
    const captured = snapshotStorageRdfPattern(pattern, STORAGE_MEMORY_BACKEND)
    return createRdfQuery(
      {
        asyncDisposeKey,
        cursorSource: store,
        watch: ({ ctx }) => watchChanges('all', ctx),
        mutate: (request, run) =>
          atomicEntry(
            request.operation === 'delete'
              ? MemoryOperation.rdfQueryDelete
              : MemoryOperation.rdfQueryReplace,
            () => ({ ...request }),
            { ...request.ctx, concurrency: request.concurrency },
            (input) => ({ invoke: (scope) => scope[queryDraft].rdf(input, run) })
          ),
        pushdown: {
          source: MemoryState.querySource,
          index: rdfIndex.select(physicalRdfPattern(captured)).name,
          operations: [],
          operators: []
        },
        execute: (input) =>
          nativeIterator(
            MemoryOperation.rdfMatch,
            input.ctx,
            () => rdfRows(input.pattern),
            (row): readonly [IStorageKey, IQuad] => [row.key, logicalRdfQuad(row)]
          )
      },
      captured,
      core.getChainMethods('rdf')
    )
  }

  /** Root scans retain one actual native generator and one cached cleanup path. */
  function rootIterator(
    range: IKeyRange | undefined,
    ctx: IOperationContext | undefined
  ): IStorageIterator<[IStorageKey, T]> {
    /** Bounds capture at construction; data membership and values capture on the first actual next. */
    const captured = orderedRange(range)
    return nativeIterator(
      MemoryOperation.iterateRecords,
      ctx,
      () =>
        [...ordered.record.range(captured)]
          .map((leaf) => {
            const encoded = encodeFlatStorageKey(leaf.value.key)
            const entry = liveEntry('record', encoded)
            if (entry !== undefined) capacityIndex?.touch(identity('record', encoded))
            return entry
          })
          .filter((entry): entry is IMemoryEntry => entry !== undefined),
      (row): [IStorageKey, T] => [clone(row.key), clone(row.value) as T]
    )
  }

  /** Native families reuse this original memory generator and its cached cleanup/signal owner. */
  function nativeIterator<V, R>(
    operation: string,
    ctx: IOperationContext | undefined,
    select: () => Iterable<V>,
    project: (row: V) => R,
    beforeNext?: () => void
  ): IStorageIterator<R> {
    /** This actual iterator alone owns its timeout and caller abort subscriptions. */
    const merged = mergeSignals(ctx, report)
    /** The primary cleanup Promise seals further native advances synchronously. */
    let disposal: Promise<void> | undefined
    /** Symbolic disposal reports once through its separately cached derivative. */
    let symbolic: Promise<void> | undefined
    /** Iterator return shares the same cleanup while retaining its own result Promise. */
    let returned: Promise<IteratorResult<R>> | undefined
    /** The generator supplies serialization of native next/return without another resource queue. */
    const native = (async function* () {
      controller.assertLive()
      throwIfAborted(merged.signal)
      /** Committed values are immutable to callers and snapshot with native membership. */
      const rows = select()
      for (const row of rows) {
        controller.assertLive()
        throwIfAborted(merged.signal)
        yield project(row)
      }
    })()
    /**
     * Explicit return, natural completion and disposal release this same generator and signal
     * owner.
     */
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
          return core.execution.run({ operation, input: undefined, ctx }, async () => {
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
          })
        } catch (cause) {
          return Promise.reject(cause)
        }
      },
      return: (value) => (returned ??= dispose().then(() => ({ done: true, value }))),
      dispose,
      [asyncDisposeKey]: () =>
        (symbolic ??= dispose().catch((error) => reportCleanupError(report, error))),
      [Symbol.asyncIterator]() {
        return this
      }
    }
  }

  /** Execute one isolated native attempt; the contract alone decides policy and retry. */
  async function transact<R>(
    run: (scope: IMemoryScope<T>, draft: IMemoryTextDraft) => R,
    ctx: IConcurrencyAttemptContext,
    protectedRanges?: IMemoryRootMutation<unknown>['ranges'],
    setCapacityIdentities?: (identities: readonly string[]) => void,
    journaled = true,
    observeKeys?: (keys: readonly ILockKey[]) => void
  ): Promise<IConcurrencyAttempt<Awaited<R>>> {
    controller.assertLive()
    throwIfAborted(ctx.signal)
    setCapacityIdentities?.([])
    /** Private log writes and terminal effects belong to this exact original native attempt. */
    let journalDraft: ReturnType<typeof journal.draft> | undefined
    /** Ordinary transactions allocate no private metadata rows or terminal channels until used. */
    const privateJournal = () => (journalDraft ??= journal.draft())
    /** Only touched identities retain draft entries; rollback never rewrites committed maps. */
    const draft = new Map<string, IMemoryDraft>()
    /** Opt-in ordered facts exist only for this authentic attempt, never for ordinary memory work. */
    let journalChanges: Array<Omit<IStorageJournalChange, 'afterRevision'>> | undefined
    /** Only journal-selected policy victims gain draft tombstones before the same final commit. */
    let journalVictims: Set<string> | undefined
    /** The original capacity plan must still select these same rows after asynchronous append. */
    let journalCapacity: ReturnType<typeof planCapacity>
    /** Root clear keeps the original coarse epoch transition, without exposing a new scope method. */
    let clearedChannels: readonly IMemoryChannel[] | undefined
    /** The original all-channel clear publishes one broad event instead of per-channel batches. */
    let clearAllRequested = false
    /** Preserve whether the original physical clear has an event, even if capture prunes expiry. */
    let clearChanged = false
    /** Each channel draft reuses the same compressed radix implementation, including tombstones. */
    const draftOrdered = {
      value: createOrderedRecordIndex<IMemoryDraft>(),
      bytes: createOrderedRecordIndex<IMemoryDraft>(),
      record: createOrderedRecordIndex<IMemoryDraft>(),
      vector: createOrderedRecordIndex<IMemoryDraft>(),
      rdf: createOrderedRecordIndex<IMemoryDraft>()
    }
    /** Proposed RDF entries and tombstones use the same six native permutations. */
    const draftRdfIndex = createMemoryRdfIndex(draftOrdered.rdf)
    /** First reads are repeatable until a write in this attempt replaces their snapshot. */
    const snapshots = new Map<string, IMemorySnapshot | undefined>()
    /** Per-key tombstone revisions detect delete/reinsert and other ABA writes. */
    const expected = new Map<
      string,
      { channel: IMemoryChannel; encoded: string; key: IStorageKey; revision: number }
    >()
    /** A clear invalidates only channels already observed by this native attempt. */
    const snapshotEpochs = new Map<IMemoryChannel, number>()
    /** The original owner retains the first asynchronous operation failure. */
    let failure: (Error & { readonly source: string; readonly code: string }) | undefined
    /** Capture the real revision once, before any draft read or write. */
    const track = (channel: IMemoryChannel, encoded: string, key: IStorageKey): string => {
      if (!snapshotEpochs.has(channel))
        snapshotEpochs.set(channel, revisions.epoch(channel === 'value' ? 'text' : channel))
      /** Channel plus original flat key identifies one actual native row. */
      const id = identity(channel, encoded)
      if (!expected.has(id))
        expected.set(id, { channel, encoded, key, revision: revision(channel, encoded) })
      return id
    }
    /** First access captures value, deadline and revision once; later reads retain that snapshot. */
    const txSnapshot = (
      channel: IMemoryChannel,
      encoded: string,
      key: IStorageKey
    ): IMemorySnapshot | undefined => {
      /** Existing observations are never refreshed from a later clock or physical mutation. */
      const id = identity(channel, encoded)
      if (!snapshots.has(id)) {
        /** Expiry removes the physical row before its revision baseline is observed. */
        const current = liveEntry(channel, encoded)
        track(channel, encoded, key)
        snapshots.set(
          id,
          current === undefined
            ? undefined
            : {
                key,
                value: copyValue(channel, current.value, key),
                ordered: current.ordered,
                bytes: current.bytes,
                rdfKeys: current.rdfKeys,
                rdfLock: current.rdfLock,
                deadline: deadlines.get(id)
              }
        )
      }
      return snapshots.get(id)
    }
    /** Read own writes first; otherwise retain the first committed value in this attempt. */
    const txEntry = (channel: IMemoryChannel, key: IStorageKey): IMemorySnapshot | undefined => {
      /** Caller-owned keys detach before contributing to revision or draft identity. */
      const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
      /** Every channel uses the same canonical logical-key wire. */
      const encoded = encodeFlatStorageKey(captured)
      /** A draft row replaces the previous read snapshot immediately. */
      const proposed = draft.get(identity(channel, encoded))
      return proposed
        ? proposed.remove
          ? undefined
          : proposed
        : txSnapshot(channel, encoded, captured)
    }
    /** Every mutable value returned from a retained native snapshot has independent ownership. */
    const txRead = (channel: IMemoryChannel, key: IStorageKey): unknown => {
      /** Membership and an undefined-valued record remain separate facts. */
      const current = txEntry(channel, key)
      if (current !== undefined)
        capacityIndex?.touch(identity(channel, encodeFlatStorageKey(current.key)))
      return current === undefined ? undefined : copyValue(channel, current.value, current.key)
    }
    /** Membership shares the same first snapshot, including undefined-valued records. */
    const txHas = (channel: IMemoryChannel, encoded: string, key: IStorageKey): boolean => {
      /** A tombstone masks physical membership until the attempt commits. */
      const proposed = draft.get(identity(channel, encoded))
      return proposed ? !proposed.remove : txSnapshot(channel, encoded, key) !== undefined
    }
    /** Draft hash and ordered range lookup retain one actual proposed row reference. */
    const stageDraft = (entry: IMemoryDraft, metadataOnly = false): void => {
      captureJournalStage(entry, metadataOnly)
      /** Replacing one draft value keeps its original independently owned key encoding. */
      const proposed = {
        ...entry,
        ordered: draftOrdered[entry.channel].get(entry.ordered)?.key ?? entry.ordered
      }
      draft.set(track(proposed.channel, proposed.encoded, proposed.key), proposed)
      if (proposed.channel === 'rdf') draftRdfIndex.set(proposed.rdfKeys!, proposed)
      else draftOrdered[proposed.channel].set(proposed.ordered, proposed)
    }
    /** Prepare first, then stage eviction and put atomically within this native draft. */
    const txWrite = (
      channel: IStorageChannel,
      key: IStorageKey,
      value: unknown,
      policy: IConflictPolicy,
      ttlMs?: number
    ): void => {
      /** Preparation can reject before any prior channel loses draft membership. */
      const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
      /** One logical-key encoding serves all affected channels. */
      const encoded = encodeFlatStorageKey(captured)
      /** Clone caller-owned payload before mutating the draft. */
      const prepared = prepare(channel, value, captured)
      /** Explicit byte-domain failure happens before staging any replacement or native victim. */
      const bytes = entryBytes(channel, prepared)
      /** Channel conflict semantics are owned by the same shared plan as root writes. */
      const existing = new Set(
        MemoryState.channels.filter((current) => txHas(current, encoded, captured))
      )
      /** The canonical plan retains eviction order and the existing duplicate-key diagnostic. */
      const plan = planChannelWrite(captured, channel, existing, policy, STORAGE_MEMORY_BACKEND)
      /** Encode this logical key once for all affected channel draft entries. */
      const keyBytes = encodeOrderedStorageKey(captured, STORAGE_MEMORY_BACKEND)
      for (const previous of plan.remove)
        stageDraft({
          channel: previous,
          key: captured,
          value: undefined,
          remove: true,
          encoded,
          ordered: keyBytes
        })
      /** Overwriting a live row retains its deadline unless this batch supplies a new duration. */
      const current = txEntry(channel, captured)
      stageDraft({
        channel,
        key: captured,
        value: prepared,
        bytes,
        remove: false,
        encoded,
        ordered: keyBytes,
        deadline: ttlMs === undefined ? current?.deadline : scheduler.now() + ttlMs
      })
    }
    /** Delete returns actual draft membership, so repeated keys count at most once. */
    const txRemove = (channel: IStorageChannel | 'vector', key: IStorageKey): boolean => {
      /** Delete keys follow the same detached canonical domain as reads and writes. */
      const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
      /** One encoding serves membership and the resulting tombstone. */
      const encoded = encodeFlatStorageKey(captured)
      if (!txHas(channel, encoded, captured)) return false
      /** Existing physical or proposed membership already owns this exact ordered identity. */
      const current =
        draft.get(identity(channel, encoded)) ?? txSnapshot(channel, encoded, captured)!
      stageDraft({
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
    const txRows = (channel: IStorageChannel, range?: IOrderedRecordRange): IMemoryEntry[] => {
      if (!snapshotEpochs.has(channel))
        snapshotEpochs.set(channel, revisions.epoch(channel === 'value' ? 'text' : channel))
      /**
       * Independent owner iterators begin at the same lower bound, without scanning other draft
       * keys.
       */
      const physical = ordered[channel].range(range)
      const proposed = draftOrdered[channel].range(range)
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
          const current = txSnapshot(channel, encodeFlatStorageKey(row.key), row.key)
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
    const txRdfWrite = (input: readonly IQuad[], remove: boolean): void => {
      /** Admission of the entire batch precedes even the first draft tombstone. */
      const entries = captureRdfEntries(input)
      for (const entry of entries) {
        /** Draft and first-read membership share the original channel identity. */
        const id = identity('rdf', entry.encoded)
        /** Own writes mask physical membership without introducing another transaction owner. */
        const proposed = draft.get(id)
        /** The original first-read owner records even absence for ABA conflict checks. */
        const current = proposed
          ? proposed.remove
            ? undefined
            : proposed
          : txSnapshot('rdf', entry.encoded, entry.key)
        if (remove ? current === undefined : current !== undefined) continue
        stageDraft({ ...entry, channel: 'rdf', remove })
      }
    }
    /** Physical and proposed prefix scans merge by identity without materializing complete results. */
    function* txRdfRows(pattern: Readonly<Partial<IQuad>>): IterableIterator<IMemoryEntry> {
      if (!snapshotEpochs.has('rdf')) snapshotEpochs.set('rdf', revisions.epoch('rdf'))
      /** Both trees receive one identical bound graph envelope and access-path choice. */
      const physical = physicalRdfPattern(pattern)
      for (const row of rdfIndex.match(physical)) {
        /** The original physical key remains a string even for a large literal. */
        const encoded = row.key as string
        if (draft.has(identity('rdf', encoded))) continue
        /** Repeat reads retain the first physical snapshot and original revision. */
        const current = txSnapshot('rdf', encoded, row.key)
        if (current !== undefined) {
          capacityIndex?.touch(identity('rdf', encoded))
          yield current
        }
      }
      for (const row of draftRdfIndex.match(physical)) if (!row.remove) yield row
    }
    /** The original transaction owner admits each native advance and closes the actual generator. */
    function rdfQuery(
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
            index: rdfIndex.select(physicalRdfPattern(captured)).name,
            operations: [],
            operators: []
          },
          execute: (input) => {
            /** This actual generator, including client traversal children, has one native owner. */
            const iterator = (async function* () {
              for (const row of txRdfRows(input.pattern)) {
                controller.assertLive()
                throwIfAborted(ctx.signal)
                yield [row.key, logicalRdfQuad(row)] as const
              }
            })()
            return owner.registerIterator(input.operationScope ?? scope, {
              next: (current) =>
                core.execution.run(
                  {
                    operation: MemoryOperation.rdfMatch,
                    input: input.pattern,
                    scope: current,
                    ctx
                  },
                  () => iterator.next()
                ),
              close: async () => {
                await iterator.return(undefined)
              }
            })
          }
        },
        captured,
        core.getChainMethods('rdf')
      )
    }
    /** Query selection borrows the original iterator owner without a second operation pipeline. */
    function queryIterator<V>(
      scope: ITransactionScope<T>,
      rows: () => Iterable<readonly [IStorageKey, V]>
    ): IStorageIterator<readonly [IStorageKey, V]> {
      assertTransactionOwner(store, scope)
      /** The actual generator is drained and closed by this existing native transaction owner. */
      const iterator = (async function* () {
        for (const row of rows()) {
          controller.assertLive()
          throwIfAborted(ctx.signal)
          yield row
        }
      })()
      return owner.registerIterator(scope, {
        next: () => iterator.next(),
        close: async () => {
          await iterator.return(undefined)
        }
      })
    }
    /** A vector write attempt streams native candidates while retaining the original read set. */
    function* txVectorPoints<P>(collection: string): IterableIterator<IStorageVectorPoint<P>> {
      if (!snapshotEpochs.has('vector')) snapshotEpochs.set('vector', revisions.epoch('vector'))
      /** Physical and proposed rows use the same canonical collection tuple prefix. */
      const bounds = snapshotStorageKeyPrefix([collection], STORAGE_MEMORY_BACKEND)
      let leaf = ordered.vector.lowerBound(bounds.lower)
      while (leaf !== undefined && compareRecordIndexKeys(leaf.key, bounds.upper) < 0) {
        /** Expiry can unlink this row before the generator advances again. */
        const next = leaf.next
        const key = leaf.value.key
        const encoded = encodeFlatStorageKey(key)
        if (!draft.has(identity('vector', encoded))) {
          const current = txSnapshot('vector', encoded, key)
          if (current !== undefined) yield current.value as IStorageVectorPoint<P>
        }
        leaf = next
      }
      for (const row of draftOrdered.vector.range({
        lower: bounds.lower,
        upper: bounds.upper,
        upperOpen: true
      }))
        if (!row.value.remove) yield row.value.value as IStorageVectorPoint<P>
    }
    /** Native text batches stage only into this attempt's existing draft and revision baseline. */
    const textDraft: IMemoryTextDraft = {
      write: txWrite,
      remove: txRemove,
      clear: (channel) => {
        /** Blob has no shared image target, so an all-channel clear must not silently delete it. */
        if (channel === undefined && blobs.size !== 0)
          throw new StorageContractError(StorageContractErrorCode.unsupported)
        clearedChannels = channel === undefined ? physicalChannels : [channel]
        clearAllRequested = channel === undefined
        clearChanged = clearedChannels.some((current) => data[current].size !== 0)
        for (const current of clearedChannels) {
          if (!snapshotEpochs.has(current))
            snapshotEpochs.set(current, revisions.epoch(current === 'value' ? 'text' : current))
          /** Native Map iteration advances safely when the original TTL owner prunes an entry. */
          for (const [encoded, entry] of data[current]) {
            const snapshot = txSnapshot(current, encoded, entry.key)
            if (snapshot !== undefined)
              stageDraft({ ...snapshot, channel: current, encoded, remove: true })
          }
        }
      },
      ttl: (target, ms, persist) => txTtl(target, ms, persist),
      increment: (key, increment) => {
        const result = increment(txRead('value', key) as string | undefined)
        txWrite('value', key, String(result), 'conflict')
        return result
      },
      upsertVector: (collection, points, sizes, ttlMs) => {
        /** Captured vector inputs enter the existing native draft without a second public pipeline. */
        const now = scheduler.now()
        for (const [index, point] of points.entries()) {
          const key = vectorKey(collection, point.id)
          const encoded = encodeFlatStorageKey(key)
          const current = txEntry('vector', key)
          const deadline = ttlMs === undefined ? current?.deadline : now + ttlMs
          if (deadline !== undefined && deadline <= now) {
            txRemove('vector', key)
            continue
          }
          stageDraft({
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
        for (const point of txVectorPoints(collection))
          if (predicate(point) && txRemove('vector', vectorKey(collection, point.id))) count++
        return count
      },
      rdf: txRdfWrite,
      setMany: (entries) => {
        for (const entry of entries)
          txWrite('value', entry.key, entry.value, 'conflict', entry.ttlMs)
      },
      removeMany: (keys) => {
        /** Duplicate identities can only remove the first still-present draft entry. */
        let count = 0
        for (const key of keys) if (txRemove('value', key)) count++
        return count
      },
      removeByPrefix: (prefix, channel = 'value') => {
        /** Native prefix localization reuses the original canonical bounds and ordered draft merge. */
        const captured = snapshotStorageKeyPrefix(prefix, STORAGE_MEMORY_BACKEND)
        /** Count only actual removals in this channel and this native attempt. */
        let count = 0
        for (const row of txRows(channel, {
          lower: captured.lower,
          upper: captured.upper,
          upperOpen: true
        }))
          if (captured.matches(row.key) && txRemove(channel, row.key)) count++
        return count
      }
    }
    /** TTL metadata changes stage beside the original value and never create a second draft. */
    const txTtl = (target: IMemoryTtlTarget, ms: number | undefined, persist: boolean): boolean => {
      /** A TTL target has already been captured by the original contract lock owner. */
      const channel = ttlChannel(target)
      const current = txEntry(channel, ttlKey(target))
      if (current === undefined || (persist && current.deadline === undefined)) return false
      stageDraft(
        {
          ...current,
          channel,
          encoded: encodeFlatStorageKey(current.key),
          remove: ms === 0,
          deadline: persist ? undefined : scheduler.now() + ms!
        },
        true
      )
      return true
    }
    /** Remaining duration observes the same retained transaction value and captured deadline. */
    const txRemaining = (target: IMemoryTtlTarget): number | undefined => {
      /** Missing and unlimited rows share the documented undefined result. */
      const current = txEntry(ttlChannel(target), ttlKey(target))
      return current?.deadline === undefined
        ? undefined
        : Math.max(0, current.deadline - scheduler.now())
    }
    /** Resolve logical journal identities through this exact org's existing physical key mapping. */
    const journalRow = (input: IStorageJournalTarget) => {
      const captured = snapshotMemoryJournalTarget(input)
      const target = captured.lock
      const channel: IMemoryChannel = target.channel === 'text' ? 'value' : target.channel
      const key =
        target.channel === 'rdf'
          ? captureRdfEntries([target.quad])[0]!.key
          : target.channel === 'vector'
            ? vectorKey(target.collection, target.id)
            : target.key
      const encoded = target.channel === 'rdf' ? (key as string) : encodeFlatStorageKey(key)
      const proposed = draft.get(identity(channel, encoded))
      const current =
        target.channel === 'rdf'
          ? proposed
            ? proposed.remove
              ? undefined
              : proposed
            : txSnapshot(channel, encoded, key)
          : txEntry(channel, key)
      return { ...captured, channel, key, encoded, current }
    }
    /** Images observe the same draft and deadline as this native transaction's final physical row. */
    const readJournalImage = (input: IStorageJournalTarget): IStorageJournalImage => {
      const row = journalRow(input)
      const current = row.current
      const present =
        current !== undefined &&
        (current.deadline === undefined || current.deadline > scheduler.now())
      return row.metadata
        ? encodeStorageJournalImage(present && current!.deadline !== undefined, current?.deadline)
        : encodeStorageJournalImage(
            present,
            row.channel === 'rdf' ? true : current?.value,
            row.channel === 'bytes'
          )
    }
    /** Restore through original staging, cloning, channel-conflict, TTL and RDF admission owners. */
    const writeJournalImage = (input: IStorageJournalTarget, image: IStorageJournalImage): void => {
      const row = journalRow(input)
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
          {
            ...row.current,
            channel: row.channel,
            encoded: row.encoded,
            remove: value !== undefined && value <= scheduler.now(),
            deadline: value as number | undefined
          },
          true
        )
        return
      }
      if (row.lock.channel === 'rdf') {
        if (captured.present && value !== true)
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        txRdfWrite([row.lock.quad], !captured.present)
        return
      }
      if (!captured.present) {
        txRemove(row.channel as IStorageChannel | 'vector', row.key)
        return
      }
      if (row.lock.channel === 'vector') {
        const configuration = vectorCollections.get(row.lock.collection)
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
        stageDraft({
          channel: 'vector',
          key: row.key,
          encoded: row.encoded,
          ordered: row.current?.ordered ?? encodeOrderedStorageKey(row.key, STORAGE_MEMORY_BACKEND),
          value: point,
          bytes: entryBytes('vector', point),
          remove: false,
          deadline: row.current?.deadline
        })
        return
      }
      txWrite(row.channel as IStorageChannel, row.key, value, 'replace')
    }
    /** Full revisions include the original clear generation and the final draft's tombstone effect. */
    const readJournalRevision = (input: IStorageJournalTarget) => {
      const row = journalRow(input)
      const id = identity(row.channel, row.encoded)
      const proposed = draft.get(id)
      const removes =
        proposed?.remove === true ||
        (proposed?.deadline !== undefined && proposed.deadline <= scheduler.now())
      const changed = proposed !== undefined && (!removes || snapshots.get(id) !== undefined)
      if (clearedChannels?.includes(row.channel))
        return Object.freeze({ epoch: snapshotEpochs.get(row.channel)! + 1, revision: 0 })
      return Object.freeze({
        epoch: snapshotEpochs.get(row.channel)!,
        revision: expected.get(id)!.revision + (changed ? 1 : 0)
      })
    }
    /** Capture each actual native staging step before it changes this attempt's existing draft. */
    const captureJournalStage = (entry: IMemoryDraft, metadataOnly: boolean): void => {
      if (journalChanges === undefined) return
      const id = identity(entry.channel, entry.encoded)
      const previous = draft.get(id)
      const before = previous
        ? previous.remove
          ? undefined
          : previous
        : txSnapshot(entry.channel, entry.encoded, entry.key)
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
          proposed.push(Object.freeze({ target, before: beforeImage, after: afterImage }))
      }
      if (target.channel !== 'rdf' && before?.deadline !== after?.deadline)
        proposed.push(
          Object.freeze({
            target: memoryJournalDeadlineTarget(target),
            before: encodeStorageJournalImage(before?.deadline !== undefined, before?.deadline),
            after: encodeStorageJournalImage(after?.deadline !== undefined, after?.deadline)
          })
        )
      journalChanges.push(...proposed)
    }
    /**
     * Begin capture before the first write, then return detached ordered facts with final
     * revisions.
     */
    const changes = (): readonly IStorageJournalChange[] => {
      if (journalChanges === undefined) {
        if (draft.size !== 0) throw new StorageContractError(StorageContractErrorCode.unsupported)
        journalChanges = []
      }
      const result: IStorageJournalChange[] = []
      for (const change of journalChanges) {
        const row = journalRow(change.target)
        const afterRevision = readJournalRevision(change.target)
        /** A new row removed again leaves no physical mutation or storage.commit to describe. */
        if (afterRevision.revision === expected.get(identity(row.channel, row.encoded))!.revision)
          continue
        result.push(Object.freeze({ ...change, afterRevision }))
      }
      return Object.freeze(result)
    }
    /** The same physical scope factory serves callbacks, nested operations and final checks. */
    const createScope = (): IMemoryScope<T> => {
      /** Each method closes over its own authentic view, never an independently registered guard. */
      const scope: IMemoryScope<T> = {
        [journalOperations]: {
          changes: () => {
            assertTransactionOwner(store, scope)
            return changes()
          },
          readImage: (target) => runTransactionOperation(scope, () => readJournalImage(target)),
          writeImage: (target, image) =>
            runTransactionOperation(scope, () => writeJournalImage(target, image)),
          readRevision: (target) =>
            runTransactionOperation(scope, () => readJournalRevision(target)),
          run: (prefix, work) =>
            runTransactionOperation(scope, (current) =>
              privateJournal().port.run(prefix, work, (run) =>
                runTransactionOperation(current, run)
              )
            ),
          onCommit: (effect) => {
            assertTransactionOwner(store, scope)
            return privateJournal().port.onCommit(effect)
          },
          onRollback: (effect) => {
            assertTransactionOwner(store, scope)
            return privateJournal().port.onRollback(effect)
          }
        },
        [queryDraft]: {
          record: (request, run) => {
            assertTransactionOwner(store, scope)
            /** Pipeline-provided patches detach once before selection can touch any draft row. */
            const patch = request.operation === 'update' ? clone(request.patch) : undefined
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
                queryIterator(scope, function* () {
                  for (const row of txRows('record'))
                    yield [clone(row.key), copyValue('record', row.value, row.key)] as const
                }),
              accept: (key) => {
                assertTransactionOwner(store, scope)
                if (request.operation === 'delete') return txRemove('record', key)
                /** Query projections never become replacement values; patch the actual draft row. */
                const current = txEntry('record', key)
                if (current === undefined) return false
                if (typeof current.value !== 'object' || current.value === null)
                  throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
                    backend: STORAGE_MEMORY_BACKEND
                  })
                /** Existing native cloning preserves Date/Map values admitted by memory. */
                const value = clone(current.value, key)
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
                txWrite('record', key, value, 'replace')
                return true
              }
            })
          },
          rdf: (request, run) => {
            assertTransactionOwner(store, scope)
            /** Replacement admission precedes selection or any draft tombstone. */
            const replacement =
              request.operation === 'replace' ? captureRdfEntries([request.newQuad])[0] : undefined
            return run({
              execute: (input) =>
                queryIterator(scope, function* () {
                  for (const row of txRdfRows(input.pattern))
                    yield [row.key, logicalRdfQuad(row)] as const
                }),
              accept: (_key, quad) => {
                assertTransactionOwner(store, scope)
                /**
                 * The original physical identity resolves actual draft membership and no-op
                 * replacement.
                 */
                const entry = captureRdfEntries([quad])[0]!
                const proposed = draft.get(identity('rdf', entry.encoded))
                const current = proposed
                  ? proposed.remove
                    ? undefined
                    : proposed
                  : txSnapshot('rdf', entry.encoded, entry.key)
                if (current === undefined || replacement?.encoded === entry.encoded) return false
                txRdfWrite([quad], true)
                if (replacement !== undefined) txRdfWrite([logicalRdfQuad(replacement)], false)
                return true
              }
            })
          },
          vector: <P>(
            collection: string,
            _request: IQueryDelete,
            run: Parameters<NonNullable<IVectorQuerySource<P>['mutate']>>[1],
            select: IMemoryVectorSelection<P>
          ) => {
            assertTransactionOwner(store, scope)
            return run({
              execute: (input) =>
                queryIterator(scope, () =>
                  select(
                    input,
                    txVectorPoints<P>(collection),
                    (id) =>
                      txRead('vector', vectorKey(collection, id)) as
                        | IStorageVectorPoint<P>
                        | undefined
                  )
                ),
              accept: (_key, hit) => {
                assertTransactionOwner(store, scope)
                return txRemove('vector', vectorKey(collection, hit.id))
              }
            })
          }
        },
        [recordQueries]: <R>() =>
          createRecordQuery<R>(
            {
              asyncDisposeKey,
              cursorSource: scope,
              pushdown: { source: MemoryState.querySource, operations: [], operators: [] },
              execute: () => scope.iterateRecords(),
              mutate: (request, run) =>
                operation(
                  request.operation === 'delete'
                    ? MemoryOperation.recordQueryDelete
                    : MemoryOperation.recordQueryUpdate,
                  request,
                  (captured) => scope[queryDraft].record(captured, run),
                  true
                )
            },
            core.getChainMethods('query')
          ),
        [ttlOperations]: {
          expire: (target, ms) =>
            acceptedOperation(
              MemoryOperation.ttlExpire,
              { target, ms },
              (input) => {
                /** Validation stays inside the one operation already admitted by tx.use(ttl). */
                const target = captureTtlTarget(input.target)
                /** Preserve this pipeline-provided duration while the native operation settles. */
                const ms = input.ms
                assertStorageTtlDuration(ms, STORAGE_MEMORY_BACKEND)
                return txTtl(target, ms, false)
              },
              scope
            ),
          remaining: (target) =>
            acceptedOperation(
              MemoryOperation.ttlRemaining,
              target,
              (input) => txRemaining(captureTtlTarget(input)),
              scope
            ),
          persist: (target) =>
            acceptedOperation(
              MemoryOperation.ttlPersist,
              target,
              (input) => txTtl(captureTtlTarget(input), undefined, true),
              scope
            )
        },
        [counterOperations]: {
          increment: (key, by) =>
            acceptedOperation(
              MemoryOperation.counterIncrement,
              { key, by },
              (input) => {
                /** Snapshot pipeline-provided identity before any native text access. */
                const key = input.key
                assertStringStorageKey(key, STORAGE_MEMORY_BACKEND)
                /** The pure contract calculation runs against this native text draft only. */
                const increment = snapshotStorageCounterIncrement(input.by, STORAGE_MEMORY_BACKEND)
                const result = increment(txRead('value', key) as string | undefined)
                txWrite('value', key, String(result), 'conflict')
                return result
              },
              scope
            )
        },
        [rdfOperations]: {
          add: (quads) =>
            acceptedOperation(
              MemoryOperation.rdfAdd,
              quads,
              (input) => txRdfWrite(input, false),
              scope
            ),
          delete: (quads) =>
            acceptedOperation(
              MemoryOperation.rdfDelete,
              quads,
              (input) => txRdfWrite(input, true),
              scope
            ),
          match: (pattern) =>
            rdfQuery(pattern, scope, (request, run) =>
              operation(
                request.operation === 'delete'
                  ? MemoryOperation.rdfQueryDelete
                  : MemoryOperation.rdfQueryReplace,
                request,
                (captured) => scope[queryDraft].rdf(captured, run),
                true
              )
            )
        },
        [recordPrefix]: (prefix) =>
          operation(MemoryOperation.recordRemoveByPrefix, prefix, (current) => {
            /** Native record prefix deletion uses the same bounded draft merge as record iteration. */
            const captured = snapshotStorageKeyPrefix(current, STORAGE_MEMORY_BACKEND)
            let count = 0
            for (const row of txRows('record', {
              lower: captured.lower,
              upper: captured.upper,
              upperOpen: true
            }))
              if (txRemove('record', row.key)) count++
            return count
          }),
        use: (capability) => useTransactionCapability(scope, capability),
        get: (key) =>
          operation(MemoryOperation.get, key, (current) => {
            assertStringStorageKey(current, STORAGE_MEMORY_BACKEND)
            return (txRead('value', current) as string | undefined) ?? null
          }),
        set: (key, value, options) =>
          operation(MemoryOperation.set, { key, value, options }, (current) => {
            assertStringStorageKey(current.key, STORAGE_MEMORY_BACKEND)
            txWrite(
              'value',
              current.key,
              current.value,
              readTransactionConflictPolicy(current.options, STORAGE_MEMORY_BACKEND)
            )
          }),
        remove: (key) =>
          operation(MemoryOperation.remove, key, (current) => {
            assertStringStorageKey(current, STORAGE_MEMORY_BACKEND)
            txRemove('value', current)
          }),
        has: (key) =>
          operation(MemoryOperation.has, key, (current) => {
            assertStringStorageKey(current, STORAGE_MEMORY_BACKEND)
            return txRead('value', current) !== undefined
          }),
        getMany: (keys) =>
          batchOperation(MemoryOperation.getMany, keys, (current) =>
            readTextBatch(current, (key) => txRead('value', key) as string | undefined)
          ),
        setMany: (entries) =>
          batchOperation(MemoryOperation.setMany, entries, (current) =>
            textDraft.setMany(captureTextEntries(current))
          ),
        removeMany: (keys) =>
          batchOperation(MemoryOperation.removeMany, keys, (current) => {
            /** Validate every key before applying the batch's first tombstone. */
            const captured = snapshotStorageBatchKeys(current, STORAGE_MEMORY_BACKEND)
              .filter(({ firstIndex }, index) => firstIndex === index)
              .map(({ key }) => key)
            return textDraft.removeMany(captured)
          }),
        removeByPrefix: (prefix) =>
          operation(MemoryOperation.removeByPrefix, prefix, (current) =>
            observeBatch(
              MemoryOperation.removeByPrefix,
              undefined,
              () => textDraft.removeByPrefix(current),
              scope
            )
          ),
        getBytes: (key) =>
          operation(MemoryOperation.getBytes, key, (current) => {
            assertStringStorageKey(current, STORAGE_MEMORY_BACKEND)
            return (txRead('bytes', current) as Uint8Array | undefined) ?? null
          }),
        setBytes: (key, value, options) =>
          operation(MemoryOperation.setBytes, { key, value, options }, (current) => {
            assertStringStorageKey(current.key, STORAGE_MEMORY_BACKEND)
            txWrite(
              'bytes',
              current.key,
              current.value,
              readTransactionConflictPolicy(current.options, STORAGE_MEMORY_BACKEND)
            )
          }),
        removeBytes: (key) =>
          operation(MemoryOperation.removeBytes, key, (current) => {
            assertStringStorageKey(current, STORAGE_MEMORY_BACKEND)
            txRemove('bytes', current)
          }),
        getRecord: (key) =>
          operation(
            MemoryOperation.getRecord,
            key,
            (current) => txRead('record', current) as T | undefined
          ),
        putRecord: (value, key, options) =>
          operation(MemoryOperation.putRecord, { value, key, options }, (current) => {
            /** Opaque generated record identities use the existing native entropy helper. */
            const resolved = current.key ?? createStorageToken()
            txWrite(
              'record',
              resolved,
              current.value,
              readTransactionConflictPolicy(current.options, STORAGE_MEMORY_BACKEND)
            )
            return resolved
          }),
        deleteRecord: (key) =>
          operation(MemoryOperation.deleteRecord, key, (current) => {
            txRemove('record', current)
          }),
        iterateRecords: (range) => {
          /** Bounds are captured at construction; native rows are snapshotted at first advance. */
          const captured = orderedRange(range)
          /** The actual native iterator is registered once with the original transaction owner. */
          const iterator = (async function* () {
            /** Snapshot values together with membership on the first actual native advance. */
            const rows = txRows('record', captured).map(
              (row) => [clone(row.key), txRead('record', row.key) as T] as [IStorageKey, T]
            )
            for (const [key, value] of rows) {
              controller.assertLive()
              throwIfAborted(ctx.signal)
              yield [clone(key), clone(value)] as [IStorageKey, T]
            }
          })()
          return owner.registerIterator(scope, {
            next: (current) =>
              core.execution.run(
                {
                  operation: MemoryOperation.iterateRecords,
                  input: undefined,
                  scope: current,
                  ctx
                },
                () => iterator.next()
              ),
            close: async () => {
              await iterator.return(undefined)
            }
          })
        }
      }
      /**
       * One real operation is admitted before its pipeline, stage observations and native draft
       * work.
       */
      function operation<I, V>(
        name: string,
        input: I,
        invoke: (captured: I) => V,
        settle?: true
      ): Promise<Awaited<V>> {
        return runTransactionOperation(scope, (current) =>
          acceptedOperation(name, input, invoke, current, settle)
        )
      }
      /** An already-admitted operation uses the same sole pipeline and native draft body. */
      function acceptedOperation<I, V>(
        name: string,
        input: I,
        invoke: (captured: I) => V,
        current: ITransactionScope,
        settle?: true
      ): Promise<V> {
        return core.execution.run(
          { operation: name, input, scope: current, ctx },
          async (captured) => {
            controller.assertLive()
            throwIfAborted(ctx.signal)
            /** This current scope is authentic for exactly this operation's original lifetime. */
            const stage = core.stageBindings.transactionStages(store).forTransaction(current)
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
      /** Existing scopes retain owner admission for empty batches without entering the pipeline. */
      function batchOperation<I extends readonly unknown[], V>(
        name: string,
        input: I,
        invoke: (captured: I) => V
      ): Promise<Awaited<V>> {
        return runTransactionOperation(scope, (current) => {
          if (batchSize(input) === 0) return invoke(input)
          return acceptedOperation(
            name,
            input,
            (captured) =>
              observeBatch(
                name,
                captureBatch(() => captured.length),
                () => invoke(captured),
                scope
              ),
            current
          )
        })
      }
      /** Feature methods belong to this exact original view, before its owner admission/freeze. */
      const api = core.createTransactionApi(scope)
      if (api !== undefined) Object.defineProperty(scope, 'api', { value: api, enumerable: true })
      return Object.freeze(scope)
    }
    /** Preview the original business draft, excluding only journal's own planned victim facts. */
    const draftCapacityPlan = () =>
      capacity === undefined
        ? undefined
        : planCapacity(
            [...draft.values()]
              .filter(
                (proposed) => !journalVictims?.has(identity(proposed.channel, proposed.encoded))
              )
              .map((proposed) =>
                capacityFact(
                  proposed.channel,
                  proposed.key,
                  proposed.remove ||
                    (proposed.deadline !== undefined && proposed.deadline <= scheduler.now())
                    ? undefined
                    : (proposed.bytes ?? 0),
                  proposed.rdfLock
                )
              )
          )
    /** The initial callback view is created and registered by the original owner exactly once. */
    const scope = createScope()
    /** Original registration authenticates this same scope before any journal capture is enabled. */
    let journalAttempt: ReturnType<NonNullable<IStoragePluginCore['journal']>['begin']>
    /** Final checks receive fresh complete native views under the same transaction identity. */
    const control = owner.register(scope, {
      context: ctx,
      createScope,
      onFailure: (error) => {
        failure ??= error
      },
      beforeCommit: (current) => {
        controller.assertLive()
        throwIfAborted(ctx.signal)
        void core.stageBindings.transactionStages(store).forTransaction(current).beforeCommit?.()
        if (journalAttempt === undefined) return
        journalCapacity = draftCapacityPlan()
        for (const victim of journalCapacity?.victims ?? []) {
          /** Blob has no shared transaction target; never fabricate a logical blob lock/image. */
          if (victim.channel === 'blob')
            throw new StorageContractError(StorageContractErrorCode.unsupported)
          const channel = victim.channel as IMemoryChannel
          const current = txSnapshot(channel, victim.encoded, victim.key)
          if (current === undefined) continue
          ;(journalVictims ??= new Set()).add(victim.id)
          stageDraft({ ...current, channel, encoded: victim.encoded, remove: true })
        }
        return journalAttempt.record(current)
      }
    })
    /** Terminal observations retain identity captured while the original scope was valid. */
    const stage = core.stageBindings.transactionStages(store).forTransaction(scope)
    try {
      if (journaled) journalAttempt = core.journal?.begin(scope)
      void stage.beforeTransaction?.()
      void stage.onTransactionStart?.()
      /**
       * The callback itself is an accepted operation, so its failure cannot bypass first-error
       * state.
       */
      const value = await runTransactionOperation(scope, (current) => run(current, textDraft))
      control.stopAdmission()
      await control.runFinalizers()
      controller.assertLive()
      throwIfAborted(ctx.signal)
      if (protectedRanges !== undefined) {
        /** Batch commits cannot bypass a holder admitted while this original draft was preparing. */
        const held = locks.probe(readConcurrencyLockIdentities(ctx), protectedRanges, ctx)
        if (held !== undefined) {
          void stage.afterRollback?.(StorageContractErrorCode.lockRejected)
          return { status: 'conflict', phase: 'acquire', keys: [held.key], holder: held.holder }
        }
      }
      /** Expiry after an observed read changes the same original revision before commit checks. */
      for (const entry of expected.values()) liveEntry(entry.channel, entry.encoded)
      /** The same original retry owner handles concurrent private-head changes and drop/reopen. */
      const journalConflict = journalDraft?.conflict()
      if (journalConflict !== undefined) {
        void stage.afterRollback?.(StorageContractErrorCode.writeConflict)
        return { status: 'conflict', phase: 'commit', keys: [], holder: undefined }
      }
      /** Conflict identities are collected before the synchronous all-channel draft merge. */
      const conflicts = [...expected.values()].filter(
        (entry) =>
          revision(entry.channel, entry.encoded) !== entry.revision ||
          revisions.epoch(entry.channel === 'value' ? 'text' : entry.channel) !==
            snapshotEpochs.get(entry.channel)
      )
      if (
        conflicts.length !== 0 ||
        [...snapshotEpochs].some(
          ([channel, epoch]) => revisions.epoch(channel === 'value' ? 'text' : channel) !== epoch
        )
      ) {
        void stage.afterRollback?.(StorageContractErrorCode.writeConflict)
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
                    ? (draft.get(identity('rdf', entry.encoded)) ??
                        snapshots.get(identity('rdf', entry.encoded)))!.rdfLock!
                    : lockKey.record(entry.key)
          ),
          holder: undefined,
          cause: new Error(
            conflicts[0] &&
              revision(conflicts[0].channel, conflicts[0].encoded) !== conflicts[0].revision
              ? StorageErrorText.memoryRevisionChanged(
                  conflicts[0].revision,
                  revision(conflicts[0].channel, conflicts[0].encoded)
                )
              : StorageErrorText.memoryEpochChanged
          )
        }
      }
      /** Final capacity admission shares the same original attempt, locks and no-await commit turn. */
      const capacityPlan = draftCapacityPlan()
      if (
        journalAttempt !== undefined &&
        (capacityPlan?.expired.length !== journalCapacity?.expired.length ||
          capacityPlan?.victims.length !== journalCapacity?.victims.length ||
          capacityPlan?.expired.some(
            (entry, index) => entry.id !== journalCapacity!.expired[index]!.id
          ) ||
          capacityPlan?.victims.some(
            (entry, index) => entry.id !== journalCapacity!.victims[index]!.id
          ))
      ) {
        void stage.afterRollback?.(StorageContractErrorCode.writeConflict)
        return { status: 'conflict', phase: 'commit', keys: [], holder: undefined }
      }
      setCapacityIdentities?.(capacityPlan?.identities ?? [])
      const capacityHeld =
        capacityPlan === undefined
          ? undefined
          : locks.probe(capacityPlan.identities, undefined, ctx)
      if (capacityHeld !== undefined) {
        void stage.afterRollback?.(StorageContractErrorCode.lockRejected)
        return {
          status: 'conflict',
          phase: 'acquire',
          keys: [capacityHeld.key],
          holder: capacityHeld.holder
        }
      }
      /** Each channel reports one batch after all physical draft rows have committed. */
      const changed = {
        value: [] as IStorageKey[],
        bytes: [] as IStorageKey[],
        record: [] as IStorageKey[],
        vector: [] as IStorageKey[],
        rdf: [] as IStorageKey[]
      }
      commitCapacity(
        capacityPlan,
        () => {
          /** Clear's physical maps, revisions and accounting remain owned by their original turn. */
          if (clearedChannels !== undefined) {
            if (clearAllRequested) clearAll(false)
            else clear(clearedChannels[0] as IStorageChannel, false)
          }
          for (const proposed of draft.values()) {
            if (clearedChannels?.includes(proposed.channel)) {
              changed[proposed.channel].push(proposed.key)
              continue
            }
            /** Policy eviction remains owned by commitCapacity, including revision and onEvict. */
            if (journalVictims?.has(identity(proposed.channel, proposed.encoded))) continue
            /** Existing draft identities retain their already captured logical key. */
            const encoded = proposed.encoded
            /** New deadlines that elapsed within this draft commit as immediate absence. */
            if (
              proposed.remove ||
              (proposed.deadline !== undefined && proposed.deadline <= scheduler.now())
            ) {
              setDeadline(proposed.channel, encoded, undefined)
              capacityIndex?.remove(identity(proposed.channel, encoded))
              if (!data[proposed.channel].delete(encoded)) continue
              if (proposed.channel === 'rdf') rdfIndex.delete(proposed.rdfKeys!)
              else ordered[proposed.channel].delete(proposed.ordered)
            } else {
              /**
               * An overwrite retains its original live ordered encoding instead of keeping
               * duplicate key bytes.
               */
              const keyBytes =
                ordered[proposed.channel].get(proposed.ordered)?.key ?? proposed.ordered
              const entry = {
                key: proposed.key,
                value: proposed.value,
                ordered: keyBytes,
                bytes: proposed.bytes,
                rdfKeys: proposed.rdfKeys,
                rdfLock: proposed.rdfLock
              }
              data[proposed.channel].set(encoded, entry)
              if (proposed.channel === 'rdf') rdfIndex.set(proposed.rdfKeys!, entry)
              else ordered[proposed.channel].set(keyBytes, entry)
              setDeadline(proposed.channel, encoded, proposed.deadline)
              capacityIndex?.put({
                ...capacityFact(proposed.channel, proposed.key, undefined, proposed.rdfLock),
                bytes: proposed.bytes ?? 0
              })
            }
            bump(proposed.channel, encoded)
            changed[proposed.channel].push(proposed.key)
          }
          /** The original capacity buffer preserves batch-before-victim notification order. */
          if (capacityPlan !== undefined)
            for (const channel of physicalChannels)
              if (!clearedChannels?.includes(channel) && changed[channel].length !== 0)
                publish(channel, 'batch', changed[channel])
        },
        () => {
          /** Actual data and capacity victims are final before private indexes become visible. */
          journalDraft?.commit()
          journalDraft?.complete(true)
          if (clearChanged) {
            if (clearAllRequested) controller.publish({ channel: 'all', kind: 'clear', orgId })
            else publish(clearedChannels![0]!, 'clear')
          }
          if (capacityPlan === undefined)
            for (const channel of physicalChannels)
              if (!clearedChannels?.includes(channel) && changed[channel].length !== 0)
                publish(channel, 'batch', changed[channel])
        }
      )
      void stage.afterCommit?.(
        physicalChannels.reduce((count, channel) => count + changed[channel].length, 0) +
          (capacityPlan?.expired.length ?? 0) +
          (capacityPlan?.victims.length ?? 0)
      )
      return { status: 'committed', value }
    } catch (cause) {
      /** The original owner combines cleanup after the first failure without replacing its cause. */
      let primary = failure ?? normalize(cause)
      try {
        await control.closeIterators()
      } catch (cleanup) {
        primary = normalize(cleanup)
      }
      void stage.afterRollback?.(primary.code)
      throw primary
    } finally {
      journalDraft?.complete(false)
      if (journalAttempt?.settle !== undefined) await journalAttempt.settle()
      control.close()
      if (observeKeys !== undefined)
        observeKeys(
          [...expected.values()]
            .map((entry) => {
              const physical =
                draft.get(identity(entry.channel, entry.encoded)) ??
                data[entry.channel].get(entry.encoded)
              return capacityLock(
                capacityFact(entry.channel, entry.key, undefined, physical?.rdfLock)
              )
            })
            .filter((key): key is ILockKey => key !== undefined)
        )
      draft.clear()
      snapshots.clear()
      expected.clear()
      snapshotEpochs.clear()
      for (const channel of physicalChannels) draftOrdered[channel].clear()
      draftRdfIndex.clear()
      void stage.onTransactionClose?.()
    }
  }

  /** Records capability binding composes only the supplied original transaction's real methods. */
  const bindRecords = (scope: ITransactionScope): ITransactionRecordsApi => ({
    query: (scope as IMemoryScope<unknown>)[recordQueries],
    removeByPrefix: (prefix) => (scope as IMemoryScope<unknown>)[recordPrefix](prefix)
  })

  /**
   * Retain the original native KV members before provider publication replaces the root has
   * overload.
   */
  const keyValue: IKeyValueApi = {
    get: base.get,
    set: base.set,
    remove: base.remove,
    has: base.has,
    keys: base.keys,
    clearValues: base.clearValues,
    clearAll: base.clearAll,
    sync: base.sync,
    getMany: async (keys, ctx) => {
      const count = batchSize(keys)
      if (count === 0) return []
      return observeBatch(MemoryOperation.getMany, count, () =>
        asyncEntry(MemoryOperation.getMany, keys, ctx, (input) =>
          readTextBatch(input, (key) => read('value', key) as string | undefined)
        )
      )
    },
    setMany: async (entries, ctx) => {
      const count = batchSize(entries)
      if (count === 0) return
      return observeBatch(MemoryOperation.setMany, count, () =>
        atomicEntry(
          MemoryOperation.setMany,
          () => entries,
          ctx,
          (input) => {
            /** Preparation precedes implicit lock derivation and the sole native transaction. */
            const captured = captureBatch(() => captureTextEntries(input))
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
      const count = batchSize(keys)
      if (count === 0) return 0
      return observeBatch(MemoryOperation.removeMany, count, () =>
        atomicEntry(
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
      observeBatch(MemoryOperation.removeByPrefix, undefined, () =>
        atomicEntry(
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
  /** Capture canonical target identity and reject channels that this native unit does not implement. */
  function captureTtlTarget(input: ITtlTarget): IMemoryTtlTarget {
    /** The original lock owner validates and detaches the complete channel-specific identity. */
    const target = snapshotStorageTtlTarget(input, STORAGE_MEMORY_BACKEND)
    return target
  }
  /** Only text differs from the original physical channel spelling. */
  function ttlChannel(target: IMemoryTtlTarget): IMemoryChannel {
    return target.channel === 'text' ? 'value' : target.channel
  }
  /** Vector locks and deadlines identify the same independently tagged collection/point key. */
  function ttlKey(target: IMemoryTtlTarget): IStorageKey {
    return target.channel === 'vector' ? [target.collection, target.id] : target.key
  }

  /** One metadata mutation keeps the same physical value, revision and local notification owner. */
  const changeDeadline = (
    target: IMemoryTtlTarget,
    ms: number | undefined,
    persist: boolean
  ): boolean => {
    /** Canonical target snapshot has already detached every mutable key segment. */
    const channel = ttlChannel(target)
    const encoded = encodeFlatStorageKey(ttlKey(target))
    const current = liveEntry(channel, encoded)
    const id = identity(channel, encoded)
    if (current === undefined || (persist && !deadlines.has(id))) return false
    setDeadline(channel, encoded, persist ? undefined : scheduler.now() + ms!)
    if (ms === 0) liveEntry(channel, encoded)
    else {
      bump(channel, encoded)
      publish(channel, 'put', [current.key])
    }
    return true
  }
  /** TTL reads and writes use the original root pipeline, implicit locks and operation budget. */
  const timeToLive: ITtlApi = {
    expire: (target, ms, ctx) =>
      mutationEntry(MemoryOperation.ttlExpire, { target, ms }, ctx, (input) => {
        const target = captureTtlTarget(input.target)
        /** The supplied duration remains fixed while the original policy waits for admission. */
        const ms = input.ms
        assertStorageTtlDuration(ms, STORAGE_MEMORY_BACKEND)
        return {
          keys: [target],
          invoke: (draft) => draft.ttl(target, ms, false),
          run: () => changeDeadline(target, ms, false)
        }
      }),
    remaining: (target, ctx) =>
      asyncEntry(MemoryOperation.ttlRemaining, target, ctx, (input) => {
        const target = captureTtlTarget(input)
        const channel = ttlChannel(target)
        const encoded = encodeFlatStorageKey(ttlKey(target))
        if (liveEntry(channel, encoded) === undefined) return undefined
        const deadline = deadlines.get(identity(channel, encoded))
        return deadline === undefined ? undefined : Math.max(0, deadline - scheduler.now())
      }),
    persist: (target, ctx) =>
      mutationEntry(MemoryOperation.ttlPersist, target, ctx, (input) => {
        const target = captureTtlTarget(input)
        return {
          keys: [target],
          invoke: (draft) => draft.ttl(target, undefined, true),
          run: () => changeDeadline(target, undefined, true)
        }
      })
  }
  /** A native counter read and write occupy the same original synchronous admitted mutation. */
  const counters: ICounterApi = {
    increment: (key, by, ctx) =>
      mutationEntry(MemoryOperation.counterIncrement, { key, by }, ctx, (input) => {
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
            capacity === undefined
              ? undefined
              : () => {
                  const encoded = encodeFlatStorageKey(key)
                  const deadline = deadlines.get(identity('value', encoded))
                  const current =
                    deadline !== undefined && deadline <= scheduler.now()
                      ? undefined
                      : (data.value.get(encoded)?.value as string | undefined)
                  capacityResult = increment(current)
                  return [capacityFact('value', key, entryBytes('value', String(capacityResult)))]
                },
          run: () => {
            /** This calculation and its write share one synchronous admitted native turn. */
            const result = capacityResult ?? increment(read('value', key) as string | undefined)
            write('value', key, String(result))
            return result
          }
        }
      })
  }
  /** New native capability calls check the same controller before the original registration runner. */
  const vectorOperation = <R>(invoke: () => Promise<R>): Promise<R> => {
    try {
      controller.assertLive()
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
  const vectorCondition = (filter: IVectorFilter): IQueryCondition => {
    if ('all' in filter) return { kind: 'and', conditions: filter.all.map(vectorCondition) }
    if ('any' in filter) return { kind: 'or', conditions: filter.any.map(vectorCondition) }
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
  const vectorKey = (collection: string, id: string): readonly [string, string] => [collection, id]
  /** Native IDs detach through the original key batch capture before any policy may wait. */
  const vectorIds = (ids: readonly string[]): readonly string[] => {
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
  const removeVector = (collection: string, id: string): boolean => {
    /** Each prepared ID uses the original key encoding without a new point registry. */
    const encoded = encodeFlatStorageKey(vectorKey(collection, id))
    /** The actual physical row determines whether this delete contributes to the result. */
    const current = data.vector.get(encoded)
    if (current === undefined) return false
    deletePhysical('vector', encoded)
    return true
  }
  /** Each collection borrows this namespace's original execution, data and resource lifetime. */
  const vectors: IVectorApi = {
    collection: <TPayload>(
      name: string,
      options?: IStorageVectorConfiguration
    ): IVectorCollection<TPayload> => {
      controller.assertLive()
      /** Optional configuration capture performs no lookup or native operation by itself. */
      const captured = snapshotStorageVectorCollection(name, options, STORAGE_MEMORY_BACKEND)
      /** Repeated descriptors resolve the same metadata, while incompatible declarations reject. */
      const existing = vectorCollections.get(captured.name)
      /** New collections require real dimensions and never infer them from a later write. */
      const configuration = existing ?? captured.options
      if (
        configuration === undefined ||
        (existing !== undefined &&
          captured.options !== undefined &&
          (existing.dimensions !== captured.options.dimensions ||
            existing.metric !== captured.options.metric))
      )
        invalidVector()
      vectorCollections.set(captured.name, configuration)
      /** Prefix bytes localize only this collection in the existing physical vector radix. */
      const bounds = snapshotStorageKeyPrefix([captured.name], STORAGE_MEMORY_BACKEND)
      /** Stored point values are canonical snapshots and remain inaccessible to application code. */
      const point = (id: string): IStorageVectorPoint<TPayload> | undefined => {
        const encoded = encodeFlatStorageKey(vectorKey(captured.name, id))
        const entry = liveEntry('vector', encoded)
        if (entry !== undefined) capacityIndex?.touch(identity('vector', encoded))
        return entry?.value as IStorageVectorPoint<TPayload> | undefined
      }
      /** Search removes expired rows before filtering/scoring; physical deleteWhere retains them. */
      const points = function* (physical = false): IterableIterator<IStorageVectorPoint<TPayload>> {
        /** The original radix locates this collection without retaining all candidate references. */
        let leaf = ordered.vector.lowerBound(bounds.lower)
        while (leaf !== undefined && compareRecordIndexKeys(leaf.key, bounds.upper) < 0) {
          /** Expiry or a caller delete can unlink this leaf before the generator resumes. */
          const next = leaf.next
          /** Physical deletion includes expired matches; ranking reclaims them before scoring. */
          const entry = physical
            ? leaf.value
            : liveEntry('vector', encodeFlatStorageKey(leaf.value.key))
          if (entry !== undefined) {
            if (!physical) capacityIndex?.touch(identity('vector', encodeFlatStorageKey(entry.key)))
            yield entry.value as IStorageVectorPoint<TPayload>
          }
          leaf = next
        }
      }
      /** Output payloads/vectors detach only for selected native hits, preserving bounded work. */
      const output = (
        hit: ReturnType<typeof rankMemoryVectors<TPayload>>[number],
        withVector: boolean,
        withPayload: boolean
      ): IVectorHit<TPayload, boolean> => ({
        id: hit.point.id,
        score: hit.score,
        ...(withPayload && hit.point.payload !== undefined
          ? { payload: clone(hit.point.payload) }
          : {}),
        ...(withVector ? { vector: [...hit.point.vector] } : {})
      })
      /** A source keeps one immutable resolver; canonical query nodes still own every refinement. */
      const query = (
        resolve: (lookup: typeof point) => {
          query: readonly number[]
          exclude: ReadonlySet<string>
        },
        metric: IStorageVectorConfiguration['metric']
      ) => {
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
              !selected.exclude.has(point.id) &&
              predicates.every((predicate) => predicate(point.payload))
          ).map((hit): readonly [IStorageKey, IVectorHit<TPayload, boolean>] => [
            hit.point.id,
            output(hit, input.withVector, true)
          ])
        }
        return createVectorQuery<TPayload>(
          {
            asyncDisposeKey,
            exact: true,
            watch: ({ ctx }) => watchChanges('all', ctx),
            mutate: (request, run) =>
              atomicEntry(
                MemoryOperation.vectorQueryDelete,
                () => ({ ...request }),
                { ...request.ctx, concurrency: request.concurrency },
                (input) => ({
                  invoke: (scope) => scope[queryDraft].vector(captured.name, input, run, select)
                })
              ),
            pushdown: {
              source: MemoryState.querySource,
              operations: [QueryOperation.where, QueryOperation.topK, QueryOperation.minScore],
              operators: Object.values(QueryOperator)
            },
            execute: (input) => {
              controller.assertLive()
              return nativeIterator(
                MemoryOperation.vectorSearch,
                input.ctx,
                () => select(input, points(), point),
                (row) => row,
                () => controller.assertLive()
              )
            }
          },
          core.getChainMethods('vector')
        )
      }
      return {
        near: (input, options) => {
          controller.assertLive()
          return captureBatch(() => {
            if (
              options !== undefined &&
              (typeof options !== 'object' || options === null || Array.isArray(options))
            )
              invalidVector()
            /** Optional request fields are read once before the immutable source captures them. */
            const inputMetric = options?.metric
            const metric = inputMetric === undefined ? configuration.metric : inputMetric
            /** Memory is exact for either request; malformed explicit options still reject. */
            const exact = options?.exact
            if (exact !== undefined && typeof exact !== 'boolean') invalidVector()
            /** The original component owner snapshots the query and the requested metric. */
            const components = snapshotStorageVector(
              input,
              { dimensions: configuration.dimensions, metric },
              STORAGE_MEMORY_BACKEND
            )
            return query(() => ({ query: components, exclude: new Set<string>() }), metric)
          })
        },
        similarTo: (id) => {
          controller.assertLive()
          assertStringStorageKey(id, STORAGE_MEMORY_BACKEND)
          return query((lookup) => {
            /** A missing/expired sample is rejected before native candidates are ranked. */
            const sample = lookup(id)
            if (sample === undefined) invalidVector()
            return {
              query: snapshotStorageVector(sample.vector, configuration, STORAGE_MEMORY_BACKEND),
              exclude: new Set([id])
            }
          }, configuration.metric)
        },
        recommend: (input) => {
          controller.assertLive()
          /** The original key batch owner detaches ID arrays before their asynchronous use. */
          const samples = captureBatch(() => {
            if (typeof input !== 'object' || input === null || Array.isArray(input)) invalidVector()
            const { positive, negative } = input
            const positiveIds = vectorIds(positive)
            const negativeIds = vectorIds(negative === undefined ? [] : negative)
            if (positiveIds.length === 0) invalidVector()
            const exclude = new Set([...positiveIds, ...negativeIds])
            if (exclude.size !== positiveIds.length + negativeIds.length) invalidVector()
            return { positiveIds, negativeIds, exclude }
          })
          return query((lookup) => {
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
              query: snapshotStorageVector(combined, configuration, STORAGE_MEMORY_BACKEND),
              exclude: samples.exclude
            }
          }, configuration.metric)
        },
        upsert: (points, ctx) =>
          vectorOperation(() =>
            mutationEntry(MemoryOperation.vectorUpsert, points, ctx, (input, context) => {
              /** Full-batch capture occurs before any original lock wait or physical mutation. */
              const prepared = snapshotStorageVectorUpsert(
                input,
                configuration,
                STORAGE_MEMORY_BACKEND
              )
              /** Complete canonical payload encoding also finishes before the first native put. */
              const sizes = prepared.map((point) => entryBytes('vector', point))
              /**
               * Extension fields came from the original concurrency snapshot, never a second raw
               * read.
               */
              const ttlMs = Reflect.get(context, 'ttlMs') as number | undefined
              if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, STORAGE_MEMORY_BACKEND)
              return {
                keys: prepared.map((point) => lockKey.vector(captured.name, point.id)),
                invoke: (draft) => draft.upsertVector(captured.name, prepared, sizes, ttlMs),
                capacityChanges:
                  capacity === undefined
                    ? undefined
                    : () =>
                        prepared.map((point, index) => {
                          const key = vectorKey(captured.name, point.id)
                          const deadline =
                            ttlMs === undefined
                              ? deadlines.get(identity('vector', encodeFlatStorageKey(key)))
                              : scheduler.now() + ttlMs
                          return capacityFact(
                            'vector',
                            key,
                            ttlMs !== undefined &&
                              deadline !== undefined &&
                              deadline <= scheduler.now()
                              ? undefined
                              : sizes[index]
                          )
                        }),
                run: () => {
                  /** One monotonic clock observation applies to this synchronous admitted batch. */
                  const now = scheduler.now()
                  for (const [index, point] of prepared.entries()) {
                    const key = vectorKey(captured.name, point.id)
                    const encoded = encodeFlatStorageKey(key)
                    const current = liveEntry('vector', encoded)
                    const orderedKey =
                      current?.ordered ?? encodeOrderedStorageKey(key, STORAGE_MEMORY_BACKEND)
                    const deadline =
                      ttlMs === undefined ? deadlines.get(identity('vector', encoded)) : now + ttlMs
                    if (deadline !== undefined && deadline <= now) {
                      removeVector(captured.name, point.id)
                      continue
                    }
                    const entry = { key, ordered: orderedKey, value: point, bytes: sizes[index] }
                    data.vector.set(encoded, entry)
                    ordered.vector.set(orderedKey, entry)
                    setDeadline('vector', encoded, deadline)
                    capacityIndex?.put({ ...capacityFact('vector', key), bytes: sizes[index]! })
                    bump('vector', encoded)
                  }
                  if (prepared.length > 0) publish('vector', 'batch')
                }
              }
            })
          ),
        delete: (ids, ctx) =>
          vectorOperation(() =>
            mutationEntry(MemoryOperation.vectorDelete, ids, ctx, (input) => {
              const capturedIds = vectorIds(input)
              return {
                keys: capturedIds.map((id) => lockKey.vector(captured.name, id)),
                invoke: (draft) => {
                  for (const id of capturedIds) draft.remove('vector', vectorKey(captured.name, id))
                },
                run: () => {
                  let count = 0
                  for (const id of capturedIds) if (removeVector(captured.name, id)) count++
                  if (count > 0) publish('vector', 'batch')
                }
              }
            })
          ),
        deleteWhere: (where, ctx) =>
          vectorOperation(() =>
            mutationEntry(MemoryOperation.vectorDeleteWhere, where, ctx, (input, context) => {
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
                  draft.deleteVector(captured.name, (point) =>
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
                  for (const point of points(true))
                    if (predicate(point.payload) && removeVector(captured.name, point.id)) count++
                  if (count > 0) publish('vector', 'batch')
                  return count
                }
              }
            })
          ),
        search: (query, options, ctx) =>
          vectorOperation(() =>
            asyncEntry(MemoryOperation.vectorSearch, { query, options }, ctx, (input) => {
              controller.assertLive()
              const request = snapshotStorageVectorSearch(
                input.query,
                input.options,
                configuration,
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
                points(),
                request.query,
                configuration.metric,
                request.options.k,
                undefined,
                (point) => filter === undefined || filter(point.payload)
              ).map((hit) => output(hit, false, request.options.withPayload))
            })
          )
      }
    }
  }

  /** Native RDF writes use the original mutation runner, canonical locks and final synchronous turn. */
  const rdfApi: IRdfApi = {
    add: (quads, ctx) =>
      mutationEntry(MemoryOperation.rdfAdd, quads, ctx, (input) => {
        /** Full canonical admission precedes root lock acquisition and the final physical turn. */
        const entries = captureRdfEntries(input)
        return {
          keys: entries.map((entry) => entry.rdfLock),
          invoke: (draft) => draft.rdf(entries.map(logicalRdfQuad), false),
          capacityChanges:
            capacity === undefined
              ? undefined
              : () =>
                  entries.map((entry) =>
                    capacityFact('rdf', entry.key, entry.bytes, entry.rdfLock)
                  ),
          run: () => {
            /** Idempotent additions publish only when physical membership really changes. */
            let changed = false
            for (const entry of entries) {
              if (data.rdf.has(entry.encoded)) {
                capacityIndex?.touch(identity('rdf', entry.encoded))
                continue
              }
              data.rdf.set(entry.encoded, entry)
              rdfIndex.set(entry.rdfKeys, entry)
              capacityIndex?.put({
                ...capacityFact('rdf', entry.key, undefined, entry.rdfLock),
                bytes: entry.bytes ?? 0
              })
              bump('rdf', entry.encoded)
              changed = true
            }
            if (changed) publish('rdf', 'batch')
          }
        }
      }),
    delete: (quads, ctx) =>
      mutationEntry(MemoryOperation.rdfDelete, quads, ctx, (input) => {
        /** All supplied quads validate before an existing point can be removed. */
        const entries = captureRdfEntries(input)
        return {
          keys: entries.map((entry) => entry.rdfLock),
          invoke: (draft) => draft.rdf(entries.map(logicalRdfQuad), true),
          run: () => {
            /** Repeated or absent deletions do not manufacture revisions or events. */
            let changed = false
            for (const entry of entries)
              if (deletePhysical('rdf', entry.encoded) !== undefined) changed = true
            if (changed) publish('rdf', 'batch')
          }
        }
      }),
    match: rootRdfQuery
  }

  /** Native object failures reuse the existing memory serialization boundary and original cause. */
  const blobFailure = (cause: unknown, key?: string) =>
    isStorageErrorFamily(cause)
      ? cause
      : new StorageError(StorageErrorCode.serializeFailed, {
          backend: STORAGE_MEMORY_BACKEND,
          key,
          cause
        })
  /** Conditions inspect the current native generation both before reading and in the final turn. */
  function assertBlobCondition(input: ReturnType<typeof snapshotStorageBlobPut>): void {
    /** The current opaque generation is observed without taking reader ownership. */
    const current = blobs.get(input.key)
    if (
      (input.options.ifMatch !== undefined && current?.value.info.etag !== input.options.ifMatch) ||
      (input.options.ifNoneMatch === true && current !== undefined)
    )
      throw new StorageContractError(StorageContractErrorCode.writeConflict, {
        backend: STORAGE_MEMORY_BACKEND
      })
  }
  /** Only the native sink buffers the complete object; reader lifecycle stays in the contract owner. */
  async function loadBlobBody(
    input: ReturnType<typeof snapshotStorageBlobPut>,
    signal: IOperationContext['signal']
  ): Promise<Uint8Array> {
    if (isUint8Array(input.body)) return input.body
    /** Upload consumption and cancellation reuse the sole shared body-reader resource owner. */
    const reader = createStorageBlobBodyReader(input.body, {
      report,
      backend: STORAGE_MEMORY_BACKEND,
      normalizeFailure: (cause) => blobFailure(cause, input.key)
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
      stopContext = subscribeToAbort(signal, () => cancel(signal), report)
      stopClosing = subscribeToAbort(
        controller.closingSignal,
        () => cancel(controller.closingSignal),
        report
      )
      for (;;) {
        throwIfAborted(signal)
        controller.assertLive()
        /** The original reader returns a detached byte chunk or its stable EOF result. */
        const next = await reader.next()
        throwIfAborted(signal)
        controller.assertLive()
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
      controller.assertLive()
      throw cause
    } finally {
      stopContext()
      stopClosing()
      try {
        await reader.dispose()
      } catch (cause) {
        if (failed) reportCleanupError(report, cause)
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
  const objects: IBlobApi = {
    async put(key, body, options) {
      controller.assertLive()
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
      const preparing = core.journal === undefined ? undefined : controller.beginMutation()
      const pending = runWithConcurrency<IBlobInfo>(
        {
          store: base,
          options: input.options.ctx ?? {},
          prepare:
            core.journal === undefined
              ? undefined
              : async () => {
                  await core.journal!.prepare()
                  /**
                   * Blob has no shared journal target; reject before taking upload reader
                   * ownership.
                   */
                  if (core.journal!.active())
                    throw new StorageContractError(StorageContractErrorCode.unsupported)
                },
          execute: (context, invoke) =>
            core.execution.run(
              { operation: MemoryOperation.blobPut, input: pipelineInput, ctx: context },
              async (captured) => {
                controller.assertLive()
                /** Accepted uploads drain through the existing controller's mutation lease. */
                const release = controller.beginMutation()
                try {
                  prepared = snapshotStorageBlobPut(
                    captured.key,
                    captured.body,
                    captured.options,
                    STORAGE_MEMORY_BACKEND
                  )
                  assertBlobCondition(prepared)
                  bytes = await loadBlobBody(prepared, context.signal)
                  throwIfAborted(context.signal)
                  controller.assertLive()
                  physicalKey = prefixStorageOrgKey(orgId, prepared.key)
                  info = Object.freeze({
                    key: prepared.key,
                    size: bytes.byteLength,
                    etag: createStorageToken(),
                    contentType: prepared.options.contentType,
                    metadata: prepared.options.metadata ?? Object.freeze({}),
                    updatedAt: Date.now()
                  })
                  return await invoke()
                } catch (cause) {
                  throw blobFailure(cause, input.key)
                } finally {
                  release()
                }
              }
            ),
          lock: () => []
        },
        {
          attempt: (attempt) =>
            locks.attemptWrite(
              attempt,
              holding(),
              () => {
                assertBlobCondition(prepared)
                return commitCapacity(plan, () => {
                  /** All failure-prone input and body work precedes this final synchronous turn. */
                  const entry = blobs.put(bytes, info)
                  capacityIndex?.put({
                    ...capacityFact('blob', entry.key),
                    bytes: bytes.byteLength
                  })
                  publish('blob', 'put')
                  return info
                })
              },
              core.stageBindings.concurrencyStages(store),
              controller.closingSignal,
              undefined,
              undefined,
              () => {
                assertBlobCondition(prepared)
                plan =
                  capacity === undefined
                    ? undefined
                    : planCapacity([capacityFact('blob', physicalKey, bytes.byteLength)])
                return plan?.identities ?? []
              }
            )
        }
      )
      return preparing === undefined ? pending : pending.finally(preparing)
    },
    async get(key, options) {
      controller.assertLive()
      /** Range and caller context are admitted before any native object snapshot is opened. */
      const input = snapshotStorageBlobGet(key, options, STORAGE_MEMORY_BACKEND)
      /** The original pipeline may replace or mutate this owned request before native admission. */
      const pipelineInput = { ...input, options: { ...input.options } }
      /** This original timeout/context lifetime transfers to the returned shared object resource. */
      const merged = mergeSignals(input.options.ctx, report)
      /** A pipeline failure after opening content still disposes that exact original resource. */
      let resource: IBlobObject | undefined
      try {
        throwIfAborted(merged.signal)
        return await core.execution.run(
          { operation: MemoryOperation.blobGet, input: pipelineInput, ctx: merged.context },
          async (captured) => {
            controller.assertLive()
            throwIfAborted(merged.signal)
            /** Re-capture pipeline changes even when it retained the same request object identity. */
            const request = snapshotStorageBlobGet(
              captured.key,
              captured.options,
              STORAGE_MEMORY_BACKEND
            )
            /** Native metadata and body come from the same immutable committed generation. */
            const entry = blobs.get(request.key)
            if (entry === undefined) {
              merged.dispose()
              return undefined
            }
            capacityIndex?.touch(identity('blob', entry.encoded))
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
                  controller.assertLive()
                  throwIfAborted(merged.signal)
                  native.enqueue(snapshot)
                  native.close()
                }
              },
              { highWaterMark: 0 }
            )
            resource = createStorageBlobObject(entry.value.info, source, {
              close: () => merged.dispose(),
              report,
              backend: STORAGE_MEMORY_BACKEND,
              normalizeFailure: (cause) => blobFailure(cause, request.key)
            })
            return resource
          }
        )
      } catch (cause) {
        try {
          await resource?.dispose()
        } catch (cleanup) {
          reportCleanupError(report, cleanup)
        }
        merged.dispose()
        throw blobFailure(cause, input.key)
      }
    },
    head: (key, ctx) =>
      asyncEntry(MemoryOperation.blobHead, key, ctx, (captured) => {
        controller.assertLive()
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        const entry = blobs.get(captured)
        if (entry !== undefined) capacityIndex?.touch(identity('blob', entry.encoded))
        return entry?.value.info
      }),
    remove: (key, ctx) =>
      mutationEntry(MemoryOperation.blobRemove, key, ctx, (captured) => {
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return {
          keys: [],
          run: () => {
            const entry = deletePhysical('blob', blobs.encodedOf(captured))
            if (entry !== undefined) publish('blob', 'remove')
            return entry !== undefined
          }
        }
      }),
    async list(options, ctx) {
      const request = snapshotStorageBlobList(options, ctx, STORAGE_MEMORY_BACKEND)
      return asyncEntry(MemoryOperation.blobList, { ...request }, request.ctx, (captured) => {
        controller.assertLive()
        const input = snapshotStorageBlobList(captured, request.ctx, STORAGE_MEMORY_BACKEND)
        const result = blobs.list(input.prefix, input.after, input.limit)
        for (const info of result.items)
          capacityIndex?.touch(identity('blob', blobs.encodedOf(info.key)))
        return result
      })
    },
    removeByPrefix: (prefix, ctx) =>
      mutationEntry(MemoryOperation.blobRemoveByPrefix, prefix, ctx, (captured) => {
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return {
          keys: [],
          run: () => {
            let count = 0
            for (const entry of blobs.rows(captured))
              if (deletePhysical('blob', entry.encoded) !== undefined) count++
            if (count > 0) publish('blob', 'batch')
            return count
          }
        }
      })
  }

  /** Publish the real built-in APIs on the original resource, never a copied base. */
  const store = provideCapabilities(
    base,
    [
      implement(kv, keyValue, { forTransaction: (scope) => scope }),
      implement(ttl, timeToLive, {
        forTransaction: (scope) => (scope as IMemoryScope<T>)[ttlOperations]
      }),
      implement(vector, vectors),
      implement(blob, objects),
      implement(rdf, rdfApi, {
        forTransaction: (scope) => (scope as IMemoryScope<T>)[rdfOperations]
      }),
      implement(counter, counters, {
        forTransaction: (scope) => (scope as IMemoryScope<T>)[counterOperations]
      }),
      implement(
        records,
        {
          query: <R = T>() =>
            createRecordQuery<R>(
              {
                asyncDisposeKey,
                watch: ({ ctx }) => watchChanges('record', ctx),
                mutate: (request, run) =>
                  atomicEntry(
                    request.operation === 'delete'
                      ? MemoryOperation.recordQueryDelete
                      : MemoryOperation.recordQueryUpdate,
                    () => ({ ...request }),
                    { ...request.ctx, concurrency: request.concurrency },
                    (input) => ({ invoke: (scope) => scope[queryDraft].record(input, run) })
                  ),
                pushdown: { source: MemoryState.querySource, operations: [], operators: [] },
                execute: ({ ctx }) => base.iterateRecords(undefined, ctx)
              },
              core.getChainMethods('query')
            ),
          removeByPrefix: (prefix, ctx?: IOperationContext & IWriteConcurrencyOptions) =>
            mutationEntry(MemoryOperation.recordRemoveByPrefix, prefix, ctx, (input) => {
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
                  controller.assertLive()
                  /** Capture only matching native leaves before unlinking their adjacency links. */
                  const rows = [
                    ...ordered.record.range({
                      lower: captured.lower,
                      upper: captured.upper,
                      upperOpen: true
                    })
                  ]
                    .map((leaf) => liveEntry('record', encodeFlatStorageKey(leaf.value.key)))
                    .filter((entry): entry is IMemoryEntry => entry !== undefined)
                  for (const row of rows) {
                    /** Every selected live row shares the original hash/radix/revision identity. */
                    const encoded = encodeFlatStorageKey(row.key)
                    deletePhysical('record', encoded)
                  }
                  if (rows.length > 0)
                    publish(
                      'record',
                      'batch',
                      rows.map((row) => row.key)
                    )
                  return rows.length
                }
              }
            })
        },
        { forTransaction: bindRecords }
      )
    ],
    {
      onInstaller: (value) => {
        installer = value
      }
    }
  )
  owner = createTransactionOwner<T>(store, normalize, {
    asyncDisposeKey,
    defaultPolicy: options.concurrency,
    concurrencyStages: core.stageBindings.concurrencyStages(store)
  })
  /** Only this original registration can forward image operations to an authenticated native scope. */
  const journalImages = {
    changes: (scope: Omit<ITransactionScope, 'use'>) => {
      assertTransactionOwner(store, scope)
      return (scope as IMemoryScope<T>)[journalOperations].changes()
    },
    readImage: (scope: Omit<ITransactionScope, 'use'>, target: IStorageJournalTarget) => {
      assertTransactionOwner(store, scope)
      return (scope as IMemoryScope<T>)[journalOperations].readImage(target)
    },
    writeImage: (
      scope: Omit<ITransactionScope, 'use'>,
      target: IStorageJournalTarget,
      image: IStorageJournalImage
    ) => {
      assertTransactionOwner(store, scope)
      return (scope as IMemoryScope<T>)[journalOperations].writeImage(target, image)
    },
    readRevision: (scope: Omit<ITransactionScope, 'use'>, target: IStorageJournalTarget) => {
      assertTransactionOwner(store, scope)
      return (scope as IMemoryScope<T>)[journalOperations].readRevision(target)
    }
  }
  return {
    store,
    controller,
    installer,
    finalize,
    journal,
    journalImages,
    /** Only selected global journals need generation invalidation inside the original clear turn. */
    drop: () =>
      mutationEntry(
        MemoryOperation.clearAll,
        undefined,
        undefined,
        () => ({
          keys: [],
          ranges: mutationRanges(physicalChannels),
          run: () => {
            controller.assertLive()
            journal.clear()
            clearAll()
          }
        }),
        false
      )
  }
}

/** Precise native store shape is retained by the first-party plugin factory. */
export type IMemoryBackendStore<T = unknown> = Omit<
  ReturnType<typeof createMemoryBackend<T>>['store'],
  'undo'
>

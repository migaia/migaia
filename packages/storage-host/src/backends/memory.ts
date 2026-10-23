import { asyncDisposeKey } from '@migaia/plugin-host'
import { createBackendRevisionPort } from './revisions.js'
import { createBackendKeyLockPort } from './key-locks.js'
import type { IBackendChangeController } from '../core/change-controller.js'
import {
  StorageContractError,
  StorageContractErrorCode,
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
import { detectServerRuntime } from '@migaia/utils'
import { isUint8Array } from '@migaia/utils/bytes'
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
import { throwIfAborted, mergeSignals, withAbort } from '../core/operation.js'
import { createStorageOperationReporter, reportCleanupError } from '../core/operation-reporter.js'
import { observeStorageBatch } from '../core/batch-observation.js'

/** Memory options retain one private data universe for this concrete plugin instance. */
export type IMemoryOptions = {
  readonly namespace?: string
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
/**
 * This private member runs through the same original operation owner as every other native scope
 * method.
 */
type IMemoryScope<T> = ITransactionScope<T, typeof records | typeof ttl | typeof counter> & {
  [recordPrefix](prefix: IStorageKey): Promise<number>
  readonly [ttlOperations]: ITransactionTtlApi
  readonly [counterOperations]: ITransactionCounterApi
}
/** The original store retains the concrete complete native transaction view. */
type IMemoryBase<T> = Omit<ISyncCapableStore<IRecordStore<T>>, 'transaction'> &
  IChangeFeedStore & {
    transaction<R>(
      run: (scope: IMemoryScope<T>) => R,
      options?: ITransactionOptions
    ): Promise<Awaited<R>>
    tx(): ITransactionBuilder<IMemoryScope<T>>
    inspectLocks(ctx?: IOperationContext): Promise<readonly ILockHolding[]>
  }
/** Canonical keys and committed values belong to their actual memory channel. */
type IMemoryEntry = {
  readonly key: IStorageKey
  readonly value: unknown
  readonly ordered: Uint8Array
}
/** A transaction retains its first deadline beside the existing detached value snapshot. */
type IMemorySnapshot = IMemoryEntry & { readonly deadline?: number }
/** This native unit supports only its actual three physical value channels. */
type IMemoryTtlTarget = Extract<ITtlTarget, { readonly channel: 'text' | 'bytes' | 'record' }>
/** A draft deletion remains distinct from an untouched identity. */
type IMemoryDraft = IMemorySnapshot & {
  readonly channel: IStorageChannel
  readonly remove: boolean
  readonly encoded: string
}

/** Prepared root work owns detached inputs while borrowing the original admission and budget. */
type IMemoryRootMutation<R> = {
  readonly keys: readonly ILockKey[]
  readonly ranges?: readonly {
    readonly channel: ILockKey['channel']
    readonly lower: string
    readonly upper: string
  }[]
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
  setMany(entries: readonly IMemoryTextEntry[]): void
  removeMany(keys: readonly IStorageKey[]): number
  removeByPrefix(prefix: IStorageKey): number
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
  options: IMemoryOptions
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
      orgId === core.defaultOrgId
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
        await forOrg(orgId).store.clearAll()
      }
    },
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
  root: boolean
) {
  /** Physical membership, ordered ranges, deadline facts and lock admission share this namespace. */
  const data = {
    value: new Map<string, IMemoryEntry>(),
    bytes: new Map<string, IMemoryEntry>(),
    record: new Map<string, IMemoryEntry>()
  }
  /** Only live expiring identities retain deadline metadata. */
  const deadlines = new Map<string, number>()
  /** Ordered leaves index the same native data entries. */
  const ordered = {
    value: createOrderedRecordIndex<IMemoryEntry>(),
    bytes: createOrderedRecordIndex<IMemoryEntry>(),
    record: createOrderedRecordIndex<IMemoryEntry>()
  }
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
  /** Root lifecycle finalization releases each namespace's physical facts exactly once. */
  const finalize = async () => {
    await locks.dispose()
    for (const channel of MemoryState.channels) {
      data[channel].clear()
      ordered[channel].clear()
      revisions.clear(channel === 'value' ? 'text' : channel)
    }
    deadlines.clear()
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
  const identity = (channel: IStorageChannel, encoded: string): string =>
    MemoryState.identity(channel, encoded)
  /** Revision changes remain independent of whether an entry is currently present. */
  const revision = (channel: IStorageChannel, encoded: string): number =>
    revisions.read(channel === 'value' ? 'text' : channel, encoded)
  /** Every successful physical change advances only its own channel's original revision. */
  const bump = (channel: IStorageChannel, encoded: string): void => {
    revisions.write(channel === 'value' ? 'text' : channel, encoded)
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
  const copyValue = (channel: IStorageChannel, value: unknown, key: IStorageKey): unknown =>
    channel === 'value'
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
  /** Notifications retain original commit-after eviction order. */
  const publish = (
    channel: IStorageChannel,
    kind: IStorageChange['kind'],
    keys?: readonly IStorageKey[]
  ): void => {
    controller.publish({ channel, kind, orgId, ...(keys === undefined ? {} : { keys }) })
  }
  /** Every physical access shares one deadline check and the original removal/revision path. */
  const liveEntry = (channel: IStorageChannel, encoded: string): IMemoryEntry | undefined => {
    /** Physical membership and deadline use the same canonical channel/key identity. */
    const entry = data[channel].get(encoded)
    /** Omitted deadlines remain unlimited, including keys first written before TTL is used. */
    const id = identity(channel, encoded)
    /** The original monotonic clock is consulted once for this physical access. */
    const deadline = deadlines.get(id)
    if (entry !== undefined && deadline !== undefined && deadline <= scheduler.now()) {
      data[channel].delete(encoded)
      ordered[channel].delete(entry.ordered)
      deadlines.delete(id)
      bump(channel, encoded)
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
    policy: IConflictPolicy = 'conflict'
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
      data[previous].delete(encoded)
      ordered[previous].delete(keyBytes)
      deadlines.delete(identity(previous, encoded))
      bump(previous, encoded)
    }
    /** The hash and radix owners share this exact committed entry reference. */
    const entry = { key: captured, value: prepared, ordered: keyBytes }
    data[channel].set(encoded, entry)
    ordered[channel].set(keyBytes, entry)
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
    data[channel].delete(encoded)
    ordered[channel].delete(entry.ordered)
    deadlines.delete(identity(channel, encoded))
    bump(channel, encoded)
    publish(channel, 'remove', [captured])
  }
  /** Clear invalidates the actual channel snapshot even when membership was already empty. */
  const clear = (channel: IStorageChannel): void => {
    controller.assertLive()
    /** Preserve the original rule that an empty clear emits no notification. */
    const changed = data[channel].size !== 0
    for (const encoded of data[channel].keys()) deadlines.delete(identity(channel, encoded))
    data[channel].clear()
    ordered[channel].clear()
    revisions.clear(channel === 'value' ? 'text' : channel)
    if (changed) publish(channel, 'clear')
  }
  /** All flat reads retain string-only validation and old null/undefined missing results. */
  const read = (channel: IStorageChannel, key: IStorageKey): unknown => {
    controller.assertLive()
    /** Record keys remain structured; flat text and bytes remain string-only. */
    const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
    /** Reading never allocates a revision or changes physical membership. */
    const entry = liveEntry(channel, encodeFlatStorageKey(captured))
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
  const mutationRanges = (channels: readonly IStorageChannel[]) =>
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
    return {
      keys: mutationKeys(channel, captured, policy),
      run: () => write(channel, captured, prepared, policy)
    }
  }
  /** Root writes reuse the original execution list, policy loop, member lease and lock provider. */
  const mutationEntry = <I, R>(
    operation: string,
    input: I,
    ctx: IWriteOptions | undefined,
    prepareMutation: (captured: I, context: IOperationContextSnapshot) => IMemoryRootMutation<R>
  ): Promise<R> => {
    /** Pipeline intervention fixes this input before the original loop derives affected keys. */
    let capturedInput = input
    /** The sole derivation captures inputs and affected keys once, before any native attempt. */
    let mutation!: IMemoryRootMutation<R>
    return runWithConcurrency(
      {
        store: base,
        options: ctx === undefined ? {} : ctx,
        execute: (context, invoke) =>
          core.execution.run({ operation, input, ctx: context }, (captured) => {
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
          }),
        lock: (context) => {
          mutation = prepareMutation(capturedInput, context)
          return mutation.keys
        }
      },
      {
        attempt: (attempt) =>
          locks.attemptWrite(
            attempt,
            holding(),
            mutation.run,
            core.stageBindings.concurrencyStages(store),
            controller.closingSignal,
            mutation.ranges
          )
      }
    )
  }
  /** All-channel clearing retains its original one coarse event after one synchronous merge. */
  const clearAll = (): void => {
    controller.assertLive()
    /** Empty physical channels still advance epochs without manufacturing change notifications. */
    const changed = MemoryState.channels.some((channel) => data[channel].size !== 0)
    for (const channel of MemoryState.channels) {
      data[channel].clear()
      ordered[channel].clear()
      revisions.clear(channel === 'value' ? 'text' : channel)
    }
    deadlines.clear()
    if (changed) controller.publish({ channel: 'all', kind: 'clear', orgId })
  }
  /** Channel selection is captured before the shared provider's final synchronous range check. */
  const clearEntry = (
    operation: string,
    channel: IStorageChannel | undefined,
    ctx: IWriteOptions | undefined
  ): Promise<void> =>
    mutationEntry(operation, channel, ctx, (captured) => ({
      keys: [],
      ranges: mutationRanges(captured === undefined ? MemoryState.channels : [captured]),
      run: () => (captured === undefined ? clearAll() : clear(captured))
    }))

  /** One existing runner owns every asynchronous public endpoint. */
  const asyncEntry = <I, R>(
    operation: string,
    input: I,
    ctx: IOperationContext | undefined,
    run: (captured: I) => R
  ): Promise<R> =>
    core.execution.run({ operation, input, ctx }, (captured) =>
      withAbort(ctx, async () => run(captured))
    )

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
    prepare: (captured: I, admit: () => void) => IMemoryAtomicWork<T, R>
  ): Promise<Awaited<R>> => {
    /** One accepted lifetime spans every real attempt and all original pipeline settlement. */
    let release: (() => void) | undefined
    /** The existing lease admits once, including the original callback-capture boundary. */
    const admit = (): void => {
      release ??= controller.beginMutation()
    }
    /** Each pipeline fixes this attempt's original callback or detached native batch. */
    let work: IMemoryAtomicWork<T, R>
    return runWithConcurrency<Awaited<R>>(
      {
        store: base,
        options: ctx === undefined ? {} : ctx,
        executeAttempt: (context, invoke) =>
          core.execution.run({ operation, input: input(context), ctx: context }, (captured) => {
            controller.assertLive()
            work = prepare(captured, admit)
            admit()
            return invoke()
          }),
        lock: () => work.keys ?? []
      },
      {
        attempt: (attempt) =>
          locks.attempt(
            attempt,
            holding(),
            { attempt: () => transact(work.invoke, attempt, work.ranges) },
            core.stageBindings.concurrencyStages(store),
            controller.closingSignal,
            work.ranges
          )
      }
    ).finally(() => release?.())
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
            mutation.run()
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
      asyncEntry(MemoryOperation.get, key, ctx, (captured) => {
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return (read('value', captured) as string | undefined) ?? null
      }),
    set: (key, value, ctx) =>
      mutationEntry(MemoryOperation.set, { key, value }, ctx, (captured, context) => {
        assertStringStorageKey(captured.key, STORAGE_MEMORY_BACKEND)
        return prepareWrite('value', captured.key, captured.value, context.conflictPolicy)
      }),
    remove: (key, ctx) =>
      mutationEntry(MemoryOperation.remove, key, ctx, (captured) => {
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return { keys: [lockKey.text(captured)], run: () => remove('value', captured) }
      }),
    has: (key, ctx) =>
      asyncEntry(MemoryOperation.has, key, ctx, (captured) => {
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return read('value', captured) !== undefined
      }),
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
      asyncEntry(MemoryOperation.getBytes, key, ctx, (captured) => {
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return (read('bytes', captured) as Uint8Array | undefined) ?? null
      }),
    setBytes: (key, value, ctx) =>
      mutationEntry(MemoryOperation.setBytes, { key, value }, ctx, (captured, context) => {
        assertStringStorageKey(captured.key, STORAGE_MEMORY_BACKEND)
        return prepareWrite('bytes', captured.key, captured.value, context.conflictPolicy)
      }),
    removeBytes: (key, ctx) =>
      mutationEntry(MemoryOperation.removeBytes, key, ctx, (captured) => {
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return { keys: [lockKey.bytes(captured)], run: () => remove('bytes', captured) }
      }),
    clearBytes: (ctx) => clearEntry(MemoryOperation.clearBytes, 'bytes', ctx),
    getRecord: (key, ctx) =>
      asyncEntry(
        MemoryOperation.getRecord,
        key,
        ctx,
        (captured) => read('record', captured) as T | undefined
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
        return { keys: [lockKey.record(key)], run: () => remove('record', key) }
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
    inspectLocks: (ctx) =>
      asyncEntry(MemoryOperation.inspectLocks, undefined, ctx, () => {
        controller.assertLive()
        return locks.inspectLocks()
      }),
    subscribeChanges: (listener) => {
      controller.assertLive()
      return controller.subscribe((change) => {
        if (root || change.orgId === orgId) listener(change)
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

  /** Root scans retain one actual native generator and one cached cleanup path. */
  function rootIterator(
    range: IKeyRange | undefined,
    ctx: IOperationContext | undefined
  ): IStorageIterator<[IStorageKey, T]> {
    /** Bounds capture at construction; data membership and values capture on the first actual next. */
    const captured = orderedRange(range)
    /** This actual iterator alone owns its timeout and caller abort subscriptions. */
    const merged = mergeSignals(ctx, report)
    /** The primary cleanup Promise seals further native advances synchronously. */
    let disposal: Promise<void> | undefined
    /** Symbolic disposal reports once through its separately cached derivative. */
    let symbolic: Promise<void> | undefined
    /** Iterator return shares the same cleanup while retaining its own result Promise. */
    let returned: Promise<IteratorResult<[IStorageKey, T]>> | undefined
    /** The generator supplies serialization of native next/return without another resource queue. */
    const native = (async function* () {
      controller.assertLive()
      throwIfAborted(merged.signal)
      /** Committed values are immutable to callers and snapshot with native membership. */
      const rows = [...ordered.record.range(captured)]
        .map((leaf) => liveEntry('record', encodeFlatStorageKey(leaf.value.key)))
        .filter((entry): entry is IMemoryEntry => entry !== undefined)
      for (const row of rows) {
        controller.assertLive()
        throwIfAborted(merged.signal)
        yield [clone(row.key), clone(row.value)] as [IStorageKey, T]
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
      next: () =>
        core.execution.run(
          { operation: MemoryOperation.iterateRecords, input: undefined, ctx },
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
        ),
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
    protectedRanges?: IMemoryRootMutation<unknown>['ranges']
  ): Promise<IConcurrencyAttempt<Awaited<R>>> {
    controller.assertLive()
    throwIfAborted(ctx.signal)
    /** Only touched identities retain draft entries; rollback never rewrites committed maps. */
    const draft = new Map<string, IMemoryDraft>()
    /** Each channel draft reuses the same compressed radix implementation, including tombstones. */
    const draftOrdered = {
      value: createOrderedRecordIndex<IMemoryDraft>(),
      bytes: createOrderedRecordIndex<IMemoryDraft>(),
      record: createOrderedRecordIndex<IMemoryDraft>()
    }
    /** First reads are repeatable until a write in this attempt replaces their snapshot. */
    const snapshots = new Map<string, IMemorySnapshot | undefined>()
    /** Per-key tombstone revisions detect delete/reinsert and other ABA writes. */
    const expected = new Map<
      string,
      { channel: IStorageChannel; encoded: string; key: IStorageKey; revision: number }
    >()
    /** A clear invalidates only channels already observed by this native attempt. */
    const snapshotEpochs = new Map<IStorageChannel, number>()
    /** The original owner retains the first asynchronous operation failure. */
    let failure: (Error & { readonly source: string; readonly code: string }) | undefined
    /** Capture the real revision once, before any draft read or write. */
    const track = (channel: IStorageChannel, encoded: string, key: IStorageKey): string => {
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
      channel: IStorageChannel,
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
                deadline: deadlines.get(id)
              }
        )
      }
      return snapshots.get(id)
    }
    /** Read own writes first; otherwise retain the first committed value in this attempt. */
    const txEntry = (channel: IStorageChannel, key: IStorageKey): IMemorySnapshot | undefined => {
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
    const txRead = (channel: IStorageChannel, key: IStorageKey): unknown => {
      /** Membership and an undefined-valued record remain separate facts. */
      const current = txEntry(channel, key)
      return current === undefined ? undefined : copyValue(channel, current.value, current.key)
    }
    /** Membership shares the same first snapshot, including undefined-valued records. */
    const txHas = (channel: IStorageChannel, encoded: string, key: IStorageKey): boolean => {
      /** A tombstone masks physical membership until the attempt commits. */
      const proposed = draft.get(identity(channel, encoded))
      return proposed ? !proposed.remove : txSnapshot(channel, encoded, key) !== undefined
    }
    /** Draft hash and ordered range lookup retain one actual proposed row reference. */
    const stageDraft = (entry: IMemoryDraft): void => {
      /** Replacing one draft value keeps its original independently owned key encoding. */
      const proposed = {
        ...entry,
        ordered: draftOrdered[entry.channel].get(entry.ordered)?.key ?? entry.ordered
      }
      draft.set(track(proposed.channel, proposed.encoded, proposed.key), proposed)
      draftOrdered[proposed.channel].set(proposed.ordered, proposed)
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
        remove: false,
        encoded,
        ordered: keyBytes,
        deadline: ttlMs === undefined ? current?.deadline : scheduler.now() + ttlMs
      })
    }
    /** Delete returns actual draft membership, so repeated keys count at most once. */
    const txRemove = (channel: IStorageChannel, key: IStorageKey): boolean => {
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
    /** Native text batches stage only into this attempt's existing draft and revision baseline. */
    const textDraft: IMemoryTextDraft = {
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
      removeByPrefix: (prefix) => {
        /** Native prefix localization reuses the original canonical bounds and ordered draft merge. */
        const captured = snapshotStorageKeyPrefix(prefix, STORAGE_MEMORY_BACKEND)
        /** Count only actual removals in this channel and this native attempt. */
        let count = 0
        for (const row of txRows('value', {
          lower: captured.lower,
          upper: captured.upper,
          upperOpen: true
        }))
          if (captured.matches(row.key) && txRemove('value', row.key)) count++
        return count
      }
    }
    /** TTL metadata changes stage beside the original value and never create a second draft. */
    const txTtl = (target: IMemoryTtlTarget, ms: number | undefined, persist: boolean): boolean => {
      /** A TTL target has already been captured by the original contract lock owner. */
      const channel = ttlChannel(target)
      const current = txEntry(channel, target.key)
      if (current === undefined || (persist && current.deadline === undefined)) return false
      stageDraft({
        ...current,
        channel,
        encoded: encodeFlatStorageKey(current.key),
        remove: ms === 0,
        deadline: persist ? undefined : scheduler.now() + ms!
      })
      return true
    }
    /** Remaining duration observes the same retained transaction value and captured deadline. */
    const txRemaining = (target: IMemoryTtlTarget): number | undefined => {
      /** Missing and unlimited rows share the documented undefined result. */
      const current = txEntry(ttlChannel(target), target.key)
      return current?.deadline === undefined
        ? undefined
        : Math.max(0, current.deadline - scheduler.now())
    }
    /** The same physical scope factory serves callbacks, nested operations and final checks. */
    const createScope = (): IMemoryScope<T> => {
      /** Each method closes over its own authentic view, never an independently registered guard. */
      const scope: IMemoryScope<T> = {
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
        invoke: (captured: I) => V
      ): Promise<Awaited<V>> {
        return runTransactionOperation(scope, (current) =>
          acceptedOperation(name, input, invoke, current)
        )
      }
      /** An already-admitted operation uses the same sole pipeline and native draft body. */
      function acceptedOperation<I, V>(
        name: string,
        input: I,
        invoke: (captured: I) => V,
        current: ITransactionScope
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
    /** The initial callback view is created and registered by the original owner exactly once. */
    const scope = createScope()
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
      }
    })
    /** Terminal observations retain identity captured while the original scope was valid. */
    const stage = core.stageBindings.transactionStages(store).forTransaction(scope)
    try {
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
      /** Each channel reports one batch after all physical draft rows have committed. */
      const changed = {
        value: [] as IStorageKey[],
        bytes: [] as IStorageKey[],
        record: [] as IStorageKey[]
      }
      for (const proposed of draft.values()) {
        /** Existing draft identities retain their already captured logical key. */
        const encoded = proposed.encoded
        /** New deadlines that elapsed within this draft commit as immediate absence. */
        if (
          proposed.remove ||
          (proposed.deadline !== undefined && proposed.deadline <= scheduler.now())
        ) {
          deadlines.delete(identity(proposed.channel, encoded))
          if (!data[proposed.channel].delete(encoded)) continue
          ordered[proposed.channel].delete(proposed.ordered)
        } else {
          /**
           * An overwrite retains its original live ordered encoding instead of keeping duplicate
           * key bytes.
           */
          const keyBytes = ordered[proposed.channel].get(proposed.ordered)?.key ?? proposed.ordered
          const entry = { key: proposed.key, value: proposed.value, ordered: keyBytes }
          data[proposed.channel].set(encoded, entry)
          ordered[proposed.channel].set(keyBytes, entry)
          if (proposed.deadline === undefined) deadlines.delete(identity(proposed.channel, encoded))
          else deadlines.set(identity(proposed.channel, encoded), proposed.deadline)
        }
        bump(proposed.channel, encoded)
        changed[proposed.channel].push(proposed.key)
      }
      for (const channel of MemoryState.channels)
        if (changed[channel].length !== 0) publish(channel, 'batch', changed[channel])
      void stage.afterCommit?.(
        MemoryState.channels.reduce((count, channel) => count + changed[channel].length, 0)
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
      control.close()
      draft.clear()
      snapshots.clear()
      expected.clear()
      snapshotEpochs.clear()
      for (const channel of MemoryState.channels) draftOrdered[channel].clear()
      void stage.onTransactionClose?.()
    }
  }

  /** Records capability binding composes only the supplied original transaction's real methods. */
  const bindRecords = (scope: ITransactionScope): ITransactionRecordsApi => ({
    query: <R>() =>
      createRecordQuery<R>(
        {
          asyncDisposeKey,
          pushdown: { source: MemoryState.querySource, operations: [], operators: [] },
          execute: () => scope.iterateRecords()
        },
        core.getChainMethods('query')
      ),
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
    if (target.channel === 'text' || target.channel === 'bytes' || target.channel === 'record')
      return target
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: STORAGE_MEMORY_BACKEND
    })
  }
  /** Only the canonical text tag differs from the original native value-channel name. */
  function ttlChannel(target: IMemoryTtlTarget): IStorageChannel {
    return target.channel === 'text' ? 'value' : target.channel
  }
  /** One metadata mutation keeps the same physical value, revision and local notification owner. */
  const changeDeadline = (
    target: IMemoryTtlTarget,
    ms: number | undefined,
    persist: boolean
  ): boolean => {
    /** Canonical target snapshot has already detached every mutable key segment. */
    const channel = ttlChannel(target)
    const encoded = encodeFlatStorageKey(target.key)
    const current = liveEntry(channel, encoded)
    const id = identity(channel, encoded)
    if (current === undefined || (persist && !deadlines.has(id))) return false
    if (persist) deadlines.delete(id)
    else deadlines.set(id, scheduler.now() + ms!)
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
        return { keys: [target], run: () => changeDeadline(target, ms, false) }
      }),
    remaining: (target, ctx) =>
      asyncEntry(MemoryOperation.ttlRemaining, target, ctx, (input) => {
        const target = captureTtlTarget(input)
        const channel = ttlChannel(target)
        const encoded = encodeFlatStorageKey(target.key)
        if (liveEntry(channel, encoded) === undefined) return undefined
        const deadline = deadlines.get(identity(channel, encoded))
        return deadline === undefined ? undefined : Math.max(0, deadline - scheduler.now())
      }),
    persist: (target, ctx) =>
      mutationEntry(MemoryOperation.ttlPersist, target, ctx, (input) => {
        const target = captureTtlTarget(input)
        return { keys: [target], run: () => changeDeadline(target, undefined, true) }
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
        return {
          keys: [lockKey.text(key)],
          run: () => {
            /** This calculation and its write share one synchronous admitted native turn. */
            const result = increment(read('value', key) as string | undefined)
            write('value', key, String(result))
            return result
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
                    data.record.delete(encoded)
                    deadlines.delete(identity('record', encoded))
                    ordered.record.delete(row.ordered)
                    bump('record', encoded)
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
  return { store, controller, installer, finalize }
}

/** Precise native store shape is retained by the first-party plugin factory. */
export type IMemoryBackendStore<T = unknown> = ReturnType<typeof createMemoryBackend<T>>['store']

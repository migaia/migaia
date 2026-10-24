import {
  kv,
  ttl,
  blob,
  records,
  durableChangeFeed,
  implement,
  provideCapabilities,
  assertStringStorageKey,
  assertStorageTtlDuration,
  snapshotOperationContext,
  lockKey,
  ConcurrencyPolicy,
  StorageContractError,
  StorageContractErrorCode,
  type IKeyValueApi,
  type IOperationContext,
  type IStorageBase,
  type ICapabilityInstallPort,
  type ITransactionBuilder,
  type ITransactionScope,
  type IBlobApi,
  type IRecordStore,
  type IStorageChange
} from '@migaia/storage-contract'
import type { ICodecValue } from '@migaia/serialize/codec'
import type { IStoragePluginCore, IStorageBorrowedBackend } from '@migaia/storage-host'
import { asyncDisposeKey, withAbort } from '@migaia/storage-host/authoring/backend'
import { raceWithAbort, UtilsAbortError } from '@migaia/utils/promise'
import { IdentifyError } from '@migaia/utils/error'
import type { IScheduledTask } from '@migaia/utils/scheduler'
import { CacheText, CacheWriteMode, CacheOperation, CacheHook } from './constants.js'
import { cacheError, invalidArgument, missingCapability } from './errors.js'
import { CacheErrorCode } from './error-code.js'
import {
  snapshotCachePolicy,
  shorten,
  type ICacheConfiguration,
  type ICachePolicy
} from './policy.js'
import { encodeEntry, parseEntry, entryInfo, type ICacheEntry, type ICacheFound } from './entry.js'
import { hashCacheBytes } from './key.js'
import type { ICacheStore, ICacheEntryInfo, ICacheLoader, ICacheBatchLoader } from './types.js'
import './hooks.js'

/** Borrowed native extras are admitted individually; capability methods retain their exact token. */
type ICacheNative = {
  tx?: () => ITransactionBuilder<ITransactionScope<unknown, typeof ttl>>
  subscribeChanges?: (listener: (change: IStorageChange) => void) => () => void
}
/** Every published tier keeps its original borrowing identity, with no disposal authority. */
type ITier = {
  borrowed: IStorageBorrowedBackend
  native: ICacheNative
  blob?: IStorageBorrowedBackend
}
/** One non-superseded flight owns one original loader Promise. */
type IFlight = {
  mode: ICachePolicy['mode']
  promise: Promise<ICacheEntryInfo<ICodecValue>>
  superseded: boolean
}
/** Pending writes are coalesced by logical key and do not create a retry queue. */
type IProjection = {
  store: ICacheStore
  installer: ICapabilityInstallPort
  flush(): Promise<void>
  pending(): boolean
  erase(key: string, prefix: boolean, upto?: number, strict?: boolean): Promise<number>
  propagation(change: IStorageChange, upto: number): Promise<void>
  reset(index: number): Promise<void>
}

/** A prepared write carries the original entry and the exact sampled per-tier deadlines. */
type IWriteItem = {
  key: string
  entry: ICacheEntry
  policy: ICachePolicy
  upto?: number
  expires?: readonly (number | undefined)[]
  indexed?: boolean
}

/** Coalesced back facts remain readable while their original native write is pending. */
type IPending = {
  entry: ICacheEntry
  policy: ICachePolicy
  tiers: Set<number>
  expires: readonly (number | undefined)[]
  writing?: Promise<void>
}

/** Physical cache composition shares the original controller and explicit borrowed tiers. */
type ICacheBackendContext = {
  /** Original configuration belongs to this physical namespace. */
  readonly configuration: ICacheConfiguration
  /** Original core belongs to this physical namespace. */
  readonly core: IStoragePluginCore

  /** Original borrowed objects are captured only during installation. */
  tiers: ITier[]

  /** Declared native feeds determine finite propagation and back-write admission. */
  feeds: number[]

  /** An optional declared transactional tier owns stampede lock admission. */
  lockIndex: number | undefined

  /** Tag lookup borrows its installed backend without taking disposal authority. */
  tags: IStorageBorrowedBackend | undefined

  /** Immutable org children share only the original controller and installed physical resources. */
  projections: Map<string, IProjection>

  /** Missing reliable cursors require lazy clearing of every subsequently accessed org projection. */
  untrustedFeeds: Set<number>

  /** Subscription resources are released after all admitted business work drains and flushes. */
  subscriptions: (() => void | Promise<void>)[]

  /** Symbolic disposal reuses one observed cleanup result. */
  symbolic: Promise<void> | undefined

  /** The installed scheduler owns periodic coalesced write flushing. */
  timer: IScheduledTask | undefined

  /** The host controller drains admitted work before physical resources close. */
  controller: ReturnType<IStoragePluginCore['createChangeController']>

  /** The default organization is published only after physical setup succeeds. */
  root: IProjection
}
export function createCacheStore(configuration: ICacheConfiguration, core: IStoragePluginCore) {
  /** Initialize physical owners in original order before a store escapes. */
  const cacheContext = { configuration, core } as ICacheBackendContext
  cacheContext.tiers = cacheContext.configuration.tiers.map((tier, index) => {
    const borrowed = cacheContext.core.getPublishedBackend(tier.backend)
    if (!borrowed.has(kv)) missingCapability(index, kv.name)
    const api = borrowed.use(kv)
    if (typeof api.removeByPrefix !== 'function')
      missingCapability(index, CacheOperation.removeByPrefix)
    if (tier.ttlMs !== undefined && !borrowed.has(ttl)) missingCapability(index, ttl.name)
    const offload =
      tier.offload === undefined
        ? undefined
        : cacheContext.core.getPublishedBackend(tier.offload.backend)
    if (offload && !offload.has(blob)) missingCapability(index, blob.name)
    return { borrowed, native: borrowed as IStorageBorrowedBackend & ICacheNative, blob: offload }
  })
  cacheContext.feeds = cacheContext.tiers.flatMap((tier, index) =>
    tier.borrowed.capabilities.changeFeed || tier.borrowed.has(durableChangeFeed) ? [index] : []
  )

  if (cacheContext.configuration.propagate)
    for (const index of cacheContext.feeds)
      for (let upper = 0; upper < index; upper++)
        if (cacheContext.configuration.tiers[upper]!.ttlMs === undefined)
          throw cacheError(CacheErrorCode.tierInvalid, undefined, upper)

  if (cacheContext.configuration.propagate)
    for (const [index, tier] of cacheContext.configuration.tiers.entries())
      if (
        tier.write === CacheWriteMode.back &&
        (index <= Math.max(-1, ...cacheContext.feeds) || tier.ttlMs === undefined)
      )
        throw cacheError(CacheErrorCode.tierInvalid, undefined, index)
  cacheContext.lockIndex =
    cacheContext.configuration.stampedeLock === undefined
      ? undefined
      : cacheContext.configuration.tiers.findIndex(
          (tier) => tier.backend === cacheContext.configuration.stampedeLock!.backend
        )

  if (
    cacheContext.lockIndex! !== undefined &&
    (!cacheContext.tiers[cacheContext.lockIndex!]!.borrowed.capabilities.transactions ||
      typeof cacheContext.tiers[cacheContext.lockIndex!]!.native.tx !== 'function')
  )
    missingCapability(cacheContext.lockIndex!, CacheText.lockCapability)
  cacheContext.tags =
    cacheContext.configuration.tagIndex === undefined
      ? undefined
      : cacheContext.core.getPublishedBackend(cacheContext.configuration.tagIndex.backend)

  if (
    cacheContext.tags &&
    (!cacheContext.tags.has(records) ||
      !cacheContext.tags.has(ttl) ||
      typeof Reflect.get(cacheContext.tags, CacheOperation.iterateRecords) !== 'function' ||
      typeof Reflect.get(cacheContext.tags, CacheOperation.putRecord) !== 'function')
  )
    missingCapability(-1, CacheText.tagCapability)
  cacheContext.projections = new Map<string, IProjection>()
  cacheContext.untrustedFeeds = new Set<number>()
  cacheContext.subscriptions = []
  cacheContext.controller = cacheContext.core.createChangeController({
    backend: CacheText.backend,
    finalize: async () => {
      cacheContext.timer?.cancel()
      for (const projection of cacheContext.projections.values()) await projection.flush()
      for (const close of cacheContext.subscriptions.reverse()) {
        try {
          await close()
        } catch (error) {
          report(cacheContext, error)
        }
      }
      cacheContext.projections.clear()
    }
  })
  cacheContext.root = bind(cacheContext, cacheContext.core.defaultOrgId)

  /** Durable consumers start in the original detect window after their earlier backends are ready. */
  cacheContext.core.registerDetect((signal) => detectCacheFeeds(cacheContext, signal))
  return {
    store: cacheContext.root.store,
    installer: cacheContext.root.installer,
    controller: cacheContext.controller,
    orgBinding: {
      backend: (orgId: string) => bind(cacheContext, orgId).store,
      drop: async (orgId: string) => {
        await bind(cacheContext, orgId).erase('', true)
      }
    }
  }
}

function report(cacheContext: ICacheBackendContext, error: unknown): void {
  return cacheContext.core.stageBindings.backendStages.report(error)
}

/** Physical keys are scoped by the cache prefix while organization routing remains host-owned. */
function physical(cacheContext: ICacheBackendContext, key: string): string {
  assertStringStorageKey(key, CacheText.backend)
  if (key === CacheText.cursor) throw invalidArgument()
  return cacheContext.configuration.prefix + key
}

/** Each timer tick flushes the current coalesced table once, never retries a dropped write. */
function schedule(cacheContext: ICacheBackendContext): void {
  if (cacheContext.timer || cacheContext.controller.closingSignal.aborted) return
  cacheContext.timer = cacheContext.core.featureExpose.getScheduler().schedule(() => {
    cacheContext.timer = undefined
    if (cacheContext.controller.closingSignal.aborted) return
    const release = cacheContext.controller.beginMutation()
    void Promise.all([...cacheContext.projections.values()].map((projection) => projection.flush()))
      .catch((error: unknown) => report(cacheContext, error))
      .finally(() => {
        release()
        if ([...cacheContext.projections.values()].some((projection) => projection.pending()))
          schedule(cacheContext)
      })
  }, cacheContext.configuration.writeBackIntervalMs)
  cacheContext.timer.unref?.()
}

/** An org binding never switches global state; every borrowed layer follows this fixed context. */
/** Physical cache composition shares the original controller and explicit borrowed tiers. */
type ICacheOrganizationContext = {
  /** Original cacheContext belongs to this physical namespace. */
  readonly cacheContext: ICacheBackendContext
  /** Original orgId belongs to this physical namespace. */
  readonly orgId: string

  existing: IProjection | undefined

  ports: ReturnType<IStoragePluginCore['getOrgContext']>

  identity: { backendId: string; backend: string; orgId: string }

  inflight: Map<string, IFlight>

  pending: Map<string, IPending>

  /** Each immutable org performs startup invalidation once for each untrusted durable source. */
  resetFeeds: Set<number>

  preparation: Promise<void> | undefined

  counts: {
    hits: number[]
    misses: number[]
    loads: number
    staleServed: number
    negativeHits: number
    invalidations: number
    writeBackDropped: number
    skipped: number[]
  }

  installer: ICapabilityInstallPort

  store: ICacheStore

  api: IKeyValueApi

  base: IStorageBase &
    Pick<
      ICacheStore,
      | 'backend'
      | 'getOrLoad'
      | 'getOrLoadEntry'
      | 'getOrLoadMany'
      | 'peek'
      | 'invalidate'
      | 'flush'
      | 'sweepOffload'
      | 'stats'
    >

  projection: IProjection
}
function bind(cacheContext: ICacheBackendContext, orgId: string): IProjection {
  /** Initialize physical owners in original order before a store escapes. */
  const organizationContext = { cacheContext, orgId } as ICacheOrganizationContext
  organizationContext.existing = organizationContext.cacheContext.projections.get(
    organizationContext.orgId
  )

  if (organizationContext.existing) return organizationContext.existing
  organizationContext.ports = organizationContext.cacheContext.core.getOrgContext(
    organizationContext.orgId
  )
  organizationContext.identity = {
    backendId: organizationContext.cacheContext.core.getBackendId(),
    backend: CacheText.backend,
    orgId: organizationContext.orgId
  }
  organizationContext.inflight = new Map<string, IFlight>()
  organizationContext.pending = new Map<string, IPending>()
  organizationContext.resetFeeds = new Set<number>()
  organizationContext.counts = {
    hits: organizationContext.cacheContext.tiers.map(() => 0),
    misses: organizationContext.cacheContext.tiers.map(() => 0),
    loads: 0,
    staleServed: 0,
    negativeHits: 0,
    invalidations: 0,
    writeBackDropped: 0,
    skipped: organizationContext.cacheContext.tiers.map(() => 0)
  }
  organizationContext.api = createCacheStoreApi(organizationContext)
  organizationContext.base = createCacheStoreBase(organizationContext)

  organizationContext.store = provideCapabilities(
    organizationContext.base,
    [implement(kv, organizationContext.api)] as const,
    {
      onInstaller: (port) => {
        organizationContext.installer = port
      }
    }
  ) as ICacheStore
  organizationContext.projection = {
    store: organizationContext.store,
    installer: organizationContext.installer,
    flush: () => flush(organizationContext),
    pending: () => organizationContext.pending.size > 0,
    erase: (
      key: string,
      prefix: boolean,
      upto = organizationContext.cacheContext.tiers.length,
      strict = false
    ) => erase(organizationContext, key, prefix, upto, strict),
    reset: async (index: number) => {
      await erase(organizationContext, '', true, index, true)
      organizationContext.resetFeeds.add(index)
    },
    propagation: async (change: IStorageChange, upto: number) => {
      if (change.channel !== CacheText.value && change.channel !== CacheText.all) return
      if (!change.keys) await erase(organizationContext, '', true, upto, true)
      else
        for (const key of change.keys)
          if (
            typeof key === 'string' &&
            key.startsWith(organizationContext.cacheContext.configuration.prefix) &&
            key !== organizationContext.cacheContext.configuration.prefix + CacheText.cursor
          )
            await erase(
              organizationContext,
              key.slice(organizationContext.cacheContext.configuration.prefix.length),
              false,
              upto,
              true
            )
    }
  }

  organizationContext.cacheContext.projections.set(
    organizationContext.orgId,
    organizationContext.projection
  )
  return organizationContext.projection
}

function route<T extends IStorageBorrowedBackend>(
  organizationContext: ICacheOrganizationContext,
  borrowed: T
): T {
  return organizationContext.ports.callContext.backend(borrowed)
}

function apiAt(organizationContext: ICacheOrganizationContext, index: number): IKeyValueApi {
  return route(organizationContext, organizationContext.cacheContext.tiers[index]!.borrowed).use(kv)
}

function blobAt(organizationContext: ICacheOrganizationContext, index: number): IBlobApi {
  return route(organizationContext, organizationContext.cacheContext.tiers[index]!.blob!).use(blob)
}

function prepare(organizationContext: ICacheOrganizationContext): Promise<void> {
  return (organizationContext.preparation ??= (async () => {
    for (const index of organizationContext.cacheContext.untrustedFeeds)
      if (!organizationContext.resetFeeds.has(index)) {
        await erase(organizationContext, '', true, index)
        organizationContext.resetFeeds.add(index)
      }
  })().finally(() => {
    organizationContext.preparation = undefined
  }))
}

/** Reports retain original errors; event payloads expose only a safe canonical code. */
function tierError(
  organizationContext: ICacheOrganizationContext,
  tier: number,
  operation: string,
  error: unknown
): void {
  organizationContext.cacheContext.core.emit(CacheHook.tierError, () => ({
    ...organizationContext.identity,
    tier,
    operation,
    code: IdentifyError.identityOf(error)?.code
  }))
  report(organizationContext.cacheContext, error)
}

/**
 * Work admission stays in the original lifecycle; caller cancellation never releases active work
 * early.
 */
function run<I, R>(
  organizationContext: ICacheOrganizationContext,
  operation: string,
  input: I,
  ctx: IOperationContext | undefined,
  invoke: (input: I) => Promise<R>
): Promise<R> {
  organizationContext.cacheContext.controller.assertLive()
  const context = snapshotOperationContext(ctx),
    release = organizationContext.cacheContext.controller.beginMutation()
  let started = false
  return withAbort(context, async (signal) => {
    started = true
    const work = prepare(organizationContext)
      .then(() =>
        organizationContext.ports.execution.run({ operation, input, ctx: context }, invoke)
      )
      .finally(release)
    try {
      return await raceWithAbort(() => work, {
        signal,
        cleanupPolicy: 'report',
        report: (error: unknown) => report(organizationContext.cacheContext, error)
      })
    } catch (error) {
      if (error instanceof UtilsAbortError)
        throw new StorageContractError(StorageContractErrorCode.aborted, {
          backend: CacheText.backend,
          cause: error
        })
      throw error
    }
  }).catch((error) => {
    if (!started) release()
    throw error
  })
}

/** Layer TTL is always set explicitly, including fill writes over an existing physical value. */
function deadline(
  organizationContext: ICacheOrganizationContext,
  index: number,
  entry: ICacheEntry,
  policy: ICachePolicy,
  now: number
): number | undefined {
  const milliseconds = Math.min(
    organizationContext.cacheContext.configuration.tiers[index]!.ttlMs ?? Infinity,
    policy.ttlMs ?? Infinity,
    entry.x === undefined ? Infinity : Math.max(0, entry.x - now)
  )
  return milliseconds === Infinity ? undefined : milliseconds
}

/** Actual layer deadlines are sampled once and remain fixed while a back write waits. */
function plan(
  organizationContext: ICacheOrganizationContext,
  entry: ICacheEntry,
  policy: ICachePolicy
): readonly (number | undefined)[] {
  const now = organizationContext.cacheContext.configuration.clock()
  return organizationContext.cacheContext.configuration.tiers.map((_, index) => {
    const ms = deadline(organizationContext, index, entry, policy, now)
    return ms === undefined
      ? undefined
      : now + shorten(organizationContext.cacheContext.configuration, ms)
  })
}

/** Pending writes and tag records share the same sampled expiry rather than extending on flush. */
function remaining(
  organizationContext: ICacheOrganizationContext,
  expires: readonly (number | undefined)[],
  index: number
): number | undefined {
  return expires[index] === undefined
    ? undefined
    : Math.max(0, expires[index]! - organizationContext.cacheContext.configuration.clock())
}

/** A layer's exact sampled hard bound survives an unavailable native expiry endpoint. */
function bounded(
  organizationContext: ICacheOrganizationContext,
  entry: ICacheEntry,
  expires: readonly (number | undefined)[],
  index: number
): ICacheEntry {
  return expires[index] === undefined
    ? entry
    : { ...entry, x: Math.min(entry.x ?? Infinity, expires[index]!) }
}

/** Positive per-call native TTLs are admitted before any source call or tier modification. */
function admitPolicy(
  organizationContext: ICacheOrganizationContext,
  policy: ICachePolicy
): ICachePolicy {
  if (policy.ttlMs !== undefined && policy.ttlMs > 0)
    for (const [index, tier] of organizationContext.cacheContext.tiers.entries())
      if (!tier.borrowed.has(ttl)) missingCapability(index, ttl.name)
  return policy
}

/** Shared batch TTL uses its original finite nonnegative domain, including immediate removal. */
function batchPolicy(
  organizationContext: ICacheOrganizationContext,
  ttlMs: number | undefined
): ICachePolicy {
  if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, CacheText.backend)
  if (
    ttlMs !== undefined &&
    organizationContext.cacheContext.configuration.tiers.some(
      (tier) => tier.ttlMs !== undefined && ttlMs > tier.ttlMs
    )
  )
    throw cacheError(CacheErrorCode.tierInvalid)
  return admitPolicy(organizationContext, {
    ...snapshotCachePolicy(organizationContext.cacheContext.configuration),
    ttlMs
  })
}

/** Object offload writes only encoded content and refreshes the native modification timestamp. */
async function stored(
  organizationContext: ICacheOrganizationContext,
  index: number,
  entry: ICacheEntry
): Promise<string> {
  let actual = entry
  const options = organizationContext.cacheContext.configuration.tiers[index]!.offload
  if (options && typeof entry.d === 'string') {
    const bytes = new TextEncoder().encode(entry.d)
    if (bytes.byteLength >= options.minBytes) {
      const key =
        organizationContext.cacheContext.configuration.prefix + (await hashCacheBytes(bytes))
      await blobAt(organizationContext, index).put(key, bytes)
      actual = { ...entry, d: { $blob: key, size: bytes.byteLength } }
    }
  }
  return JSON.stringify(actual)
}

/** A native write failure degrades this layer while preserving the loader's true result. */
async function writeOne(
  organizationContext: ICacheOrganizationContext,
  index: number,
  key: string,
  entry: ICacheEntry,
  policy: ICachePolicy,
  expires: readonly (number | undefined)[] = plan(organizationContext, entry, policy)
): Promise<boolean> {
  try {
    const ms = remaining(organizationContext, expires, index)
    if (ms === 0) {
      await apiAt(organizationContext, index).remove(
        physical(organizationContext.cacheContext, key)
      )
      return true
    }
    const actual = bounded(organizationContext, entry, expires, index),
      maximum = organizationContext.cacheContext.configuration.tiers[index]!.maxEntryBytes
    if (
      maximum !== undefined &&
      new TextEncoder().encode(JSON.stringify(actual)).byteLength > maximum
    ) {
      organizationContext.counts.skipped[index]!++
      return true
    }
    const raw = await stored(organizationContext, index, actual)
    await apiAt(organizationContext, index).set(
      physical(organizationContext.cacheContext, key),
      raw
    )
    if (ms !== undefined && organizationContext.cacheContext.tiers[index]!.borrowed.has(ttl))
      await route(organizationContext, organizationContext.cacheContext.tiers[index]!.borrowed)
        .use(ttl)
        .expire(lockKey.text(physical(organizationContext.cacheContext, key)), ms)
    else if (ms === undefined && organizationContext.cacheContext.tiers[index]!.borrowed.has(ttl))
      await route(organizationContext, organizationContext.cacheContext.tiers[index]!.borrowed)
        .use(ttl)
        .persist(lockKey.text(physical(organizationContext.cacheContext, key)))
    return true
  } catch (error) {
    tierError(organizationContext, index, CacheOperation.set, error)
    if (organizationContext.cacheContext.configuration.tiers[index]!.offload)
      organizationContext.counts.skipped[index]!++
    return false
  }
}

/** Tags are indexed first, ensuring an index failure cannot create an un-invalidatable value. */
async function indexTags(
  organizationContext: ICacheOrganizationContext,
  key: string,
  entry: ICacheEntry,
  policy: ICachePolicy,
  expires: readonly (number | undefined)[]
): Promise<boolean> {
  if (!entry.g?.length) return true
  try {
    const borrowed = route(organizationContext, organizationContext.cacheContext.tags!),
      native = borrowed as unknown as Omit<
        IRecordStore<ICodecValue>,
        'dispose' | typeof Symbol.asyncDispose
      >
    const limits = organizationContext.cacheContext.configuration.tiers.map((_, index) =>
      remaining(organizationContext, expires, index)
    )
    const maximum = limits.some((value) => value === undefined)
      ? undefined
      : Math.max(...(limits as number[]))
    for (const tag of entry.g) {
      const target = [organizationContext.cacheContext.configuration.prefix, tag, key]
      await native.putRecord({ key }, target)
      if (maximum !== undefined) await borrowed.use(ttl).expire(lockKey.record(target), maximum)
      else await borrowed.use(ttl).persist(lockKey.record(target))
    }
    return true
  } catch (error) {
    tierError(organizationContext, -1, CacheOperation.tags, error)
    return false
  }
}

/** Slow through tiers finish first; back tiers only replace the same logical key's pending facts. */
async function write(
  organizationContext: ICacheOrganizationContext,
  key: string,
  entry: ICacheEntry,
  policy: ICachePolicy,
  upto = organizationContext.cacheContext.tiers.length,
  skip?: number,
  expires: readonly (number | undefined)[] = plan(organizationContext, entry, policy),
  indexed = false
): Promise<void> {
  if (
    upto === organizationContext.cacheContext.tiers.length &&
    !indexed &&
    !(await indexTags(organizationContext, key, entry, policy, expires))
  )
    return
  for (let index = upto - 1; index >= 0; index--) {
    if (index === skip) continue
    if (
      organizationContext.cacheContext.configuration.tiers[index]!.write === CacheWriteMode.back
    ) {
      const prior = organizationContext.pending.get(key)
      if (prior && prior.entry === entry) prior.tiers.add(index)
      else
        organizationContext.pending.set(key, {
          entry,
          policy,
          expires,
          tiers: new Set([...(prior?.entry === entry ? prior.tiers : []), index])
        })
      schedule(organizationContext.cacheContext)
    } else await writeOne(organizationContext, index, key, entry, policy, expires)
  }
}

/** Decode a layer and dispose its exact one-consumer object handle even when decoding fails. */
async function decode(
  organizationContext: ICacheOrganizationContext,
  index: number,
  key: string,
  raw: string | null | undefined,
  staleAfterMs?: number,
  removeExpired: () => Promise<void> = () =>
    apiAt(organizationContext, index).remove(physical(organizationContext.cacheContext, key))
): Promise<ICacheFound | undefined> {
  if (raw == null) return undefined
  try {
    const entry = parseEntry(raw)
    if (
      entry.x !== undefined &&
      entry.x <= organizationContext.cacheContext.configuration.clock()
    ) {
      await removeExpired()
      return undefined
    }
    let data = typeof entry.d === 'string' ? entry.d : undefined
    if (entry.d && typeof entry.d === 'object') {
      if (
        !organizationContext.cacheContext.tiers[index]!.blob ||
        !entry.d.$blob.startsWith(organizationContext.cacheContext.configuration.prefix)
      )
        throw invalidArgument()
      const object = await blobAt(organizationContext, index).get(entry.d.$blob)
      if (!object) throw invalidArgument()
      try {
        const bytes = await object.bytes()
        if (bytes.byteLength !== entry.d.size) throw invalidArgument()
        data = new TextDecoder().decode(bytes)
      } finally {
        await object[asyncDisposeKey]()
      }
    }
    return {
      entry,
      raw,
      info: await entryInfo(
        organizationContext.cacheContext.configuration,
        entry,
        index,
        data,
        staleAfterMs
      )
    }
  } catch (error) {
    tierError(organizationContext, index, CacheOperation.decode, error)
    return undefined
  }
}

/** Observe one native tier lookup; pending back values precede the first possible stale read. */
async function read(
  organizationContext: ICacheOrganizationContext,
  key: string,
  policy: ICachePolicy,
  fill: boolean
): Promise<ICacheFound | undefined> {
  for (let index = 0; index < organizationContext.cacheContext.tiers.length; index++) {
    let found: ICacheFound | undefined
    if (
      organizationContext.cacheContext.configuration.tiers[index]!.write === CacheWriteMode.back &&
      organizationContext.pending.has(key)
    ) {
      const item = organizationContext.pending.get(key)!
      found = await decode(
        organizationContext,
        index,
        key,
        JSON.stringify(bounded(organizationContext, item.entry, item.expires, index)),
        policy.staleAfterMs
      )
    } else {
      try {
        found = await decode(
          organizationContext,
          index,
          key,
          await apiAt(organizationContext, index).get(
            physical(organizationContext.cacheContext, key)
          ),
          policy.staleAfterMs
        )
      } catch (error) {
        tierError(organizationContext, index, CacheOperation.get, error)
      }
    }
    if (found) {
      organizationContext.counts.hits[index]!++
      if (found.info.negative) organizationContext.counts.negativeHits++
      if (found.info.stale) organizationContext.counts.staleServed++
      organizationContext.cacheContext.core.emit(CacheHook.hit, () => ({
        ...organizationContext.identity,
        tier: index,
        stale: found!.info.stale,
        negative: found!.info.negative
      }))
      if (fill && index) await write(organizationContext, key, found.entry, policy, index)
      return found
    }
    organizationContext.counts.misses[index]!++
    organizationContext.cacheContext.core.emit(CacheHook.miss, () => ({
      ...organizationContext.identity,
      tier: index
    }))
  }
  return undefined
}

/** Invalidations detach the original flight rather than retaining generations outside its Map. */
function supersede(
  organizationContext: ICacheOrganizationContext,
  matches: (key: string) => boolean,
  clearPending = true
): void {
  for (const [key, flight] of organizationContext.inflight)
    if (matches(key)) {
      flight.superseded = true
      organizationContext.inflight.delete(key)
    }
  if (clearPending)
    for (const key of organizationContext.pending.keys())
      if (matches(key)) organizationContext.pending.delete(key)
}

/** One source failure is shared by all joined callers and never stored as a negative result. */
async function callLoader(
  organizationContext: ICacheOrganizationContext,
  load: ICacheLoader<ICodecValue>
): Promise<ICodecValue | undefined> {
  organizationContext.counts.loads++
  const start = organizationContext.cacheContext.configuration.clock()
  let value: ICodecValue | undefined
  try {
    value = await load(organizationContext.cacheContext.controller.closingSignal)
    return value
  } catch (error) {
    throw cacheError(CacheErrorCode.loadFailed, error)
  } finally {
    organizationContext.cacheContext.core.emit(CacheHook.load, () => ({
      ...organizationContext.identity,
      elapsedMs: organizationContext.cacheContext.configuration.clock() - start,
      found: value !== undefined
    }))
  }
}

/** The shared flight lease survives cancellation of every individual caller. */
/** Physical cache composition shares the original controller and explicit borrowed tiers. */
type ICacheFlightContext = {
  /** Original organizationContext belongs to this physical namespace. */
  readonly organizationContext: ICacheOrganizationContext
  /** Original key belongs to this physical namespace. */
  readonly key: string
  /** Original load belongs to this physical namespace. */
  readonly load: ICacheLoader<ICodecValue>
  /** Original policy belongs to this physical namespace. */
  readonly policy: ICachePolicy

  prior: IFlight | undefined

  release: () => void

  row: IFlight
}
function flight(
  organizationContext: ICacheOrganizationContext,
  key: string,
  load: ICacheLoader<ICodecValue>,
  policy: ICachePolicy
): Promise<ICacheEntryInfo<ICodecValue>> {
  /** Initialize physical owners in original order before a store escapes. */
  const flightContext = { organizationContext, key, load, policy } as ICacheFlightContext
  flightContext.prior = flightContext.organizationContext.inflight.get(flightContext.key)

  if (flightContext.prior) return flightContext.prior.promise
  flightContext.release = flightContext.organizationContext.cacheContext.controller.beginMutation()
  flightContext.row = { superseded: false, mode: flightContext.policy.mode, promise: undefined! }

  flightContext.row.promise = Promise.resolve()
    .then(() => executeCacheFlight(flightContext))
    .finally(() => {
      if (flightContext.organizationContext.inflight.get(flightContext.key) === flightContext.row)
        flightContext.organizationContext.inflight.delete(flightContext.key)
      flightContext.release()
    })

  flightContext.organizationContext.inflight.set(flightContext.key, flightContext.row)
  return flightContext.row.promise
}

async function executeCacheFlight(
  flightContext: ICacheFlightContext
): Promise<ICacheEntryInfo<ICodecValue>> {
  let entry: ICacheEntry | undefined,
    value: ICodecValue | undefined,
    locked = false,
    expires: readonly (number | undefined)[] | undefined,
    lockedHit: ICacheFound | undefined
  if (flightContext.organizationContext.cacheContext.lockIndex! !== undefined) {
    const borrowed = route(
        flightContext.organizationContext,
        flightContext.organizationContext.cacheContext.tiers[
          flightContext.organizationContext.cacheContext.lockIndex!
        ]!.borrowed
      ),
      native = borrowed as IStorageBorrowedBackend & ICacheNative
    const result = await native.tx!()
      .lock(
        lockKey.text(physical(flightContext.organizationContext.cacheContext, flightContext.key))
      )
      .concurrency(
        ConcurrencyPolicy.wait({
          timeoutMs:
            flightContext.organizationContext.cacheContext.configuration.stampedeLock!.timeoutMs
        })
      )
      .run((tx) => loadLockedCacheFlight(flightContext, tx))
    entry = result.entry
    value = result.value
    locked = true
    expires = result.expires
    lockedHit = result.cached
  } else {
    value = await callLoader(flightContext.organizationContext, flightContext.load)
    entry = await encodeEntry(
      flightContext.organizationContext.cacheContext.configuration,
      value,
      flightContext.policy
    )
  }
  if (entry && !flightContext.row.superseded)
    await write(
      flightContext.organizationContext,
      flightContext.key,
      entry,
      flightContext.policy,
      lockedHit
        ? flightContext.organizationContext.cacheContext.lockIndex!
        : flightContext.organizationContext.cacheContext.tiers.length,
      locked ? flightContext.organizationContext.cacheContext.lockIndex! : undefined,
      expires,
      locked
    )
  if (lockedHit) return lockedHit.info
  return {
    value,
    tier: undefined,
    stale: false,
    negative: value === undefined,
    ageMs: entry
      ? flightContext.organizationContext.cacheContext.configuration.clock() - entry.w
      : undefined,
    meta: entry?.m,
    tags: entry?.g ?? flightContext.policy.tags
  }
}

/** Cache read/load operates beneath one original public pipeline. */
async function loadEntry<T extends ICodecValue>(
  organizationContext: ICacheOrganizationContext,
  key: string,
  load: ICacheLoader<T>,
  policy: ICachePolicy
): Promise<ICacheEntryInfo<T>> {
  physical(organizationContext.cacheContext, key)
  if (typeof load !== 'function') throw invalidArgument()
  if (policy.mode === CacheText.bypass)
    return {
      value: await callLoader(organizationContext, load),
      tier: undefined,
      stale: false,
      negative: false,
      ageMs: undefined,
      tags: policy.tags
    } as ICacheEntryInfo<T>
  if (
    policy.mode === CacheText.refresh &&
    organizationContext.inflight.get(key)?.mode !== CacheText.refresh
  )
    supersede(organizationContext, (value) => value === key)
  if (policy.mode === CacheText.normal) {
    const found = await read(organizationContext, key, policy, true)
    if (found) {
      if (found.info.stale)
        void flight(organizationContext, key, load, policy).catch((error: unknown) =>
          report(organizationContext.cacheContext, error)
        )
      return found.info as ICacheEntryInfo<T>
    }
  }
  return flight(organizationContext, key, load, policy) as Promise<ICacheEntryInfo<T>>
}

/** Actual invalidation errors remain visible to reliable feeds instead of acknowledging stale data. */
async function erase(
  organizationContext: ICacheOrganizationContext,
  key: string,
  prefix: boolean,
  upto = organizationContext.cacheContext.tiers.length,
  strict = false
): Promise<number> {
  /** Propagation touches only through tiers above its feed; lower back facts keep their owner. */
  supersede(
    organizationContext,
    (value) => (prefix ? value.startsWith(key) : value === key),
    upto === organizationContext.cacheContext.tiers.length
  )
  let removed = 0,
    first: unknown
  for (let index = 0; index < upto; index++) {
    try {
      if (prefix)
        removed += await apiAt(organizationContext, index).removeByPrefix(
          physical(organizationContext.cacheContext, key)
        )
      else {
        const api = apiAt(organizationContext, index)
        removed = Math.max(
          removed,
          (await api.has(physical(organizationContext.cacheContext, key))) ? 1 : 0
        )
        await api.remove(physical(organizationContext.cacheContext, key))
      }
    } catch (error) {
      tierError(organizationContext, index, CacheOperation.invalidate, error)
      first ??= error
    }
  }
  if (strict && first !== undefined) throw first
  organizationContext.counts.invalidations++
  organizationContext.cacheContext.core.emit(CacheHook.invalidate, () => ({
    ...organizationContext.identity,
    tiers: upto,
    prefix
  }))
  return removed
}

/** The same coalesced facts remain readable until their native write settles or is replaced. */
async function flush(organizationContext: ICacheOrganizationContext): Promise<void> {
  const items = [...organizationContext.pending]
  for (const [key, item] of items) {
    item.writing ??= (async () => {
      try {
        for (const index of [...item.tiers].reverse())
          if (
            !(await writeOne(
              organizationContext,
              index,
              key,
              item.entry,
              item.policy,
              item.expires
            ))
          ) {
            organizationContext.counts.writeBackDropped++
            organizationContext.cacheContext.core.emit(CacheHook.writeBackDropped, () => ({
              ...organizationContext.identity,
              tier: index,
              count: 1
            }))
          }
      } finally {
        if (organizationContext.pending.get(key) === item) organizationContext.pending.delete(key)
      }
    })()
    await item.writing
  }
}

function defaults(organizationContext: ICacheOrganizationContext): ICachePolicy {
  return snapshotCachePolicy(organizationContext.cacheContext.configuration)
}

/** Flat KV never exposes codec entries through text APIs. */
async function get(
  organizationContext: ICacheOrganizationContext,
  key: string
): Promise<string | null> {
  const found = await read(organizationContext, key, defaults(organizationContext), true)
  return found?.entry.t === CacheText.string && typeof found.info.value === 'string'
    ? found.info.value
    : null
}

/** JavaScript batch admission detaches every entry before any pipeline or tier operation. */
function captureEntries(
  organizationContext: ICacheOrganizationContext,
  entries: unknown
): { key: string; value: string; ttlMs?: number }[] {
  if (!Array.isArray(entries) || Object.keys(entries).length !== entries.length)
    throw invalidArgument()
  const seen = new Set<string>()
  return entries.map((item) => {
    if (!item || typeof item !== 'object') throw invalidArgument()
    const { key, value, ttlMs } = item
    assertStringStorageKey(key, CacheText.backend)
    if (typeof value !== 'string' || seen.has(key)) throw invalidArgument()
    batchPolicy(organizationContext, ttlMs)
    seen.add(key)
    return { key, value, ttlMs }
  })
}

function createCacheStoreApi(
  organizationContext: ICacheOrganizationContext
): ICacheOrganizationContext['api'] {
  return {
    get: (key, ctx) => {
      physical(organizationContext.cacheContext, key)
      return run(organizationContext, CacheOperation.get, key, ctx, (actual) =>
        get(organizationContext, actual)
      )
    },
    has: (key, ctx) => {
      physical(organizationContext.cacheContext, key)
      return run(
        organizationContext,
        CacheOperation.has,
        key,
        ctx,
        async (actual) => (await get(organizationContext, actual)) !== null
      )
    },
    set: (key, value, ctx) => {
      physical(organizationContext.cacheContext, key)
      if (typeof value !== 'string') throw invalidArgument()
      return run(organizationContext, CacheOperation.set, { key, value }, ctx, async (actual) => {
        physical(organizationContext.cacheContext, actual.key)
        if (typeof actual.value !== 'string') throw invalidArgument()
        supersede(organizationContext, (item) => item === actual.key)
        const policy = defaults(organizationContext),
          entry = await encodeEntry(
            organizationContext.cacheContext.configuration,
            actual.value,
            policy,
            true
          )
        await write(organizationContext, actual.key, entry!, policy)
      })
    },
    remove: (key, ctx) => {
      physical(organizationContext.cacheContext, key)
      return run(organizationContext, CacheOperation.remove, key, ctx, async (actual) => {
        await erase(organizationContext, actual, false)
      })
    },
    keys: (ctx) =>
      run(organizationContext, CacheOperation.keys, undefined, ctx, async () => {
        let keys: string[]
        try {
          keys = (await apiAt(organizationContext, 0).keys())
            .filter(
              (key) =>
                key.startsWith(organizationContext.cacheContext.configuration.prefix) &&
                key !== organizationContext.cacheContext.configuration.prefix + CacheText.cursor
            )
            .map((key) => key.slice(organizationContext.cacheContext.configuration.prefix.length))
        } catch (error) {
          tierError(organizationContext, 0, CacheOperation.keys, error)
          return []
        }
        const result: string[] = []
        for (const key of keys) {
          const found = await decode(
            organizationContext,
            0,
            key,
            await apiAt(organizationContext, 0).get(physical(organizationContext.cacheContext, key))
          )
          if (found?.entry.t === CacheText.string && !found.info.negative) result.push(key)
        }
        return result
      }),
    clearValues: (ctx) =>
      run(organizationContext, CacheOperation.clearValues, undefined, ctx, async () => {
        await erase(organizationContext, '', true)
      }),
    clearAll: (ctx) =>
      run(organizationContext, CacheOperation.clearAll, undefined, ctx, async () => {
        await erase(organizationContext, '', true)
      }),
    removeByPrefix: (prefix, ctx) => {
      assertStringStorageKey(prefix, CacheText.backend)
      organizationContext.cacheContext.controller.assertLive()
      if (organizationContext.cacheContext.tiers.length > 1)
        missingCapability(-1, CacheText.prefixCountCapability)
      return run(organizationContext, CacheOperation.removeByPrefix, prefix, ctx, (actual) =>
        erase(organizationContext, actual as string, true)
      )
    },
    getMany: (keys, ctx) => {
      const captured = captureKeys(organizationContext.cacheContext, keys)
      return run(organizationContext, CacheOperation.getMany, captured, ctx, async (actual) => {
        const keys = captureKeys(organizationContext.cacheContext, actual),
          found = await readBatch(organizationContext, keys, defaults(organizationContext), true)
        return keys.map((key) => {
          const match = found.get(key)
          return match?.entry.t === CacheText.string && typeof match.info.value === 'string'
            ? match.info.value
            : undefined
        })
      })
    },
    setMany: (entries, ctx) => {
      const captured = captureEntries(organizationContext, entries)
      return run(organizationContext, CacheOperation.setMany, captured, ctx, async (actual) => {
        const seen = new Set<string>(),
          items: { key: string; entry: ICacheEntry; policy: ICachePolicy }[] = []
        for (const item of captureEntries(organizationContext, actual)) {
          physical(organizationContext.cacheContext, item.key)
          if (typeof item.value !== 'string' || seen.has(item.key)) throw invalidArgument()
          seen.add(item.key)
          const policy = batchPolicy(organizationContext, item.ttlMs)
          const entry = await encodeEntry(
            organizationContext.cacheContext.configuration,
            item.value,
            policy,
            true
          )
          items.push({ key: item.key, entry: entry!, policy })
        }
        for (const item of items) supersede(organizationContext, (key) => key === item.key)
        await writeBatch(organizationContext, items)
      })
    },
    removeMany: (keys, ctx) => {
      const captured = [...new Set(captureKeys(organizationContext.cacheContext, keys))]
      return run(organizationContext, CacheOperation.removeMany, captured, ctx, async (actual) => {
        let count = 0
        for (const key of captureKeys(organizationContext.cacheContext, actual))
          count += await erase(organizationContext, key, false)
        return count
      })
    }
  }
}

function createCacheStoreBase(
  organizationContext: ICacheOrganizationContext
): ICacheOrganizationContext['base'] {
  return {
    backend: CacheText.backend,
    capabilities: {
      batch: organizationContext.cacheContext.tiers.length === 1,
      syncRead: false,
      binary: false,
      records: false,
      transactions: false,
      iteration: false,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    dispose: () => organizationContext.cacheContext.controller.dispose(),
    [asyncDisposeKey]: () =>
      (organizationContext.cacheContext.symbolic ??= organizationContext.cacheContext.controller
        .dispose()
        .then(undefined, (error: unknown) => report(organizationContext.cacheContext, error))),
    getOrLoad: (key, load, options) =>
      organizationContext.store.getOrLoadEntry(key, load, options).then((info) => info.value),
    getOrLoadEntry: (key, load, options) => {
      physical(organizationContext.cacheContext, key)
      const policy = admitPolicy(
        organizationContext,
        snapshotCachePolicy(organizationContext.cacheContext.configuration, options)
      )
      return run(
        organizationContext,
        CacheOperation.getOrLoad,
        { key, load },
        policy.ctx,
        (actual) => loadEntry(organizationContext, actual.key, actual.load, policy)
      )
    },
    getOrLoadMany: (keys, load, options) => {
      const captured = [...new Set(captureKeys(organizationContext.cacheContext, keys))],
        policy = admitPolicy(
          organizationContext,
          snapshotCachePolicy(organizationContext.cacheContext.configuration, options)
        )
      return run(
        organizationContext,
        CacheOperation.getOrLoadMany,
        captured,
        policy.ctx,
        (actual) =>
          loadMany(
            organizationContext,
            captureKeys(organizationContext.cacheContext, actual),
            load,
            policy
          )
      )
    },
    peek: <T extends ICodecValue>(key: string, ctx?: IOperationContext) => {
      physical(organizationContext.cacheContext, key)
      return run(
        organizationContext,
        CacheOperation.peek,
        key,
        ctx,
        async (actual) =>
          (await read(organizationContext, actual, defaults(organizationContext), false))?.info
      ) as Promise<ICacheEntryInfo<T> | undefined>
    },
    invalidate: (target, ctx) => {
      const captured =
        typeof target === 'string'
          ? { key: target }
          : 'prefix' in target
            ? { prefix: target.prefix }
            : { tag: target.tag }
      if ('key' in captured) physical(organizationContext.cacheContext, captured.key!)
      else if ('prefix' in captured) physical(organizationContext.cacheContext, captured.prefix!)
      else if (typeof captured.tag !== 'string' || !organizationContext.cacheContext.tags)
        throw cacheError(CacheErrorCode.tierInvalid)
      return run(organizationContext, CacheOperation.invalidate, captured, ctx, async (actual) => {
        if ('key' in actual) await erase(organizationContext, actual.key!, false)
        else if ('prefix' in actual) await erase(organizationContext, actual.prefix!, true)
        else {
          const borrowed = route(organizationContext, organizationContext.cacheContext.tags!),
            native = borrowed as unknown as Omit<
              IRecordStore<{ key: string }>,
              'dispose' | typeof Symbol.asyncDispose
            >
          const iterator = native.iterateRecords({
            lower: [organizationContext.cacheContext.configuration.prefix, actual.tag!],
            upper: [
              organizationContext.cacheContext.configuration.prefix,
              actual.tag!,
              new ArrayBuffer(0)
            ],
            upperOpen: true
          })
          try {
            for await (const [, value] of iterator) {
              if (typeof value.key !== 'string') throw invalidArgument()
              await erase(organizationContext, value.key, false)
            }
          } finally {
            await iterator[asyncDisposeKey]()
          }
          await borrowed
            .use(records)
            .removeByPrefix([organizationContext.cacheContext.configuration.prefix, actual.tag!])
        }
      })
    },
    flush: (ctx) =>
      run(organizationContext, CacheOperation.flush, undefined, ctx, () =>
        flush(organizationContext)
      ),
    sweepOffload: (ctx) =>
      run(organizationContext, CacheOperation.sweepOffload, undefined, ctx, async () => {
        let count = 0
        const swept = new Set<string>()
        for (const [index, tier] of organizationContext.cacheContext.configuration.tiers.entries())
          if (tier.offload && !swept.has(tier.offload.backend)) {
            swept.add(tier.offload.backend)
            const retention = Math.max(
              ...organizationContext.cacheContext.configuration.tiers
                .filter((item) => item.offload?.backend === tier.offload!.backend)
                .map((item) => item.ttlMs!)
            )
            let after: string | undefined
            do {
              const page = await blobAt(organizationContext, index).list({
                prefix: organizationContext.cacheContext.configuration.prefix,
                after,
                limit: 256
              })
              for (const info of page.items)
                if (
                  info.updatedAt <
                  organizationContext.cacheContext.configuration.clock() - retention
                )
                  if (await blobAt(organizationContext, index).remove(info.key)) count++
              after = page.next
            } while (after !== undefined)
          }
        return count
      }),
    stats: () => cacheStats(organizationContext)
  }
}

/** All selected entries share one native batch per through tier, with per-key back coalescing. */
async function writeBatch(
  organizationContext: ICacheOrganizationContext,
  items: readonly IWriteItem[],
  skip?: number
): Promise<void> {
  const accepted: ((typeof items)[number] & { expires: readonly (number | undefined)[] })[] = []
  for (const item of items) {
    const expires = item.expires ?? plan(organizationContext, item.entry, item.policy)
    if (
      item.indexed ||
      item.upto !== undefined ||
      (await indexTags(organizationContext, item.key, item.entry, item.policy, expires))
    )
      accepted.push({ ...item, expires })
  }
  for (let index = organizationContext.cacheContext.tiers.length - 1; index >= 0; index--) {
    if (index === skip) continue
    const entries: { key: string; value: string; ttlMs?: number }[] = []
    for (const item of accepted) {
      if (index >= (item.upto ?? organizationContext.cacheContext.tiers.length)) continue
      if (
        organizationContext.cacheContext.configuration.tiers[index]!.write === CacheWriteMode.back
      ) {
        const prior = organizationContext.pending.get(item.key)
        if (prior?.entry === item.entry) prior.tiers.add(index)
        else
          organizationContext.pending.set(item.key, {
            entry: item.entry,
            policy: item.policy,
            expires: item.expires,
            tiers: new Set([index])
          })
        schedule(organizationContext.cacheContext)
        continue
      }
      try {
        const ms = remaining(organizationContext, item.expires, index)
        if (ms === 0) {
          entries.push({
            key: physical(organizationContext.cacheContext, item.key),
            value: '',
            ttlMs: 0
          })
          continue
        }
        const actual = bounded(organizationContext, item.entry, item.expires, index),
          maximum = organizationContext.cacheContext.configuration.tiers[index]!.maxEntryBytes
        if (
          maximum !== undefined &&
          new TextEncoder().encode(JSON.stringify(actual)).byteLength > maximum
        ) {
          organizationContext.counts.skipped[index]!++
          continue
        }
        const value = await stored(organizationContext, index, actual)
        entries.push({
          key: physical(organizationContext.cacheContext, item.key),
          value,
          ttlMs: remaining(organizationContext, item.expires, index)
        })
      } catch (error) {
        tierError(organizationContext, index, CacheOperation.setMany, error)
        organizationContext.counts.skipped[index]!++
      }
    }
    if (entries.length)
      try {
        await apiAt(organizationContext, index).setMany(entries)
        if (organizationContext.cacheContext.tiers[index]!.borrowed.has(ttl))
          for (const item of entries)
            if (item.ttlMs === undefined)
              await route(
                organizationContext,
                organizationContext.cacheContext.tiers[index]!.borrowed
              )
                .use(ttl)
                .persist(lockKey.text(item.key as string))
      } catch (error) {
        tierError(organizationContext, index, CacheOperation.setMany, error)
      }
  }
}

/** One native getMany per visited layer retains the remaining key order and exact input count. */
async function readBatch(
  organizationContext: ICacheOrganizationContext,
  keys: readonly string[],
  policy: ICachePolicy,
  fill: boolean
): Promise<Map<string, ICacheFound>> {
  const missing = new Set(keys),
    found = new Map<string, ICacheFound>()
  for (
    let index = 0;
    index < organizationContext.cacheContext.tiers.length && missing.size;
    index++
  ) {
    const targets = [...missing],
      pendingRows =
        organizationContext.cacheContext.configuration.tiers[index]!.write === CacheWriteMode.back
          ? new Map(
              targets.flatMap((key) => {
                const item = organizationContext.pending.get(key)
                return item ? [[key, item] as const] : []
              })
            )
          : new Map<string, IPending>()
    const nativeKeys = targets.filter((key) => !pendingRows.has(key))
    let raws: readonly (string | undefined)[] = []
    if (nativeKeys.length)
      try {
        raws = await apiAt(organizationContext, index).getMany(
          nativeKeys.map((key: string) => physical(organizationContext.cacheContext, key))
        )
      } catch (error) {
        tierError(organizationContext, index, CacheOperation.getMany, error)
      }
    const nativeRows = new Map(nativeKeys.map((key, position) => [key, raws[position]]))
    for (const key of targets) {
      const item = pendingRows.get(key),
        match = await decode(
          organizationContext,
          index,
          key,
          item
            ? JSON.stringify(bounded(organizationContext, item.entry, item.expires, index))
            : nativeRows.get(key),
          policy.staleAfterMs
        )
      if (match) {
        found.set(key, match)
        missing.delete(key)
        organizationContext.counts.hits[index]!++
        if (match.info.negative) organizationContext.counts.negativeHits++
        if (match.info.stale) organizationContext.counts.staleServed++
        organizationContext.cacheContext.core.emit(CacheHook.hit, () => ({
          ...organizationContext.identity,
          tier: index,
          stale: match.info.stale,
          negative: match.info.negative
        }))
      } else {
        organizationContext.counts.misses[index]!++
        organizationContext.cacheContext.core.emit(CacheHook.miss, () => ({
          ...organizationContext.identity,
          tier: index
        }))
      }
    }
  }
  if (fill)
    await writeBatch(
      organizationContext,
      [...found].map(([key, match]) => ({
        key,
        entry: match.entry,
        policy,
        upto: match.info.tier
      }))
    )
  return found
}

/** Batched misses register in the same flight Map before the sole batch loader is dispatched. */
async function loadMany<T extends ICodecValue>(
  organizationContext: ICacheOrganizationContext,
  keys: readonly string[],
  load: ICacheBatchLoader<T>,
  policy: ICachePolicy
): Promise<ReadonlyMap<string, T | undefined>> {
  if (typeof load !== 'function') throw invalidArgument()
  if (policy.mode === CacheText.refresh)
    for (const key of keys)
      if (organizationContext.inflight.get(key)?.mode !== CacheText.refresh)
        supersede(organizationContext, (item) => item === key)
  if (policy.mode === CacheText.bypass) {
    try {
      const values = await load(keys, organizationContext.cacheContext.controller.closingSignal)
      return new Map(keys.map((key) => [key, values.get(key)]))
    } catch (error) {
      throw cacheError(CacheErrorCode.loadFailed, error)
    }
  }
  const found =
    policy.mode === CacheText.normal
      ? await readBatch(organizationContext, keys, policy, true)
      : new Map<string, ICacheFound>()
  const missing = keys.filter((key) => !found.has(key) || found.get(key)!.info.stale)
  const fresh = missing.filter((key) => !organizationContext.inflight.has(key))
  const joins = new Map<string, Promise<ICacheEntryInfo<ICodecValue>>>()
  for (const key of missing) {
    const row = organizationContext.inflight.get(key)
    if (row) joins.set(key, row.promise)
  }
  if (fresh.length) {
    const release = organizationContext.cacheContext.controller.beginMutation(),
      rows = new Map<string, IFlight>()
    const batch = Promise.resolve()
      .then(() => executeCacheBatch({ organizationContext, load, policy, fresh, rows }))
      .finally(release)
    for (const key of fresh) {
      const row: IFlight = { superseded: false, mode: policy.mode, promise: undefined! }
      row.promise = batch
        .then((values) => values.get(key)!)
        .finally(() => {
          if (organizationContext.inflight.get(key) === row)
            organizationContext.inflight.delete(key)
        })
      rows.set(key, row)
      organizationContext.inflight.set(key, row)
      joins.set(key, row.promise)
    }
  }
  const results = new Map(keys.map((key) => [key, found.get(key)?.info.value as T | undefined]))
  await Promise.all(
    missing.map(async (key) => {
      const promise = joins.get(key)!
      if (found.has(key)) {
        void promise.catch((error: unknown) => report(organizationContext.cacheContext, error))
        return
      }
      results.set(key, (await promise).value as T | undefined)
    })
  )
  return results
}

/** Shared tuple/binary keys are rejected using the original string-only public domain guard. */
function captureKeys(cacheContext: ICacheBackendContext, keys: readonly unknown[]): string[] {
  if (!Array.isArray(keys) || Object.keys(keys).length !== keys.length) throw invalidArgument()
  return keys.map((key) => {
    assertStringStorageKey(key, CacheText.backend)
    return key
  })
}

/** Detect borrows already installed feed sources and creates no additional retry timer. */
async function detectCacheFeeds(
  cacheContext: ICacheBackendContext,
  signal: Parameters<Parameters<IStoragePluginCore['registerDetect']>[0]>[0]
): Promise<void> {
  if (signal.aborted) return
  for (const index of cacheContext.feeds)
    if (cacheContext.configuration.propagate && index > 0) {
      /** One borrowed native feed determines its finite upper-tier invalidation range. */
      const tier = cacheContext.tiers[index]!
      if (!tier.borrowed.has(durableChangeFeed)) {
        if (typeof tier.native.subscribeChanges !== 'function')
          missingCapability(index, CacheText.changeFeed)
        cacheContext.subscriptions.push(
          tier.native.subscribeChanges((change) =>
            propagateCacheChange(cacheContext, index, change)
          )
        )
      }
    }
  for (const index of cacheContext.feeds)
    if (
      cacheContext.configuration.propagate &&
      index > 0 &&
      cacheContext.tiers[index]!.borrowed.has(durableChangeFeed)
    ) {
      /** One native tail retains the original reset/restart facts for this installed source. */
      const tail = new CacheDurableTail(cacheContext, index)
      await tail.start()
      cacheContext.subscriptions.push(() => tail.dispose())
    }
}
/** Ephemeral feed changes retain their explicit organization and original mutation lease. */
function propagateCacheChange(
  cacheContext: ICacheBackendContext,
  index: number,
  change: IStorageChange
): Promise<void> {
  /** Unscoped native changes follow the original default organization. */
  const orgId = change.orgId ?? cacheContext.core.defaultOrgId
  /** Native propagation remains admitted until the existing invalidation settles. */
  const release = cacheContext.controller.beginMutation()
  return bind(cacheContext, orgId)
    .propagation(change, index)
    .catch((error) => report(cacheContext, error))
    .finally(release)
}
/** Durable feed state belongs to its one original native subscription and finite reset path. */
class CacheDurableTail {
  /** Physical cache composition owns admission, projections, subscription disposal and reporting. */
  readonly #cacheContext: ICacheBackendContext
  /** Only tiers above this source are invalidated. */
  readonly #index: number
  /** The selected native durable API remains borrowed rather than wrapped in another feed. */
  readonly #source: import('@migaia/storage-contract').IDurableChangeFeedApi
  /** The immediately upper native KV persists the existing replay cursor. */
  readonly #upper: IKeyValueApi
  /** Only the actual current native tail is closed or replaced after cursor expiry. */
  #current:
    | Awaited<ReturnType<import('@migaia/storage-contract').IDurableChangeFeedApi['tailChanges']>>
    | undefined
  /** A failed invalidation requires one complete reset before a later cursor can be confirmed. */
  #needsReset = false
  /** Native cursor expiry shares its sole original restart Promise without a retry timer. */
  #restarting: Promise<void> | undefined
  /** Chooses the same lower native source and immediately upper cursor store as the original loop. */
  constructor(cacheContext: ICacheBackendContext, index: number) {
    this.#cacheContext = cacheContext
    this.#index = index
    this.#source = cacheContext.tiers[index]!.borrowed.use(durableChangeFeed)
    this.#upper = cacheContext.tiers[index - 1]!.borrowed.use(kv)
  }
  /** Initial replay starts only after the existing upper-tier cursor is read or reset. */
  async start(): Promise<void> {
    /** Missing cursor means upper-tier contents cannot yet be trusted. */
    const after = await this.#upper.get(this.#cacheContext.configuration.prefix + CacheText.cursor)
    if (after === null) await this.#reset()
    await this.#start(after ?? CacheText.now)
  }
  /** Reset marks future organizations untrusted and clears every existing projection before ack. */
  async #reset(): Promise<void> {
    this.#cacheContext.untrustedFeeds.add(this.#index)
    for (const projection of this.#cacheContext.projections.values())
      await projection.reset(this.#index)
  }
  /** Callback identity stays stable across the original native subscription/replacement calls. */
  readonly #onChange = async (
    change: import('@migaia/storage-contract').IDurableStorageChange
  ): Promise<void> => {
    if (this.#cacheContext.controller.closingSignal.aborted) return
    /** The accepted native change keeps its original mutation lease through cursor persistence. */
    const release = this.#cacheContext.controller.beginMutation()
    try {
      if (this.#needsReset || (change.kind === 'reset' && change.orgId === undefined))
        await this.#reset()
      else
        await bind(
          this.#cacheContext,
          change.orgId ?? this.#cacheContext.core.defaultOrgId
        ).propagation(change, this.#index)
      await this.#upper.set(
        this.#cacheContext.configuration.prefix + CacheText.cursor,
        change.cursor
      )
      this.#needsReset = false
    } catch (error) {
      this.#needsReset = true
      if (change.kind === 'reset') throw error
      report(this.#cacheContext, error)
    } finally {
      release()
    }
  }
  /** Only native cursor expiry restarts from now; ordinary disconnects remain reported. */
  readonly #onError = (error: unknown): void => {
    if (
      this.#cacheContext.controller.closingSignal.aborted &&
      error instanceof StorageContractError &&
      error.code === StorageContractErrorCode.aborted &&
      error.cause === this.#cacheContext.controller.closingSignal.reason
    )
      return
    this.#needsReset = true
    report(this.#cacheContext, error)
    if (
      IdentifyError.identityOf(error)?.code !== StorageContractErrorCode.changeCursorExpired ||
      this.#cacheContext.controller.closingSignal.aborted ||
      this.#restarting
    )
      return
    /** Restart remains accepted until reset and native replacement settle. */
    const release = this.#cacheContext.controller.beginMutation()
    this.#restarting = this.#restart()
      .catch((error) => report(this.#cacheContext, error))
      .finally(() => {
        this.#restarting = undefined
        release()
      })
  }
  /** The sole restart preserves reset, symbolic close and replacement order. */
  async #restart(): Promise<void> {
    await this.#reset()
    await this.#current?.[asyncDisposeKey]()
    if (!this.#cacheContext.controller.closingSignal.aborted) await this.#start(CacheText.now)
  }
  /** Expired initial cursors retry once from now through the same native tail API. */
  async #start(from: string): Promise<void> {
    try {
      this.#current = await this.#source.tailChanges(
        { from, onChange: this.#onChange, onError: this.#onError },
        { signal: this.#cacheContext.controller.closingSignal }
      )
    } catch (error) {
      if (IdentifyError.identityOf(error)?.code !== StorageContractErrorCode.changeCursorExpired)
        throw error
      await this.#reset()
      this.#current = await this.#source.tailChanges(
        { from: CacheText.now, onChange: this.#onChange, onError: this.#onError },
        { signal: this.#cacheContext.controller.closingSignal }
      )
    }
  }
  /** Controller finalization waits for the original restart before disposing its native tail. */
  async dispose(): Promise<void> {
    await this.#restarting
    await this.#current?.dispose()
  }
}

/** One original batch loader shares its accepted keys and supersession rows without another queue. */
type ICacheBatchFlightContext<T extends ICodecValue> = {
  readonly organizationContext: ICacheOrganizationContext
  readonly load: ICacheBatchLoader<T>
  readonly policy: ICachePolicy
  readonly fresh: readonly string[]
  readonly rows: Map<string, IFlight>
}
/** Executes the existing locked/unlocked batch path and retains its original publication order. */
async function executeCacheBatch<T extends ICodecValue>(batchContext: ICacheBatchFlightContext<T>) {
  let values: ReadonlyMap<string, T | undefined>, items: IWriteItem[]
  if (batchContext.organizationContext.cacheContext.lockIndex! !== undefined) {
    const native = route(
      batchContext.organizationContext,
      batchContext.organizationContext.cacheContext.tiers[
        batchContext.organizationContext.cacheContext.lockIndex!
      ]!.borrowed
    ) as IStorageBorrowedBackend & ICacheNative
    const result = await native.tx!()
      .lock(
        lockKey.text(
          physical(batchContext.organizationContext.cacheContext, batchContext.fresh[0]!)
        ),
        ...batchContext.fresh
          .slice(1)
          .map((key) => lockKey.text(physical(batchContext.organizationContext.cacheContext, key)))
      )
      .concurrency(
        ConcurrencyPolicy.wait({
          timeoutMs:
            batchContext.organizationContext.cacheContext.configuration.stampedeLock!.timeoutMs
        })
      )
      .run((tx) => loadLockedCacheBatch(batchContext, tx))
    values = result.combined
    items = result.entries
  } else {
    values = await invokeCacheBatchLoader(batchContext, batchContext.fresh)
    items = await prepareCacheBatchEntries(batchContext, values, batchContext.fresh)
  }
  await writeBatch(
    batchContext.organizationContext,
    items.filter((item) => !batchContext.rows.get(item.key)!.superseded),
    batchContext.organizationContext.cacheContext.lockIndex!
  )
  return new Map(
    batchContext.fresh.map((key) => [
      key,
      {
        value: values.get(key),
        tier: undefined,
        stale: false,
        negative: values.get(key) === undefined,
        ageMs: undefined,
        tags: batchContext.policy.tags
      }
    ])
  )
}

/** Runs the original batch loader or accepted-entry encoding inside its explicit flight state. */
async function invokeCacheBatchLoader<T extends ICodecValue>(
  batchContext: ICacheBatchFlightContext<T>,
  actual: readonly string[]
) {
  batchContext.organizationContext.counts.loads++
  const start = batchContext.organizationContext.cacheContext.configuration.clock()
  try {
    return await batchContext.load(
      actual,
      batchContext.organizationContext.cacheContext.controller.closingSignal
    )
  } catch (error) {
    throw cacheError(CacheErrorCode.loadFailed, error)
  } finally {
    batchContext.organizationContext.cacheContext.core.emit(CacheHook.load, () => ({
      ...batchContext.organizationContext.identity,
      elapsedMs: batchContext.organizationContext.cacheContext.configuration.clock() - start,
      found: true
    }))
  }
}

/** Runs the original batch loader or accepted-entry encoding inside its explicit flight state. */
async function prepareCacheBatchEntries<T extends ICodecValue>(
  batchContext: ICacheBatchFlightContext<T>,
  values: ReadonlyMap<string, T | undefined>,
  selected: readonly string[]
) {
  const items: IWriteItem[] = []
  for (const key of selected) {
    const entry = await encodeEntry(
      batchContext.organizationContext.cacheContext.configuration,
      values.get(key),
      batchContext.policy
    )
    if (entry && !batchContext.rows.get(key)!.superseded)
      items.push({ key, entry, policy: batchContext.policy })
  }
  return items
}

/** Executes the original native lock transaction before publishing this flight to other tiers. */
async function loadLockedCacheFlight(
  flightContext: ICacheFlightContext,
  tx: ITransactionScope<unknown, typeof ttl>
) {
  const cached =
    flightContext.policy.mode === CacheText.refresh
      ? undefined
      : await decode(
          flightContext.organizationContext,
          flightContext.organizationContext.cacheContext.lockIndex!,
          flightContext.key,
          await tx.get(physical(flightContext.organizationContext.cacheContext, flightContext.key)),
          flightContext.policy.staleAfterMs,
          () =>
            tx.remove(physical(flightContext.organizationContext.cacheContext, flightContext.key))
        )
  if (cached && !cached.info.stale)
    return {
      entry: cached.entry,
      value: cached.info.value,
      cached,
      expires: plan(flightContext.organizationContext, cached.entry, flightContext.policy)
    }
  const value = await callLoader(flightContext.organizationContext, flightContext.load),
    entry = await encodeEntry(
      flightContext.organizationContext.cacheContext.configuration,
      value,
      flightContext.policy
    )
  const expires = entry
    ? plan(flightContext.organizationContext, entry, flightContext.policy)
    : undefined
  if (entry && !flightContext.row.superseded) {
    if (
      !(await indexTags(
        flightContext.organizationContext,
        flightContext.key,
        entry,
        flightContext.policy,
        expires!
      ))
    )
      return { entry: undefined, value, cached: undefined, expires }
    const maximum =
      flightContext.organizationContext.cacheContext.configuration.tiers[
        flightContext.organizationContext.cacheContext.lockIndex!
      ]!.maxEntryBytes
    if (
      maximum === undefined ||
      new TextEncoder().encode(JSON.stringify(entry)).byteLength <= maximum
    ) {
      await tx.set(
        physical(flightContext.organizationContext.cacheContext, flightContext.key),
        await stored(
          flightContext.organizationContext,
          flightContext.organizationContext.cacheContext.lockIndex!,
          bounded(
            flightContext.organizationContext,
            entry,
            expires!,
            flightContext.organizationContext.cacheContext.lockIndex!
          )
        )
      )
      const ms = remaining(
        flightContext.organizationContext,
        expires!,
        flightContext.organizationContext.cacheContext.lockIndex!
      )
      if (
        flightContext.organizationContext.cacheContext.tiers[
          flightContext.organizationContext.cacheContext.lockIndex!
        ]!.borrowed.has(ttl)
      ) {
        if (ms !== undefined)
          await tx
            .use(ttl)
            .expire(
              lockKey.text(
                physical(flightContext.organizationContext.cacheContext, flightContext.key)
              ),
              ms
            )
        else
          await tx
            .use(ttl)
            .persist(
              lockKey.text(
                physical(flightContext.organizationContext.cacheContext, flightContext.key)
              )
            )
      }
    } else
      flightContext.organizationContext.counts.skipped[
        flightContext.organizationContext.cacheContext.lockIndex!
      ]!++
  }
  return { entry, value, cached: undefined, expires }
}

/** Executes the original native lock transaction before publishing this flight to other tiers. */
async function loadLockedCacheBatch<T extends ICodecValue>(
  batchContext: ICacheBatchFlightContext<T>,
  tx: ITransactionScope<unknown, typeof ttl>
) {
  const existing = new Map<string, ICacheFound>(),
    absent: string[] = []
  for (const key of batchContext.fresh) {
    const hit =
      batchContext.policy.mode === CacheText.refresh
        ? undefined
        : await decode(
            batchContext.organizationContext,
            batchContext.organizationContext.cacheContext.lockIndex!,
            key,
            await tx.get(physical(batchContext.organizationContext.cacheContext, key)),
            batchContext.policy.staleAfterMs,
            () => tx.remove(physical(batchContext.organizationContext.cacheContext, key))
          )
    if (hit && !hit.info.stale) existing.set(key, hit)
    else absent.push(key)
  }
  const loaded = absent.length
    ? await invokeCacheBatchLoader(batchContext, absent)
    : new Map<string, T | undefined>()
  const combined = new Map(
    batchContext.fresh.map((key) => [
      key,
      existing.has(key) ? (existing.get(key)!.info.value as T | undefined) : loaded.get(key)
    ])
  )
  const entries = await prepareCacheBatchEntries(batchContext, loaded, absent)
  const accepted: IWriteItem[] = []
  for (const item of entries) {
    const expires = plan(batchContext.organizationContext, item.entry, item.policy)
    if (
      !(await indexTags(
        batchContext.organizationContext,
        item.key,
        item.entry,
        item.policy,
        expires
      )) ||
      batchContext.rows.get(item.key)!.superseded
    )
      continue
    accepted.push({ ...item, expires, indexed: true })
    const maximum =
      batchContext.organizationContext.cacheContext.configuration.tiers[
        batchContext.organizationContext.cacheContext.lockIndex!
      ]!.maxEntryBytes
    if (
      maximum !== undefined &&
      new TextEncoder().encode(JSON.stringify(item.entry)).byteLength > maximum
    ) {
      batchContext.organizationContext.counts.skipped[
        batchContext.organizationContext.cacheContext.lockIndex!
      ]!++
      continue
    }
    await tx.set(
      physical(batchContext.organizationContext.cacheContext, item.key),
      await stored(
        batchContext.organizationContext,
        batchContext.organizationContext.cacheContext.lockIndex!,
        bounded(
          batchContext.organizationContext,
          item.entry,
          expires,
          batchContext.organizationContext.cacheContext.lockIndex!
        )
      )
    )
    const ms = remaining(
      batchContext.organizationContext,
      expires,
      batchContext.organizationContext.cacheContext.lockIndex!
    )
    if (
      batchContext.organizationContext.cacheContext.tiers[
        batchContext.organizationContext.cacheContext.lockIndex!
      ]!.borrowed.has(ttl)
    ) {
      if (ms !== undefined)
        await tx
          .use(ttl)
          .expire(
            lockKey.text(physical(batchContext.organizationContext.cacheContext, item.key)),
            ms
          )
      else
        await tx
          .use(ttl)
          .persist(lockKey.text(physical(batchContext.organizationContext.cacheContext, item.key)))
    }
  }
  for (const [key, hit] of existing)
    accepted.push({
      key,
      entry: hit.entry,
      policy: batchContext.policy,
      upto: batchContext.organizationContext.cacheContext.lockIndex!
    })
  return { combined, entries: accepted }
}

/** One public statistics sample stays stable when later operations update internal count arrays. */
function cacheStats(
  organizationContext: ICacheOrganizationContext
): ReturnType<ICacheStore['stats']> {
  organizationContext.cacheContext.controller.assertLive()
  return {
    ...organizationContext.counts,
    hits: [...organizationContext.counts.hits],
    misses: [...organizationContext.counts.misses],
    skipped: [...organizationContext.counts.skipped]
  }
}

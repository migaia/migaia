import './hooks.js'
import {
  createBackendChangeController,
  provideCapabilities,
  asyncDisposeKey
} from '@migaia/storage-host/sdk'
import {
  kv,
  ttl,
  blob,
  records,
  durableChangeFeed,
  implement,
  assertStringStorageKey,
  StorageContractError,
  StorageContractErrorCode,
  type IKeyValueApi,
  type IStorageBase,
  type ICapabilityInstallPort,
  type ITransactionBuilder,
  type ITransactionScope,
  type IStorageChange
} from '@migaia/storage-contract'
import type { ICodecValue } from '@migaia/serialize/codec'
import type { IStoragePluginCore, IStorageBorrowedBackend } from '@migaia/storage-host'
import { IdentifyError } from '@migaia/utils/error'
import type { IScheduledTask } from '@migaia/utils/scheduler'
import { CacheText, CacheWriteMode, CacheOperation } from './constants.js'
import { cacheError, invalidArgument, missingCapability } from './errors.js'
import { CacheErrorCode } from '@migaia/storage-contract/error-code'
import type { ICacheConfiguration, ICachePolicy } from './policy.js'
import type { ICacheEntry } from './entry.js'
import type { ICacheStore, ICacheEntryInfo } from './types.js'
import { createCacheStoreApi, createCacheStoreBase } from './store-api.js'
import { flush, erase } from './store-flight.js'

/** Borrowed native extras are admitted individually; capability methods retain their exact token. */
export type ICacheNative = {
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
export type IFlight = {
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
export type IWriteItem = {
  key: string
  entry: ICacheEntry
  policy: ICachePolicy
  upto?: number
  expires?: readonly (number | undefined)[]
  indexed?: boolean
}

/** Coalesced back facts remain readable while their original native write is pending. */
export type IPending = {
  entry: ICacheEntry
  policy: ICachePolicy
  tiers: Set<number>
  expires: readonly (number | undefined)[]
  writing?: Promise<void>
}

/** Physical cache composition shares the original controller and explicit borrowed tiers. */
export type ICacheBackendContext = {
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
  cacheContext.controller = cacheContext.core.createChangeController(
    {
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
    },
    createBackendChangeController
  )
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

export function report(cacheContext: ICacheBackendContext, error: unknown): void {
  return cacheContext.core.stageBindings.backendStages.report(error)
}

/** Physical keys are scoped by the cache prefix while organization routing remains host-owned. */
export function physical(cacheContext: ICacheBackendContext, key: string): string {
  assertStringStorageKey(key, CacheText.backend)
  if (key === CacheText.cursor) throw invalidArgument()
  return cacheContext.configuration.prefix + key
}

/** Each timer tick flushes the current coalesced table once, never retries a dropped write. */
export function schedule(cacheContext: ICacheBackendContext): void {
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
export type ICacheOrganizationContext = {
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
/**
 * Invalidate every organization for one lower tier: mark the feed untrusted for organizations that
 * bind later, then reset each existing projection. Plain and durable feeds both use it for a reset
 * without orgId, which the change-feed contract defines as covering all organizations.
 */
async function resetCacheFeed(cacheContext: ICacheBackendContext, index: number): Promise<void> {
  cacheContext.untrustedFeeds.add(index)
  for (const projection of cacheContext.projections.values()) await projection.reset(index)
}
/** Ephemeral feed changes retain their explicit organization and original mutation lease. */
function propagateCacheChange(
  cacheContext: ICacheBackendContext,
  index: number,
  change: IStorageChange
): Promise<void> {
  /** Native propagation remains admitted until the existing invalidation settles. */
  const release = cacheContext.controller.beginMutation()
  /** An unscoped reset covers every organization; other unscoped changes use the default one. */
  const work =
    change.kind === 'reset' && change.orgId === undefined
      ? resetCacheFeed(cacheContext, index)
      : bind(cacheContext, change.orgId ?? cacheContext.core.defaultOrgId).propagation(
          change,
          index
        )
  return work.catch((error) => report(cacheContext, error)).finally(release)
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
    await resetCacheFeed(this.#cacheContext, this.#index)
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

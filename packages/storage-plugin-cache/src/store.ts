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

/** Compose installed native storage without owning or reconfiguring any borrowed backend. */
export function createCacheStore(configuration: ICacheConfiguration, core: IStoragePluginCore) {
  /** Original borrowed objects are captured only during installation. */
  const tiers: ITier[] = configuration.tiers.map((tier, index) => {
    const borrowed = core.getPublishedBackend(tier.backend)
    if (!borrowed.has(kv)) missingCapability(index, kv.name)
    const api = borrowed.use(kv)
    if (typeof api.removeByPrefix !== 'function')
      missingCapability(index, CacheOperation.removeByPrefix)
    if (tier.ttlMs !== undefined && !borrowed.has(ttl)) missingCapability(index, ttl.name)
    const offload =
      tier.offload === undefined ? undefined : core.getPublishedBackend(tier.offload.backend)
    if (offload && !offload.has(blob)) missingCapability(index, blob.name)
    return { borrowed, native: borrowed as IStorageBorrowedBackend & ICacheNative, blob: offload }
  })
  /** Declared native feeds determine finite propagation and back-write admission. */
  const feeds = tiers.flatMap((tier, index) =>
    tier.borrowed.capabilities.changeFeed || tier.borrowed.has(durableChangeFeed) ? [index] : []
  )
  if (configuration.propagate)
    for (const index of feeds)
      for (let upper = 0; upper < index; upper++)
        if (configuration.tiers[upper]!.ttlMs === undefined)
          throw cacheError(CacheErrorCode.tierInvalid, undefined, upper)
  if (configuration.propagate)
    for (const [index, tier] of configuration.tiers.entries())
      if (
        tier.write === CacheWriteMode.back &&
        (index <= Math.max(-1, ...feeds) || tier.ttlMs === undefined)
      )
        throw cacheError(CacheErrorCode.tierInvalid, undefined, index)
  const lockIndex =
    configuration.stampedeLock === undefined
      ? undefined
      : configuration.tiers.findIndex(
          (tier) => tier.backend === configuration.stampedeLock!.backend
        )
  if (
    lockIndex !== undefined &&
    (!tiers[lockIndex]!.borrowed.capabilities.transactions ||
      typeof tiers[lockIndex]!.native.tx !== 'function')
  )
    missingCapability(lockIndex, CacheText.lockCapability)
  const tags =
    configuration.tagIndex === undefined
      ? undefined
      : core.getPublishedBackend(configuration.tagIndex.backend)
  if (
    tags &&
    (!tags.has(records) ||
      !tags.has(ttl) ||
      typeof Reflect.get(tags, CacheOperation.iterateRecords) !== 'function' ||
      typeof Reflect.get(tags, CacheOperation.putRecord) !== 'function')
  )
    missingCapability(-1, CacheText.tagCapability)
  /** Immutable org children share only the original controller and installed physical resources. */
  const projections = new Map<string, IProjection>()
  /** Missing reliable cursors require lazy clearing of every subsequently accessed org projection. */
  const untrustedFeeds = new Set<number>()
  /** Subscription resources are released after all admitted business work drains and flushes. */
  const subscriptions: (() => void | Promise<void>)[] = []
  const report = (error: unknown): void => core.stageBindings.backendStages.report(error)
  let symbolic: Promise<void> | undefined
  let timer: IScheduledTask | undefined
  const controller = core.createChangeController({
    backend: CacheText.backend,
    finalize: async () => {
      timer?.cancel()
      for (const projection of projections.values()) await projection.flush()
      for (const close of subscriptions.reverse()) {
        try {
          await close()
        } catch (error) {
          report(error)
        }
      }
      projections.clear()
    }
  })
  /** Physical keys are scoped by the cache prefix while organization routing remains host-owned. */
  const physical = (key: string): string => {
    assertStringStorageKey(key, CacheText.backend)
    if (key === CacheText.cursor) throw invalidArgument()
    return configuration.prefix + key
  }
  /** Each timer tick flushes the current coalesced table once, never retries a dropped write. */
  const schedule = (): void => {
    if (timer || controller.closingSignal.aborted) return
    timer = core.featureExpose.getScheduler().schedule(() => {
      timer = undefined
      if (controller.closingSignal.aborted) return
      const release = controller.beginMutation()
      void Promise.all([...projections.values()].map((projection) => projection.flush()))
        .catch(report)
        .finally(() => {
          release()
          if ([...projections.values()].some((projection) => projection.pending())) schedule()
        })
    }, configuration.writeBackIntervalMs)
    timer.unref?.()
  }
  /** An org binding never switches global state; every borrowed layer follows this fixed context. */
  function bind(orgId: string): IProjection {
    const existing = projections.get(orgId)
    if (existing) return existing
    const ports = core.getOrgContext(orgId),
      identity = { backendId: core.getBackendId(), backend: CacheText.backend, orgId }
    const route = <T extends IStorageBorrowedBackend>(borrowed: T): T =>
      ports.callContext.backend(borrowed)
    const apiAt = (index: number): IKeyValueApi => route(tiers[index]!.borrowed).use(kv)
    const blobAt = (index: number): IBlobApi => route(tiers[index]!.blob!).use(blob)
    const inflight = new Map<string, IFlight>(),
      pending = new Map<string, IPending>()
    /** Each immutable org performs startup invalidation once for each untrusted durable source. */
    const resetFeeds = new Set<number>()
    let preparation: Promise<void> | undefined
    const prepare = (): Promise<void> =>
      (preparation ??= (async () => {
        for (const index of untrustedFeeds)
          if (!resetFeeds.has(index)) {
            await erase('', true, index)
            resetFeeds.add(index)
          }
      })().finally(() => {
        preparation = undefined
      }))
    const counts = {
      hits: tiers.map(() => 0),
      misses: tiers.map(() => 0),
      loads: 0,
      staleServed: 0,
      negativeHits: 0,
      invalidations: 0,
      writeBackDropped: 0,
      skipped: tiers.map(() => 0)
    }
    let installer!: ICapabilityInstallPort
    let store!: ICacheStore
    /** Reports retain original errors; event payloads expose only a safe canonical code. */
    const tierError = (tier: number, operation: string, error: unknown): void => {
      core.emit(CacheHook.tierError, () => ({
        ...identity,
        tier,
        operation,
        code: IdentifyError.identityOf(error)?.code
      }))
      report(error)
    }
    /**
     * Work admission stays in the original lifecycle; caller cancellation never releases active
     * work early.
     */
    const run = <I, R>(
      operation: string,
      input: I,
      ctx: IOperationContext | undefined,
      invoke: (input: I) => Promise<R>
    ): Promise<R> => {
      controller.assertLive()
      const context = snapshotOperationContext(ctx),
        release = controller.beginMutation()
      let started = false
      return withAbort(context, async (signal) => {
        started = true
        const work = prepare()
          .then(() => ports.execution.run({ operation, input, ctx: context }, invoke))
          .finally(release)
        try {
          return await raceWithAbort(() => work, { signal, cleanupPolicy: 'report', report })
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
    const deadline = (
      index: number,
      entry: ICacheEntry,
      policy: ICachePolicy,
      now: number
    ): number | undefined => {
      const milliseconds = Math.min(
        configuration.tiers[index]!.ttlMs ?? Infinity,
        policy.ttlMs ?? Infinity,
        entry.x === undefined ? Infinity : Math.max(0, entry.x - now)
      )
      return milliseconds === Infinity ? undefined : milliseconds
    }
    /** Actual layer deadlines are sampled once and remain fixed while a back write waits. */
    const plan = (entry: ICacheEntry, policy: ICachePolicy): readonly (number | undefined)[] => {
      const now = configuration.clock()
      return configuration.tiers.map((_, index) => {
        const ms = deadline(index, entry, policy, now)
        return ms === undefined ? undefined : now + shorten(configuration, ms)
      })
    }
    /** Pending writes and tag records share the same sampled expiry rather than extending on flush. */
    const remaining = (
      expires: readonly (number | undefined)[],
      index: number
    ): number | undefined =>
      expires[index] === undefined
        ? undefined
        : Math.max(0, expires[index]! - configuration.clock())
    /** A layer's exact sampled hard bound survives an unavailable native expiry endpoint. */
    const bounded = (
      entry: ICacheEntry,
      expires: readonly (number | undefined)[],
      index: number
    ): ICacheEntry =>
      expires[index] === undefined
        ? entry
        : { ...entry, x: Math.min(entry.x ?? Infinity, expires[index]!) }
    /** Positive per-call native TTLs are admitted before any source call or tier modification. */
    const admitPolicy = (policy: ICachePolicy): ICachePolicy => {
      if (policy.ttlMs !== undefined && policy.ttlMs > 0)
        for (const [index, tier] of tiers.entries())
          if (!tier.borrowed.has(ttl)) missingCapability(index, ttl.name)
      return policy
    }
    /** Shared batch TTL uses its original finite nonnegative domain, including immediate removal. */
    const batchPolicy = (ttlMs: number | undefined): ICachePolicy => {
      if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, CacheText.backend)
      if (
        ttlMs !== undefined &&
        configuration.tiers.some((tier) => tier.ttlMs !== undefined && ttlMs > tier.ttlMs)
      )
        throw cacheError(CacheErrorCode.tierInvalid)
      return admitPolicy(Object.freeze({ ...snapshotCachePolicy(configuration), ttlMs }))
    }
    /** Object offload writes only encoded content and refreshes the native modification timestamp. */
    const stored = async (index: number, entry: ICacheEntry): Promise<string> => {
      let actual = entry
      const options = configuration.tiers[index]!.offload
      if (options && typeof entry.d === 'string') {
        const bytes = new TextEncoder().encode(entry.d)
        if (bytes.byteLength >= options.minBytes) {
          const key = configuration.prefix + (await hashCacheBytes(bytes))
          await blobAt(index).put(key, bytes)
          actual = { ...entry, d: { $blob: key, size: bytes.byteLength } }
        }
      }
      return JSON.stringify(actual)
    }
    /** A native write failure degrades this layer while preserving the loader's true result. */
    const writeOne = async (
      index: number,
      key: string,
      entry: ICacheEntry,
      policy: ICachePolicy,
      expires: readonly (number | undefined)[] = plan(entry, policy)
    ): Promise<boolean> => {
      try {
        const ms = remaining(expires, index)
        if (ms === 0) {
          await apiAt(index).remove(physical(key))
          return true
        }
        const actual = bounded(entry, expires, index),
          maximum = configuration.tiers[index]!.maxEntryBytes
        if (
          maximum !== undefined &&
          new TextEncoder().encode(JSON.stringify(actual)).byteLength > maximum
        ) {
          counts.skipped[index]!++
          return true
        }
        const raw = await stored(index, actual)
        await apiAt(index).set(physical(key), raw)
        if (ms !== undefined && tiers[index]!.borrowed.has(ttl))
          await route(tiers[index]!.borrowed)
            .use(ttl)
            .expire(lockKey.text(physical(key)), ms)
        else if (ms === undefined && tiers[index]!.borrowed.has(ttl))
          await route(tiers[index]!.borrowed)
            .use(ttl)
            .persist(lockKey.text(physical(key)))
        return true
      } catch (error) {
        tierError(index, CacheOperation.set, error)
        if (configuration.tiers[index]!.offload) counts.skipped[index]!++
        return false
      }
    }
    /** Tags are indexed first, ensuring an index failure cannot create an un-invalidatable value. */
    const indexTags = async (
      key: string,
      entry: ICacheEntry,
      policy: ICachePolicy,
      expires: readonly (number | undefined)[]
    ): Promise<boolean> => {
      if (!entry.g?.length) return true
      try {
        const borrowed = route(tags!),
          native = borrowed as unknown as Omit<
            IRecordStore<ICodecValue>,
            'dispose' | typeof Symbol.asyncDispose
          >
        const limits = configuration.tiers.map((_, index) => remaining(expires, index))
        const maximum = limits.some((value) => value === undefined)
          ? undefined
          : Math.max(...(limits as number[]))
        for (const tag of entry.g) {
          const target = [configuration.prefix, tag, key]
          await native.putRecord({ key }, target)
          if (maximum !== undefined) await borrowed.use(ttl).expire(lockKey.record(target), maximum)
          else await borrowed.use(ttl).persist(lockKey.record(target))
        }
        return true
      } catch (error) {
        tierError(-1, CacheOperation.tags, error)
        return false
      }
    }
    /**
     * Slow through tiers finish first; back tiers only replace the same logical key's pending
     * facts.
     */
    const write = async (
      key: string,
      entry: ICacheEntry,
      policy: ICachePolicy,
      upto = tiers.length,
      skip?: number,
      expires: readonly (number | undefined)[] = plan(entry, policy),
      indexed = false
    ): Promise<void> => {
      if (upto === tiers.length && !indexed && !(await indexTags(key, entry, policy, expires)))
        return
      for (let index = upto - 1; index >= 0; index--) {
        if (index === skip) continue
        if (configuration.tiers[index]!.write === CacheWriteMode.back) {
          const prior = pending.get(key)
          if (prior && prior.entry === entry) prior.tiers.add(index)
          else
            pending.set(key, {
              entry,
              policy,
              expires,
              tiers: new Set([...(prior?.entry === entry ? prior.tiers : []), index])
            })
          schedule()
        } else await writeOne(index, key, entry, policy, expires)
      }
    }
    /** Decode a layer and dispose its exact one-consumer object handle even when decoding fails. */
    const decode = async (
      index: number,
      key: string,
      raw: string | null | undefined,
      staleAfterMs?: number,
      removeExpired: () => Promise<void> = () => apiAt(index).remove(physical(key))
    ): Promise<ICacheFound | undefined> => {
      if (raw == null) return undefined
      try {
        const entry = parseEntry(raw)
        if (entry.x !== undefined && entry.x <= configuration.clock()) {
          await removeExpired()
          return undefined
        }
        let data = typeof entry.d === 'string' ? entry.d : undefined
        if (entry.d && typeof entry.d === 'object') {
          if (!tiers[index]!.blob || !entry.d.$blob.startsWith(configuration.prefix))
            throw invalidArgument()
          const object = await blobAt(index).get(entry.d.$blob)
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
          info: await entryInfo(configuration, entry, index, data, staleAfterMs)
        }
      } catch (error) {
        tierError(index, CacheOperation.decode, error)
        return undefined
      }
    }
    /** Observe one native tier lookup; pending back values precede the first possible stale read. */
    const read = async (
      key: string,
      policy: ICachePolicy,
      fill: boolean
    ): Promise<ICacheFound | undefined> => {
      for (let index = 0; index < tiers.length; index++) {
        let found: ICacheFound | undefined
        if (configuration.tiers[index]!.write === CacheWriteMode.back && pending.has(key)) {
          const item = pending.get(key)!
          found = await decode(
            index,
            key,
            JSON.stringify(bounded(item.entry, item.expires, index)),
            policy.staleAfterMs
          )
        } else {
          try {
            found = await decode(
              index,
              key,
              await apiAt(index).get(physical(key)),
              policy.staleAfterMs
            )
          } catch (error) {
            tierError(index, CacheOperation.get, error)
          }
        }
        if (found) {
          counts.hits[index]!++
          if (found.info.negative) counts.negativeHits++
          if (found.info.stale) counts.staleServed++
          core.emit(CacheHook.hit, () => ({
            ...identity,
            tier: index,
            stale: found!.info.stale,
            negative: found!.info.negative
          }))
          if (fill && index) await write(key, found.entry, policy, index)
          return found
        }
        counts.misses[index]!++
        core.emit(CacheHook.miss, () => ({ ...identity, tier: index }))
      }
      return undefined
    }
    /** Invalidations detach the original flight rather than retaining generations outside its Map. */
    const supersede = (matches: (key: string) => boolean, clearPending = true): void => {
      for (const [key, flight] of inflight)
        if (matches(key)) {
          flight.superseded = true
          inflight.delete(key)
        }
      if (clearPending) for (const key of pending.keys()) if (matches(key)) pending.delete(key)
    }
    /** One source failure is shared by all joined callers and never stored as a negative result. */
    const callLoader = async (
      load: ICacheLoader<ICodecValue>
    ): Promise<ICodecValue | undefined> => {
      counts.loads++
      const start = configuration.clock()
      let value: ICodecValue | undefined
      try {
        value = await load(controller.closingSignal)
        return value
      } catch (error) {
        throw cacheError(CacheErrorCode.loadFailed, error)
      } finally {
        core.emit(CacheHook.load, () => ({
          ...identity,
          elapsedMs: configuration.clock() - start,
          found: value !== undefined
        }))
      }
    }
    /** The shared flight lease survives cancellation of every individual caller. */
    const flight = (
      key: string,
      load: ICacheLoader<ICodecValue>,
      policy: ICachePolicy
    ): Promise<ICacheEntryInfo<ICodecValue>> => {
      const prior = inflight.get(key)
      if (prior) return prior.promise
      const release = controller.beginMutation()
      const row: IFlight = { superseded: false, mode: policy.mode, promise: undefined! }
      const execute = async (): Promise<ICacheEntryInfo<ICodecValue>> => {
        let entry: ICacheEntry | undefined,
          value: ICodecValue | undefined,
          locked = false,
          expires: readonly (number | undefined)[] | undefined,
          lockedHit: ICacheFound | undefined
        if (lockIndex !== undefined) {
          const borrowed = route(tiers[lockIndex]!.borrowed),
            native = borrowed as IStorageBorrowedBackend & ICacheNative
          const result = await native.tx!()
            .lock(lockKey.text(physical(key)))
            .concurrency(
              ConcurrencyPolicy.wait({ timeoutMs: configuration.stampedeLock!.timeoutMs })
            )
            .run(async (tx) => {
              const cached =
                policy.mode === CacheText.refresh
                  ? undefined
                  : await decode(
                      lockIndex,
                      key,
                      await tx.get(physical(key)),
                      policy.staleAfterMs,
                      () => tx.remove(physical(key))
                    )
              if (cached && !cached.info.stale)
                return {
                  entry: cached.entry,
                  value: cached.info.value,
                  cached,
                  expires: plan(cached.entry, policy)
                }
              const value = await callLoader(load),
                entry = await encodeEntry(configuration, value, policy)
              const expires = entry ? plan(entry, policy) : undefined
              if (entry && !row.superseded) {
                if (!(await indexTags(key, entry, policy, expires!)))
                  return { entry: undefined, value, cached: undefined, expires }
                const maximum = configuration.tiers[lockIndex]!.maxEntryBytes
                if (
                  maximum === undefined ||
                  new TextEncoder().encode(JSON.stringify(entry)).byteLength <= maximum
                ) {
                  await tx.set(
                    physical(key),
                    await stored(lockIndex, bounded(entry, expires!, lockIndex))
                  )
                  const ms = remaining(expires!, lockIndex)
                  if (tiers[lockIndex]!.borrowed.has(ttl)) {
                    if (ms !== undefined) await tx.use(ttl).expire(lockKey.text(physical(key)), ms)
                    else await tx.use(ttl).persist(lockKey.text(physical(key)))
                  }
                } else counts.skipped[lockIndex]!++
              }
              return { entry, value, cached: undefined, expires }
            })
          entry = result.entry
          value = result.value
          locked = true
          expires = result.expires
          lockedHit = result.cached
        } else {
          value = await callLoader(load)
          entry = await encodeEntry(configuration, value, policy)
        }
        if (entry && !row.superseded)
          await write(
            key,
            entry,
            policy,
            lockedHit ? lockIndex : tiers.length,
            locked ? lockIndex : undefined,
            expires,
            locked
          )
        if (lockedHit) return lockedHit.info
        return Object.freeze({
          value,
          tier: undefined,
          stale: false,
          negative: value === undefined,
          ageMs: entry ? configuration.clock() - entry.w : undefined,
          meta: entry?.m,
          tags: entry?.g ?? policy.tags
        })
      }
      row.promise = Promise.resolve()
        .then(execute)
        .finally(() => {
          if (inflight.get(key) === row) inflight.delete(key)
          release()
        })
      inflight.set(key, row)
      return row.promise
    }
    /** Cache read/load operates beneath one original public pipeline. */
    const loadEntry = async <T extends ICodecValue>(
      key: string,
      load: ICacheLoader<T>,
      policy: ICachePolicy
    ): Promise<ICacheEntryInfo<T>> => {
      physical(key)
      if (typeof load !== 'function') throw invalidArgument()
      if (policy.mode === CacheText.bypass)
        return {
          value: await callLoader(load),
          tier: undefined,
          stale: false,
          negative: false,
          ageMs: undefined,
          tags: policy.tags
        } as ICacheEntryInfo<T>
      if (policy.mode === CacheText.refresh && inflight.get(key)?.mode !== CacheText.refresh)
        supersede((value) => value === key)
      if (policy.mode === CacheText.normal) {
        const found = await read(key, policy, true)
        if (found) {
          if (found.info.stale) void flight(key, load, policy).catch(report)
          return found.info as ICacheEntryInfo<T>
        }
      }
      return flight(key, load, policy) as Promise<ICacheEntryInfo<T>>
    }
    /**
     * Actual invalidation errors remain visible to reliable feeds instead of acknowledging stale
     * data.
     */
    const erase = async (
      key: string,
      prefix: boolean,
      upto = tiers.length,
      strict = false
    ): Promise<number> => {
      /** Propagation touches only through tiers above its feed; lower back facts keep their owner. */
      supersede((value) => (prefix ? value.startsWith(key) : value === key), upto === tiers.length)
      let removed = 0,
        first: unknown
      for (let index = 0; index < upto; index++) {
        try {
          if (prefix) removed += await apiAt(index).removeByPrefix(physical(key))
          else {
            const api = apiAt(index)
            removed = Math.max(removed, (await api.has(physical(key))) ? 1 : 0)
            await api.remove(physical(key))
          }
        } catch (error) {
          tierError(index, CacheOperation.invalidate, error)
          first ??= error
        }
      }
      if (strict && first !== undefined) throw first
      counts.invalidations++
      core.emit(CacheHook.invalidate, () => ({ ...identity, tiers: upto, prefix }))
      return removed
    }
    /** The same coalesced facts remain readable until their native write settles or is replaced. */
    const flush = async (): Promise<void> => {
      const items = [...pending]
      for (const [key, item] of items) {
        item.writing ??= (async () => {
          try {
            for (const index of [...item.tiers].reverse())
              if (!(await writeOne(index, key, item.entry, item.policy, item.expires))) {
                counts.writeBackDropped++
                core.emit(CacheHook.writeBackDropped, () => ({
                  ...identity,
                  tier: index,
                  count: 1
                }))
              }
          } finally {
            if (pending.get(key) === item) pending.delete(key)
          }
        })()
        await item.writing
      }
    }

    const defaults = (): ICachePolicy => snapshotCachePolicy(configuration)
    /** Flat KV never exposes codec entries through text APIs. */
    const get = async (key: string): Promise<string | null> => {
      const found = await read(key, defaults(), true)
      return found?.entry.t === CacheText.string && typeof found.info.value === 'string'
        ? found.info.value
        : null
    }
    /** JavaScript batch admission detaches every entry before any pipeline or tier operation. */
    const captureEntries = (entries: unknown): { key: string; value: string; ttlMs?: number }[] => {
      try {
        if (!Array.isArray(entries) || Object.keys(entries).length !== entries.length)
          throw invalidArgument()
        const seen = new Set<string>()
        return entries.map((item) => {
          if (!item || typeof item !== 'object') throw invalidArgument()
          const { key, value, ttlMs } = item
          assertStringStorageKey(key, CacheText.backend)
          if (typeof value !== 'string' || seen.has(key)) throw invalidArgument()
          batchPolicy(ttlMs)
          seen.add(key)
          return { key, value, ttlMs }
        })
      } catch (error) {
        if (error instanceof Error && IdentifyError.identityOf(error)) throw error
        throw invalidArgument(error)
      }
    }
    const api: IKeyValueApi = {
      get: (key, ctx) => {
        physical(key)
        return run(CacheOperation.get, key, ctx, (actual) => get(actual))
      },
      has: (key, ctx) => {
        physical(key)
        return run(CacheOperation.has, key, ctx, async (actual) => (await get(actual)) !== null)
      },
      set: (key, value, ctx) => {
        physical(key)
        if (typeof value !== 'string') throw invalidArgument()
        return run(CacheOperation.set, { key, value }, ctx, async (actual) => {
          physical(actual.key)
          if (typeof actual.value !== 'string') throw invalidArgument()
          supersede((item) => item === actual.key)
          const policy = defaults(),
            entry = await encodeEntry(configuration, actual.value, policy, true)
          await write(actual.key, entry!, policy)
        })
      },
      remove: (key, ctx) => {
        physical(key)
        return run(CacheOperation.remove, key, ctx, async (actual) => {
          await erase(actual, false)
        })
      },
      keys: (ctx) =>
        run(CacheOperation.keys, undefined, ctx, async () => {
          let keys: string[]
          try {
            keys = (await apiAt(0).keys())
              .filter(
                (key) =>
                  key.startsWith(configuration.prefix) &&
                  key !== configuration.prefix + CacheText.cursor
              )
              .map((key) => key.slice(configuration.prefix.length))
          } catch (error) {
            tierError(0, CacheOperation.keys, error)
            return []
          }
          const result: string[] = []
          for (const key of keys) {
            const found = await decode(0, key, await apiAt(0).get(physical(key)))
            if (found?.entry.t === CacheText.string && !found.info.negative) result.push(key)
          }
          return result
        }),
      clearValues: (ctx) =>
        run(CacheOperation.clearValues, undefined, ctx, async () => {
          await erase('', true)
        }),
      clearAll: (ctx) =>
        run(CacheOperation.clearAll, undefined, ctx, async () => {
          await erase('', true)
        }),
      removeByPrefix: (prefix, ctx) => {
        assertStringStorageKey(prefix, CacheText.backend)
        controller.assertLive()
        if (tiers.length > 1) missingCapability(-1, CacheText.prefixCountCapability)
        return run(CacheOperation.removeByPrefix, prefix, ctx, (actual) =>
          erase(actual as string, true)
        )
      },
      getMany: (keys, ctx) => {
        const captured = captureKeys(keys)
        return run(CacheOperation.getMany, captured, ctx, async (actual) => {
          const keys = captureKeys(actual),
            found = await readBatch(keys, defaults(), true)
          return keys.map((key) => {
            const match = found.get(key)
            return match?.entry.t === CacheText.string && typeof match.info.value === 'string'
              ? match.info.value
              : undefined
          })
        })
      },
      setMany: (entries, ctx) => {
        const captured = captureEntries(entries)
        return run(CacheOperation.setMany, captured, ctx, async (actual) => {
          const seen = new Set<string>(),
            items: { key: string; entry: ICacheEntry; policy: ICachePolicy }[] = []
          for (const item of captureEntries(actual)) {
            physical(item.key)
            if (typeof item.value !== 'string' || seen.has(item.key)) throw invalidArgument()
            seen.add(item.key)
            const policy = batchPolicy(item.ttlMs)
            const entry = await encodeEntry(configuration, item.value, policy, true)
            items.push({ key: item.key, entry: entry!, policy })
          }
          for (const item of items) supersede((key) => key === item.key)
          await writeBatch(items)
        })
      },
      removeMany: (keys, ctx) => {
        const captured = [...new Set(captureKeys(keys))]
        return run(CacheOperation.removeMany, captured, ctx, async (actual) => {
          let count = 0
          for (const key of captureKeys(actual)) count += await erase(key, false)
          return count
        })
      }
    }
    const base: IStorageBase &
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
      > = {
      backend: CacheText.backend,
      capabilities: Object.freeze({
        syncRead: false,
        binary: false,
        records: false,
        transactions: false,
        iteration: false,
        secondaryIndexes: false,
        changeFeed: false,
        maxValueBytes: undefined,
        opaqueEntries: false
      }),
      dispose: () => controller.dispose(),
      [asyncDisposeKey]: () => (symbolic ??= controller.dispose().then(undefined, report)),
      getOrLoad: (key, load, options) =>
        store.getOrLoadEntry(key, load, options).then((info) => info.value),
      getOrLoadEntry: (key, load, options) => {
        physical(key)
        const policy = admitPolicy(snapshotCachePolicy(configuration, options))
        return run(CacheOperation.getOrLoad, { key, load }, policy.ctx, (actual) =>
          loadEntry(actual.key, actual.load, policy)
        )
      },
      getOrLoadMany: (keys, load, options) => {
        const captured = [...new Set(captureKeys(keys))],
          policy = admitPolicy(snapshotCachePolicy(configuration, options))
        return run(CacheOperation.getOrLoadMany, captured, policy.ctx, (actual) =>
          loadMany(captureKeys(actual), load, policy)
        )
      },
      peek: <T extends ICodecValue>(key: string, ctx?: IOperationContext) => {
        physical(key)
        return run(
          CacheOperation.peek,
          key,
          ctx,
          async (actual) => (await read(actual, defaults(), false))?.info
        ) as Promise<ICacheEntryInfo<T> | undefined>
      },
      invalidate: (target, ctx) => {
        const captured =
          typeof target === 'string'
            ? { key: target }
            : 'prefix' in target
              ? { prefix: target.prefix }
              : { tag: target.tag }
        if ('key' in captured) physical(captured.key!)
        else if ('prefix' in captured) physical(captured.prefix!)
        else if (typeof captured.tag !== 'string' || !tags)
          throw cacheError(CacheErrorCode.tierInvalid)
        return run(CacheOperation.invalidate, captured, ctx, async (actual) => {
          if ('key' in actual) await erase(actual.key!, false)
          else if ('prefix' in actual) await erase(actual.prefix!, true)
          else {
            const borrowed = route(tags!),
              native = borrowed as unknown as Omit<
                IRecordStore<{ key: string }>,
                'dispose' | typeof Symbol.asyncDispose
              >
            const iterator = native.iterateRecords({
              lower: [configuration.prefix, actual.tag!],
              upper: [configuration.prefix, actual.tag!, new ArrayBuffer(0)],
              upperOpen: true
            })
            try {
              for await (const [, value] of iterator) {
                if (typeof value.key !== 'string') throw invalidArgument()
                await erase(value.key, false)
              }
            } finally {
              await iterator[asyncDisposeKey]()
            }
            await borrowed.use(records).removeByPrefix([configuration.prefix, actual.tag!])
          }
        })
      },
      flush: (ctx) => run(CacheOperation.flush, undefined, ctx, flush),
      sweepOffload: (ctx) =>
        run(CacheOperation.sweepOffload, undefined, ctx, async () => {
          let count = 0
          const swept = new Set<string>()
          for (const [index, tier] of configuration.tiers.entries())
            if (tier.offload && !swept.has(tier.offload.backend)) {
              swept.add(tier.offload.backend)
              const retention = Math.max(
                ...configuration.tiers
                  .filter((item) => item.offload?.backend === tier.offload!.backend)
                  .map((item) => item.ttlMs!)
              )
              let after: string | undefined
              do {
                const page = await blobAt(index).list({
                  prefix: configuration.prefix,
                  after,
                  limit: 256
                })
                for (const info of page.items)
                  if (info.updatedAt < configuration.clock() - retention)
                    if (await blobAt(index).remove(info.key)) count++
                after = page.next
              } while (after !== undefined)
            }
          return count
        }),
      stats: () => {
        controller.assertLive()
        return Object.freeze({
          ...counts,
          hits: Object.freeze([...counts.hits]),
          misses: Object.freeze([...counts.misses]),
          skipped: Object.freeze([...counts.skipped])
        })
      }
    }
    /** All selected entries share one native batch per through tier, with per-key back coalescing. */
    const writeBatch = async (items: readonly IWriteItem[], skip?: number): Promise<void> => {
      const accepted: ((typeof items)[number] & { expires: readonly (number | undefined)[] })[] = []
      for (const item of items) {
        const expires = item.expires ?? plan(item.entry, item.policy)
        if (
          item.indexed ||
          item.upto !== undefined ||
          (await indexTags(item.key, item.entry, item.policy, expires))
        )
          accepted.push({ ...item, expires })
      }
      for (let index = tiers.length - 1; index >= 0; index--) {
        if (index === skip) continue
        const entries: { key: string; value: string; ttlMs?: number }[] = []
        for (const item of accepted) {
          if (index >= (item.upto ?? tiers.length)) continue
          if (configuration.tiers[index]!.write === CacheWriteMode.back) {
            const prior = pending.get(item.key)
            if (prior?.entry === item.entry) prior.tiers.add(index)
            else
              pending.set(item.key, {
                entry: item.entry,
                policy: item.policy,
                expires: item.expires,
                tiers: new Set([index])
              })
            schedule()
            continue
          }
          try {
            const ms = remaining(item.expires, index)
            if (ms === 0) {
              entries.push({ key: physical(item.key), value: '', ttlMs: 0 })
              continue
            }
            const actual = bounded(item.entry, item.expires, index),
              maximum = configuration.tiers[index]!.maxEntryBytes
            if (
              maximum !== undefined &&
              new TextEncoder().encode(JSON.stringify(actual)).byteLength > maximum
            ) {
              counts.skipped[index]!++
              continue
            }
            const value = await stored(index, actual)
            entries.push({
              key: physical(item.key),
              value,
              ttlMs: remaining(item.expires, index)
            })
          } catch (error) {
            tierError(index, CacheOperation.setMany, error)
            counts.skipped[index]!++
          }
        }
        if (entries.length)
          try {
            await apiAt(index).setMany(entries)
            if (tiers[index]!.borrowed.has(ttl))
              for (const item of entries)
                if (item.ttlMs === undefined)
                  await route(tiers[index]!.borrowed)
                    .use(ttl)
                    .persist(lockKey.text(item.key as string))
          } catch (error) {
            tierError(index, CacheOperation.setMany, error)
          }
      }
    }
    /** One native getMany per visited layer retains the remaining key order and exact input count. */
    const readBatch = async (
      keys: readonly string[],
      policy: ICachePolicy,
      fill: boolean
    ): Promise<Map<string, ICacheFound>> => {
      const missing = new Set(keys),
        found = new Map<string, ICacheFound>()
      for (let index = 0; index < tiers.length && missing.size; index++) {
        const targets = [...missing],
          pendingRows =
            configuration.tiers[index]!.write === CacheWriteMode.back
              ? new Map(
                  targets.flatMap((key) => {
                    const item = pending.get(key)
                    return item ? [[key, item] as const] : []
                  })
                )
              : new Map<string, IPending>()
        const nativeKeys = targets.filter((key) => !pendingRows.has(key))
        let raws: readonly (string | undefined)[] = []
        if (nativeKeys.length)
          try {
            raws = await apiAt(index).getMany(nativeKeys.map(physical))
          } catch (error) {
            tierError(index, CacheOperation.getMany, error)
          }
        const nativeRows = new Map(nativeKeys.map((key, position) => [key, raws[position]]))
        for (const key of targets) {
          const item = pendingRows.get(key),
            match = await decode(
              index,
              key,
              item ? JSON.stringify(bounded(item.entry, item.expires, index)) : nativeRows.get(key),
              policy.staleAfterMs
            )
          if (match) {
            found.set(key, match)
            missing.delete(key)
            counts.hits[index]!++
            if (match.info.negative) counts.negativeHits++
            if (match.info.stale) counts.staleServed++
            core.emit(CacheHook.hit, () => ({
              ...identity,
              tier: index,
              stale: match.info.stale,
              negative: match.info.negative
            }))
          } else {
            counts.misses[index]!++
            core.emit(CacheHook.miss, () => ({ ...identity, tier: index }))
          }
        }
      }
      if (fill)
        await writeBatch(
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
    const loadMany = async <T extends ICodecValue>(
      keys: readonly string[],
      load: ICacheBatchLoader<T>,
      policy: ICachePolicy
    ): Promise<ReadonlyMap<string, T | undefined>> => {
      if (typeof load !== 'function') throw invalidArgument()
      if (policy.mode === CacheText.refresh)
        for (const key of keys)
          if (inflight.get(key)?.mode !== CacheText.refresh) supersede((item) => item === key)
      if (policy.mode === CacheText.bypass) {
        try {
          const values = await load(keys, controller.closingSignal)
          return new Map(keys.map((key) => [key, values.get(key)]))
        } catch (error) {
          throw cacheError(CacheErrorCode.loadFailed, error)
        }
      }
      const found =
        policy.mode === CacheText.normal
          ? await readBatch(keys, policy, true)
          : new Map<string, ICacheFound>()
      const missing = keys.filter((key) => !found.has(key) || found.get(key)!.info.stale)
      const fresh = missing.filter((key) => !inflight.has(key))
      const joins = new Map<string, Promise<ICacheEntryInfo<ICodecValue>>>()
      for (const key of missing) {
        const row = inflight.get(key)
        if (row) joins.set(key, row.promise)
      }
      if (fresh.length) {
        const release = controller.beginMutation(),
          rows = new Map<string, IFlight>()
        const batch = Promise.resolve()
          .then(async () => {
            const invokeLoader = async (actual: readonly string[]) => {
              counts.loads++
              const start = configuration.clock()
              try {
                return await load(actual, controller.closingSignal)
              } catch (error) {
                throw cacheError(CacheErrorCode.loadFailed, error)
              } finally {
                core.emit(CacheHook.load, () => ({
                  ...identity,
                  elapsedMs: configuration.clock() - start,
                  found: true
                }))
              }
            }
            const prepare = async (
              values: ReadonlyMap<string, T | undefined>,
              selected: readonly string[]
            ) => {
              const items: IWriteItem[] = []
              for (const key of selected) {
                const entry = await encodeEntry(configuration, values.get(key), policy)
                if (entry && !rows.get(key)!.superseded) items.push({ key, entry, policy })
              }
              return items
            }
            let values: ReadonlyMap<string, T | undefined>, items: IWriteItem[]
            if (lockIndex !== undefined) {
              const native = route(tiers[lockIndex]!.borrowed) as IStorageBorrowedBackend &
                ICacheNative
              const result = await native.tx!()
                .lock(
                  lockKey.text(physical(fresh[0]!)),
                  ...fresh.slice(1).map((key) => lockKey.text(physical(key)))
                )
                .concurrency(
                  ConcurrencyPolicy.wait({ timeoutMs: configuration.stampedeLock!.timeoutMs })
                )
                .run(async (tx) => {
                  const existing = new Map<string, ICacheFound>(),
                    absent: string[] = []
                  for (const key of fresh) {
                    const hit =
                      policy.mode === CacheText.refresh
                        ? undefined
                        : await decode(
                            lockIndex,
                            key,
                            await tx.get(physical(key)),
                            policy.staleAfterMs,
                            () => tx.remove(physical(key))
                          )
                    if (hit && !hit.info.stale) existing.set(key, hit)
                    else absent.push(key)
                  }
                  const loaded = absent.length
                    ? await invokeLoader(absent)
                    : new Map<string, T | undefined>()
                  const combined = new Map(
                    fresh.map((key) => [
                      key,
                      existing.has(key)
                        ? (existing.get(key)!.info.value as T | undefined)
                        : loaded.get(key)
                    ])
                  )
                  const entries = await prepare(loaded, absent)
                  const accepted: IWriteItem[] = []
                  for (const item of entries) {
                    const expires = plan(item.entry, item.policy)
                    if (
                      !(await indexTags(item.key, item.entry, item.policy, expires)) ||
                      rows.get(item.key)!.superseded
                    )
                      continue
                    accepted.push({ ...item, expires, indexed: true })
                    const maximum = configuration.tiers[lockIndex]!.maxEntryBytes
                    if (
                      maximum !== undefined &&
                      new TextEncoder().encode(JSON.stringify(item.entry)).byteLength > maximum
                    ) {
                      counts.skipped[lockIndex]!++
                      continue
                    }
                    await tx.set(
                      physical(item.key),
                      await stored(lockIndex, bounded(item.entry, expires, lockIndex))
                    )
                    const ms = remaining(expires, lockIndex)
                    if (tiers[lockIndex]!.borrowed.has(ttl)) {
                      if (ms !== undefined)
                        await tx.use(ttl).expire(lockKey.text(physical(item.key)), ms)
                      else await tx.use(ttl).persist(lockKey.text(physical(item.key)))
                    }
                  }
                  for (const [key, hit] of existing)
                    accepted.push({ key, entry: hit.entry, policy, upto: lockIndex })
                  return { combined, entries: accepted }
                })
              values = result.combined
              items = result.entries
            } else {
              values = await invokeLoader(fresh)
              items = await prepare(values, fresh)
            }
            await writeBatch(
              items.filter((item) => !rows.get(item.key)!.superseded),
              lockIndex
            )
            return new Map(
              fresh.map((key) => [
                key,
                {
                  value: values.get(key),
                  tier: undefined,
                  stale: false,
                  negative: values.get(key) === undefined,
                  ageMs: undefined,
                  tags: policy.tags
                }
              ])
            )
          })
          .finally(release)
        for (const key of fresh) {
          const row: IFlight = { superseded: false, mode: policy.mode, promise: undefined! }
          row.promise = batch
            .then((values) => values.get(key)!)
            .finally(() => {
              if (inflight.get(key) === row) inflight.delete(key)
            })
          rows.set(key, row)
          inflight.set(key, row)
          joins.set(key, row.promise)
        }
      }
      const results = new Map(keys.map((key) => [key, found.get(key)?.info.value as T | undefined]))
      await Promise.all(
        missing.map(async (key) => {
          const promise = joins.get(key)!
          if (found.has(key)) {
            void promise.catch(report)
            return
          }
          results.set(key, (await promise).value as T | undefined)
        })
      )
      return results
    }
    store = provideCapabilities(base, [implement(kv, api)] as const, {
      onInstaller: (port) => {
        installer = port
      }
    }) as ICacheStore
    const projection = {
      store,
      installer,
      flush,
      pending: () => pending.size > 0,
      erase,
      reset: async (index: number) => {
        await erase('', true, index, true)
        resetFeeds.add(index)
      },
      propagation: async (change: IStorageChange, upto: number) => {
        if (change.channel !== CacheText.value && change.channel !== CacheText.all) return
        if (!change.keys) await erase('', true, upto, true)
        else
          for (const key of change.keys)
            if (
              typeof key === 'string' &&
              key.startsWith(configuration.prefix) &&
              key !== configuration.prefix + CacheText.cursor
            )
              await erase(key.slice(configuration.prefix.length), false, upto, true)
      }
    }
    projections.set(orgId, projection)
    return projection
  }
  /** Shared tuple/binary keys are rejected using the original string-only public domain guard. */
  function captureKeys(keys: readonly unknown[]): string[] {
    if (!Array.isArray(keys) || Object.keys(keys).length !== keys.length) throw invalidArgument()
    return keys.map((key) => {
      assertStringStorageKey(key, CacheText.backend)
      return key
    })
  }
  const root = bind(core.defaultOrgId)
  /** Durable consumers start in the original detect window after their earlier backends are ready. */
  core.registerDetect(async (signal) => {
    if (signal.aborted) return
    /** Ephemeral native feeds remain host-level and route their explicit organization facts. */
    for (const index of feeds)
      if (configuration.propagate && index > 0) {
        const tier = tiers[index]!
        if (!tier.borrowed.has(durableChangeFeed)) {
          if (typeof tier.native.subscribeChanges !== 'function')
            missingCapability(index, CacheText.changeFeed)
          subscriptions.push(
            tier.native.subscribeChanges((change) => {
              const orgId = change.orgId ?? core.defaultOrgId
              const release = controller.beginMutation()
              return bind(orgId)
                .propagation(change, index)
                .catch((error) => {
                  report(error)
                })
                .finally(release)
            })
          )
        }
      }
    for (const index of feeds)
      if (configuration.propagate && index > 0 && tiers[index]!.borrowed.has(durableChangeFeed)) {
        const source = tiers[index]!.borrowed.use(durableChangeFeed),
          upper = tiers[index - 1]!.borrowed.use(kv)
        let current: Awaited<ReturnType<typeof source.tailChanges>> | undefined,
          needsReset = false,
          restarting: Promise<void> | undefined
        const reset = async (): Promise<void> => {
          untrustedFeeds.add(index)
          for (const projection of projections.values()) await projection.reset(index)
        }
        const after = await upper.get(configuration.prefix + CacheText.cursor)
        if (after === null) await reset()
        /** One reset fact covers failed invalidations without retaining an unbounded batch backlog. */
        const onChange = async (
          change: Parameters<Parameters<typeof source.tailChanges>[0]['onChange']>[0]
        ): Promise<void> => {
          if (controller.closingSignal.aborted) return
          const release = controller.beginMutation()
          try {
            if (needsReset) await reset()
            await bind(change.orgId ?? core.defaultOrgId).propagation(change, index)
            await upper.set(configuration.prefix + CacheText.cursor, change.cursor)
            needsReset = false
          } catch (error) {
            needsReset = true
            report(error)
          } finally {
            release()
          }
        }
        /** Only native cursor expiry restarts from now; disconnects never create a retry timer. */
        const onError = (error: unknown): void => {
          needsReset = true
          report(error)
          if (
            IdentifyError.identityOf(error)?.code !==
              StorageContractErrorCode.changeCursorExpired ||
            controller.closingSignal.aborted ||
            restarting
          )
            return
          const release = controller.beginMutation()
          restarting = (async () => {
            await reset()
            await current?.[asyncDisposeKey]()
            if (!controller.closingSignal.aborted) await start(CacheText.now)
          })()
            .catch(report)
            .finally(() => {
              restarting = undefined
              release()
            })
        }
        const start = async (from: string) => {
          try {
            current = await source.tailChanges(
              {
                from,
                onChange,
                onError
              },
              { signal: controller.closingSignal }
            )
          } catch (error) {
            if (
              IdentifyError.identityOf(error)?.code !== StorageContractErrorCode.changeCursorExpired
            )
              throw error
            await reset()
            current = await source.tailChanges(
              {
                from: CacheText.now,
                onChange,
                onError
              },
              { signal: controller.closingSignal }
            )
          }
        }
        await start(after ?? CacheText.now)
        subscriptions.push(async () => {
          await restarting
          await current?.dispose()
        })
      }
  })
  return {
    store: root.store,
    installer: root.installer,
    controller,
    orgBinding: {
      backend: (orgId: string) => bind(orgId).store,
      drop: async (orgId: string) => {
        await bind(orgId).erase('', true)
      }
    }
  }
}

// Tier routing, deadlines, policies, writes, reads and loaders for the cache store (see ./store.ts).
import {
  snapshotOperationContext,
  lockKey,
  asyncDisposeKey,
  withAbort
} from '@migaia/storage-host/sdk'
import {
  kv,
  ttl,
  blob,
  assertStorageTtlDuration,
  StorageContractError,
  StorageContractErrorCode,
  type IKeyValueApi,
  type IOperationContext,
  type IBlobApi,
  type IRecordStore
} from '@migaia/storage-contract'
import type { ICodecValue } from '@migaia/serialize/codec'
import type { IStorageBorrowedBackend } from '@migaia/storage-host'
import { raceWithAbort, UtilsAbortError } from '@migaia/utils/promise'
import { IdentifyError } from '@migaia/utils/error'
import { CacheText, CacheWriteMode, CacheOperation, CacheHook } from './constants.js'
import { cacheError, invalidArgument, missingCapability } from './errors.js'
import { CacheErrorCode } from '@migaia/storage-contract/error-code'
import { snapshotCachePolicy, shorten, type ICachePolicy } from './policy.js'
import { parseEntry, entryInfo, type ICacheEntry, type ICacheFound } from './entry.js'
import { hashCacheBytes } from './key.js'
import type { ICacheLoader } from './types.js'
import { erase } from './store-flight.js'
import { report, physical, schedule } from './store.js'
import type { ICacheOrganizationContext } from './store.js'

export function route<T extends IStorageBorrowedBackend>(
  organizationContext: ICacheOrganizationContext,
  borrowed: T
): T {
  return organizationContext.ports.callContext.backend(borrowed)
}

export function apiAt(organizationContext: ICacheOrganizationContext, index: number): IKeyValueApi {
  return route(organizationContext, organizationContext.cacheContext.tiers[index]!.borrowed).use(kv)
}

export function blobAt(organizationContext: ICacheOrganizationContext, index: number): IBlobApi {
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
export function tierError(
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
export function run<I, R>(
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
export function plan(
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
export function remaining(
  organizationContext: ICacheOrganizationContext,
  expires: readonly (number | undefined)[],
  index: number
): number | undefined {
  return expires[index] === undefined
    ? undefined
    : Math.max(0, expires[index]! - organizationContext.cacheContext.configuration.clock())
}

/** A layer's exact sampled hard bound survives an unavailable native expiry endpoint. */
export function bounded(
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
export function admitPolicy(
  organizationContext: ICacheOrganizationContext,
  policy: ICachePolicy
): ICachePolicy {
  if (policy.ttlMs !== undefined && policy.ttlMs > 0)
    for (const [index, tier] of organizationContext.cacheContext.tiers.entries())
      if (!tier.borrowed.has(ttl)) missingCapability(index, ttl.name)
  return policy
}

/** Shared batch TTL uses its original finite nonnegative domain, including immediate removal. */
export function batchPolicy(
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
export async function stored(
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
export async function writeOne(
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
export async function indexTags(
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
export async function write(
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
export async function decode(
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
export async function read(
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
export function supersede(
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
export async function callLoader(
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

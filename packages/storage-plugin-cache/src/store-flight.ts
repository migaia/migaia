// Single-key flights, entry loading, erase and flush for the cache store (see ./store.ts).
import { lockKey, ConcurrencyPolicy } from '@migaia/storage-host/sdk'
import { assertStringStorageKey } from '@migaia/storage-contract'
import type { ICodecValue } from '@migaia/serialize/codec'
import type { IStorageBorrowedBackend } from '@migaia/storage-host'
import { CacheText, CacheOperation, CacheHook } from './constants.ts'
import { invalidArgument } from './errors.ts'
import { snapshotCachePolicy, type ICachePolicy } from './policy.ts'
import { encodeEntry, type ICacheEntry, type ICacheFound } from './entry.ts'
import type { ICacheEntryInfo, ICacheLoader } from './types.ts'
import { loadLockedCacheFlight } from './store-batch-flight.ts'
import {
  route,
  callLoader,
  write,
  supersede,
  read,
  apiAt,
  tierError,
  writeOne,
  batchPolicy
} from './store-tier.ts'
import { physical, report } from './store.ts'
import type { ICacheOrganizationContext, IFlight, ICacheNative } from './store.ts'

/** The shared flight lease survives cancellation of every individual caller. */
/** Physical cache composition shares the original controller and explicit borrowed tiers. */
export type ICacheFlightContext = {
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
export async function loadEntry<T extends ICodecValue>(
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
export async function erase(
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
export async function flush(organizationContext: ICacheOrganizationContext): Promise<void> {
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

export function defaults(organizationContext: ICacheOrganizationContext): ICachePolicy {
  return snapshotCachePolicy(organizationContext.cacheContext.configuration)
}

/** Flat KV never exposes codec entries through text APIs. */
export async function get(
  organizationContext: ICacheOrganizationContext,
  key: string
): Promise<string | null> {
  const found = await read(organizationContext, key, defaults(organizationContext), true)
  return found?.entry.t === CacheText.string && typeof found.info.value === 'string'
    ? found.info.value
    : null
}

/** JavaScript batch admission detaches every entry before any pipeline or tier operation. */
export function captureEntries(
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

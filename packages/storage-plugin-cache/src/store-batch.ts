// Batch reads, writes and key capture for the cache store (see ./store.ts).
import { lockKey } from '@migaia/storage-host/sdk'
import { ttl, assertStringStorageKey } from '@migaia/storage-contract'
import type { ICodecValue } from '@migaia/serialize/codec'
import { CacheText, CacheWriteMode, CacheOperation, CacheHook } from './constants.js'
import { cacheError, invalidArgument } from './errors.js'
import { CacheErrorCode } from '@migaia/storage-contract/error-code'
import type { ICachePolicy } from './policy.js'
import type { ICacheFound } from './entry.js'
import type { ICacheEntryInfo, ICacheBatchLoader } from './types.js'
import { executeCacheBatch } from './store-batch-flight.js'
import {
  plan,
  indexTags,
  remaining,
  bounded,
  stored,
  tierError,
  apiAt,
  route,
  decode,
  supersede
} from './store-tier.js'
import { schedule, physical, report } from './store.js'
import type {
  ICacheOrganizationContext,
  IWriteItem,
  IPending,
  IFlight,
  ICacheBackendContext
} from './store.js'

/** All selected entries share one native batch per through tier, with per-key back coalescing. */
export async function writeBatch(
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
export async function readBatch(
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
export async function loadMany<T extends ICodecValue>(
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
export function captureKeys(
  cacheContext: ICacheBackendContext,
  keys: readonly unknown[]
): string[] {
  if (!Array.isArray(keys) || Object.keys(keys).length !== keys.length) throw invalidArgument()
  return keys.map((key) => {
    assertStringStorageKey(key, CacheText.backend)
    return key
  })
}

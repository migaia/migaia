// Batch flights, locked loads and stats for the cache store (see ./store.ts).
import { lockKey, ConcurrencyPolicy } from '@migaia/storage-host/sdk'
import { ttl, type ITransactionScope } from '@migaia/storage-contract'
import type { ICodecValue } from '@migaia/serialize/codec'
import type { IStorageBorrowedBackend } from '@migaia/storage-host'
import { CacheText, CacheHook } from './constants.ts'
import { cacheError } from './errors.ts'
import { CacheErrorCode } from '@migaia/storage-contract/error-code'
import type { ICachePolicy } from './policy.ts'
import { encodeEntry, type ICacheFound } from './entry.ts'
import type { ICacheStore, ICacheBatchLoader } from './types.ts'
import { writeBatch } from './store-batch.ts'
import type { ICacheFlightContext } from './store-flight.ts'
import {
  route,
  decode,
  plan,
  callLoader,
  indexTags,
  stored,
  bounded,
  remaining
} from './store-tier.ts'
import { physical } from './store.ts'
import type { ICacheOrganizationContext, IFlight, IWriteItem, ICacheNative } from './store.ts'

/** One original batch loader shares its accepted keys and supersession rows without another queue. */
type ICacheBatchFlightContext<T extends ICodecValue> = {
  readonly organizationContext: ICacheOrganizationContext
  readonly load: ICacheBatchLoader<T>
  readonly policy: ICachePolicy
  readonly fresh: readonly string[]
  readonly rows: Map<string, IFlight>
}
/** Executes the existing locked/unlocked batch path and retains its original publication order. */
export async function executeCacheBatch<T extends ICodecValue>(
  batchContext: ICacheBatchFlightContext<T>
) {
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
export async function loadLockedCacheFlight(
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
export function cacheStats(
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

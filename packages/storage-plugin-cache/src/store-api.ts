// Public API and native-base classes for the cache store (see ./store.ts).
import { asyncDisposeKey } from '@migaia/storage-host/sdk'
import {
  records,
  assertStringStorageKey,
  type IOperationContext,
  type IRecordStore
} from '@migaia/storage-contract'
import type { ICodecValue } from '@migaia/serialize/codec'
import { CacheText, CacheOperation } from './constants.ts'
import { cacheError, invalidArgument, missingCapability } from './errors.ts'
import { CacheErrorCode } from '@migaia/storage-contract/error-code'
import { snapshotCachePolicy, type ICachePolicy } from './policy.ts'
import { encodeEntry, type ICacheEntry } from './entry.ts'
import type { ICacheEntryInfo } from './types.ts'
import { cacheStats } from './store-batch-flight.ts'
import { captureKeys, readBatch, writeBatch, loadMany } from './store-batch.ts'
import { get, defaults, erase, captureEntries, loadEntry, flush } from './store-flight.ts'
import {
  run,
  supersede,
  write,
  apiAt,
  tierError,
  decode,
  batchPolicy,
  admitPolicy,
  read,
  route,
  blobAt
} from './store-tier.ts'
import { physical, report } from './store.ts'
import type { ICacheOrganizationContext } from './store.ts'

/**
 * Store shape the CacheStoreApi class implements; named because implements cannot take an
 * intersection.
 */
type ICacheStoreApiShape = ICacheOrganizationContext['api']

/**
 * Public cache store methods for one organization: get, set, load, invalidate and batch paths over
 * the tiers.
 */
class CacheStoreApi implements ICacheStoreApiShape {
  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #organizationContext: ICacheOrganizationContext

  get: ICacheStoreApiShape['get'] = (key, ctx) => {
    physical(this.#organizationContext.cacheContext, key)
    return run(this.#organizationContext, CacheOperation.get, key, ctx, (actual) =>
      get(this.#organizationContext, actual)
    )
  }

  has: ICacheStoreApiShape['has'] = (key, ctx) => {
    physical(this.#organizationContext.cacheContext, key)
    return run(
      this.#organizationContext,
      CacheOperation.has,
      key,
      ctx,
      async (actual) => (await get(this.#organizationContext, actual)) !== null
    )
  }

  set: ICacheStoreApiShape['set'] = (key, value, ctx) => {
    physical(this.#organizationContext.cacheContext, key)
    if (typeof value !== 'string') throw invalidArgument()
    return run(
      this.#organizationContext,
      CacheOperation.set,
      { key, value },
      ctx,
      async (actual) => {
        physical(this.#organizationContext.cacheContext, actual.key)
        if (typeof actual.value !== 'string') throw invalidArgument()
        supersede(this.#organizationContext, (item) => item === actual.key)
        const policy = defaults(this.#organizationContext),
          entry = await encodeEntry(
            this.#organizationContext.cacheContext.configuration,
            actual.value,
            policy,
            true
          )
        await write(this.#organizationContext, actual.key, entry!, policy)
      }
    )
  }

  remove: ICacheStoreApiShape['remove'] = (key, ctx) => {
    physical(this.#organizationContext.cacheContext, key)
    return run(this.#organizationContext, CacheOperation.remove, key, ctx, async (actual) => {
      await erase(this.#organizationContext, actual, false)
    })
  }

  keys: ICacheStoreApiShape['keys'] = (ctx) =>
    run(this.#organizationContext, CacheOperation.keys, undefined, ctx, async () => {
      let keys: string[]
      try {
        keys = (await apiAt(this.#organizationContext, 0).keys())
          .filter(
            (key) =>
              key.startsWith(this.#organizationContext.cacheContext.configuration.prefix) &&
              key !== this.#organizationContext.cacheContext.configuration.prefix + CacheText.cursor
          )
          .map((key) =>
            key.slice(this.#organizationContext.cacheContext.configuration.prefix.length)
          )
      } catch (error) {
        tierError(this.#organizationContext, 0, CacheOperation.keys, error)
        return []
      }
      const result: string[] = []
      for (const key of keys) {
        const found = await decode(
          this.#organizationContext,
          0,
          key,
          await apiAt(this.#organizationContext, 0).get(
            physical(this.#organizationContext.cacheContext, key)
          )
        )
        if (found?.entry.t === CacheText.string && !found.info.negative) result.push(key)
      }
      return result
    })

  clearValues: ICacheStoreApiShape['clearValues'] = (ctx) =>
    run(this.#organizationContext, CacheOperation.clearValues, undefined, ctx, async () => {
      await erase(this.#organizationContext, '', true)
    })

  clearAll: ICacheStoreApiShape['clearAll'] = (ctx) =>
    run(this.#organizationContext, CacheOperation.clearAll, undefined, ctx, async () => {
      await erase(this.#organizationContext, '', true)
    })

  removeByPrefix: ICacheStoreApiShape['removeByPrefix'] = (prefix, ctx) => {
    assertStringStorageKey(prefix, CacheText.backend)
    this.#organizationContext.cacheContext.controller.assertLive()
    if (this.#organizationContext.cacheContext.tiers.length > 1)
      missingCapability(-1, CacheText.prefixCountCapability)
    return run(this.#organizationContext, CacheOperation.removeByPrefix, prefix, ctx, (actual) =>
      erase(this.#organizationContext, actual as string, true)
    )
  }

  getMany: ICacheStoreApiShape['getMany'] = (keys, ctx) => {
    const captured = captureKeys(this.#organizationContext.cacheContext, keys)
    return run(this.#organizationContext, CacheOperation.getMany, captured, ctx, async (actual) => {
      const keys = captureKeys(this.#organizationContext.cacheContext, actual),
        found = await readBatch(
          this.#organizationContext,
          keys,
          defaults(this.#organizationContext),
          true
        )
      return keys.map((key) => {
        const match = found.get(key)
        return match?.entry.t === CacheText.string && typeof match.info.value === 'string'
          ? match.info.value
          : undefined
      })
    })
  }

  setMany: ICacheStoreApiShape['setMany'] = (entries, ctx) => {
    const captured = captureEntries(this.#organizationContext, entries)
    return run(this.#organizationContext, CacheOperation.setMany, captured, ctx, async (actual) => {
      /** Canonical entry admission already proves string values and unique keys for this batch. */
      const items: { key: string; entry: ICacheEntry; policy: ICachePolicy }[] = []
      for (const item of captureEntries(this.#organizationContext, actual)) {
        physical(this.#organizationContext.cacheContext, item.key)
        const policy = batchPolicy(this.#organizationContext, item.ttlMs)
        const entry = await encodeEntry(
          this.#organizationContext.cacheContext.configuration,
          item.value,
          policy,
          true
        )
        items.push({ key: item.key, entry: entry!, policy })
      }
      for (const item of items) supersede(this.#organizationContext, (key) => key === item.key)
      await writeBatch(this.#organizationContext, items)
    })
  }

  removeMany: ICacheStoreApiShape['removeMany'] = (keys, ctx) => {
    const captured = [...new Set(captureKeys(this.#organizationContext.cacheContext, keys))]
    return run(
      this.#organizationContext,
      CacheOperation.removeMany,
      captured,
      ctx,
      async (actual) => {
        let count = 0
        for (const key of captureKeys(this.#organizationContext.cacheContext, actual))
          count += await erase(this.#organizationContext, key, false)
        return count
      }
    )
  }

  /** Capture the owner state; members are own-property arrows so the public shape is unchanged. */
  constructor(organizationContext: ICacheOrganizationContext) {
    this.#organizationContext = organizationContext
  }
}

export function createCacheStoreApi(
  organizationContext: ICacheOrganizationContext
): ICacheOrganizationContext['api'] {
  return new CacheStoreApi(organizationContext)
}

/**
 * Store shape the CacheStoreBase class implements; named because implements cannot take an
 * intersection.
 */
type ICacheStoreBaseShape = ICacheOrganizationContext['base']

/** Native-store view of one cache organization used by capability assembly. */
class CacheStoreBase implements ICacheStoreBaseShape {
  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #organizationContext: ICacheOrganizationContext

  backend: ICacheStoreBaseShape['backend'] = CacheText.backend

  capabilities: ICacheStoreBaseShape['capabilities']

  dispose: ICacheStoreBaseShape['dispose'] = () =>
    this.#organizationContext.cacheContext.controller.dispose();

  [asyncDisposeKey]: ICacheStoreBaseShape[typeof asyncDisposeKey] = () =>
    (this.#organizationContext.cacheContext.symbolic ??=
      this.#organizationContext.cacheContext.controller
        .dispose()
        .then(undefined, (error: unknown) => report(this.#organizationContext.cacheContext, error)))

  getOrLoad: ICacheStoreBaseShape['getOrLoad'] = (key, load, options) =>
    this.#organizationContext.store.getOrLoadEntry(key, load, options).then((info) => info.value)

  getOrLoadEntry: ICacheStoreBaseShape['getOrLoadEntry'] = (key, load, options) => {
    physical(this.#organizationContext.cacheContext, key)
    const policy = admitPolicy(
      this.#organizationContext,
      snapshotCachePolicy(this.#organizationContext.cacheContext.configuration, options)
    )
    return run(
      this.#organizationContext,
      CacheOperation.getOrLoad,
      { key, load },
      policy.ctx,
      (actual) => loadEntry(this.#organizationContext, actual.key, actual.load, policy)
    )
  }

  getOrLoadMany: ICacheStoreBaseShape['getOrLoadMany'] = (keys, load, options) => {
    const captured = [...new Set(captureKeys(this.#organizationContext.cacheContext, keys))],
      policy = admitPolicy(
        this.#organizationContext,
        snapshotCachePolicy(this.#organizationContext.cacheContext.configuration, options)
      )
    return run(
      this.#organizationContext,
      CacheOperation.getOrLoadMany,
      captured,
      policy.ctx,
      (actual) =>
        loadMany(
          this.#organizationContext,
          captureKeys(this.#organizationContext.cacheContext, actual),
          load,
          policy
        )
    )
  }

  peek: ICacheStoreBaseShape['peek'] = <T extends ICodecValue>(
    key: string,
    ctx?: IOperationContext
  ) => {
    physical(this.#organizationContext.cacheContext, key)
    return run(
      this.#organizationContext,
      CacheOperation.peek,
      key,
      ctx,
      async (actual) =>
        (await read(this.#organizationContext, actual, defaults(this.#organizationContext), false))
          ?.info
    ) as Promise<ICacheEntryInfo<T> | undefined>
  }

  invalidate: ICacheStoreBaseShape['invalidate'] = (target, ctx) => {
    const captured =
      typeof target === 'string'
        ? { key: target }
        : 'prefix' in target
          ? { prefix: target.prefix }
          : { tag: target.tag }
    if ('key' in captured) physical(this.#organizationContext.cacheContext, captured.key!)
    else if ('prefix' in captured)
      physical(this.#organizationContext.cacheContext, captured.prefix!)
    else if (typeof captured.tag !== 'string' || !this.#organizationContext.cacheContext.tags)
      throw cacheError(CacheErrorCode.tierInvalid)
    return run(
      this.#organizationContext,
      CacheOperation.invalidate,
      captured,
      ctx,
      async (actual) => {
        if ('key' in actual) await erase(this.#organizationContext, actual.key!, false)
        else if ('prefix' in actual) await erase(this.#organizationContext, actual.prefix!, true)
        else {
          const borrowed = route(
              this.#organizationContext,
              this.#organizationContext.cacheContext.tags!
            ),
            native = borrowed as unknown as Omit<
              IRecordStore<{ key: string }>,
              'dispose' | typeof Symbol.asyncDispose
            >
          const iterator = native.iterateRecords({
            lower: [this.#organizationContext.cacheContext.configuration.prefix, actual.tag!],
            upper: [
              this.#organizationContext.cacheContext.configuration.prefix,
              actual.tag!,
              new ArrayBuffer(0)
            ],
            upperOpen: true
          })
          try {
            for await (const [, value] of iterator) {
              if (typeof value.key !== 'string') throw invalidArgument()
              await erase(this.#organizationContext, value.key, false)
            }
          } finally {
            await iterator[asyncDisposeKey]()
          }
          await borrowed
            .use(records)
            .removeByPrefix([
              this.#organizationContext.cacheContext.configuration.prefix,
              actual.tag!
            ])
        }
      }
    )
  }

  flush: ICacheStoreBaseShape['flush'] = (ctx) =>
    run(this.#organizationContext, CacheOperation.flush, undefined, ctx, () =>
      flush(this.#organizationContext)
    )

  sweepOffload: ICacheStoreBaseShape['sweepOffload'] = (ctx) =>
    run(this.#organizationContext, CacheOperation.sweepOffload, undefined, ctx, async () => {
      let count = 0
      const swept = new Set<string>()
      for (const [
        index,
        tier
      ] of this.#organizationContext.cacheContext.configuration.tiers.entries())
        if (tier.offload && !swept.has(tier.offload.backend)) {
          swept.add(tier.offload.backend)
          const retention = Math.max(
            ...this.#organizationContext.cacheContext.configuration.tiers
              .filter((item) => item.offload?.backend === tier.offload!.backend)
              .map((item) => item.ttlMs!)
          )
          let after: string | undefined
          do {
            const page = await blobAt(this.#organizationContext, index).list({
              prefix: this.#organizationContext.cacheContext.configuration.prefix,
              after,
              limit: 256
            })
            for (const info of page.items)
              if (
                info.updatedAt <
                this.#organizationContext.cacheContext.configuration.clock() - retention
              )
                if (await blobAt(this.#organizationContext, index).remove(info.key)) count++
            after = page.next
          } while (after !== undefined)
        }
      return count
    })

  stats: ICacheStoreBaseShape['stats'] = () => cacheStats(this.#organizationContext)

  /** Capture the owner state; members are own-property arrows so the public shape is unchanged. */
  constructor(organizationContext: ICacheOrganizationContext) {
    this.#organizationContext = organizationContext
    this.capabilities = {
      batch: this.#organizationContext.cacheContext.tiers.length === 1,
      syncRead: false,
      binary: false,
      records: false,
      transactions: false,
      iteration: false,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    }
  }
}

export function createCacheStoreBase(
  organizationContext: ICacheOrganizationContext
): ICacheOrganizationContext['base'] {
  return new CacheStoreBase(organizationContext)
}

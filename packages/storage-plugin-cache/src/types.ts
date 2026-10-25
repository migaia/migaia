import type { ICodecValue } from '@migaia/serialize/codec'
import type {
  ICodec,
  IOperationContext,
  IStorageBase,
  ICapabilityStore,
  ICapabilityImpl,
  IKeyValueApi,
  kv
} from '@migaia/storage-contract'
import type { CacheWriteMode } from './constants.js'

/** One already-published backend owns this tier's physical storage and hard expiry. */
export type ICacheTierOptions = {
  readonly backend: string
  readonly ttlMs?: number
  readonly write?: CacheWriteMode
  readonly maxEntryBytes?: number
  readonly offload?: { readonly backend: string; readonly minBytes: number }
}
/** Cache policy composes borrowed tiers without acquiring their configuration or closing authority. */
export type ICacheOptions = {
  readonly tiers: readonly [ICacheTierOptions, ...ICacheTierOptions[]]
  readonly prefix?: string
  readonly maxAgeMs?: number
  readonly staleAfterMs?: number
  readonly negativeTtlMs?: number
  readonly stampedeLock?: { readonly backend: string; readonly timeoutMs?: number }
  readonly writeBackIntervalMs?: number
  readonly propagate?: boolean
  readonly clock?: () => number
  readonly jitterRatio?: number
  /** The original jitter helper consumes this source; omitted uses Math.random. */
  readonly random?: () => number
  readonly codec?: ICodec<ICodecValue, string>
  readonly tagIndex?: { readonly backend: string }
}
/** Per-call policy can shorten configured deadlines without extending any tier's lifetime. */
export type ICacheCallOptions<T = unknown> = {
  readonly ctx?: IOperationContext
  readonly ttlMs?: number
  readonly staleAfterMs?: number
  readonly maxAgeMs?: number
  readonly negativeTtlMs?: number
  readonly tags?: readonly string[]
  readonly meta?: Readonly<Record<string, string | number | boolean>>
  readonly cacheIf?: (value: T) => boolean
  readonly mode?: 'default' | 'refresh' | 'bypass'
}
/** Entry observations expose application facts without returning encoded storage or borrowed stores. */
export type ICacheEntryInfo<T> = Readonly<{
  value: T | undefined
  tier: number | undefined
  stale: boolean
  negative: boolean
  ageMs: number | undefined
  meta?: Readonly<Record<string, string | number | boolean>>
  tags: readonly string[]
}>
/** A shared loader receives the cache closing signal, never an individual caller's cancellation. */
export type ICacheLoader<T> = (signal: AbortSignal) => Promise<T | undefined>
/** One batch loader receives only missing keys not already owned by an active shared load. */
export type ICacheBatchLoader<T> = (
  keys: readonly string[],
  signal: AbortSignal
) => Promise<ReadonlyMap<string, T | undefined>>
/** Counter snapshots retain no values, keys or backend handles. */
export type ICacheStats = Readonly<{
  hits: readonly number[]
  misses: readonly number[]
  loads: number
  staleServed: number
  negativeHits: number
  invalidations: number
  writeBackDropped: number
  skipped: readonly number[]
}>
/**
 * Cache business calls share the original KV token while cross-tier transactions remain
 * unavailable.
 */
export type ICacheStore = ICapabilityStore<
  IStorageBase &
    IKeyValueApi & {
      readonly backend: 'cache'
      getOrLoad<T extends ICodecValue>(
        key: string,
        load: ICacheLoader<T>,
        options?: ICacheCallOptions<T>
      ): Promise<T | undefined>
      getOrLoadEntry<T extends ICodecValue>(
        key: string,
        load: ICacheLoader<T>,
        options?: ICacheCallOptions<T>
      ): Promise<ICacheEntryInfo<T>>
      getOrLoadMany<T extends ICodecValue>(
        keys: readonly string[],
        load: ICacheBatchLoader<T>,
        options?: ICacheCallOptions<T>
      ): Promise<ReadonlyMap<string, T | undefined>>
      peek<T extends ICodecValue>(
        key: string,
        ctx?: IOperationContext
      ): Promise<ICacheEntryInfo<T> | undefined>
      invalidate(
        target: string | { readonly prefix: string } | { readonly tag: string },
        ctx?: IOperationContext
      ): Promise<void>
      flush(ctx?: IOperationContext): Promise<void>
      sweepOffload(ctx?: IOperationContext): Promise<number>
      stats(): ICacheStats
    },
  typeof kv,
  readonly [ICapabilityImpl<typeof kv>]
>

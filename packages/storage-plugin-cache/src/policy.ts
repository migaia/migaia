import { fromValueCodec, snapshotCodec, type ICodec } from '@migaia/storage-contract'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import type { ICodecValue } from '@migaia/serialize/codec'
import { jitter } from '@migaia/utils/number'
import { CacheText, CacheWriteMode } from './constants.js'
import { CacheErrorCode } from './error-code.js'
import { cacheError, invalidArgument } from './errors.js'
import type { ICacheOptions, ICacheCallOptions } from './types.js'

/** Installation snapshots retain only caller-selected policy and the original codec owner. */
export type ICacheConfiguration = ReturnType<typeof snapshotCacheOptions>
/** One call's detached policy never changes after its loader has joined a shared flight. */
export type ICachePolicy = ReturnType<typeof snapshotCachePolicy>
/** Durations are positive safe integer milliseconds throughout cache configuration. */
export function duration(value: unknown, tier?: number): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw cacheError(CacheErrorCode.tierInvalid, undefined, tier)
  return value
}
/** Capture options before any backend is borrowed or modified. */
export function snapshotCacheOptions(options: ICacheOptions & { readonly id?: string }) {
  try {
    const {
      id = CacheText.backend,
      tiers: input,
      prefix = `cache:${id}:`,
      maxAgeMs,
      staleAfterMs,
      negativeTtlMs,
      stampedeLock,
      writeBackIntervalMs = 1000,
      propagate = true,
      clock = Date.now,
      jitterRatio = 0,
      random = Math.random,
      codec,
      tagIndex
    } = options
    if (
      typeof id !== 'string' ||
      !id ||
      !Array.isArray(input) ||
      !input.length ||
      typeof prefix !== 'string' ||
      typeof clock !== 'function' ||
      typeof random !== 'function' ||
      typeof propagate !== 'boolean' ||
      !Number.isFinite(jitterRatio) ||
      jitterRatio < 0 ||
      jitterRatio > 0.5
    )
      throw cacheError(CacheErrorCode.tierInvalid)
    const names = new Set<string>()
    const tiers = input.map((item, tier) => {
      const { backend, ttlMs, write = CacheWriteMode.through, maxEntryBytes, offload } = item
      const ttl = duration(ttlMs, tier)
      if (
        typeof backend !== 'string' ||
        !backend ||
        names.has(backend) ||
        (write !== CacheWriteMode.through && write !== CacheWriteMode.back) ||
        (tier === input.length - 1 && write === CacheWriteMode.back)
      )
        throw cacheError(CacheErrorCode.tierInvalid, undefined, tier)
      names.add(backend)
      const detachedOffload =
        offload === undefined ? undefined : { backend: offload.backend, minBytes: offload.minBytes }
      if (
        detachedOffload &&
        (typeof detachedOffload.backend !== 'string' ||
          !detachedOffload.backend ||
          !Number.isSafeInteger(detachedOffload.minBytes) ||
          detachedOffload.minBytes <= 0 ||
          ttl === undefined)
      )
        throw cacheError(CacheErrorCode.tierInvalid, undefined, tier)
      return Object.freeze({
        backend,
        ttlMs: ttl,
        write,
        maxEntryBytes: duration(maxEntryBytes, tier),
        offload: detachedOffload
      })
    })
    const maximum = duration(maxAgeMs),
      stale = duration(staleAfterMs),
      negative = duration(negativeTtlMs)
    if (
      stale !== undefined &&
      [maximum, ...tiers.map((tier) => tier.ttlMs)].some(
        (limit) => limit !== undefined && stale >= limit
      )
    )
      throw cacheError(CacheErrorCode.tierInvalid)
    const adapted = snapshotCodec(
      codec ?? fromValueCodec(defineJsonCodec({ version: 1 }))
    ) as ICodec<ICodecValue, string>
    if (adapted.output !== 'text') throw cacheError(CacheErrorCode.tierInvalid)
    const lock =
      stampedeLock === undefined
        ? undefined
        : { backend: stampedeLock.backend, timeoutMs: duration(stampedeLock.timeoutMs) ?? 30000 }
    if (lock && !names.has(lock.backend)) throw cacheError(CacheErrorCode.tierInvalid)
    const tags = tagIndex === undefined ? undefined : { backend: tagIndex.backend }
    if (tags && (typeof tags.backend !== 'string' || !tags.backend))
      throw cacheError(CacheErrorCode.tierInvalid)
    return Object.freeze({
      id,
      tiers: Object.freeze(tiers),
      prefix,
      maxAgeMs: maximum,
      staleAfterMs: stale,
      negativeTtlMs: negative,
      stampedeLock: lock,
      writeBackIntervalMs: duration(writeBackIntervalMs)!,
      propagate,
      clock,
      jitterRatio,
      random,
      codec: adapted,
      tagIndex: tags
    })
  } catch (error) {
    if (error instanceof Error && 'source' in error) throw error
    throw cacheError(CacheErrorCode.tierInvalid, error)
  }
}
/** Call overrides can shorten an existing bound; they never extend a configured deadline. */
export function snapshotCachePolicy<T>(
  configuration: ICacheConfiguration,
  options?: ICacheCallOptions<T>
) {
  try {
    const {
      ctx,
      ttlMs,
      maxAgeMs,
      staleAfterMs,
      negativeTtlMs,
      tags: inputTags = [],
      meta: inputMeta,
      cacheIf,
      mode = 'default'
    } = options ?? {}
    const ttl = duration(ttlMs),
      maximum = duration(maxAgeMs),
      stale = duration(staleAfterMs),
      negative = duration(negativeTtlMs)
    for (const [value, bound] of [
      [maximum, configuration.maxAgeMs],
      [stale, configuration.staleAfterMs],
      [negative, configuration.negativeTtlMs],
      ...configuration.tiers.map((tier) => [ttl, tier.ttlMs])
    ])
      if (value !== undefined && bound !== undefined && value > bound)
        throw cacheError(CacheErrorCode.tierInvalid)
    if (
      !Array.isArray(inputTags) ||
      Object.keys(inputTags).length !== inputTags.length ||
      inputTags.some((tag) => typeof tag !== 'string') ||
      (inputTags.length && !configuration.tagIndex) ||
      (cacheIf !== undefined && typeof cacheIf !== 'function') ||
      !['default', 'refresh', 'bypass'].includes(mode)
    )
      throw cacheError(CacheErrorCode.tierInvalid)
    const tags = Object.freeze([...new Set(inputTags)])
    const meta =
      inputMeta === undefined
        ? undefined
        : Object.freeze(
            Object.fromEntries(
              Object.entries(inputMeta).map(([name, value]) => {
                if (
                  !['string', 'boolean', 'number'].includes(typeof value) ||
                  (typeof value === 'number' && !Number.isFinite(value))
                )
                  throw invalidArgument()
                return [name, value]
              })
            )
          )
    const actualMax = maximum ?? configuration.maxAgeMs,
      actualStale = stale ?? configuration.staleAfterMs
    if (
      actualStale !== undefined &&
      [
        actualMax,
        ...configuration.tiers.map((tier) => Math.min(tier.ttlMs ?? Infinity, ttl ?? Infinity))
      ].some((bound) => bound !== undefined && actualStale >= bound)
    )
      throw cacheError(CacheErrorCode.tierInvalid)
    return Object.freeze({
      ctx,
      ttlMs: ttl,
      maxAgeMs: actualMax,
      staleAfterMs: actualStale,
      negativeTtlMs: negative ?? configuration.negativeTtlMs,
      tags,
      meta,
      cacheIf: cacheIf === undefined ? undefined : (value: unknown) => cacheIf(value as T),
      mode
    })
  } catch (error) {
    if (error instanceof Error && 'source' in error) throw error
    throw cacheError(CacheErrorCode.tierInvalid, error)
  }
}
/** The shared numeric owner samples exactly once for each actual finite expiry. */
export function shorten(configuration: ICacheConfiguration, milliseconds: number): number {
  return jitter(milliseconds, configuration.jitterRatio, configuration.random)
}

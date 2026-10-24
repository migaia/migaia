import type { ICodecValue } from '@migaia/serialize/codec'
import { CacheErrorCode } from './error-code.js'
import { cacheError, invalidArgument } from './errors.js'
import { shorten, type ICacheConfiguration, type ICachePolicy } from './policy.js'
import type { ICacheEntryInfo } from './types.js'

/** Fixed envelope is independent of the caller's selected value codec. */
export type ICacheEntry = Readonly<{
  v: 1
  s: 'hit' | 'neg'
  t?: 's' | 'c'
  d?: string | { $blob: string; size: number }
  w: number
  x?: number
  m?: Readonly<Record<string, string | number | boolean>>
  g?: readonly string[]
}>
/** An observed entry retains its exact envelope for original-byte read filling. */
export type ICacheFound = { entry: ICacheEntry; raw: string; info: ICacheEntryInfo<ICodecValue> }
/** Encode once before any layer side effect, retaining the original encoder failure. */
export async function encodeEntry(
  configuration: ICacheConfiguration,
  value: ICodecValue | undefined,
  policy: ICachePolicy,
  flat = false
): Promise<ICacheEntry | undefined> {
  try {
    if (policy.cacheIf && !policy.cacheIf(value)) return undefined
    if (value === undefined && policy.negativeTtlMs === undefined) return undefined
    const age = value === undefined ? policy.negativeTtlMs : policy.maxAgeMs
    const written = configuration.clock()
    const data =
      value === undefined
        ? undefined
        : flat
          ? (value as string)
          : await configuration.codec.encode(value)
    if (data !== undefined && typeof data !== 'string') throw invalidArgument()
    return {
      v: 1,
      s: value === undefined ? 'neg' : 'hit',
      t: flat ? 's' : 'c',
      ...(data === undefined ? {} : { d: data }),
      w: written,
      ...(age === undefined ? {} : { x: written + shorten(configuration, age) }),
      ...(policy.meta === undefined ? {} : { m: policy.meta }),
      g: policy.tags
    }
  } catch (error) {
    throw cacheError(CacheErrorCode.loadFailed, error)
  }
}
/** Parse owned envelope fields without accepting legacy application values as cache hits. */
export function parseEntry(raw: string): ICacheEntry {
  const entry = JSON.parse(raw) as ICacheEntry
  if (
    !entry ||
    typeof entry !== 'object' ||
    entry.v !== 1 ||
    !['hit', 'neg'].includes(entry.s) ||
    !Number.isFinite(entry.w) ||
    (entry.x !== undefined && !Number.isFinite(entry.x)) ||
    (entry.s === 'hit' &&
      (!['s', 'c'].includes(entry.t ?? '') ||
        !(
          typeof entry.d === 'string' ||
          (entry.d &&
            typeof entry.d === 'object' &&
            typeof entry.d.$blob === 'string' &&
            Number.isSafeInteger(entry.d.size) &&
            entry.d.size >= 0)
        ))) ||
    (entry.g !== undefined &&
      (!Array.isArray(entry.g) || entry.g.some((tag) => typeof tag !== 'string'))) ||
    (entry.m !== undefined &&
      (typeof entry.m !== 'object' ||
        entry.m === null ||
        Object.values(entry.m).some(
          (value) =>
            !['string', 'boolean', 'number'].includes(typeof value) ||
            (typeof value === 'number' && !Number.isFinite(value))
        )))
  )
    throw invalidArgument()
  return entry
}
/** Decode only after the native layer or object resource has supplied detached text. */
export async function entryInfo(
  configuration: ICacheConfiguration,
  entry: ICacheEntry,
  tier: number | undefined,
  data: string | undefined,
  staleAfterMs?: number
): Promise<ICacheEntryInfo<ICodecValue>> {
  const age = configuration.clock() - entry.w
  const value =
    entry.s === 'neg' ? undefined : entry.t === 's' ? data : await configuration.codec.decode(data!)
  return {
    value,
    tier,
    stale: staleAfterMs !== undefined && age >= staleAfterMs,
    negative: entry.s === 'neg',
    ageMs: age,
    ...(entry.m === undefined ? {} : { meta: entry.m }),
    tags: entry.g ?? []
  }
}

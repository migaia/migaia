import { describe, expect, it } from 'vitest'
import { cacheKey, CacheWriteMode } from '../src/index.ts'
import { CacheErrorCode, STORAGE_CACHE_ERROR_SOURCE } from '@migaia/storage-contract/error-code'
import { cacheError } from '../src/errors.ts'
import type { ICodecValue } from '@migaia/serialize/codec'

/**
 * Fixed legacy vector combines integer indices, reserved property spelling, prefixes and lone
 * surrogates.
 */
const specialKeys = [
  ['z', 1],
  ['a', 2],
  ['', 3],
  ['10', 4],
  ['2', 5],
  ['01', 6],
  ['__proto__', 7],
  ['\ud800', 8],
  ['\udfff', 9],
  ['\uffff', 10],
  ['\u0000', 11],
  ['prefix', 12],
  ['prefix\u0000', 13]
] as const

/**
 * Captured old projection/validation/JSON/UTF-8/SHA-256 results use saved baseline dist, never the
 * new owner.
 */
const wideKeyVectors = [
  { count: 32, hash: '9bb4ce348a6fd2fd4f3bc417931463dd5ce0deca3ab392894c5651b7d77653a3' },
  { count: 33, hash: 'ed18dc53c08cac37f275ebdca0e3c5f13b93c247ccd082cd8968cca61a81db43' },
  { count: 160, hash: '445fc76daded84d49daeaad32a8bdf42ede19de0922e53922e35c070d4e75a63' }
] as const

/**
 * Rebuild equivalent plain data with every record's insertion order reversed, retaining array
 * order.
 */
function reverseInsertion(value: ICodecValue): ICodecValue {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(reverseInsertion)
  /**
   * Only fixture-owned ordinary data fields are reflected; no production normalization
   * participates.
   */
  const record = value as Readonly<Record<string, ICodecValue>>
  /** Reversing is linear and intentionally differs from both historical and canonical key order. */
  const keys = Object.keys(record).reverse()
  /** Data-property writes preserve own **proto** rather than invoking its inherited setter. */
  const reversed: Record<string, ICodecValue> = {}
  for (const key of keys) {
    Object.defineProperty(reversed, key, {
      value: reverseInsertion(record[key]!),
      enumerable: true,
      configurable: true,
      writable: true
    })
  }
  return reversed
}

/** Reproduce the captured 96-key public cacheKey vector without storing a large repetitive fixture. */
function legacyLargeRecord(): ICodecValue {
  /** Nested arrays and record fields must normalize at every level, not only the root record. */
  const record: Record<string, ICodecValue> = {}
  for (let index = 0; index < 96; index++)
    record[`key${String(95 - index).padStart(3, '0')}`] = {
      z: index,
      a: [{ right: index, left: -index }]
    }
  return record
}

/** Exercise the fixed 32-key cutoff and large MSD ranges spanning both bytes of UTF-16 code units. */
function wideKeyRecord(count: number): ICodecValue {
  /** A long shared prefix must advance linearly without rebuilding bucket tables per character. */
  const prefix = 'shared-prefix:'.repeat(48)
  /** Special fields supply end-of-string, NUL, surrogates and JS integer-index enumeration cases. */
  const entries: (readonly [string, ICodecValue])[] = [...specialKeys]
  for (let index = entries.length; index < count; index++)
    entries.push([
      prefix + String.fromCharCode(((index - specialKeys.length) * 523) & 65535),
      { z: index, a: [{ y: index, b: -index }] }
    ])
  return Object.fromEntries(entries)
}

describe('canonical cache inputs', () => {
  it('uses portable object ordering while retaining part order and content', async () => {
    const first = await cacheKey('response', { model: 'one', options: { seed: 1, temperature: 0 } })
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(await cacheKey('response', { options: { temperature: 0, seed: 1 }, model: 'one' })).toBe(
      first
    )
    expect(
      await cacheKey('response', { model: 'two', options: { seed: 1, temperature: 0 } })
    ).not.toBe(first)
    expect(await cacheKey({ model: 'one' }, 'response')).not.toBe(first)
    expect(CacheWriteMode).toEqual({ through: 'through', back: 'back' })
  })
  it('retains the original portable failure and rejects an empty request before hashing', async () => {
    await expect(cacheKey({ callback: (() => undefined) as never })).rejects.toMatchObject({
      code: expect.any(String)
    })
    await expect(Reflect.apply(cacheKey, undefined, [])).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
  })
  it('wraps a loader failure without dropping its native type, stack or original cause', () => {
    const original = Object.freeze(new RangeError('original loader failure')),
      error = cacheError(CacheErrorCode.loadFailed, original)
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toMatchObject({
      source: STORAGE_CACHE_ERROR_SOURCE,
      code: 'CACHE_LOAD_FAILED',
      cause: original
    })
    expect(error.stack).toBeTruthy()
    expect(original.stack).toBeTruthy()
  })

  it('retains captured pre-migration SHA-256 bytes for nested, UTF-16 and large equivalent inputs', async () => {
    /** Expected hashes were captured from the pre-ruling built cacheKey public export at 7e65024. */
    const vectors: readonly {
      readonly name: string
      readonly parts: readonly [ICodecValue, ...ICodecValue[]]
      readonly hash: string
    }[] = [
      {
        name: 'nested',
        parts: [{ z: 1, a: { y: 2, b: [{ q: 3, c: 4 }] } }],
        hash: 'b80d37c4c68bde2aa64098b6df6b2eeb8d60262a3e46b32d43a2ec1054653467'
      },
      {
        name: 'utf16-special',
        parts: [Object.fromEntries(specialKeys)],
        hash: '5f2febf6445f535ea9e35f9558186d545c38d27bd38568cc9a6a982d739571f9'
      },
      {
        name: 'large-96',
        parts: [legacyLargeRecord()],
        hash: 'e4891e01cee8bd3bb38ff9f46125bdc2dc27655c7b46ba393d662a5dc5e1485f'
      },
      {
        name: 'multiple-parts',
        parts: [{ z: 1, a: 2 }, [{ d: 3, b: 4 }], Object.fromEntries(specialKeys)],
        hash: '4dc9b2fbe56fa0c77be0ebfea067ae77b08505e2d67f290cde5384dd35858ebb'
      }
    ]
    for (const vector of vectors) {
      expect(await cacheKey(...vector.parts), vector.name).toBe(vector.hash)
      /** Each independent equivalent request reverses record insertion while preserving part order. */
      const reversed = vector.parts.map(reverseInsertion) as [ICodecValue, ...ICodecValue[]]
      expect(await cacheKey(...reversed), `${vector.name}: reversed`).toBe(vector.hash)
    }
  })

  it.each(wideKeyVectors)(
    'normalizes $count keys independently of insertion order across native and MSD branches',
    async ({ count, hash }) => {
      /**
       * Fixtures cross the native cutoff and combine long common prefixes with varied code-unit
       * bytes.
       */
      const value = wideKeyRecord(count)
      expect(Object.keys(value as object)).toHaveLength(count)
      expect(await cacheKey(value)).toBe(hash)
      expect(await cacheKey(reverseInsertion(value))).toBe(hash)
    }
  )

  it('never rereads application getters while normalizing the detached projection', async () => {
    /** Getter order belongs to serialize's newly authorized Object.keys projection policy. */
    const reads: string[] = []
    /**
     * The independently declared child getter keeps callback shapes flat while testing recursive
     * reads.
     */
    const nested = {
      get y() {
        reads.push('y')
        return 2
      },
      b: [{ q: 3, c: 4 }]
    }
    /** Pure getters preserve the legacy value while exposing any accidental second caller traversal. */
    const value = {
      get z() {
        reads.push('z')
        return 1
      },
      get a() {
        reads.push('a')
        return nested
      }
    }
    expect(await cacheKey(value)).toBe(
      'b80d37c4c68bde2aa64098b6df6b2eeb8d60262a3e46b32d43a2ec1054653467'
    )
    expect(reads).toEqual(['z', 'a', 'y'])
  })
})

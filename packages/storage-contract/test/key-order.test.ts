import { describe, expect, it } from 'vitest'
import {
  compareStorageKeys,
  encodeOrderedStorageKey,
  snapshotStorageKeyPrefix,
  snapshotStorageKey,
  type IStorageKey
} from '../src/index.js'

/** Compares public byte output lexicographically without decoding or depending on key tags. */
function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!
  }
  return left.length - right.length
}

/** A finite table covers each supported scalar and recursive order boundary. */
const keys: readonly IStorageKey[] = [
  -Number.MAX_VALUE,
  -1,
  -Number.MIN_VALUE,
  -0,
  0,
  Number.MIN_VALUE,
  1,
  Number.MAX_VALUE,
  new Date(-8640000000000000),
  new Date(-1),
  new Date(0),
  new Date(8640000000000000),
  '',
  '\0',
  'a',
  'aa',
  '\ud800',
  '\udc00',
  '\uffff',
  new Uint8Array([]).buffer,
  new Uint8Array([0]).buffer,
  new Uint8Array([0, 0]).buffer,
  new Uint8Array([0, 255]).buffer,
  new Uint8Array([255]).buffer,
  [0],
  [0, 0],
  [0, ''],
  [[0]],
  [[0], 1],
  [1]
]

describe('ordered storage key encoding', () => {
  it('preserves comparator signs and equality across the complete supported key table', () => {
    /** Encodings are computed once per input; each comparison inspects only its own bytes. */
    const encoded = keys.map((key) => encodeOrderedStorageKey(key, 'memory'))
    for (let left = 0; left < keys.length; left += 1) {
      for (let right = 0; right < keys.length; right += 1) {
        expect(Math.sign(compareBytes(encoded[left]!, encoded[right]!))).toBe(
          Math.sign(compareStorageKeys(keys[left]!, keys[right]!)) || 0
        )
      }
    }
    expect(encodeOrderedStorageKey(-0, 'memory')).toEqual(encodeOrderedStorageKey(0, 'memory'))
  })

  it('keeps UTF-16, byte and nested prefixes self-delimited with one owned output', () => {
    /** Each mutable source component belongs to the caller after encoding. */
    const date = new Date(1)
    /** Binary source and output never share a backing buffer. */
    const bytes = new Uint8Array([0, 255])
    /** Nested key combines every mutable component. */
    const input: IStorageKey[] = [date, bytes.buffer, ['x']]
    /** Public reference output must survive later caller changes. */
    const encoded = encodeOrderedStorageKey(input, 'memory')
    /** A separate call owns a separate complete byte allocation. */
    const original = encoded.slice()
    date.setTime(2)
    bytes.fill(7)
    input.push('later')
    expect(encoded).toEqual(original)
    encoded.fill(0)
    expect(date.getTime()).toBe(2)
    expect([...bytes]).toEqual([7, 7])
    expect(encodeOrderedStorageKey('a', 'memory')).toEqual(new Uint8Array([3, 1, 0, 97, 0]))
    expect(encodeOrderedStorageKey(new Uint8Array([0, 255]).buffer, 'memory')).toEqual(
      new Uint8Array([4, 1, 0, 1, 255, 0])
    )
    expect(encodeOrderedStorageKey([''], 'memory')).toEqual(new Uint8Array([5, 3, 0, 0]))
  })

  it('reuses existing domain failures before allocating an encoding', () => {
    for (const key of [[], NaN, Infinity, new Date(NaN), {}, [undefined]]) {
      expect(() => encodeOrderedStorageKey(key, 'catalog')).toThrowError(
        expect.objectContaining({
          source: '@migaia/storage-contract',
          code: 'INVALID_KEY',
          backend: 'catalog'
        })
      )
    }
  })
})

describe('canonical typed key prefixes', () => {
  it('matches strings, binary values and complete leading array children without crossing types', () => {
    const text = snapshotStorageKeyPrefix('a\u0000\ud800', 'memory')
    expect(text.matches('a\u0000\ud800')).toBe(true)
    expect(text.matches('a\u0000\ud800suffix')).toBe(true)
    expect(text.matches('a\u0000other')).toBe(false)
    expect(text.matches(['a\u0000\ud800'])).toBe(false)
    const binary = snapshotStorageKeyPrefix(new Uint8Array([0, 255]).buffer, 'memory')
    expect(binary.matches(new Uint8Array([0, 255, 1]).buffer)).toBe(true)
    expect(binary.matches(new Uint8Array([0]).buffer)).toBe(false)
    const tuple = snapshotStorageKeyPrefix(['tenant', ['group', new Date(3)]], 'memory')
    expect(tuple.matches(['tenant', ['group', new Date(3)], 'next'])).toBe(true)
    expect(tuple.matches(['tenant', ['group', new Date(3), 'nested-extension']])).toBe(false)
    expect(tuple.matches(['tenant-other', ['group', new Date(3)]])).toBe(false)
    expect(snapshotStorageKeyPrefix(-0, 'memory').matches(0)).toBe(true)
    expect(snapshotStorageKeyPrefix(3, 'memory').matches(new Date(3))).toBe(false)
    expect(snapshotStorageKeyPrefix(new Date(3), 'memory').matches(new Date(3))).toBe(true)
    expect(snapshotStorageKeyPrefix('', 'memory').matches('anything')).toBe(true)
    expect(
      snapshotStorageKeyPrefix(new ArrayBuffer(0), 'memory').matches(new Uint8Array([1]).buffer)
    ).toBe(true)
    expect(() => snapshotStorageKeyPrefix([], 'memory')).toThrowError(
      expect.objectContaining({ code: 'INVALID_KEY' })
    )
  })

  it('returns detached logical and byte bounds with a stable private matcher', () => {
    /** Prefix construction must borrow the input no more often than the original snapshot owner. */
    let reads = 0
    const borrowed = Object.defineProperty(['captured'], 0, {
      get() {
        reads++
        return 'captured'
      }
    })
    snapshotStorageKey(borrowed, undefined)
    const canonicalReads = reads
    reads = 0
    const captured = snapshotStorageKeyPrefix(borrowed, undefined)
    expect(reads).toBe(canonicalReads)
    expect(captured.matches(['captured', 'child'])).toBe(true)
    expect(captured.matches(['other'])).toBe(false)
    expect(reads).toBe(canonicalReads)
    const date = new Date(3)
    const bytes = new Uint8Array([1])
    const input: IStorageKey[] = ['tenant', date, bytes.buffer]
    const prefix = snapshotStorageKeyPrefix(input, undefined)
    date.setTime(99)
    bytes.fill(99)
    input.push('later')
    expect(prefix.key).toEqual(['tenant', new Date(3), new Uint8Array([1]).buffer])
    prefix.lower.fill(0)
    prefix.upper.fill(0)
    ;(prefix.key as readonly [string, Date, ArrayBuffer])[1].setTime(99)
    expect(prefix.matches(['tenant', new Date(3), new Uint8Array([1]).buffer, 'child'])).toBe(true)
    expect(prefix.matches(['tenant', new Date(99), new Uint8Array([1]).buffer])).toBe(false)
    expect(Object.isFrozen(prefix)).toBe(true)
  })

  it('produces exactly equivalent inclusive/exclusive byte ranges for every supported prefix kind', () => {
    const keys: IStorageKey[] = [
      -1,
      0,
      1,
      new Date(0),
      new Date(1),
      '',
      'a',
      'aa',
      'a\uffff',
      'a\uffffx',
      'b',
      new ArrayBuffer(0),
      new Uint8Array([0]).buffer,
      new Uint8Array([0, 255]).buffer,
      new Uint8Array([0, 255, 1]).buffer,
      ['a'],
      ['a', 1],
      ['aa'],
      [['a']],
      [['a'], 1],
      [['a', 1]]
    ]
    for (const prefixKey of keys) {
      const prefix = snapshotStorageKeyPrefix(prefixKey, 'catalog')
      for (const key of keys) {
        const encoded = encodeOrderedStorageKey(key, 'catalog')
        expect(prefix.matches(key)).toBe(
          compareBytes(encoded, prefix.lower) >= 0 && compareBytes(encoded, prefix.upper) < 0
        )
      }
    }
  })
})

import { describe, expect, it } from 'vitest'
import { compareStorageKeys, encodeOrderedStorageKey, type IStorageKey } from '../src/index.js'

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

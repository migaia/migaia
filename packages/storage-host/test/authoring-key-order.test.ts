import { describe, expect, it, vi } from 'vitest'
import {
  compareStorageKeys,
  encodeOrderedStorageKey,
  encodeStorageOrgKey,
  decodeStorageOrgKey,
  snapshotStorageOrgKeyPrefix,
  snapshotStorageKeyPrefix,
  prefixStorageOrgKey,
  encodeStorageOrgStringPrefix,
  orderStorageKeysByBytes,
  snapshotStorageBatchKeys,
  createStorageBatchKeyCapture,
  projectStorageBatchKeys,
  snapshotStorageKey
} from '../src/authoring/key.js'
import { type IStorageKey } from '@migaia/storage-contract'

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

describe('organization ordered wire keys', () => {
  /** Fixed caller identities let the original organization owner distinguish foreign envelopes. */
  const orgId = '11111111-1111-1111-1111-111111111111'
  const otherOrgId = '22222222-2222-2222-2222-222222222222'

  it('retains maximum logical depth and node budgets without changing the original wire format', () => {
    /** Only the logical key consumes the original depth and node limits. */
    let deep: IStorageKey = 'leaf'
    for (let depth = 0; depth < 32; depth++) deep = [deep]
    /** Root plus 4095 children exactly fills the original logical node budget. */
    const wide: IStorageKey = Array.from({ length: 4095 }, () => '')
    for (const key of [deep, wide, ...keys]) {
      const encoded = encodeStorageOrgKey(orgId, key, 'redis')
      expect(compareStorageKeys(decodeStorageOrgKey(orgId, encoded, 'redis'), key)).toBe(0)
    }
    expect(encodeStorageOrgKey(orgId, ['orders', 1], 'redis')).toEqual(
      encodeOrderedStorageKey(prefixStorageOrgKey(orgId, ['orders', 1]), 'redis')
    )
    expect(() => encodeStorageOrgKey(orgId, [deep], 'redis')).toThrowError(
      expect.objectContaining({ code: 'INVALID_KEY', backend: 'redis' })
    )
    expect(() =>
      encodeStorageOrgKey(
        orgId,
        Array.from({ length: 4096 }, () => ''),
        'redis'
      )
    ).toThrowError(expect.objectContaining({ code: 'INVALID_KEY' }))
  })

  it('projects original typed prefixes and full tenant ranges without shrinking logical limits', () => {
    const inRange = (bytes: Uint8Array, range: { lower: Uint8Array; upper: Uint8Array }) =>
      Buffer.compare(bytes, range.lower) >= 0 && Buffer.compare(bytes, range.upper) < 0
    const all = snapshotStorageOrgKeyPrefix(orgId, undefined, 'redis')
    let deep: IStorageKey = 'leaf'
    for (let depth = 0; depth < 32; depth++) deep = [deep]
    const wide: IStorageKey = Array.from({ length: 4095 }, () => '')
    for (const key of [...keys, deep, wide]) {
      expect(inRange(encodeStorageOrgKey(orgId, key, 'redis'), all)).toBe(true)
      expect(inRange(encodeStorageOrgKey(otherOrgId, key, 'redis'), all)).toBe(false)
    }
    for (const prefix of [
      'str',
      '\ud800',
      1,
      new Date(0),
      new Uint8Array([1]).buffer,
      ['a'],
      deep,
      wide
    ]) {
      const range = snapshotStorageOrgKeyPrefix(orgId, prefix, 'redis')
      const logical = snapshotStorageKeyPrefix(prefix, 'redis')
      for (const key of [...keys, prefix, deep, wide])
        expect(inRange(encodeStorageOrgKey(orgId, key, 'redis'), range)).toBe(logical.matches(key))
    }
    expect(() => snapshotStorageOrgKeyPrefix(orgId, [], 'redis')).toThrowError(
      expect.objectContaining({ code: 'INVALID_KEY' })
    )
    expect(() => snapshotStorageOrgKeyPrefix('invalid', undefined, 'redis')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })

  it('checks tenant and wire boundaries while retaining the original logical decoder limits', () => {
    const encoded = encodeStorageOrgKey(orgId, 'user/\ud800', 'redis')
    const prefix = encodeStorageOrgStringPrefix(orgId, 'user/', 'redis')
    expect(encoded.subarray(0, prefix.byteLength)).toEqual(prefix)
    expect(() => decodeStorageOrgKey(otherOrgId, encoded, 'redis')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => decodeStorageOrgKey(orgId, encoded.subarray(0, -1), 'redis')).toThrowError(
      expect.objectContaining({ code: 'INVALID_KEY' })
    )
    /** An invalid outer terminator fails before the logical decoder receives any bytes. */
    const brokenBoundary = encoded.slice()
    brokenBoundary[brokenBoundary.byteLength - 1] = 255
    expect(() => decodeStorageOrgKey(orgId, brokenBoundary, 'redis')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    /** Duplicate one logical component before its tuple end to exceed only the original node limit. */
    const full = encodeStorageOrgKey(
      orgId,
      Array.from({ length: 4095 }, () => ''),
      'redis'
    )
    const extra = encodeOrderedStorageKey('', 'redis')
    const hostile = new Uint8Array(full.byteLength + extra.byteLength)
    hostile.set(full.subarray(0, -2))
    hostile.set(extra, full.byteLength - 2)
    hostile.set(full.subarray(-2), full.byteLength - 2 + extra.byteLength)
    expect(() => decodeStorageOrgKey(orgId, hostile, 'redis')).toThrowError(
      expect.objectContaining({ code: 'INVALID_KEY' })
    )
  })
})

describe('ordered storage key encoding', () => {
  it('orders captured selector bytes stably through the same canonical radix', () => {
    const bytes = new Uint8Array([2])
    const rows = [
      { id: 'first', key: bytes },
      { id: 'prefix', key: new Uint8Array() },
      { id: 'second', key: new Uint8Array([2]) },
      { id: 'long', key: new Uint8Array([2, 0]) },
      { id: 'one', key: new Uint8Array([1]) }
    ]
    const select = vi.fn((row: (typeof rows)[number]) => {
      if (row.id === 'second') bytes.fill(0)
      return row.key
    })
    const sorted = orderStorageKeysByBytes(rows, select)
    expect(sorted.map((row) => row.id)).toEqual(['prefix', 'one', 'first', 'second', 'long'])
    expect(sorted[2]).toBe(rows[0])
    expect(select).toHaveBeenCalledTimes(rows.length)
    expect(orderStorageKeysByBytes([], select)).toEqual([])
    const invalidLength = new Proxy([], {
      get: (_target, name) => (name === 'length' ? Infinity : undefined)
    })
    expect(() => orderStorageKeysByBytes(invalidLength, select)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(select).toHaveBeenCalledTimes(rows.length)

    const cause = new Error('selector failed')
    expect(() =>
      orderStorageKeysByBytes(rows, () => {
        throw cause
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT', cause }))
    expect(() => orderStorageKeysByBytes(rows, () => [] as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })

  it('captures native entries at their original per-item validation boundary', () => {
    /** The original native owner decides when to inspect values or reject canonical duplicates. */
    const capture = createStorageBatchKeyCapture('memory')
    /** Capturing a position does not inspect the caller's next entry or any value/TTL field. */
    const first = capture(['x', new Date(3)])
    const second = capture(['x', new Date(3)])
    expect(first.firstIndex).toBe(0)
    expect(second.firstIndex).toBe(0)
    expect(second.identity).toBe(first.identity)
    expect(capture('next').firstIndex).toBe(2)
    /** A failed logical key cannot consume a successful input position. */
    expect(() => capture(NaN)).toThrowError(expect.objectContaining({ code: 'INVALID_KEY' }))
    expect(capture('last').firstIndex).toBe(3)
    /** The eager array entry remains exactly the same snapshots and identities. */
    const direct = createStorageBatchKeyCapture('memory')
    expect(['x', 'x', 'y'].map(direct)).toEqual(snapshotStorageBatchKeys(['x', 'x', 'y'], 'memory'))
    /**
     * Synchronous terminals borrow the admitted key while retaining the same native identity
     * metadata.
     */
    const key = ['x', new Date(3)]
    const projected = projectStorageBatchKeys([key, ['x', new Date(3)]], 'memory')
    expect(projected[0]!.key).toBe(key)
    expect(projected.map(({ identity, firstIndex }) => ({ identity, firstIndex }))).toEqual(
      snapshotStorageBatchKeys([key, ['x', new Date(3)]], 'memory').map(
        ({ identity, firstIndex }) => ({ identity, firstIndex })
      )
    )
  })

  it('retains typed equality without changing native batch order', () => {
    const input = [[new Date(3)], [new Date(3)], 0, -0, '0']
    const batch = snapshotStorageBatchKeys(input, 'memory')
    expect(batch.map((entry) => entry.firstIndex)).toEqual([0, 0, 2, 2, 4])
    expect(batch.map((entry) => entry.identity)).toEqual(
      batch.map((entry) =>
        Array.from(encodeOrderedStorageKey(entry.key, 'memory'), (byte) =>
          byte.toString(16).padStart(2, '0')
        ).join('')
      )
    )
    /** Independent binary snapshots survive both caller mutation and an equivalent duplicate. */
    const bytes = new Uint8Array([1, 2])
    const binary = snapshotStorageBatchKeys([bytes.buffer, bytes.slice().buffer], undefined)
    bytes.fill(9)
    expect(binary[0]!.key).toEqual(new Uint8Array([1, 2]).buffer)
    expect(binary[1]!.firstIndex).toBe(0)
  })

  it('rejects canonical write duplicates and invalid batch input before exposing any native work', () => {
    for (const keys of [
      [0, -0],
      [new Date(3), new Date(3)],
      [['x'], ['x']]
    ])
      expect(() =>
        snapshotStorageBatchKeys(keys, 'catalog', { rejectDuplicates: true })
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT', backend: 'catalog' }))
    expect(snapshotStorageBatchKeys([], undefined, { rejectDuplicates: true })).toEqual([])
    expect(() => snapshotStorageBatchKeys([NaN], 'catalog')).toThrowError(
      expect.objectContaining({ code: 'INVALID_KEY', backend: 'catalog' })
    )
    expect(() => snapshotStorageBatchKeys(null as never, 'catalog')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT', backend: 'catalog' })
    )
  })

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

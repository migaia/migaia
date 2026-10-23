import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  lockKey,
  compareStorageKeys,
  snapshotConcurrencyLockHoldings,
  snapshotConcurrencyLockKeys,
  snapshotConcurrencyLockRange,
  type ILockHolding,
  type ILockKey,
  type IStorageKey
} from '../src/index.js'
import { normalizeLockKeys, snapshotLockKey } from '../src/concurrency.js'

/** Oracle compares established key meanings and fixed channel order, independent of new encoding. */
function compareLockKeys(left: ILockKey, right: ILockKey): number {
  /** This small table is independent test data, not a production lock identity owner. */
  const channel = { text: 0, bytes: 1, record: 2 }
  return channel[left.channel] - channel[right.channel] || compareStorageKeys(left.key, right.key)
}

describe('canonical lock identities', () => {
  it('snapshots factory inputs and preserves exact channel types without a fabricated backend', () => {
    /** Caller-owned mutable key components must detach immediately at factory invocation. */
    const date = new Date(1)
    const bytes = new Uint8Array([0, 255])
    const source: IStorageKey[] = ['profile', date, bytes.buffer]
    const text = lockKey.text(source)
    const record = lockKey.record(source)
    const binary = lockKey.bytes('blob')
    expectTypeOf(text.channel).toEqualTypeOf<'text'>()
    expectTypeOf(record.channel).toEqualTypeOf<'record'>()
    expectTypeOf(binary.key).toEqualTypeOf<string>()
    date.setTime(2)
    bytes.fill(7)
    source.push('changed')
    expect(text.key).toEqual(['profile', new Date(1), new Uint8Array([0, 255]).buffer])
    expect(record.key).toEqual(text.key)
    expect(Object.isFrozen(text)).toBe(true)
    expect(() => lockKey.record({} as IStorageKey)).toThrowError(
      expect.objectContaining({ code: 'INVALID_KEY', backend: undefined })
    )
    expect(() => lockKey.bytes(1 as unknown as string)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT', backend: undefined })
    )
  })

  it('sorts three channels by established key order and deduplicates equivalent mutable identities', () => {
    /** Independent equal Date/buffer/tuple objects represent the same physical lock. */
    const inputs: ILockKey[] = [
      lockKey.record(['x', new Date(1)]),
      lockKey.text('z'),
      lockKey.bytes('z'),
      lockKey.text(1),
      lockKey.text('1'),
      lockKey.record(-0),
      lockKey.record(0),
      lockKey.record(new Uint8Array([0, 255]).buffer),
      lockKey.record(new Uint8Array([0, 255]).buffer),
      lockKey.record(['x', new Date(1)]),
      lockKey.text(new Date(-1)),
      lockKey.text('a')
    ]
    /** A small comparison oracle is allowed in the test, never in the production normalization. */
    const expected = inputs
      .slice()
      .sort(compareLockKeys)
      .filter((key, index, sorted) => index === 0 || compareLockKeys(sorted[index - 1]!, key) !== 0)
    const normalized = normalizeLockKeys(inputs, 'memory')
    expect(normalized.map((item) => item.key)).toEqual(expected)
    expect(normalized).toHaveLength(9)
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(normalizeLockKeys([], 'memory')).toEqual([])
    /** Actual strings and typed batch keys keep different canonical identities. */
    const text = normalized.filter((item) => item.key.channel === 'text')
    expect(text.map((item) => item.key.key)).toContain(1)
    expect(text.map((item) => item.key.key)).toContain('1')
  })

  it('keeps encoded internal identity independent of all caller-owned key components', () => {
    /** Public factory snapshots can remain mutable internally without mutating normalized identity. */
    const date = new Date(1)
    const source = lockKey.record([date, new Uint8Array([1]).buffer])
    const normalized = normalizeLockKeys([source], 'catalog')
    const before = normalized[0]!.encoded.slice()
    const sourceKey = source.key as readonly [Date, ArrayBuffer]
    sourceKey[0].setTime(50)
    new Uint8Array(sourceKey[1]).fill(99)
    expect(normalized[0]!.encoded).toEqual(before)
    expect(normalized[0]!.key.key).toEqual([new Date(1), new Uint8Array([1]).buffer])
    normalized[0]!.encoded.fill(0)
    expect(sourceKey[0].getTime()).toBe(50)
    expect(new Uint8Array(sourceKey[1])[0]).toBe(99)
  })

  it('reads lock container and array accessors once and preserves exact getter failures', () => {
    /** Channel/key getters belong to the caller and are captured before validation. */
    const reads = { channel: 0, key: 0, item: 0 }
    const candidate = {
      get channel() {
        reads.channel += 1
        return 'record' as const
      },
      get key() {
        reads.key += 1
        return ['x', 1]
      }
    }
    const inputs: ILockKey[] = []
    Object.defineProperty(inputs, 0, {
      configurable: true,
      get() {
        reads.item += 1
        return candidate
      }
    })
    expect(normalizeLockKeys(inputs, 'actual-backend')).toHaveLength(1)
    expect(reads).toEqual({ channel: 1, key: 1, item: 1 })
    const original = new Error('lock getter failed')
    expect(() =>
      snapshotLockKey(
        {
          get channel(): never {
            throw original
          }
        },
        'actual-backend'
      )
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        backend: 'actual-backend',
        cause: original
      })
    )
    Object.defineProperty(inputs, 0, {
      configurable: true,
      get() {
        throw original
      }
    })
    expect(() => normalizeLockKeys(inputs, 'actual-backend')).toThrowError(
      expect.objectContaining({ cause: original })
    )
  })

  it.each([null, [], {}, { channel: 'other', key: 'x' }, { channel: 'bytes', key: 1 }])(
    'rejects invalid lock containers %#',
    (key) => {
      expect(() => snapshotLockKey(key, 'catalog')).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT', backend: 'catalog' })
      )
    }
  )

  it('rejects sparse/nonarray lock sets before execution and preserves canonical key-domain errors', () => {
    /** A sparse actual array has no valid lock at its sole declared position. */
    const sparse: ILockKey[] = []
    sparse.length = 1
    for (const keys of [null, {}, sparse])
      expect(() => normalizeLockKeys(keys, 'catalog')).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    expect(() => normalizeLockKeys([{ channel: 'record', key: {} }], 'catalog')).toThrowError(
      expect.objectContaining({ code: 'INVALID_KEY', backend: 'catalog' })
    )
  })

  it('snapshots current holdings in canonical order without merging lease or holder rows', () => {
    /** Borrowed native inspection state must remain independent from the returned snapshot. */
    const holder = {
      status: 'held' as const,
      owner: 'native-owner',
      label: 'writer',
      since: 1,
      scope: 'local' as const
    }
    const date = new Date(2)
    const bytes = new Uint8Array([3])
    const rows: ILockHolding[] = [
      {
        key: { channel: 'record', key: [date, bytes.buffer] },
        holder,
        expired: true,
        expiresAt: 5
      },
      {
        key: lockKey.bytes('a'),
        holder: { status: 'handing-off', scope: 'remote' },
        expired: false
      },
      { key: lockKey.text('z'), holder, expired: false, expiresAt: 9 },
      {
        key: lockKey.text('z'),
        holder: { ...holder, owner: 'other-owner' },
        expired: true,
        expiresAt: 8
      },
      { key: lockKey.text(1), holder, expired: false }
    ]
    const expected = rows.slice().sort((left, right) => compareLockKeys(left.key, right.key))
    const snapshot = snapshotConcurrencyLockHoldings(rows)
    expect(snapshot).toEqual(expected)
    expect(snapshot).toHaveLength(5)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(snapshot.every((row) => Object.isFrozen(row) && Object.isFrozen(row.holder))).toBe(true)
    date.setTime(99)
    bytes.fill(99)
    holder.label = 'changed'
    rows.length = 0
    expect(snapshot[4]!.key.key).toEqual([new Date(2), new Uint8Array([3]).buffer])
    expect(snapshot[4]!.holder).toMatchObject({ label: 'writer' })
    expect(snapshot[1]!.holder).toMatchObject({ owner: 'native-owner' })
    expect(snapshot[2]!.holder).toMatchObject({ owner: 'other-owner' })
    expect(snapshotConcurrencyLockHoldings([])).toEqual([])
    const original = new Error('inspection getter failed')
    expect(() =>
      snapshotConcurrencyLockHoldings([
        {
          get key(): never {
            throw original
          }
        } as unknown as ILockHolding
      ])
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT', cause: original }))
  })

  it('publishes detached matching lock keys and pure half-open channel/prefix intervals', () => {
    /** Public snapshots share canonical deduplication without exposing encoded mutable bytes. */
    const date = new Date(1)
    const captured = snapshotConcurrencyLockKeys(
      [
        lockKey.record(date),
        lockKey.text('users/1'),
        lockKey.bytes('users/1'),
        lockKey.record(new Date(1))
      ],
      'memory'
    )
    date.setTime(9)
    expect(captured.keys).toEqual([
      lockKey.text('users/1'),
      lockKey.bytes('users/1'),
      lockKey.record(new Date(1))
    ])
    expect(captured.identities).toHaveLength(3)
    expect(Object.isFrozen(captured)).toBe(true)
    expect(Object.isFrozen(captured.keys)).toBe(true)
    expect(Object.isFrozen(captured.identities)).toBe(true)
    for (const [index, channel] of ['text', 'bytes', 'record'].entries()) {
      const bounds = snapshotConcurrencyLockRange(
        { channel: channel as ILockKey['channel'] },
        'memory'
      )
      expect(Object.isFrozen(bounds)).toBe(true)
      expect(captured.identities.filter((id) => bounds.lower <= id && id < bounds.upper)).toEqual([
        captured.identities[index]
      ])
    }
    /** Typed ranges retain content-prefix, complete array-child and exact scalar semantics. */
    for (const [prefix, included, excluded] of [
      ['users/', 'users/1', 'users-extra'],
      [['users'], ['users', 1], ['users-extra']],
      [new Uint8Array([1]).buffer, new Uint8Array([1, 2]).buffer, new Uint8Array([2]).buffer],
      [1, 1, 2],
      [new Date(1), new Date(1), new Date(2)]
    ] as const) {
      const bounds = snapshotConcurrencyLockRange({ channel: 'record', prefix }, 'memory')
      const yes = snapshotConcurrencyLockKeys([lockKey.record(included)], 'memory').identities[0]!
      const no = snapshotConcurrencyLockKeys([lockKey.record(excluded)], 'memory').identities[0]!
      expect(bounds.lower <= yes && yes < bounds.upper).toBe(true)
      expect(bounds.lower <= no && no < bounds.upper).toBe(false)
    }
    const bytes = snapshotConcurrencyLockRange({ channel: 'bytes', prefix: '' }, 'memory')
    expect(captured.identities[1]! >= bytes.lower && captured.identities[1]! < bytes.upper).toBe(
      true
    )
    expect(() =>
      snapshotConcurrencyLockRange({ channel: 'bytes', prefix: 1 }, 'memory')
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    const original = new Error('range getter failed')
    expect(() =>
      snapshotConcurrencyLockRange(
        {
          get channel(): never {
            throw original
          }
        },
        'memory'
      )
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT', cause: original }))
  })

  it('handles a long key with many short keys using an explicit suffix stack and no comparison sort', () => {
    /** One unusually long key must not pad every shorter key to this length. */
    const long = 'a'.repeat(20_000)
    const keys = [
      lockKey.record(long),
      ...Array.from({ length: 512 }, (_, index) => lockKey.record(index))
    ].reverse()
    const normalized = normalizeLockKeys(keys, 'memory')
    expect(normalized).toHaveLength(513)
    expect(normalized.slice(0, 512).map((item) => item.key.key)).toEqual(
      Array.from({ length: 512 }, (_, index) => index)
    )
    expect(normalized[512]!.key.key).toBe(long)
    /** Known simple keys reveal only the channel prefix followed by the original canonical bytes. */
    expect(normalizeLockKeys([lockKey.text('a')], 'memory')[0]!.encoded).toEqual(
      new Uint8Array([1, 3, 1, 0, 97, 0])
    )
  })
})

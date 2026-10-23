import { describe, expect, it, vi } from 'vitest'
import {
  ttl,
  counter,
  implement,
  provideCapabilities,
  defineStorageCapability,
  snapshotStorageTtlTarget,
  assertStorageTtlDuration,
  snapshotStorageCounterIncrement,
  type IStorageBase
} from '../src/index.js'

/** Scalar contract fixtures own no data or native resource beyond their original base lifetime. */
function base(): IStorageBase {
  return {
    backend: 'scalar-fixture',
    capabilities: {
      syncRead: false,
      binary: false,
      records: false,
      transactions: false,
      iteration: false,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    dispose: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined
  }
}

describe('standard scalar capability contracts', () => {
  it('admits complete scalar shapes by exact token identity and captures no replacement root API', () => {
    const expiration = {
      expire: vi.fn(async () => true),
      remaining: vi.fn(async () => 1),
      persist: vi.fn(async () => false)
    }
    const increments = { increment: vi.fn(async () => 2) }
    const store = provideCapabilities(base(), [
      implement(ttl, expiration),
      implement(counter, increments)
    ])
    expect(store.use(ttl)).toBe(expiration)
    expect(store.use(counter)).toBe(increments)
    expect(store.has(defineStorageCapability<unknown>()('ttl'))).toBe(false)
    for (const method of ['expire', 'remaining', 'persist'])
      expect(() =>
        provideCapabilities(base(), [
          implement(ttl, { ...expiration, [method]: undefined } as never)
        ])
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => provideCapabilities(base(), [implement(counter, {} as never)])).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    const missing = provideCapabilities(base(), [])
    expect(() => missing.use(ttl as never)).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_CAPABILITY',
        capability: 'ttl',
        backend: 'scalar-fixture'
      })
    )
  })

  it('captures the original physical TTL target and permits every finite nonnegative duration', () => {
    const date = new Date(3)
    const captured = snapshotStorageTtlTarget({ channel: 'record', key: ['x', date] }, 'memory')
    date.setTime(9)
    expect(captured).toEqual({ channel: 'record', key: ['x', new Date(3)] })
    expect(Object.isFrozen(captured)).toBe(true)
    for (const ms of [0, -0, 0.5, Number.MAX_VALUE])
      expect(() => assertStorageTtlDuration(ms, 'memory')).not.toThrow()
    for (const ms of [-1, NaN, Infinity, '1'])
      expect(() => assertStorageTtlDuration(ms as number, 'memory')).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT', backend: 'memory' })
      )
    expect(() =>
      snapshotStorageTtlTarget({ channel: 'bytes', key: 1 } as never, 'memory')
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('captures the delta before native work and validates canonical decimal arithmetic in the atomic owner', () => {
    const increment = snapshotStorageCounterIncrement(undefined, 'memory')
    expect(increment(undefined)).toBe(1)
    expect(increment(null)).toBe(1)
    expect(increment('0')).toBe(1)
    expect(increment('-2')).toBe(-1)
    expect(snapshotStorageCounterIncrement(-2, 'memory')('3')).toBe(1)
    expect(snapshotStorageCounterIncrement(0, 'memory')('3')).toBe(3)
    for (const by of [1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null])
      expect(() => snapshotStorageCounterIncrement(by as number, 'memory')).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    for (const current of [
      '',
      ' ',
      '+1',
      '-0',
      '00',
      '01',
      '-01',
      '1.0',
      '1e2',
      String(Number.MAX_SAFE_INTEGER + 1),
      String(Number.MAX_SAFE_INTEGER)
    ])
      expect(() => increment(current)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    expect(() =>
      snapshotStorageCounterIncrement(-1, 'memory')(String(Number.MIN_SAFE_INTEGER))
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    const coercion = vi.fn(() => '1')
    expect(() => increment({ valueOf: coercion } as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(coercion).not.toHaveBeenCalled()
  })
})

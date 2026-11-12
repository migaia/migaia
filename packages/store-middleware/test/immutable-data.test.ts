import { describe, expect, it } from 'vitest'
import { isImmutableSnapshotData } from '../src/immutable-data.ts'

describe('isImmutableSnapshotData', () => {
  it('admits a plain DataView and rejects one with custom keys', () => {
    expect(isImmutableSnapshotData(new DataView(new ArrayBuffer(4)))).toBe(true)
    const tagged = Object.assign(new DataView(new ArrayBuffer(4)), { label: 'x' })
    expect(isImmutableSnapshotData(tagged)).toBe(false)
  })

  it('rejects typed arrays, maps and sets that carry own properties', () => {
    expect(isImmutableSnapshotData(new Uint8Array(2))).toBe(true)
    expect(isImmutableSnapshotData(Object.assign(new Uint8Array(2), { label: 'x' }))).toBe(false)
    expect(isImmutableSnapshotData(new Map([[1, { a: 1 }]]))).toBe(true)
    expect(isImmutableSnapshotData(Object.assign(new Map(), { label: 'x' }))).toBe(false)
    expect(isImmutableSnapshotData(new Map([[1, new Date()]]))).toBe(true)
    expect(isImmutableSnapshotData(new Set([{ a: 1 }]))).toBe(true)
    expect(isImmutableSnapshotData(Object.assign(new Set(), { label: 'x' }))).toBe(false)
    expect(isImmutableSnapshotData(new Set([new (class Custom {})()]))).toBe(false)
  })

  it('rejects symbol keys, non-enumerable properties and accessors on plain data', () => {
    expect(isImmutableSnapshotData({ [Symbol('s')]: 1 })).toBe(false)
    const hidden = {}
    Object.defineProperty(hidden, 'value', { value: 1, enumerable: false })
    expect(isImmutableSnapshotData(hidden)).toBe(false)
    expect(
      isImmutableSnapshotData({
        get value() {
          return 1
        }
      })
    ).toBe(false)
    expect(isImmutableSnapshotData([1, [2, { three: 3 }]])).toBe(true)
  })
})

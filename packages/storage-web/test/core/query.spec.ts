import { describe, expect, it } from 'vitest'
import { isStorageKeyInRange } from '../../src/core/query'

describe('shared query range owner', () => {
  it('SWV2-T16 uses shared comparator for inclusive and exclusive bounds', () => {
    expect(isStorageKeyInRange(2, { lower: 2, upper: 10 })).toBe(true)
    expect(isStorageKeyInRange(2, { lower: 2, lowerOpen: true, upper: 10 })).toBe(false)
    expect(isStorageKeyInRange(10, { lower: 2, upper: 10, upperOpen: true })).toBe(false)
    expect(isStorageKeyInRange(['users', 'u1'], { lower: ['users'] })).toBe(true)
  })

  it('SWV2-T16 covers compound, date, and binary index keys', () => {
    const date = new Date('2026-01-02T00:00:00.000Z')
    expect(isStorageKeyInRange(date, { lower: new Date('2026-01-01T00:00:00.000Z') })).toBe(true)
    expect(
      isStorageKeyInRange(new Uint8Array([2]).buffer, { upper: new Uint8Array([1]).buffer })
    ).toBe(false)
    expect(isStorageKeyInRange(['users', date], { lower: ['users', date] })).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { intrinsicConstructorName } from '../../src/core/brand'
import { isUint8Array } from '../../src/core/bytes'

describe('cross-realm brand helpers', () => {
  it('rejects a forged constructor name for byte values', () => {
    const forged = Object.create({ constructor: { name: 'Uint8Array' } })
    expect(isUint8Array(forged)).toBe(false)
    expect(intrinsicConstructorName(forged)).toBe('Uint8Array')
  })

  it('returns undefined for primitive and null values', () => {
    expect(intrinsicConstructorName(null)).toBeUndefined()
    expect(intrinsicConstructorName('Uint8Array')).toBeUndefined()
  })
})

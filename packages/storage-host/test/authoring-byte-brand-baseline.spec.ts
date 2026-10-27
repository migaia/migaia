import { describe, expect, it } from 'vitest'
import { isUint8Array } from '@migaia/utils/bytes'

describe('byte-brand baseline', () => {
  it('rejects a real non-Uint8 view whose mutable prototype claims Uint8Array', () => {
    const forged = new Int8Array(1)
    Object.setPrototypeOf(forged, { constructor: { name: 'Uint8Array' } })

    expect(isUint8Array(forged)).toBe(false)
  })
})

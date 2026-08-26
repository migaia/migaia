import { describe, expect, it } from 'vitest'
import { isUint8Array } from '../src/bytes.js'

describe('SWV2-T55 byte-brand red baseline', () => {
  it('rejects a real non-Uint8 view whose mutable prototype claims Uint8Array', () => {
    const forged = new Int8Array(1)
    Object.setPrototypeOf(forged, { constructor: { name: 'Uint8Array' } })

    expect(isUint8Array(forged)).toBe(false)
  })
})

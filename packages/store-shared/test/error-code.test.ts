import { describe, expect, it } from 'vitest'
import {
  createStoreSharedRangeError,
  StoreSharedErrorCode,
  STORE_SHARED_SOURCE
} from '../src/errors'

describe('store-shared error-code contract (E-T9)', () => {
  it('declares 7 unique codes under the package source', () => {
    const codes = Object.values(StoreSharedErrorCode)
    expect(codes).toHaveLength(7)
    expect(new Set(codes).size).toBe(7)
    expect(STORE_SHARED_SOURCE).toBe('@migaia/store-shared')
  })

  it('preserves native RangeError identity through shared attachment', () => {
    const error = createStoreSharedRangeError(StoreSharedErrorCode.invalidOption, 'invalid option')
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toMatchObject({ source: STORE_SHARED_SOURCE, code: 'INVALID_OPTION' })
    expect(error.stack).toContain('invalid option')
  })
})

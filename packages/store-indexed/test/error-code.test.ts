import { describe, expect, it } from 'vitest'
import {
  createStoreIndexedRangeError,
  StoreIndexedErrorCode,
  STORE_INDEXED_SOURCE
} from '../src/errors'

describe('store-indexed error-code contract (E-T9)', () => {
  it('declares 5 unique codes under the package source', () => {
    const codes = Object.values(StoreIndexedErrorCode)
    expect(codes).toHaveLength(5)
    expect(new Set(codes).size).toBe(5)
    expect(STORE_INDEXED_SOURCE).toBe('@migaia/store-indexed')
  })

  it('preserves native RangeError identity through the shared attachment helper', () => {
    const error = createStoreIndexedRangeError(
      StoreIndexedErrorCode.invalidOption,
      'invalid option'
    )
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toMatchObject({ source: STORE_INDEXED_SOURCE, code: 'INVALID_OPTION' })
    expect(error.stack).toContain('invalid option')
  })
})

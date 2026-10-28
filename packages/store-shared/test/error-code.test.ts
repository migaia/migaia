import { describe, expect, it } from 'vitest'
import {
  createStoreSharedRangeError,
  StoreSharedErrorCode,
  STORE_SHARED_SOURCE
} from '../src/errors.ts'

describe('store-shared error-code contract', () => {
  it('declares 8 unique codes under the package source', () => {
    const codes = Object.values(StoreSharedErrorCode)
    expect(codes).toHaveLength(8)
    expect(new Set(codes).size).toBe(8)
    expect(STORE_SHARED_SOURCE).toBe('store.shared')
  })

  it('preserves native RangeError identity through shared attachment', () => {
    const error = createStoreSharedRangeError(StoreSharedErrorCode.invalidOption, 'invalid option')
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toMatchObject({ source: STORE_SHARED_SOURCE, code: 'INVALID_OPTION' })
    expect(error.stack).toContain('invalid option')
  })
})

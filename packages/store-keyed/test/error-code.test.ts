import { describe, expect, it } from 'vitest'
import {
  createStoreKeyedRangeError,
  StoreKeyedErrorCode,
  STORE_KEYED_SOURCE
} from '../src/errors.ts'

describe('store-keyed error-code contract', () => {
  it('declares 10 unique codes under the package source', () => {
    const codes = Object.values(StoreKeyedErrorCode)
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    expect(STORE_KEYED_SOURCE).toBe('store.keyed')
  })

  it('preserves native RangeError, cause, and stack through shared attachment', () => {
    const cause = new Error('cause')
    const error = createStoreKeyedRangeError(StoreKeyedErrorCode.invalidOption, 'invalid option', {
      cause
    })
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toMatchObject({ source: STORE_KEYED_SOURCE, code: 'INVALID_OPTION', cause })
    expect(error.stack).toContain('invalid option')
  })
})

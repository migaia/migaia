import { describe, expect, it } from 'vitest'
import {
  StoreMiddlewareErrorCode,
  STORE_MIDDLEWARE_SOURCE,
  createStoreMiddlewareAggregateError,
  createStoreMiddlewareError
} from '../src/errors'

describe('store-middleware error-code contract (E-T9)', () => {
  it('declares 7 unique codes under the package source', () => {
    const codes = Object.values(StoreMiddlewareErrorCode)
    expect(codes).toHaveLength(7)
    expect(new Set(codes).size).toBe(7)
    expect(STORE_MIDDLEWARE_SOURCE).toBe('@migaia/store-middleware')
  })

  it('shared attachment preserves native Error/AggregateError identity and stack', () => {
    const cause = new Error('cause')
    const error = createStoreMiddlewareError(StoreMiddlewareErrorCode.invalidOption, 'message', {
      cause
    })
    const aggregate = createStoreMiddlewareAggregateError(
      StoreMiddlewareErrorCode.cleanupFailed,
      [cause],
      'cleanup'
    )
    expect(error).toBeInstanceOf(Error)
    expect(error.cause).toBe(cause)
    expect(error.stack).toBeTruthy()
    expect(aggregate).toBeInstanceOf(AggregateError)
    expect(aggregate.errors).toEqual([cause])
    expect(aggregate.stack).toBeTruthy()
    expect((error as Error & { readonly source: string }).source).toBe(STORE_MIDDLEWARE_SOURCE)
  })
})

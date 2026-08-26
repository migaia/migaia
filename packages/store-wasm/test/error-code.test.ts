import { describe, expect, it } from 'vitest'
import { createStoreWasmAggregateError, StoreWasmErrorCode, STORE_WASM_SOURCE } from '../src/errors'

describe('store-wasm error-code contract (E-T9)', () => {
  it('declares 7 unique codes under the package source', () => {
    const codes = Object.values(StoreWasmErrorCode)
    expect(codes).toHaveLength(7)
    expect(new Set(codes).size).toBe(7)
    expect(STORE_WASM_SOURCE).toBe('@migaia/store-wasm')
  })
})

it('preserves AggregateError entries through shared identity attachment', () => {
  const primary = new Error('primary')
  const cleanup = new Error('cleanup')
  const error = createStoreWasmAggregateError(
    StoreWasmErrorCode.cleanupFailed,
    [primary, cleanup],
    'cleanup failed'
  )
  expect(error).toBeInstanceOf(AggregateError)
  expect(error.errors).toEqual([primary, cleanup])
  expect(error).toMatchObject({ source: STORE_WASM_SOURCE, code: 'CLEANUP_FAILED' })
  expect(error.stack).toContain('cleanup failed')
})

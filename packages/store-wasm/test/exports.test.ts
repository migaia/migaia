import { describe, expect, it } from 'vitest'
import { array, boolean, number, record, string } from '../src/index'

describe('store-wasm exports', () => {
  it('exposes the field builders without loading a Store facade', () => {
    expect(typeof number).toBe('function')
    expect(typeof boolean).toBe('function')
    expect(typeof string).toBe('function')
    expect(typeof array).toBe('function')
    expect(typeof record).toBe('function')
  })
})

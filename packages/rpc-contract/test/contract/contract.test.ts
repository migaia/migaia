import { describe, expect, it } from 'vitest'
import { normalizePortable } from '@migaia/rpc-contract/portable'
import { deserializeRpcError, serializeRpcError } from '@migaia/rpc-contract/errors'
import { normalizeRpcFrame } from '@migaia/rpc-contract/protocol'
import { header } from '../fixtures/core-profile.js'

describe('rpc-contract pure business boundary', () => {
  it('rejects live metadata accessors without evaluating them under the sole closed profile', () => {
    let reads = 0
    const input = {
      ...header(),
      options: {},
      get payload() {
        reads++
        return null
      }
    }
    expect(() => normalizeRpcFrame(input)).toThrow()
    expect(reads).toBe(0)
    expect(() =>
      normalizeRpcFrame(
        Object.assign(Object.create({ inherited: true }), { ...header(), options: {} })
      )
    ).toThrow()
    expect(() => normalizePortable(new Date())).toThrow()
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(() => normalizePortable(cycle)).toThrow()
    expect(normalizePortable({ __proto__: 'safe' })).toEqual({})
  })
  it('round-trips a bounded serialized error graph without replacing native types', () => {
    const cause = new RangeError('root cause')
    Object.defineProperty(cause, 'source', { value: '@test', enumerable: true })
    Object.defineProperty(cause, 'code', { value: 'CAUSE', enumerable: true })
    const root = new TypeError('root')
    Object.defineProperty(root, 'source', { value: '@test', enumerable: true })
    Object.defineProperty(root, 'code', { value: 'ROOT', enumerable: true })
    Object.defineProperty(root, 'cause', { value: cause })
    const restored = deserializeRpcError(serializeRpcError(root, { report: () => {} }))
    expect(restored).toBeInstanceOf(TypeError)
    expect(restored.stack).toBe(root.stack)
    expect((restored as Error & { cause: Error }).cause).toBeInstanceOf(RangeError)
    const aggregate = new AggregateError([cause], 'aggregate')
    const restoredAggregate = deserializeRpcError(
      serializeRpcError(aggregate, { report: () => {} })
    )
    expect(restoredAggregate).toBeInstanceOf(AggregateError)
    expect((restoredAggregate as AggregateError).errors[0]).toBeInstanceOf(RangeError)
  })
})

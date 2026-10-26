import { describe, expect, it } from 'vitest'
import { normalizePortable } from '@migaia/rpc-contract/portable'
import { deserializeRpcError, serializeRpcError } from '@migaia/rpc-contract/errors'

describe('rpc-contract pure business boundary', () => {
  it('rejects non-portable caller values', () => {
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

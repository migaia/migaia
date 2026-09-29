import { describe, expect, it } from 'vitest'
import { deserializeRpcError, serializeRpcError } from '../../src/contract/index.js'

describe('wire error relay', () => {
  it('preserves data and truncation through a second native error boundary', () => {
    const original = new AggregateError([new TypeError('child')], 'many') as AggregateError & {
      data?: unknown
      truncated?: true
    }
    original.data = { reason: ['retry'] }
    original.truncated = true
    const reports: unknown[] = []
    const first = serializeRpcError(original, {
      report: (failure) => {
        reports.push(failure)
      }
    })
    const restored = deserializeRpcError(first)
    const second = serializeRpcError(restored, {
      report: (failure) => {
        reports.push(failure)
      }
    })
    expect(restored).not.toBe(original)
    expect(second).toEqual(first)
    expect(second.truncated).toBe(true)
    expect(second.data).toEqual({ reason: ['retry'] })
    expect(reports).toEqual([])
  })
})

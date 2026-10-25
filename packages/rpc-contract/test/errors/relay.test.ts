/** Pure error relay preserves the original graph metadata at its canonical Contract owner. */
import { describe, expect, it } from 'vitest'
import { deserializeRpcError, serializeRpcError } from '@migaia/rpc-contract'

describe('wire error relay', () => {
  it('preserves data and truncation through a second native error boundary', () => {
    /** The original aggregate carries application data and an already established truncation mark. */
    const original = new AggregateError([new TypeError('child')], 'many') as AggregateError & {
      data?: unknown
      truncated?: true
    }
    original.data = { reason: ['retry'] }
    original.truncated = true
    /** Both serialization passes must report no conversion failure for this supported graph. */
    const reports: unknown[] = []
    /** First capture becomes the comparison oracle for the second native boundary. */
    const first = serializeRpcError(original, {
      report: (failure) => {
        reports.push(failure)
      }
    })
    /** Restoration creates a new native aggregate without losing its maintained wire metadata. */
    const restored = deserializeRpcError(first)
    /** Relaying the restored native value must reproduce the original complete wire object. */
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

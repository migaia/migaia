import { describe, expect, it } from 'vitest'
import {
  fromJsonRpcError,
  normalizeRpcSerializedError,
  serializeRpcError,
  toJsonRpcError
} from '../../src/contract/index.js'

describe('wire error JSON-RPC 2.0 mapping', () => {
  it('round-trips a cause tree in the extension data key', () => {
    const wire = serializeRpcError(new Error('outer', { cause: new TypeError('inner') }), {
      report: () => {}
    })
    const mapped = toJsonRpcError(wire, -32000)
    expect(mapped.code).toBe(-32000)
    expect(mapped.message).toBe('outer')
    expect(mapped.data).toMatchObject({ migaiaWireError: wire })
    expect(fromJsonRpcError(mapped)).toEqual(wire)
  })

  it('synthesizes a canonical foreign identity and portable data', () => {
    const wire = fromJsonRpcError({
      code: -32601,
      message: 'Method not found',
      data: { hint: 1 }
    })
    expect(wire).toMatchObject({
      source: 'jsonrpc-2.0',
      code: '-32601',
      name: 'Error',
      message: 'Method not found',
      stack: 'Error: Method not found',
      data: { hint: 1 }
    })
  })

  it('rejects invalid extensions and malformed shape without fallback', () => {
    expect(() =>
      fromJsonRpcError({ code: -1, message: 'm', data: { migaiaWireError: 1 } })
    ).toThrow(expect.objectContaining({ code: 'INVALID_WIRE_ERROR' }))
    for (const value of [{ code: 1.5, message: 'm' }, { code: -1 }])
      expect(() => fromJsonRpcError(value)).toThrow(
        expect.objectContaining({
          code: 'INVALID_WIRE_ERROR',
          violation: 'jsonRpcShape',
          cause: value
        })
      )
    expect(() =>
      toJsonRpcError(serializeRpcError(new Error('m'), { report: () => {} }), 1.5)
    ).toThrow(
      expect.objectContaining({ code: 'INVALID_WIRE_ERROR', violation: 'jsonRpcCode', cause: 1.5 })
    )
  })

  it('truncates only the locally synthesized stack when message itself fits', () => {
    const wire = fromJsonRpcError({ code: -1, message: 'x'.repeat(65_530) })
    expect(wire.message).toHaveLength(65_530)
    expect(wire.stack).toHaveLength(65_536)
    expect(wire.truncated).toBe(true)
    expect(normalizeRpcSerializedError(wire)).toEqual(wire)
    expect(() => fromJsonRpcError({ code: -1, message: 'x'.repeat(65_537) })).toThrow(
      expect.objectContaining({
        code: 'INVALID_WIRE_ERROR',
        violation: 'stringBytes',
        pointer: '/message'
      })
    )
  })
})

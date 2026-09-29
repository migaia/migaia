import { describe, expect, it } from 'vitest'
import {
  deserializeRpcError,
  normalizeRpcSerializedError,
  RpcContractErrorCode
} from '../../src/contract/index.js'
import { RpcCoreErrorCode } from '../../src/core/errors.js'

/** Complete minimal node with a known remote stack. */
function wire(name = 'Error'): {
  source: string
  code: string
  name: string
  message: string
  stack: string
  cause?: unknown
  errors?: unknown[]
  data?: unknown
  truncated?: boolean
} {
  return {
    source: 'remote',
    code: 'REMOTE',
    name,
    message: 'message',
    stack: `${name}: remote stack`
  }
}

describe('wire error validation and native restoration', () => {
  it('restores each named native error without replacing the remote stack', () => {
    for (const [name, constructor] of [
      ['TypeError', TypeError],
      ['RangeError', RangeError],
      ['SyntaxError', SyntaxError],
      ['ReferenceError', ReferenceError],
      ['URIError', URIError],
      ['EvalError', EvalError],
      ['AggregateError', AggregateError]
    ] as const) {
      const restored = deserializeRpcError(wire(name))
      expect(restored, name).toBeInstanceOf(constructor)
      expect(restored.stack).toBe(`${name}: remote stack`)
    }
    const abort = deserializeRpcError(wire('AbortError'))
    expect(abort).toBeInstanceOf(DOMException)
    expect(abort.name).toBe('AbortError')
    const foreign = deserializeRpcError(wire('ForeignError'))
    expect(foreign).toBeInstanceOf(Error)
    expect(foreign.name).toBe('ForeignError')
  })

  it('falls back to Error when DOMException is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'DOMException')
    try {
      Object.defineProperty(globalThis, 'DOMException', { value: undefined, configurable: true })
      const restored = deserializeRpcError(wire('AbortError'))
      expect(restored).toBeInstanceOf(Error)
      expect(restored.name).toBe('AbortError')
    } finally {
      if (original) Object.defineProperty(globalThis, 'DOMException', original)
    }
  })

  it('attaches identity, cause, errors, data, and truncation with stable descriptors', () => {
    const source = wire('Error')
    source.cause = wire('TypeError')
    source.errors = [wire('RangeError')]
    source.data = { reason: 'x' }
    source.truncated = true
    const restored = deserializeRpcError(source)
    expect(restored.cause).toBeInstanceOf(TypeError)
    expect((restored as Error & { readonly errors: readonly Error[] }).errors[0]).toBeInstanceOf(
      RangeError
    )
    expect(Object.getOwnPropertyDescriptor(restored, 'source')).toMatchObject({
      enumerable: true,
      writable: false,
      configurable: false
    })
    expect(Object.getOwnPropertyDescriptor(restored, 'code')).toMatchObject({
      enumerable: true,
      writable: false,
      configurable: false
    })
    expect(Object.getOwnPropertyDescriptor(restored, 'cause')).toMatchObject({
      enumerable: false,
      writable: true,
      configurable: true
    })
    expect(Object.getOwnPropertyDescriptor(restored, 'errors')).toMatchObject({
      enumerable: false,
      writable: false,
      configurable: true
    })
    expect(Object.getOwnPropertyDescriptor(restored, 'data')).toMatchObject({
      enumerable: true,
      writable: false,
      configurable: false
    })
    expect(Object.getOwnPropertyDescriptor(restored, 'truncated')).toMatchObject({
      enumerable: false,
      writable: false,
      configurable: false
    })
  })

  it('keeps the whole malformed input or the original getter value reachable', () => {
    const missing = wire()
    missing.cause = { source: 's', code: 'C', name: 'Error', message: 'm' }
    let received: unknown
    try {
      deserializeRpcError(missing)
    } catch (error) {
      received = error
    }
    expect(received).toMatchObject({
      code: 'INVALID_WIRE_ERROR',
      violation: 'required',
      pointer: '/cause/stack',
      cause: missing
    })
    const failure = new Error('getter')
    const hostile = {
      ...wire(),
      get cause(): never {
        throw failure
      }
    }
    try {
      normalizeRpcSerializedError(hostile)
    } catch (error) {
      received = error
    }
    expect(received).toMatchObject({
      code: 'INVALID_WIRE_ERROR',
      violation: 'read',
      pointer: '/cause',
      cause: failure
    })
    const invalidData = { ...wire(), data: { $rpc: 'error' } }
    try {
      normalizeRpcSerializedError(invalidData)
    } catch (error) {
      received = error
    }
    expect(received).toMatchObject({
      code: 'INVALID_WIRE_ERROR',
      violation: 'dataPortable',
      pointer: '/data'
    })
    expect((received as Error).cause).toMatchObject({ code: 'INVALID_ENVELOPE' })
  })

  it('keeps contract and core semantic code ownership separate', () => {
    expect(RpcContractErrorCode.invalidWireError).toBe('INVALID_WIRE_ERROR')
    expect(Object.values(RpcContractErrorCode)).not.toContain('PAYLOAD_INVALID')
    expect(RpcCoreErrorCode.payloadInvalid).toBe('PAYLOAD_INVALID')
  })
})

import { describe, expect, it } from 'vitest'
import {
  isRpcError,
  tagRpcError,
  RPC_CORE_ERROR_SOURCE,
  RpcAbortError,
  RpcChunkError,
  RpcConfigurationError,
  RpcConstructionError,
  RpcContractError,
  RpcError,
  RpcCoreErrorCode,
  RpcLifecycleError,
  RpcProtocolError,
  RpcRemoteError,
  RpcSerializationError,
  RpcTimeoutError
} from '../../src/core/errors.js'

describe('error boundary helpers', () => {
  it('reports a hostile code getter as PROPERTY_READ_FAILED with the original cause', () => {
    const failure = new Error('hostile getter')
    const value = new Proxy(
      {},
      {
        get() {
          throw failure
        }
      }
    )
    expect(() => isRpcError(value)).toThrow(
      expect.objectContaining({ code: 'PROPERTY_READ_FAILED', cause: failure })
    )
  })

  it('keeps protocol-family error codes distinct', () => {
    expect(new RpcSerializationError('payload').code).toBe('PAYLOAD_INVALID')
    expect(new RpcProtocolError('protocol').code).toBe('PROTOCOL_INVALID')
    expect(new RpcContractError('contract').code).toBe('CONTRACT_INVALID')
    expect(new RpcChunkError('chunk').code).toBe('CHUNK_INVALID')
    expect(RpcCoreErrorCode.middlewareMissing).toBe('MIDDLEWARE_MISSING')
  })

  it('uses standard AbortError/TimeoutError names for cross-realm type checks (§5.5)', () => {
    expect(new RpcAbortError().name).toBe('AbortError')
    expect(new RpcTimeoutError().name).toBe('TimeoutError')
    expect(new RpcAbortError().code).toBe('CANCELLED')
    expect(new RpcTimeoutError().code).toBe('DEADLINE_EXCEEDED')
  })

  it('keeps the (source, code) contract: 27 unique codes and a constant source (E-T1/E-T2)', () => {
    const codes = Object.values(RpcCoreErrorCode)
    expect(codes).toHaveLength(30)
    expect(new Set(codes).size).toBe(codes.length)
    const samples: ReadonlyArray<{ readonly source: string; readonly code: string }> = [
      new RpcError(RpcCoreErrorCode.internal, 'base'),
      new RpcConfigurationError('config'),
      new RpcConstructionError('construct', new Error('root'), []),
      new RpcLifecycleError('lifecycle'),
      new RpcSerializationError('serialize'),
      new RpcRemoteError('CUSTOM_REMOTE', 'remote'),
      new RpcAbortError(),
      new RpcTimeoutError()
    ]
    for (const error of samples) {
      expect(error.source).toBe(RPC_CORE_ERROR_SOURCE)
      expect(typeof error.code).toBe('string')
    }
  })

  it('tagRpcError keeps the native runtime type while attaching (source, code) (§2.2)', () => {
    const typeError = tagRpcError(new TypeError('bad option'), RpcCoreErrorCode.invalidConfig)
    const rangeError = tagRpcError(new RangeError('bad range'), RpcCoreErrorCode.invalidConfig)
    expect(typeError).toBeInstanceOf(TypeError)
    expect(rangeError).toBeInstanceOf(RangeError)
    expect(typeError.source).toBe(RPC_CORE_ERROR_SOURCE)
    expect(typeError.code).toBe('INVALID_CONFIG')
    expect(rangeError.code).toBe('INVALID_CONFIG')
    expect(typeError.message).toBe('bad option')
  })
})

import { describe, expect, it } from 'vitest'
import {
  isWebRpcError,
  tagWebRpcError,
  WEBRPC_SOURCE,
  WebRpcAbortError,
  WebRpcChunkError,
  WebRpcConfigurationError,
  WebRpcConstructionError,
  WebRpcContractError,
  WebRpcError,
  WebRpcErrorCode,
  WebRpcLifecycleError,
  WebRpcProtocolError,
  WebRpcRemoteError,
  WebRpcSerializationError,
  WebRpcTimeoutError
} from '../src/errors'

describe('error boundary helpers', () => {
  it('does not let a hostile code getter escape', () => {
    const value = new Proxy(
      {},
      {
        get() {
          throw new Error('hostile getter')
        }
      }
    )
    expect(isWebRpcError(value)).toBe(false)
  })

  it('keeps protocol-family error codes distinct', () => {
    expect(new WebRpcSerializationError('payload').code).toBe('PAYLOAD_INVALID')
    expect(new WebRpcProtocolError('protocol').code).toBe('PROTOCOL_INVALID')
    expect(new WebRpcContractError('contract').code).toBe('CONTRACT_INVALID')
    expect(new WebRpcChunkError('chunk').code).toBe('CHUNK_INVALID')
    expect(WebRpcErrorCode.middlewareMissing).toBe('MIDDLEWARE_MISSING')
  })

  it('uses standard AbortError/TimeoutError names for cross-realm type checks (§5.5)', () => {
    expect(new WebRpcAbortError().name).toBe('AbortError')
    expect(new WebRpcTimeoutError().name).toBe('TimeoutError')
    expect(new WebRpcAbortError().code).toBe('CANCELLED')
    expect(new WebRpcTimeoutError().code).toBe('DEADLINE_EXCEEDED')
  })

  it('keeps the (source, code) contract: 38 unique codes and a constant source (E-T1/E-T2)', () => {
    const codes = Object.values(WebRpcErrorCode)
    expect(codes).toHaveLength(38)
    expect(new Set(codes).size).toBe(codes.length)
    const samples: ReadonlyArray<{ readonly source: string; readonly code: string }> = [
      new WebRpcError(WebRpcErrorCode.internal, 'base'),
      new WebRpcConfigurationError('config'),
      new WebRpcConstructionError('construct', new Error('root'), []),
      new WebRpcLifecycleError('lifecycle'),
      new WebRpcSerializationError('serialize'),
      new WebRpcRemoteError('CUSTOM_REMOTE', 'remote'),
      new WebRpcAbortError(),
      new WebRpcTimeoutError()
    ]
    for (const error of samples) {
      expect(error.source).toBe(WEBRPC_SOURCE)
      expect(typeof error.code).toBe('string')
    }
  })

  it('tagWebRpcError keeps the native runtime type while attaching (source, code) (§2.2)', () => {
    const typeError = tagWebRpcError(new TypeError('bad option'), WebRpcErrorCode.invalidConfig)
    const rangeError = tagWebRpcError(new RangeError('bad range'), WebRpcErrorCode.invalidConfig)
    expect(typeError).toBeInstanceOf(TypeError)
    expect(rangeError).toBeInstanceOf(RangeError)
    expect(typeError.source).toBe(WEBRPC_SOURCE)
    expect(typeError.code).toBe('INVALID_CONFIG')
    expect(rangeError.code).toBe('INVALID_CONFIG')
    expect(typeError.message).toBe('bad option')
  })
})

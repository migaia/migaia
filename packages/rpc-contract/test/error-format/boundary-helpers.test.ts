import { describe, expect, it } from 'vitest'
import {
  isRpcError,
  RPC_CORE_ERROR_SOURCE,
  RpcAbortError,
  RpcChunkError,
  RpcConfigurationError,
  RpcConstructionError,
  RpcContractError,
  RpcError,
  RpcLifecycleError,
  RpcProtocolError,
  RpcRemoteError,
  RpcSerializationError,
  RpcTimeoutError
} from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'

describe('error boundary helpers', () => {
  it('reports a hostile code getter as PROPERTY_READ_FAILED with the original cause', () => {
    /** The exact getter failure must remain reachable through the coded classification boundary. */
    const failure = new Error('hostile getter')
    /** No diagnostic field may be read without preserving a hostile native getter failure. */
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

  it('uses standard AbortError/TimeoutError names for cross-realm type checks', () => {
    expect(new RpcAbortError().name).toBe('AbortError')
    expect(new RpcTimeoutError().name).toBe('TimeoutError')
    expect(new RpcAbortError().code).toBe('CANCELLED')
    expect(new RpcTimeoutError().code).toBe('DEADLINE_EXCEEDED')
  })

  it('keeps unique registered codes and a constant source', () => {
    /** Count the public code contract independently from the generated registry. */
    const codes = Object.values(RpcCoreErrorCode)
    /** BC1 removes mutual exclusion; namespace and feature conflicts add two distinct identities. */
    expect(codes).toHaveLength(40)
    expect(new Set(codes).size).toBe(codes.length)
    /** Public native families share one stable source without merging their semantic codes. */
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

  it('tagRpcError keeps the native runtime type while attaching (source, code)', () => {
    /** Tagging retains the original native family rather than creating an RPC wrapper. */
    const typeError = tagRpcError(new TypeError('bad option'), RpcCoreErrorCode.invalidConfig)
    /** A second native family proves attachment does not depend on TypeError-specific behavior. */
    const rangeError = tagRpcError(new RangeError('bad range'), RpcCoreErrorCode.invalidConfig)
    expect(typeError).toBeInstanceOf(TypeError)
    expect(rangeError).toBeInstanceOf(RangeError)
    expect(typeError.source).toBe(RPC_CORE_ERROR_SOURCE)
    expect(typeError.code).toBe('INVALID_CONFIG')
    expect(rangeError.code).toBe('INVALID_CONFIG')
    expect(typeError.message).toBe('bad option')
  })
})

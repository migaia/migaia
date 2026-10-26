import { describe, expect, it } from 'vitest'
import {
  identifyRpcBoundaryFailure,
  isRpcError,
  reachRpcError,
  RPC_CORE_ERROR_SOURCE,
  RpcAbortError,
  RpcChunkError,
  RpcConfigurationError,
  RpcConstructionError,
  RpcContractError,
  RpcCoreErrorText,
  RpcError,
  RpcLifecycleError,
  RpcProtocolError,
  RpcRemoteError,
  RpcSerializationError,
  RpcTimeoutError,
  serializeRpcError
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
    /** Namespace/feature conflicts and the closing keepalive quota each retain a distinct identity. */
    expect(codes).toHaveLength(34)
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

it('preserves complete coded plain errors without extending native getter reads or fallback policy', () => {
  /** The plain failure retains an actual cause graph and the original maximum-sized stack. */
  const cause = new Error('original cause')
  /** Complete error-like presentation is independent of native Error branding. */
  const original = {
    source: 'fixture.provider',
    code: 'BUSINESS_FAILURE',
    name: 'PlainFailure',
    message: 'large trace',
    stack: 's'.repeat(65_536),
    cause
  }
  /** Classification must not replace the original or register a separate presentation. */
  const classified = identifyRpcBoundaryFailure(
    original,
    RpcCoreErrorCode.internal,
    RpcCoreErrorText.providerFailed
  )
  /** Required inspection reporting remains empty for ordinary readable diagnostic fields. */
  const reported: unknown[] = []
  /** Existing graph traversal must still return the exact original references. */
  const reachable = [...reachRpcError(classified, { report: (failure) => reported.push(failure) })]
  expect(classified).toBe(original)
  expect(reachable[0]).toBe(original)
  expect(reachable[1]).toBe(cause)
  /** The ordinary serializer retains the original top-level presentation and nested stack. */
  const wire = serializeRpcError(classified, { report: (failure) => reported.push(failure) })
  expect(wire).toMatchObject({
    source: original.source,
    code: original.code,
    name: original.name,
    message: original.message,
    stack: original.stack,
    cause: { stack: cause.stack }
  })
  expect(reported).toEqual([])

  /** A throwing presentation getter remains contained by the existing Utils conversion policy. */
  const getterFailure = new Error('hostile presentation')
  /** The native branch must not begin reading name, message or stack while checking identity. */
  const nativeReads: PropertyKey[] = []
  /** This genuine native target exercises the same original source-then-code getter boundary. */
  const native = new Proxy(
    Object.assign(new Error('native failure'), { source: original.source, code: original.code }),
    {
      get(target, key, receiver) {
        nativeReads.push(key)
        if (key === 'name' || key === 'message' || key === 'stack') throw getterFailure
        return Reflect.get(target, key, receiver)
      }
    }
  )
  expect(
    identifyRpcBoundaryFailure(native, RpcCoreErrorCode.internal, RpcCoreErrorText.providerFailed)
  ).toBe(native)
  expect(nativeReads).toEqual(['source', 'code'])

  /** Missing presentation fields cannot make an otherwise coded record into an error-like. */
  const incomplete = { source: original.source, code: original.code, message: original.message }
  /** The original fallback remains a native RPC diagnostic with the record as its exact cause. */
  const incompleteFailure = identifyRpcBoundaryFailure(
    incomplete,
    RpcCoreErrorCode.internal,
    RpcCoreErrorText.providerFailed
  )
  expect(incompleteFailure).toBeInstanceOf(RpcError)
  expect(incompleteFailure.cause).toBe(incomplete)
  /** Complete presentation without semantic identity remains an unclassified thrown value. */
  const uncoded = { name: original.name, message: original.message, stack: original.stack }
  expect(
    identifyRpcBoundaryFailure(uncoded, RpcCoreErrorCode.internal, RpcCoreErrorText.providerFailed)
      .cause
  ).toBe(uncoded)
  /** Identity alone cannot cause a hostile presentation getter to escape classification. */
  const hostile = {
    source: original.source,
    code: original.code,
    get name(): never {
      throw getterFailure
    },
    message: original.message,
    stack: original.stack
  }
  /** The same original object remains reachable without substituting the getter failure. */
  const hostileFailure = identifyRpcBoundaryFailure(
    hostile,
    RpcCoreErrorCode.internal,
    RpcCoreErrorText.providerFailed
  )
  expect(hostileFailure).toBeInstanceOf(RpcError)
  expect(hostileFailure.cause).toBe(hostile)
})

/** Public error identity, canonical text, native type and original-cause regression cases. */
import { describe, expect, it } from 'vitest'
import { createContractError } from '@migaia/rpc-contract/errors'
import { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import { normalizePortable } from '@migaia/rpc-contract/portable'
import { normalizeMethodSchema } from '@migaia/rpc-contract/protocol'
import { RpcWireErrorFallback, serializeRpcError } from '@migaia/rpc-contract/errors'
import type { IRpcErrorWireSummary } from '@migaia/rpc-contract/errors'

describe('rpc-contract error identity', () => {
  it('uses only explicit exact-reference metadata while preserving factory causes and read order', () => {
    /** These maps belong to this protocol caller, never the contract module. */
    const summaries = new WeakMap<Error, IRpcErrorWireSummary>()
    /** The same caller owns route diagnostics for its original Error references. */
    const routes = new WeakMap<Error, readonly string[]>()
    /** Getter ordering remains observable without consulting public source/code as provenance. */
    const reads: string[] = []
    /** Explicit map ports preserve the original before-fields summary and after-fields route reads. */
    const metadata = {
      summaries: {
        get: (error: Error) => {
          reads.push('summary')
          return summaries.get(error)
        },
        set: (error: Error, summary: IRpcErrorWireSummary) => summaries.set(error, summary)
      },
      routes: {
        get: (error: Error) => {
          reads.push('route')
          return routes.get(error)
        },
        set: (error: Error, route: readonly string[]) => routes.set(error, route)
      }
    }
    /** The canonical privacy summary must not replace the exact retained local cause. */
    const cause = new RangeError('private original cause')
    /** Only this operation explicitly grants its caller-owned summary entry. */
    const local = createContractError(RpcContractErrorCode.invalidEnvelope, cause, metadata)
    expect(local.cause).toBe(cause)
    Object.defineProperty(local, 'name', {
      get: () => {
        reads.push('name')
        return 'TypeError'
      }
    })
    expect(serializeRpcError(local, { report: () => {} }, metadata)).not.toHaveProperty('cause')
    expect(reads.indexOf('summary')).toBeLessThan(reads.indexOf('name'))
    expect(reads).not.toContain('route')
    /** Copying the same public identity never enters the exact-reference map. */
    const forged = Object.assign(new TypeError('business error', { cause }), {
      source: 'rpc.contract',
      code: RpcContractErrorCode.invalidEnvelope
    })
    Object.defineProperty(forged, 'name', {
      get: () => {
        reads.push('ordinary-name')
        return 'TypeError'
      }
    })
    expect(serializeRpcError(forged, { report: () => {} }, metadata).cause?.message).toBe(
      cause.message
    )
    expect(reads.indexOf('route')).toBeGreaterThan(reads.indexOf('ordinary-name'))
    /** A pure factory without an explicit map cannot create implicit module-owned provenance. */
    const unclaimed = createContractError(RpcContractErrorCode.invalidEnvelope, cause)
    expect(serializeRpcError(unclaimed, { report: () => {} }, metadata).cause?.message).toBe(
      cause.message
    )
  })

  it('uses the canonical UNKNOWN code for untagged errors and marks cyclic edges truncated', () => {
    const untagged = serializeRpcError(new Error('plain'), { report: () => {} })
    expect(untagged).toMatchObject({ source: 'unknown', code: 'UNKNOWN' })
    const cyclic = new Error('loop') as Error & { cause?: unknown }
    cyclic.cause = cyclic
    const wire = serializeRpcError(cyclic, { report: () => {} })
    expect(wire.cause).toBeUndefined()
    expect(wire.truncated).toBe(true)
  })

  it('never throws while serializing hostile thrown values', () => {
    const hostileToString = {
      toString() {
        throw new Error('toString refused')
      }
    }
    const reports: unknown[] = []
    expect(
      serializeRpcError(hostileToString, {
        report: (failure) => {
          reports.push(failure)
        }
      })
    ).toMatchObject({
      name: 'Error',
      message: RpcWireErrorFallback.nonErrorMessage,
      code: 'UNKNOWN'
    })
    expect(reports).toMatchObject([{ field: 'data' }])
    expect(serializeRpcError(Object.create(null), { report: () => {} }).message).toBe(
      RpcWireErrorFallback.nonErrorMessage
    )
    let reads = 0
    const flaky = {
      get name() {
        reads += 1
        if (reads > 1) throw new Error('second read refused')
        return 'FlakyError'
      },
      message: 'flaky',
      stack: 'FlakyError: flaky'
    }
    const wire = serializeRpcError(flaky, { report: () => {} })
    expect(wire.name).toBe('FlakyError')
    expect(wire.message).toBe('flaky')
    expect(wire.stack).toBe('FlakyError: flaky')
  })

  it('maps every code to its own text, native type and package source', () => {
    /** Each public code independently fixes its native constructor and externally observable text. */
    const expected = {
      CALLBACK_FAILED: [Error, 'rpc contract callback failed'],
      INVALID_DESCRIPTOR: [TypeError, 'rpc descriptor is invalid'],
      INVALID_ENVELOPE: [TypeError, 'rpc envelope is invalid'],
      INVALID_STREAM: [TypeError, 'rpc stream is invalid'],
      INVALID_FRAME: [RangeError, 'rpc frame is invalid'],
      FRAME_LIMIT_EXCEEDED: [RangeError, 'rpc frame limit exceeded'],
      FRAME_ASSEMBLY_EXPIRED: [RangeError, 'rpc frame assembly expired'],
      INVALID_WIRE_ERROR: [TypeError, 'rpc wire error is invalid'],
      HANDSHAKE_INVALID: [TypeError, 'rpc handshake is invalid'],
      HANDSHAKE_INCOMPATIBLE: [Error, 'rpc handshake is incompatible'],
      HANDSHAKE_REJECTED: [Error, 'rpc handshake was rejected'],
      EXTENSION_NEGOTIATION_FAILED: [TypeError, 'rpc extension negotiation failed']
    } as const
    for (const code of Object.values(RpcContractErrorCode)) {
      const error = createContractError(code)
      const [type, text] = expected[code]
      expect(error).toBeInstanceOf(type)
      expect(error.message).toBe(text)
      expect(error).toMatchObject({ source: 'rpc.contract', code })
      expect(Object.hasOwn(error, 'cause')).toBe(false)
    }
  })

  it('attaches the original error as the same non-enumerable cause at every throw site', () => {
    expect(() => normalizeMethodSchema({ type: 'Bad' })).toThrow(
      expect.objectContaining({ code: 'INVALID_DESCRIPTOR' })
    )
    const original = new Error('prototype refused')
    let envelopeError: unknown
    try {
      normalizePortable(
        new Proxy(
          {},
          {
            getPrototypeOf() {
              throw original
            }
          }
        )
      )
    } catch (error) {
      envelopeError = error
    }
    expect(envelopeError).toBeInstanceOf(TypeError)
    expect((envelopeError as Error).cause).toBe(original)
    expect(Object.getOwnPropertyDescriptor(envelopeError, 'cause')?.enumerable).toBe(false)
  })
})

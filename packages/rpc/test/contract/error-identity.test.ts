import { describe, expect, it } from 'vitest'
import { createContractError } from '../../src/contract/contract-error.js'
import { RpcContractErrorCode } from '../../src/contract/error-code.js'
import { createStringFramer } from '../../src/contract/framing/index.js'
import {
  createDescriptor,
  normalizePortable,
  RpcWireErrorFallback,
  serializeRpcError
} from '../../src/contract/index.js'

/** Reads a rejected framer result's error. */
const rejectedError = (result: object): Error => (result as { readonly error: Error }).error

describe('rpc-contract error identity', () => {
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
    const expected = {
      INVALID_DESCRIPTOR: [TypeError, 'rpc descriptor is invalid'],
      INVALID_ENVELOPE: [TypeError, 'rpc envelope is invalid'],
      INVALID_FRAME: [RangeError, 'rpc frame is invalid'],
      FRAME_LIMIT_EXCEEDED: [RangeError, 'rpc frame limit exceeded'],
      FRAME_ASSEMBLY_EXPIRED: [RangeError, 'rpc frame assembly expired'],
      INVALID_WIRE_ERROR: [TypeError, 'rpc wire error is invalid'],
      HANDSHAKE_INVALID: [TypeError, 'rpc handshake is invalid'],
      HANDSHAKE_INCOMPATIBLE: [Error, 'rpc handshake is incompatible'],
      HANDSHAKE_REJECTED: [Error, 'rpc handshake was rejected']
    } as const
    for (const code of Object.values(RpcContractErrorCode)) {
      const error = createContractError(code)
      const [type, text] = expected[code]
      expect(error).toBeInstanceOf(type)
      expect(error.message).toBe(text)
      expect(error).toMatchObject({ source: '@migaia/rpc/contract', code })
      expect(Object.hasOwn(error, 'cause')).toBe(false)
    }
  })

  it('attaches the original error as the same non-enumerable cause at every throw site', () => {
    expect(() => createDescriptor('Bad' as 'bad', 1)).toThrow(
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

    const framer = createStringFramer()
    const frame = new Proxy(
      {},
      {
        get() {
          throw original
        }
      }
    )
    const frameError = rejectedError(framer.accept(frame, { source: 'x', messageId: 'm' }))
    expect(frameError).toBeInstanceOf(RangeError)
    expect(frameError).toMatchObject({ code: 'INVALID_FRAME' })
    expect(frameError.cause).toBe(original)
    expect(Object.getOwnPropertyDescriptor(frameError, 'cause')?.enumerable).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { serializeRpcError } from '@migaia/rpc-contract/errors'
import {
  decodeRpcDevtoolsRecord,
  encodeRpcDevtoolsRecord
} from '../../src/contract/record-codec.js'
import { RpcDevtoolsErrorCode, ERROR_SOURCE as RPC_DEVTOOLS_SOURCE } from '../../src/error-code.js'
import {
  RpcDevtoolsRecordFormat,
  type IRpcDevtoolsRecord,
  type IRpcDevtoolsRecordEvent
} from '../../src/contract/record.js'

/** Uses native coded errors so stack/cause preservation is checked independently of the codec. */
function codedError(error: Error, code: string): Error {
  Object.defineProperties(error, {
    source: { value: '@fixture/service', enumerable: true },
    code: { value: code, enumerable: true }
  })
  return error
}

/** Hand-written event metadata proves format conversion rather than collector behavior. */
function event(error?: Error): IRpcDevtoolsRecordEvent {
  return {
    seq: 1,
    at: 42,
    endpointId: 'endpoint-A',
    stage: 'message',
    direction: 'inbound',
    method: '查询订单',
    error,
    content: { bytes: new Uint8Array([9, 0, 127, 255, 8]).subarray(1, 4), empty: new Uint8Array() }
  }
}

describe('record codec', () => {
  it.each([false, true])('preserves Node byte payloads before toJSON (nested=%s)', (nested) => {
    /** Node carrier chunks are byte views whose JSON conversion must not replace their bytes. */
    const bytes = Buffer.from([0, 127, 255])
    /** Raw carrier content and bytes inside logical content share the same record boundary. */
    const record: IRpcDevtoolsRecord = {
      header: RpcDevtoolsRecordFormat,
      events: [{ ...event(), content: nested ? { bytes } : bytes }]
    }
    /** The NDJSON must use the record tag rather than Buffer's type/data JSON object. */
    const text = encodeRpcDevtoolsRecord(record)
    expect(text).toContain('"$bytes":"AH//"')
    expect(decodeRpcDevtoolsRecord(text).events[0].content).toEqual(
      nested ? { bytes: new Uint8Array([0, 127, 255]) } : new Uint8Array([0, 127, 255])
    )
  })

  it('round-trips native cause and aggregate graphs, byte ranges and Chinese methods', () => {
    /** The leaf remains reachable through cause and AggregateError.errors after import. */
    const cause = codedError(new TypeError('original cause'), 'ORIGINAL')
    /** Both graph edges carry the same original stack without relying on regenerated stack text. */
    const error = codedError(new AggregateError([cause], 'outer failure', { cause }), 'OUTER')
    /** The input uses v1 header and one metadata event; no runtime collector is installed. */
    const record: IRpcDevtoolsRecord = { header: RpcDevtoolsRecordFormat, events: [event(error)] }
    /** Inspect bytes on the actual encoded text as well as the restored native value. */
    const text = encodeRpcDevtoolsRecord(record)
    expect(text).toContain('"$bytes":"AH//"')
    expect(text).toContain('查询订单')
    /** Imported errors are native AggregateError values while service wire inputs remain supported. */
    const decoded = decodeRpcDevtoolsRecord(text)
    expect(decoded.header).toEqual(record.header)
    expect(decoded.events[0]).toEqual(record.events[0])
    /** Cast narrows the union after an explicit native-class assertion. */
    const restored = decoded.events[0].error as AggregateError & { source: string; code: string }
    expect(restored).toBeInstanceOf(AggregateError)
    expect(restored.source).toBe('@fixture/service')
    expect(restored.code).toBe('OUTER')
    expect(restored.message).toBe(error.message)
    expect(restored.stack).toBe(error.stack)
    expect(restored.cause).toMatchObject({
      source: '@fixture/service',
      code: 'ORIGINAL',
      stack: cause.stack
    })
    expect(restored.errors[0]).toMatchObject({ code: 'ORIGINAL', stack: cause.stack })
    expect(error.cause).toBe(cause)
  })

  it('accepts the service wire error shape and restores it without changing stack', () => {
    /** A service event can enter a record without reconstructing a native error first. */
    const error = codedError(new RangeError('wire input'), 'WIRE')
    /** The reporter throws to keep serialization loss observable in this pure fixture. */
    const wire = serializeRpcError(error, {
      report: (failure) => {
        throw failure.error
      }
    })
    /** Wire events remain assignable to offline record event inputs. */
    const record: IRpcDevtoolsRecord = {
      header: RpcDevtoolsRecordFormat,
      events: [{ ...event(), error: wire }]
    }
    /** Restoration uses Contract's canonical error owner. */
    const decoded = decodeRpcDevtoolsRecord(encodeRpcDevtoolsRecord(record))
    expect(decoded.events[0].error).toBeInstanceOf(RangeError)
    expect(decoded.events[0].error).toMatchObject({
      source: '@fixture/service',
      code: 'WIRE',
      stack: error.stack
    })
  })

  it.each([
    ['wrong version', '{"format":"migaia-rpc-devtools","version":2}\n', TypeError],
    ['missing version', '{"format":"migaia-rpc-devtools"}\n', TypeError],
    ['missing format', '{"version":1}\n', TypeError],
    ['truncated JSON', '{"format":"migaia-rpc-devtools","version":1}\n{"seq":', SyntaxError]
  ])('rejects %s with the original cause', (_name, text, Cause) => {
    try {
      decodeRpcDevtoolsRecord(text)
      expect.unreachable('invalid record must throw')
    } catch (error) {
      expect(error).toMatchObject({
        source: RPC_DEVTOOLS_SOURCE,
        code: RpcDevtoolsErrorCode.recordFormatInvalid
      })
      expect((error as Error).cause).toBeInstanceOf(Cause)
    }
  })

  it('rejects a malformed byte tag instead of losing captured bytes', () => {
    /** The malformed final unused bits are legal characters but not canonical Base64. */
    const text = `${JSON.stringify(RpcDevtoolsRecordFormat)}\n${JSON.stringify({ ...event(), content: { $bytes: 'AB==' } })}\n`
    expect(() => decodeRpcDevtoolsRecord(text)).toThrowError(
      expect.objectContaining({
        source: RPC_DEVTOOLS_SOURCE,
        code: RpcDevtoolsErrorCode.recordFormatInvalid,
        cause: expect.any(TypeError)
      })
    )
  })
})

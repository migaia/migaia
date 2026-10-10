import { describe, expect, it } from 'vitest'
import { RPC_STREAM_MAX_FRAME_BYTES } from '@migaia/rpc/contract/framing/stream'
import { createJsonRpcFrameDecoder, encodeJsonRpcFrame } from '../../src/bridge/jsonrpc/framing.js'

describe('[A5] canonical raw physical frame boundaries', () => {
  it('accepts exact 16 MiB Content-Length; rejects +1 before retaining body', () => {
    /** JSON quotes count toward the physical Content-Length budget. */
    const body = 'x'.repeat(RPC_STREAM_MAX_FRAME_BYTES - 2)
    const encoded = encodeJsonRpcFrame(body)
    const decoder = createJsonRpcFrameDecoder()
    expect(decoder.push(encoded)).toEqual([body])
    decoder.finish()
    decoder.close()
    expect(decoder.bufferedBytes).toBe(0)
    const invalid = createJsonRpcFrameDecoder()
    expect(() => invalid.push(Buffer.from('Content-Length: 16777217\r\n\r\n'))).toThrow(
      expect.objectContaining({ code: 'JSONRPC_FRAME_INVALID' })
    )
    invalid.close()
    expect(invalid.bufferedBytes).toBe(0)
    expect(() => encodeJsonRpcFrame('x'.repeat(RPC_STREAM_MAX_FRAME_BYTES - 1))).toThrow(
      expect.objectContaining({ code: 'JSONRPC_FRAME_INVALID' })
    )
  })
  it.each([
    'Content-Len',
    'Content-Length: 4\r\n\r\n{}',
    'Content-Length: 1\r\n\r\n\xff',
    'Content-Length: 1\r\n\r\n['
  ])('rejects bridge half-header/body, UTF-8 and JSON %#', (input) => {
    const decoder = createJsonRpcFrameDecoder()
    expect(() => {
      decoder.push(Buffer.from(input, 'latin1'))
      decoder.finish()
    }).toThrow(expect.objectContaining({ code: 'JSONRPC_FRAME_INVALID' }))
    decoder.close()
    expect(decoder.bufferedBytes).toBe(0)
  })
})

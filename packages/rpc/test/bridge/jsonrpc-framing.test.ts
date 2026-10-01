import { describe, expect, it, vi } from 'vitest'
import { createJsonRpcFrameDecoder, encodeJsonRpcFrame } from '../../src/bridge/jsonrpc/framing.js'
import { peerFrame } from './fixture.js'

describe('JSON-RPC byte framing', () => {
  it('[A11] preserves the same excerpt-free JSON engine failure', () => {
    const originalParse = JSON.parse
    let original: unknown
    const spy = vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
      try {
        return originalParse(text, reviver)
      } catch (error) {
        original = error
        throw error
      }
    })
    let wrapped: unknown
    try {
      createJsonRpcFrameDecoder().push(Buffer.from('Content-Length: 1\r\n\r\n['))
    } catch (error) {
      wrapped = error
    } finally {
      spy.mockRestore()
    }
    expect(original).toBeInstanceOf(SyntaxError)
    expect(wrapped).toMatchObject({ code: 'JSONRPC_FRAME_INVALID' })
    expect((wrapped as Error).cause).toBe(original)
  })
  it('[A1] splits multibyte bodies at every byte and delivers concatenated frames once', () => {
    const first = { jsonrpc: '2.0', id: 'first', result: '你好🙂' }
    const second = { jsonrpc: '2.0', id: 'second', result: null }
    const encoded = encodeJsonRpcFrame(first)
    expect(encoded[0]).toBe(67)
    expect(Buffer.from(encoded).toString()).toBe(Buffer.from(peerFrame(first)).toString())
    const decoder = createJsonRpcFrameDecoder()
    const values: unknown[] = []
    for (const byte of encoded) values.push(...decoder.push(Uint8Array.of(byte)))
    values.push(...decoder.push(peerFrame(second)))
    expect(values).toEqual([first, second])
    expect(decoder.bufferedBytes).toBe(0)
    decoder.finish()
  })
  it.each([
    'content-length:  12\t',
    'X-Trace: one\r\ncontent-length: 12',
    'Content-Type: application/vscode-jsonrpc; charset=utf8\r\nContent-Length: 12',
    'Content-Type: application/json; charset=UTF-8\r\nContent-Length: 12'
  ])('[A1] accepts compatible header %s', (header) => {
    expect(createJsonRpcFrameDecoder().push(Buffer.from(`${header}\r\n\r\n{"value":12}`))).toEqual([
      { value: 12 }
    ])
  })
  it.each([
    'Content-Length: 0',
    'Content-Length: 01',
    'Content-Length: +12',
    'Content-Length: 12\r\nContent-Length: 12',
    'Content-Length: 16777217',
    'Content-Length: 12\n',
    'Content-Type: text/plain; charset=latin1\r\nContent-Length: 12',
    `X-Trace: ${'x'.repeat(1024)}\r\nContent-Length: 12`
  ])('[A1] rejects invalid header %s', (header) => {
    expect(() =>
      createJsonRpcFrameDecoder().push(Buffer.from(`${header}\r\n\r\n{"value":12}`))
    ).toThrow(expect.objectContaining({ code: 'JSONRPC_FRAME_INVALID' }))
  })
  it.each([Uint8Array.of(0xff), Buffer.from('\ufeff{}'), Buffer.from('not-json')])(
    '[A1] rejects invalid body encoding/JSON',
    (body) => {
      const bytes = Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])
      expect(() => createJsonRpcFrameDecoder().push(bytes)).toThrow(
        expect.objectContaining({ code: 'JSONRPC_FRAME_INVALID' })
      )
    }
  )
  it.each(['Content-Len', 'Content-Length: 12\r\n\r\n{"value":'])(
    '[A1] rejects truncated EOF and clears retained bytes on release',
    (text) => {
      const decoder = createJsonRpcFrameDecoder()
      decoder.push(Buffer.from(text))
      expect(decoder.bufferedBytes).toBeGreaterThan(0)
      expect(() => decoder.finish()).toThrow(
        expect.objectContaining({ code: 'JSONRPC_FRAME_INVALID' })
      )
      decoder.close()
      expect(decoder.bufferedBytes).toBe(0)
    }
  )
})

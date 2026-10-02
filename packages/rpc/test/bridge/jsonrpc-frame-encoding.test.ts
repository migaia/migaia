import { afterEach, describe, expect, it, vi } from 'vitest'
import { JsonRpcLimit } from '../../src/bridge/jsonrpc/constants.js'
import { encodeJsonRpcFrame } from '../../src/bridge/jsonrpc/framing.js'
import { peerFrame } from './fixture.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('JSON-RPC single-allocation encoding', () => {
  it('[C3] retains the frozen UTF-8 wire vector', () => {
    expect(Buffer.from(encodeJsonRpcFrame('é'))).toEqual(
      Buffer.from('Content-Length: 4\r\n\r\n"é"', 'utf8')
    )
  })

  it('[C3] preserves every byte for JSON and Unicode boundary values', () => {
    /** The independent peer encoder uses native Buffer UTF-8, not product byte counting. */
    const values: unknown[] = [
      null,
      true,
      false,
      0,
      -0,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      { text: '\u0000\u007f\u0080\u07ff\u0800\uffff你好🙂\ud800\udfff', empty: [] },
      JSON.parse('{"__proto__":{"wire":"data"},"result":null}'),
      { nested: { value: [{ value: [{ value: null }] }] } },
      '\\"\r\n\t'.repeat(1000)
    ]
    for (const value of values)
      expect(Buffer.from(encodeJsonRpcFrame(value))).toEqual(Buffer.from(peerFrame(value)))
  })

  it('[C3] preserves bytes across 1000 deterministic arbitrary UTF-16 payloads', () => {
    /** A fixed seed makes surrogate pairs, isolated surrogates and multibyte text reproducible. */
    let seed = 0x4c335754
    for (let index = 0; index < 1000; index++) {
      /** Each generated body mixes ASCII metadata with arbitrary JS code units. */
      let text = ''
      for (let offset = 0; offset < 128; offset++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        text += String.fromCharCode(seed >>> 16)
      }
      /** Ordinary JSON serialization owns property order and lone-surrogate escaping. */
      const value = { jsonrpc: '2.0', id: String(index), result: text }
      expect(Buffer.from(encodeJsonRpcFrame(value))).toEqual(Buffer.from(peerFrame(value)))
    }
  })

  it.each([undefined, Symbol('unencoded'), () => undefined])(
    '[C3] retains FRAME_INVALID for JSON results without a body (%s)',
    (value) => {
      expect(() => encodeJsonRpcFrame(value)).toThrow(
        expect.objectContaining({ code: 'JSONRPC_FRAME_INVALID' })
      )
    }
  )

  it('[C3] rejects an oversized UTF-8 body before encoding or byte allocation', () => {
    /** JSON quotes make this astral text exceed the exact byte ceiling by two bytes. */
    const value = '🙂'.repeat(JsonRpcLimit.bodyBytes / 4)
    /** No output allocation is allowed to precede the real production size decision. */
    const allocations: unknown[] = []
    /** Preserve native TypedArray semantics while observing product-owned construction. */
    const NativeUint8Array = Uint8Array
    vi.stubGlobal(
      'Uint8Array',
      new Proxy(NativeUint8Array, {
        construct(target, argumentsList) {
          allocations.push(argumentsList[0])
          return Reflect.construct(target, argumentsList)
        }
      })
    )
    /** Native encode allocates internally; observing it catches that allocation path too. */
    const encode = vi.spyOn(TextEncoder.prototype, 'encode')
    /** Direct encoding must also begin only after the size guard accepts the body. */
    const encodeInto = vi.spyOn(TextEncoder.prototype, 'encodeInto')
    expect(() => encodeJsonRpcFrame(value)).toThrow(
      expect.objectContaining({ code: 'JSONRPC_FRAME_INVALID' })
    )
    expect(allocations).toEqual([])
    expect(encode).not.toHaveBeenCalled()
    expect(encodeInto).not.toHaveBeenCalled()
  })

  it('[C3] accepts the exact byte ceiling without allocating a temporary encoded body', () => {
    /** Two JSON quote bytes complete the body budget without relying on string length. */
    const value = 'x'.repeat(JsonRpcLimit.bodyBytes - 2)
    /** The frozen header decimal and all body bytes are independently encoded by Buffer. */
    const expected = Buffer.from(peerFrame(value))
    /** A temporary body from encode would reintroduce the copy this candidate removes. */
    const encode = vi.spyOn(TextEncoder.prototype, 'encode')
    /** Observe the eliminated public byte-copy operation before invoking the product. */
    const copy = vi.spyOn(Uint8Array.prototype, 'set')
    /** Comparing after the copy assertion keeps fixture Buffer copying outside the observation. */
    const frame = encodeJsonRpcFrame(value)
    expect(copy).not.toHaveBeenCalled()
    expect(Buffer.from(frame).equals(expected)).toBe(true)
    expect(encode).not.toHaveBeenCalled()
  })

  it('[C3] serializes a user value exactly once before output allocation', () => {
    /** JSON user callbacks must not run again during byte counting or encoding. */
    const toJSON = vi.fn(() => ({ result: '你好🙂' }))
    /** This observable JSON hook establishes the existing serialization call count. */
    const value = { toJSON }
    expect(Buffer.from(encodeJsonRpcFrame(value))).toEqual(
      Buffer.from(peerFrame({ result: '你好🙂' }))
    )
    expect(toJSON).toHaveBeenCalledOnce()
  })
})

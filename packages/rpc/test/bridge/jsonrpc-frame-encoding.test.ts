import { afterEach, describe, expect, it, vi } from 'vitest'
import { JsonRpcLimit } from '../../src/bridge/jsonrpc/constants.js'
import { encodeJsonRpcFrame } from '../../src/bridge/jsonrpc/framing.js'
import { peerFrame } from './fixture.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('JSON-RPC bounded native encoding', () => {
  it('[C3] uses native body encoding once for ordinary payloads', () => {
    /** Ordinary bodies must avoid the generator scan that caused the A10 regression. */
    const encode = vi.spyOn(TextEncoder.prototype, 'encode')
    /** Header encoding remains separate from the single body encoding operation. */
    const encodeInto = vi.spyOn(TextEncoder.prototype, 'encodeInto')
    encodeJsonRpcFrame({ result: '🙂'.repeat(256) })
    expect(encode).toHaveBeenCalledOnce()
    expect(encodeInto).toHaveBeenCalledOnce()
  })
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

  it('[C3] accepts the exact byte ceiling using one native body encoding and one copy', () => {
    /** Two JSON quote bytes complete the body budget without relying on string length. */
    const value = 'x'.repeat(JsonRpcLimit.bodyBytes - 2)
    /** The frozen header decimal and all body bytes are independently encoded by Buffer. */
    const expected = Buffer.from(peerFrame(value))
    /** Native body encoding replaces the expensive JavaScript generator scan. */
    const encode = vi.spyOn(TextEncoder.prototype, 'encode')
    /** Exactly one copy places the accepted native body after its header. */
    const copy = vi.spyOn(Uint8Array.prototype, 'set')
    /** Comparing after the copy assertion keeps fixture Buffer copying outside the observation. */
    const frame = encodeJsonRpcFrame(value)
    expect(copy).toHaveBeenCalledOnce()
    expect(Buffer.from(frame).equals(expected)).toBe(true)
    expect(encode).toHaveBeenCalledOnce()
  })

  it.each([0, 1])('[C3] preserves bytes at the safe UTF-16 segment boundary +%i', (extra) => {
    /** Three UTF-8 bytes per UTF-16 code unit establish the native-only segment ceiling. */
    const jsonLength = Math.floor(JsonRpcLimit.bodyBytes / 3) + extra
    /** JSON quotes occupy two code units and two bytes of the prescribed length. */
    const value = '界'.repeat(jsonLength - 2)
    /** The peer oracle is constructed before observing product encoding calls. */
    const expected = Buffer.from(peerFrame(value))
    /** Both accepted segments still encode the body exactly once. */
    const encode = vi.spyOn(TextEncoder.prototype, 'encode')
    expect(Buffer.from(encodeJsonRpcFrame(value)).equals(expected)).toBe(true)
    expect(encode).toHaveBeenCalledOnce()
  })

  it.each([0, 1])('[C3] checks the exact UTF-8 ceiling +%i before encoding', (extra) => {
    /** BMP text exercises exact counting in the narrow interval rather than ASCII pre-rejection. */
    const bodyBudget = JsonRpcLimit.bodyBytes - 2
    /** The remainder ensures the serialized body has precisely the requested byte length. */
    const value = '界'.repeat(Math.floor(bodyBudget / 3)) + 'x'.repeat((bodyBudget % 3) + extra)
    /** The independent encoder remains outside the observed product operation. */
    const expected = extra === 0 ? Buffer.from(peerFrame(value)) : undefined
    /** A one-byte overflow must not allocate an encoded body. */
    const encode = vi.spyOn(TextEncoder.prototype, 'encode')
    if (expected) {
      expect(Buffer.from(encodeJsonRpcFrame(value)).equals(expected)).toBe(true)
      expect(encode).toHaveBeenCalledOnce()
    } else {
      expect(() => encodeJsonRpcFrame(value)).toThrow(
        expect.objectContaining({ code: 'JSONRPC_FRAME_INVALID' })
      )
      expect(encode).not.toHaveBeenCalled()
    }
  })

  it('[C3] rejects a UTF-16 body length above the ceiling before native encoding', () => {
    /** Including JSON quotes yields exactly the length ceiling plus one code unit and byte. */
    const value = 'x'.repeat(JsonRpcLimit.bodyBytes - 1)
    /** The length-only segment must reject before native encoding allocates its output. */
    const encode = vi.spyOn(TextEncoder.prototype, 'encode')
    expect(() => encodeJsonRpcFrame(value)).toThrow(
      expect.objectContaining({ code: 'JSONRPC_FRAME_INVALID' })
    )
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

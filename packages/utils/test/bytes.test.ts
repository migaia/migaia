import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  base64ToBytes,
  bytesToBase64,
  decodeUtf8,
  encodeUtf8,
  isArrayBuffer,
  isUint8Array,
  splitUtf8,
  streamBase64Chunks,
  utf8ByteLength
} from '../src/bytes.js'

/** Frozen UTF-8 boundaries and seeded UTF-16 strings exercise replacement and pair handling. */
function utf8EquivalenceInputs(): string[] {
  /** Explicit boundaries include every UTF-8 width and both kinds of lone surrogate. */
  const values = [
    '',
    '\0',
    '\x7f',
    '\u0080',
    '\u07ff',
    '\u0800',
    '\uffff',
    '\ud800',
    '\udbff',
    '\udc00',
    '\udfff',
    '\ud800\udc00',
    '\udbff\udfff',
    '\ud800x\udfff',
    '\ud800\ud800\udc00',
    '界é🙂\ud800\udfff',
    '\ufeff界',
    'a\ufeff界'
  ]
  /** Boundary count stays fixed while generated inputs are appended to the same array. */
  const boundaryCount = values.length
  /** Stable PRNG state keeps the random Unicode evidence reproducible. */
  let state = 0x21c3
  /** Returns the next unsigned fixture value without consulting ambient randomness. */
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
  for (let sample = 0; sample < 10000; sample++) {
    /** Random string includes arbitrary UTF-16 units and regularly injected width boundaries. */
    let value = ''
    /** Bounded length keeps this a deterministic equivalence test rather than a benchmark. */
    const length = next() % 65
    for (let index = 0; index < length; index++) value += String.fromCharCode(next() & 0xffff)
    value += values[sample % boundaryCount]
    values.push(value)
  }
  return values
}

/** Independent native encoding oracle captured before testing the encoder-free fallback. */
const nativeEncoder = new TextEncoder()

/** Native decoder normalizes lone surrogates independently of the production implementation. */
const nativeDecoder = new TextDecoder('utf-8', { ignoreBOM: true })

/** Shared deterministic strings cover BMP, surrogate pairs, and lone surrogate boundaries. */
const utf8Inputs = utf8EquivalenceInputs()

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('byte primitives', () => {
  it('round trips canonical base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
    expect([...streamBase64Chunks(bytes, 3)].join('')).toBe(bytesToBase64(bytes))
  })

  it('decodes into the supplied final backing without a temporary output allocation', () => {
    /** The extended decoder must retain the caller-owned destination view's real offset. */
    const backing = new Uint8Array(5)
    const target = backing.subarray(3)
    /** Older code accepts a second JavaScript argument but ignores it; this assertion proves RED. */
    const decode: (value: string, target: Uint8Array) => Uint8Array = base64ToBytes
    expect(decode('AQI=', target)).toBe(target)
    expect([...backing]).toEqual([0, 0, 0, 1, 2])
  })

  it('rejects a destination with the wrong decoded length before writing', () => {
    const target = new Uint8Array([9])
    expect(() => base64ToBytes('AQI=', target)).toThrow(
      expect.objectContaining({
        source: '@migaia/utils',
        code: 'INVALID_ARGUMENT'
      })
    )
    expect([...target]).toEqual([9])
  })

  it('rejects noncanonical input', () => {
    expect(() => base64ToBytes(' AA==')).toThrow()
  })

  it('keeps UTF-8 behavior host-independent and never splits a code point', () => {
    const value = 'a😀b\ud800'
    expect(decodeUtf8(encodeUtf8(value))).toBe('a😀b�')
    expect(splitUtf8(value, 4)).toEqual(['a', '😀', 'b�'])
    expect(() => decodeUtf8(new Uint8Array([0xc0]), { fatal: true })).toThrow()
  })

  it('I21 matches native UTF-8 lengths for 10000 random strings and scalar boundaries', () => {
    for (const value of utf8Inputs)
      expect(utf8ByteLength(value)).toBe(nativeEncoder.encode(value).length)
  })

  it('I21 counts replacement bytes without invoking an encoder or allocating a byte buffer', () => {
    /** Tracks native encoding independently of the allocation-free count. */
    const encode = vi.spyOn(TextEncoder.prototype, 'encode')
    /** Tracks explicitly allocated buffers without changing Uint8Array behavior. */
    const allocatedSizes: number[] = []
    /** Original constructor remains the receiver of the proxy's construction operation. */
    const OriginalUint8Array = Uint8Array
    vi.stubGlobal(
      'Uint8Array',
      new Proxy(OriginalUint8Array, {
        /** Observe explicit buffer allocation while preserving the constructor's native result. */
        construct(target, argumentsList, newTarget) {
          allocatedSizes.push(Number(argumentsList[0]))
          return Reflect.construct(target, argumentsList, newTarget)
        }
      })
    )
    expect(utf8ByteLength('a\u0080界🙂\udfff\ud800')).toBe(16)
    expect(encode).not.toHaveBeenCalled()
    expect(allocatedSizes).toEqual([])
  })

  it('I21 prefers the native UTF-8 encoder when available', () => {
    /** Native method spy distinguishes the fast path from the previous generator encoder. */
    const encode = vi.spyOn(TextEncoder.prototype, 'encode')
    expect(Array.from(encodeUtf8('é🙂\ud800'))).toEqual([
      195, 169, 240, 159, 153, 130, 239, 191, 189
    ])
    expect(encode).toHaveBeenCalledExactlyOnceWith('é🙂\ud800')
  })

  it('I21 native and encoder-free fallback preserve every random string byte', () => {
    for (const value of utf8Inputs) expect(encodeUtf8(value)).toEqual(nativeEncoder.encode(value))
    vi.stubGlobal('TextEncoder', undefined)
    for (const value of utf8Inputs) {
      expect(encodeUtf8(value)).toEqual(nativeEncoder.encode(value))
      expect(utf8ByteLength(value)).toBe(nativeEncoder.encode(value).length)
    }
  })

  it('I21 loop chunking preserves scalar boundaries and byte budgets without TextEncoder', () => {
    vi.stubGlobal('TextEncoder', undefined)
    for (let index = 0; index < utf8Inputs.length; index++) {
      /** Fixture input and budget exercise every accepted width from 4 through 32 bytes. */
      const value = utf8Inputs[index]
      /** Small varying budgets force both pair and replacement boundaries between chunks. */
      const budget = 4 + (index % 29)
      /** Native normalization supplies the independent scalar-value oracle. */
      const normalized = nativeDecoder.decode(nativeEncoder.encode(value))
      /** Expected chunks come from native-normalized scalar iteration, not production helpers. */
      const expected: string[] = []
      /** Next oracle chunk accumulates only complete normalized scalar values. */
      let chunk = ''
      for (const scalar of normalized) {
        if (nativeEncoder.encode(chunk + scalar).length > budget) {
          expected.push(chunk)
          chunk = ''
        }
        chunk += scalar
      }
      if (chunk || normalized.length === 0) expected.push(chunk)
      expect(splitUtf8(value, budget)).toEqual(expected)
    }
  })

  it('SWV2-T55 uses intrinsic slots for cross-realm and hostile byte brands', () => {
    const foreignBytes = runInNewContext('new Uint8Array([1, 2])') as Uint8Array
    const foreignBuffer = runInNewContext('new ArrayBuffer(2)') as ArrayBuffer
    class ByteSubclass extends Uint8Array {}
    const forgedInt8 = new Int8Array(1)
    Object.setPrototypeOf(forgedInt8, { constructor: { name: 'Uint8Array' } })
    const hostileTag = Object.create(null)
    let hostileTagReads = 0
    Object.defineProperty(hostileTag, Symbol.toStringTag, {
      get: () => {
        hostileTagReads += 1
        throw new Error('tag getter must not run')
      }
    })
    let proxyReads = 0
    const proxyBytes = new Proxy(new Uint8Array(1), {
      get: () => {
        proxyReads += 1
        throw new Error('proxy getter must not run')
      }
    })

    expect(isUint8Array(new Uint8Array(1))).toBe(true)
    expect(isUint8Array(foreignBytes)).toBe(true)
    expect(isUint8Array(new ByteSubclass(1))).toBe(true)
    expect(isUint8Array(forgedInt8)).toBe(false)
    expect(isUint8Array(new Int8Array(1))).toBe(false)
    expect(isUint8Array(new Uint8ClampedArray(1))).toBe(false)
    expect(isUint8Array(new DataView(new ArrayBuffer(1)))).toBe(false)
    expect(isUint8Array(hostileTag)).toBe(false)
    expect(isUint8Array(proxyBytes)).toBe(false)
    expect(hostileTagReads).toBe(0)
    expect(proxyReads).toBe(0)
    if (typeof Buffer !== 'undefined') expect(isUint8Array(Buffer.from([1]))).toBe(true)

    expect(isArrayBuffer(new ArrayBuffer(1))).toBe(true)
    expect(isArrayBuffer(foreignBuffer)).toBe(true)
    expect(isArrayBuffer(new SharedArrayBuffer(1))).toBe(false)
    expect(isArrayBuffer(Object.create({ constructor: { name: 'ArrayBuffer' } }))).toBe(false)
    expect(isArrayBuffer(new Proxy(new ArrayBuffer(1), {}))).toBe(false)
  })

  it('SWV2-T55 preserves detached intrinsic brands while callers decide usability', () => {
    const bytes = new Uint8Array(4)
    const buffer = new ArrayBuffer(4)
    structuredClone(bytes, { transfer: [bytes.buffer] })
    structuredClone(buffer, { transfer: [buffer] })

    expect(isUint8Array(bytes)).toBe(true)
    expect(isArrayBuffer(buffer)).toBe(true)
  })

  it('SWV2-T55 remains fail-closed after the ambient Reflect.get is replaced', () => {
    const originalReflectGet = Reflect.get
    let forgedBytesAccepted = true
    let forgedBufferAccepted = true
    try {
      Reflect.get = (() => 'Uint8Array') as typeof Reflect.get
      forgedBytesAccepted = isUint8Array(Object.create(null))
      forgedBufferAccepted = isArrayBuffer(Object.create(null))
    } finally {
      Reflect.get = originalReflectGet
    }

    expect(forgedBytesAccepted).toBe(false)
    expect(forgedBufferAccepted).toBe(false)
  })
})

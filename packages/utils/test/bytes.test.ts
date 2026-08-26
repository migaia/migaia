import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  base64ToBytes,
  bytesToBase64,
  decodeUtf8,
  encodeUtf8,
  isArrayBuffer,
  isUint8Array,
  splitUtf8,
  streamBase64Chunks
} from '../src/bytes.js'

describe('byte primitives', () => {
  it('round trips canonical base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
    expect([...streamBase64Chunks(bytes, 3)].join('')).toBe(bytesToBase64(bytes))
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

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  RPC_STREAM_MAX_FRAME_BYTES,
  createRpcStreamFrameDecoder,
  encodeRpcStreamFrame
} from '../../src/contract/framing/stream-index.js'
import { encodeRpcStreamTextFrame } from '../../src/contract/framing/stream.js'

/** A compressed vector avoids storing a 16 MiB fixture in source control. */
type IVectorBytes = string | Readonly<{ repeatHex: string; count: number; prefixHex?: string }>
/** Each row specifies independent encoder and decoder observations. */
type IStreamVector = Readonly<{
  id: string
  payloadHex?: string
  payload?: IVectorBytes
  encodedPrefixHex?: string
  chunksHex?: readonly string[]
  chunks?: readonly IVectorBytes[]
  framesHex?: readonly string[]
  frames?: readonly IVectorBytes[]
  finish: boolean
  error?: Readonly<{ code: string }>
}>

/** Expand exactly the bytes described by a language-neutral vector item. */
function expandBytes(value: IVectorBytes): Uint8Array {
  if (typeof value === 'string') return Uint8Array.from(Buffer.from(value, 'hex'))
  /** One repeated block is reused while building a single exact expected byte array. */
  const block = Uint8Array.from(Buffer.from(value.repeatHex, 'hex'))
  /** The expanded bytes are compared directly with the encoder or decoder result. */
  const result = new Uint8Array(block.byteLength * value.count)
  for (let offset = 0; offset < result.byteLength; offset += block.byteLength)
    result.set(block, offset)
  return result
}

/** The fixture is read from the public schema directory, not duplicated in tests. */
const vectors = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../schema/vectors/stream-framing.json', import.meta.url)),
    'utf8'
  )
) as readonly IStreamVector[]

describe('rpc native stream framing', () => {
  it('[C6-F1][A21][A35] direct text encoding preserves wire bytes with a drained backing and an inconclusive bound', () => {
    /** The production text encoder supplies the same UTF-8 behavior as the original byte path. */
    const encoder = new TextEncoder()
    /** A nonzero offset proves prefix writes honor the borrowed view's real boundary. */
    const storage = new Uint8Array(new ArrayBuffer(1024), 8, 512)
    for (const text of ['plain', '汉字', '😀', '\ud83d']) {
      /** The original encoder is an independent byte-for-byte wire oracle. */
      const expected = encodeRpcStreamFrame(encoder.encode(text))
      /** Each sequential call lends storage only after the prior consumer has finished reading. */
      const actual = encodeRpcStreamTextFrame(text, encoder, storage)
      expect(actual.buffer).toBe(storage.buffer)
      expect(Buffer.compare(actual, expected)).toBe(0)
    }
    /** ASCII can fit the frame even when the conservative UTF-16 bound is inconclusive. */
    const text = 'a'.repeat(Math.floor(RPC_STREAM_MAX_FRAME_BYTES / 3) + 1)
    expect(
      Buffer.compare(
        encodeRpcStreamTextFrame(text, encoder),
        encodeRpcStreamFrame(encoder.encode(text))
      )
    ).toBe(0)
    expect(() => encodeRpcStreamTextFrame('', encoder)).toThrowError(
      expect.objectContaining({ code: 'INVALID_FRAME' })
    )
  })

  it('[A3] encodes the vector prefixes and delivers fragmented/coalesced frames in order', () => {
    for (const vector of vectors) {
      const input = vector.payloadHex ?? vector.payload
      if (input !== undefined && !vector.error) {
        /** The encoded bytes are compared with a fixed prefix and source payload. */
        const payload = expandBytes(input)
        const encoded = encodeRpcStreamFrame(payload)
        /** Native comparison preserves exact byte equality without a per-byte diff object. */
        const expected = Buffer.concat([Buffer.from(vector.encodedPrefixHex!, 'hex'), payload])
        expect(Buffer.compare(encoded, expected), vector.id).toBe(0)
      }
      /** Decoder observations are independent of the encoder under test. */
      const delivered: Uint8Array[] = []
      const errors: Error[] = []
      const decoder = createRpcStreamFrameDecoder({
        onFrame: (frame) => delivered.push(frame),
        onError: (error) => errors.push(error)
      })
      for (const chunk of vector.chunksHex ?? vector.chunks ?? []) decoder.push(expandBytes(chunk))
      if (vector.finish) decoder.finish()
      const expected = vector.framesHex ?? vector.frames ?? []
      expect(delivered.length, vector.id).toBe(expected.length)
      for (let index = 0; index < expected.length; index += 1)
        expect(
          Buffer.compare(delivered[index]!, expandBytes(expected[index]!)),
          `${vector.id} frame ${index}`
        ).toBe(0)
      expect(
        errors.map((error) => Reflect.get(error, 'code')),
        vector.id
      ).toEqual(vector.error ? [vector.error.code] : [])
    }
  })

  it('[A4] rejects empty and oversized frames before retaining payload bytes', () => {
    expect(() => encodeRpcStreamFrame(new Uint8Array())).toThrowError(
      expect.objectContaining({ code: 'INVALID_FRAME' })
    )
    expect(() => encodeRpcStreamFrame(new Uint8Array(RPC_STREAM_MAX_FRAME_BYTES + 1))).toThrowError(
      expect.objectContaining({ code: 'FRAME_LIMIT_EXCEEDED' })
    )
    /** The header-only invalid input proves rejection before a payload arrives. */
    const errors: Error[] = []
    const decoder = createRpcStreamFrameDecoder({
      onFrame: () => expect.unreachable(),
      onError: (error) => errors.push(error)
    })
    decoder.push(Uint8Array.from([1, 0, 0, 1]))
    expect(errors.map((error) => Reflect.get(error, 'code'))).toEqual(['FRAME_LIMIT_EXCEEDED'])
    expect(() => decoder.push(Uint8Array.of(0))).toThrowError(
      expect.objectContaining({ code: 'INVALID_FRAME' })
    )
  })

  it('[A4/F3] never allocates an oversized payload before rejecting its header', () => {
    const errors: Error[] = []
    const decoder = createRpcStreamFrameDecoder({
      onFrame: () => expect.unreachable(),
      onError: (error) => errors.push(error)
    })
    /** Track product allocations during push, not test fixture construction. */
    const NativeUint8Array = globalThis.Uint8Array
    const allocations: number[] = []
    const tracked = new Proxy(NativeUint8Array, {
      construct(target, args) {
        if (typeof args[0] === 'number') allocations.push(args[0])
        return Reflect.construct(target, args)
      }
    })
    try {
      vi.stubGlobal('Uint8Array', tracked)
      decoder.push(NativeUint8Array.of(1, 0, 0, 1))
    } finally {
      vi.unstubAllGlobals()
    }
    expect(errors.map((error) => Reflect.get(error, 'code'))).toEqual(['FRAME_LIMIT_EXCEEDED'])
    expect(allocations.every((size) => size < RPC_STREAM_MAX_FRAME_BYTES)).toBe(true)
  })

  it('[A3/A4] owns delivered bytes and distinguishes EOF from intentional close', () => {
    /** A reused source chunk must not change a previously delivered frame. */
    const chunk = Uint8Array.from([0, 0, 0, 1, 0x41])
    const delivered: Uint8Array[] = []
    const errors: Error[] = []
    const decoder = createRpcStreamFrameDecoder({
      onFrame: (frame) => delivered.push(frame),
      onError: (error) => errors.push(error)
    })
    decoder.push(chunk)
    chunk[4] = 0x42
    expect(delivered[0]).toEqual(Uint8Array.of(0x41))
    decoder.finish()
    decoder.finish()
    expect(errors).toEqual([])
    expect(() => decoder.push(chunk)).toThrowError(
      expect.objectContaining({ code: 'INVALID_FRAME' })
    )

    /** Active close discards a partial prefix without claiming an EOF error. */
    const interrupted = createRpcStreamFrameDecoder({
      onFrame: () => expect.unreachable(),
      onError: (error) => errors.push(error)
    })
    interrupted.push(Uint8Array.of(0, 0))
    interrupted.close()
    interrupted.close()
    interrupted.finish()
    expect(errors).toEqual([])
    expect(() => interrupted.push(Uint8Array.of(0, 1))).toThrowError(
      expect.objectContaining({ code: 'INVALID_FRAME' })
    )
  })
})

import { expect, it } from 'vitest'
import {
  createRpcStreamFrameDecoder,
  createRpcStreamFrameDecoderWithLimit,
  encodeRpcStreamFrame
} from '../../dist/sdk/wire/physical-stream.js'

it('calls frame and error callbacks without their configuration object as receiver', () => {
  /** A valid payload and a later zero header exercise both public callback boundaries. */
  const receivers: unknown[] = []
  const decoder = createRpcStreamFrameDecoder({
    onFrame: function (this: unknown) {
      receivers.push(this)
    },
    onError: function (this: unknown) {
      receivers.push(this)
    }
  })
  decoder.push(encodeRpcStreamFrame(Uint8Array.of(1)))
  decoder.push(Uint8Array.of(0, 0, 0, 0))
  expect(receivers).toEqual([undefined, undefined])
})

it('stops the current chunk when its first delivery closes the decoder', () => {
  /** Deliveries are recorded independently from frame parsing. */
  const delivered: number[] = []
  /** Intentional close is terminal without reporting a malformed frame. */
  const errors: Error[] = []
  /** The first callback uses the public close operation synchronously. */
  const decoder = createRpcStreamFrameDecoder({
    onFrame: (frame) => {
      delivered.push(frame[0]!)
      decoder.close()
    },
    onError: (error) => {
      errors.push(error)
    }
  })
  /** Two valid frames share exactly one pushed chunk. */
  const first = encodeRpcStreamFrame(new Uint8Array([1]))
  /** The second frame must never cross the terminal delivery boundary. */
  const second = encodeRpcStreamFrame(new Uint8Array([2]))
  /** A coalesced transport chunk reaches the canonical public decoder. */
  const chunk = new Uint8Array(first.length + second.length)
  chunk.set(first)
  chunk.set(second, first.length)
  const consumed = decoder.push(chunk)
  expect(delivered).toEqual([1])
  expect(errors).toEqual([])
  expect(consumed).toBe(first.length)
  expect(chunk.subarray(consumed)).toEqual(second)
})

it('returns this chunk offset after a fragmented bootstrap prefix and rejects its limit at the header', () => {
  /** A bootstrap owner closes on its first frame before handing the same chunk's tail onward. */
  const frames: Uint8Array[] = []
  /** Framing errors retain their existing contract family and code. */
  const errors: Error[] = []
  /** One shared decoder supplies both the bootstrap cap and ordinary framing algorithm. */
  const decoder = createRpcStreamFrameDecoderWithLimit(
    {
      onFrame(frame) {
        frames.push(frame)
        decoder.close()
      },
      onError: (error) => errors.push(error)
    },
    () => 64 * 1024
  )
  expect(decoder.push(Uint8Array.of(0, 0))).toBe(2)
  /** Prefix completion, one payload byte and the next native frame share the original chunk. */
  const chunk = Uint8Array.of(0, 1, 7, 0, 0, 0, 1, 8)
  expect(decoder.push(chunk)).toBe(3)
  expect(frames).toEqual([Uint8Array.of(7)])
  expect(chunk.subarray(3)).toEqual(encodeRpcStreamFrame(Uint8Array.of(8)))
  expect(errors).toEqual([])
  /** An oversized first-frame header rejects without requiring any payload bytes. */
  const limited = createRpcStreamFrameDecoderWithLimit(
    { onFrame: () => expect.unreachable(), onError: (error) => errors.push(error) },
    () => 64 * 1024
  )
  expect(limited.push(Uint8Array.of(0, 1, 0, 1))).toBe(4)
  expect(errors).toEqual([expect.objectContaining({ code: 'FRAME_LIMIT_EXCEEDED' })])
})

it('keeps the original release-before-callback behavior during reentrant frame delivery', () => {
  /** Reentrant delivery still uses the same decoder and owned completed frames. */
  const delivered: number[] = []
  /** Nested pushes consume their own chunk offsets without claiming outer bytes. */
  let nested = 0
  /** The existing callback may synchronously provide another complete native frame. */
  const decoder = createRpcStreamFrameDecoder({
    onFrame(frame) {
      delivered.push(frame[0]!)
      if (frame[0] === 1) nested = decoder.push(encodeRpcStreamFrame(Uint8Array.of(2)))
    },
    onError: () => expect.unreachable()
  })
  expect(decoder.push(encodeRpcStreamFrame(Uint8Array.of(1)))).toBe(5)
  expect(nested).toBe(5)
  expect(delivered).toEqual([1, 2])
})

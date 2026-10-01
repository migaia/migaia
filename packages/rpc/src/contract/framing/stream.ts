import { isUint8Array } from '@migaia/utils/bytes'
import { createContractError } from '../contract-error.js'
import { RpcContractErrorCode } from '../error-code.js'

/** Maximum payload carried by one native process frame. */
export const RPC_STREAM_MAX_FRAME_BYTES = 16 * 1024 * 1024

/** A decoder owns one bounded frame buffer and reports the first malformed frame. */
export type IRpcStreamFrameDecoder = Readonly<{
  push(chunk: Uint8Array): void
  finish(): void
  close(): void
}>

/** Callbacks consume complete payloads or the first framing error. */
export type IRpcStreamFrameDecoderOptions = Readonly<{
  onFrame(frame: Uint8Array): void
  onError(error: Error): void
}>

/** Encode one nonempty payload with an unsigned four-byte network-order length. */
export function encodeRpcStreamFrame(payload: Uint8Array): Uint8Array {
  if (!isUint8Array(payload) || payload.byteLength === 0)
    throw createContractError(RpcContractErrorCode.invalidFrame)
  if (payload.byteLength > RPC_STREAM_MAX_FRAME_BYTES)
    throw createContractError(RpcContractErrorCode.frameLimitExceeded)
  /** One allocation keeps prefix and payload adjacent for a single physical write. */
  const framed = new Uint8Array(4 + payload.byteLength)
  new DataView(framed.buffer).setUint32(0, payload.byteLength, false)
  framed.set(payload, 4)
  return framed
}

/** Decode arbitrary chunk boundaries while retaining at most one frame. */
export function createRpcStreamFrameDecoder(
  options: IRpcStreamFrameDecoderOptions
): IRpcStreamFrameDecoder {
  return createRpcStreamFrameDecoderWithLimit(options, () => RPC_STREAM_MAX_FRAME_BYTES)
}

/** Internal process boundary supplies a phase-specific cap before payload allocation. */
export function createRpcStreamFrameDecoderWithLimit(
  options: IRpcStreamFrameDecoderOptions,
  maxFrameBytes: () => number
): IRpcStreamFrameDecoder {
  /** Partial prefix, reused for each frame. */
  const header = new Uint8Array(4)
  /** Number of prefix bytes received so far. */
  let headerBytes = 0
  /** Current frame payload, allocated only after a valid complete prefix. */
  let payload: Uint8Array | undefined
  /** Number of bytes written into the current payload. */
  let payloadBytes = 0
  /** Terminal state prevents later chunks from joining a discarded partial frame. */
  let terminal = false

  /** Report once and discard the connection's partial framing state. */
  const fail = (
    code: typeof RpcContractErrorCode.invalidFrame | typeof RpcContractErrorCode.frameLimitExceeded
  ): void => {
    terminal = true
    payload = undefined
    headerBytes = 0
    options.onError(createContractError(code))
  }

  return {
    push(chunk) {
      if (terminal || !isUint8Array(chunk))
        throw createContractError(RpcContractErrorCode.invalidFrame)
      /** Position in this caller-owned chunk. */
      let offset = 0
      while (offset < chunk.byteLength) {
        if (payload === undefined) {
          /** Complete the prefix before allocating any frame payload. */
          const copied = Math.min(4 - headerBytes, chunk.byteLength - offset)
          header.set(chunk.subarray(offset, offset + copied), headerBytes)
          headerBytes += copied
          offset += copied
          if (headerBytes < 4) continue
          /** Header bytes are unsigned and network ordered. */
          const length = new DataView(header.buffer).getUint32(0, false)
          if (length === 0) {
            fail(RpcContractErrorCode.invalidFrame)
            return
          }
          if (length > maxFrameBytes()) {
            fail(RpcContractErrorCode.frameLimitExceeded)
            return
          }
          payload = new Uint8Array(length)
          payloadBytes = 0
          headerBytes = 0
        }
        /** Copy into decoder-owned memory because the sender may reuse its chunk buffer. */
        const copied = Math.min(payload.byteLength - payloadBytes, chunk.byteLength - offset)
        payload.set(chunk.subarray(offset, offset + copied), payloadBytes)
        payloadBytes += copied
        offset += copied
        if (payloadBytes === payload.byteLength) {
          /** Release the frame before invoking user code, permitting reentrant push. */
          const complete = payload
          payload = undefined
          payloadBytes = 0
          options.onFrame(complete)
        }
      }
    },
    finish() {
      if (terminal) return
      if (headerBytes !== 0 || payload !== undefined) {
        fail(RpcContractErrorCode.invalidFrame)
        return
      }
      terminal = true
    },
    close() {
      terminal = true
      payload = undefined
      headerBytes = 0
    }
  }
}

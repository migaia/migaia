/**
 * Owns bounded length-prefix framing and the decoder's partial header/payload state. Complete-frame
 * callbacks receive owned payloads and the consumed offset preserves native bootstrap tail handoff;
 * callers retain IO, byte limits and physical-close ownership.
 */
import { isUint8Array } from '@migaia/utils/bytes'
import { createContractError, type IRpcErrorWireMetadata } from '@migaia/rpc-contract/errors'
import { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import { markRpcCarrierAdmissionFailure } from '../carrier/admission.js'

/** Maximum payload carried by one native process frame. */
export const RPC_STREAM_MAX_FRAME_BYTES = 16 * 1024 * 1024

/** A decoder owns one bounded frame buffer and reports the first malformed frame. */
export type IRpcStreamFrameDecoder = Readonly<{
  /** Returns consumed bytes; synchronous close during delivery leaves this chunk's tail untouched. */
  push(chunk: Uint8Array): number
  /** Ends input, reporting a partial tail through onError and making the decoder terminal. */
  finish(): void
  /** Silently drops a partial frame and becomes terminal without emitting another framing error. */
  close(): void
}>

/** Callbacks consume complete payloads or the first framing error. */
export type IRpcStreamFrameDecoderOptions = Readonly<{
  /** Explicit caller-owned error presentation belongs to this held decoder. */
  errorMetadata?: IRpcErrorWireMetadata
  /** Receives each owned complete payload; may close/finish the decoder to stop the current chunk. */
  onFrame(frame: Uint8Array): void
  /**
   * Receives the first malformed-length, size-limit or truncated-tail error; later errors are
   * suppressed.
   */
  onError(error: Error): void
}>

/**
 * Copies a nonempty Uint8Array behind an unsigned four-byte network-order length. Returns owned
 * contiguous bytes; empty/non-byte input throws INVALID_FRAME and payloads above 16 MiB throw
 * FRAME_LIMIT_EXCEEDED. The caller owns writing those bytes and preserving message order.
 */
export function encodeRpcStreamFrame(
  payload: Uint8Array,
  errorMetadata?: IRpcErrorWireMetadata
): Uint8Array {
  if (!isUint8Array(payload) || payload.byteLength === 0)
    throw createContractError(RpcContractErrorCode.invalidFrame, undefined, errorMetadata)
  if (payload.byteLength > RPC_STREAM_MAX_FRAME_BYTES)
    throw markRpcCarrierAdmissionFailure(
      createContractError(RpcContractErrorCode.frameLimitExceeded, undefined, errorMetadata)
    )
  /** One allocation keeps prefix and payload adjacent for a single physical write. */
  const framed = new Uint8Array(4 + payload.byteLength)
  new DataView(framed.buffer).setUint32(0, payload.byteLength, false)
  framed.set(payload, 4)
  return framed
}

/**
 * Encodes text behind the same four-byte length prefix using the required encoder. Optional storage
 * is borrowed only when large enough; the returned subarray can alias it, so do not reuse that
 * backing until its physical write drains. Empty or oversized payloads follow
 * encodeRpcStreamFrame's errors.
 */
export function encodeRpcStreamTextFrame(
  text: string,
  encoder: {
    /** Encode a complete UTF-8 payload for the fallback allocation path. */
    encode(input: string): Uint8Array
    /** Write UTF-8 bytes into the provided payload region without retaining it. */
    encodeInto(
      input: string,
      destination: Uint8Array
    ): Readonly<{
      /** Actual complete payload bytes written, used for the wire length prefix. */
      written: number
    }>
  },
  storage?: Uint8Array,
  errorMetadata?: IRpcErrorWireMetadata
): Uint8Array {
  /** Three bytes per UTF-16 code unit is a conclusive bound, including lone surrogates. */
  const upper = text.length * 3
  if (text.length === 0 || upper > RPC_STREAM_MAX_FRAME_BYTES)
    return encodeRpcStreamFrame(encoder.encode(text), errorMetadata)
  /** A connection lends this backing only after the previous physical write completed. */
  const frame = storage && storage.byteLength >= upper + 4 ? storage : new Uint8Array(upper + 4)
  /** One UTF-8 pass writes the payload after the original network-order prefix. */
  const result = encoder.encodeInto(text, frame.subarray(4))
  if (result.written === 0)
    throw createContractError(RpcContractErrorCode.invalidFrame, undefined, errorMetadata)
  new DataView(frame.buffer, frame.byteOffset).setUint32(0, result.written, false)
  return frame.subarray(0, result.written + 4)
}

/**
 * Creates a length-prefix decoder retaining at most one payload of up to 16 MiB. It reports the
 * first wire framing failure through required onError, then stops delivery. The owner must call
 * finish() on input end or close() to abandon the frame; neither closes a physical connection.
 */
export function createRpcStreamFrameDecoder(
  options: IRpcStreamFrameDecoderOptions
): IRpcStreamFrameDecoder {
  return createRpcStreamFrameDecoderWithLimit(options, () => RPC_STREAM_MAX_FRAME_BYTES)
}

/**
 * Uses the same decoder with a required maxFrameBytes callback, read once for each completed length
 * header before payload allocation. Carriers can select a smaller bootstrap/handshake cap. Callback
 * exceptions retain their caller-owned behavior; the decoder installs no timer or I/O.
 */
/** Allocate one length-prefixed byte decoder before installing behavior callbacks. */
function rpcStreamFrameDecoderState(
  options: IRpcStreamFrameDecoderOptions,
  maxFrameBytes: () => number
) {
  /** Partial prefix, reused for each frame. */
  const header = new Uint8Array(4)
  /** Number of prefix bytes received so far. */
  let headerBytes = 0
  /** Current frame payload, allocated only after a valid complete prefix. */
  const payload = undefined as Uint8Array | undefined
  /** Number of bytes written into the current payload. */
  let payloadBytes = 0
  /** Terminal state prevents later chunks from joining a discarded partial frame. */
  let terminal = false

  return { header, headerBytes, payload, payloadBytes, terminal, options, maxFrameBytes }
}

/** Own one length-prefixed byte decoder; callbacks access only this explicit instance. */
class RpcStreamFrameDecoder {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof rpcStreamFrameDecoderState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IRpcStreamFrameDecoder
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(options: IRpcStreamFrameDecoderOptions, maxFrameBytes: () => number) {
    this.#state = rpcStreamFrameDecoderState(options, maxFrameBytes)

    this.value = {
      push: (chunk) => {
        if (this.#state.terminal || !isUint8Array(chunk))
          throw createContractError(
            RpcContractErrorCode.invalidFrame,
            undefined,
            this.#state.options.errorMetadata
          )
        /** Position in this caller-owned chunk. */
        let offset = 0
        while (!this.#state.terminal && offset < chunk.byteLength) {
          if (this.#state.payload === undefined) {
            /** Complete the prefix before allocating any frame payload. */
            const copied = Math.min(4 - this.#state.headerBytes, chunk.byteLength - offset)
            this.#state.header.set(chunk.subarray(offset, offset + copied), this.#state.headerBytes)
            this.#state.headerBytes += copied
            offset += copied
            if (this.#state.headerBytes < 4) continue
            /** Header bytes are unsigned and network ordered. */
            const length = new DataView(this.#state.header.buffer).getUint32(0, false)
            if (length === 0) {
              this.#fail(RpcContractErrorCode.invalidFrame)
              return offset
            }
            if (length > (0, this.#state.maxFrameBytes)()) {
              this.#fail(RpcContractErrorCode.frameLimitExceeded)
              return offset
            }
            this.#state.payload = new Uint8Array(length)
            this.#state.payloadBytes = 0
            this.#state.headerBytes = 0
          }
          /** Copy into decoder-owned memory because the sender may reuse its chunk buffer. */
          const copied = Math.min(
            this.#state.payload.byteLength - this.#state.payloadBytes,
            chunk.byteLength - offset
          )
          this.#state.payload.set(chunk.subarray(offset, offset + copied), this.#state.payloadBytes)
          this.#state.payloadBytes += copied
          offset += copied
          if (this.#state.payloadBytes === this.#state.payload.byteLength) {
            /** Release the frame before invoking user code, permitting reentrant push. */
            const complete = this.#state.payload
            this.#state.payload = undefined
            this.#state.payloadBytes = 0
            this.#state.options.onFrame(complete)
          }
        }
        return offset
      },
      finish: () => {
        if (this.#state.terminal) return
        if (this.#state.headerBytes !== 0 || this.#state.payload !== undefined) {
          this.#fail(RpcContractErrorCode.invalidFrame)
          return
        }
        this.#state.terminal = true
      },
      close: () => {
        this.#state.terminal = true
        this.#state.payload = undefined
        this.#state.headerBytes = 0
      }
    }
  }
  /** Report once and discard the connection's partial framing state. */
  #fail = (
    code: typeof RpcContractErrorCode.invalidFrame | typeof RpcContractErrorCode.frameLimitExceeded
  ): void => {
    this.#state.terminal = true
    this.#state.payload = undefined
    this.#state.headerBytes = 0
    this.#state.options.onError(
      createContractError(code, undefined, this.#state.options.errorMetadata)
    )
  }
}

/** Construct the single owner for one length-prefixed byte decoder. */
export function createRpcStreamFrameDecoderWithLimit(
  options: IRpcStreamFrameDecoderOptions,
  maxFrameBytes: () => number
): IRpcStreamFrameDecoder {
  return new RpcStreamFrameDecoder(options, maxFrameBytes).value
}

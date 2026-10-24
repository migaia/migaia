import { utf8ByteLength } from '@migaia/utils/bytes'
import { isExcerptFree, redactHandshake } from '../handshake.js'
import { JsonRpcHeader, JsonRpcLimit } from './jsonrpc-constants.js'
import { JsonRpcBridgeErrorCode, JSONRPC_BRIDGE_ERROR_SOURCE } from './jsonrpc/error-code.js'
import { JsonRpcBridgeErrorText } from './jsonrpc-error-text.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import { RPC_FRAME_TEXT_ENCODING } from './text-encoding.js'

/** Custom JSON-RPC carriers classify failures by stable semantic source and code. */
export {
  JsonRpcBridgeErrorCode,
  JSONRPC_BRIDGE_ERROR_SOURCE,
  type IJsonRpcBridgeErrorCode
} from './jsonrpc/error-code.js'
/** A custom byte carrier can size its buffers against the existing supported frame limits. */
export { JsonRpcLimit } from './jsonrpc-constants.js'

/** The frame operation constructs only its original Error family and preserves the supplied cause. */
function createJsonRpcFrameError(cause?: unknown): Error {
  return attachErrorIdentity(
    new Error(JsonRpcBridgeErrorText.frameInvalid, cause === undefined ? undefined : { cause }),
    { source: JSONRPC_BRIDGE_ERROR_SOURCE, code: JsonRpcBridgeErrorCode.frameInvalid }
  )
}

/** A decoder retains at most one bounded header/body while accepting arbitrary OS read splits. */
export type IJsonRpcFrameDecoder = Readonly<{
  /** Returns complete JSON values from arbitrary byte chunks; malformed framing/UTF-8/JSON throws. */
  push(chunk: Uint8Array): readonly unknown[]
  /** Checks for a partial frame and throws if present; successful finish does not close the decoder. */
  finish(): void
  /** Drops retained bytes and makes later push() calls return an empty list. */
  close(): void
  /** Currently retained header/body bytes, excluding complete values already returned. */
  readonly bufferedBytes: number
}>

/**
 * UTF-16 code units require at most three UTF-8 bytes each: BMP and isolated surrogates use up to
 * three, while a surrogate pair uses four for two units. Bodies within this length cannot exceed
 * the byte ceiling during native encoding.
 */
const nativeEncodingSafeLength = Math.floor(JsonRpcLimit.bodyBytes / 3)

/**
 * JSON-stringifies one value and returns its Content-Length ASCII header plus UTF-8 body as one
 * owned byte chunk. Empty/oversized bodies throw JSONRPC_FRAME_INVALID. Native stringify errors
 * retain their host behavior; this operation does not validate a JSON-RPC request or error schema.
 */
export function encodeJsonRpcFrame(value: unknown): Uint8Array {
  /** Undefined JSON results retain the existing empty-body frame rejection. */
  const body = JSON.stringify(value) ?? ''
  if (
    body.length === 0 ||
    body.length > JsonRpcLimit.bodyBytes ||
    (body.length > nativeEncodingSafeLength && utf8ByteLength(body) > JsonRpcLimit.bodyBytes)
  )
    throw createJsonRpcFrameError()
  /** Native encoding starts only after the length proof or exact allocation-free guard accepts. */
  const encoder = new TextEncoder()
  /** Ordinary payloads avoid a JavaScript byte-counting pass over the entire body. */
  const encodedBody = encoder.encode(body)
  /** Header and body remain contiguous so the gate can preserve FIFO with one write. */
  const header = `${JsonRpcHeader.prefix}${encodedBody.length}${JsonRpcHeader.end}`
  /** The accepted native body is copied once into its contiguous wire frame. */
  const frame = new Uint8Array(header.length + encodedBody.length)
  encoder.encodeInto(header, frame)
  frame.set(encodedBody, header.length)
  return frame
}

/** Parse one ASCII header block; casing/whitespace follow the LSP byte framing contract. */
function parseLength(header: Uint8Array): number {
  if (header.some((byte) => byte > 127)) throw createJsonRpcFrameError()
  /** Header decoding is safe only after rejecting all non-ASCII bytes. */
  const text = new TextDecoder().decode(header)
  /** Retain the sole validated declaration and detect duplicate length headers. */
  let length: number | undefined
  for (const line of text.slice(0, -JsonRpcHeader.end.length).split(JsonRpcHeader.line)) {
    /** A bare CR/LF or malformed header cannot be treated as an ignored extension. */
    const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([^\r\n]*)$/u.exec(line)
    if (!match) throw createJsonRpcFrameError()
    /** Header names are case insensitive within the supported byte profile. */
    const name = match[1]!.toLowerCase()
    /** Only edge whitespace is removed; numeric grammar remains exact. */
    const value = match[2]!.trim()
    if (name === JsonRpcHeader.length) {
      if (length !== undefined || !/^[1-9][0-9]*$/u.test(value)) throw createJsonRpcFrameError()
      length = Number(value)
      if (!Number.isSafeInteger(length) || length > JsonRpcLimit.bodyBytes)
        throw createJsonRpcFrameError()
    } else if (name === JsonRpcHeader.type) {
      /** Content-Type may declare only the two UTF-8 spellings in this profile. */
      const charset = /(?:^|;)\s*charset\s*=\s*([^;\s]+)\s*(?:;|$)/iu.exec(value)
      if (/charset/iu.test(value) && (!charset || !/^(?:utf-8|utf8)$/iu.test(charset[1]!)))
        throw createJsonRpcFrameError()
    }
  }
  if (length === undefined) throw createJsonRpcFrameError()
  return length
}

/**
 * Creates a connection-owned Content-Length decoder with fixed header/body limits. push() returns
 * all completed JSON values in order and throws JSONRPC_FRAME_INVALID for malformed frames, fatal
 * UTF-8 or JSON. finish() detects a truncated tail without closing; close() releases retained
 * state. This differs from the native length-prefix decoder's first-error callback contract.
 */
/** Allocate one Content-Length byte decoder before installing behavior callbacks. */
function jsonRpcFrameDecoderState() {
  /** Header has a fixed budget; body allocation starts only after length validation. */
  const header = new Uint8Array(JsonRpcLimit.headerBytes)
  /** Track incremental header occupancy against the fixed allocation. */
  let headerUsed = 0
  /** Exactly one body buffer is owned until its complete parsed value is returned. */
  const body = undefined as Uint8Array | undefined
  /** Track body completion without reallocating accumulated chunks. */
  let bodyUsed = 0
  /** Closing drops retained bytes and makes later chunks inert. */
  let closed = false

  return { header, headerUsed, body, bodyUsed, closed }
}

/** Own one Content-Length byte decoder; callbacks access only this explicit instance. */
class JsonRpcFrameDecoder {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof jsonRpcFrameDecoderState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IJsonRpcFrameDecoder
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor() {
    this.#state = jsonRpcFrameDecoderState()

    this.value = {
      push: (chunk) => {
        /** Complete values are delivered in the same order as bytes within this read. */
        const values: unknown[] = []
        let offset = 0
        while (!this.#state.closed && offset < chunk.length) {
          if (!this.#state.body) {
            if (this.#state.headerUsed === this.#state.header.length)
              throw createJsonRpcFrameError()
            /** Consume one header byte so CRLF boundaries survive arbitrary read splits. */
            const byte = chunk[offset++]!
            this.#state.header[this.#state.headerUsed++] = byte
            if (
              byte === 10 &&
              (this.#state.headerUsed < 2 || this.#state.header[this.#state.headerUsed - 2] !== 13)
            )
              throw createJsonRpcFrameError()
            if (
              this.#state.headerUsed >= 4 &&
              this.#state.header[this.#state.headerUsed - 4] === 13 &&
              this.#state.header[this.#state.headerUsed - 3] === 10 &&
              this.#state.header[this.#state.headerUsed - 2] === 13 &&
              byte === 10
            )
              this.#state.body = new Uint8Array(
                parseLength(this.#state.header.subarray(0, this.#state.headerUsed))
              )
            continue
          }
          /** Copy only the currently available body segment; no quadratic reallocation. */
          const count = Math.min(
            this.#state.body.length - this.#state.bodyUsed,
            chunk.length - offset
          )
          this.#state.body.set(chunk.subarray(offset, offset + count), this.#state.bodyUsed)
          offset += count
          this.#state.bodyUsed += count
          if (this.#state.bodyUsed !== this.#state.body.length) continue
          /** BOM is invalid even though TextDecoder ordinarily strips it. */
          if (
            this.#state.body[0] === 0xef &&
            this.#state.body[1] === 0xbb &&
            this.#state.body[2] === 0xbf
          )
            throw createJsonRpcFrameError()
          /** Hold decoded JSON text only while parsing the current complete body. */
          let text: string
          try {
            text = new TextDecoder(RPC_FRAME_TEXT_ENCODING, { fatal: true }).decode(
              this.#state.body
            )
          } catch (cause) {
            throw createJsonRpcFrameError(cause)
          }
          try {
            values.push(JSON.parse(text) as unknown)
          } catch (cause) {
            /** Preserve only engine diagnostics that cannot quote four input code units. */
            throw createJsonRpcFrameError(
              cause instanceof Error && isExcerptFree(cause.message, text)
                ? cause
                : redactHandshake(text)
            )
          }
          this.#state.headerUsed = 0
          this.#state.body = undefined
          this.#state.bodyUsed = 0
        }
        return values
      },
      finish: () => {
        if (!this.#state.closed && (this.#state.headerUsed !== 0 || this.#state.body !== undefined))
          throw createJsonRpcFrameError()
      },
      close: () => {
        this.#state.closed = true
        this.#state.headerUsed = 0
        this.#state.body = undefined
        this.#state.bodyUsed = 0
      },
      bufferedBytes: 0
    }
    Object.defineProperties(this.value, {
      bufferedBytes: {
        get: () => {
          return this.#state.headerUsed + this.#state.bodyUsed
        }
      }
    })
  }
}

/** Construct the single owner for one Content-Length byte decoder. */
export function createJsonRpcFrameDecoder(): IJsonRpcFrameDecoder {
  return new JsonRpcFrameDecoder().value
}

export * from './jsonrpc-profile.js'
export { checkJsonRpcDescription } from './jsonrpc-description.js'

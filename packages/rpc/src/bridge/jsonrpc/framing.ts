import { utf8ByteLength } from '@migaia/utils/bytes'
import { isExcerptFree, redactHandshake } from '../../contract/handshake.js'
import { JsonRpcHeader, JsonRpcLimit } from './constants.js'
import { JsonRpcBridgeErrorCode } from './error-code.js'
import { createJsonRpcBridgeError } from './error.js'

/** A decoder retains at most one bounded header/body while accepting arbitrary OS read splits. */
export type IJsonRpcFrameDecoder = Readonly<{
  push(chunk: Uint8Array): readonly unknown[]
  finish(): void
  close(): void
  readonly bufferedBytes: number
}>

/**
 * UTF-16 code units require at most three UTF-8 bytes each: BMP and isolated surrogates use up to
 * three, while a surrogate pair uses four for two units. Bodies within this length cannot exceed
 * the byte ceiling during native encoding.
 */
const nativeEncodingSafeLength = Math.floor(JsonRpcLimit.bodyBytes / 3)

/** Emit exactly one normalized ASCII header and UTF-8 body in one physical write chunk. */
export function encodeJsonRpcFrame(value: unknown): Uint8Array {
  /** Undefined JSON results retain the existing empty-body frame rejection. */
  const body = JSON.stringify(value) ?? ''
  if (
    body.length === 0 ||
    body.length > JsonRpcLimit.bodyBytes ||
    (body.length > nativeEncodingSafeLength && utf8ByteLength(body) > JsonRpcLimit.bodyBytes)
  )
    throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.frameInvalid)
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
  if (header.some((byte) => byte > 127))
    throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.frameInvalid)
  /** Header decoding is safe only after rejecting all non-ASCII bytes. */
  const text = new TextDecoder().decode(header)
  /** Retain the sole validated declaration and detect duplicate length headers. */
  let length: number | undefined
  for (const line of text.slice(0, -JsonRpcHeader.end.length).split(JsonRpcHeader.line)) {
    /** A bare CR/LF or malformed header cannot be treated as an ignored extension. */
    const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([^\r\n]*)$/u.exec(line)
    if (!match) throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.frameInvalid)
    /** Header names are case insensitive within the supported byte profile. */
    const name = match[1]!.toLowerCase()
    /** Only edge whitespace is removed; numeric grammar remains exact. */
    const value = match[2]!.trim()
    if (name === JsonRpcHeader.length) {
      if (length !== undefined || !/^[1-9][0-9]*$/u.test(value))
        throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.frameInvalid)
      length = Number(value)
      if (!Number.isSafeInteger(length) || length > JsonRpcLimit.bodyBytes)
        throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.frameInvalid)
    } else if (name === JsonRpcHeader.type) {
      /** Content-Type may declare only the two UTF-8 spellings in this profile. */
      const charset = /(?:^|;)\s*charset\s*=\s*([^;\s]+)\s*(?:;|$)/iu.exec(value)
      if (/charset/iu.test(value) && (!charset || !/^(?:utf-8|utf8)$/iu.test(charset[1]!)))
        throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.frameInvalid)
    }
  }
  if (length === undefined) throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.frameInvalid)
  return length
}

/** Incrementally decode frames without concatenating the accumulated body on every chunk. */
export function createJsonRpcFrameDecoder(): IJsonRpcFrameDecoder {
  /** Header has a fixed budget; body allocation starts only after length validation. */
  const header = new Uint8Array(JsonRpcLimit.headerBytes)
  /** Track incremental header occupancy against the fixed allocation. */
  let headerUsed = 0
  /** Exactly one body buffer is owned until its complete parsed value is returned. */
  let body: Uint8Array | undefined
  /** Track body completion without reallocating accumulated chunks. */
  let bodyUsed = 0
  /** Closing drops retained bytes and makes later chunks inert. */
  let closed = false
  return {
    push(chunk) {
      /** Complete values are delivered in the same order as bytes within this read. */
      const values: unknown[] = []
      let offset = 0
      while (!closed && offset < chunk.length) {
        if (!body) {
          if (headerUsed === header.length)
            throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.frameInvalid)
          /** Consume one header byte so CRLF boundaries survive arbitrary read splits. */
          const byte = chunk[offset++]!
          header[headerUsed++] = byte
          if (byte === 10 && (headerUsed < 2 || header[headerUsed - 2] !== 13))
            throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.frameInvalid)
          if (
            headerUsed >= 4 &&
            header[headerUsed - 4] === 13 &&
            header[headerUsed - 3] === 10 &&
            header[headerUsed - 2] === 13 &&
            byte === 10
          )
            body = new Uint8Array(parseLength(header.subarray(0, headerUsed)))
          continue
        }
        /** Copy only the currently available body segment; no quadratic reallocation. */
        const count = Math.min(body.length - bodyUsed, chunk.length - offset)
        body.set(chunk.subarray(offset, offset + count), bodyUsed)
        offset += count
        bodyUsed += count
        if (bodyUsed !== body.length) continue
        /** BOM is invalid even though TextDecoder ordinarily strips it. */
        if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf)
          throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.frameInvalid)
        /** Hold decoded JSON text only while parsing the current complete body. */
        let text: string
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(body)
        } catch (cause) {
          throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.frameInvalid, cause)
        }
        try {
          values.push(JSON.parse(text) as unknown)
        } catch (cause) {
          /** Preserve only engine diagnostics that cannot quote four input code units. */
          throw createJsonRpcBridgeError(
            JsonRpcBridgeErrorCode.frameInvalid,
            cause instanceof Error && isExcerptFree(cause.message, text)
              ? cause
              : redactHandshake(text)
          )
        }
        headerUsed = 0
        body = undefined
        bodyUsed = 0
      }
      return values
    },
    finish() {
      if (!closed && (headerUsed !== 0 || body !== undefined))
        throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.frameInvalid)
    },
    close() {
      closed = true
      headerUsed = 0
      body = undefined
      bodyUsed = 0
    },
    get bufferedBytes() {
      return headerUsed + bodyUsed
    }
  }
}

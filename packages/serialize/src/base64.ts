/**
 * Shared binary wire helpers used by persistence and SSR codecs. Pure algorithm, no host
 * `btoa`/`atob`.
 */

import { createSerializeTypeError, SerializeErrorCode, SerializeErrorText } from './errors.js'
import {
  base64ToBytes as decodeCanonicalBase64,
  bytesToBase64 as encodeCanonicalBase64,
  streamBase64Chunks as streamCanonicalBase64Chunks
} from '@migaia/utils/bytes'

/** Three-byte aligned chunks preserve canonical padding between streamed pieces. */
const CHUNK_BYTES = 0x7ffd - (0x7ffd % 3)

/** RFC 4648 URL alphabet supplies the unused-bit check for portable bytes tags. */
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** Encode bytes through the shared runtime-neutral RFC 4648 implementation. */
export function bytesToBase64(bytes: Uint8Array): string {
  return encodeCanonicalBase64(bytes)
}

/**
 * Yields base64 text pieces to consumers that write to a sink, such as `WritableStream` or chunked
 * upload. The full base64 string never needs to be assembled at once. Use `bytesToBase64` when the
 * final consumer requires one string.
 */
export function* streamBase64Chunks(bytes: Uint8Array): Generator<string, void, void> {
  yield* streamCanonicalBase64Chunks(bytes, CHUNK_BYTES)
}

/** Decode canonical padded base64 while preserving the legacy public diagnostic boundary. */
export function base64ToBytes(text: string): Uint8Array {
  try {
    return decodeCanonicalBase64(text)
  } catch (cause) {
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.base64Invalid,
      { cause }
    )
  }
}

/** Encode the portable wire spelling without padding or host-specific APIs. */
export function bytesToBase64url(bytes: Uint8Array): string {
  /** The canonical encoder adds at most two padding characters; never scan the whole wire text. */
  const text = bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_')
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  return padding === 0 ? text : text.slice(0, -padding)
}

/** Validate unpadded base64url, including the unused low bits of the final character. */
export function isCanonicalBase64url(text: string): boolean {
  if (!/^[A-Za-z0-9_-]*$/u.test(text) || text.length % 4 === 1) return false
  if (text.length === 0) return true
  /** Final sextet determines whether the omitted padding has a unique spelling. */
  const bits = BASE64URL_ALPHABET.indexOf(text[text.length - 1]!)
  return text.length % 4 === 2 ? (bits & 15) === 0 : text.length % 4 === 3 ? (bits & 3) === 0 : true
}

/**
 * Shared binary wire helpers used by persistence and SSR codecs. Pure algorithm, no host
 * `btoa`/`atob`.
 */

import { createSerializeTypeError, SerializeErrorCode } from './errors.js'
import {
  base64ToBytes as decodeCanonicalBase64,
  bytesToBase64 as encodeCanonicalBase64,
  streamBase64Chunks as streamCanonicalBase64Chunks
} from '@migaia/utils/bytes'

const CHUNK_BYTES = 0x7ffd - (0x7ffd % 3) // 32763，3 的倍数

export function bytesToBase64(bytes: Uint8Array): string {
  return encodeCanonicalBase64(bytes)
}

/**
 * 逐片产出 base64 文本，供写入 sink（`WritableStream`、分块上传）的调用方——它永远不需要整份 base64 字符串一次成型。`bytesToBase64`
 * 仍是「最终只要一个字符串」时的正确选择。
 */
export function* streamBase64Chunks(bytes: Uint8Array): Generator<string, void, void> {
  yield* streamCanonicalBase64Chunks(bytes, CHUNK_BYTES)
}

export function base64ToBytes(text: string): Uint8Array {
  try {
    return decodeCanonicalBase64(text)
  } catch {
    throw createSerializeTypeError(SerializeErrorCode.invalidOption, 'invalid base64 input')
  }
}

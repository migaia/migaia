import { utf8ByteLength as canonicalUtf8ByteLength } from '@migaia/utils/bytes'
import { tagWebRpcError, WebRpcErrorCode } from '../errors.js'

/** Measures encoded text without retaining the concrete inbound chunk assembler. */
export function utf8ByteLength(value: string): number {
  return canonicalUtf8ByteLength(value)
}

/** Splits text without cutting a Unicode code point or exceeding a byte budget. */
export function splitUtf8(value: string, maxBytes: number): readonly string[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4)
    throw tagWebRpcError(
      new RangeError('maxBytes must be at least 4 bytes'),
      WebRpcErrorCode.invalidConfig
    )
  const parts: string[] = []
  let part = ''
  let bytes = 0
  for (const character of value) {
    const characterBytes = utf8ByteLength(character)
    if (part && bytes + characterBytes > maxBytes) {
      parts.push(part)
      part = ''
      bytes = 0
    }
    part += character
    bytes += characterBytes
  }
  if (part) parts.push(part)
  return parts
}

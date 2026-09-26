/** UTF-8 primitives are owned by Utils; this module keeps WebRPC imports package-private. */
import { splitUtf8 as splitCanonical, utf8ByteLength } from '@migaia/utils/bytes'
import { WebRpcErrorCode, tagWebRpcError } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'

export { utf8ByteLength }

/** Adapts the canonical splitter while retaining WebRPC's error identity and empty-frame shape. */
export function splitUtf8(value: string, maxBytes: number): readonly string[] {
  try {
    const chunks = splitCanonical(value, maxBytes)
    return value.length === 0 ? [] : chunks
  } catch (error) {
    if (error instanceof RangeError)
      throw tagWebRpcError(
        new RangeError(WebRpcErrorText.utf8ChunkBudgetInvalid),
        WebRpcErrorCode.invalidConfig
      )
    throw error
  }
}

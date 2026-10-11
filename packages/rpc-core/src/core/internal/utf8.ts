import { RpcAuxiliaryErrorText } from './auxiliary-error-text.js'
/** UTF-8 primitives are owned by Utils; this module keeps WebRPC imports package-private. */
import { splitUtf8 as splitCanonical, utf8ByteLength } from '@migaia/utils/bytes'
import { RpcCoreErrorCode, tagRpcError } from '../errors.js'

export { utf8ByteLength }

/** Adapts the canonical splitter while retaining WebRPC's error identity and empty-frame shape. */
export function splitUtf8(value: string, maxBytes: number): readonly string[] {
  try {
    const chunks = splitCanonical(value, maxBytes)
    return value.length === 0 ? [] : chunks
  } catch (error) {
    if (error instanceof RangeError)
      throw tagRpcError(
        new RangeError(RpcAuxiliaryErrorText.utf8ChunkBudgetInvalid),
        RpcCoreErrorCode.invalidConfig
      )
    throw error
  }
}

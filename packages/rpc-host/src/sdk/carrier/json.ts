/**
 * Provides the single carrier JSON parse-failure boundary after handshake excerpt-privacy handling.
 * Preserves safe native causes and lends them to an optional media-specific error projector; the
 * supplied parser performs decoding without a second parse or semantic business walk.
 */
import {
  createContractError,
  isRpcHandshakeExcerptFree,
  redactRpcHandshakeFailure,
  type IRpcErrorWireMetadata
} from '@migaia/rpc-contract/errors'
import { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import type { IRpcJsonTextParser } from './types.js'

/** The real JSON parser is shared by message/byte receive paths with the original excerpt policy. */
export function decodeRpcCarrierText(
  text: string,
  parser: IRpcJsonTextParser,
  metadata?: IRpcErrorWireMetadata,
  projectFailure?: (safeCause: unknown) => Error
): unknown {
  try {
    return parser.decode(['text', text])
  } catch (cause) {
    /** A native engine may quote credentials; only an excerpt-free Error retains its exact cause. */
    const safe =
      cause instanceof Error && isRpcHandshakeExcerptFree(cause.message, text)
        ? cause
        : redactRpcHandshakeFailure(undefined)
    throw projectFailure
      ? projectFailure(safe)
      : createContractError(RpcContractErrorCode.handshakeInvalid, safe, metadata)
  }
}

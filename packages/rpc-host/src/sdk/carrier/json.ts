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
import { RpcHandshakeViolation } from '@migaia/rpc-contract/protocol'
import { utf8ByteLength } from '@migaia/utils/bytes'
import type { IRpcJsonTextParser } from './types.ts'

/** A lone UTF-16 half has no exact UTF-8 representation in the original first-message contract. */
const unpairedSurrogate =
  /([\uD800-\uDBFF](?![\uDC00-\uDFFF]))|((?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/u

/** Media failures share the existing native handshake family and stable diagnostic fact. */
export function createRpcCarrierTextFailure(
  violation: RpcHandshakeViolation,
  cause?: unknown,
  metadata?: IRpcErrorWireMetadata
): Error {
  /** The factory keeps the original cause and owns source/code/text without changing its stack. */
  const error = createContractError(RpcContractErrorCode.handshakeInvalid, cause, metadata)
  Object.defineProperty(error, 'violation', { value: violation, enumerable: true })
  return error
}

/** The real JSON parser is shared by message/byte receive paths with the original excerpt policy. */
export function decodeRpcCarrierText(
  text: string,
  parser: IRpcJsonTextParser,
  metadata?: IRpcErrorWireMetadata,
  projectFailure?: (safeCause: unknown) => Error,
  maxBytes?: number
): unknown {
  if (unpairedSurrogate.test(text))
    throw createRpcCarrierTextFailure(RpcHandshakeViolation.encoding, undefined, metadata)
  // One to three UTF-8 bytes per UTF-16 unit bound the scalar count without an encoding pass.
  if (
    maxBytes !== undefined &&
    (text.length > maxBytes || (text.length * 3 > maxBytes && utf8ByteLength(text) > maxBytes))
  )
    throw createRpcCarrierTextFailure(RpcHandshakeViolation.bytes, undefined, metadata)
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
      : createRpcCarrierTextFailure(RpcHandshakeViolation.type, safe, metadata)
  }
}

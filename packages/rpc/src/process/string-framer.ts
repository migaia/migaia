import type { IRpcFramer } from '../contract/types.js'
import { RpcCoreErrorCode, tagRpcError } from '../core/errors.js'
import { RpcProcessErrorText } from './error-text.js'
import { messageFramerV1 } from '../contract/framing/message-framer.js'
import {
  readRpcSingleFrameFacts,
  registerRpcSingleFrameFacts
} from '../contract/framing/reassembler.js'
import { RPC_STREAM_MAX_FRAME_BYTES } from '../contract/framing/stream.js'

/** Exact whole-message string framer; native length framing already marks message boundaries. */
export const processStringFramer: IRpcFramer<string, string, 'process-stream', 1> = Object.freeze({
  id: 'process-stream',
  version: 1,
  inputEncodedType: 'string',
  outputEncodedType: 'string',
  frame: (value: string) => [value],
  accept: (value: string) => ({ status: 'complete' as const, value }),
  close: () => undefined
})

/** Accept an unknown frame only after checking the underlying framer's string domain. */
export function asProcessString(value: unknown): string {
  if (typeof value !== 'string')
    throw tagRpcError(
      new TypeError(RpcProcessErrorText.expectedString),
      RpcCoreErrorCode.payloadInvalid
    )
  return value
}

/** Remote's unknown-typed port delegates to the original exact string framer. */
export const remoteProcessStringFramer: IRpcFramer<unknown, unknown, string, number> =
  Object.freeze({
    id: processStringFramer.id,
    version: processStringFramer.version,
    inputEncodedType: processStringFramer.inputEncodedType,
    outputEncodedType: processStringFramer.outputEncodedType,
    frame: (value, context) => processStringFramer.frame(asProcessString(value), context),
    accept: (value, context) => processStringFramer.accept(asProcessString(value), context),
    close: (reason) => processStringFramer.close(reason)
  })

/**
 * Whole-message process framing uses the canonical framing candidate policy and the native byte
 * decoder's actual frame ceiling. Exact native callables retain this cold proof; opaque wrappers do
 * not. Ordinary string framing keeps its original methods and incurs no per-message work.
 */
const processSingleFrameFacts = Object.freeze({
  maxConcurrentMessages: readRpcSingleFrameFacts(messageFramerV1.accept, messageFramerV1.frame)!
    .maxConcurrentMessages,
  maxMessageBytes: RPC_STREAM_MAX_FRAME_BYTES
})
registerRpcSingleFrameFacts(
  processStringFramer.accept,
  processStringFramer.frame,
  processSingleFrameFacts
)
registerRpcSingleFrameFacts(
  remoteProcessStringFramer.accept,
  remoteProcessStringFramer.frame,
  processSingleFrameFacts
)

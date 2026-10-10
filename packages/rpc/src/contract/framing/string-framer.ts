import { attachErrorIdentity } from '@migaia/utils/error'
import type { IRpcFrameContext, IRpcFramer } from '../types.js'
import { RpcContractErrorCode } from '../error-code.js'
import { RPC_CONTRACT_SOURCE, RpcContractErrorText } from '../error-text.js'
import { messageFramerV1 } from './message-framer.js'
import { bindRpcFrameIngress, registerRpcSingleFrameFacts } from './reassembler.js'
import { RPC_STREAM_MAX_FRAME_BYTES } from './stream.js'

/** BC7 keeps the native TypeError and original text while moving its identity to Contract. */
function asStringFrame(value: unknown): string {
  if (typeof value === 'string') return value
  /** Frame grammar keeps its RangeError; this string-domain failure remains a TypeError. */
  const error = new TypeError(RpcContractErrorText.expectedString)
  throw attachErrorIdentity(error, {
    source: RPC_CONTRACT_SOURCE,
    code: RpcContractErrorCode.invalidFrame
  })
}

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

/** Unknown byte-port values enter the same string-domain check before their original operation. */
export const remoteProcessStringFramer = Object.freeze({
  id: processStringFramer.id,
  version: processStringFramer.version,
  inputEncodedType: processStringFramer.inputEncodedType,
  outputEncodedType: processStringFramer.outputEncodedType,
  frame: (value: unknown, context: IRpcFrameContext) =>
    processStringFramer.frame(asStringFrame(value), context),
  accept: (value: unknown, _context?: IRpcFrameContext) => ({
    status: 'complete' as const,
    value: asStringFrame(value)
  }),
  close: (reason?: unknown) => processStringFramer.close(reason)
})

/** Native byte framing shares the original candidate capacity and actual decoder byte ceiling. */
const processSingleFrameFacts = Object.freeze({
  maxConcurrentMessages: bindRpcFrameIngress(messageFramerV1.accept, messageFramerV1.frame)
    .singleFrameLimits!.maxConcurrentMessages,
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

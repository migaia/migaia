export type { IRpcFrameAcceptResult, IRpcFrameContext, IRpcFramer } from './types.js'
export { messageFramerV1 } from './message-framer.js'
export { createBinaryFramer, createStringFramer } from './message-framer.js'
/** Whole-message string carriers reuse these exact canonical framers without chunk framing. */
export { remoteProcessStringFramer } from './string-framer.js'
export {
  bindRpcFrameIngress,
  type IRpcBoundFrameIngress,
  type IRpcNativeFrameOutputDomain
} from './reassembler.js'

export {
  assertRpcPhysicalFrameSize,
  measureRpcPhysicalFrame,
  inspectRpcPhysicalFrame,
  readRpcBatchMembers
} from '../batch-frame.js'
export type { IRpcPhysicalFrameInspection } from '../batch-frame.js'

/** Reuse the existing pure stdio bootstrap grammar without transferring live receive ownership. */
export {
  rpcByteRuntimeBootstrap,
  type IRpcByteRuntimeBootstrap
} from '../runtime-api/byte-bootstrap.js'

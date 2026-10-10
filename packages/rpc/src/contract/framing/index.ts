export type { IRpcFrameAcceptResult, IRpcFrameContext, IRpcFramer } from './types.js'
export { messageFramerV1 } from './message-framer.js'
export { createBinaryFramer, createStringFramer } from './message-framer.js'
/** Whole-message string carriers reuse these exact canonical framers without chunk framing. */
export { processStringFramer, remoteProcessStringFramer } from './string-framer.js'
export {
  bindRpcFrameIngress,
  createReassembler,
  type IRpcBoundFrameIngress,
  type IRpcNativeFrameOutputDomain,
  type IRpcReassembler
} from './reassembler.js'

export {
  assertRpcPhysicalFrameSize,
  measureRpcPhysicalFrame,
  readRpcBatchMembers,
  rejectRpcPhysicalFrameSize
} from '../batch-frame.js'

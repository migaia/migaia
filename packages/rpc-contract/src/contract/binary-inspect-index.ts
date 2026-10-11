/** Native carriers inspect their own buffers, wrappers, and integrity diagnostics without encoding. */
export {
  hasRpcBinaryEnvelope,
  isRpcBinaryIntegrityFailure,
  measureRpcNativeBinaryFrame,
  readRpcNativeBinary,
  rpcBinaryBackingLength,
  rpcBinaryView
} from './runtime-api/binary-capture.js'
export {
  RpcBinaryProfile,
  RpcBinaryStorage,
  RpcNativeBinaryKind
} from './runtime-api/binary-constants.js'
export type {
  IRpcBinaryBacking,
  IRpcBinaryDigest,
  IRpcBinaryManifest,
  IRpcPreparedBinary
} from './runtime-api/binary-capture.js'
export { assertRpcNativeBinaryFrameSize } from './runtime-api/binary-frame.js'

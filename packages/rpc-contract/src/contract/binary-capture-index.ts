/** Opaque synchronous capture owns protocol data, never mutable codec scratch or runtime rights. */
export {
  captureRpcBinaryData,
  type IRpcCapturedBinaryData
} from './runtime-api/binary-operation.js'
export type { IRpcBinaryDataCodec } from './runtime-api/binary-data-codec.js'
export type { IRpcBinaryDigest, IRpcPreparedBinary } from './runtime-api/binary-capture.js'
export { RpcBinaryStorage } from './runtime-api/binary-constants.js'

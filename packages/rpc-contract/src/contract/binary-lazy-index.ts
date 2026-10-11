/** Keep the original canonical cold/warm loading and digest schedule behind the ordinary entry. */
export {
  prepareRpcBinaryLazy as prepareRpcBinary,
  restoreRpcBinaryLazy as restoreRpcBinary,
  restoreRpcBinaryDecodedLazy as restoreRpcBinaryDecoded,
  RpcBinaryProfile,
  RpcBinaryStorage,
  RpcNativeBinaryKind
} from './runtime-api/binary-lazy-operation.js'
export type {
  IRpcBinaryBacking,
  IRpcBinaryDataCodec,
  IRpcBinaryDigest,
  IRpcBinaryManifest,
  IRpcPreparedBinary
} from './runtime-api/binary-lazy-operation.js'

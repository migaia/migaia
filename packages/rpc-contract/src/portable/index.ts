/** Pure portable policy, shape normalization and intrinsic native-length rules. */
export { normalizePortable, normalizeRpcPortable, RPC_PORTABLE_MAX_DEPTH } from './normalize.js'
export {
  rpcWirePortableStrategy,
  rpcNativePortableStrategy,
  captureRpcWirePortableRecord,
  assertRpcPortableRecordKey,
  raiseRpcPortableViolation,
  RpcPortableField,
  RpcPortableViolation
} from './strategy.js'
export { rpcPortableBackingLength, rpcPortableViewLength } from './intrinsics.js'
export type {
  IRpcPortableBytes,
  IRpcPortableRecord,
  IRpcPortableValue,
  IRpcWirePortableValue
} from '../contract/types.js'

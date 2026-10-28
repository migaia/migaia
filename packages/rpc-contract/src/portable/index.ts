/** Pure portable policy, shape normalization and intrinsic native-length rules. */
export { normalizePortable, normalizeRpcPortable, RPC_PORTABLE_MAX_DEPTH } from './normalize.ts'
export {
  rpcWirePortableStrategy,
  rpcNativePortableStrategy,
  captureRpcWirePortableRecord,
  assertRpcPortableRecordKey,
  raiseRpcPortableViolation,
  RpcPortableField,
  RpcPortableViolation
} from './strategy.ts'
export { rpcPortableBackingLength, rpcPortableViewLength } from './intrinsics.ts'
export type {
  IRpcPortableBytes,
  IRpcPortableRecord,
  IRpcPortableValue,
  IRpcWirePortableValue
} from '../contract/types.ts'

/** Pure native error contracts and bounded wire-error projection; provenance belongs to Host. */
export { createContractError, identifyContractCallbackFailure } from '../contract/contract-error.ts'
export {
  deserializeRpcError,
  normalizeRpcSerializedError,
  reachRpcError,
  serializeRpcError
} from '../contract/error.ts'
export {
  RpcContractErrorCode,
  ERROR_SOURCE as RPC_CONTRACT_SOURCE,
  type IRpcContractErrorCode
} from '../error-code.ts'
export * from '../contract/wire-error-constants.ts'
export type {
  IRpcContractError,
  IRpcErrorWireMetadata,
  IRpcErrorWireSummary,
  IRpcSerializedError,
  IRpcSerializeErrorOptions,
  IRpcWireErrorFailure,
  IRpcWireErrorOptions
} from '../contract/types.ts'
export * from './native.ts'
export * from './text.ts'
export * from './family.ts'
export * from './property.ts'
export * from './runtime-text.ts'
export { redactRpcHandshakeFailure, isRpcHandshakeExcerptFree } from './handshake-privacy.ts'
export { RpcProviderRejectionReason, type IRpcProviderRejection } from './provider-rejection.ts'

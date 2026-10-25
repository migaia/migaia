/** Pure native error contracts and bounded wire-error projection; provenance belongs to Host. */
export { createContractError, identifyContractCallbackFailure } from '../contract/contract-error.js'
export {
  deserializeRpcError,
  normalizeRpcSerializedError,
  reachRpcError,
  serializeRpcError
} from '../contract/error.js'
export {
  RpcContractErrorCode,
  ERROR_SOURCE as RPC_CONTRACT_SOURCE,
  type IRpcContractErrorCode
} from '../error-code.js'
export * from '../contract/wire-error-constants.js'
export type {
  IRpcContractError,
  IRpcErrorWireMetadata,
  IRpcErrorWireSummary,
  IRpcSerializedError,
  IRpcSerializeErrorOptions,
  IRpcWireErrorFailure,
  IRpcWireErrorOptions
} from '../contract/types.js'
export * from './native.js'
export * from './text.js'
export * from './family.js'
export * from './property.js'
export * from './runtime-text.js'
export { redactRpcHandshakeFailure, isRpcHandshakeExcerptFree } from './handshake-privacy.js'
export { RpcProviderRejectionReason, type IRpcProviderRejection } from './provider-rejection.js'

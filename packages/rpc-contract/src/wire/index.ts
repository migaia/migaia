/**
 * Public single-profile contract: immutable data, pure shape admission, and bounded error
 * projection. Executing carriers, host state, optional plugins, and feature implementations are not
 * imported.
 */
export * from './constants.js'
export type * from './types.js'
export type { IRpcErrorWireMetadata } from '../contract/types.js'
export { normalizeRpcFrame, isRpcOperationalFrame } from './envelope.js'
export {
  normalizeRpcRoute,
  normalizeRpcTrace,
  normalizeRpcCallOptions,
  normalizeRpcTask,
  normalizeRpcGeneration,
  normalizeRpcSteps,
  normalizeRpcPortable
} from './metadata.js'
export { normalizeRpcHandshake, acceptRpcHandshake, completeRpcHandshake } from './handshake.js'
export { normalizeRpcDirectory } from './directory.js'
export { normalizeRpcWireError, serializeRpcWireError, deserializeRpcWireError } from './errors.js'
export { normalizeRpcCarrierFrame, normalizeRpcBinaryManifest } from './frame.js'
export {
  normalizeRpcStream,
  checkRpcStreamInitialSequence,
  checkRpcStreamSequence,
  checkRpcStreamProgress,
  checkRpcStreamConsumerCredit,
  checkRpcStreamProducerCredit
} from './stream.js'
export {
  normalizeRpcCompletion,
  normalizeRpcGroupResult,
  normalizeRpcOutcome,
  normalizeRpcOutcomeStore
} from './completion.js'
export { normalizeMethodSchema } from './method-schema.js'

export { RpcWireLimit, RpcEnvelopeViolation, RpcHandshakeViolation } from './limits.js'

export {
  RpcProviderDeclarationLimit,
  RpcProviderMode,
  RPC_PROVIDER_DECLARATION_METHOD_MAX_CHARS,
  RPC_PROVIDER_DECLARATION_VERSION,
  RPC_PROVIDER_MODES,
  checkRpcProviderDeclaration
} from './provider-declaration.js'
export type {
  IRpcProviderDeclaration,
  IRpcProviderFeatureDeclaration,
  IRpcProviderMethodDeclaration
} from './provider-declaration.js'
export {
  RPC_INVALID_DECLARATION_SEGMENT,
  RPC_PROVIDER_METHOD_MAX_CHARS,
  RPC_PROVIDER_RESERVED_NAMESPACE
} from './limits.js'
export { RuntimeApiMode, RuntimeApiModeSource, REMOTE_NAME_PATTERN } from './limits.js'
export { checkRpcDirectory } from './directory.js'
export { RpcShapeReason, type IRpcShapeCheck } from './schema-diagnostics.js'

export * from './stream-constants.js'
export {
  checkRpcRuntimeStreamTransition,
  checkRpcRuntimeStreamIntent,
  checkRpcRuntimeStreamFinish
} from './stream-validation.js'

export * from './outcome-constants.js'

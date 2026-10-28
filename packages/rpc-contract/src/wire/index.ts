/**
 * Public single-profile contract: immutable data, pure shape admission, and bounded error
 * projection. Executing carriers, host state, optional plugins, and feature implementations are not
 * imported.
 */
export * from './constants.ts'
export type * from './types.ts'
export type { IRpcErrorWireMetadata } from '../contract/types.ts'
export { normalizeRpcFrame, isRpcOperationalFrame } from './envelope.ts'
export {
  normalizeRpcRoute,
  normalizeRpcRemainingMs,
  normalizeRpcTrace,
  normalizeRpcCallOptions,
  normalizeRpcTask,
  normalizeRpcGeneration,
  normalizeRpcSteps,
  normalizeRpcPortable
} from './metadata.ts'
export { normalizeRpcHandshake, acceptRpcHandshake, completeRpcHandshake } from './handshake.ts'
export { normalizeRpcDirectory } from './directory.ts'
export { normalizeRpcWireError, serializeRpcWireError, deserializeRpcWireError } from './errors.ts'
export { normalizeRpcCarrierFrame, normalizeRpcBinaryManifest } from './frame.ts'
export {
  normalizeRpcStream,
  checkRpcStreamInitialSequence,
  checkRpcStreamSequence,
  checkRpcStreamProgress,
  checkRpcStreamConsumerCredit,
  checkRpcStreamProducerCredit
} from './stream.ts'
export {
  normalizeRpcCompletion,
  normalizeRpcGroupResult,
  normalizeRpcOutcome,
  normalizeRpcOutcomeStore
} from './completion.ts'
export { normalizeMethodSchema } from './method-schema.ts'

export { RpcWireLimit, RpcEnvelopeViolation, RpcHandshakeViolation } from './limits.ts'

export {
  RpcProviderDeclarationLimit,
  RpcProviderMode,
  RPC_PROVIDER_DECLARATION_METHOD_MAX_CHARS,
  RPC_PROVIDER_DECLARATION_VERSION,
  RPC_PROVIDER_MODES,
  checkRpcProviderDeclaration
} from './provider-declaration.ts'
export type {
  IRpcProviderDeclaration,
  IRpcProviderFeatureDeclaration,
  IRpcProviderMethodDeclaration
} from './provider-declaration.ts'
export {
  RPC_INVALID_DECLARATION_SEGMENT,
  RPC_PROVIDER_METHOD_MAX_CHARS,
  RPC_PROVIDER_RESERVED_NAMESPACE
} from './limits.ts'
export { RuntimeApiMode, RuntimeApiModeSource, REMOTE_NAME_PATTERN } from './limits.ts'
export { checkRpcDirectory } from './directory.ts'
export { RpcShapeReason, type IRpcShapeCheck } from './schema-diagnostics.ts'

export * from './stream-constants.ts'
export {
  checkRpcRuntimeStreamTransition,
  checkRpcRuntimeStreamIntent,
  checkRpcRuntimeStreamFinish
} from './stream-validation.ts'

export * from './outcome-constants.ts'

export {
  normalizeRuntimeEnvelope,
  normalizeRuntimeEnvelopeDecoded,
  normalizeRuntimeGeneration,
  normalizeRuntimeSteps
} from './normalize.js'
export { readRuntimeCarrier, wrapRuntimeCarrier } from './carrier.js'
export { runtimeOperationCapabilities } from './capabilities.js'
export * from './constants.js'
export type * from './types.js'

/** Canonical control grammar is selected by the public held-message adapter operation. */
export {
  rpcMessageCapabilityControl,
  type IRpcMessageCapabilityControl
} from './message-control.js'

/** The standard byte launch grammar does not grant decoded metadata any resource authority. */
export { rpcByteRuntimeBootstrap, type IRpcByteRuntimeBootstrap } from './byte-bootstrap.js'

export * from './directory-constants.js'
export { checkRuntimeDescription } from './description.js'
export type {
  IRuntimePeerIdentity,
  IRuntimeMethodDescription,
  IRuntimePeerDescription,
  IRuntimeDirectoryDiff
} from './description.js'

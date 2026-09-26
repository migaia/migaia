/** Public adapter-facing transport types. */
export type { IRpcTransport, IRpcSendOptions } from './transport.js'
/** Stable platform and resource ownership values for adapters. */
export { RpcPlatform, RpcTransportOwnership } from './transport-constants.js'
/** Adds core error identity to an adapter's original native error. */
export { tagRpcError } from './errors.js'
/** Listener lifecycle and failure primitives shared by platform adapters. */
export {
  collectListenerCleanupFailures,
  collectListenerFailure,
  createListenerFailure,
  createListenerFailureState,
  drainListenerFailures,
  drainTerminalListenerFailures,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure
} from './internal/listener-safety.js'
/** Shared listener fan-out primitive for adapter subscriptions. */
export { createMessageListenerHub } from './internal/message-listener-hub.js'
/** Safe access and diagnostics for hostile platform event objects. */
export { safeRead, safeString } from './internal/safe-value.js'

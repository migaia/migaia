export type {
  IDisposer,
  ILifecycleOwner,
  ILifecycleState,
  IReleaseContext,
  IReleaseDescriptor,
  ICollectedError,
  IErrorPolicy
} from './types.js'

export type { IDisposerContext } from './disposer-context.js'

export {
  LifecycleState,
  LifecycleErrorPolicy,
  DisposeTransactionKind,
  type IDisposeTransactionKind
} from './state-constants.js'

export { createAbortController, type IAbortController } from './abort.js'

export {
  createSyncStartedDisposalLedger,
  mergeCleanupResults,
  type ICleanupResult,
  type ISyncStartedDisposalLedger,
  type ISyncStartedDisposalOutcome
} from './dispose-transaction.js'

export { LifecycleErrorCode, type ILifecycleErrorCode } from './error-code.js'
export { LifecycleErrorText, type ILifecycleErrorText } from './error-text.js'

export { snapshotScheduler } from './scheduler-entry.js'

export {
  LIFECYCLE_SOURCE,
  containAsyncRejection,
  createErrorCollector,
  type ILifecycleError,
  type IErrorCollector
} from './errors-entry.js'

export { boundedWait } from './bounded-wait.js'
export { abortableDelay } from './abortable-delay.js'

export { createTerminalController, type ITerminalController } from './terminal-controller.js'

export {
  createLifecycleScope,
  type ILifecycleScope,
  type ILifecycleScopeOptions
} from './lifecycle-scope.js'

export {
  createSyncLifecycleScope,
  type ISyncLifecycleScope,
  type ISyncLifecycleScopeOptions,
  type ISyncReleaseDescriptor
} from './sync-lifecycle-scope.js'

export {
  createGenerationController,
  type IGenerationController,
  type IGenerationControllerOptions,
  type IGenerationRequest,
  type IGenerationToken
} from './generation-controller.js'

export {
  createQuiescenceTracker,
  createObjectLeaseRegistry,
  createStringLeaseRegistry,
  createPendingTracker,
  type IQuiescenceTracker,
  type ILeaseRegistry,
  type IPendingTracker
} from './quiescence-tracker.js'

export {
  createProvisionalScope,
  type IProvisionalScope,
  type IProvisionalScopeOptions
} from './provisional-scope.js'

export {
  createMutationQueue,
  type IMutationQueue,
  type IMutationQueueOptions,
  type IEnqueueOptions
} from './mutation-queue.js'

export {
  executeReleaseDescriptor,
  createDisposeTransaction,
  type IDisposeItem,
  type IDisposeTransaction,
  type IDisposeTransactionMode,
  type IDisposeTransactionOptions
} from './dispose-transaction.js'

export type {
  IDisposer,
  ILifecycleOwner,
  ILifecycleState,
  IReleaseContext,
  IReleaseDescriptor,
  ICollectedError,
  IErrorPolicy
} from './types.ts'

export type { IDisposerContext } from './disposer-context.ts'

export {
  LifecycleState,
  LifecycleErrorPolicy,
  DisposeTransactionKind,
  type IDisposeTransactionKind
} from './state-constants.ts'

export { createAbortController, type IAbortController } from './abort.ts'

export {
  createSyncStartedDisposalLedger,
  mergeCleanupResults,
  type ICleanupResult,
  type ISyncStartedDisposalLedger,
  type ISyncStartedDisposalOutcome
} from './dispose-transaction.ts'

export { LifecycleErrorCode, type ILifecycleErrorCode } from './error-code.ts'
export { LifecycleErrorText, type ILifecycleErrorText } from './error-text.ts'

export { snapshotScheduler } from './scheduler-entry.ts'

export {
  LIFECYCLE_SOURCE,
  containAsyncRejection,
  createErrorCollector,
  type ILifecycleError,
  type IErrorCollector
} from './errors-entry.ts'

export { boundedWait } from './bounded-wait.ts'
export { abortableDelay } from './abortable-delay.ts'

export { createTerminalController, type ITerminalController } from './terminal-controller.ts'

export {
  createLifecycleScope,
  type ILifecycleScope,
  type ILifecycleScopeOptions
} from './lifecycle-scope.ts'

export {
  createSyncLifecycleScope,
  type ISyncLifecycleScope,
  type ISyncLifecycleScopeOptions,
  type ISyncReleaseDescriptor
} from './sync-lifecycle-scope.ts'

export {
  createGenerationController,
  type IGenerationController,
  type IGenerationControllerOptions,
  type IGenerationRequest,
  type IGenerationToken
} from './generation-controller.ts'

export {
  createQuiescenceTracker,
  createObjectLeaseRegistry,
  createStringLeaseRegistry,
  createPendingTracker,
  type IQuiescenceTracker,
  type ILeaseRegistry,
  type IPendingTracker
} from './quiescence-tracker.ts'

export {
  createProvisionalScope,
  type IProvisionalScope,
  type IProvisionalScopeOptions
} from './provisional-scope.ts'

export {
  createMutationQueue,
  type IMutationQueue,
  type IMutationQueueOptions,
  type IEnqueueOptions
} from './mutation-queue.ts'

export {
  executeReleaseDescriptor,
  createDisposeTransaction,
  type IDisposeItem,
  type IDisposeTransaction,
  type IDisposeTransactionMode,
  type IDisposeTransactionOptions
} from './dispose-transaction.ts'

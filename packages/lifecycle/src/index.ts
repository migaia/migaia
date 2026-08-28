export type {
  IDisposer,
  ILifecycleOwner,
  ILifecycleState,
  IUnitState,
  IReleaseContext,
  IReleaseDescriptor,
  ICollectedError,
  IErrorPolicy
} from './types.js'
export {
  LifecycleState,
  LifecycleUnitState,
  LifecycleErrorPolicy,
  type ILifecycleStateValue,
  type ILifecycleUnitStateValue,
  type ILifecycleErrorPolicy,
  ThenableProbeKind,
  DisposeTransactionKind,
  type IThenableProbeKind,
  type IDisposeTransactionKind
} from './state-constants.js'

export { createAbortController, type IAbortSignal, type IAbortController } from './abort.js'

export {
  createSyncStartedDisposalLedger,
  type ISyncStartedDisposalLedger,
  type ISyncStartedDisposalOutcome
} from './sync-started-disposal-ledger.js'

export { LifecycleErrorCode, type ILifecycleErrorCode } from './error-code.js'
export { LifecycleErrorText, type ILifecycleErrorText } from './error-text.js'

export {
  systemScheduler,
  snapshotScheduler,
  createManualScheduler,
  validateSchedulerDelay,
  validateSchedulerTime,
  type IScheduledTask,
  type ILifecycleScheduler,
  type ISchedulerSnapshot,
  type IManualScheduler
} from './scheduler.js'

export {
  LIFECYCLE_SOURCE,
  createLifecycleError,
  createLifecycleRangeError,
  tagLifecycleError,
  containAsyncRejection,
  probeThenable,
  assimilateCapturedThen,
  createErrorCollector,
  type ILifecycleError,
  type IThenableProbe,
  type IErrorCollector
} from './errors.js'

export { boundedWait } from './bounded-wait.js'

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
  createLifecycleUnit,
  type ILifecycleUnit,
  type ILifecycleUnitOptions
} from './lifecycle-unit.js'

export {
  createGenerationController,
  type IGenerationController,
  type IGenerationControllerOptions,
  type IGenerationRequest,
  type IGenerationToken
} from './generation-controller.js'

export {
  createQuiescenceTracker,
  createStringQuiescenceTracker,
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

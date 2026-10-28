/** Extension entry owns graph participation without exposing mutable runtime services. */
export {
  claimOwnership,
  ownerOf,
  assertOwnedBy,
  assertReactiveOwnedBy
} from '../runtime/ownership.ts'
export {
  createFieldSource,
  createSourceBinding,
  type IRuntimeFieldSource,
  type IRuntimeSourceBinding
} from '../runtime/source.ts'
export {
  internalRuntimeOf,
  createBatchedOperation,
  isRuntimeTracking,
  isAnyRuntimeTracking,
  currentRuntimeVersion,
  invalidateObservable,
  type IInternalRuntime
} from '../runtime/node-factories.ts'
export {
  createObserverBinding,
  createTrackedObserver,
  type ITrackedObserverBinding,
  type IObserverBinding,
  type IObserverCommitResult,
  type IObserverRetrackResult
} from '../runtime/observer-binding.ts'
export type { ICapture } from '../runtime/dependency-tracker.class.ts'
export type { IObservable, IObserver } from '../runtime/types.ts'

/** Pure adapter imports can defer the default and report through the canonical phase domain. */
export { getDefaultRuntime } from '../runtime/default-runtime-provider.ts'
export { ReactiveErrorPhase } from '../runtime/trace-constants.ts'

export { deferRuntimeCleanup } from '../runtime/deferred-cleanup.ts'

export { createStaticObserver, type IStaticSubscriptionSource } from '../runtime/static-observer.ts'

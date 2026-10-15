/** Extension entry owns graph participation without exposing mutable runtime services. */
export {
  claimOwnership,
  ownerOf,
  assertOwnedBy,
  assertReactiveOwnedBy
} from '../runtime/ownership.js'
export {
  createFieldSource,
  createSourceBinding,
  type IRuntimeFieldSource,
  type IRuntimeSourceBinding
} from '../runtime/source.js'
export {
  internalRuntimeOf,
  isRuntimeTracking,
  isAnyRuntimeTracking,
  currentRuntimeVersion,
  invalidateObservable,
  type IInternalRuntime
} from '../runtime/node-factories.js'
export {
  createObserverBinding,
  createTrackedObserver,
  type ITrackedObserverBinding,
  type IObserverBinding,
  type IObserverCommitResult,
  type IObserverRetrackResult
} from '../runtime/observer-binding.js'
export type { ICapture } from '../runtime/dependency-tracker.class.js'
export type { IObservable, IObserver } from '../runtime/types.js'

/** Pure adapter imports can defer the default and report through the canonical phase domain. */
export { getDefaultRuntime } from '../runtime/default-runtime-provider.js'
export { ReactiveErrorPhase } from '../runtime/trace-constants.js'

export { deferRuntimeCleanup } from '../runtime/deferred-cleanup.js'

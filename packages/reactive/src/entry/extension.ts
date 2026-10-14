/** Extension entry owns graph participation without exposing mutable runtime services. */
export {
  claimOwnership,
  ownerOf,
  assertOwnedBy,
  assertReactiveOwnedBy
} from '../runtime/ownership.js'
export { createFieldSource, type IRuntimeFieldSource } from '../runtime/source.js'
export {
  internalRuntimeOf,
  isRuntimeTracking,
  isAnyRuntimeTracking,
  currentRuntimeVersion,
  type IInternalRuntime
} from '../runtime/node-factories.js'
export {
  createObserverBinding,
  type IObserverBinding,
  type IObserverCommitResult,
  type IObserverRetrackResult
} from '../runtime/observer-binding.js'
export type { ICapture } from '../runtime/dependency-tracker.class.js'
export type { IObservable, IObserver } from '../runtime/types.js'

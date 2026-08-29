import { instantiateCurrentAbortController } from './abort-factory.js'

export {
  observeAbortSubscription,
  type IObservedAbortFailureSink,
  type IObservedAbortSubscription
} from './observed-subscription.js'

/** Structural abort signal consumed by lifecycle owners without importing DOM or Node types. */
export type IAbortSignal = {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

/** Structural controller returned by the public factory. */
export type IAbortController = {
  readonly signal: IAbortSignal
  abort(reason?: unknown): void
}

/** Creates one actual host-native AbortController instance in the current realm. */
export function createAbortController(): IAbortController {
  return instantiateCurrentAbortController()
}

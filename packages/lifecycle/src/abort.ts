import type { IAbortSignal } from '@migaia/utils/promise'
import { instantiateCurrentAbortController } from './abort-factory.js'

export {
  observeAbortSubscription,
  type IObservedAbortFailureSink,
  type IObservedAbortSubscription
} from './observed-subscription.js'

/** Structural controller returned by the public factory. */
export type IAbortController = {
  readonly signal: IAbortSignal
  abort(reason?: unknown): void
}

/** Creates one actual host-native AbortController instance in the current realm. */
export function createAbortController(): IAbortController {
  return instantiateCurrentAbortController()
}

import type { INativeAbortSignal } from '@migaia/utils/promise'
import { instantiateCurrentAbortController } from './abort-factory.ts'

export {
  observeAbortSubscription,
  type IObservedAbortFailureSink,
  type IObservedAbortSubscription
} from './observed-subscription.ts'

/** Structural controller returned by the public factory. */
export type IAbortController = {
  readonly signal: INativeAbortSignal
  abort(reason?: unknown): void
}

/** Creates one actual host-native AbortController instance in the current realm. */
export function createAbortController(): IAbortController {
  return instantiateCurrentAbortController()
}

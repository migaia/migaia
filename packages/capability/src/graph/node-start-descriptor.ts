/**
 * Adapts auxiliary descriptor ordering and callback guards; lifecycle still owns descriptor
 * admission.
 */
import type { IReleaseContext, IReleaseDescriptor } from '@migaia/lifecycle'

/** Reentry boundary supplied by the graph transaction owner. */
type IInvokeCallback = <T, A>(callback: (argument: A) => T, argument: A) => T

/** Owns one lazy descriptor view, retaining original getter read timing. */
class OrderedAuxiliaryDescriptor {
  /** Caller descriptor is read only when lifecycle requests a field. */
  #descriptor: IReleaseDescriptor
  /** Graph canonical rank overrides resource-local release rank. */
  #order: number
  /** Graph guards user lifecycle callbacks against same-stack reentry. */
  #invokeCallback: IInvokeCallback

  /** Retains descriptor references without evaluating any caller getter. */
  constructor(descriptor: IReleaseDescriptor, order: number, invokeCallback: IInvokeCallback) {
    this.#descriptor = descriptor
    this.#order = order
    this.#invokeCallback = invokeCallback
  }

  /** Preserves the original descriptor's synchronous-release declaration. */
  get syncSafe() {
    return this.#descriptor.syncSafe
  }
  /** Uses topology release order independent of asynchronous start completion. */
  get order() {
    return this.#order
  }
  /** Captures graceful cleanup once when lifecycle admits the descriptor. */
  get graceful() {
    return this.#guard(this.#descriptor.graceful)
  }
  /** Preserves lifecycle's own graceful timeout interpretation. */
  get gracefulTimeoutMs() {
    return this.#descriptor.gracefulTimeoutMs
  }
  /** Captures force cleanup once when lifecycle admits the descriptor. */
  get force() {
    return this.#guard(this.#descriptor.force)
  }
  /** Preserves lifecycle's own fallback policy interpretation. */
  get gcFallback() {
    return this.#descriptor.gcFallback
  }
  /** Captures custom cleanup once when lifecycle admits the descriptor. */
  get custom() {
    return this.#guard(this.#descriptor.custom)
  }

  /** Wraps only callable hooks; invalid values still reach canonical lifecycle validation. */
  #guard<T extends ((context: IReleaseContext) => unknown) | undefined>(callback: T): T {
    return (
      typeof callback === 'function'
        ? (context: IReleaseContext) => this.#invokeCallback(callback, context)
        : callback
    ) as T
  }
}

/** Builds the lazy ordering view; no lifecycle ownership, queue or rollback is duplicated. */
export function orderedAuxiliaryDescriptor(
  descriptor: IReleaseDescriptor,
  order: number,
  invokeCallback: IInvokeCallback
): IReleaseDescriptor {
  return new OrderedAuxiliaryDescriptor(descriptor, order, invokeCallback) as IReleaseDescriptor
}

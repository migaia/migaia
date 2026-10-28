/** Owns retry context mechanics; public API admission stays in promise.ts. */

import type {
  IAbortSignal,
  INativeAbortSignal,
  IRetryContext,
  IRetryFailureContext
} from './promise-contract.ts'
import { acknowledgesCancellation, type IAbortControllerLike } from './promise-abort.ts'

/**
 * Attempt cancellation owner for `retry`. The host `AbortController` is allocated only when some
 * code reads `signal`, so an attempt that never looks at its signal costs no controller. An abort
 * before allocation is recorded and replayed onto the controller when it is created, so a late
 * reader still sees an aborted signal with the original reason.
 */
export class LazyAbortController implements IAbortControllerLike {
  /** Host controller, created on the first `signal` read. */
  #controller: AbortController | undefined
  /** Whether `abort` ran before the controller existed. */
  #aborted = false
  /** Reason recorded by an abort that ran before the controller existed. */
  #reason: unknown

  /** Returns the attempt signal, allocating the controller and replaying a recorded abort. */
  get signal(): INativeAbortSignal {
    if (this.#controller === undefined) {
      this.#controller = new AbortController()
      if (this.#aborted) this.#controller.abort(this.#reason)
    }
    return this.#controller.signal as unknown as INativeAbortSignal
  }

  /** Whether `error` only acknowledges this attempt's cancellation (its exact abort reason). */
  acknowledges(error: unknown): boolean {
    if (this.#controller !== undefined)
      return acknowledgesCancellation(error, this.#controller.signal as unknown as IAbortSignal)
    return this.#aborted && Object.is(error, this.#reason)
  }

  /** Aborts the attempt; like the native controller, only the first call has an effect. */
  abort(reason?: unknown): void {
    if (this.#controller !== undefined) {
      this.#controller.abort(reason)
      return
    }
    if (this.#aborted) return
    this.#aborted = true
    this.#reason = reason
  }
}

/**
 * Context one attempt receives. `signal` is a prototype getter, so the host controller is created
 * only when the operation reads it; `attempt` and `remainingMs` are own data properties.
 */
export class RetryAttemptContext implements IRetryContext {
  /** 1-based attempt number. */
  readonly attempt: number
  /** Remaining total budget at the attempt start, when a total deadline is set. */
  readonly remainingMs: number | undefined
  /** Lazy cancellation owner of this attempt. */
  readonly #owner: LazyAbortController

  /** Captures the attempt facts. */
  constructor(owner: LazyAbortController, attempt: number, remainingMs: number | undefined) {
    this.#owner = owner
    this.attempt = attempt
    this.remainingMs = remainingMs
  }

  /** The attempt signal, allocated on first read. */
  get signal(): INativeAbortSignal {
    return this.#owner.signal
  }
}

/** Context shared by `shouldRetry`, `beforeRetry` and `delay` after one failure. */
export class RetryFailureContext implements IRetryFailureContext {
  /** 1-based number of the failed attempt. */
  readonly attempt: number
  /** Configured attempt limit. */
  readonly maxAttempts: number
  /** Lazy cancellation owner of the failed attempt. */
  readonly #owner: LazyAbortController

  /** Captures the failure facts. */
  constructor(owner: LazyAbortController, attempt: number, maxAttempts: number) {
    this.#owner = owner
    this.attempt = attempt
    this.maxAttempts = maxAttempts
  }

  /** The failed attempt's signal, allocated on first read. */
  get signal(): INativeAbortSignal {
    return this.#owner.signal
  }
}

/** Owns repeat control state and its existing native resource lifetime. */

import { tryReadProperty, UtilsAbortError } from '../error.ts'
import { reportUnhandledError } from '../host-report.ts'
import type { IAbortSignal } from './promise-contract.ts'

import { type IScheduledTask, type IScheduler } from './scheduler.ts'
import type { IRepeatContext, IRepeatOptions, IRepeatHandle } from './rate-contract.ts'
import {
  MAXIMUM_DELAY,
  argumentError,
  admitFunction,
  admitWait,
  admitSignal,
  admitScheduler
} from './rate-admission.ts'

/** One non-overlapping repetition owns its clock position, pending timer and completion receipt. */
export class RepeatingTask {
  /** User code is called once per admitted iteration. */
  #task: (context: IRepeatContext) => unknown
  /** Validated period determines the next drift-corrected start. */
  #period: number
  /** Scheduler owns actual timer registration. */
  #scheduler: IScheduler
  /** External cancellation stops this loop without replacing the iteration signal. */
  #signal: IAbortSignal | undefined
  /** Existing iteration cap may be unbounded. */
  #maxIterations: number
  /** Failure policy is captured before the first iteration. */
  #stopOnError: boolean
  /** Each admitted iteration receives this same cooperative signal. */
  #controller: AbortController
  /** Completed iterations determine the next public iteration index. */
  #iteration = 0
  /** Terminal admission fences future schedules. */
  #running = true
  /** Absolute planned start is advanced before invoking user code. */
  #nextDue: number
  /** The single pending timer belongs to this loop. */
  #timer: IScheduledTask | undefined
  /** Normal stop settles the original completion promise. */
  #resolveDone!: () => void
  /** Stop-on-error rejects with the original thrown value. */
  #rejectDone!: (error: unknown) => void
  /** The public receipt exposes no mutable state authority. */
  readonly handle: IRepeatHandle

  /** Preserve validation and option-read order before timer/subscription admission. */
  constructor(
    task: (context: IRepeatContext) => unknown,
    interval: number,
    options: IRepeatOptions
  ) {
    admitFunction(task, 'task')
    this.#period = admitWait(interval, 'interval')
    this.#scheduler = admitScheduler(options.scheduler)
    this.#signal = admitSignal(options.signal)
    this.#maxIterations = options.maxIterations ?? Number.POSITIVE_INFINITY
    if (
      typeof this.#maxIterations !== 'number' ||
      Number.isNaN(this.#maxIterations) ||
      this.#maxIterations < 0
    )
      throw argumentError(RangeError, 'maxIterations', 'a non-negative number')
    if (
      options.onError !== undefined &&
      options.onError !== 'stop' &&
      options.onError !== 'continue'
    )
      throw argumentError(TypeError, 'onError', "'stop' or 'continue'")
    this.#stopOnError = options.onError !== 'continue'
    this.#controller = new AbortController()
    this.#task = task
    this.#nextDue = this.#scheduler.now() + (options.immediate ? 0 : this.#period)
    /** Completion is allocated before subscriptions may synchronously stop the loop. */
    const done = new Promise<void>((resolve, reject) => {
      this.#resolveDone = resolve
      this.#rejectDone = reject
    })
    if (this.#signal?.aborted) this.#finish()
    else {
      this.#signal?.addEventListener('abort', this.#onExternalAbort, { once: true })
      this.#scheduleNext()
    }
    /** The receipt exposes a live getter without sharing component state through a factory scope. */
    const handle = {
      stop: this.#onExternalAbort,
      done,
      [Symbol.dispose]: this.#onExternalAbort
    } as IRepeatHandle
    Object.defineProperty(handle, 'running', {
      get: () => this.#running,
      enumerable: true,
      configurable: true
    })
    this.handle = Object.freeze(handle)
  }

  /** Ends the loop and settles `done`. */
  #finish = (error?: { readonly value: unknown }): void => {
    if (!this.#running) return
    this.#running = false
    this.#timer?.cancel()
    this.#timer = undefined
    this.#controller.abort(new UtilsAbortError())
    this.#signal?.removeEventListener('abort', this.#onExternalAbort)
    if (error) this.#rejectDone(error.value)
    else this.#resolveDone()
  }
  /** External abort stops the loop. */
  #onExternalAbort = (): void => this.#finish()
  /** Schedules the next iteration at its drift-corrected time. */
  #scheduleNext = (): void => {
    if (!this.#running) return
    if (this.#iteration >= this.#maxIterations) {
      this.#finish()
      return
    }
    /** Current clock reading. */
    const now = this.#scheduler.now()
    if (this.#nextDue < now) this.#nextDue = now
    this.#timer = this.#scheduler.schedule(this.#tick, Math.min(MAXIMUM_DELAY, this.#nextDue - now))
  }
  /** Runs one iteration and schedules the next after it settles. */
  #tick = (): void => {
    this.#timer = undefined
    if (!this.#running) return
    /** Context for this iteration. */
    const context: IRepeatContext = Object.freeze({
      iteration: this.#iteration,
      signal: this.#controller.signal
    })
    this.#nextDue += this.#period
    /** Synchronous result or thenable of the iteration. */
    let result: unknown
    try {
      result = Reflect.apply(this.#task, undefined, [context])
    } catch (error) {
      this.#fail(error)
      this.#after()
      return
    }
    /** Guarded `then` read; a hostile getter is an iteration failure. */
    const then = tryReadProperty(
      (result !== null && (typeof result === 'object' || typeof result === 'function')
        ? result
        : {}) as { then?: unknown },
      'then'
    )
    if (then.threw) {
      this.#fail(then.error)
      this.#after()
    } else if (typeof then.value === 'function')
      Promise.resolve(result as PromiseLike<unknown>).then(this.#after, this.#onRejected)
    else this.#after()
  }

  /** A rejected asynchronous iteration follows the same failure then continuation order. */
  readonly #onRejected = (error: unknown): void => {
    this.#fail(error)
    this.#after()
  }

  /** Handle one iteration failure under the original stop/continue reporting policy. */
  #fail(error: unknown): void {
    if (!this.#running) return
    if (this.#stopOnError) this.#finish({ value: error })
    else reportUnhandledError(error)
  }
  /** Continue only after the current iteration settles. */
  #after = (): void => {
    this.#iteration++
    this.#scheduleNext()
  }
}

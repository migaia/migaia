/** Owns one pending readiness observer; stable supervisor facts and caller abort remove its records. */
import { ABORT_EVENT } from './text.js'
import type { IAbortSignal } from '@migaia/utils/promise'
import { readyNow } from './supervisor-events.js'
import type { ISupervisorContext } from './supervisor-context.js'
import type { ILaunchContext, IReadyOutcome, IUnitHandle } from './types.js'

/** Allocated only when readiness cannot answer synchronously. */
export class ReadinessWaiter<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
> {
  /** The observer reads current facts without entering the command queue. */
  #context: ISupervisorContext<TSpec, THandle, TExit, TContext>
  /** Caller cancellation affects only this observer, never the supervisor. */
  #signal: IAbortSignal | undefined
  /** Stable settlement callbacks belong to the exact Promise returned to the caller. */
  #resolve!: (outcome: IReadyOutcome<THandle>) => void
  /** Abort rejects with the caller's original reason. */
  #reject!: (reason: unknown) => void
  /** Set membership uses one callback identity until settlement. */
  #wakeCallback = (): void => this.#wake()
  /** The same listener identity is removed on either settlement path. */
  #abortCallback = (): void => this.#abort()
  /** Public only within this internal abstraction, preserving the original observer Promise. */
  readonly promise: Promise<IReadyOutcome<THandle>>

  /** Registers synchronously inside the original Promise executor and checks readiness once. */
  constructor(context: ISupervisorContext<TSpec, THandle, TExit, TContext>, signal?: IAbortSignal) {
    this.#context = context
    this.#signal = signal
    this.promise = new Promise<IReadyOutcome<THandle>>((resolve, reject) =>
      this.#start(resolve, reject)
    )
  }

  /** Promise executor registration remains synchronous and does not insert a microtask. */
  #start(
    resolve: (outcome: IReadyOutcome<THandle>) => void,
    reject: (reason: unknown) => void
  ): void {
    this.#resolve = resolve
    this.#reject = reject
    this.#context.waiters.add(this.#wakeCallback)
    this.#signal?.addEventListener(ABORT_EVENT, this.#abortCallback, { once: true })
    this.#wake()
  }

  /** A stable answer removes both registrations before fulfilling the observer. */
  #wake(): void {
    /** Readiness is a current snapshot, never a retained launch outcome. */
    const answer = readyNow(this.#context)
    if (!answer) return
    this.#context.waiters.delete(this.#wakeCallback)
    this.#signal?.removeEventListener(ABORT_EVENT, this.#abortCallback)
    this.#resolve(answer)
  }

  /** Abort cleanup precedes rejection with the original signal reason. */
  #abort(): void {
    this.#context.waiters.delete(this.#wakeCallback)
    this.#signal?.removeEventListener(ABORT_EVENT, this.#abortCallback)
    this.#reject(this.#signal?.reason)
  }
}

/** Owns coalesce control state and its existing native resource lifetime. */

import { reportUnhandledError } from '../host-report.ts'

import { asyncTask, type AsyncTaskStrategy } from './async-task.ts'

import type { ICoalescedFunction } from './rate-contract.ts'
import { admitFunction } from './rate-admission.ts'

/** One coalesced batch owns pending calls and its sole scheduled delivery. */
export class CoalescedFunction<A extends unknown[]> {
  /** User callback receives a frozen batch as a plain function call. */
  #fn: (calls: readonly A[]) => void
  /** Caller-selected queue/fallback policy is retained by identity. */
  #strategy: AsyncTaskStrategy | readonly AsyncTaskStrategy[]
  /** A fresh queue collects reentrant calls during delivery. */
  #queue: A[] = []
  /** This controller cancels only the pending delivery. */
  #scheduled: AbortController | undefined
  /** Frozen callable retains the public size getter. */
  readonly coalesced: ICoalescedFunction<A>

  /** Admit the callback before publishing its callable receipt. */
  constructor(
    fn: (calls: readonly A[]) => void,
    strategy: AsyncTaskStrategy | readonly AsyncTaskStrategy[]
  ) {
    admitFunction(fn, 'fn')
    this.#fn = fn
    this.#strategy = strategy
    /** Methods and size reflect the same queue owner. */
    const coalesced = this.#call as ICoalescedFunction<A>
    coalesced.flush = this.#flush
    coalesced.cancel = this.#cancel
    Object.defineProperty(coalesced, 'size', { get: () => this.#queue.length, enumerable: true })
    this.coalesced = Object.freeze(coalesced)
  }
  /** Swap the batch before user code so reentrant calls cannot enter the delivered array. */
  #deliver = (): void => {
    this.#scheduled = undefined
    /** One immutable batch preserves original call order. */
    const calls = this.#queue
    this.#queue = []
    if (calls.length > 0) Reflect.apply(this.#fn, undefined, [Object.freeze(calls)])
  }
  /** Schedule at most one delivery for the current queue. */
  #call = (...args: A): void => this.#enqueue(args)

  /** Commit one call and install the batch registration only when the queue was idle. */
  #enqueue(args: A): void {
    this.#queue.push(args)
    if (this.#scheduled) return
    /** The error observer distinguishes this owner's expected cancellation. */
    const controller = new AbortController()
    this.#scheduled = controller
    asyncTask(this.#strategy, this.#deliver, { signal: controller.signal }).then(
      undefined,
      (error: unknown) => {
        if (!controller.signal.aborted) reportUnhandledError(error)
      }
    )
  }
  /** Flush still delivers calls queued after a prior scheduled delivery was cancelled. */
  #flush = (): void => {
    this.#scheduled?.abort()
    this.#deliver()
  }
  /** Cancellation drops the batch without invoking user code. */
  #cancel = (): void => {
    this.#scheduled?.abort()
    this.#scheduled = undefined
    this.#queue = []
  }
}

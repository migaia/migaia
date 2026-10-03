import { RpcCoreErrorText } from '../error-text.js'
import {
  createGenerationController,
  type IGenerationController,
  type IGenerationToken
} from '@migaia/lifecycle'
import { RpcLifecycleError, RpcTimeoutError } from '../errors.js'
import type { IAbortSignal } from './async-control.js'

/**
 * Owns one public operation's deadline and cancellation signal.
 *
 * The per-operation `AbortSignal` and its parent closing-signal linkage are owned by
 * `@migaia/lifecycle`'s `GenerationController` (migration.sdd.md §3.2: the "generation + deadline +
 * parent closing signal" invariant belongs to the core). The remaining-budget computation and the
 * endpoint's external receive-generation check stay here — they are web-rpc domain concerns the
 * controller does not model (the controller's own generation is an internal supersession counter,
 * not the endpoint's monotonic receive generation).
 */
export class OperationScope {
  readonly signal: IAbortSignal
  /** Owns the operation's AbortSignal and parent closing-signal linkage. */
  readonly #controller: IGenerationController
  /** Matches completion to this scope's admission, never a later generation. */
  readonly #token: IGenerationToken
  /** Endpoint receive generation whose work this scope can still commit. */
  readonly #generation: number
  /** Absolute deadline used to preserve the caller's single total timeout budget. */
  readonly #deadlineAt: number | undefined
  /** Endpoint clock shared with the operation timer. */
  readonly #now: () => number
  /** Prevents repeated cancellation/completion and rejects later work on this scope. */
  #closed = false
  /** Set only after pending success cleanup; actual scope release stays in the original finally. */
  #succeeded = false

  /** Admits one operation through lifecycle's canonical generation owner and closing signal. */
  constructor(
    generation: number,
    timeoutMs: number | false | undefined,
    closingSignal: IAbortSignal,
    now: () => number
  ) {
    this.#generation = generation
    this.#now = now
    this.#deadlineAt =
      timeoutMs === undefined || timeoutMs === false ? undefined : now() + timeoutMs
    this.#controller = createGenerationController({ parentSignal: closingSignal })
    /** Keep the token and signal from the same canonical admission. */
    const request = this.#controller.begin()
    this.#token = request.token
    this.signal = request.signal
  }

  /** Returns the remaining operation budget, preserving false as unlimited. */
  remaining(timeoutMs: number | false | undefined): number | false | undefined {
    if (this.#deadlineAt === undefined) return timeoutMs
    return Math.max(0, this.#deadlineAt - this.#now())
  }

  /** Rejects work that crossed disposal or operation cancellation. */
  assertActive(currentGeneration: number): void {
    if (this.#closed || this.signal.aborted || currentGeneration !== this.#generation)
      throw new RpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    if (this.#deadlineAt !== undefined && this.#deadlineAt <= this.#now())
      throw new RpcTimeoutError()
  }

  /** Cancels the scope and releases its closing listener. */
  abort(reason?: unknown): void {
    if (this.#closed) return
    this.#closed = true
    this.#controller.supersede(reason)
  }

  /** Marks ordinary success after pending cleanup and before resolving the existing promise. */
  markSuccess(): void {
    this.#succeeded = true
  }

  /** Runs in the existing finally reaction, choosing success release or original cancellation. */
  finish(): void {
    if (!this.#succeeded) {
      this.abort()
      return
    }
    if (this.#closed) return
    this.#closed = true
    this.#controller.complete(this.#token)
  }
}

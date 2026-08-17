import { createGenerationController, type IGenerationController } from '@migaia/lifecycle';
import { WebRpcLifecycleError, WebRpcTimeoutError } from '../errors.js';
import type { IAbortSignal } from './async-control.js';

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
  readonly signal: IAbortSignal;
  /** Owns the operation's AbortSignal and parent closing-signal linkage. */
  readonly #controller: IGenerationController;
  readonly #generation: number;
  readonly #deadlineAt: number | undefined;
  #closed = false;

  constructor(
    generation: number,
    timeoutMs: number | false | undefined,
    closingSignal: IAbortSignal
  ) {
    this.#generation = generation;
    this.#deadlineAt =
      timeoutMs === undefined || timeoutMs === false ? undefined : Date.now() + timeoutMs;
    this.#controller = createGenerationController({ parentSignal: closingSignal });
    this.signal = this.#controller.begin().signal;
  }

  /** Returns the remaining operation budget, preserving false as unlimited. */
  remaining(timeoutMs: number | false | undefined): number | false | undefined {
    if (this.#deadlineAt === undefined) return timeoutMs;
    return Math.max(0, this.#deadlineAt - Date.now());
  }

  /** Rejects work that crossed disposal or operation cancellation. */
  assertActive(currentGeneration: number): void {
    if (this.#closed || this.signal.aborted || currentGeneration !== this.#generation)
      throw new WebRpcLifecycleError('Endpoint disposed');
    if (this.#deadlineAt !== undefined && this.#deadlineAt <= Date.now())
      throw new WebRpcTimeoutError();
  }

  /** Cancels the scope and releases its closing listener. */
  abort(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#controller.supersede();
  }
}

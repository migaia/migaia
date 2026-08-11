import { WebRpcLifecycleError, WebRpcTimeoutError } from '../errors';
import type { IAbortSignal } from './async-control';

/** Owns one public operation's generation, deadline and cancellation signal. */
export class OperationScope {
  readonly signal: IAbortSignal;
  readonly #controller = new AbortController();
  readonly #generation: number;
  readonly #deadlineAt: number | undefined;
  readonly #closingSignal: IAbortSignal;
  readonly #onClosingAbort = (): void => this.abort();
  #closed = false;

  constructor(
    generation: number,
    timeoutMs: number | false | undefined,
    closingSignal: IAbortSignal
  ) {
    this.#generation = generation;
    this.#closingSignal = closingSignal;
    this.#deadlineAt =
      timeoutMs === undefined || timeoutMs === false ? undefined : Date.now() + timeoutMs;
    this.signal = this.#controller.signal;
    if (closingSignal.aborted) this.abort();
    else closingSignal.addEventListener('abort', this.#onClosingAbort, { once: true });
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
    this.#controller.abort();
    this.#closingSignal.removeEventListener('abort', this.#onClosingAbort);
  }
}

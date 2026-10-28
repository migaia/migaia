/** Owns async task settlement mechanics; strategy selection remains at the public entry. */
import type { IAbortSignal } from './promise-contract.ts'
import type {
  AsyncTaskStrategy,
  IAsyncTaskContext,
  IConcreteAsyncTaskStrategy
} from './async-task-contract.ts'
import { tryReadProperty, UtilsAbortError } from '../error.ts'
import { dispatch } from './async-task-dispatch.ts'

/** Own one scheduled callback's admission, cancellation and settlement. */
export class ScheduledCallback<S extends AsyncTaskStrategy, R> {
  /** Callback start and prior cancellation share the original single terminal transition. */
  #settled = false
  /** The admitted user function is invoked with its original plain receiver. */
  #callback: (context: IAsyncTaskContext<S>) => R | PromiseLike<R>
  /** The original structural signal owns cancellation only before callback start. */
  #signal: IAbortSignal | undefined
  /** The dispatch owner returns the exact host registration cancellation receipt. */
  #cancel!: () => void
  /** Native settlement preserves user values, thenables and thrown reason identity. */
  #resolve!: (value: Awaited<R> | PromiseLike<Awaited<R>>) => void
  /** Registration and callback failures keep their original rejection object. */
  #reject!: (reason?: unknown) => void
  /** Callers observe the one native result Promise for this registration. */
  readonly promise: Promise<Awaited<R>>
  /** Register only after synchronous validation and initial abort observation succeed. */
  constructor(
    concrete: IConcreteAsyncTaskStrategy,
    callback: (context: IAsyncTaskContext<S>) => R | PromiseLike<R>,
    delay: number,
    idleTimeout: number | undefined,
    signal: IAbortSignal | undefined
  ) {
    this.#callback = callback
    this.#signal = signal
    this.promise = new Promise<Awaited<R>>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
      this.#cancel = dispatch(concrete, this.#run, delay, idleTimeout)
      signal?.addEventListener('abort', this.#onAbort, { once: true })
    })
  }
  /** Abort before callback start cancels the same host registration and retains its reason. */
  #onAbort = (): void => {
    if (this.#settled) return
    this.#settled = true
    this.#cancel()
    /** The signal's reason getter is observed once and its failure remains reachable. */
    const reason = tryReadProperty(this.#signal as { reason?: unknown }, 'reason')
    this.#reject(new UtilsAbortError(reason.threw ? reason.error : reason.value))
  }
  /** Callback start retires cancellation before adopting the original user outcome. */
  #run = (context: Record<string, unknown>): void => {
    if (this.#settled) return
    this.#settled = true
    this.#signal?.removeEventListener('abort', this.#onAbort)
    try {
      /** Reading the function into a local preserves its original unbound invocation. */
      const callback = this.#callback
      this.#resolve(callback(context as IAsyncTaskContext<S>) as Awaited<R>)
    } catch (error) {
      this.#reject(error)
    }
  }
}

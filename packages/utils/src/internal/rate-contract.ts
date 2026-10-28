/** Canonical rate type and value contracts; implementations depend inward on this module. */
import type { IAbortSignal } from './promise-contract.ts'
import type { IScheduler } from './scheduler-contract.ts'

/**
 * Wrapped function returned by `debounce` / `throttle`. Calls return nothing; read the latest
 * result from `flush()`.
 */
export type IControlledFunction<F extends (...args: never[]) => unknown> = ((
  ...args: Parameters<F>
) => void) & {
  /** Drops the pending invocation. */
  cancel(): void
  /** Runs the pending invocation now and returns its result (or the last result when idle). */
  flush(): ReturnType<F> | undefined
  /** Whether an invocation is pending. */
  pending(): boolean
  /** Same as `cancel()`, for `using`. */
  [Symbol.dispose](): void
}

/** Options for `debounce()`. */
export type IDebounceOptions = {
  /** Invoke on the leading edge of a burst. Defaults to `false`. */
  readonly leading?: boolean
  /** Invoke on the trailing edge of a burst. Defaults to `true`. */
  readonly trailing?: boolean
  /** Upper bound in milliseconds a burst may delay an invocation. */
  readonly maxWait?: number
  /** Cancels permanently; later calls are ignored. */
  readonly signal?: IAbortSignal
  /** Timer source; defaults to `systemScheduler`. Inject `createManualScheduler()` in tests. */
  readonly scheduler?: IScheduler
}

/** Options for `throttle()`. */
export type IThrottleOptions = Omit<IDebounceOptions, 'maxWait'>

/** Batched function returned by `coalesce()`. */
export type ICoalescedFunction<A extends unknown[]> = ((...args: A) => void) & {
  /** Delivers the queued calls now. */
  flush(): void
  /** Drops the queued calls. */
  cancel(): void
  /** Number of queued calls. */
  readonly size: number
}

/** Context of one `repeat()` iteration. */
export type IRepeatContext = {
  /** Zero-based iteration number. */
  readonly iteration: number
  /** Aborted when the loop stops; pass it to `fetch` and other cancellable work. */
  readonly signal: IAbortSignal
}

/** Options for `repeat()`. */
export type IRepeatOptions = {
  /** Stops the loop like `stop()`. */
  readonly signal?: IAbortSignal
  /** Run the first iteration right away instead of after one interval. Defaults to `false`. */
  readonly immediate?: boolean
  /** Stop after this many iterations. Defaults to unlimited. */
  readonly maxIterations?: number
  /**
   * `stop` (default): a failing iteration stops the loop and rejects `done` with the original
   * error. `continue`: the error is reported to the host and the loop keeps going.
   */
  readonly onError?: 'stop' | 'continue'
  /** Timer source; defaults to `systemScheduler`. */
  readonly scheduler?: IScheduler
}

/** Handle of a running `repeat()` loop. */
export type IRepeatHandle = {
  /** Stops the loop; idempotent. A running iteration finishes, but no new one starts. */
  stop(): void
  /** Resolves when the loop stops normally; rejects with the failing error under `onError: 'stop'`. */
  readonly done: Promise<void>
  /** Whether the loop is still running. */
  readonly running: boolean
  /** Same as `stop()`, for `using`. */
  [Symbol.dispose](): void
}

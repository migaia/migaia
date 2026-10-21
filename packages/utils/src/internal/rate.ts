/**
 * Call-rate controls built on the shared `IScheduler` contract: `debounce`, `throttle`, `coalesce`
 * and the non-overlapping `repeat` loop. Timer-driven invocations have no caller to throw to, so
 * their failures go to the host's uncaught-error queue instead of being dropped.
 */
import { UtilsErrorCode } from '../error-code.js'
import { UtilsErrorText } from '../error-text.js'
import { attachErrorIdentity, tryReadProperty, UtilsAbortError } from '../error.js'
import { reportUnhandledError } from '../host-report.js'
import type { IAbortSignal } from '../promise.js'
import { asyncTask, type AsyncTaskStrategy } from './async-task.js'
import { systemScheduler, type IScheduledTask, type IScheduler } from './scheduler.js'

/** Largest wait host timers accept without overflowing. */
const MAXIMUM_DELAY = 2_147_483_647

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

/** Creates a coded `INVALID_ARGUMENT` error of the given native type. */
function argumentError(
  Constructor: TypeErrorConstructor | RangeErrorConstructor,
  field: string,
  expectation: string
): Error {
  return attachErrorIdentity(new Constructor(UtilsErrorText.invalidArgument(field, expectation)), {
    source: '@migaia/utils',
    code: UtilsErrorCode.invalidArgument
  })
}

/** Validates a callback argument. */
function admitFunction(value: unknown, field: string): void {
  if (typeof value !== 'function')
    throw argumentError(TypeError, field, UtilsErrorText.functionExpectation)
}

/** Validates a wait-like argument. */
function admitWait(value: unknown, field: string): number {
  if (typeof value !== 'number')
    throw argumentError(TypeError, field, UtilsErrorText.delayExpectation)
  if (!Number.isFinite(value) || value < 0 || value > MAXIMUM_DELAY)
    throw argumentError(RangeError, field, UtilsErrorText.delayExpectation)
  return value
}

/** Validates an optional structural abort signal. */
function admitSignal(value: unknown): IAbortSignal | undefined {
  if (value === undefined) return undefined
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as IAbortSignal).addEventListener !== 'function' ||
    typeof (value as IAbortSignal).aborted !== 'boolean'
  )
    throw argumentError(TypeError, 'signal', 'an AbortSignal')
  return value as IAbortSignal
}

/** Validates an optional scheduler. */
function admitScheduler(value: unknown): IScheduler {
  if (value === undefined) return systemScheduler
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as IScheduler).schedule !== 'function' ||
    typeof (value as IScheduler).now !== 'function'
  )
    throw argumentError(TypeError, 'scheduler', 'an IScheduler')
  return value as IScheduler
}

/**
 * Delays `fn` until `wait` milliseconds pass without another call. `leading` invokes at the start
 * of a burst, `trailing` (default) at its end, and `maxWait` caps how long a continuous burst may
 * postpone an invocation.
 *
 * Errors from leading calls and `flush()` throw to the caller; errors from timer-driven trailing
 * calls are reported to the host.
 *
 * @example
 *   ;```ts
 *   const save = debounce((draft: string) => api.save(draft), 500, { maxWait: 5000 })
 *   input.addEventListener('input', () => save(input.value))
 *   ```
 */
export function debounce<F extends (...args: never[]) => unknown>(
  fn: F,
  wait: number,
  options: IDebounceOptions = {}
): IControlledFunction<F> {
  admitFunction(fn, 'fn')
  /** Validated inputs. */
  const delay = admitWait(wait, 'wait')
  const maxWait = options.maxWait === undefined ? undefined : admitWait(options.maxWait, 'maxWait')
  const leading = options.leading === true
  const trailing = options.trailing !== false
  const scheduler = admitScheduler(options.scheduler)
  const signal = admitSignal(options.signal)
  /** Arguments of the latest call not yet delivered. */
  let pendingArgs: Parameters<F> | undefined
  /** Result of the last invocation, returned by an idle `flush()`. */
  let lastResult: ReturnType<F> | undefined
  /** Quiet-period timer; its presence means a burst is active. */
  let waitTask: IScheduledTask | undefined
  /** `maxWait` timer for the current burst. */
  let maxTask: IScheduledTask | undefined
  /** Set permanently by abort. */
  let disposed = false
  /** Invokes with the pending arguments and clears them. */
  const invoke = (): ReturnType<F> | undefined => {
    /** Arguments consumed by this invocation. */
    const args = pendingArgs
    pendingArgs = undefined
    if (args === undefined) return lastResult
    lastResult = fn(...args) as ReturnType<F>
    return lastResult
  }
  /** Timer-driven invocation; there is no caller, so failures are reported. */
  const invokeFromTimer = (): void => {
    try {
      invoke()
    } catch (error) {
      reportUnhandledError(error)
    }
  }
  /** Ends the burst and clears both timers. */
  const clearTimers = (): void => {
    waitTask?.cancel()
    maxTask?.cancel()
    waitTask = undefined
    maxTask = undefined
  }
  /** Quiet period elapsed. */
  const onWait = (): void => {
    waitTask = undefined
    maxTask?.cancel()
    maxTask = undefined
    if (trailing) invokeFromTimer()
    else pendingArgs = undefined
  }
  /** `maxWait` elapsed during a continuous burst. */
  const onMaxWait = (): void => {
    maxTask = undefined
    // The next call of a still-running burst arms a fresh maxWait window.
    if (pendingArgs !== undefined) invokeFromTimer()
  }
  /** Public wrapper. */
  const controlled = ((...args: Parameters<F>): void => {
    if (disposed) return
    /** Whether this call starts a new burst. */
    const idle = waitTask === undefined
    pendingArgs = args
    waitTask?.cancel()
    waitTask = scheduler.schedule(onWait, delay)
    if (maxWait !== undefined && maxTask === undefined)
      maxTask = scheduler.schedule(onMaxWait, maxWait)
    if (idle && leading) invoke()
  }) as IControlledFunction<F>
  /** Cancels the pending invocation. */
  const cancel = (): void => {
    clearTimers()
    pendingArgs = undefined
  }
  controlled.cancel = cancel
  controlled.flush = () => {
    clearTimers()
    return invoke()
  }
  controlled.pending = () => waitTask !== undefined && pendingArgs !== undefined
  controlled[Symbol.dispose] = cancel
  if (signal) {
    /** Abort disposes permanently. */
    const onAbort = (): void => {
      disposed = true
      cancel()
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return Object.freeze(controlled)
}

/**
 * Invokes `fn` at most once per `wait` milliseconds (leading and trailing by default). Pass
 * `'animationFrame'` to invoke at most once per rendered frame with the latest arguments (browser
 * only; `ENV_UNSUPPORTED` elsewhere at call time).
 *
 * @example
 *   ;```ts
 *   const onScroll = throttle(() => updateHeader(window.scrollY), 'animationFrame')
 *   ```
 */
export function throttle<F extends (...args: never[]) => unknown>(
  fn: F,
  wait: number | 'animationFrame',
  options: IThrottleOptions = {}
): IControlledFunction<F> {
  if (wait !== 'animationFrame') {
    /** Validated window; `maxWait = wait` turns the debounce into a throttle. */
    const window = admitWait(wait, 'wait')
    return debounce(fn, window, {
      leading: options.leading !== false,
      trailing: options.trailing !== false,
      maxWait: window,
      signal: options.signal,
      scheduler: options.scheduler
    })
  }
  admitFunction(fn, 'fn')
  /** Validated signal. */
  const signal = admitSignal(options.signal)
  /** Latest arguments waiting for the next frame. */
  let pendingArgs: Parameters<F> | undefined
  /** Result of the last invocation. */
  let lastResult: ReturnType<F> | undefined
  /** Cancels the requested frame. */
  let frame: { abort(): void } | undefined
  /** Set permanently by abort. */
  let disposed = false
  /** Invokes with the pending arguments. */
  const invoke = (): ReturnType<F> | undefined => {
    /** Arguments consumed by this invocation. */
    const args = pendingArgs
    pendingArgs = undefined
    if (args === undefined) return lastResult
    lastResult = fn(...args) as ReturnType<F>
    return lastResult
  }
  /** Cancels the pending frame and arguments. */
  const cancel = (): void => {
    frame?.abort()
    frame = undefined
    pendingArgs = undefined
  }
  /** Public wrapper. */
  const controlled = ((...args: Parameters<F>): void => {
    if (disposed) return
    pendingArgs = args
    if (frame) return
    /** Controller owning this frame request. */
    const controller = new AbortController()
    frame = controller
    asyncTask(
      'animationFrame',
      () => {
        frame = undefined
        invoke()
      },
      { signal: controller.signal }
    ).then(undefined, (error: unknown) => {
      // Our own cancellation is expected; anything else had no caller and is reported.
      if (!controller.signal.aborted) reportUnhandledError(error)
    })
  }) as IControlledFunction<F>
  controlled.cancel = cancel
  controlled.flush = () => {
    frame?.abort()
    frame = undefined
    return invoke()
  }
  controlled.pending = () => frame !== undefined
  controlled[Symbol.dispose] = cancel
  if (signal) {
    /** Abort disposes permanently. */
    const onAbort = (): void => {
      disposed = true
      cancel()
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return Object.freeze(controlled)
}

/**
 * Collects every call made before the chosen queue runs and delivers them in one invocation, in
 * call order. Useful for batching writes, analytics events or DOM reads within one tick. Failures
 * of the batched invocation are reported to the host.
 *
 * @example
 *   ;```ts
 *   const track = coalesce((calls: [event: string][]) => send(calls.map(([event]) => event)))
 *   track('open')
 *   track('click') // one send(['open', 'click'])
 *   ```
 */
export function coalesce<A extends unknown[]>(
  fn: (calls: readonly A[]) => void,
  strategy: AsyncTaskStrategy | readonly AsyncTaskStrategy[] = 'microtask'
): ICoalescedFunction<A> {
  admitFunction(fn, 'fn')
  /** Calls queued for the next delivery. */
  let queue: A[] = []
  /** Cancels the scheduled delivery. */
  let scheduled: { abort(): void } | undefined
  /** Delivers and clears the queue. */
  const deliver = (): void => {
    scheduled = undefined
    /** Calls delivered now; a fresh queue collects calls made during delivery. */
    const calls = queue
    queue = []
    if (calls.length > 0) fn(Object.freeze(calls))
  }
  /** Public wrapper. */
  const coalesced = ((...args: A): void => {
    queue.push(args)
    if (scheduled) return
    /** Controller owning this delivery. */
    const controller = new AbortController()
    scheduled = controller
    asyncTask(strategy, deliver, { signal: controller.signal }).then(
      undefined,
      (error: unknown) => {
        if (!controller.signal.aborted) reportUnhandledError(error)
      }
    )
  }) as ICoalescedFunction<A>
  coalesced.flush = () => {
    scheduled?.abort()
    deliver()
  }
  coalesced.cancel = () => {
    scheduled?.abort()
    scheduled = undefined
    queue = []
  }
  Object.defineProperty(coalesced, 'size', { get: () => queue.length, enumerable: true })
  return Object.freeze(coalesced)
}

/**
 * Runs `task` every `interval` milliseconds without overlap: the next iteration is scheduled only
 * after the previous one settles. The schedule is drift-corrected against the start time; after an
 * overrun it realigns instead of firing a burst of catch-up runs.
 *
 * @example
 *   ;```ts
 *   const poll = repeat(({ signal }) => refresh({ signal }), 30_000, {
 *     immediate: true,
 *     onError: 'continue'
 *   })
 *   // later
 *   poll.stop()
 *   ```
 */
export function repeat(
  task: (context: IRepeatContext) => unknown,
  interval: number,
  options: IRepeatOptions = {}
): IRepeatHandle {
  admitFunction(task, 'task')
  /** Validated inputs. */
  const period = admitWait(interval, 'interval')
  const scheduler = admitScheduler(options.scheduler)
  const signal = admitSignal(options.signal)
  const maxIterations = options.maxIterations ?? Number.POSITIVE_INFINITY
  if (typeof maxIterations !== 'number' || Number.isNaN(maxIterations) || maxIterations < 0)
    throw argumentError(RangeError, 'maxIterations', 'a non-negative number')
  if (options.onError !== undefined && options.onError !== 'stop' && options.onError !== 'continue')
    throw argumentError(TypeError, 'onError', "'stop' or 'continue'")
  /** Error policy. */
  const stopOnError = options.onError !== 'continue'
  /** Controller whose signal each iteration receives. */
  const controller = new AbortController()
  /** Completed iterations. */
  let iteration = 0
  /** Whether the loop still runs. */
  let running = true
  /** Next planned start on the scheduler clock. */
  let nextDue = scheduler.now() + (options.immediate ? 0 : period)
  /** Pending timer. */
  let timer: IScheduledTask | undefined
  /** Settles `done`. */
  let resolveDone!: () => void
  let rejectDone!: (error: unknown) => void
  /** Completion Promise. */
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  /** Ends the loop and settles `done`. */
  const finish = (error?: { readonly value: unknown }): void => {
    if (!running) return
    running = false
    timer?.cancel()
    timer = undefined
    controller.abort(new UtilsAbortError())
    signal?.removeEventListener('abort', onExternalAbort)
    if (error) rejectDone(error.value)
    else resolveDone()
  }
  /** External abort stops the loop. */
  const onExternalAbort = (): void => finish()
  /** Schedules the next iteration at its drift-corrected time. */
  const scheduleNext = (): void => {
    if (!running) return
    if (iteration >= maxIterations) {
      finish()
      return
    }
    /** Current clock reading. */
    const now = scheduler.now()
    if (nextDue < now) nextDue = now
    timer = scheduler.schedule(tick, Math.min(MAXIMUM_DELAY, nextDue - now))
  }
  /** Runs one iteration and schedules the next after it settles. */
  const tick = (): void => {
    timer = undefined
    if (!running) return
    /** Context for this iteration. */
    const context: IRepeatContext = Object.freeze({ iteration, signal: controller.signal })
    nextDue += period
    /** Handles one iteration failure according to the policy. */
    const fail = (error: unknown): void => {
      if (!running) return
      if (stopOnError) finish({ value: error })
      else reportUnhandledError(error)
    }
    /** Continues the loop after one iteration. */
    const after = (): void => {
      iteration += 1
      scheduleNext()
    }
    /** Synchronous result or thenable of the iteration. */
    let result: unknown
    try {
      result = task(context)
    } catch (error) {
      fail(error)
      after()
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
      fail(then.error)
      after()
    } else if (typeof then.value === 'function')
      Promise.resolve(result as PromiseLike<unknown>).then(after, (error: unknown) => {
        fail(error)
        after()
      })
    else after()
  }
  if (signal?.aborted) finish()
  else {
    signal?.addEventListener('abort', onExternalAbort, { once: true })
    scheduleNext()
  }
  /** Public handle. */
  const handle: IRepeatHandle = {
    stop: () => finish(),
    done,
    get running() {
      return running
    },
    [Symbol.dispose]: () => finish()
  }
  return Object.freeze(handle)
}

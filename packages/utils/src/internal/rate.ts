/**
 * Call-rate controls built on the shared `IScheduler` contract: `debounce`, `throttle`, `coalesce`
 * and the non-overlapping `repeat` loop. Timer-driven invocations have no caller to throw to, so
 * their failures go to the host's uncaught-error queue instead of being dropped.
 */
import { ERROR_SOURCE, UtilsErrorCode } from '../error-code.js'
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
    source: ERROR_SOURCE,
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
  return new DebouncedFunction(fn, wait, options).controlled
}

/** One pending invocation owns the latest arguments and completed result for either rate control. */
class PendingInvocation<F extends (...args: never[]) => unknown> {
  /** User callback is invoked as a plain function, preserving its original receiver semantics. */
  #fn: F
  /** The newest undelivered call replaces earlier arguments. */
  #args: Parameters<F> | undefined
  /** Idle flush returns the most recent successful result. */
  #result: ReturnType<F> | undefined
  /** Capture the already-admitted callback without invoking it. */
  constructor(fn: F) {
    this.#fn = fn
  }
  /** Replace the one pending call. */
  stage(args: Parameters<F>): void {
    this.#args = args
  }
  /** Cancel arguments while retaining the last result. */
  clear(): void {
    this.#args = undefined
  }
  /** Whether one call remains undelivered. */
  get pending(): boolean {
    return this.#args !== undefined
  }
  /** Consume before invoking so reentrant calls create a fresh pending call. */
  invoke(): ReturnType<F> | undefined {
    /** One invocation consumes this exact argument list before user code runs. */
    const args = this.#args
    this.#args = undefined
    if (args === undefined) return this.#result
    this.#result = Reflect.apply(this.#fn, undefined, args) as ReturnType<F>
    return this.#result
  }
}

/** One debounce burst owns its quiet/max timers and terminal abort marker. */
class DebouncedFunction<F extends (...args: never[]) => unknown> {
  /** Shared invocation owner preserves reentrant argument and result behavior. */
  #invocation: PendingInvocation<F>
  /** Validated quiet-period duration. */
  #delay: number
  /** Optional upper bound for a continuous burst. */
  #maxWait: number | undefined
  /** Leading calls run only when there is no active quiet timer. */
  #leading: boolean
  /** Trailing delivery defaults to enabled. */
  #trailing: boolean
  /** Timer registration and cancellation retain their canonical scheduler. */
  #scheduler: IScheduler
  /** Quiet timer also identifies whether a burst is active. */
  #waitTask: IScheduledTask | undefined
  /** Continuous bursts share one maximum-wait timer. */
  #maxTask: IScheduledTask | undefined
  /** Abort permanently fences later calls. */
  #disposed = false
  /** The frozen callable retains the original public API shape. */
  readonly controlled: IControlledFunction<F>

  /** Admit configuration in the original read order, then expose one controlled callable. */
  constructor(fn: F, wait: number, options: IDebounceOptions) {
    admitFunction(fn, 'fn')
    this.#delay = admitWait(wait, 'wait')
    this.#maxWait =
      options.maxWait === undefined ? undefined : admitWait(options.maxWait, 'maxWait')
    this.#leading = options.leading === true
    this.#trailing = options.trailing !== false
    this.#scheduler = admitScheduler(options.scheduler)
    /** Subscription admission remains after scheduler admission. */
    const signal = admitSignal(options.signal)
    this.#invocation = new PendingInvocation(fn)
    /** The callable is a receipt for this owner, not a second state container. */
    const controlled = this.#call as IControlledFunction<F>
    controlled.cancel = this.#cancel
    controlled.flush = this.#flush
    controlled.pending = () => this.#waitTask !== undefined && this.#invocation.pending
    controlled[Symbol.dispose] = this.#cancel
    if (signal) {
      if (signal.aborted) this.#abort()
      else signal.addEventListener('abort', this.#abort, { once: true })
    }
    this.controlled = Object.freeze(controlled)
  }

  /** Timer-driven callbacks have no caller; preserve host reporting of thrown failures. */
  #invokeFromTimer(): void {
    try {
      this.#invocation.invoke()
    } catch (error) {
      reportUnhandledError(error)
    }
  }
  /** End a burst and release both timer handles. */
  #clearTimers(): void {
    this.#waitTask?.cancel()
    this.#maxTask?.cancel()
    this.#waitTask = undefined
    this.#maxTask = undefined
  }
  /** A quiet period ends the burst and optionally delivers its latest call. */
  #onWait = (): void => {
    this.#waitTask = undefined
    this.#maxTask?.cancel()
    this.#maxTask = undefined
    if (this.#trailing) this.#invokeFromTimer()
    else this.#invocation.clear()
  }
  /** A continuing burst can arm a fresh maximum window on its next call. */
  #onMaxWait = (): void => {
    this.#maxTask = undefined
    if (this.#invocation.pending) this.#invokeFromTimer()
  }
  /** Replace pending arguments and rearm the quiet period before a possible leading invocation. */
  #call = (...args: Parameters<F>): void => {
    if (this.#disposed) return
    /** Leading admission observes the previous burst marker. */
    const idle = this.#waitTask === undefined
    this.#invocation.stage(args)
    this.#waitTask?.cancel()
    this.#waitTask = this.#scheduler.schedule(this.#onWait, this.#delay)
    if (this.#maxWait !== undefined && this.#maxTask === undefined)
      this.#maxTask = this.#scheduler.schedule(this.#onMaxWait, this.#maxWait)
    if (idle && this.#leading) this.#invocation.invoke()
  }
  /** Cancellation drops pending work without erasing the last completed result. */
  #cancel = (): void => {
    this.#clearTimers()
    this.#invocation.clear()
  }
  /** Explicit flush throws directly to its caller. */
  #flush = (): ReturnType<F> | undefined => {
    this.#clearTimers()
    return this.#invocation.invoke()
  }
  /** External abort is terminal, unlike ordinary cancellation. */
  #abort = (): void => {
    this.#disposed = true
    this.#cancel()
  }
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
    /** Numeric throttle remains the canonical debounce with one bounded maximum window. */
    const window = admitWait(wait, 'wait')
    return debounce(fn, window, {
      leading: options.leading !== false,
      trailing: options.trailing !== false,
      maxWait: window,
      signal: options.signal,
      scheduler: options.scheduler
    })
  }
  return new FrameThrottledFunction(fn, options).controlled
}

/** One frame throttle owns its frame request and terminal abort state. */
class FrameThrottledFunction<F extends (...args: never[]) => unknown> {
  /** Invocation semantics are shared with numeric debounce. */
  #invocation: PendingInvocation<F>
  /** Cancels this owner's single pending frame. */
  #frame: AbortController | undefined
  /** External abort permanently fences later calls. */
  #disposed = false
  /** The frozen callable is the only public receipt. */
  readonly controlled: IControlledFunction<F>

  /** Capture the admitted signal before creating the callable and installing its observer. */
  constructor(fn: F, options: IThrottleOptions) {
    admitFunction(fn, 'fn')
    /** Frame throttling does not read unrelated numeric scheduler options. */
    const signal = admitSignal(options.signal)
    this.#invocation = new PendingInvocation(fn)
    /** All attached operations share this one frame owner. */
    const controlled = this.#call as IControlledFunction<F>
    controlled.cancel = this.#cancel
    controlled.flush = this.#flush
    controlled.pending = () => this.#frame !== undefined
    controlled[Symbol.dispose] = this.#cancel
    if (signal) {
      if (signal.aborted) this.#abort()
      else signal.addEventListener('abort', this.#abort, { once: true })
    }
    this.controlled = Object.freeze(controlled)
  }
  /** Stage the newest arguments and request at most one native frame. */
  #call = (...args: Parameters<F>): void => {
    if (this.#disposed) return
    this.#invocation.stage(args)
    if (this.#frame) return
    /** Cancellation belongs to this exact frame registration. */
    const controller = new AbortController()
    this.#frame = controller
    asyncTask(
      'animationFrame',
      () => {
        this.#frame = undefined
        this.#invocation.invoke()
      },
      { signal: controller.signal }
    ).then(undefined, (error: unknown) => {
      if (!controller.signal.aborted) reportUnhandledError(error)
    })
  }
  /** Drop the pending frame and its arguments. */
  #cancel = (): void => {
    this.#frame?.abort()
    this.#frame = undefined
    this.#invocation.clear()
  }
  /** Flush cancels the native frame before invoking synchronously. */
  #flush = (): ReturnType<F> | undefined => {
    this.#frame?.abort()
    this.#frame = undefined
    return this.#invocation.invoke()
  }
  /** External abort is terminal. */
  #abort = (): void => {
    this.#disposed = true
    this.#cancel()
  }
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
  return new CoalescedFunction(fn, strategy).coalesced
}

/** One coalesced batch owns pending calls and its sole scheduled delivery. */
class CoalescedFunction<A extends unknown[]> {
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
  #call = (...args: A): void => {
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
  return new RepeatingTask(task, interval, options).handle
}

/** One non-overlapping repetition owns its clock position, pending timer and completion receipt. */
class RepeatingTask {
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
      Promise.resolve(result as PromiseLike<unknown>).then(this.#after, (error: unknown) => {
        this.#fail(error)
        this.#after()
      })
    else this.#after()
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

/**
 * One entry point for every cross-host way to run a callback later: microtasks, Node tick and check
 * queues, timers, message-channel tasks, animation frames, idle periods and the prioritized task
 * scheduler. Host APIs are read structurally from `globalThis` on every call, so the module needs
 * no DOM or Node types and test hosts can substitute globals.
 */
import { ERROR_SOURCE, UtilsErrorCode, type IUtilsErrorCode } from '../error-code.js'
import { UtilsErrorText } from '../error-text.js'
import { attachErrorIdentity, tryReadProperty, UtilsAbortError } from '../error.js'
import type { IAbortSignal } from '../promise.js'

/**
 * Every supported way to schedule a callback. Pick by the queue you need; unsupported strategies
 * throw `ENV_UNSUPPORTED` instead of silently degrading. Pass a list to declare your own fallback
 * order, or `auto` for the library's default macrotask order.
 */
export const AsyncTaskStrategy = {
  /**
   * `Promise.resolve().then(callback)`: a promise-reaction microtask. Runs after the current
   * synchronous code and before any timer or I/O. Available everywhere.
   */
  promise: 'promise',
  /**
   * `queueMicrotask(callback)`: the same microtask queue as `promise`, without allocating a
   * Promise. Available in all modern browsers, workers, Node, Deno and Bun.
   */
  microtask: 'microtask',
  /**
   * `process.nextTick(callback)`: Node's tick queue, which drains before promise microtasks when
   * scheduled from a macrotask (inside a promise job, pending microtasks drain first). Node and
   * Bun; Deno only when the Node-compatible `process` global is present.
   */
  nextTick: 'nextTick',
  /**
   * `setTimeout(callback, delay)`: a timer macrotask. Browsers clamp nested timers to at least 4ms
   * and throttle background tabs. Available everywhere; the only strategy with native `delay`
   * besides the `postTask*` family.
   */
  timeout: 'timeout',
  /**
   * `setImmediate(callback)`: Node's check phase, right after I/O polling and before timers of the
   * next loop turn. Node and Bun.
   */
  immediate: 'immediate',
  /**
   * `MessageChannel` round trip: a macrotask without the nested-timer clamp, the usual way to yield
   * to the event loop quickly. Browsers, workers, Node, Deno and Bun.
   */
  messageChannel: 'messageChannel',
  /**
   * `requestAnimationFrame(callback)`: runs before the next paint and receives the frame time.
   * Paused in hidden tabs. Browser windows and some worker hosts only.
   */
  animationFrame: 'animationFrame',
  /**
   * `requestIdleCallback(callback, { timeout })`: runs in an idle period and receives
   * `timeRemaining()`; `idleTimeout` forces a run after that many milliseconds. Chromium, Firefox
   * and Safari 18+.
   */
  idleCallback: 'idleCallback',
  /**
   * `scheduler.postTask(callback, { priority: 'user-blocking' })`: highest-priority task, for work
   * that blocks user input. Supports native `delay`. Chromium and Firefox.
   */
  postTaskUserBlocking: 'postTaskUserBlocking',
  /**
   * `scheduler.postTask(callback, { priority: 'user-visible' })`: default-priority task, for work
   * whose result the user will see soon. Supports native `delay`. Chromium and Firefox.
   */
  postTaskUserVisible: 'postTaskUserVisible',
  /**
   * `scheduler.postTask(callback, { priority: 'background' })`: lowest-priority task, for logging,
   * prefetching and other deferrable work. Supports native `delay`. Chromium and Firefox.
   */
  postTaskBackground: 'postTaskBackground',
  /**
   * `await scheduler.yield()`: yields to the browser and resumes ahead of other queued tasks of the
   * same priority, the recommended way to split long tasks. Chromium and Firefox.
   */
  schedulerYield: 'schedulerYield',
  /**
   * First supported of `schedulerYield`, `postTaskUserVisible`, `messageChannel`, `immediate`,
   * `timeout`: a fast macrotask that lets rendering and I/O run. Available everywhere.
   */
  auto: 'auto'
} as const

export type AsyncTaskStrategy = keyof typeof AsyncTaskStrategy

/** Concrete strategies, i.e. every key except `auto`. */
export type IConcreteAsyncTaskStrategy = Exclude<AsyncTaskStrategy, 'auto'>

/** Options for `asyncTask()`. A bare number argument is shorthand for `{ delay }`. */
export type IAsyncTaskOptions = {
  /** Milliseconds to wait before the strategy's queue is used. Defaults to `0`. */
  readonly delay?: number
  /** Cancels the task before it starts; rejects with `UtilsAbortError` (`ABORTED`). */
  readonly signal?: IAbortSignal
  /** `idleCallback` only: forces a run after this many milliseconds without an idle period. */
  readonly idleTimeout?: number
}

/**
 * Context passed to the callback. `strategy` is the concrete strategy that ran; frame and idle
 * strategies add their host data.
 */
export type IAsyncTaskContext<S extends AsyncTaskStrategy = AsyncTaskStrategy> = S extends unknown
  ? S extends 'animationFrame'
    ? { readonly strategy: S; readonly frameTime: number }
    : S extends 'idleCallback'
      ? { readonly strategy: S; readonly didTimeout: boolean; timeRemaining(): number }
      : S extends 'auto'
        ? { readonly strategy: IConcreteAsyncTaskStrategy }
        : { readonly strategy: S }
  : never

/** Default fallback order behind `auto`. */
const AUTO_ORDER: readonly IConcreteAsyncTaskStrategy[] = Object.freeze([
  'schedulerYield',
  'postTaskUserVisible',
  'messageChannel',
  'immediate',
  'timeout'
])

/** Largest delay host timers accept without overflowing. */
const MAXIMUM_DELAY = 2_147_483_647

/** `postTask` priority per strategy. */
const POST_TASK_PRIORITY = {
  postTaskUserBlocking: 'user-blocking',
  postTaskUserVisible: 'user-visible',
  postTaskBackground: 'background'
} as const

/** Structural view of the host globals this module reads. */
type IAsyncTaskHost = {
  readonly queueMicrotask?: unknown
  readonly process?: { readonly nextTick?: unknown }
  readonly setTimeout?: unknown
  readonly clearTimeout?: unknown
  readonly setImmediate?: unknown
  readonly clearImmediate?: unknown
  readonly MessageChannel?: unknown
  readonly requestAnimationFrame?: unknown
  readonly cancelAnimationFrame?: unknown
  readonly requestIdleCallback?: unknown
  readonly cancelIdleCallback?: unknown
  readonly scheduler?: { readonly postTask?: unknown; readonly yield?: unknown }
  readonly AbortController?: unknown
}

/** Host API label per strategy, used in `ENV_UNSUPPORTED` messages. */
const CAPABILITY: Readonly<Record<IConcreteAsyncTaskStrategy, string>> = Object.freeze({
  promise: 'Promise',
  microtask: 'queueMicrotask',
  nextTick: 'process.nextTick',
  timeout: 'setTimeout/clearTimeout',
  immediate: 'setImmediate/clearImmediate',
  messageChannel: 'MessageChannel',
  animationFrame: 'requestAnimationFrame/cancelAnimationFrame',
  idleCallback: 'requestIdleCallback/cancelIdleCallback',
  postTaskUserBlocking: 'scheduler.postTask',
  postTaskUserVisible: 'scheduler.postTask',
  postTaskBackground: 'scheduler.postTask',
  schedulerYield: 'scheduler.yield'
})

/** Reads host globals per call so substituted hosts are honoured. */
function host(): IAsyncTaskHost {
  return globalThis as unknown as IAsyncTaskHost
}

/** Reads one host member without letting a hostile getter escape. */
function member(owner: unknown, key: string): unknown {
  if (owner === null || (typeof owner !== 'object' && typeof owner !== 'function')) return undefined
  /** Guarded read. */
  const read = tryReadProperty(owner as Record<string, unknown>, key)
  return read.threw ? undefined : read.value
}

/** Creates a coded native error without replacing its type. */
function taskError(
  Constructor: ErrorConstructor | TypeErrorConstructor | RangeErrorConstructor,
  code: IUtilsErrorCode,
  message: string
): Error {
  return attachErrorIdentity(new Constructor(message), { source: ERROR_SOURCE, code })
}

/** Whether a key names a known strategy (own key only). */
function isStrategy(value: unknown): value is AsyncTaskStrategy {
  return typeof value === 'string' && Object.hasOwn(AsyncTaskStrategy, value)
}

/** Checks the host capability behind one concrete strategy. */
function supported(strategy: IConcreteAsyncTaskStrategy): boolean {
  /** Host snapshot for this check. */
  const globals = host()
  switch (strategy) {
    case 'promise':
      return typeof Promise === 'function'
    case 'microtask':
      return typeof member(globals, 'queueMicrotask') === 'function'
    case 'nextTick':
      return typeof member(member(globals, 'process'), 'nextTick') === 'function'
    case 'timeout':
      return (
        typeof member(globals, 'setTimeout') === 'function' &&
        typeof member(globals, 'clearTimeout') === 'function'
      )
    case 'immediate':
      return (
        typeof member(globals, 'setImmediate') === 'function' &&
        typeof member(globals, 'clearImmediate') === 'function'
      )
    case 'messageChannel':
      return typeof member(globals, 'MessageChannel') === 'function'
    case 'animationFrame':
      return (
        typeof member(globals, 'requestAnimationFrame') === 'function' &&
        typeof member(globals, 'cancelAnimationFrame') === 'function'
      )
    case 'idleCallback':
      return (
        typeof member(globals, 'requestIdleCallback') === 'function' &&
        typeof member(globals, 'cancelIdleCallback') === 'function'
      )
    case 'postTaskUserBlocking':
    case 'postTaskUserVisible':
    case 'postTaskBackground':
      return (
        typeof member(member(globals, 'scheduler'), 'postTask') === 'function' &&
        typeof member(globals, 'AbortController') === 'function'
      )
    case 'schedulerYield':
      return typeof member(member(globals, 'scheduler'), 'yield') === 'function'
  }
}

/**
 * Whether the current host can run `strategy`. `auto` is supported whenever any of its fallbacks
 * is. Unknown keys return `false`.
 *
 * @example
 *   ;```ts
 *   const strategy = isAsyncTaskSupported('idleCallback') ? 'idleCallback' : 'timeout'
 *   ```
 */
export function isAsyncTaskSupported(strategy: AsyncTaskStrategy): boolean {
  if (!isStrategy(strategy)) return false
  return strategy === 'auto' ? AUTO_ORDER.some(supported) : supported(strategy)
}

/**
 * Returns the first supported strategy of an ordered preference list (`auto` expands in place).
 * Throws `INVALID_ARGUMENT` for an empty list or unknown key, `ENV_UNSUPPORTED` when none is
 * supported.
 *
 * @example
 *   ;```ts
 *   resolveAsyncTaskStrategy(['postTaskBackground', 'idleCallback', 'timeout'])
 *   ```
 */
export function resolveAsyncTaskStrategy(
  preferred: AsyncTaskStrategy | readonly AsyncTaskStrategy[]
): IConcreteAsyncTaskStrategy {
  /** Preference list; a single key is a one-item list. */
  const list: readonly unknown[] = Array.isArray(preferred) ? preferred : [preferred]
  if (list.length === 0 || !list.every(isStrategy))
    throw taskError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument('strategy', UtilsErrorText.asyncTaskStrategyExpectation)
    )
  /** Concrete candidates in preference order. */
  const candidates = (list as readonly AsyncTaskStrategy[]).flatMap((strategy) =>
    strategy === 'auto' ? AUTO_ORDER : [strategy]
  )
  /** First candidate the host supports. */
  const found = candidates.find(supported)
  if (found) return found
  throw taskError(
    Error,
    UtilsErrorCode.envUnsupported,
    UtilsErrorText.envUnsupported(
      candidates
        .map((strategy) => UtilsErrorText.asyncTaskCapability(strategy, CAPABILITY[strategy]))
        .join(', ')
    )
  )
}

/** Validates a delay-like option; non-numbers are `TypeError`, out-of-range is `RangeError`. */
function admitDelay(value: unknown, field: string): number {
  if (typeof value !== 'number')
    throw taskError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument(field, UtilsErrorText.delayExpectation)
    )
  if (!Number.isFinite(value) || value < 0 || value > MAXIMUM_DELAY)
    throw taskError(
      RangeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument(field, UtilsErrorText.delayExpectation)
    )
  return value
}

/** Validates the structural abort signal shape without subscribing. */
function admitSignal(value: unknown): IAbortSignal {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof member(value, 'addEventListener') !== 'function' ||
    typeof member(value, 'removeEventListener') !== 'function' ||
    typeof member(value, 'aborted') !== 'boolean'
  )
    throw taskError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument('signal', 'an AbortSignal')
    )
  return value as IAbortSignal
}

/** Host callback typed loosely; every call goes through `Reflect.apply` with the host receiver. */
type IHostFunction = (...args: unknown[]) => unknown

/** Native channel shape used solely for one message-channel task. */
type ITaskMessageChannel = {
  readonly port1: { onmessage: unknown; close(): void }
  readonly port2: { postMessage(value: unknown): void; close(): void }
}

/** One concrete dispatch owns its native registration, cancellation marker and optional delay stage. */
class TaskDispatch {
  /** One host snapshot pairs native registration and cancellation. */
  #globals = host()
  /** Concrete queue was selected before this native registration. */
  #strategy: IConcreteAsyncTaskStrategy
  /** The original caller owns callback result settlement. */
  #run: (context: Record<string, unknown>) => void
  /** Shared diagnostic context records the selected queue. */
  #base: Record<string, unknown>
  /** Already-admitted delay is consumed by the native or preliminary timer. */
  #delay: number
  /** Optional idle deadline is forwarded only to idle registration. */
  #idleTimeout: number | undefined
  /** Non-cancellable callbacks consult this marker before running. */
  #cancelled = false
  /** A preliminary delay hands cancellation to its subsequently registered inner queue. */
  #cancelInner: (() => void) | undefined
  /** Only a message-channel strategy owns this pair of native ports. */
  #channel: ITaskMessageChannel | undefined

  /** Capture the concrete operation without touching its native queue yet. */
  constructor(
    strategy: IConcreteAsyncTaskStrategy,
    run: (context: Record<string, unknown>) => void,
    delay: number,
    idleTimeout: number | undefined
  ) {
    this.#strategy = strategy
    this.#run = run
    this.#base = { strategy }
    this.#delay = delay
    this.#idleTimeout = idleTimeout
  }

  /** Invoke host functions with their exact required receiver. */
  #call(name: string, args: unknown[]): unknown {
    return Reflect.apply(member(this.#globals, name) as IHostFunction, this.#globals, args)
  }

  /** Choose one actual native registration, keeping fallback outside this concrete owner. */
  register(): () => void {
    /** Timeout and postTask already implement their own native delay. */
    const nativeDelay = this.#strategy === 'timeout' || this.#strategy in POST_TASK_PRIORITY
    if (this.#delay > 0 && !nativeDelay) return this.#registerDelay()
    switch (this.#strategy) {
      case 'promise':
      case 'microtask':
      case 'nextTick':
      case 'schedulerYield':
        return this.#registerDeferred()
      case 'timeout':
        return this.#registerTimer('setTimeout', 'clearTimeout', this.#delay)
      case 'immediate':
        return this.#registerTimer('setImmediate', 'clearImmediate')
      case 'messageChannel':
        return this.#registerChannel()
      case 'animationFrame': {
        /** The frame callback retains the original native timestamp conversion. */
        const id = this.#call('requestAnimationFrame', [
          (frameTime: unknown) => this.#run({ ...this.#base, frameTime: Number(frameTime) })
        ])
        return () => {
          this.#call('cancelAnimationFrame', [id])
        }
      }
      case 'idleCallback':
        return this.#registerIdle()
      case 'postTaskUserBlocking':
      case 'postTaskUserVisible':
      case 'postTaskBackground':
        return this.#registerPosted(this.#strategy)
    }
  }

  /** A preliminary timer yields cancellation to the second stage only after it is registered. */
  #registerDelay(): () => void {
    /** This first stage owns only its own native timer. */
    const handle = this.#call('setTimeout', [
      () => {
        this.#cancelInner = dispatch(this.#strategy, this.#run, 0, this.#idleTimeout)
      },
      this.#delay
    ])
    return () => {
      if (this.#cancelInner) this.#cancelInner()
      else this.#call('clearTimeout', [handle])
    }
  }

  /** Non-cancellable microtask/tick/continuation registrations share one cancellation marker. */
  #registerDeferred(): () => void {
    switch (this.#strategy) {
      case 'promise':
        void Promise.resolve().then(this.#runIfOpen)
        break
      case 'microtask':
        this.#call('queueMicrotask', [this.#runIfOpen])
        break
      case 'nextTick': {
        /** Node-compatible process is the native nextTick receiver. */
        const processHost = member(this.#globals, 'process')
        Reflect.apply(member(processHost, 'nextTick') as IHostFunction, processHost, [
          this.#runIfOpen
        ])
        break
      }
      case 'schedulerYield': {
        /** The host scheduler owns its continuation queue. */
        const schedulerHost = member(this.#globals, 'scheduler')
        void Promise.resolve(
          Reflect.apply(member(schedulerHost, 'yield') as IHostFunction, schedulerHost, [])
        ).then(this.#runIfOpen)
        break
      }
    }
    return () => {
      this.#cancelled = true
    }
  }

  /** Callback admission for queues that cannot unregister a native job. */
  #runIfOpen = (): void => {
    if (!this.#cancelled) this.#run(this.#base)
  }

  /** Timer and immediate registration share native-handle cancellation, preserving argument count. */
  #registerTimer(register: string, cancel: string, delay?: number): () => void {
    /** Native delay is supplied only by timeout, as in the original call. */
    const handle = this.#call(register, [
      () => this.#run(this.#base),
      ...(delay === undefined ? [] : [delay])
    ])
    return () => {
      this.#call(cancel, [handle])
    }
  }

  /** A fresh channel belongs to this task and closes on run or cancellation. */
  #registerChannel(): () => void {
    this.#channel = new (member(this.#globals, 'MessageChannel') as new () => ITaskMessageChannel)()
    this.#channel.port1.onmessage = () => {
      this.#closeChannel()
      this.#run(this.#base)
    }
    this.#channel.port2.postMessage(undefined)
    return this.#closeChannel
  }

  /** Release the original two ports and detach their message callback. */
  #closeChannel = (): void => {
    this.#channel!.port1.onmessage = null
    this.#channel!.port1.close()
    this.#channel!.port2.close()
  }

  /** Idle callbacks expose the original native deadline receiver lazily. */
  #registerIdle(): () => void {
    /** Cancellation uses the exact id returned by native registration. */
    const id = this.#call('requestIdleCallback', [
      (deadline: { readonly didTimeout?: unknown; timeRemaining?: () => number }) =>
        this.#run({
          ...this.#base,
          didTimeout: deadline?.didTimeout === true,
          timeRemaining: () =>
            typeof deadline?.timeRemaining === 'function' ? deadline.timeRemaining() : 0
        }),
      ...(this.#idleTimeout === undefined ? [] : [{ timeout: this.#idleTimeout }])
    ])
    return () => {
      this.#call('cancelIdleCallback', [id])
    }
  }

  /** Native postTask owns cancellation; unexpected native rejections still reach the host. */
  #registerPosted(strategy: keyof typeof POST_TASK_PRIORITY): () => void {
    /** The host scheduler must remain the receiver of postTask. */
    const schedulerHost = member(this.#globals, 'scheduler')
    /** This native controller cancels only the posted task. */
    const controller = new (member(this.#globals, 'AbortController') as new () => {
      readonly signal: unknown
      abort(): void
    })()
    /** Preserve the original host promise and its optional then surface. */
    const posted = Reflect.apply(
      member(schedulerHost, 'postTask') as IHostFunction,
      schedulerHost,
      [
        () => this.#run(this.#base),
        { priority: POST_TASK_PRIORITY[strategy], delay: this.#delay, signal: controller.signal }
      ]
    ) as PromiseLike<unknown> | undefined
    posted?.then(undefined, (error: unknown) => {
      if (!this.#cancelled)
        this.#call('queueMicrotask', [
          () => {
            throw error
          }
        ])
    })
    return () => {
      this.#cancelled = true
      controller.abort()
    }
  }
}

/** Register one concrete queue; its named owner retains cancellation and native handles. */
function dispatch(
  strategy: IConcreteAsyncTaskStrategy,
  run: (context: Record<string, unknown>) => void,
  delay: number,
  idleTimeout: number | undefined
): () => void {
  return new TaskDispatch(strategy, run, delay, idleTimeout).register()
}

/** Own one scheduled callback's admission, cancellation and settlement. */
class ScheduledCallback<S extends AsyncTaskStrategy, R> {
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

/**
 * Runs `callback` later on the chosen queue and resolves with its result (thenables are adopted,
 * rejections pass through with their original identity).
 *
 * Argument and host problems throw synchronously: an unknown strategy, invalid delay or signal is
 * `INVALID_ARGUMENT`; a strategy the host lacks is `ENV_UNSUPPORTED` (pass a list for fallback).
 * Aborting `signal` before the callback starts cancels the host registration and rejects with
 * `UtilsAbortError`; aborting after it started has no effect.
 *
 * @example
 *   ;```ts
 *   await asyncTask('idleCallback', ({ timeRemaining }) => prefetch(timeRemaining()), {
 *     idleTimeout: 2000
 *   })
 *   await asyncTask(['postTaskBackground', 'timeout'], flushLogs, 100)
 *   ```
 */
export function asyncTask<const S extends AsyncTaskStrategy, R>(
  strategy: S | readonly S[],
  callback: (context: IAsyncTaskContext<S>) => R | PromiseLike<R>,
  delayOrOptions?: number | IAsyncTaskOptions
): Promise<Awaited<R>> {
  if (typeof callback !== 'function')
    throw taskError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument('callback', UtilsErrorText.functionExpectation)
    )
  /** Normalized options; a number is the delay shorthand. */
  const options: IAsyncTaskOptions =
    typeof delayOrOptions === 'number' ? { delay: delayOrOptions } : (delayOrOptions ?? {})
  /** Validated scheduling inputs. */
  const delay = admitDelay(options.delay ?? 0, 'delay')
  const idleTimeout =
    options.idleTimeout === undefined ? undefined : admitDelay(options.idleTimeout, 'idleTimeout')
  const signal = options.signal === undefined ? undefined : admitSignal(options.signal)
  /** Concrete strategy, resolved before any registration. */
  const concrete = resolveAsyncTaskStrategy(strategy)
  if (
    delay > 0 &&
    !supported('timeout') &&
    concrete !== 'timeout' &&
    !(concrete in POST_TASK_PRIORITY)
  )
    throw taskError(
      Error,
      UtilsErrorCode.envUnsupported,
      UtilsErrorText.envUnsupported(UtilsErrorText.asyncTaskCapability('delay', CAPABILITY.timeout))
    )
  if (signal?.aborted) {
    /** Abort reason read once through a guarded getter. */
    const reason = tryReadProperty(signal as { reason?: unknown }, 'reason')
    return Promise.reject(new UtilsAbortError(reason.threw ? reason.error : reason.value))
  }
  return new ScheduledCallback<S, R>(concrete, callback, delay, idleTimeout, signal).promise
}

/**
 * Resolves after yielding to the host once: `await yieldToHost()` inside long loops lets rendering,
 * input and I/O run. Defaults to `auto`.
 *
 * @example
 *   ;```ts
 *   for (const row of rows) {
 *     process(row)
 *     if (++n % 500 === 0) await yieldToHost()
 *   }
 *   ```
 */
export function yieldToHost(
  strategy: AsyncTaskStrategy | readonly AsyncTaskStrategy[] = 'auto',
  options?: { readonly signal?: IAbortSignal }
): Promise<void> {
  return asyncTask(strategy, () => undefined, options)
}

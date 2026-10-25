/** Own Promise completion, retry and concurrency primitives together with their native cleanup. */
import { ERROR_SOURCE, UtilsErrorCode } from './error-code.js'
import { UtilsErrorText } from './error-text.js'
import {
  attachErrorIdentity,
  tryReadProperty,
  UtilsAbortError,
  UtilsTimeoutError
} from './error.js'
import { systemScheduler, type IScheduledTask, type IScheduler } from './scheduler.js'
import { reportUnhandledError } from './host-report.js'

export { UtilsAbortError } from './error.js'

/**
 * Structural abort signal accepted by every input in this module. Native `AbortSignal` objects from
 * any host satisfy it, so callers need no DOM or Node type library.
 */
export type IAbortSignal = {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

/**
 * The signal type for values this module creates with a real `AbortController` and hands to an
 * operation, so callers can pass it to host APIs such as `fetch` without an assertion.
 *
 * It resolves against the consumer's own globals instead of naming `AbortSignal`: under `lib.dom`,
 * `@types/node`, Deno or Bun it is the host `AbortSignal`, and without host types it falls back to
 * the structural `IAbortSignal`, so the published declarations still require no host library.
 * Inputs keep accepting the structural `IAbortSignal`; only produced signals use this type.
 */
export type INativeAbortSignal = typeof globalThis extends {
  readonly AbortSignal: { readonly prototype: infer THostSignal }
}
  ? THostSignal
  : IAbortSignal

/**
 * The abort-controller members this module consumes, named locally so the published declarations
 * stay self-contained. A real `AbortController` satisfies it directly.
 *
 * The global would work inside this workspace and fail outside it: once a consumer reaches these
 * declarations through a package that aliases them, `lib.dom` or `@types/node` becomes a silent
 * requirement of every such consumer, and a packed consumer compiling under `lib: ["ES2022"]` fails
 * on a name this runtime-neutral package should never have asked it to provide.
 */
type IAbortControllerLike = {
  readonly signal: IAbortSignal
  abort(reason?: unknown): void
}

/** Stable reasons for rejecting an untrusted abort-signal-shaped value without throwing. */
export type IAbortSignalRejection =
  | 'not-object'
  | 'aborted-not-boolean'
  | 'aborted-threw'
  | 'listener-not-function'

/** Result of one structural signal admission read; callers retain all error and abort policy. */
export type IAbortSignalAdmission =
  | { readonly kind: 'valid'; readonly signal: IAbortSignal; readonly aborted: boolean }
  | { readonly kind: 'invalid'; readonly reason: IAbortSignalRejection; readonly cause?: unknown }

/**
 * Admits an abort signal shape through one `aborted` read without probing `reason` or subscribing.
 * Getter and proxy failures remain data so the owning caller can apply its own error policy.
 */
export function admitAbortSignal(candidate: unknown): IAbortSignalAdmission {
  if (candidate === null || (typeof candidate !== 'object' && typeof candidate !== 'function'))
    return { kind: 'invalid', reason: 'not-object' }
  try {
    if (Array.isArray(candidate)) return { kind: 'invalid', reason: 'not-object' }
  } catch (cause) {
    return { kind: 'invalid', reason: 'not-object', cause }
  }
  /** Structural candidate is safe to type after its object-or-function and array admission checks. */
  const signal = candidate as IAbortSignal
  /** Captures the only `aborted` observation so mutable getters cannot be reread by this helper. */
  let aborted: unknown
  try {
    aborted = signal.aborted
  } catch (cause) {
    return { kind: 'invalid', reason: 'aborted-threw', cause }
  }
  if (typeof aborted !== 'boolean') return { kind: 'invalid', reason: 'aborted-not-boolean' }
  /** Listener methods are read together so either hostile accessor has one classified outcome. */
  let addEventListener: unknown
  /** Counterpart cleanup method must exist before callers can safely own an admitted signal. */
  let removeEventListener: unknown
  try {
    addEventListener = signal.addEventListener
    removeEventListener = signal.removeEventListener
  } catch (cause) {
    return { kind: 'invalid', reason: 'listener-not-function', cause }
  }
  if (typeof addEventListener !== 'function' || typeof removeEventListener !== 'function')
    return { kind: 'invalid', reason: 'listener-not-function' }
  return { kind: 'valid', signal, aborted }
}
/** Native Promise plus the `resolve` / `reject` functions that settle it; returned by `deferred()`. */
export type IDeferred<T> = {
  readonly promise: Promise<T>
  readonly resolve: (value: T | PromiseLike<T>) => void
  readonly reject: (reason?: unknown) => void
}
/**
 * Shared cancellation and timing options. `signal` and `signals` are mutually exclusive (passing
 * both rejects with `INVALID_ARGUMENT`); any listed signal aborting cancels the wait. `scheduler`
 * defaults to the system scheduler of `@migaia/utils/scheduler`; `unref: true` lets a Node timer
 * stop holding the process open.
 */
export type IAsyncControls = {
  readonly signal?: IAbortSignal
  readonly signals?: readonly IAbortSignal[]
  readonly scheduler?: IScheduler
  readonly unref?: boolean
}
/**
 * Context handed to each `retry` attempt: the 1-based `attempt`, a native `signal` aborted when
 * this attempt must stop (outside abort, attempt deadline or total deadline), and `remainingMs` of
 * the total budget when `totalTimeoutMs` is set.
 */
export type IRetryContext = {
  readonly attempt: number
  readonly signal: INativeAbortSignal
  readonly remainingMs?: number
}
/** Context passed to `shouldRetry` and a `delay` function after a failed attempt. */
export type IRetryFailureContext = IRetryContext & { readonly maxAttempts: number }
/**
 * Receives failures that happen after a result was already settled: late rejections, cleanup
 * failures and failures of a custom reporter. `operation` names the API and `phase` the kind of
 * failure. A rejection with the `reason` of the operation's own signal is a cancellation
 * acknowledgement and never reaches the reporter.
 */
export type IUtilsReporter = (
  error: unknown,
  context: {
    readonly operation:
      | 'abort-timeout-signal'
      | 'withTimeout'
      | 'raceWithAbort'
      | 'retry'
      | 'sleep'
      | 'limiter'
    readonly phase: 'late-rejection' | 'cleanup' | 'reporter'
    readonly attempt?: number
  }
) => void
/** Reports a diagnostic to the host without creating an unhandled rejected Promise. */
export const hostRethrowReporter: IUtilsReporter = reportUnhandledError
/**
 * Lazy operation for `withTimeout` / `raceWithAbort`. It receives a native `signal` that aborts at
 * the deadline or on outside cancellation; pass it to I/O such as `fetch` so the work really
 * stops.
 */
export type ITimeoutOperation<T> = (context: {
  readonly signal: INativeAbortSignal
}) => T | PromiseLike<T>

/**
 * Deadline-only operation used when `cooperativeCancellation` may be `false`: the operation then
 * receives a stable never-aborting structural signal, not a host `AbortSignal`.
 */
export type IDeadlineOnlyOperation<T> = (context: {
  readonly signal: IAbortSignal
}) => T | PromiseLike<T>

/** Internal controller hand-off used by retry so operation and policy share one attempt signal. */
const retryAttemptController = Symbol('retry attempt controller')

/** Stable reporter operation owned by the signal-only composition primitive. */
const abortTimeoutSignalOperation = 'abort-timeout-signal' as const

/** Stable inert signal used by deadline-only callers that must not allocate an AbortController. */
const inertTimeoutSignal: IAbortSignal = Object.freeze({
  aborted: false,
  addEventListener: (): void => undefined,
  removeEventListener: (): void => undefined
})

/** Result of inspecting external abort state without allowing hostile getters to escape. */
type IAbortObservation =
  | { readonly kind: 'none' }
  | { readonly kind: 'aborted'; readonly reason: unknown }
  | { readonly kind: 'failed'; readonly error: unknown }

/** Reads the first observed abort and treats a hostile reason getter as that abort's reason. */
function observeAbort(signals: readonly IAbortSignal[]): IAbortObservation {
  for (const signal of signals) {
    let aborted: boolean
    try {
      aborted = signal.aborted
    } catch (error) {
      return { kind: 'failed', error }
    }
    if (!aborted) continue
    /** Preserve a hostile getter failure as the cancellation reason. */
    const read = tryReadProperty(signal, 'reason')
    return { kind: 'aborted', reason: read.threw ? read.error : read.value }
  }
  return { kind: 'none' }
}

/**
 * Recognizes a late rejection that only acknowledges cancellation. A cooperative operation such as
 * `fetch(url, { signal })` rejects with the exact `reason` of the aborted signal it received. After
 * the race has already settled with that cancellation, this rejection is not a new failure, so it
 * is not reported; any other late rejection still reaches the reporter.
 */
function acknowledgesCancellation(error: unknown, signal: IAbortSignal | undefined): boolean {
  if (signal === undefined || !signal.aborted) return false
  /** The reason is read through the shared guarded read, like every other owned reason site. */
  const read = tryReadProperty(signal, 'reason')
  return !read.threw && Object.is(error, read.value)
}

/** Reads one event-delivered abort reason without redundantly probing mutable aborted state. */
function observeAbortReason(signal: IAbortSignal): unknown {
  /** The caller owns whether an inaccessible reason is reported or propagated. */
  const read = tryReadProperty(signal, 'reason')
  return read.threw ? read.error : read.value
}

/** Freezes the admission set so reentrant callers cannot change cleanup ownership. */
function snapshotSignals(
  signalsOption: readonly IAbortSignal[] | undefined,
  signal: IAbortSignal | undefined
): readonly IAbortSignal[] {
  return Object.freeze([...(signalsOption ?? (signal === undefined ? [] : [signal]))])
}
/**
 * Options of `createAbortTimeoutSignal`. Without `timeoutMs` the outside `signal` is returned as
 * is. `timeoutReason` builds the abort reason at the deadline; `report` receives cleanup failures.
 */
export type IAbortTimeoutSignalOptions = {
  readonly signal?: IAbortSignal
  readonly timeoutMs?: number
  readonly scheduler?: IScheduler
  readonly timeoutReason?: () => unknown
  readonly report?: IUtilsReporter
}
/**
 * Merged signal plus its idempotent `dispose`, which cancels the timer and removes listeners.
 * `signal` is `undefined` only when neither an outside signal nor a time limit was given.
 */
export type IAbortTimeoutSignal = {
  readonly signal: IAbortSignal | undefined
  readonly dispose: () => void
}

/** One merged signal owns its timer and external subscription cleanup. */
class AbortTimeoutSignal implements IAbortTimeoutSignal {
  /** The native controller is the sole authority for the merged signal. */
  #controller = new AbortController()
  /** External cancellation retains its original reason and receiver. */
  #externalSignal: IAbortSignal | undefined
  /** Cleanup must attempt every originally admitted subscription. */
  #signals: readonly IAbortSignal[]
  /** Cleanup failures follow the caller's existing diagnostic reporter. */
  #report: IAbortTimeoutSignalOptions['report'] & {}
  /** The caller's reason factory runs only when the timeout actually fires. */
  #timeoutReason: IAbortTimeoutSignalOptions['timeoutReason']
  /** One optional scheduler task is cancelled once by disposal. */
  #timer: IScheduledTask | undefined
  /** Disposal fences repeated timer/subscription cleanup. */
  #disposed = false
  /** Stable signal identity is shared by all observers. */
  readonly signal: IAbortSignal

  /** Preserve timer admission, pre-abort observation and post-subscription race checks. */
  constructor(
    timeoutMs: number,
    externalSignal: IAbortSignal | undefined,
    report: IAbortTimeoutSignalOptions['report'] & {},
    options: IAbortTimeoutSignalOptions
  ) {
    /** Scheduler is captured only for timeout-bearing calls. */
    const scheduler = options.scheduler ?? systemScheduler
    this.#timeoutReason = options.timeoutReason
    this.#signals = snapshotSignals(undefined, externalSignal)
    this.#externalSignal = externalSignal
    this.#report = report
    this.signal = this.#controller.signal as unknown as IAbortSignal
    /** Pre-abort observation precedes native registration. */
    const initial = observeAbort(this.#signals)
    if (initial.kind === 'failed') throw initial.error
    if (initial.kind === 'aborted') this.#controller.abort(initial.reason)
    else if (timeoutMs === 0) this.#controller.abort(this.#createTimeoutReason())
    else
      this.#timer = scheduler.schedule(
        () => this.#controller.abort(this.#createTimeoutReason()),
        timeoutMs
      )
    if (initial.kind === 'none' && this.#externalSignal !== undefined && timeoutMs !== 0) {
      try {
        this.#externalSignal.addEventListener('abort', this.#onExternalAbort, { once: true })
        /** The original race check observes cancellation during listener installation. */
        const afterSubscription = observeAbort(this.#signals)
        if (afterSubscription.kind === 'failed') {
          this.dispose()
          throw afterSubscription.error
        }
        if (afterSubscription.kind === 'aborted') this.#controller.abort(afterSubscription.reason)
      } catch (error) {
        this.dispose()
        throw error
      }
    }
  }

  /** Cancel the timer and release all admitted external subscriptions exactly once. */
  dispose = (): void => {
    if (this.#disposed) return
    this.#disposed = true
    try {
      this.#timer?.cancel()
    } catch (error) {
      reportDiagnostic(this.#report, error, {
        operation: abortTimeoutSignalOperation,
        phase: 'cleanup'
      })
    }
    // Removal is intentionally attempted even when admission failed or pre-abort skipped add:
    // an event target may register before throwing, and storage's migrated cleanup trace requires it.
    for (const signal of this.#signals)
      try {
        signal.removeEventListener('abort', this.#onExternalAbort)
      } catch (error) {
        reportDiagnostic(this.#report, error, {
          operation: abortTimeoutSignalOperation,
          phase: 'cleanup'
        })
      }
  }
  /** External cancellation forwards the original reason without cancelling independent resources. */
  #onExternalAbort = (): void => {
    if (this.#externalSignal !== undefined)
      this.#controller.abort(observeAbortReason(this.#externalSignal))
  }
  /** Contains a hostile timeout reason factory inside the signal's existing reason channel. */
  #createTimeoutReason = (): unknown => {
    try {
      /** Reason factories remain plain calls with no new receiver. */
      const factory = this.#timeoutReason
      return factory?.()
    } catch (error) {
      return error
    }
  }
}

/** Creates the canonical merged signal used by adapters that need timeout plus external abort. */
export function createAbortTimeoutSignal(
  options: IAbortTimeoutSignalOptions = {}
): IAbortTimeoutSignal {
  /** Preserve boundary option read order, including the no-timeout fast path. */
  const timeoutMs = options.timeoutMs
  /** External cancellation may be returned directly when no timeout was requested. */
  const externalSignal = options.signal
  /** Cleanup diagnostics remain caller-owned. */
  const report = options.report ?? hostRethrowReporter
  if (timeoutMs === undefined) return { signal: externalSignal, dispose: () => undefined }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    throw attachErrorIdentity(
      new RangeError(UtilsErrorText.invalidArgument('timeoutMs', 'a finite non-negative number')),
      { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
    )
  return new AbortTimeoutSignal(timeoutMs, externalSignal, report, options)
}

/** Describes a lazy operation whose cooperative cancellation observes the supplied signal. */
export type IAbortOperation<T> = ITimeoutOperation<T>
/**
 * First-in-first-out task queue with a concurrency cap, returned by `createConcurrencyLimiter`.
 * `run` queues a task (a queued task rejects with the abort reason when its `signal` aborts);
 * `close` rejects queued tasks with `LIMITER_CLOSED`; `dispose` closes and waits for running
 * tasks.
 */
export type IConcurrencyLimiter = {
  run<T>(
    task: (context: { readonly signal?: IAbortSignal }) => T | PromiseLike<T>,
    options?: { readonly signal?: IAbortSignal }
  ): Promise<T>
  readonly activeCount: number
  readonly pendingCount: number
  whenIdle(): Promise<void>
  close(reason?: unknown): void
  dispose(reason?: unknown): Promise<void>
}

/** Creates a native Promise deferred without exposing mutable settlement state. */
export function deferred<T>(): IDeferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

/**
 * Runs one synchronous computation immediately while normalizing its value or thrown reason to a
 * native Promise settlement.
 */
export function toPromise<T>(run: () => T): Promise<Awaited<T>> {
  try {
    return Promise.resolve(run())
  } catch (error) {
    return Promise.reject(error)
  }
}

/** Own one sleep settlement, cancellation and cleanup transaction. */
class SleepOperation {
  /** The validated duration is scheduled once without another timer owner. */
  #delayMs: number
  /** The admitted scheduler remains the sole timer and clock owner. */
  #scheduler: IScheduler
  /** The original signal snapshot fixes listener admission and abort observation order. */
  #signals: readonly IAbortSignal[]
  /** The original ref policy is applied to the actual returned timer receipt. */
  #unref: boolean | undefined
  /** Terminal settlement prevents duplicate cleanup and callbacks. */
  #settled: boolean = false
  /** The original scheduler receipt owns timer cancellation and unref. */
  #timer: IScheduledTask | undefined
  /** Admitted listeners are removed in original reverse registration order. */
  #admitted: IAbortSignal[] = []
  /** Native settlement callbacks belong to the same Promise returned to the caller. */
  #resolve!: (value: void | PromiseLike<void>) => void
  /** Rejection preserves the original primary or cleanup reason. */
  #reject!: (reason?: unknown) => void
  /** The single result retains native Promise settlement and identity. */
  readonly promise: Promise<void>
  /** Capture admitted inputs before installing timers or abort listeners. */
  constructor(
    delayMs: number,
    scheduler: IScheduler,
    signals: readonly IAbortSignal[],
    unref: boolean | undefined
  ) {
    this.#delayMs = delayMs
    this.#scheduler = scheduler
    this.#signals = signals
    this.#unref = unref
    this.promise = new Promise<void>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
      this.#run()
    })
  }
  /** Admit resources and start the original operation in its original order. */
  #run(): void {
    try {
      const initial = observeAbort(this.#signals)
      if (initial.kind === 'failed') {
        this.#settled = true
        this.#cleanup(initial.error)
        return
      }
      if (initial.kind === 'aborted') return this.#onAbort()
      this.#timer = this.#scheduler.schedule(() => {
        if (this.#settled) return
        this.#settled = true
        if (this.#cleanup()) this.#resolve()
      }, this.#delayMs)
      if (this.#unref) this.#timer.unref?.()
      for (const candidate of this.#signals) {
        // Own rollback before registration, which may acquire a listener and then throw.
        this.#admitted.push(candidate)
        candidate.addEventListener('abort', this.#onAbort, { once: true })
      }
      const after = observeAbort(this.#signals)
      if (after.kind === 'failed') {
        this.#settled = true
        this.#cleanup(after.error)
      } else if (after.kind === 'aborted') this.#onAbort()
    } catch (error) {
      if (!this.#settled) {
        this.#settled = true
        this.#cleanup(error)
      }
    }
  }
  /** Release the originally admitted resources before publishing settlement. */
  #cleanup = (primaryError?: unknown): boolean => {
    const cleanupErrors: unknown[] = []
    try {
      this.#timer?.cancel()
    } catch (error) {
      cleanupErrors.push(error)
    }
    for (const signal of this.#admitted.reverse())
      try {
        signal.removeEventListener('abort', this.#onAbort)
      } catch (error) {
        cleanupErrors.push(error)
      }
    if (cleanupErrors.length > 0) {
      for (const error of cleanupErrors)
        reportDiagnostic(hostRethrowReporter, error, { operation: 'sleep', phase: 'cleanup' })
    }
    if (primaryError !== undefined) this.#reject(primaryError)
    return primaryError === undefined
  }
  /** Observe the original outside signal and settle its cancellation. */
  #onAbort = (): void => {
    if (this.#settled) return
    const observation = observeAbort(this.#signals)
    this.#settled = true
    this.#cleanup(
      observation.kind === 'failed'
        ? observation.error
        : new UtilsAbortError(observation.kind === 'aborted' ? observation.reason : undefined)
    )
  }
}

/**
 * Waits `delayMs` on the scheduler. Rejects with `UtilsAbortError` when a given signal aborts while
 * waiting, and with `INVALID_ARGUMENT` for a negative or non-finite delay. Timer and listener
 * cleanup always runs; cleanup failures go to `hostRethrowReporter`.
 */
export function sleep(delayMs: number, options?: IAsyncControls): Promise<void> {
  const schedulerOption = options?.scheduler
  const signal = options?.signal
  const signalsOption = options?.signals
  const unref = options?.unref
  const scheduler = schedulerOption ?? systemScheduler
  if (!Number.isFinite(delayMs) || delayMs < 0)
    return Promise.reject(
      attachErrorIdentity(
        new RangeError(UtilsErrorText.invalidArgument('delayMs', 'a finite non-negative number')),
        { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
      )
    )
  if (signal && signalsOption)
    return Promise.reject(
      attachErrorIdentity(
        new TypeError(
          UtilsErrorText.invalidArgument('signal', 'signal and signals are mutually exclusive')
        ),
        { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
      )
    )
  const signals = snapshotSignals(signalsOption, signal)
  return new SleepOperation(delayMs, scheduler, signals, unref).promise
}

type IWithTimeoutOptions = IAsyncControls & {
  readonly timeoutMs: number
  readonly report?: IUtilsReporter
  readonly zeroTimeoutBehavior?: 'skip' | 'start'
  /** Disables internal cancellation allocation for deadline-only operations. */
  readonly cooperativeCancellation?: boolean
  readonly [retryAttemptController]?: {
    readonly controller: IAbortControllerLike
    readonly scope: 'attempt' | 'total'
  }
}

/** Own one withTimeout settlement, cancellation and cleanup transaction. */
class TimeoutOperation<T> {
  /** The admitted user callback stays unchanged and is invoked without a receiver. */
  #operation: ITimeoutOperation<T>
  /** The original signal snapshot fixes listener admission and abort observation order. */
  #signals: readonly IAbortSignal[]
  /** Background and late failures keep the original diagnostic destination. */
  #report: IUtilsReporter
  /** The original cooperative cancellation controller owns the operation signal and reason. */
  #controller: IAbortControllerLike | undefined
  /** The original retry or operation owner determines the deadline error scope. */
  #timeoutScope: 'operation' | 'attempt' | 'total'
  /** The operation receives the same native or inert signal admitted before resource setup. */
  #operationSignal: IAbortSignal | undefined
  /** The validated deadline controls both scheduling and timeout classification. */
  #timeoutMs: number
  /** The original zero-deadline policy decides whether the user callback may start. */
  #zeroTimeoutBehavior: 'skip' | 'start' | undefined
  /** The admitted scheduler remains the sole timer and clock owner. */
  #scheduler: IScheduler
  /** The original ref policy is applied to the actual returned timer receipt. */
  #unref: boolean | undefined
  /** Terminal settlement prevents duplicate cleanup and callbacks. */
  #settled: boolean = false
  /** Deadline settlement suppresses a subsequent outside-abort path. */
  #timedOut: boolean = false
  /** The original scheduler receipt owns timer cancellation and unref. */
  #timer: IScheduledTask | undefined
  /** Admitted listeners are removed in original reverse registration order. */
  #admitted: IAbortSignal[] = []
  /** Native settlement callbacks belong to the same Promise returned to the caller. */
  #resolve!: (value: T | PromiseLike<T>) => void
  /** Rejection preserves the original primary or cleanup reason. */
  #reject!: (reason?: unknown) => void
  /** The single result retains native Promise settlement and identity. */
  readonly promise: Promise<T>
  /** Capture admitted inputs before installing timers or abort listeners. */
  constructor(
    operation: ITimeoutOperation<T>,
    signals: readonly IAbortSignal[],
    report: IUtilsReporter,
    controller: IAbortControllerLike | undefined,
    timeoutScope: 'operation' | 'attempt' | 'total',
    operationSignal: IAbortSignal | undefined,
    timeoutMs: number,
    zeroTimeoutBehavior: 'skip' | 'start' | undefined,
    scheduler: IScheduler,
    unref: boolean | undefined
  ) {
    this.#operation = operation
    this.#signals = signals
    this.#report = report
    this.#controller = controller
    this.#timeoutScope = timeoutScope
    this.#operationSignal = operationSignal
    this.#timeoutMs = timeoutMs
    this.#zeroTimeoutBehavior = zeroTimeoutBehavior
    this.#scheduler = scheduler
    this.#unref = unref
    this.promise = new Promise<T>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
      this.#run()
    })
  }
  /** Admit resources and start the original operation in its original order. */
  #run(): void {
    const initial = observeAbort(this.#signals)
    if (initial.kind === 'failed')
      return this.#finish(() => this.#reject(initial.error), initial.error)
    if (initial.kind === 'aborted') return this.#onAbort()
    if (this.#timeoutMs === 0 && this.#zeroTimeoutBehavior !== 'start') {
      const error = new UtilsTimeoutError(this.#timeoutScope, 0)
      return this.#finish(() => this.#reject(error), error)
    }
    this.#timer = this.#scheduler.schedule(this.#onTimeout, this.#timeoutMs)
    if (this.#settled) this.#timer.cancel()
    try {
      if (this.#unref) this.#timer.unref?.()
    } catch (error) {
      this.#finish(() => this.#reject(error), error)
      return
    }
    try {
      for (const candidate of this.#signals) {
        // A failed registration may still have installed the listener.
        this.#admitted.push(candidate)
        candidate.addEventListener('abort', this.#onAbort, { once: true })
      }
    } catch (error) {
      this.#finish(() => this.#reject(error), error)
      return
    }
    const after = observeAbort(this.#signals)
    if (after.kind === 'failed') return this.#finish(() => this.#reject(after.error), after.error)
    if (after.kind === 'aborted') return this.#onAbort()
    if (this.#settled) return
    try {
      Promise.resolve(
        Reflect.apply(this.#operation, undefined, [
          {
            // A controller signal is a host `AbortSignal`; the inert fallback is only reachable when
            // the overloads promise the operation a structural signal instead.
            signal: (this.#operationSignal ?? inertTimeoutSignal) as INativeAbortSignal
          }
        ])
      ).then(this.#onFulfilled, this.#onRejected)
    } catch (error) {
      this.#finish(() => this.#reject(error), error)
    }
  }
  /** Abort cooperative work with the deadline error before releasing resources and rejecting. */
  #onTimeout = (): void => {
    this.#timedOut = true
    /** The same deadline error first cancels cooperative work and then becomes the rejection. */
    const timeoutError = new UtilsTimeoutError(this.#timeoutScope, this.#timeoutMs)
    this.#controller?.abort(timeoutError)
    this.#finish(() => this.#reject(timeoutError), timeoutError)
  }
  /** Publish the original value only after the admitted timer and listeners have been released. */
  #onFulfilled = (value: T): void => {
    if (this.#settled) return
    this.#finish(() => this.#resolve(value))
  }
  /** Keep late failure reporting separate from the original cleanup-before-rejection transaction. */
  #onRejected = (error: unknown): void => {
    if (this.#settled) {
      if (!acknowledgesCancellation(error, this.#controller?.signal))
        reportDiagnostic(this.#report, error, {
          operation: 'withTimeout',
          phase: 'late-rejection'
        })
      return
    }
    this.#finish(() => this.#reject(error), error)
  }
  /** Release the originally admitted resources before publishing settlement. */
  #finish = (callback: () => void, primaryError?: unknown): void => {
    if (this.#settled) return
    this.#settled = true
    const cleanupErrors: unknown[] = []
    try {
      this.#timer?.cancel()
    } catch (error) {
      cleanupErrors.push(error)
    }
    for (const signal of this.#admitted.reverse())
      try {
        signal.removeEventListener('abort', this.#onAbort)
      } catch (error) {
        cleanupErrors.push(error)
      }
    if (cleanupErrors.length > 0) {
      const errors = primaryError === undefined ? cleanupErrors : [primaryError, ...cleanupErrors]
      this.#reject(
        errors.length === 1 ? errors[0] : new AggregateError(errors, UtilsErrorText.cleanupFailed)
      )
      return
    }
    callback()
  }
  /** Observe the original outside signal and settle its cancellation. */
  #onAbort = (): void => {
    if (!this.#timedOut) {
      const observation = observeAbort(this.#signals)
      if (observation.kind === 'failed') {
        this.#finish(() => this.#reject(observation.error), observation.error)
        return
      }
      const reason = observation.kind === 'aborted' ? observation.reason : undefined
      this.#controller?.abort(reason)
      const error = new UtilsAbortError(reason)
      this.#finish(() => this.#reject(error), error)
    }
  }
}

/**
 * Runs a lazy operation with a deadline. With cooperative cancellation on (the default) the
 * operation receives the host `AbortSignal` of an internal controller; at the deadline that signal
 * aborts first and the call then rejects with `UtilsTimeoutError` (`DEADLINE_EXCEEDED`, scope
 * `operation`). An outside abort rejects with `UtilsAbortError`. When cooperative cancellation is
 * off, the operation receives a structural never-aborting signal instead.
 *
 * After settling, a late success is discarded and a late rejection goes to `report`, except a
 * rejection with the `reason` of the operation's own signal, which only acknowledges the
 * cancellation (as `fetch(url, { signal })` does). Cleanup failures reject the call, aggregated
 * with any primary error.
 */
export function withTimeout<T>(
  operation: ITimeoutOperation<T>,
  options: IWithTimeoutOptions & { readonly cooperativeCancellation?: true }
): Promise<T>
export function withTimeout<T>(
  operation: IDeadlineOnlyOperation<T>,
  options: IWithTimeoutOptions
): Promise<T>

export function withTimeout<T>(
  operation: ITimeoutOperation<T>,
  options: IWithTimeoutOptions
): Promise<T> {
  const timeoutMs = options.timeoutMs
  const signal = options.signal
  const signalsOption = options.signals
  const reportOption = options.report
  const zeroTimeoutBehavior = options.zeroTimeoutBehavior
  const cooperativeCancellation = options.cooperativeCancellation ?? true
  const scheduler = options.scheduler ?? systemScheduler
  const unref = options.unref
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    return Promise.reject(
      attachErrorIdentity(
        new RangeError(UtilsErrorText.invalidArgument('timeoutMs', 'a finite non-negative number')),
        { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
      )
    )
  if (signal && signalsOption)
    return Promise.reject(
      attachErrorIdentity(
        new TypeError(
          UtilsErrorText.invalidArgument('signal', 'signal and signals are mutually exclusive')
        ),
        { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
      )
    )
  const signals = snapshotSignals(signalsOption, signal)
  const report = reportOption ?? hostRethrowReporter
  /** Retry owns the attempt controller and the semantic scope of its deadline. */
  const internalDeadline = options[retryAttemptController]
  const controller =
    internalDeadline?.controller ?? (cooperativeCancellation ? new AbortController() : undefined)
  /** Ordinary withTimeout calls retain operation scope; retry passes its actual budget scope. */
  const timeoutScope = internalDeadline?.scope ?? 'operation'
  const operationSignal = controller?.signal
  return new TimeoutOperation<T>(
    operation,
    signals,
    report,
    controller,
    timeoutScope,
    operationSignal,
    timeoutMs,
    zeroTimeoutBehavior,
    scheduler,
    unref
  ).promise
}

/** Own one raceWithAbort settlement, cancellation and cleanup transaction. */
class AbortRaceOperation<T> {
  /** The admitted user callback stays unchanged and is invoked without a receiver. */
  #operation: IAbortOperation<T>
  /** The original signal snapshot fixes listener admission and abort observation order. */
  #signals: readonly IAbortSignal[]
  /** Background and late failures keep the original diagnostic destination. */
  #report: IUtilsReporter
  /** The caller retains its existing cleanup rejection or reporting policy. */
  #cleanupPolicy: 'reject' | 'report'
  /** The original cooperative cancellation controller owns the operation signal and reason. */
  #controller: AbortController
  /** The operation receives the same native or inert signal admitted before resource setup. */
  #operationSignal: INativeAbortSignal
  /** Terminal settlement prevents duplicate cleanup and callbacks. */
  #settled: boolean = false
  /** Admitted listeners are removed in original reverse registration order. */
  #admitted: IAbortSignal[] = []
  /** Native settlement callbacks belong to the same Promise returned to the caller. */
  #resolve!: (value: T | PromiseLike<T>) => void
  /** Rejection preserves the original primary or cleanup reason. */
  #reject!: (reason?: unknown) => void
  /** The single result retains native Promise settlement and identity. */
  readonly promise: Promise<T>
  /** Capture admitted inputs before installing timers or abort listeners. */
  constructor(
    operation: IAbortOperation<T>,
    signals: readonly IAbortSignal[],
    report: IUtilsReporter,
    cleanupPolicy: 'reject' | 'report',
    controller: AbortController,
    operationSignal: INativeAbortSignal
  ) {
    this.#operation = operation
    this.#signals = signals
    this.#report = report
    this.#cleanupPolicy = cleanupPolicy
    this.#controller = controller
    this.#operationSignal = operationSignal
    this.promise = new Promise<T>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
      this.#run()
    })
  }
  /** Admit resources and start the original operation in its original order. */
  #run(): void {
    const initial = observeAbort(this.#signals)
    if (initial.kind === 'failed')
      return this.#finish(() => this.#reject(initial.error), initial.error)
    if (initial.kind === 'aborted') return this.#onAbort()
    try {
      for (const candidate of this.#signals) {
        // A failed registration may still have installed the listener.
        this.#admitted.push(candidate)
        candidate.addEventListener('abort', this.#onAbort, { once: true })
      }
    } catch (error) {
      const admissionError = attachErrorIdentity(
        new TypeError(UtilsErrorText.invalidArgument('signal', 'abort listener admission failed'), {
          cause: error
        }),
        { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
      )
      this.#finish(() => this.#reject(admissionError), admissionError)
      return
    }
    const after = observeAbort(this.#signals)
    if (after.kind === 'failed') return this.#finish(() => this.#reject(after.error), after.error)
    if (after.kind === 'aborted') return this.#onAbort()
    try {
      Promise.resolve(
        Reflect.apply(this.#operation, undefined, [{ signal: this.#operationSignal }])
      ).then(this.#onFulfilled, this.#onRejected)
    } catch (error) {
      this.#finish(() => this.#reject(error), error)
    }
  }
  /** Publish the original value after listener cleanup, retaining the configured cleanup policy. */
  #onFulfilled = (value: T): void => {
    if (!this.#settled) this.#finish(() => this.#resolve(value))
  }
  /** Report late failures once without replacing the first rejection or its original cause. */
  #onRejected = (error: unknown): void => {
    if (this.#settled) {
      if (!acknowledgesCancellation(error, this.#controller.signal))
        reportDiagnostic(this.#report, error, {
          operation: 'raceWithAbort',
          phase: 'late-rejection'
        })
      return
    }
    this.#finish(() => this.#reject(error), error)
  }
  /** Release the originally admitted resources before publishing settlement. */
  #finish = (callback: () => void, primaryError?: unknown): void => {
    if (this.#settled) return
    this.#settled = true
    const cleanupErrors: unknown[] = []
    for (const candidate of this.#admitted.reverse())
      try {
        candidate.removeEventListener('abort', this.#onAbort)
      } catch (error) {
        cleanupErrors.push(error)
      }
    if (cleanupErrors.length > 0) {
      if (this.#cleanupPolicy === 'report') {
        for (const error of cleanupErrors)
          reportDiagnostic(this.#report, error, { operation: 'raceWithAbort', phase: 'cleanup' })
        callback()
        return
      }
      const errors = primaryError === undefined ? cleanupErrors : [primaryError, ...cleanupErrors]
      this.#reject(
        errors.length === 1 ? errors[0] : new AggregateError(errors, UtilsErrorText.cleanupFailed)
      )
      return
    }
    callback()
  }
  /** Observe the original outside signal and settle its cancellation. */
  #onAbort = (): void => {
    const observation = observeAbort(this.#signals)
    if (observation.kind === 'failed') {
      this.#finish(() => this.#reject(observation.error), observation.error)
      return
    }
    const reason = observation.kind === 'aborted' ? observation.reason : undefined
    this.#controller.abort(reason)
    const error = new UtilsAbortError(reason)
    this.#finish(() => this.#reject(error), error)
  }
}

/**
 * Races a lazy operation against one or more outside abort signals without creating a timer. An
 * abort rejects with `UtilsAbortError` and aborts the operation's own signal; late rejections other
 * than that signal's `reason` go to `report`.
 */
export function raceWithAbort<T>(
  operation: IAbortOperation<T>,
  options: Pick<IAsyncControls, 'signal' | 'signals'> & {
    readonly report?: IUtilsReporter
    readonly cleanupPolicy?: 'reject' | 'report'
  } = {}
): Promise<T> {
  const signal = options.signal
  const signalsOption = options.signals
  const reportOption = options.report
  const cleanupPolicy = options.cleanupPolicy ?? 'reject'
  if (signal && signalsOption)
    return Promise.reject(
      attachErrorIdentity(
        new TypeError(
          UtilsErrorText.invalidArgument('signal', 'signal and signals are mutually exclusive')
        ),
        { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
      )
    )
  const signals = snapshotSignals(signalsOption, signal)
  const report = reportOption ?? hostRethrowReporter
  const controller = new AbortController()
  const operationSignal = controller.signal as unknown as INativeAbortSignal
  return new AbortRaceOperation<T>(
    operation,
    signals,
    report,
    cleanupPolicy,
    controller,
    operationSignal
  ).promise
}

/** Retries serially under explicit attempt and total limits. */
async function retryCore<T>(
  operation: (context: IRetryContext) => T | PromiseLike<T>,
  options: {
    readonly maxAttempts: number
    readonly shouldRetry: (
      error: unknown,
      context: IRetryFailureContext
    ) => boolean | PromiseLike<boolean>
    readonly delay?: number | ((error: unknown, context: IRetryFailureContext) => number)
    readonly totalTimeoutMs?: number
    readonly attemptTimeoutMs?: number
    readonly signal?: IAbortSignal
    readonly signals?: readonly IAbortSignal[]
    readonly zeroTimeoutBehavior?: 'skip' | 'start'
    readonly report?: IUtilsReporter
    readonly unref?: boolean
    readonly scheduler?: IScheduler
  }
): Promise<T> {
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1)
    throw attachErrorIdentity(
      new RangeError(UtilsErrorText.invalidArgument('maxAttempts', 'a positive safe integer')),
      { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
    )
  if (options.signal && options.signals)
    throw attachErrorIdentity(
      new TypeError(
        UtilsErrorText.invalidArgument('signal', 'signal and signals are mutually exclusive')
      ),
      { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
    )
  for (const [name, value] of [
    ['totalTimeoutMs', options.totalTimeoutMs],
    ['attemptTimeoutMs', options.attemptTimeoutMs]
  ] as const)
    if (value !== undefined && (!Number.isFinite(value) || value < 0))
      throw attachErrorIdentity(
        new RangeError(UtilsErrorText.invalidArgument(name, 'a finite non-negative number')),
        { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
      )
  const externalSignals = options.signals ?? (options.signal ? [options.signal] : [])
  const preAbort = observeAbort(externalSignals)
  if (preAbort.kind === 'failed') throw preAbort.error
  if (preAbort.kind === 'aborted') throw new UtilsAbortError(preAbort.reason)
  let lastError: unknown
  const startedAt = options.scheduler?.now() ?? systemScheduler.now()
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const attemptController = new AbortController()
    const signal = attemptController.signal as unknown as INativeAbortSignal
    const remainingMs =
      options.totalTimeoutMs === undefined
        ? undefined
        : options.totalTimeoutMs - ((options.scheduler?.now() ?? systemScheduler.now()) - startedAt)
    try {
      if (remainingMs !== undefined && remainingMs <= 0)
        throw new UtilsTimeoutError('total', options.totalTimeoutMs!)
      /** Lend only the same three inputs retained by the original attempt callback. */
      const operationInput = { operation, attempt, remainingMs }
      const operationCall: ITimeoutOperation<T> = (context) => {
        /** The original operation remains a plain call rather than a method on its input record. */
        const operation = operationInput.operation
        return operation({
          attempt: operationInput.attempt,
          signal: context.signal,
          remainingMs: operationInput.remainingMs
        })
      }
      if (options.attemptTimeoutMs !== undefined) {
        return await withTimeout(operationCall, {
          timeoutMs: options.attemptTimeoutMs,
          scheduler: options.scheduler,
          signals: externalSignals,
          zeroTimeoutBehavior: options.zeroTimeoutBehavior,
          unref: options.unref,
          report: options.report,
          [retryAttemptController]: { controller: attemptController, scope: 'attempt' }
        })
      }
      if (remainingMs !== undefined) {
        try {
          return await withTimeout(operationCall, {
            timeoutMs: remainingMs,
            scheduler: options.scheduler,
            signals: externalSignals,
            zeroTimeoutBehavior: options.zeroTimeoutBehavior,
            unref: options.unref,
            report: options.report,
            [retryAttemptController]: { controller: attemptController, scope: 'total' }
          })
        } catch (error) {
          if (error instanceof UtilsTimeoutError)
            throw new UtilsTimeoutError('total', options.totalTimeoutMs!)
          throw error
        }
      }
      if (externalSignals.length === 0) return await operationCall({ signal })
      return await runWithAbort(
        () => operationCall({ signal }),
        externalSignals,
        attemptController,
        options.report
      )
    } catch (error) {
      const externalAbort = observeAbort(externalSignals)
      if (externalAbort.kind === 'failed') throw externalAbort.error
      if (externalAbort.kind === 'aborted' && error instanceof UtilsAbortError) throw error
      lastError = error
      /** A late policy retains its original inputs without also retaining the business operation. */
      const policyInput = { options, error, attempt, signal }
      if (
        attempt >= options.maxAttempts ||
        (error instanceof UtilsTimeoutError && error.scope === 'total') ||
        !(await (externalSignals.length === 0
          ? options.shouldRetry(error, { attempt, maxAttempts: options.maxAttempts, signal })
          : runWithAbort(
              () =>
                policyInput.options.shouldRetry(policyInput.error, {
                  attempt: policyInput.attempt,
                  maxAttempts: policyInput.options.maxAttempts,
                  signal: policyInput.signal
                }),
              externalSignals,
              attemptController,
              options.report
            )))
      )
        throw error
      const delay =
        typeof options.delay === 'function'
          ? options.delay(error, { attempt, maxAttempts: options.maxAttempts, signal })
          : (options.delay ?? 0)
      if (!Number.isFinite(delay) || delay < 0)
        throw attachErrorIdentity(
          new RangeError(UtilsErrorText.invalidArgument('delay', 'a finite non-negative number')),
          { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
        )
      if (options.totalTimeoutMs !== undefined) {
        const elapsed = (options.scheduler?.now() ?? systemScheduler.now()) - startedAt
        if (elapsed + delay >= options.totalTimeoutMs)
          throw new UtilsTimeoutError('total', options.totalTimeoutMs)
      }
      if (delay > 0)
        await sleep(delay, {
          scheduler: options.scheduler,
          signals: externalSignals,
          unref: options.unref
        })
    }
  }
  throw lastError
}

/**
 * Retries an operation serially. Each failure asks `shouldRetry`; `false` or the last of
 * `maxAttempts` throws that original error unchanged. `delay` sets the wait between attempts,
 * `attemptTimeoutMs` limits each attempt and `totalTimeoutMs` limits the whole run, waits included
 * (`UtilsTimeoutError` with scope `attempt` / `total`). An outside abort ends the run with
 * `UtilsAbortError`. Invalid limits reject with `INVALID_ARGUMENT`.
 */
export function retry<T>(
  operation: (context: IRetryContext) => T | PromiseLike<T>,
  options: Parameters<typeof retryCore<T>>[1]
): Promise<T> {
  const snapshot = { ...options }
  if (snapshot.signal && snapshot.signals)
    return Promise.reject(
      attachErrorIdentity(
        new TypeError(
          UtilsErrorText.invalidArgument('signal', 'signal and signals are mutually exclusive')
        ),
        { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
      )
    )
  if (snapshot.totalTimeoutMs === undefined) return retryCore(operation, snapshot)
  const externalSignals = snapshotSignals(snapshot.signals, snapshot.signal)
  /** The original entry snapshot is still spread only when its existing deadline operation runs. */
  const executionInput = { operation, snapshot, externalSignals }
  return withTimeout(
    ({ signal }) =>
      retryCore(executionInput.operation, {
        ...executionInput.snapshot,
        signal: undefined,
        signals: [...executionInput.externalSignals, signal],
        totalTimeoutMs: executionInput.snapshot.totalTimeoutMs
      }),
    {
      timeoutMs: snapshot.totalTimeoutMs,
      scheduler: snapshot.scheduler,
      unref: snapshot.unref,
      zeroTimeoutBehavior: snapshot.zeroTimeoutBehavior,
      // The outer retry owner already settles the caller; late attempt cancellation is contained
      // here rather than delegated to the host uncaught-exception reporter.
      report: snapshot.report ?? (() => undefined)
    }
  ).catch((error: unknown) => {
    if (error instanceof UtilsTimeoutError && error.scope === 'operation')
      throw new UtilsTimeoutError('total', snapshot.totalTimeoutMs!)
    throw error
  })
}

/** Own one runWithAbort settlement, cancellation and cleanup transaction. */
class RetryAbortOperation<T> {
  /** The admitted user callback stays unchanged and is invoked without a receiver. */
  #operation: () => T | PromiseLike<T>
  /** The original signal snapshot fixes listener admission and abort observation order. */
  #signals: readonly IAbortSignal[]
  /** The original cooperative cancellation controller owns the operation signal and reason. */
  #controller: AbortController
  /** Background and late failures keep the original diagnostic destination. */
  #report: IUtilsReporter
  /** Admitted listeners are removed in original reverse registration order. */
  #admitted: IAbortSignal[] = []
  /** Terminal settlement prevents duplicate cleanup and callbacks. */
  #settled: boolean = false
  /** Native settlement callbacks belong to the same Promise returned to the caller. */
  #resolve!: (value: T | PromiseLike<T>) => void
  /** Rejection preserves the original primary or cleanup reason. */
  #reject!: (reason?: unknown) => void
  /** The single result retains native Promise settlement and identity. */
  readonly promise: Promise<T>
  /** Capture admitted inputs before installing timers or abort listeners. */
  constructor(
    operation: () => T | PromiseLike<T>,
    signals: readonly IAbortSignal[],
    controller: AbortController,
    report: IUtilsReporter
  ) {
    this.#operation = operation
    this.#signals = signals
    this.#controller = controller
    this.#report = report
    this.promise = new Promise<T>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
      this.#run()
    })
  }
  /** Admit resources and start the original operation in its original order. */
  #run(): void {
    const initial = observeAbort(this.#signals)
    if (initial.kind === 'failed' || initial.kind === 'aborted') return this.#onAbort()
    try {
      for (const signal of this.#signals) {
        this.#admitted.push(signal)
        signal.addEventListener('abort', this.#onAbort, { once: true })
        const after = observeAbort([signal])
        if (after.kind !== 'none') return this.#onAbort()
      }
    } catch (error) {
      this.#settled = true
      this.#cleanup()
      this.#reject(error)
      return
    }
    const afterAdmission = observeAbort(this.#signals)
    if (afterAdmission.kind !== 'none') return this.#onAbort()
    Promise.resolve()
      .then(this.#operation)
      .then(
        (value) => {
          if (this.#settled) return
          this.#settled = true
          this.#cleanup()
          this.#resolve(value)
        },
        (error) => {
          if (this.#settled) {
            if (!acknowledgesCancellation(error, this.#controller.signal))
              reportDiagnostic(this.#report, error, { operation: 'retry', phase: 'late-rejection' })
            return
          }
          this.#settled = true
          this.#cleanup()
          this.#reject(error)
        }
      )
  }
  /** Release the originally admitted resources before publishing settlement. */
  #cleanup = (): void => {
    for (const signal of this.#admitted.reverse())
      try {
        signal.removeEventListener('abort', this.#onAbort)
      } catch (error) {
        reportDiagnostic(this.#report, error, { operation: 'retry', phase: 'cleanup' })
      }
  }
  /** Observe the original outside signal and settle its cancellation. */
  #onAbort = (): void => {
    if (this.#settled) return
    const observation = observeAbort(this.#signals)
    this.#settled = true
    if (observation.kind === 'failed') {
      this.#cleanup()
      this.#reject(observation.error)
      return
    }
    const reason = observation.kind === 'aborted' ? observation.reason : undefined
    this.#controller.abort(reason)
    this.#cleanup()
    this.#reject(new UtilsAbortError(reason))
  }
}

/**
 * Runs an operation with externally linked cooperative cancellation when no deadline wrapper
 * exists.
 */
function runWithAbort<T>(
  operation: () => T | PromiseLike<T>,
  signals: readonly IAbortSignal[],
  controller: AbortController,
  report: IUtilsReporter = hostRethrowReporter
): Promise<T> {
  return new RetryAbortOperation<T>(operation, signals, controller, report).promise
}

/** A queued admission owns its original callback, settlement and cancellation receipt. */
type IConcurrencyEntry = {
  readonly task: (context: { readonly signal?: IAbortSignal }) => unknown
  readonly signal?: IAbortSignal
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
  cancelled: boolean
  pending: boolean
  cleanup: () => void
}

/** One limiter owns FIFO admission, active tasks and idempotent terminal cleanup. */
class ConcurrencyLimiter implements IConcurrencyLimiter {
  /** The validated concurrency never changes after construction. */
  #concurrency: number
  /** Cleanup diagnostics use the same captured reporter as every queued admission. */
  #report: IUtilsReporter
  /** Consumed slots remain until amortized compaction releases their callback references. */
  #queue: IConcurrencyEntry[] = []
  /** The cursor avoids moving the remaining queue for each admitted task. */
  #queueHead = 0
  /** Running task count is independent of pending cancellation and terminal admission. */
  #active = 0
  /** Exact live queued count avoids rescanning the queue for every shared-signal cancellation. */
  #pending = 0
  /** Closing rejects queued and future work while already running tasks retain their own signals. */
  #closed = false
  /** Every rejected terminal admission observes the same original close reason. */
  #closeReason: unknown
  /** Concurrent idle waiters share this promise until all live work settles. */
  #idlePromise: Promise<void> | undefined
  /** Idle settlement releases only the currently published promise. */
  #idleResolve: (() => void) | undefined
  /** Repeated asynchronous disposal preserves its original promise identity. */
  #disposal: Promise<void> | undefined

  /** Capture options before validation, preserving existing getter order and native error identity. */
  constructor(options: { readonly concurrency: number; readonly report?: IUtilsReporter }) {
    this.#concurrency = options.concurrency
    this.#report = options.report ?? hostRethrowReporter
    if (!Number.isSafeInteger(this.#concurrency) || this.#concurrency < 1)
      throw attachErrorIdentity(
        new RangeError(UtilsErrorText.invalidArgument('concurrency', 'a positive safe integer')),
        { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
      )
  }

  /** Validate cancellation before allocating one admission; queued and active work remain distinct. */
  run = <T>(
    task: (context: { readonly signal?: IAbortSignal }) => T | PromiseLike<T>,
    options?: { readonly signal?: IAbortSignal }
  ): Promise<T> => {
    /** Read the caller's signal once before any observer can reenter admission. */
    const signal = options?.signal
    if (this.#closed) return Promise.reject(this.#closeReason)
    /** Both malformed signals and already aborted signals retain their original failure path. */
    const initial = observeAbort(signal === undefined ? [] : [signal])
    if (initial.kind === 'failed') return Promise.reject(initial.error)
    if (initial.kind === 'aborted') return Promise.reject(initial.reason ?? new UtilsAbortError())
    return new Promise<T>((resolve, reject) => {
      this.#admit(task, signal, resolve as (value: unknown) => void, reject)
    })
  }

  /** Count actual running callbacks, not caller promises or queued entries. */
  get activeCount(): number {
    return this.#active
  }

  /** Cancelled queue slots no longer contribute to pending admission. */
  get pendingCount(): number {
    return this.#pending
  }

  /** Share one pending idle receipt; an already idle limiter returns a resolved native promise. */
  whenIdle = (): Promise<void> => {
    if (this.#active === 0 && this.#queueHead >= this.#queue.length) return Promise.resolve()
    this.#idlePromise ??= new Promise<void>((resolve) => {
      this.#idleResolve = resolve
    })
    return this.#idlePromise
  }

  /** Close admission once and reject queued tasks in original submission order. */
  close = (reason?: unknown): void => {
    if (this.#closed) return
    this.#closed = true
    this.#closeReason = reason ?? limiterClosedError()
    for (let index = this.#queueHead; index < this.#queue.length; index++) {
      /** This entry still owns a queued cancellation receipt until it is marked terminal. */
      const entry = this.#queue[index]
      if (entry.cancelled) continue
      entry.cancelled = true
      this.#releasePending(entry)
      this.#cleanup(entry)
      entry.reject(this.#closeReason)
    }
    this.#queueHead = this.#queue.length
    this.#compact()
    this.#signalIdle()
  }

  /** Terminal cleanup retains one promise even when active work finishes after close. */
  dispose = (reason?: unknown): Promise<void> => {
    if (!this.#disposal) {
      this.close(reason)
      this.#disposal = this.whenIdle()
    }
    return this.#disposal
  }

  /** Install the native abort receipt before committing the entry to the FIFO. */
  #admit(
    task: IConcurrencyEntry['task'],
    signal: IAbortSignal | undefined,
    resolve: IConcurrencyEntry['resolve'],
    reject: IConcurrencyEntry['reject']
  ): void {
    /** An admission is not pending until it has actually entered the queue. */
    const entry: IConcurrencyEntry = {
      task,
      signal,
      resolve,
      reject,
      cancelled: false,
      pending: false,
      cleanup: () => undefined
    }
    /** The callback reads explicit admission state; native listener identity survives removal. */
    const onAbort = (): void => this.#cancel(entry)
    entry.cleanup = () => signal?.removeEventListener('abort', onAbort)
    try {
      signal?.addEventListener('abort', onAbort, { once: true })
      /** A synchronous signal transition during listener registration wins queue admission. */
      const after = observeAbort(signal === undefined ? [] : [signal])
      if (after.kind !== 'none') {
        entry.cancelled = true
        entry.cleanup()
        reject(after.kind === 'failed' ? after.error : (after.reason ?? new UtilsAbortError()))
        this.#signalIdle()
        return
      }
      if (this.#closed) {
        entry.cancelled = true
        entry.cleanup()
        reject(this.#closeReason)
        this.#signalIdle()
        return
      }
    } catch (error) {
      entry.cancelled = true
      this.#cleanup(entry)
      reject(error)
      this.#signalIdle()
      return
    }
    this.#queue.push(entry)
    if (!entry.cancelled) {
      entry.pending = true
      this.#pending++
    }
    this.#drain()
  }

  /** Queued cancellation rejects only its own admission and does not cancel another running task. */
  #cancel(entry: IConcurrencyEntry): void {
    if (entry.cancelled) return
    /** Abort state is read before terminal marking, matching the original failure precedence. */
    const observation = observeAbort(entry.signal === undefined ? [] : [entry.signal])
    entry.cancelled = true
    this.#releasePending(entry)
    entry.reject(
      observation.kind === 'failed'
        ? observation.error
        : observation.kind === 'aborted'
          ? (observation.reason ?? new UtilsAbortError())
          : new UtilsAbortError()
    )
    this.#cleanup(entry)
    this.#signalIdle()
  }

  /** Remove a committed pending count once; early abort before enqueue has no count to release. */
  #releasePending(entry: IConcurrencyEntry): void {
    if (!entry.pending) return
    entry.pending = false
    this.#pending--
  }

  /** Cleanup diagnostics never replace the original task/admission rejection. */
  #cleanup(entry: IConcurrencyEntry): void {
    try {
      entry.cleanup()
    } catch (error) {
      reportDiagnostic(this.#report, error, { operation: 'limiter', phase: 'cleanup' })
    }
  }

  /** Admit callbacks in FIFO order; settlement releases capacity before starting the next member. */
  #drain(): void {
    while (
      !this.#closed &&
      this.#active < this.#concurrency &&
      this.#queueHead < this.#queue.length
    ) {
      /** The next slot may already have been cancelled by its own native signal. */
      const entry = this.#queue[this.#queueHead++]
      if (!entry || entry.cancelled) continue
      this.#releasePending(entry)
      this.#compact()
      this.#cleanup(entry)
      this.#active++
      Promise.resolve()
        .then(() => entry.task({ signal: entry.signal }))
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.#active--
          this.#drain()
          this.#signalIdle()
        })
    }
  }

  /**
   * Compact only after a fixed minimum and at least half consumption, giving amortized O(1)
   * dequeue.
   */
  #compact(): void {
    if (this.#queueHead < 64 || this.#queueHead * 2 < this.#queue.length) return
    this.#queue.splice(0, this.#queueHead)
    this.#queueHead = 0
  }

  /** Complete all current idle waiters in O(1), including shared-signal cancellation batches. */
  #signalIdle(): void {
    if (this.#active !== 0 || this.#pending !== 0) return
    /** Release the published receipt before user promise continuations run. */
    const resolve = this.#idleResolve
    this.#idleResolve = undefined
    this.#idlePromise = undefined
    resolve?.()
  }
}

/**
 * Creates a queue that runs at most `concurrency` tasks at once and starts the rest in submission
 * order. A queued task whose `run` signal aborts rejects with the abort reason and never starts; a
 * running task only sees the cancellation on its `context.signal`. Throws `INVALID_ARGUMENT`
 * (`RangeError`) when `concurrency` is not a positive safe integer.
 */
export function createConcurrencyLimiter(options: {
  readonly concurrency: number
  readonly report?: IUtilsReporter
}): IConcurrencyLimiter {
  return new ConcurrencyLimiter(options)
}

function reportDiagnostic(
  reporter: IUtilsReporter,
  error: unknown,
  context: Parameters<IUtilsReporter>[1]
): void {
  try {
    reporter(error, context)
  } catch (reporterError) {
    if (reporter !== hostRethrowReporter)
      hostRethrowReporter(reporterError, { operation: context.operation, phase: 'reporter' })
  }
}

function limiterClosedError(): Error {
  return attachErrorIdentity(new Error(UtilsErrorText.limiterClosed), {
    source: ERROR_SOURCE,
    code: UtilsErrorCode.limiterClosed
  })
}

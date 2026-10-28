/** Own Promise completion, retry and concurrency primitives together with their native cleanup. */
import { ERROR_SOURCE, UtilsErrorCode } from './error-code.ts'
import { UtilsErrorText } from './error-text.ts'
import {
  attachErrorIdentity,
  tryReadProperty,
  UtilsAbortError,
  UtilsTimeoutError
} from './error.ts'
import { systemScheduler, type IScheduledTask, type IScheduler } from './scheduler.ts'
import { reportUnhandledError } from './host-report.ts'

export { UtilsAbortError } from './error.ts'

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
/** Context passed to `shouldRetry`, `beforeRetry` and a `delay` function after a failed attempt. */
export type IRetryFailureContext = IRetryContext & { readonly maxAttempts: number }
/**
 * When `retry` starts each attempt, relative to the code that reached it. Leaving the option unset
 * keeps the default: an attempt runs synchronously unless outside signals are attached, in which
 * case it waits one microtask. - `sync`: start in the same turn, before `retry` (or its previous
 * wait) returns control. - `microtask`: start after one microtask. - `macrotask`: start in a
 * zero-delay timer task of the scheduler.
 *
 * An outside abort that lands while a deferred start is waiting still wins before the attempt runs.
 */
export const RetryAttemptStart = {
  sync: 'sync',
  microtask: 'microtask',
  macrotask: 'macrotask'
} as const
export type RetryAttemptStart = keyof typeof RetryAttemptStart
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

/**
 * Attempt cancellation owner for `retry`. The host `AbortController` is allocated only when some
 * code reads `signal`, so an attempt that never looks at its signal costs no controller. An abort
 * before allocation is recorded and replayed onto the controller when it is created, so a late
 * reader still sees an aborted signal with the original reason.
 */
class LazyAbortController implements IAbortControllerLike {
  /** Host controller, created on the first `signal` read. */
  #controller: AbortController | undefined
  /** Whether `abort` ran before the controller existed. */
  #aborted = false
  /** Reason recorded by an abort that ran before the controller existed. */
  #reason: unknown

  /** Returns the attempt signal, allocating the controller and replaying a recorded abort. */
  get signal(): INativeAbortSignal {
    if (this.#controller === undefined) {
      this.#controller = new AbortController()
      if (this.#aborted) this.#controller.abort(this.#reason)
    }
    return this.#controller.signal as unknown as INativeAbortSignal
  }

  /** Whether `error` only acknowledges this attempt's cancellation (its exact abort reason). */
  acknowledges(error: unknown): boolean {
    if (this.#controller !== undefined)
      return acknowledgesCancellation(error, this.#controller.signal as unknown as IAbortSignal)
    return this.#aborted && Object.is(error, this.#reason)
  }

  /** Aborts the attempt; like the native controller, only the first call has an effect. */
  abort(reason?: unknown): void {
    if (this.#controller !== undefined) {
      this.#controller.abort(reason)
      return
    }
    if (this.#aborted) return
    this.#aborted = true
    this.#reason = reason
  }
}

/**
 * Context one attempt receives. `signal` is a prototype getter, so the host controller is created
 * only when the operation reads it; `attempt` and `remainingMs` are own data properties.
 */
class RetryAttemptContext implements IRetryContext {
  /** 1-based attempt number. */
  readonly attempt: number
  /** Remaining total budget at the attempt start, when a total deadline is set. */
  readonly remainingMs: number | undefined
  /** Lazy cancellation owner of this attempt. */
  readonly #owner: LazyAbortController

  /** Captures the attempt facts. */
  constructor(owner: LazyAbortController, attempt: number, remainingMs: number | undefined) {
    this.#owner = owner
    this.attempt = attempt
    this.remainingMs = remainingMs
  }

  /** The attempt signal, allocated on first read. */
  get signal(): INativeAbortSignal {
    return this.#owner.signal
  }
}

/** Context shared by `shouldRetry`, `beforeRetry` and `delay` after one failure. */
class RetryFailureContext implements IRetryFailureContext {
  /** 1-based number of the failed attempt. */
  readonly attempt: number
  /** Configured attempt limit. */
  readonly maxAttempts: number
  /** Lazy cancellation owner of the failed attempt. */
  readonly #owner: LazyAbortController

  /** Captures the failure facts. */
  constructor(owner: LazyAbortController, attempt: number, maxAttempts: number) {
    this.#owner = owner
    this.attempt = attempt
    this.maxAttempts = maxAttempts
  }

  /** The failed attempt's signal, allocated on first read. */
  get signal(): INativeAbortSignal {
    return this.#owner.signal
  }
}

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
        if (this.#settled) return
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
  const controller = cooperativeCancellation ? new AbortController() : undefined
  const operationSignal = controller?.signal
  return new TimeoutOperation<T>(
    operation,
    signals,
    report,
    controller,
    'operation',
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
        if (this.#settled) return
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

/**
 * Options of `retry`. `maxAttempts` and `shouldRetry` are required; every other field is optional.
 * `signal` and `signals` are mutually exclusive.
 */
export type IRetryOptions = {
  readonly maxAttempts: number
  readonly shouldRetry: (
    error: unknown,
    context: IRetryFailureContext
  ) => boolean | PromiseLike<boolean>
  readonly delay?: number | ((error: unknown, context: IRetryFailureContext) => number)
  /**
   * Awaited after `shouldRetry` accepts a failure and before `delay`, for example to wait until a
   * connection is usable again. It counts against `totalTimeoutMs`; an outside abort ends the run
   * with `UtilsAbortError`; a rejection ends the run with that rejection unchanged.
   */
  readonly beforeRetry?: (error: unknown, context: IRetryFailureContext) => void | PromiseLike<void>
  /** When each attempt starts; see `RetryAttemptStart`. Unset keeps the default timing. */
  readonly attemptStart?: RetryAttemptStart
  readonly totalTimeoutMs?: number
  readonly attemptTimeoutMs?: number
  readonly signal?: IAbortSignal
  readonly signals?: readonly IAbortSignal[]
  readonly zeroTimeoutBehavior?: 'skip' | 'start'
  readonly report?: IUtilsReporter
  readonly unref?: boolean
  readonly scheduler?: IScheduler
}

/** Policy hook a failure is currently waiting on. */
type IRetryPolicyStep = 'shouldRetry' | 'beforeRetry'

/** Builds the INVALID_ARGUMENT error for one rejected retry option. */
function invalidRetryOption(
  ErrorType: typeof RangeError | typeof TypeError,
  name: string,
  expected: string
): Error {
  return attachErrorIdentity(new ErrorType(UtilsErrorText.invalidArgument(name, expected)), {
    source: ERROR_SOURCE,
    code: UtilsErrorCode.invalidArgument
  })
}

/** Whether an optional retry duration is absent or a finite non-negative number. */
function isRetryDuration(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value >= 0)
}

/** Listener options of the run-long outside abort listener; shared to avoid one object per run. */
const retryAbortListenerOptions = { once: true } as const

/** Empty signal list of a run without outside signals. */
const noRetrySignals: readonly IAbortSignal[] = Object.freeze([])

/** Copies the outside signals of a retry snapshot; the copy fixes cleanup ownership. */
function copyRetrySignals(options: IRetryOptions): readonly IAbortSignal[] {
  if (options.signals !== undefined) return [...options.signals]
  return options.signal === undefined ? noRetrySignals : [options.signal]
}

/** Returns the first invalid-option error of a retry snapshot, or undefined when it is valid. */
function validateRetryOptions(options: IRetryOptions): Error | undefined {
  if (options.signal && options.signals)
    return invalidRetryOption(TypeError, 'signal', 'signal and signals are mutually exclusive')
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1)
    return invalidRetryOption(RangeError, 'maxAttempts', 'a positive safe integer')
  if (!isRetryDuration(options.totalTimeoutMs))
    return invalidRetryOption(RangeError, 'totalTimeoutMs', 'a finite non-negative number')
  if (!isRetryDuration(options.attemptTimeoutMs))
    return invalidRetryOption(RangeError, 'attemptTimeoutMs', 'a finite non-negative number')
  if (options.attemptStart !== undefined && !Object.hasOwn(RetryAttemptStart, options.attemptStart))
    return invalidRetryOption(TypeError, 'attemptStart', 'one of sync, microtask, macrotask')
  return undefined
}

/**
 * One `retry` run: a state machine that owns every resource of the run. The outside signals are
 * listened to once for the whole run, the total deadline is one timer, and each attempt adds only
 * its lazy cancellation owner (plus a timer when `attemptTimeoutMs` is set). Each step runs from
 * the callback of the previous one, so no async function or nested deadline wrapper is involved.
 *
 * Default timing matches the earlier composition: an attempt starts synchronously, except that it
 * waits one microtask when outside signals are attached and no deadline is configured; policy hooks
 * are deferred one microtask when an outside signal or the total deadline is present.
 */
class RetryRun<T> {
  /** The caller's operation, invoked without a receiver. */
  readonly #operation: (context: IRetryContext) => T | PromiseLike<T>
  /** Options read once at entry. */
  readonly #options: IRetryOptions
  /** Frozen outside signals; listened to for the whole run. */
  readonly #signals: readonly IAbortSignal[]
  /** Destination of late rejections and cleanup failures. */
  readonly #report: IUtilsReporter
  /** Clock and timer owner of every wait of the run. */
  readonly #scheduler: IScheduler
  /** Clock reading at entry when a total budget exists; the budget counts from here. */
  readonly #startedAt: number
  /** True when attempts start one microtask late by default (signals, no deadline). */
  readonly #deferStart: boolean
  /** True when policy hooks start one microtask late (signals or total deadline). */
  readonly #deferPolicy: boolean
  /** Reporter operation of a late attempt rejection: deadline-limited runs keep `withTimeout`. */
  readonly #lateOperation: 'retry' | 'withTimeout'
  /** Signals whose abort listener was installed, removed in reverse order at the end. */
  readonly #admitted: IAbortSignal[] = []
  /** Pending total-deadline timer. */
  #totalTimer: IScheduledTask | undefined
  /** Pending timer of the current attempt deadline, start deferral or backoff. */
  #stepTimer: IScheduledTask | undefined
  /** 1-based number of the current or last attempt. */
  #attempt = 0
  /** Cancellation owner of the current attempt; also the token that identifies it. */
  #controller: LazyAbortController | undefined
  /** True while the current attempt's result is still awaited. */
  #attemptOpen = false
  /** Failure being decided by the policy hooks. */
  #error: unknown
  /** Context shared by the policy hooks of the failure being decided. */
  #failureContext: IRetryFailureContext | undefined
  /** Set once; every later callback becomes inert. */
  #settled = false
  /** Settles the public Promise with a value. */
  #resolve!: (value: T) => void
  /** Settles the public Promise with a failure. */
  #reject!: (reason: unknown) => void
  /** Public Promise of the run. */
  readonly promise: Promise<T>

  /** Captures a validated snapshot and starts the run synchronously. */
  constructor(operation: (context: IRetryContext) => T | PromiseLike<T>, options: IRetryOptions) {
    this.#operation = operation
    this.#options = options
    this.#signals = copyRetrySignals(options)
    this.#report = options.report ?? hostRethrowReporter
    this.#scheduler = options.scheduler ?? systemScheduler
    this.#startedAt = options.totalTimeoutMs === undefined ? 0 : this.#scheduler.now()
    const deadline = options.totalTimeoutMs !== undefined || options.attemptTimeoutMs !== undefined
    this.#deferStart = this.#signals.length > 0 && !deadline
    this.#deferPolicy = this.#signals.length > 0 || options.totalTimeoutMs !== undefined
    this.#lateOperation = deadline ? 'withTimeout' : 'retry'
    this.promise = new Promise<T>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
    })
    this.#start()
  }

  /** Checks the outside signals, admits listeners, arms the total deadline and starts attempt 1. */
  #start(): void {
    const initial = observeAbort(this.#signals)
    if (initial.kind === 'failed') return this.#fail(initial.error)
    if (initial.kind === 'aborted') return this.#fail(new UtilsAbortError(initial.reason))
    const total = this.#options.totalTimeoutMs
    if (total === 0) return this.#fail(new UtilsTimeoutError('total', 0))
    try {
      for (const signal of this.#signals) {
        // A failed registration may still have installed the listener.
        this.#admitted.push(signal)
        signal.addEventListener('abort', this.#onAbort, retryAbortListenerOptions)
        if (signal.aborted) return this.#onAbort()
      }
      if (total !== undefined) this.#totalTimer = this.#schedule(this.#onTotalTimeout, total)
    } catch (error) {
      return this.#fail(error)
    }
    this.#beginAttempt()
  }

  /** Ends the run when an outside signal is aborted or unreadable; true when it did. */
  #abortedNow(): boolean {
    if (observeAbort(this.#signals).kind === 'none') return false
    this.#onAbort()
    return true
  }

  /** Schedules one timer of this run, applying the unref policy. */
  #schedule(callback: () => void, delayMs: number): IScheduledTask {
    const task = this.#scheduler.schedule(callback, delayMs)
    if (this.#options.unref) task.unref?.()
    return task
  }

  /** Starts the next attempt at the configured start point. */
  #beginAttempt(): void {
    this.#attempt += 1
    const start =
      this.#options.attemptStart ??
      (this.#deferStart ? RetryAttemptStart.microtask : RetryAttemptStart.sync)
    if (start === RetryAttemptStart.sync) return this.#runAttempt()
    if (start === RetryAttemptStart.microtask) {
      void Promise.resolve().then(this.#onDeferredStart)
      return
    }
    try {
      this.#stepTimer = this.#schedule(this.#onDeferredStart, 0)
    } catch (error) {
      this.#fail(error)
    }
  }

  /** Runs a deferred attempt unless the run ended or an outside abort landed meanwhile. */
  readonly #onDeferredStart = (): void => {
    this.#stepTimer = undefined
    if (this.#settled || this.#abortedNow()) return
    this.#runAttempt()
  }

  /** Invokes the operation once with a fresh lazy cancellation owner. */
  #runAttempt(): void {
    const total = this.#options.totalTimeoutMs
    const remainingMs =
      total === undefined ? undefined : total - (this.#scheduler.now() - this.#startedAt)
    if (remainingMs !== undefined && remainingMs <= 0)
      return this.#fail(new UtilsTimeoutError('total', total!))
    const controller = new LazyAbortController()
    this.#controller = controller
    this.#attemptOpen = true
    const attemptTimeoutMs = this.#options.attemptTimeoutMs
    if (attemptTimeoutMs !== undefined) {
      if (attemptTimeoutMs === 0 && this.#options.zeroTimeoutBehavior !== 'start') {
        this.#attemptOpen = false
        return this.#onFailure(new UtilsTimeoutError('attempt', 0))
      }
      try {
        this.#stepTimer = this.#schedule(this.#onAttemptTimeout, attemptTimeoutMs)
      } catch (error) {
        return this.#fail(error)
      }
    }
    let result: T | PromiseLike<T>
    try {
      result = Reflect.apply(this.#operation, undefined, [
        new RetryAttemptContext(controller, this.#attempt, remainingMs)
      ])
    } catch (error) {
      return this.#onAttemptRejected(controller, error)
    }
    Promise.resolve(result).then(
      (value) => this.#onAttemptFulfilled(controller, value),
      (error: unknown) => this.#onAttemptRejected(controller, error)
    )
  }

  /** Whether `controller` belongs to the attempt whose result is still awaited. */
  #isOpen(controller: LazyAbortController): boolean {
    return !this.#settled && this.#attemptOpen && controller === this.#controller
  }

  /** Ends the current attempt: cancels its deadline timer. */
  #closeAttempt(): void {
    this.#attemptOpen = false
    this.#cancelStepTimer()
  }

  /** Publishes the value of the current attempt; a late value is discarded. */
  #onAttemptFulfilled(controller: LazyAbortController, value: T): void {
    if (!this.#isOpen(controller)) return
    this.#closeAttempt()
    this.#settle()
    this.#resolve(value)
  }

  /** Hands the failure of the current attempt to the policy, or reports a late one. */
  #onAttemptRejected(controller: LazyAbortController, error: unknown): void {
    if (!this.#isOpen(controller)) {
      if (!controller.acknowledges(error))
        reportDiagnostic(this.#report, error, {
          operation: this.#lateOperation,
          phase: 'late-rejection'
        })
      return
    }
    this.#closeAttempt()
    this.#onFailure(error)
  }

  /** Fails the current attempt at its own deadline, cancelling its signal first. */
  readonly #onAttemptTimeout = (): void => {
    this.#stepTimer = undefined
    if (this.#settled || !this.#attemptOpen) return
    this.#attemptOpen = false
    const error = new UtilsTimeoutError('attempt', this.#options.attemptTimeoutMs!)
    this.#controller!.abort(error)
    this.#onFailure(error)
  }

  /** Ends the run on the last attempt or a total deadline; otherwise asks `shouldRetry`. */
  #onFailure(error: unknown): void {
    if (this.#abortedNow()) return
    if (
      this.#attempt >= this.#options.maxAttempts ||
      (error instanceof UtilsTimeoutError && error.scope === 'total')
    )
      return this.#fail(error)
    this.#error = error
    this.#failureContext = new RetryFailureContext(
      this.#controller!,
      this.#attempt,
      this.#options.maxAttempts
    )
    this.#runPolicy('shouldRetry')
  }

  /** Calls one policy hook with the current failure. */
  #callPolicy(step: IRetryPolicyStep): unknown {
    return step === 'shouldRetry'
      ? Reflect.apply(this.#options.shouldRetry, undefined, [this.#error, this.#failureContext])
      : Reflect.apply(this.#options.beforeRetry!, undefined, [this.#error, this.#failureContext])
  }

  /** Runs a policy hook now or one microtask later, then continues with its result. */
  #runPolicy(step: IRetryPolicyStep): void {
    const controller = this.#controller!
    if (this.#deferPolicy) {
      Promise.resolve()
        .then(() => (this.#settled || this.#abortedNow() ? undefined : this.#callPolicy(step)))
        .then(
          (value) => this.#onPolicyResult(controller, step, value),
          (error: unknown) => this.#onPolicyError(controller, error)
        )
      return
    }
    let result: unknown
    try {
      result = this.#callPolicy(step)
    } catch (error) {
      return this.#onPolicyError(controller, error)
    }
    Promise.resolve(result).then(
      (value) => this.#onPolicyResult(controller, step, value),
      (error: unknown) => this.#onPolicyError(controller, error)
    )
  }

  /** Ends the run with a policy failure, or reports one that arrives after the run ended. */
  #onPolicyError(controller: LazyAbortController, error: unknown): void {
    if (this.#settled) {
      if (!controller.acknowledges(error))
        reportDiagnostic(this.#report, error, { operation: 'retry', phase: 'late-rejection' })
      return
    }
    this.#fail(error)
  }

  /** Continues after `shouldRetry` or `beforeRetry` resolved. */
  #onPolicyResult(controller: LazyAbortController, step: IRetryPolicyStep, value: unknown): void {
    if (this.#settled || controller !== this.#controller) return
    if (step === 'shouldRetry') {
      if (!value) return this.#fail(this.#error)
      if (this.#options.beforeRetry !== undefined) return this.#runPolicy('beforeRetry')
    }
    this.#scheduleNext()
  }

  /** Waits for the backoff, if any, then starts the next attempt. */
  #scheduleNext(): void {
    const option = this.#options.delay
    let delay: number
    try {
      delay =
        typeof option === 'function'
          ? Reflect.apply(option, undefined, [this.#error, this.#failureContext])
          : (option ?? 0)
    } catch (error) {
      return this.#fail(error)
    }
    if (!Number.isFinite(delay) || delay < 0)
      return this.#fail(invalidRetryOption(RangeError, 'delay', 'a finite non-negative number'))
    const total = this.#options.totalTimeoutMs
    if (total !== undefined && this.#scheduler.now() - this.#startedAt + delay >= total)
      return this.#fail(new UtilsTimeoutError('total', total))
    this.#error = undefined
    this.#failureContext = undefined
    if (delay === 0) return this.#beginAttempt()
    try {
      this.#stepTimer = this.#schedule(this.#onDelayDone, delay)
    } catch (error) {
      this.#fail(error)
    }
  }

  /** Starts the next attempt once the backoff elapsed. */
  readonly #onDelayDone = (): void => {
    this.#stepTimer = undefined
    if (!this.#settled) this.#beginAttempt()
  }

  /** Ends the run at the total deadline, cancelling the current attempt first. */
  readonly #onTotalTimeout = (): void => {
    this.#totalTimer = undefined
    if (this.#settled) return
    const error = new UtilsTimeoutError('total', this.#options.totalTimeoutMs!)
    this.#controller?.abort(error)
    this.#fail(error)
  }

  /** Ends the run on an outside abort, cancelling the current attempt with the same reason. */
  readonly #onAbort = (): void => {
    if (this.#settled) return
    const observation = observeAbort(this.#signals)
    if (observation.kind === 'failed') return this.#fail(observation.error)
    const reason = observation.kind === 'aborted' ? observation.reason : undefined
    this.#controller?.abort(reason)
    this.#fail(new UtilsAbortError(reason))
  }

  /** Rejects the run after releasing its resources. */
  #fail(error: unknown): void {
    if (this.#settled) return
    this.#settle()
    this.#reject(error)
  }

  /** Cancels the pending step timer, reporting a failing cancel. */
  #cancelStepTimer(): void {
    const timer = this.#stepTimer
    this.#stepTimer = undefined
    try {
      timer?.cancel()
    } catch (error) {
      reportDiagnostic(this.#report, error, { operation: 'retry', phase: 'cleanup' })
    }
  }

  /** Marks the run settled and releases timers and listeners; failures are reported. */
  #settle(): void {
    this.#settled = true
    this.#cancelStepTimer()
    const total = this.#totalTimer
    this.#totalTimer = undefined
    try {
      total?.cancel()
    } catch (error) {
      reportDiagnostic(this.#report, error, { operation: 'retry', phase: 'cleanup' })
    }
    for (const signal of this.#admitted.reverse())
      try {
        signal.removeEventListener('abort', this.#onAbort)
      } catch (error) {
        reportDiagnostic(this.#report, error, { operation: 'retry', phase: 'cleanup' })
      }
    this.#admitted.length = 0
    this.#error = undefined
    this.#failureContext = undefined
  }
}

/**
 * Retries an operation serially. Each failure asks `shouldRetry`; `false` or the last of
 * `maxAttempts` throws that original error unchanged. `delay` sets the wait between attempts,
 * `attemptTimeoutMs` limits each attempt and `totalTimeoutMs` limits the whole run, waits included
 * (`UtilsTimeoutError` with scope `attempt` / `total`). An outside abort ends the run with
 * `UtilsAbortError`. `beforeRetry` is awaited between an accepted failure and `delay`;
 * `attemptStart` chooses when each attempt starts (`RetryAttemptStart`). Each attempt's `signal` is
 * created only when read. Invalid options reject with `INVALID_ARGUMENT`; cleanup failures and late
 * rejections go to `report`.
 */
export function retry<T>(
  operation: (context: IRetryContext) => T | PromiseLike<T>,
  options: IRetryOptions
): Promise<T> {
  const snapshot = { ...options }
  const invalid = validateRetryOptions(snapshot)
  if (invalid !== undefined) return Promise.reject(invalid)
  return new RetryRun(operation, snapshot).promise
}

/** Cleared queue tombstones retain no caller callback or cancellation closure. */
function concurrencyNoop(): void {}

/** A live admission owns callbacks only until its original terminal completion point. */
type IConcurrencyEntry = {
  task: (context: { readonly signal?: IAbortSignal }) => unknown
  signal?: IAbortSignal
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
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
  /** Scalar tombstones retain original cursor ordering until amortized compaction removes them. */
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
      this.#cleanup(entry.cleanup)
      entry.reject(this.#closeReason)
      this.#releaseCallbacks(entry)
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
      cleanup: concurrencyNoop
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
        this.#releaseCallbacks(entry)
        this.#signalIdle()
        return
      }
      if (this.#closed) {
        entry.cancelled = true
        entry.cleanup()
        reject(this.#closeReason)
        this.#releaseCallbacks(entry)
        this.#signalIdle()
        return
      }
    } catch (error) {
      entry.cancelled = true
      this.#cleanup(entry.cleanup)
      reject(error)
      this.#releaseCallbacks(entry)
      this.#signalIdle()
      return
    }
    this.#queue.push(entry)
    if (!entry.cancelled) {
      entry.pending = true
      this.#pending++
    } else this.#releaseCallbacks(entry)
    this.#drain()
  }

  /** Queued cancellation rejects only its own admission and does not cancel another running task. */
  #cancel(entry: IConcurrencyEntry): void {
    if (entry.cancelled) return
    /** A reason getter may close and clear this entry before this original callback resumes. */
    const { reject, cleanup } = entry
    /** Abort state is read before terminal marking, matching the original failure precedence. */
    const observation = observeAbort(entry.signal === undefined ? [] : [entry.signal])
    /** Registration and selected-entry cleanup may reenter before a task is actually queued. */
    const pending = entry.pending
    entry.cancelled = true
    this.#releasePending(entry)
    reject(
      observation.kind === 'failed'
        ? observation.error
        : observation.kind === 'aborted'
          ? (observation.reason ?? new UtilsAbortError())
          : new UtilsAbortError()
    )
    this.#cleanup(cleanup)
    if (pending) this.#releaseCallbacks(entry)
    this.#signalIdle()
  }

  /** Remove a committed pending count once; early abort before enqueue has no count to release. */
  #releasePending(entry: IConcurrencyEntry): void {
    if (!entry.pending) return
    entry.pending = false
    this.#pending--
  }

  /** Cleanup diagnostics never replace the original task/admission rejection. */
  #cleanup(cleanup: IConcurrencyEntry['cleanup']): void {
    try {
      cleanup()
    } catch (error) {
      reportDiagnostic(this.#report, error, { operation: 'limiter', phase: 'cleanup' })
    }
  }

  /** Retire references after original user callbacks; scalar queue and idle state stay unchanged. */
  #releaseCallbacks(entry: IConcurrencyEntry): void {
    entry.task = concurrencyNoop
    entry.signal = undefined
    entry.resolve = concurrencyNoop
    entry.reject = concurrencyNoop
    entry.cleanup = concurrencyNoop
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
      this.#cleanup(entry.cleanup)
      this.#active++
      Promise.resolve()
        .then(() => entry.task({ signal: entry.signal }))
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.#active--
          this.#drain()
          this.#signalIdle()
          this.#releaseCallbacks(entry)
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

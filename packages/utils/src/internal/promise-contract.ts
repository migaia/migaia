/** Canonical promise type and value contracts; implementations depend inward on this module. */
import type { IScheduler } from './scheduler-contract.ts'

/** Stable operation tags consumed by the public reporter across Promise resource owners. */
export const PromiseOperation = {
  /** Linked timeout signals report failures from releasing their timer and listener. */
  'abort-timeout-signal': 'abort-timeout-signal',
  /** Deadline-owned work retains this tag for late failures and cleanup. */
  withTimeout: 'withTimeout',
  /** Abort races retain this tag independently of deadline work. */
  raceWithAbort: 'raceWithAbort',
  /** Retry policy and resource diagnostics retain their original operation identity. */
  retry: 'retry',
  /** Sleep cleanup reports through its original operation channel. */
  sleep: 'sleep',
  /** Queued concurrency work reports through its original limiter channel. */
  limiter: 'limiter'
} as const

/** Keys and values intentionally share the public diagnostic operation domain. */
export type PromiseOperation = keyof typeof PromiseOperation

/** Stable failure phases distinguish secondary failures without replacing the primary outcome. */
export const PromiseDiagnosticPhase = {
  /** Work that rejects after settlement remains observable through this phase. */
  'late-rejection': 'late-rejection',
  /** Resource release failures retain their existing cleanup classification. */
  cleanup: 'cleanup',
  /** A failed diagnostic sink is forwarded with its original reporter classification. */
  reporter: 'reporter'
} as const

/** Phase keys match their unchanged wire-visible string values. */
export type PromiseDiagnosticPhase = keyof typeof PromiseDiagnosticPhase

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

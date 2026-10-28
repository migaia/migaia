/** Owns periodic unit health and individual check decisions; scopes own monitor retirement. */
import { createAbortController, type IAbortController } from '@migaia/lifecycle'
import type { ILifecycleScope } from '@migaia/lifecycle'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { SupervisionErrorCode } from './error-code.ts'
import { SupervisionErrorText } from './error-text.ts'
import { createSupervisionError } from './errors.ts'
import { HealthState } from './constants.ts'
import type { IHealthSnapshot, ISupervisorBaseOptions } from './types.ts'

/** One check owns its deadline and decision even after a newer check becomes active. */
class HealthCheck<THandle> {
  /** Monitor receives only actual check transitions and late rejection reports. */
  #monitor: HealthMonitor<THandle>
  /** Unit-local cancellation is distinct from the preceding or following check. */
  #controller: IAbortController
  /** Deadline is cancelled by either completion callback. */
  #deadline: IScheduledTask
  /** Timeout or completion chooses this check's outcome exactly once. */
  #decided = false

  /** Arms the original deadline before publishing the deferred application check. */
  constructor(
    monitor: HealthMonitor<THandle>,
    controller: IAbortController,
    scheduler: IScheduler,
    timeoutMs: number
  ) {
    this.#monitor = monitor
    this.#controller = controller
    this.#deadline = scheduler.schedule(() => this.#timeout(), timeoutMs)
  }

  /** Exposes the exact task used by monitor retirement and completion identity checks. */
  get deadline(): IScheduledTask {
    return this.#deadline
  }

  /** Preserves the original Promise.resolve/then/then scheduling without another async wrapper. */
  start(): void {
    void Promise.resolve()
      .then(() => this.#monitor.check(this.#controller.signal))
      .then(
        () => this.#fulfilled(),
        (error) => this.#rejected(error)
      )
  }

  /** A live deadline clears running before recording this single timeout failure. */
  #timeout(): void {
    if (this.#decided || this.#monitor.closed) return
    this.#decided = true
    this.#monitor.finishRunning()
    this.#controller.abort()
    this.#monitor.recordFailure(undefined, true)
  }

  /** Reports a successful live decision and always removes the original deadline. */
  #fulfilled(): void {
    /** A timed-out predecessor cannot clear a newer check's running state. */
    const current = !this.#decided
    if (current && !this.#monitor.closed) this.#monitor.recordSuccess()
    this.#decided = true
    if (current) this.#monitor.finishRunning()
    this.#deadline.cancel()
    this.#monitor.clearDeadline(this.#deadline)
  }

  /** Preserves original rejection identity, including failures arriving after close or timeout. */
  #rejected(error: unknown): void {
    /** Only the first current decision contributes to the health threshold. */
    const current = !this.#decided
    if (current && !this.#monitor.closed) this.#monitor.recordFailure(error, false)
    else if (!this.#controller.signal.aborted || error !== this.#controller.signal.reason)
      this.#monitor.report(error)
    this.#decided = true
    if (current) this.#monitor.finishRunning()
    this.#deadline.cancel()
    this.#monitor.clearDeadline(this.#deadline)
  }
}

/** Owns monitor state and periodic scheduling; each launched check owns its own decision. */
class HealthMonitor<THandle> {
  /** Monitored handle is retained only for this unit monitor's lifetime. */
  #handle: THandle
  /** Error detail identifies the profile whose threshold was exceeded. */
  #kind: string
  /** Application check and validated timing policy. */
  #health: NonNullable<ISupervisorBaseOptions<THandle>['health']>
  /** Runtime-neutral observation clock and interval/deadline source. */
  #scheduler: IScheduler
  /** Unit failure port invoked synchronously at the configured threshold. */
  #fail: (error: Error) => void
  /** Observer failures and late non-cancellation rejections keep their original identity. */
  #report: (error: unknown) => void
  /** Validated interval between attempts, including skipped overlapping attempts. */
  #intervalMs: number
  /** Single-check timeout does not change when a later interval is skipped. */
  #timeoutMs: number
  /** Consecutive failure limit applied after every rejected or timed-out check. */
  #threshold: number
  /** Consecutive rejected/timed-out checks since the most recent success. */
  #failures = 0
  /** Prevents overlapping current checks while a prior decision remains pending. */
  #running = false
  /** Retirement disables both future scheduling and current-check state publication. */
  #closed = false
  /** Next interval, removed when its monitor scope retires. */
  #interval: IScheduledTask | undefined
  /** Most recently armed deadline, cancelled on retirement. */
  #deadline: IScheduledTask | undefined
  /** Initial cancellation ownership exists before the first periodic check. */
  #controller = createAbortController()
  /** Current check supplies cancellation after its first interval fires. */
  #check: HealthCheck<THandle> | undefined
  /** Last actual monitor phase; readiness cannot manufacture health. */
  #state: HealthState = HealthState.pending
  /** Only real check transitions supply an observation time. */
  #observedAt: number | undefined
  /** Detached snapshot callback preserves the existing returned function contract. */
  readonly snapshot = (): IHealthSnapshot | undefined => this.#snapshot()

  /** Captures existing policy without starting checks before scope ownership is registered. */
  constructor(
    handle: THandle,
    kind: string,
    health: NonNullable<ISupervisorBaseOptions<THandle>['health']>,
    scheduler: IScheduler,
    fail: (error: Error) => void,
    report: (error: unknown) => void
  ) {
    this.#handle = handle
    this.#kind = kind
    this.#health = health
    this.#scheduler = scheduler
    this.#fail = fail
    this.#report = report
    this.#intervalMs = health.intervalMs ?? 5_000
    this.#timeoutMs = health.timeoutMs ?? 2_000
    this.#threshold = health.failureThreshold ?? 3
  }

  /** Registers teardown first, then arms the first interval as the original function did. */
  start(monitors: ILifecycleScope): void {
    monitors.own({ stop: true }, { force: () => this.#close() })
    this.#schedule()
  }

  /** Lets a check distinguish retirement from an ordinary failed decision. */
  get closed(): boolean {
    return this.#closed
  }
  /** Calls application code in the original deferred Promise callback. */
  check(
    signal: Parameters<NonNullable<ISupervisorBaseOptions<THandle>['health']>['check']>[1]
  ): PromiseLike<void> {
    return this.#health.check(this.#handle, signal)
  }
  /** Keeps late rejections on the existing report channel. */
  report(error: unknown): void {
    /** A parameter callback keeps its original undefined receiver. */
    const report = this.#report
    report(error)
  }
  /** Clears only the running flag, including the timeout-before-failure order. */
  finishRunning(): void {
    this.#running = false
  }
  /** A predecessor cannot remove the deadline belonging to a newer check. */
  clearDeadline(deadline: IScheduledTask): void {
    if (this.#deadline === deadline) this.#deadline = undefined
  }

  /** Publishes the successful observation and resets consecutive failures. */
  recordSuccess(): void {
    this.#failures = 0
    this.#state = HealthState.healthy
    this.#observedAt = this.#scheduler.now()
  }

  /** Counts one rejected/timed-out check and fails the unit only at the configured threshold. */
  recordFailure(cause: unknown, timedOut: boolean): void {
    this.#failures++
    this.#state = HealthState.unhealthy
    this.#observedAt = this.#scheduler.now()
    if (this.#failures < this.#threshold || this.#closed) return
    /** A parameter callback keeps its original undefined receiver. */
    const fail = this.#fail
    fail(
      createSupervisionError(
        Error,
        SupervisionErrorCode.unhealthy,
        SupervisionErrorText.unhealthy,
        { ...(timedOut ? {} : { cause }), detail: { kind: this.#kind, timedOut } }
      )
    )
  }

  /** Schedules the next original interval without overlapping application checks. */
  #schedule(): void {
    if (this.#closed) return
    this.#interval = this.#scheduler.schedule(() => this.#tick(), this.#intervalMs)
  }

  /** Re-arms before checking running/closed, preserving scheduler and application-call order. */
  #tick(): void {
    this.#schedule()
    if (this.#running || this.#closed) return
    this.#running = true
    this.#state = HealthState.checking
    this.#observedAt = this.#scheduler.now()
    this.#controller = createAbortController()
    this.#check = new HealthCheck(this, this.#controller, this.#scheduler, this.#timeoutMs)
    this.#deadline = this.#check.deadline
    this.#check.start()
  }

  /** Cancels monitor-owned tasks before aborting the current application signal. */
  #close(): void {
    this.#closed = true
    this.#interval?.cancel()
    this.#deadline?.cancel()
    this.#controller.abort()
  }

  /** A cold read neither schedules work nor retains a retired unit in a public snapshot. */
  #snapshot(): IHealthSnapshot | undefined {
    return this.#closed
      ? undefined
      : {
          state: this.#state,
          failures: this.#failures,
          ...(this.#observedAt === undefined ? {} : { observedAt: this.#observedAt })
        }
  }
}

/** Starts serialized periodic checks and owns all active timers through the monitor scope. */
export function startHealth<THandle>(
  monitors: ILifecycleScope,
  handle: THandle,
  kind: string,
  health: NonNullable<ISupervisorBaseOptions<THandle>['health']>,
  scheduler: IScheduler,
  fail: (error: Error) => void,
  report: (error: unknown) => void
): () => IHealthSnapshot | undefined {
  /** One owner supplies retirement, check state, and the existing detached snapshot function. */
  const monitor = new HealthMonitor(handle, kind, health, scheduler, fail, report)
  monitor.start(monitors)
  return monitor.snapshot
}

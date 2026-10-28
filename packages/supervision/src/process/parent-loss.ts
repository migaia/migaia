/** Owns child-side shutdown cancellation and once-only exit after parent loss. */
import { ProcessField } from './text.js'
import type { IAbortSignal } from '@migaia/utils/promise'
import { createAbortController } from '@migaia/lifecycle'
import { systemScheduler, type IScheduler, type IScheduledTask } from '@migaia/utils/scheduler'
import { ParentLossExitCode } from './constants.js'
import { invalidProcessOption } from './spec.js'

/**
 * Runs inside a child process: when the parent connection is lost, `trigger()` starts `shutdown`
 * once and guarantees a call to `exit` within `graceMs` (default 5000).
 *
 * `exit` receives `ParentLossExitCode.completed` when shutdown settles in time, or `forced` when
 * the grace period ends first or shutdown fails; a shutdown failure is also sent to `report`. When
 * the grace period ends, the signal passed to `shutdown` aborts. Repeated triggers have no effect.
 */
export function createParentLossGuard(options: {
  readonly shutdown: (signal: IAbortSignal) => PromiseLike<void>
  readonly exit: (code: ParentLossExitCode) => void
  readonly report: (error: unknown) => void
  readonly graceMs?: number
  readonly scheduler?: IScheduler
}): { trigger(reason?: unknown): void; readonly triggered: boolean } {
  if (typeof options?.shutdown !== 'function') invalidProcessOption(ProcessField.shutdown)
  if (typeof options.exit !== 'function') invalidProcessOption(ProcessField.exit)
  if (typeof options.report !== 'function') invalidProcessOption(ProcessField.report)
  /** A finite positive grace interval bounds the child shutdown attempt. */
  const graceMs = options.graceMs ?? 5_000
  if (!Number.isFinite(graceMs) || graceMs <= 0) invalidProcessOption(ProcessField.graceMs, true)
  return ParentLossGuard.port(new ParentLossGuard(options, graceMs))
}

/** Public inline options remain unchanged while private state has one named owner. */
type IParentLossOptions = Parameters<typeof createParentLossGuard>[0]

/** One trigger owns one shutdown attempt and exactly one eventual exit call. */
class ParentLossGuard {
  /** Shutdown, exit and report keep the caller's original receiver and identity. */
  #options: IParentLossOptions
  /** Existing admitted grace interval. */
  #graceMs: number
  /** Timer owner remains the injected scheduler or the shared default. */
  #scheduler: IScheduler
  /** Timeout cancellation is delivered to the shutdown attempt. */
  #controller: ReturnType<typeof createAbortController>
  /** Set before invoking shutdown so reentrant triggers cannot start another attempt. */
  #triggered = false
  /** Set before invoking exit so competing completion and timeout paths cannot double-exit. */
  #exited = false
  /** Canceled by either successful completion or failed shutdown. */
  #timer?: IScheduledTask

  /** Resolves timing before the public port is returned. */
  constructor(options: IParentLossOptions, graceMs: number) {
    this.#options = options
    this.#graceMs = graceMs
    this.#scheduler = options.scheduler ?? systemScheduler
    this.#controller = createAbortController()
  }

  /** Preserves own accessor order and receiver-independent public trigger. */
  static port(guard: ParentLossGuard): {
    trigger(reason?: unknown): void
    readonly triggered: boolean
  } {
    return {
      get triggered() {
        return guard.#triggered
      },
      trigger: (reason) => guard.#trigger(reason)
    }
  }

  /** Starts the original shutdown Promise observer with the same synchronous-throw path. */
  #trigger(reason?: unknown): void {
    if (this.#triggered) return
    this.#triggered = true
    this.#timer = this.#scheduler.schedule(() => this.#timeout(reason), this.#graceMs)
    this.#timer.unref?.()
    try {
      Promise.resolve(this.#options.shutdown(this.#controller.signal)).then(
        () => this.#finish(ParentLossExitCode.completed),
        (error) => this.#failed(error)
      )
    } catch (error) {
      this.#failed(error)
    }
  }

  /** Timeout aborts shutdown before issuing its once-only forced exit. */
  #timeout(reason: unknown): void {
    this.#controller.abort(reason)
    this.#finish(ParentLossExitCode.forced)
  }

  /** Shutdown failure is reported before forced exit, preserving original error identity. */
  #failed(error: unknown): void {
    this.#options.report(error)
    this.#finish(ParentLossExitCode.forced)
  }

  /** Cancels the deadline before delivering the first exit result. */
  #finish(code: ParentLossExitCode): void {
    if (this.#exited) return
    this.#exited = true
    this.#timer?.cancel()
    this.#options.exit(code)
  }
}

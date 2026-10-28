/** Owns one synchronous action span. Runtime retains public admission and the untraced fast path. */
import { runReactiveCallback } from '../errors.ts'
import { emitTraceSafely, readDiagnosticClock } from './diagnostics.ts'
import type { IRuntimeInternals } from './internals.ts'
import { ReactiveErrorPhase, ReactiveTracePhase, ReactiveTraceType } from './trace-constants.ts'
import type { IRuntime } from './types.ts'

/** An action owns its clocks and reporter for exactly one synchronous invocation. */
export class TracedAction {
  /** Runtime retains diagnostic error containment and untracked reporting. */
  readonly #runtime: IRuntime
  /** Admitted clocks and trace sink are snapshotted by the owning Runtime. */
  readonly #diagnostics: IRuntimeInternals
  /** Public action label is validated before this owner is constructed. */
  readonly #name: string
  /** Start clock fallback is reused when an ending clock fails. */
  #startedAt = 0
  /** One stable callback reports all clock and sink failures for this span. */
  readonly #reportFailure = (error: unknown): void =>
    this.#runtime.reportError(error, { phase: ReactiveErrorPhase.traceListener })

  /** Captures only the services and action label; construction does not read a diagnostic clock. */
  constructor(runtime: IRuntime, diagnostics: IRuntimeInternals, name: string) {
    this.#runtime = runtime
    this.#diagnostics = diagnostics
    this.#name = name
  }

  /** Emits start, runs the callback once, then emits one success or primary-error terminal event. */
  run<T>(fn: () => T): T {
    this.#startedAt = readDiagnosticClock(this.#diagnostics.now, 0, this.#reportFailure)
    emitTraceSafely(
      {
        timestamp: this.#diagnostics.timestamp,
        emitTrace: this.#diagnostics.emitTrace,
        reportError: this.#reportFailure
      },
      (timestamp) => ({
        type: ReactiveTraceType.action,
        timestamp,
        phase: ReactiveTracePhase.start,
        name: this.#name
      })
    )
    try {
      /** The public callback boundary preserves error identity and synchronous result timing. */
      const result = runReactiveCallback(fn)
      emitTraceSafely(
        {
          timestamp: this.#diagnostics.timestamp,
          emitTrace: this.#diagnostics.emitTrace,
          reportError: this.#reportFailure
        },
        (timestamp) => ({
          type: ReactiveTraceType.action,
          timestamp,
          phase: ReactiveTracePhase.end,
          name: this.#name,
          durationMs:
            readDiagnosticClock(this.#diagnostics.now, this.#startedAt, this.#reportFailure) -
            this.#startedAt
        })
      )
      return result
    } catch (error) {
      emitTraceSafely(
        {
          timestamp: this.#diagnostics.timestamp,
          emitTrace: this.#diagnostics.emitTrace,
          reportError: this.#reportFailure
        },
        (timestamp) => ({
          type: ReactiveTraceType.action,
          timestamp,
          phase: ReactiveTracePhase.error,
          name: this.#name,
          durationMs:
            readDiagnosticClock(this.#diagnostics.now, this.#startedAt, this.#reportFailure) -
            this.#startedAt,
          error
        })
      )
      throw error
    }
  }
}

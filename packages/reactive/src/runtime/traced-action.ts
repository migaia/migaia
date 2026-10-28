/** Owns one synchronous action span. Runtime retains public admission and the untraced fast path. */
import { runReactiveCallback } from '../errors.ts'
import { emitTraceSafely, readDiagnosticClock } from './diagnostics.ts'
import type { IRuntimeInternals } from './internals.ts'
import { ReactiveErrorPhase, ReactiveTracePhase, ReactiveTraceType } from './trace-constants.ts'
import type { IRuntime } from './types.ts'

/** An action owns its clocks and reporter for exactly one synchronous invocation. */
export class TracedAction {
  /** Admitted clocks and trace sink are snapshotted by the owning Runtime. */
  readonly #diagnostics: IRuntimeInternals
  /** Public action label is validated before this owner is constructed. */
  readonly #name: string
  /** Start clock fallback is reused when an ending clock fails. */
  #startedAt = 0
  /** A stable runtime-only reporter avoids a callback back-reference to this short-lived action. */
  readonly #reportFailure: (error: unknown) => void

  /** Captures only the services and action label; construction does not read a diagnostic clock. */
  constructor(runtime: IRuntime, diagnostics: IRuntimeInternals, name: string) {
    this.#diagnostics = diagnostics
    this.#name = name
    this.#reportFailure = (error) =>
      runtime.reportError(error, { phase: ReactiveErrorPhase.traceListener })
  }

  /** Emits start, runs the callback once, then emits one success or primary-error terminal event. */
  run<T>(fn: () => T): T {
    this.#startedAt = readDiagnosticClock(this.#diagnostics.now, 0, this.#reportFailure, undefined)
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
            readDiagnosticClock(
              this.#diagnostics.now,
              this.#startedAt,
              this.#reportFailure,
              undefined
            ) - this.#startedAt
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
            readDiagnosticClock(
              this.#diagnostics.now,
              this.#startedAt,
              this.#reportFailure,
              undefined
            ) - this.#startedAt,
          error
        })
      )
      throw error
    }
  }
}

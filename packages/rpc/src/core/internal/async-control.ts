import { tagRpcError, RpcCoreErrorCode } from '../errors.js'
import { reportDiagnostic } from './diagnostic-reporter.js'
import type { IEndpointTimePort } from './time-port.js'

/** Minimal cancellation signal shape shared by browser, worker and Node consumers. */
export type IAbortSignal = {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

/** Races an operation against timeout/abort controls while cleaning every loser. */
export function raceWithAsyncControl<T>(options: {
  /** Endpoint-owned timer capability; never falls back to host globals. */
  readonly time: Pick<IEndpointTimePort, 'setTimeout'>
  /** A lazy operation avoids starting external side effects before cancellation checks. */
  readonly operation: () => PromiseLike<T>
  readonly timeoutMs?: number | false
  readonly signals?: readonly IAbortSignal[]
  readonly createTimeoutError: () => Error
  readonly createAbortError: (reason?: unknown) => Error
  readonly onTimeout?: () => void | Promise<void>
  /** Closes the owning resource scope when timer setup itself fails. */
  readonly onSetupFailure?: (error: unknown) => void | Promise<void>
  readonly onDiagnostic?: (error: unknown) => void
}): Promise<T> {
  const signals = options.signals ?? []
  if (
    options.timeoutMs !== undefined &&
    options.timeoutMs !== false &&
    (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)
  )
    return Promise.reject(
      tagRpcError(
        new TypeError('timeout must be false or a non-negative finite number'),
        RpcCoreErrorCode.invalidConfig
      )
    )
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timer: { readonly clear: () => void } | undefined
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      try {
        timer?.clear()
      } catch (error) {
        reportDiagnostic(options.onDiagnostic, error)
      }
      for (const signal of signals) {
        try {
          signal.removeEventListener('abort', onAbort)
        } catch (error) {
          reportDiagnostic(options.onDiagnostic, error)
        }
      }
      try {
        callback()
      } catch (error) {
        reject(error)
      }
    }
    const onAbort = (): void =>
      finish(() =>
        reject(options.createAbortError(signals.find((signal) => signal.aborted)?.reason))
      )
    try {
      if (signals.some((signal) => signal.aborted)) {
        onAbort()
        return
      }
      for (const signal of signals) {
        if (settled) break
        signal.addEventListener('abort', onAbort, { once: true })
      }
    } catch (error) {
      finish(() => reject(error))
      return
    }
    if (settled) return
    if (options.timeoutMs !== undefined && options.timeoutMs !== false) {
      try {
        const createdTimer = options.time.setTimeout(() => {
          try {
            const timeoutEffect = options.onTimeout?.()
            void Promise.resolve(timeoutEffect).catch((error) => {
              reportDiagnostic(options.onDiagnostic, error)
            })
          } catch (error) {
            reportDiagnostic(options.onDiagnostic, error)
          }
          finish(() => reject(options.createTimeoutError()))
        }, options.timeoutMs)
        timer = createdTimer
        if (settled) {
          try {
            createdTimer.clear()
          } catch (error) {
            reportDiagnostic(options.onDiagnostic, error)
          }
        }
      } catch (error) {
        let cleanup: void | Promise<void> = undefined
        try {
          cleanup = options.onSetupFailure?.(error)
        } catch (cleanupError) {
          reportDiagnostic(options.onDiagnostic, cleanupError)
        }
        void Promise.resolve(cleanup).then(
          () => finish(() => reject(error)),
          (cleanupError) => {
            reportDiagnostic(options.onDiagnostic, cleanupError)
            finish(() => reject(error))
          }
        )
        return
      }
    }
    let operation: PromiseLike<T>
    try {
      operation = options.operation()
    } catch (error) {
      finish(() => reject(error))
      return
    }
    Promise.resolve(operation).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    )
  })
}

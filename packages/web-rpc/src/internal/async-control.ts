import { tagWebRpcError, WebRpcErrorCode } from '../errors.js'
import { reportDiagnostic } from './diagnostic-reporter.js'

/** Minimal cancellation signal shape shared by browser, worker and Node consumers. */
export type IAbortSignal = {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

/** Detaches Node-compatible timers from process liveness when supported. */
export function unrefTimer<T extends ReturnType<typeof setTimeout>>(timer: T): T {
  ;(timer as T & { unref?: () => void }).unref?.()
  return timer
}

/** Creates an idempotently clearable runtime timer owned by async-control. */
export function createRuntimeTimer(
  task: () => void,
  delayMs: number
): { readonly clear: () => void } {
  const timer = unrefTimer(setTimeout(task, delayMs))
  let cleared = false
  return {
    clear: () => {
      if (cleared) return
      cleared = true
      clearTimeout(timer)
    }
  }
}

/** Waits for a delay while remaining cancellable by any supplied signal. */
export function waitWithSignal(
  delayMs: number,
  signals: readonly IAbortSignal[],
  createAbortError: (reason?: unknown) => Error,
  onDiagnostic?: (error: unknown) => void
): Promise<void> {
  if (!Number.isFinite(delayMs) || delayMs < 0)
    throw tagWebRpcError(new TypeError('delay must be non-negative'), WebRpcErrorCode.invalidConfig)
  return new Promise((resolve, reject) => {
    try {
      if (signals.some((signal) => signal.aborted)) {
        reject(createAbortError(signals.find((signal) => signal.aborted)?.reason))
        return
      }
    } catch (error) {
      reject(error)
      return
    }
    let settled = false
    let timer: { readonly clear: () => void } | undefined
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      try {
        timer?.clear()
      } catch (error) {
        reportDiagnostic(onDiagnostic, error)
      }
      for (const signal of signals) {
        try {
          signal.removeEventListener('abort', onAbort)
        } catch (error) {
          reportDiagnostic(onDiagnostic, error)
        }
      }
      try {
        callback()
      } catch (error) {
        reject(error)
      }
    }
    const onAbort = (): void =>
      finish(() => reject(createAbortError(signals.find((signal) => signal.aborted)?.reason)))
    const registeredSignals: IAbortSignal[] = []
    try {
      for (const signal of signals) {
        if (settled) break
        signal.addEventListener('abort', onAbort, { once: true })
        registeredSignals.push(signal)
      }
    } catch (error) {
      for (const signal of registeredSignals) {
        try {
          signal.removeEventListener('abort', onAbort)
        } catch {}
      }
      reject(error)
      return
    }
    if (settled) return
    try {
      timer = createRuntimeTimer(() => finish(resolve), delayMs)
    } catch (error) {
      finish(() => reject(error))
    }
  })
}

/** Races an operation against timeout/abort controls while cleaning every loser. */
export function raceWithAsyncControl<T>(options: {
  /** A lazy operation avoids starting external side effects before cancellation checks. */
  readonly operation: () => PromiseLike<T>
  readonly timeoutMs?: number | false
  readonly signals?: readonly IAbortSignal[]
  readonly createTimeoutError: () => Error
  readonly createAbortError: (reason?: unknown) => Error
  readonly createTimer?: (task: () => void, delayMs: number) => { readonly clear: () => void }
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
      tagWebRpcError(
        new TypeError('timeout must be false or a non-negative finite number'),
        WebRpcErrorCode.invalidConfig
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
        const createdTimer = (options.createTimer ?? createRuntimeTimer)(() => {
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

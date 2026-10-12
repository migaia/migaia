/** Supported hosts provide the same microtask failure route without a new dependency edge. */
type IReportHost = { queueMicrotask(callback: () => void): void }

/**
 * Report without entering the synchronous RPC path or creating a Promise. Core's public entries do
 * not expose hostRethrowReporter; this small host bridge is the documented contract workaround.
 */
export function reportFailure(error: unknown, onError?: (error: unknown) => void): void {
  try {
    if (onError) {
      onError(error)
      return
    }
  } catch (failure) {
    error = failure
  }
  ;(globalThis as unknown as IReportHost).queueMicrotask(() => {
    throw error
  })
}

/** Watch batching reuses its construction-time callback; it never creates a per-event closure. */
export function enqueueBatch(callback: () => void): void {
  ;(globalThis as unknown as IReportHost).queueMicrotask(callback)
}

/** Supported hosts provide the same microtask failure route without a new dependency edge. */
type IReportHost = { queueMicrotask(callback: () => void): void }

/** Report through the canonical public Core owner without entering the RPC path or adding a Promise. */
export function reportFailure(error: unknown, onError?: (error: unknown) => void): void {
  try {
    if (onError) {
      onError(error)
      return
    }
  } catch (failure) {
    error = failure
  }
  hostRethrowReporter(error, IpcReporterContext)
}

/** Watch batching reuses its construction-time callback; it never creates a per-event closure. */
export function enqueueBatch(callback: () => void): void {
  ;(globalThis as unknown as IReportHost).queueMicrotask(callback)
}
import { hostRethrowReporter, IpcReporterContext } from '@migaia/rpc-core/probe'

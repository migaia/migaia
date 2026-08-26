import { ReactiveErrorPhase, type IRuntime } from '@migaia/reactive'

/** Keeps a failing diagnostic sink from escaping into the reactive commit. */
function reportReactFailure(runtime: IRuntime, error: unknown): void {
  try {
    runtime.reportError(error, { phase: ReactiveErrorPhase.subscriptionListener })
    return
  } catch (reporterError) {
    const host = (globalThis as { reportError?: (value: unknown) => void }).reportError
    try {
      if (host) host(reporterError)
      else console.error(reporterError)
    } catch {
      // Diagnostic reporting is best effort and must not escape the listener boundary.
    }
  }
}

/** Isolate React listener failures from reactive dependency commits. */
export function notifyReact(runtime: IRuntime, onChange: () => void): void {
  try {
    runtime.untracked(onChange)
  } catch (error) {
    reportReactFailure(runtime, error)
  }
}

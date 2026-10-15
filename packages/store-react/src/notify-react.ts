import { ReactiveErrorPhase, type IRuntime } from '@migaia/reactive'

/** Routes listener failures to the Runtime reporter, which already contains reporter failures. */
function reportReactFailure(runtime: IRuntime, error: unknown): void {
  runtime.reportError(error, { phase: ReactiveErrorPhase.subscriptionListener })
}

/** Isolate React listener failures from reactive dependency commits. */
export function notifyReact(runtime: IRuntime, onChange: () => void): void {
  try {
    runtime.untracked(onChange)
  } catch (error) {
    reportReactFailure(runtime, error)
  }
}

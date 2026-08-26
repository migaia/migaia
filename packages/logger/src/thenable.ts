import { assimilateCapturedThen, probeThenable, ThenableProbeKind } from '@migaia/lifecycle'

/** Captures one thenable `.then` function and returns a receiver-preserving Promise. */
export function captureLoggerPromiseLike(value: unknown): Promise<void> | undefined {
  const probe = probeThenable(value)
  if (probe.kind === ThenableProbeKind.notThenable) return undefined
  if (probe.kind === ThenableProbeKind.failed) return Promise.reject(probe.error)
  return assimilateCapturedThen<void>(probe.thenFn, value)
}

/** Observes a terminal reporter result without invoking another reporter on failure. */
export function observeLoggerReporterResult(value: unknown): void {
  try {
    const pending = captureLoggerPromiseLike(value)
    if (pending) void pending.then(undefined, () => undefined)
  } catch {
    // Reporter observation is terminal containment; no second diagnostic attempt is allowed.
  }
}

import {
  assimilateCapturedThen,
  probeThenable,
  ThenableProbeKind,
  inspectThenable,
  observeThenableRejection
} from '@migaia/utils/function'

/** Captures one thenable `.then` function and returns a receiver-preserving Promise. */
export function captureLoggerPromiseLike(value: unknown): Promise<void> | undefined {
  const probe = probeThenable(value)
  if (probe.kind === ThenableProbeKind.notThenable) return undefined
  if (probe.kind === ThenableProbeKind.failed) return Promise.reject(probe.error)
  return assimilateCapturedThen<void>(probe.thenFn, value)
}

/** Utils owns host exception scheduling when this final diagnostic callback throws. */
const throwReporterFailure = (error: unknown): never => {
  throw error
}

/** Reports a terminal sink failure on the existing Utils host channel without recursing into logger. */
export function reportLoggerReporterFailure(error: unknown): void {
  observeThenableRejection(undefined, { error }, throwReporterFailure)
}

/**
 * Captures one reporter result and delegates all asynchronous/getter failures to the same host
 * channel.
 */
export function observeLoggerReporterResult(value: unknown): void {
  observeThenableRejection(value, inspectThenable(value), throwReporterFailure)
}

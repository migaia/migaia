import { assimilateCapturedThen, probeThenable, ThenableProbeKind } from '@migaia/utils/function'

/** The terminal sink deliberately stops after its own failure instead of recursively reporting. */
function ignoreTerminalFailure(): void {}
/** Observe one callback result without rereading a hostile then getter or exposing rejection. */
export function containReporterResult(result: unknown): void {
  /** The canonical helper captures then once and returns getter failures as data. */
  const probe = probeThenable(result)
  if (probe.kind === ThenableProbeKind.thenable)
    void assimilateCapturedThen(probe.thenFn, result).catch(ignoreTerminalFailure)
}
/** Best-effort console reporting is shared by host delivery and standalone durable factories. */
export function defaultLogFailureReporter(error: unknown): void {
  try {
    containReporterResult(globalThis.console?.error(error))
  } catch {
    /* Terminal reporting cannot recurse or throw. */
  }
}
/** Invoke the selected user reporter once and contain every terminal failure. */
export function reportContained(report: (error: unknown) => void, error: unknown): void {
  try {
    containReporterResult(report(error))
  } catch {
    /* A reporter cannot be its own fallback. */
  }
}

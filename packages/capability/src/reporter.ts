import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'

/** Utils owns terminal host reporting when this diagnostic callback throws. */
const throwReporterFailure = (error: unknown): never => {
  throw error
}

/** Runs a diagnostic sink while retaining its own synchronous or asynchronous failure in utils. */
export function invokeCapabilityReporter(invoke: () => unknown): void {
  try {
    /** Captured result is inspected once, preserving hostile then getter and receiver semantics. */
    const result = invoke()
    observeThenableRejection(result, inspectThenable(result), throwReporterFailure)
  } catch (error) {
    observeThenableRejection(undefined, { error }, throwReporterFailure)
  }
}

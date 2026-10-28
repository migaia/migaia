/** Owns abort mechanics; public API admission stays in promise.ts. */
import { PromiseDiagnosticPhase } from './promise-contract.ts'

import { reportUnhandledError as hostRethrowReporter } from '../host-report.ts'
import { UtilsErrorText } from '../error-text.ts'
import type { IScheduledTask } from '../scheduler.ts'
import type { IAbortSignal, IUtilsReporter } from './promise-contract.ts'
import { tryReadProperty } from '../error.ts'

/**
 * The abort-controller members this module consumes, named locally so the published declarations
 * stay self-contained. A real `AbortController` satisfies it directly.
 *
 * The global would work inside this workspace and fail outside it: once a consumer reaches these
 * declarations through a package that aliases them, `lib.dom` or `@types/node` becomes a silent
 * requirement of every such consumer, and a packed consumer compiling under `lib: ["ES2022"]` fails
 * on a name this runtime-neutral package should never have asked it to provide.
 */
export type IAbortControllerLike = {
  readonly signal: IAbortSignal
  abort(reason?: unknown): void
}

/** Result of inspecting external abort state without allowing hostile getters to escape. */
export type IAbortObservation =
  | { readonly kind: 'none' }
  | { readonly kind: 'aborted'; readonly reason: unknown }
  | { readonly kind: 'failed'; readonly error: unknown }

/** Reads the first observed abort and treats a hostile reason getter as that abort's reason. */
export function observeAbort(signals: readonly IAbortSignal[]): IAbortObservation {
  for (const signal of signals) {
    /** One shared read owner preserves first-abort order without creating a signal wrapper array. */
    const observed = readSignalAbort(signal)
    if (observed.kind !== 'none') return observed
  }
  return noAbortObservation
}

/**
 * Internal no-abort result is read-only data shared by observers; it never crosses a public
 * boundary.
 */
const noAbortObservation: IAbortObservation = { kind: 'none' }

/** Read one optional signal without allocating a temporary one-element list. */
export function observeSingleAbort(signal: IAbortSignal | undefined): IAbortObservation {
  if (signal === undefined) return noAbortObservation
  return readSignalAbort(signal)
}

/** One exact signal observation owns the state read and guarded cancellation reason. */
function readSignalAbort(signal: IAbortSignal): IAbortObservation {
  /** Capture the supported signal's state once before attempting its optional reason read. */
  let aborted: boolean
  try {
    aborted = signal.aborted
  } catch (error) {
    return { kind: 'failed', error }
  }
  if (!aborted) return noAbortObservation
  /** Preserve a hostile getter failure as the cancellation reason. */
  const read = tryReadProperty(signal, 'reason')
  return { kind: 'aborted', reason: read.threw ? read.error : read.value }
}

/**
 * Recognizes a late rejection that only acknowledges cancellation. A cooperative operation such as
 * `fetch(url, { signal })` rejects with the exact `reason` of the aborted signal it received. After
 * the race has already settled with that cancellation, this rejection is not a new failure, so it
 * is not reported; any other late rejection still reaches the reporter.
 */
export function acknowledgesCancellation(
  error: unknown,
  signal: IAbortSignal | undefined
): boolean {
  if (signal === undefined || !signal.aborted) return false
  /** The reason is read through the shared guarded read, like every other owned reason site. */
  const read = tryReadProperty(signal, 'reason')
  return !read.threw && Object.is(error, read.value)
}

/** Reads one event-delivered abort reason without redundantly probing mutable aborted state. */
export function observeAbortReason(signal: IAbortSignal): unknown {
  /** The caller owns whether an inaccessible reason is reported or propagated. */
  const read = tryReadProperty(signal, 'reason')
  return read.threw ? read.error : read.value
}

/** Freezes the admission set so reentrant callers cannot change cleanup ownership. */
export function snapshotSignals(
  signalsOption: readonly IAbortSignal[] | undefined,
  signal: IAbortSignal | undefined
): readonly IAbortSignal[] {
  if (signalsOption === undefined && signal === undefined) return noSignals
  return Object.freeze([...(signalsOption ?? [signal!])])
}

/** Reports a secondary failure without replacing an already settled operation result. */
export function reportDiagnostic(
  reporter: IUtilsReporter,
  error: unknown,
  context: Parameters<IUtilsReporter>[1]
): void {
  try {
    reporter(error, context)
  } catch (reporterError) {
    if (reporter !== hostRethrowReporter)
      (hostRethrowReporter as IUtilsReporter)(reporterError, {
        operation: context.operation,
        phase: PromiseDiagnosticPhase['reporter']
      })
  }
}

/** Empty snapshots have no listener or mutation ownership and can share one frozen array. */
const noSignals: readonly IAbortSignal[] = Object.freeze([])

/** Release one optional timer and the admitted listeners in reverse order, retaining every failure. */
export function collectOperationCleanup(
  admitted: readonly IAbortSignal[],
  onAbort: () => void,
  timer?: IScheduledTask
): unknown[] {
  /** Release order determines the secondary-error order exposed by settlement owners. */
  const errors: unknown[] = []
  try {
    timer?.cancel()
  } catch (error) {
    errors.push(error)
  }
  for (let index = admitted.length - 1; index >= 0; index--) {
    try {
      admitted[index].removeEventListener('abort', onAbort)
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

/** Keep a primary failure first; a lone cleanup error retains its exact original identity. */
export function operationCleanupFailure(primaryError: unknown, cleanupErrors: unknown[]): unknown {
  /** Undefined denotes the existing absence-of-primary convention used by all settlement owners. */
  const errors = primaryError === undefined ? cleanupErrors : [primaryError, ...cleanupErrors]
  return errors.length === 1 ? errors[0] : new AggregateError(errors, UtilsErrorText.cleanupFailed)
}

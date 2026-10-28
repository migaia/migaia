/** Reverse disposal convergence; retains first cleanup failure and attaches all later failures. */
import { LifecycleState } from '@migaia/lifecycle'
import type { IResourceContext } from './resource-context.ts'
import { abortError, appendDisposeCleanupErrors } from './resource-failure.ts'

/** Explicit per-disposal failure collection replaces the former captured local accumulator. */
type IResourceCleanupFailures = {
  /** First cleanup failure, including a thrown undefined value. */
  primary: unknown
  /** Distinguishes no failure from a primary whose value is undefined. */
  hasPrimary: boolean
  /** Later cleanup failures attach after the primary in encounter order. */
  errors: unknown[]
}

/** Disposes generation, registered views/setup, graph and signal in the original order. */
export function disposeResourceContext<T>(context: IResourceContext<T>): void {
  if (context.terminal.lifecycle === LifecycleState.terminal) return
  context.terminal.close()
  /** One failure accumulator exists only while teardown runs. */
  const failures: IResourceCleanupFailures = { primary: undefined, hasPrimary: false, errors: [] }
  try {
    context.requests.dispose(abortError())
  } catch (error) {
    recordResourceCleanupFailure(failures, error)
  }
  /** Detachment prevents reentrant registrations from extending this traversal. */
  const cleanups = context.cleanups
  context.cleanups = []
  for (let index = cleanups.length - 1; index >= 0; index -= 1)
    runResourceCleanup(failures, cleanups[index])
  context.refreshScheduled = false
  context.forceRefresh = false
  context.requestPending = false
  context.currentPromise = undefined
  try {
    context.tracking.clear()
  } catch (error) {
    recordResourceCleanupFailure(failures, error)
  }
  try {
    context.stateSignal.dispose()
  } catch (error) {
    recordResourceCleanupFailure(failures, error)
  }
  context.terminal.forceTerminal()
  if (failures.hasPrimary) throw appendDisposeCleanupErrors(failures.primary, failures.errors)
}

/** Runs a registered cleanup with the original unbound receiver and contains its failure. */
function runResourceCleanup(failures: IResourceCleanupFailures, cleanup: () => void): void {
  try {
    cleanup()
  } catch (error) {
    recordResourceCleanupFailure(failures, error)
  }
}

/** Keeps primary identity and later failure order without terminating teardown early. */
function recordResourceCleanupFailure(failures: IResourceCleanupFailures, error: unknown): void {
  if (!failures.hasPrimary) {
    failures.hasPrimary = true
    failures.primary = error
  } else failures.errors.push(error)
}

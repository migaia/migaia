/**
 * Builds immutable managed mutation observations without adding commit or cleanup ownership. The
 * exact facade and error references are retained in each original public result shape.
 */
import { mergeCleanupResults } from '@migaia/lifecycle'
import { TrayErrorCode } from '../error-code.ts'
import { createTrayError } from '../errors.ts'
import type { ICleanupAccumulator } from './host-context.ts'

/** Creates a successful settled mutation observation. */
export function mutationResult(
  operation: 'use' | 'replace',
  name: string,
  affected: readonly string[],
  topologyChanged: boolean,
  view: unknown,
  cleanup: ICleanupAccumulator
): any {
  return Object.freeze({
    ok: true,
    committed: true,
    operation,
    name,
    affected: Object.freeze([...affected]),
    topologyChanged,
    view,
    cleanupComplete: cleanup.complete,
    cleanupErrors: Object.freeze([...cleanup.errors]),
    ...(cleanup.physical.length > 0
      ? { physicalCompletion: mergeCleanupResults(cleanup.physical) }
      : {})
  })
}

/** Creates a pre-commit mutation failure while retaining the prior view. */
export function mutationFailure(
  operation: 'use' | 'replace',
  name: string,
  error: unknown,
  view: unknown,
  committed = false
): any {
  return Object.freeze({
    ok: false,
    committed,
    operation,
    name,
    affected: Object.freeze([name]),
    topologyChanged: false,
    view,
    cleanupComplete: true,
    cleanupErrors: Object.freeze([]),
    error: error instanceof Error ? error : createTrayError(TrayErrorCode.invalidEntry, error)
  })
}

/** Creates a successful committed removal observation. */
export function removalResult(
  name: string,
  affected: readonly string[],
  view: unknown,
  cleanup: ICleanupAccumulator
): any {
  return Object.freeze({
    ok: true,
    committed: true,
    removed: true,
    name,
    affected: Object.freeze([...affected]),
    view,
    cleanupComplete: cleanup.complete,
    cleanupErrors: Object.freeze([...cleanup.errors]),
    ...(cleanup.physical.length > 0
      ? { physicalCompletion: mergeCleanupResults(cleanup.physical) }
      : {})
  })
}

/** Creates the no-op result for a name absent from the managed definition graph. */
export function removalMissing(name: string, view: unknown): any {
  return Object.freeze({
    ok: true,
    committed: false,
    removed: false,
    name,
    affected: Object.freeze([]),
    view,
    cleanupComplete: true,
    cleanupErrors: Object.freeze([])
  })
}

/** Creates a failed removal observation without claiming a commit. */
export function removalFailure(
  name: string,
  error: unknown,
  view: unknown,
  committed = false
): any {
  return Object.freeze({
    ok: false,
    committed,
    removed: committed,
    name,
    affected: Object.freeze([name]),
    view,
    cleanupComplete: true,
    cleanupErrors: Object.freeze([]),
    error: error instanceof Error ? error : createTrayError(TrayErrorCode.invalidEntry, error)
  })
}

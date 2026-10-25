/**
 * Provides the Host diagnostic reporter boundary and isolates failures of caller-supplied
 * reporters. Secondary reporter failures reach the utility background-rethrow path without
 * replacing the original business result or creating another diagnostic queue.
 */
import { observeThenableRejection } from '@migaia/utils/function'
import { identifyRpcBoundaryFailure, RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'

/** Reports a secondary failure without allowing the diagnostic callback to change control flow. */
export const reportDiagnostic = (
  report: ((error: unknown) => void) | undefined,
  error: unknown
): void => {
  try {
    report?.(error)
  } catch (failure) {
    /** Utils owns the shared host exception queue; this callback never leaves a rejected reaction. */
    const diagnostic = identifyRpcBoundaryFailure(
      failure,
      RpcCoreErrorCode.callbackFailed,
      RpcCoreErrorText.callbackFailed
    )
    observeThenableRejection(undefined, { error: diagnostic }, (error) => {
      throw error
    })
  }
}

/**
 * Default sink for background RPC failures when a caller passes no `report` option. Every rpc-*
 * package falls back to it, and it writes to `console.error`. Notice coalescing follows caller
 * configuration, not this function identity; an explicit reporter receives the same events as its
 * wrapper.
 */
export const defaultRpcReporter = (error: unknown): void => {
  console.error(error)
}

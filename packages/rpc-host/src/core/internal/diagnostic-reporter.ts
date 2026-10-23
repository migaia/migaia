import { observeThenableRejection } from '@migaia/utils/function'
import { identifyRpcBoundaryFailure } from '../errors.js'
import { RpcCoreErrorCode } from '../error-code.js'
import { RpcCoreErrorText } from '../error-text.js'

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

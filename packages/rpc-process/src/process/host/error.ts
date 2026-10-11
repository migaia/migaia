import { ERROR_SOURCE as RPC_PROCESS_ERROR_SOURCE } from '../error-code.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, RpcProcessErrorCode } from '../error-code.js'
import { RpcProcessErrorText } from '../error-text.js'

/** Host admission names only a field, so rejected deployment secrets never enter diagnostics. */
export function invalidHostOption(field: string): never {
  throw ((originalDetail: Readonly<Record<string, unknown>> | undefined) =>
    attachErrorIdentity(new TypeError(RpcProcessErrorText.hostInvalidOption), {
      source: RPC_PROCESS_ERROR_SOURCE,
      code: RpcProcessErrorCode.hostInvalidOption,
      ...(originalDetail ? { detail: originalDetail } : {})
    }))({ field })
}

/** Collect independent release failures without hiding their original instances. */
export function hostCleanupFailure(errors: readonly unknown[]): AggregateError {
  return attachErrorIdentity(new AggregateError(errors, RpcProcessErrorText.channelClosed), {
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.channelClosed
  })
}

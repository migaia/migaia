import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, RpcProcessErrorCode } from '../error-code.js'
import { RpcProcessErrorText } from '../error-text.js'
import { createProcessError } from '../error.js'

/** Host admission names only a field, so rejected deployment secrets never enter diagnostics. */
export function invalidHostOption(field: string): never {
  throw createProcessError(RpcProcessErrorCode.hostInvalidOption, undefined, { field })
}

/** Collect independent release failures without hiding their original instances. */
export function hostCleanupFailure(errors: readonly unknown[]): AggregateError {
  return attachErrorIdentity(new AggregateError(errors, RpcProcessErrorText.channelClosed), {
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.channelClosed
  })
}

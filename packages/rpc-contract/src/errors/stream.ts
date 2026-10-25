/** Construct the native stream contract failure without retaining protocol or lifecycle state. */
import { createContractError } from '../contract/contract-error.js'
import { RpcContractErrorCode } from '../error-code.js'
import type { RpcStreamViolation as IRpcStreamViolation } from '../wire/stream-constants.js'

/** Preserve the first stream violation and its payload-relative pointer on a native TypeError. */
export function invalidRpcStream(
  violation: IRpcStreamViolation,
  pointer: string,
  cause?: unknown
): TypeError {
  const error = createContractError(RpcContractErrorCode.invalidStream, cause) as TypeError
  Object.defineProperties(error, {
    violation: { value: violation, enumerable: true },
    pointer: { value: pointer, enumerable: true }
  })
  return error
}

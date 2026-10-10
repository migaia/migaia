import { RpcCoreErrorCode, RpcError } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import { isForwardedOperation, retainForwardOptions } from './outbound-envelope.js'
import type { ICoreRuntimeCallOptions } from './runtime-call.js'
/** The original local ownership selector is checked before any transfer getter or payload capture. */
const transferField = 'transfer'
/** Preserve the once-read ownership selector when an existing options copy omits hidden fields. */
export function retainRuntimeTransferOptions<T extends object>(source: object, copied: T): T {
  if (Object.hasOwn(source, transferField) && !Object.hasOwn(copied, transferField))
    Object.defineProperty(copied, transferField, {
      value: Reflect.get(source, transferField),
      enumerable: true
    })
  return copied
}

/** Reject only the original process family before reading a transfer getter or caller payload. */
export function assertRuntimeTransferFamily(
  processFamily: boolean,
  options: object | undefined
): void {
  if (processFamily && options && Object.hasOwn(options, transferField))
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.runtimeProcessTransferInvalid
    )
}
/** Reuse one default input and retain private forwarding proof when optional fields need a copy. */
export function prepareRuntimeCallTimeout(
  timeoutMs: number
): (options?: ICoreRuntimeCallOptions) => ICoreRuntimeCallOptions {
  /** Ordinary calls with no options borrow this immutable input rather than allocate per request. */
  const defaults = Object.freeze({ timeoutMs })
  return (options) => {
    if (options?.timeoutMs !== undefined) return options
    if (options === undefined) return defaults
    /** The existing options copy must preserve an explicit own ownership selector. */
    const copied: ICoreRuntimeCallOptions = {
      ...options,
      /** An admitted upstream call already owns its budget, including an absent deadline. */
      timeoutMs: isForwardedOperation(options) ? false : timeoutMs
    }
    return retainForwardOptions(options, retainRuntimeTransferOptions(options, copied))
  }
}

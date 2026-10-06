import { RpcCoreErrorCode, RpcError } from '../../core/errors.js'
import { RuntimeApiErrorText, RuntimePluginKey } from './constants.js'

/** Own presence of this local call option selects ownership transfer before native commit. */
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

/**
 * Reject process own presence before reading a transfer getter, normalizing payload or invoking
 * native send.
 */
export function assertRuntimeTransferFamily(
  family: keyof typeof RuntimePluginKey | undefined,
  options: object | undefined
): void {
  if (family === RuntimePluginKey.process && options && Object.hasOwn(options, transferField))
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.processTransferInvalid)
}

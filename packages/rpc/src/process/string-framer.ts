import { RpcCoreErrorCode, tagRpcError } from '../core/errors.js'
import { RpcProcessErrorText } from './error-text.js'

/** Codec and physical string admission retain their original Core error boundary; BC7 is framing. */
export function asProcessString(value: unknown): string {
  if (typeof value !== 'string')
    throw tagRpcError(
      new TypeError(RpcProcessErrorText.expectedString),
      RpcCoreErrorCode.payloadInvalid
    )
  return value
}

export {
  processStringFramer,
  remoteProcessStringFramer
} from '../contract/framing/string-framer.js'

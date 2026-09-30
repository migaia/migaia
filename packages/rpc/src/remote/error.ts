import { attachErrorIdentity } from '@migaia/utils/error'
import {
  ERROR_SOURCE,
  RpcRemoteLayerErrorCode,
  type IRpcRemoteLayerErrorCode
} from './error-code.js'
import { RpcRemoteLayerErrorText } from './error-text.js'

/** Single code-to-text map keeps remote error construction deterministic. */
const TEXT_BY_CODE: Readonly<Record<IRpcRemoteLayerErrorCode, string>> = {
  [RpcRemoteLayerErrorCode.contractInvalid]: RpcRemoteLayerErrorText.contractInvalid,
  [RpcRemoteLayerErrorCode.startFailed]: RpcRemoteLayerErrorText.startFailed,
  [RpcRemoteLayerErrorCode.closed]: RpcRemoteLayerErrorText.closed
}

/** Constructs a native error while preserving the original failure on cause. */
export function createRemoteLayerError(
  code: IRpcRemoteLayerErrorCode,
  cause?: unknown,
  detail?: Readonly<Record<string, unknown>>
): Error {
  /** Contract violations retain the native TypeError class for caller branching. */
  const error =
    code === RpcRemoteLayerErrorCode.contractInvalid
      ? new TypeError(TEXT_BY_CODE[code], cause === undefined ? undefined : { cause })
      : new Error(TEXT_BY_CODE[code], cause === undefined ? undefined : { cause })
  attachErrorIdentity(error, { source: ERROR_SOURCE, code })
  if (detail !== undefined)
    Object.defineProperty(error, 'detail', { value: detail, enumerable: true })
  return error
}

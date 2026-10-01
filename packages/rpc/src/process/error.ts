import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, RpcProcessErrorCode, type IRpcProcessErrorCode } from './error-code.js'
import { RpcProcessErrorText } from './error-text.js'

/** One stable text is assigned to each process code at its single construction site. */
const TEXT_BY_CODE: Readonly<Record<IRpcProcessErrorCode, string>> = {
  [RpcProcessErrorCode.handshakeTimeout]: RpcProcessErrorText.handshakeTimeout,
  [RpcProcessErrorCode.authRejected]: RpcProcessErrorText.authRejected,
  [RpcProcessErrorCode.channelClosed]: RpcProcessErrorText.channelClosed,
  [RpcProcessErrorCode.connectFailed]: RpcProcessErrorText.connectFailed,
  [RpcProcessErrorCode.listenFailed]: RpcProcessErrorText.listenFailed,
  [RpcProcessErrorCode.pluginInvalidOption]: RpcProcessErrorText.pluginInvalidOption
}

/** Construct a tagged native error while preserving any non-secret original cause. */
export function createProcessError(
  code: IRpcProcessErrorCode,
  cause?: unknown,
  detail?: Readonly<Record<string, unknown>>
): Error {
  /** A missing cause key avoids accidentally reporting an absent failure as present. */
  const options = cause === undefined ? undefined : { cause }
  /** Authentication and option errors retain TypeError identity; other channel failures are Error. */
  const error =
    code === RpcProcessErrorCode.authRejected || code === RpcProcessErrorCode.pluginInvalidOption
      ? new TypeError(TEXT_BY_CODE[code], options)
      : new Error(TEXT_BY_CODE[code], options)
  return attachErrorIdentity(error, { source: ERROR_SOURCE, code, ...(detail ? { detail } : {}) })
}

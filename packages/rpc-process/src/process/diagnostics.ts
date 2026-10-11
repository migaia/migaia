import type { IRuntimeByteDiagnostics } from '@migaia/rpc-core/adapter'
import { ERROR_SOURCE, RpcProcessErrorCode } from './error-code.js'
import { RpcProcessErrorText } from './error-text.js'

/** Plain Process-owned error data preserves the public contract without supplying Core proof. */
export const ProcessChannelDiagnostics: IRuntimeByteDiagnostics = Object.freeze({
  closed: Object.freeze({
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.channelClosed,
    message: RpcProcessErrorText.channelClosed
  }),
  timeout: Object.freeze({
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.handshakeTimeout,
    message: RpcProcessErrorText.handshakeTimeout
  }),
  authenticationRejected: Object.freeze({
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.authRejected,
    message: RpcProcessErrorText.authRejected
  }),
  duplicateBinding: RpcProcessErrorText.duplicateBinding,
  optionsInvalid: RpcProcessErrorText.optionsInvalid,
  jsonCodecRequired: RpcProcessErrorText.jsonCodecRequired,
  negotiatedCodecUnsupported: RpcProcessErrorText.negotiatedCodecUnsupported,
  handshakeTimeoutInvalid: RpcProcessErrorText.handshakeTimeoutInvalid
})

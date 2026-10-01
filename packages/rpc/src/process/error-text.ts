/** Canonical process diagnostics never contain token, frame, or stderr payload bytes. */
export const RpcProcessErrorText = {
  /** Local scheduler timed out before byte handshake completed. */
  handshakeTimeout: 'process channel handshake timed out',
  /** Authentication failed without exposing the verifier's secret-bearing exception. */
  authRejected: 'process channel authentication rejected',
  /** Work arrived after the owned connection became terminal. */
  channelClosed: 'process channel is closed',
  /** Dial or launch failed; the original system error remains on cause. */
  connectFailed: 'process channel connection failed',
  /** Listener could not bind to the requested local address. */
  listenFailed: 'process channel listener failed',
  /** A byte transport's JSON codec received a value outside its string wire domain. */
  expectedString: 'process channel requires a string encoded value',
  /** A channel is already owned by another transport adapter. */
  duplicateBinding: 'process channel is already bound',
  /** The message channel parties did not declare the same static agreement. */
  staticAgreementMismatch: 'process channel static agreement does not match',
  /** Local process options are incomplete or outside the supported runtime domain. */
  optionsInvalid: 'process channel options are invalid',
  /** Native byte channels require the JSON codec implemented by this package. */
  jsonCodecRequired: 'process channel offer must include the JSON codec',
  /** The peer selected a codec for which this channel has no implementation. */
  negotiatedCodecUnsupported: 'process channel negotiated codec is unsupported',
  /** Handshake deadlines must be finite and non-negative. */
  handshakeTimeoutInvalid: 'process channel handshake timeout is invalid',
  /** Process plugin admission rejects malformed deployment configuration before any side effect. */
  pluginInvalidOption: 'process plugin options are invalid'
} as const

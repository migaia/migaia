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
  staticAgreementMismatch: 'process channel static agreement does not match'
} as const

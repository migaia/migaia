/** Canonical process diagnostics never contain token, frame, or stderr payload bytes. */
export const RpcProcessErrorText = {
  /** Native resource reads report this stable text, keeping OS diagnostics only on cause. */
  usageSampleFailed: 'process resource sampling failed',
  /** Invalid OS statistics cannot be converted into fabricated resource values. */
  usageInvalid: 'process resource statistics are invalid',
  /** Invalid discovery or bootstrap rejects before authentication and provider publication. */
  runtimeBootstrapInvalid: 'process runtime API bootstrap is invalid',
  /** Host admission rejects invalid deployment or replacement options before side effects. */
  hostInvalidOption: 'process host options are invalid',
  /** Facade release permanently rejects new and queued Host commands. */
  hostClosed: 'process host is closed',
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
  pluginInvalidOption: 'process plugin options are invalid',
  /** Resilience construction rejects an invalid limit or missing ownership or health port. */
  resilienceInvalidOption: 'process resilience options are invalid',
  /** The report schedule field name is stable in invalid-option detail diagnostics. */
  resilienceReportOffsetsField: 'reportAtMs',
  /** A session or request exceeded its assigned connection-level capacity before dispatch. */
  connectionLimit: 'process connection limit exceeded',
  /** Explicit instance-health failure keeps a shared target closed until replacement is ready. */
  instanceUnhealthy: 'process instance is unhealthy',
  /** A native ping returned false while its supervision deadline was still active. */
  healthPingFailed: 'process health ping failed',
  /** A terminal registration rejects a fresh remote call before any business frame is sent. */
  terminalCall: 'process registration is terminal',
  /** Liquidation permanently closes this registration; construct a new one to restart. */
  liquidated: 'process registration was liquidated'
} as const

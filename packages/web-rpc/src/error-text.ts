/**
 * Package-owned stable text for validation failures introduced by the outbound framing boundary.
 * Keeping these messages here prevents the pipeline from becoming a second owner of public error
 * text.
 */
export const WebRpcErrorText = {
  /** Identifies a protocol codec failure before a frame reaches transport. */
  protocolEncodeFailed: 'Protocol encode failed',
  /** Identifies a transport failure after a frame has been encoded. */
  transportSendFailed: 'Transport send failed',
  /** Describes a transfer option that cannot be snapshotted as a list. */
  invalidTransferList: 'Transfer list must be an array',
  /** Describes a byte-length hook result that cannot safely represent its input. */
  invalidByteLengthMeasurement: 'Custom byteLength returned an unsafe measurement',
  /** Describes an encoded message that exceeds the configured message budget. */
  encodedMessageTooLarge: 'Encoded message exceeds configured maximum',
  /** Describes a transfer list that cannot accompany chunked output. */
  transferUnsupportedForChunking: 'Transfer lists are unsupported for chunked messages',
  /** Describes a transfer list that cannot accompany authenticated output. */
  transferUnsupportedWithAuthentication: 'Transfer lists are unsupported with authentication',
  /** Describes a splitter result that violates the bounded framing contract. */
  invalidChunkFrames: 'Chunk splitter returned invalid frames',
  /** Describes a protocol codec result whose runtime type disagrees with its declaration. */
  protocolEncodedType: (encodedType: string): string =>
    `Protocol encoded output must be ${encodedType}`,
  /** Describes an authentication result whose runtime type disagrees with transport. */
  protectedEncodedType: (encodedType: string): string =>
    `Protected frame output must be ${encodedType}`,
  /** Identifies an authentication transform that failed before transport send. */
  authenticationFailed: 'Authentication transform failed'
} as const;

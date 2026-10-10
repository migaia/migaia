/** Stable codec diagnostics shared by all format-specific implementations. */
export const CodecErrorText = {
  invalidVersion: 'serialize codec version must be a positive safe integer',
  invalidSchema: 'serialize protobuf schema descriptor is invalid',
  encodeFailed: 'serialize codec encode failed',
  decodeFailed: 'serialize codec decode failed',
  portableValueInvalid: 'serialize codec value is outside the portable profile'
} as const

/** Stable codec diagnostics shared by all format-specific implementations. */
export const CodecErrorText = {
  /** Factory version admission failure before a codec is returned. */
  invalidVersion: 'serialize codec version must be a positive safe integer',
  /** Protobuf schema identity/version admission failure, independent of the executable binding. */
  invalidSchema: 'serialize protobuf schema descriptor is invalid',
  /** Fallback for an unclassified format encoder failure; the original remains on cause. */
  encodeFailed: 'serialize codec encode failed',
  /** Fallback for an unclassified format decoder failure; the original remains on cause. */
  decodeFailed: 'serialize codec decode failed',
  /** Portable-profile rejection shared by format conversion and decoded-value admission. */
  portableValueInvalid: 'serialize codec value is outside the portable profile'
} as const

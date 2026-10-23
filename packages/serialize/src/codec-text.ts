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
  portableValueInvalid: 'serialize codec value is outside the portable profile',
  /** Tagged codec construction requires compatible unique descriptors and callable methods. */
  taggedOptionsInvalid: 'serialize tagged codec options are invalid',
  /** Untagged input needs an explicitly selected fallback instead of format guessing. */
  tagMissing: 'serialize codec tag is missing',
  /** Reserved headers cannot fall back to a legacy decoder after malformed framing. */
  tagInvalid: 'serialize codec tag is invalid',
  /** A syntactically valid tag requires a matching registered format revision. */
  tagUnknown: 'serialize codec tag is not registered'
} as const

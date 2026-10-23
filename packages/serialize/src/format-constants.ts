/** Tagged codec framing is distinct from registry chunks and owns all reserved header fields. */
export const TaggedCodecFormat = {
  /** Descriptor identity for the format-router codec itself. */
  id: 'tagged',
  /** Revision of this framing, independent of the selected inner codec revision. */
  version: 1,
  /** Exact reserved text prefix; an apparent prefix never falls back after a framing error. */
  textPrefix: 'mgt1:',
  /** Text header delimiter separating the format tag from untouched encoded payload. */
  textSeparator: ';',
  /** Separates the admitted format identity and canonical positive version spelling. */
  tagSeparator: '@',
  /** Binary magic precedes a framing-version byte and a big-endian two-byte tag length. */
  binaryMagic: [0x00, 0x4d, 0x47, 0x54] as const,
  /** Binary payload starts after four magic bytes, one revision byte and two length bytes. */
  binaryHeaderLength: 7,
  /** Own string marker identifying an unknown-carrier wrapper record. */
  marker: '$migaia.codec',
  /** Own payload field in the unknown-carrier wrapper; its value is not frozen or copied. */
  value: 'value'
} as const

/** Canonical serialized chunk kinds. */
export const SerializeChunkKind = {
  /** Complete in-memory payload; registry encoding permits it only as the sole chunk. */
  value: 'value',
  /** Wire text joined directly when all encoded chunks are text. */
  text: 'text',
  /** Wire bytes; multi-chunk assembly promotes accompanying text into the binary result. */
  bytes: 'bytes'
} as const

/** Codec output representations used by serializers and persistence adapters. */
export const SerializeOutput = {
  /** Text representation chosen by a serializer or persistence adapter. */
  text: 'text',
  /** Structured representation supported by the receiving carrier. */
  structured: 'structured',
  /** Binary representation requiring a compatible carrier or explicit conversion. */
  binary: 'binary'
} as const

/** Portable management projections choose an output-only text format, never a parser plugin. */
export const SerializeTextFormat = {
  /** Default emitter format using native JSON after own-data admission. */
  json: 'json',
  /** YAML flow-style output for the admitted subset; not a registered decoding plugin. */
  yaml: 'yaml',
  /** TOML output requiring a record root, Unicode scalar strings, and no null values. */
  toml: 'toml'
} as const
/** Supported output-only text format labels. */
export type ISerializeTextFormat = (typeof SerializeTextFormat)[keyof typeof SerializeTextFormat]

/** Error-location labels for encoding and decoding; these constants emit no instrumentation events. */
export const SerializePhase = {
  /** Failure while producing encoded chunks or frames. */
  encode: 'encode',
  /** Failure while parsing an encoded chunk or frame. */
  decode: 'decode'
} as const

/** Cleanup policies and diagnostic kinds used by the serializer registry. */
export const SerializeCleanupPolicy = {
  /** Default: reject disposal with cleanup failures, retaining any earlier primary. */
  throw: 'throw',
  /** Send cleanup failures to the required cleanup reporter without replacing the primary. */
  report: 'report'
} as const
/** Cleanup and drain observations; these kinds are not thrown semantic error codes. */
export const SerializeCleanupKind = {
  /** Parser release failed and report policy emits its original failure. */
  cleanupError: 'cleanup-error',
  /** Disposal stopped waiting for pending work at its admitted deadline. */
  drainTimeout: 'drain-timeout'
} as const

/** Built-in serializer plugin identifiers used in registry metadata. */
export const SerializePluginType = {
  /** Routing token used by the built-in native JSON plugin. */
  json: 'json'
} as const

/** Chunk discriminants, independent of parser type routing. */
export type ISerializeChunkKind = (typeof SerializeChunkKind)[keyof typeof SerializeChunkKind]
/** Representation labels consumed by serializers and receiving adapters. */
export type ISerializeOutputFormat = (typeof SerializeOutput)[keyof typeof SerializeOutput]
/** Encode/decode failure-location domain. */
export type ISerializePhase = (typeof SerializePhase)[keyof typeof SerializePhase]
/** Registry parser-cleanup policy labels. */
export type ISerializeCleanupPolicy =
  (typeof SerializeCleanupPolicy)[keyof typeof SerializeCleanupPolicy]
/** Diagnostic discriminants for cleanup failure or bounded draining. */
export type ISerializeCleanupKind = (typeof SerializeCleanupKind)[keyof typeof SerializeCleanupKind]
/** Built-in routing tokens; custom plugins may use other valid tokens. */
export type ISerializePluginType = (typeof SerializePluginType)[keyof typeof SerializePluginType]

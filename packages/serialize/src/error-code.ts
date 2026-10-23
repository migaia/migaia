/** Stable error domain owned by this code table; package moves preserve this identity. */
export const ERROR_SOURCE = 'serialization'

/**
 * The single declaration site for `serialization` error codes.
 *
 * The pair (source, code) uniquely identifies a failure at the package boundary. `source` is always
 * `'serialization'`. Throw sites use these constants instead of inline values.
 *
 * Code values are public API. Renaming a code is a breaking change.
 */
export const SerializeErrorCode = {
  /**
   * Thrown when `encode` or `decode` is called after the registry closes or disposal begins.
   *
   * Create another registry instead of reusing this instance. Enforces the two-phase contract that
   * rejects new requests before releasing resources.
   */
  registryDisposed: 'REGISTRY_DISPOSED',

  /**
   * Thrown when no registered parser matches the requested `type`.
   *
   * Check plugin registration and the archive format tag. This is a stable configuration or format
   * failure; retrying the same type does not fix it.
   */
  codecNotFound: 'CODEC_NOT_FOUND',

  /**
   * Thrown when encoding fails: the parser's `encode` throws, streaming encoding fails, or no
   * chunks are produced.
   *
   * `cause` retains the original exception when one exists. Use `chunkIndex` and `bytesConsumed` to
   * locate the failure.
   */
  encodeFailed: 'ENCODE_FAILED',

  /**
   * Thrown when the parser's `decode` or streaming decoding fails.
   *
   * `cause` retains the original exception. Use `chunkIndex` and `bytesConsumed` to locate the
   * failure.
   */
  decodeFailed: 'DECODE_FAILED',

  /**
   * Thrown for an invalid chunk: a malformed `[type, data]` pair, incorrect text or byte payload,
   * unknown kind, or a value chunk used by a carrier that accepts only wire data.
   *
   * Check parser output and input chunks. This indicates an invalid parser or damaged archive, not
   * a backend failure.
   */
  invalidChunk: 'INVALID_CHUNK',

  /**
   * Thrown when encoding or decoding is cancelled through an abort signal.
   *
   * Treat this as cancellation and retry with a fresh signal when appropriate. It differs from
   * unrecoverable `ENCODE_FAILED` and `DECODE_FAILED` errors.
   */
  aborted: 'ABORTED',

  /**
   * Thrown for invalid options, including illegal or duplicate plugin types, an empty plugin list,
   * invalid frame budgets or `maxInFlight`, and a scheduler without `{ now, schedule }`
   * capabilities.
   *
   * Correct the input. The message identifies the invalid option.
   */
  /** Text emitters also reject nonportable own data and values the selected format cannot express. */
  invalidOption: 'INVALID_OPTION',

  /**
   * Thrown when `createSerializeRegistry` cannot obtain host `TextEncoder` or `TextDecoder`
   * capabilities. Standalone `jsonParser` bytes decoding also uses this code when neither its
   * injected decoder nor the host `TextDecoder` exists. Core collectors require an explicit encoder
   * for byte merges.
   *
   * Inject `encoder` and `decoder`, or use a host with the Encoding API. `cause` retains the
   * original capability failure when one exists; absent capability needs no synthetic cause.
   */
  envUnsupported: 'ENV_UNSUPPORTED',

  /** Untagged input has no configured fallback; supply one or pass tagged data. */
  tagMissing: 'TAG_MISSING',
  /** A reserved tagged header is truncated or malformed; reject the damaged input. */
  tagInvalid: 'TAG_INVALID',
  /** A valid format tag is not registered; supply the corresponding codec revision. */
  tagUnknown: 'TAG_UNKNOWN'
} as const

/** Stable serialization failure values; diagnostic kind and parser type are separate domains. */
export type ISerializeErrorCode = (typeof SerializeErrorCode)[keyof typeof SerializeErrorCode]

/**
 * Declares the public error codes for `@migaia/store-persist` in one place.
 *
 * The registry in `docs/contracts/error-codes.md` identifies errors by `(source, code)`. The
 * `source` is always `'@migaia/store-persist'`. Throw sites use these constants instead of inline
 * literals.
 *
 * Code values are public API. Renaming a code is a breaking change.
 */
export const StorePersistErrorCode = {
  /**
   * No codec resolves for a storage key.
   *
   * Provide `codec` to `persist` or `persistUnit`, or confirm that the default codec is available.
   */
  codecNotResolved: 'CODEC_NOT_RESOLVED',

  /**
   * Codec output does not match the backend capabilities or contract. Examples include unsupported
   * structured output, non-byte binary output, and non-string text output.
   *
   * Check the codec `output` and backend `capabilities`. This is a configuration or implementation
   * mismatch, not a transient failure.
   */
  codecOutputMismatch: 'CODEC_OUTPUT_MISMATCH',

  /**
   * A binary read/write requires `getBytes` and `setBytes`, or archive removal requires
   * `removeBytes`, but the storage backend lacks the required operation.
   *
   * Use a record-capable backend such as memory or IndexedDB, or use a text codec.
   */
  backendCapability: 'BACKEND_CAPABILITY',

  /**
   * The saved envelope is invalid or incompatible with the current store version. Its state may be
   * missing, its version invalid, its properties inaccessible, or its version different without a
   * migration.
   *
   * Check the archive and configured `version`. Provide `migrate` for a version mismatch.
   */
  envelopeInvalid: 'ENVELOPE_INVALID',

  /**
   * The JSON codec fails to serialize a value.
   *
   * Check whether the value is JSON-serializable. The original exception remains in `cause`.
   */
  encodeFailed: 'ENCODE_FAILED',

  /**
   * Hydration and the subsequent write both fail. An `AggregateError` retains both causes in its
   * error chain.
   *
   * Inspect `error.errors` and handle each failure. This is a double failure, not one transient
   * error.
   */
  hydrateAndWriteFailed: 'HYDRATE_AND_WRITE_FAILED',

  /**
   * A persistence operation is aborted by `dispose()`. The error retains the name `AbortError`.
   *
   * Treat this as cancellation. Disposal stops scheduling new writes and requests cancellation of
   * active operations. An in-flight adapter may still complete.
   */
  abortedByDispose: 'ABORTED_BY_DISPOSE',

  /**
   * Persistence options are invalid, for example when `version` is not a safe non-negative integer.
   *
   * Correct the configuration before retrying. This is a permanent input error.
   */
  invalidOption: 'INVALID_OPTION'
} as const

export type IStorePersistErrorCode =
  (typeof StorePersistErrorCode)[keyof typeof StorePersistErrorCode]

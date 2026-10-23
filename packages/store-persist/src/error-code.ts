/**
 * Declares the public error codes for `@migaia/store-persist` in one place.
 *
 * Locally constructed errors use source `'@migaia/store-persist'`. Codec, unit and adapter failures
 * may instead retain their owning boundary's identity. Throw sites use these constants instead of
 * inline literals.
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
   * The default JSON codec receives a non-string payload or cannot decode the supplied JSON.
   *
   * Inspect the payload and cause chain. Envelope structure and versions belong to
   * storage-contract.
   */
  envelopeInvalid: 'ENVELOPE_INVALID',

  /**
   * The JSON codec fails to serialize a value.
   *
   * Check whether the value is JSON-serializable. The original exception remains in `cause`.
   */
  encodeFailed: 'ENCODE_FAILED',

  /**
   * The handle retains both a hydration error and a write error. Its combined error projection
   * returns an AggregateError containing them in hydration-then-write order; it does not reopen a
   * failed hydration's write gate.
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

/** Stable values declared by StorePersistErrorCode for locally identified failures. */
export type IStorePersistErrorCode =
  (typeof StorePersistErrorCode)[keyof typeof StorePersistErrorCode]

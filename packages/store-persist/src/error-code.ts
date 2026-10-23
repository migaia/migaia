/** Stable error domain owned by this code table; package moves preserve this identity. */
export const ERROR_SOURCE = 'store.persist'

/**
 * Declares the public error codes for `store.persist` in one place.
 *
 * Locally constructed errors use source `'store.persist'`. Codec, unit and adapter failures
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
   * `removeBytes`, but the storage backend lacks the required operation. Atomic persistence also
   * requires the original complete record store with transaction support.
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
   * The JSON codec fails to serialize a value, or an uncoded snapshot, partialize or codec failure
   * occurs inside an admitted transactional flush.
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
   * active operations, including an enlisted transaction. An in-flight adapter may still complete.
   */
  abortedByDispose: 'ABORTED_BY_DISPOSE',

  /**
   * Persistence options or transaction participation are invalid. This includes an invalid version,
   * a forged or mismatched handle/view, and a direct mutation during explicit participation.
   *
   * Correct the configuration before retrying. This is a permanent input error.
   */
  invalidOption: 'INVALID_OPTION'
} as const

/** Stable values declared by StorePersistErrorCode for locally identified failures. */
export type IStorePersistErrorCode =
  (typeof StorePersistErrorCode)[keyof typeof StorePersistErrorCode]

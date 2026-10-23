/** Stable error domain owned by this code table; package moves preserve this identity. */
export const ERROR_SOURCE = 'store.ssr'

/**
 * Declares the public error codes for `store.ssr` in one place.
 *
 * Package-owned failures use `(source, code)` with source `'store.ssr'`. Throw sites use these
 * constants instead of inline literals; complete upstream identities retain their owner.
 *
 * Code values are public API. Renaming a code is a breaking change.
 */
export const StoreSsrErrorCode = {
  /**
   * Registration, dehydration, or reads continue after request scope disposal.
   *
   * Create a new `SSRRequestScope` for each request instead of reusing the disposed scope.
   */
  scopeDisposed: 'SCOPE_DISPOSED',

  /**
   * Multiple stores or resources fail to clean up during request scope disposal. An
   * `AggregateError` exposes each cause through `errors[]`.
   *
   * Treat this as a disposal failure.
   */
  scopeDisposalFailed: 'SCOPE_DISPOSAL_FAILED',

  /**
   * `hydrate()` fails to apply state to multiple stores or resources. Hydration is best-effort and
   * non-atomic. An `AggregateError` exposes each cause through `errors[]`.
   *
   * Treat this as a hydration failure.
   */
  hydrateFailed: 'HYDRATE_FAILED',

  /**
   * An SSR snapshot is invalid because `stores` or `resources` is not a plain object, or a resource
   * snapshot field is invalid, or accessing input snapshot properties fails. Keep the original
   * reflective failure reachable and correct the supplied data before retrying.
   *
   * Check the supplied `ISSRState` structure.
   */
  invalidSnapshot: 'INVALID_SNAPSHOT',

  /**
   * The inline state script ID is invalid, JSON payload parsing fails, or `ISSRState.version` is
   * not the supported version `1`. Syntax errors retain their native class and stack.
   *
   * Use a valid ID and the supported version.
   */
  invalidStateScript: 'INVALID_STATE_SCRIPT',

  /**
   * An SSR store or resource registration key is empty or equals `__proto__`.
   *
   * Use a non-empty, non-reserved string key.
   */
  invalidStoreKey: 'INVALID_STORE_KEY',

  /**
   * The payload is not JSON-serializable because it contains cycles, non-finite numbers, non-plain
   * objects, non-JSON types, or exceeds node or depth limits.
   *
   * Restrict state to JSON-serializable plain values.
   */
  serializeUnsupported: 'SERIALIZE_UNSUPPORTED',

  /**
   * Input validation fails for `timeoutMs`, simultaneous `runtime` and `runtimeOptions`, or
   * duplicate keys.
   *
   * Correct the input named in the error message.
   */
  invalidOption: 'INVALID_OPTION',

  /**
   * A registered store or resource belongs to another `Runtime` and does not share this request
   * scope isolation.
   *
   * Create and register the store or resource within the same `Runtime`.
   */
  crossRuntime: 'CROSS_RUNTIME',

  /**
   * A codec violates its output or registration contract. `encode` returns a value chunk instead of
   * wire data, or the payload names a codec type not registered on the reader.
   *
   * Correct the codec output or register the codec before reading.
   */
  codecContract: 'CODEC_CONTRACT',

  /**
   * Resources keep registering new resources during `awaitResources()` and exceed the convergence
   * round limit.
   *
   * Check resource factories and dependencies for an infinite registration chain.
   */
  resourceRoundLimit: 'RESOURCE_ROUND_LIMIT',

  /**
   * A registered resource did not settle before the SSR deadline. The caller may render without
   * that resource or retry on the client.
   */
  resourceTimeout: 'RESOURCE_TIMEOUT'
} as const

/** Stable semantic values minted by SSR validation, registration and cleanup boundaries. */
export type IStoreSsrErrorCode = (typeof StoreSsrErrorCode)[keyof typeof StoreSsrErrorCode]

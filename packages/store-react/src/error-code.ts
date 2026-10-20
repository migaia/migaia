/**
 * Declares the public error codes for `@migaia/store-react` in one place.
 *
 * The registry in `docs/contracts/error-codes.md` identifies errors by `(source, code)`. The
 * `source` is always `'@migaia/store-react'`. Throw sites use these constants instead of inline
 * literals.
 *
 * Code values are public API. Renaming a code is a breaking change.
 */
export const StoreReactErrorCode = {
  /**
   * A provider registry is registered with or read after `dispose()`.
   *
   * Create a new registry instead of reusing the disposed instance.
   */
  registryDisposed: 'REGISTRY_DISPOSED',

  /**
   * An owned registry value fails to dispose. Unclassified native errors receive this code;
   * multiple failures expose an `AggregateError`, and existing foreign package identities remain.
   *
   * Inspect the original error, its `cause`, or each aggregate entry. Cleanup continues for other
   * owned values; retrying disposal does not rerun their callbacks.
   */
  registryDisposalFailed: 'REGISTRY_DISPOSAL_FAILED',

  /**
   * A hook is called without `StoreProvider`.
   *
   * Wrap the subtree in `StoreProvider` or use a protocol hook that does not require a provider.
   */
  providerRequired: 'PROVIDER_REQUIRED',

  /**
   * An API requires a feature that is not explicitly enabled in the provider configuration.
   *
   * Enable that path in the `StoreProvider` `features` configuration.
   */
  featureDisabled: 'FEATURE_DISABLED',

  /**
   * The registry has no store for the requested token.
   *
   * Confirm that the store is registered and uses the same token.
   */
  storeMissing: 'STORE_MISSING',

  /**
   * The same token is registered twice.
   *
   * Remove duplicate registration or give each provider its own registry.
   */
  storeDuplicate: 'STORE_DUPLICATE',

  /**
   * A provider store belongs to another `Runtime`.
   *
   * Use the same `Runtime` for the store and registry. Cross-runtime injection is rejected.
   */
  crossRuntime: 'CROSS_RUNTIME',

  /**
   * Provider or token configuration is invalid, for example a missing debug name or incompatible
   * `features.wasm` and `ready`.
   *
   * Correct the configuration before retrying. This is a permanent configuration error.
   */
  invalidConfig: 'INVALID_CONFIG',

  /**
   * The provider readiness barrier rejected before rendering could continue. The caller should
   * inspect `cause` and fix the underlying store/resource failure.
   */
  readyRejected: 'READY_REJECTED'
} as const

export type IStoreReactErrorCode = (typeof StoreReactErrorCode)[keyof typeof StoreReactErrorCode]

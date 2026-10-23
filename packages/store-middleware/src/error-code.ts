/** Stable error domain owned by this code table; package moves preserve this identity. */
export const ERROR_SOURCE = 'store.middleware'

/**
 * Declares the public error codes for `store.middleware` in one place.
 *
 * Pair these codes with source `store.middleware`; identified upstream failures retain
 * their actual package owner. Throw sites use these constants instead of inline literals.
 *
 * Code values are public API. Renaming a code is a breaking change.
 */
export const StoreMiddlewareErrorCode = {
  /**
   * Host options are not objects, or a DevTools adapter lacks init/send or has a non-callable
   * subscribe.
   */
  invalidOption: 'INVALID_OPTION',
  /**
   * A middleware stage omits `next()`, filtering the event chain at that stage.
   *
   * This is reported through `reportError`, not thrown. Check whether `next(event)` is missing or
   * filtering is intentional.
   */
  middlewareNotChained: 'MIDDLEWARE_NOT_CHAINED',

  /**
   * A mutation guard check runs outside this policy's synchronous action scope in actions-only
   * mode. Share the policy with the guarded writer and enter runInAction, or select off mode when
   * action-scoped writes are not required.
   */
  actionScopeRequired: 'ACTION_SCOPE_REQUIRED',

  /**
   * `ClonePolicy.immutable` receives a custom class, accessor, unsupported native data value, or a
   * value the canonical structured clone cannot copy. Admission supports data-only records/arrays,
   * current-realm native Map/Set/Date/RegExp and non-shared ArrayBuffer/view storage.
   *
   * Use `ClonePolicy.diagnostic` or `ClonePolicy.opaque`, or make the subtree cloneable.
   */
  cloneUnsupported: 'CLONE_UNSUPPORTED',

  /**
   * A synchronous action, initial binding clone or binding disposer callback fails without another
   * package identity. Native mutable errors retain their object/type/stack; fallback cause/errors
   * retain the original. The action scope still exits and each binding cleanup is attempted once.
   */
  callbackFailed: 'CALLBACK_FAILED',

  /**
   * A supported Redux state command contains invalid JSON. The adapter ignores that command and
   * reports its original SyntaxError through the requested Runtime; later valid commands still
   * work.
   */
  devtoolsMessageInvalid: 'DEVTOOLS_MESSAGE_INVALID',

  /**
   * A DevTools state command, such as jump or reset, is called without `applyState`.
   *
   * Provide `applyState` in the `bindStoreMiddleware` core or avoid state commands.
   */
  devtoolsCapability: 'DEVTOOLS_CAPABILITY',

  /**
   * `ClonePolicy.immutable` requires `structuredClone`, but the environment does not provide it.
   *
   * Provide a polyfill or use `diagnostic` or `opaque`. This is a missing deployment capability.
   */
  envUnsupported: 'ENV_UNSUPPORTED',

  /**
   * Binding setup failed and rollback also threw. Inspect AggregateError.errors for the original
   * setup failure followed by cleanup failures. Normal host disposal instead returns its structured
   * cleanup result and retains binding failures in cleanupErrors.
   */
  cleanupFailed: 'CLEANUP_FAILED'
} as const

/** Public union of package-owned failure values for constructing or inspecting boundary errors. */
export type IStoreMiddlewareErrorCode =
  (typeof StoreMiddlewareErrorCode)[keyof typeof StoreMiddlewareErrorCode]

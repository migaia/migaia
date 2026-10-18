/**
 * Declares the public error codes for `@migaia/store-middleware` in one place.
 *
 * The registry in `docs/contracts/error-codes.md` identifies errors by `(source, code)`. The
 * `source` is always `'@migaia/store-middleware'`. Throw sites use these constants instead of
 * inline literals.
 *
 * Code values are public API. Renaming a code is a breaking change
 * (`docs/contracts/error-code-rollout.sdd.md` §1.2).
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
   * A store field is written directly outside a store method in `actions-only` mode.
   *
   * Write through store methods, `$set`, `$hydrate`, or `$batch`, or use `off` mode.
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
   * A synchronous action or binding disposer callback fails without another package identity.
   * Native mutable errors retain their object/type/stack; fallback cause/errors retain the
   * original. The action scope still exits and each binding cleanup is attempted once.
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
   * Binding or host cleanup failed after all cleanup actions were attempted. The caller must
   * inspect `errors[]` and treat the host as terminal.
   */
  cleanupFailed: 'CLEANUP_FAILED'
} as const

export type IStoreMiddlewareErrorCode =
  (typeof StoreMiddlewareErrorCode)[keyof typeof StoreMiddlewareErrorCode]

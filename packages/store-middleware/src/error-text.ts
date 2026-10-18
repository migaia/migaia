/** Stable public diagnostics owned by `@migaia/store-middleware`. */
export const StoreMiddlewareErrorText = {
  /** Fallback for unclassified synchronous action/disposer failures; native messages are preserved. */
  callbackFailed: '[store] middleware callback failed',
  /** Fallback diagnostic for a malformed Redux state command; native SyntaxError remains preferred. */
  devtoolsMessageInvalid: '[store] DevTools state JSON is invalid',
  optionsObject: '[store] middleware host options must be an object',
  adapterInvalid:
    '[store] DevTools adapter must provide init/send functions and an optional subscribe function',
  immutableClone:
    '[store] ClonePolicy.immutable requires structuredClone support in this environment',
  cloneUnsupported:
    '[store] value contains something structuredClone cannot copy independently (e.g. a function, DOM handle, or class instance); use ClonePolicy.diagnostic or ClonePolicy.opaque instead',
  applyState: '[store] DevTools state command requires applyState',
  missingNext: '[store] middleware did not call next()',
  cleanupFailed: '[store] middleware host cleanup failed',
  logPrefix: '[store]',
  outsideAction: (operation: string): string =>
    `[store] ${operation} is not allowed outside an action`
} as const

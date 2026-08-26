/** Stable public diagnostics owned by `@migaia/store-middleware`. */
export const StoreMiddlewareErrorText = {
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

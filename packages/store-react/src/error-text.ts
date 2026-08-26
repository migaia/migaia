/** Stable public diagnostics owned by `@migaia/store-react`. */
export const StoreReactErrorText = {
  optionsObject: '[store] store registry options must be an object',
  ownedOption: '[store] store registry options.owned must be boolean',
  tokenDebugName: '[store] IStoreToken requires a debug name',
  duplicateToken: (name: string): string => `[store] duplicate provider store token: ${name}`,
  missingStore: (name: string): string => `[store] missing provider store: ${name}`,
  registryDisposalFailed: '[store] provider registry disposal failed',
  differentRuntime: (name: string): string =>
    `[store] provider store "${name}" belongs to a different Runtime`,
  registryDisposed: '[store] provider registry is disposed',
  requiresProvider: '[store] hook requires a StoreProvider',
  featureReady:
    '[store] features.wasm is true but config.ready is empty; pass ensureWasm from @migaia/store-wasm (e.g. ready: [ensureWasm])',
  apiProvider: (apiName: string, path: string): string =>
    `[store] ${apiName} requires a StoreProvider (feature "${path}")`,
  apiFeature: (apiName: string, path: string): string =>
    `[store] ${apiName} requires feature "${path}" to be explicitly enabled on StoreProvider config`,
  ownershipMismatch: '[store] StoreProvider registry/runtime ownership mismatch',
  readyIdentity:
    '[store] StoreProvider ready barriers changed identity; memoize config.ready to avoid resetting the provider tree',
  readyRetained:
    '[store] StoreProvider ready barriers changed identity; the initial barrier set is retained. Memoize config.ready to avoid stale initialization.',
  readyRejected: '[store] ready barrier rejected',
  readyInvalid: '[store] config.ready must be an array of Promises or zero-argument functions',
  experimentalInvalid: '[store] config.features.experimental could not be read safely',
  configRead: '[store] StoreProvider config could not be read safely'
} as const

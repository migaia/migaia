/** Stable public diagnostics owned by `@migaia/store-light`. */
export const StoreLightErrorText = {
  optionsObject: '[store] store options must be an object',
  shapeInvalid: '[store] store definition could not be read safely',
  optionsInvalid: '[store] store options have an invalid field shape',
  patchInvalid: '[store] store patch could not be read safely',
  inputType: (name: string, expected: string): string =>
    `[store] ${name} must be ${expected === 'object' ? 'an' : 'a'} ${expected}`,
  storeDisposed: '[store] store is disposed',
  resourceDisposed: '[store] resource is disposed',
  unknownResourceVersion: '[store] unknown resource version',
  disposableIdentity: '[store] disposable resource values must use reference identity',
  disposedResourceValue: '[store] resource factory returned a disposed value',
  noAsyncInitialization: '[store] store has no asynchronous initialization',
  cleanupFailed: '[store] initialization and cleanup both failed',
  asyncAction: (key: string): string =>
    `[store] async action "${key}" only batches work before the first await; use $batch() for later writes`,
  asyncStore: (status: string): string =>
    `[store] store is ${status}; use createAsyncStore() before accessing async fields`,
  fieldNotSettable: (key: string): string => `[store] field is not settable: ${key}`,
  unknownHydrationField: (key: string): string => `[store] unknown hydration field: ${key}`,
  syncStoreField: (key: string): string =>
    `[store] createStore() only accepts synchronous fields; "${key}" is a IFieldBuilder. Use createAsyncStore().`,
  keepAlive: '[store] keepAliveMs must be a finite non-negative number',
  captureRegistryWeakRef:
    '[store] ResourceCaptureRegistry requires WeakRef and FinalizationRegistry; enable these capabilities in the host sandbox',
  invalidCapture: '[store] invalid or consumed resource capture',
  resourceFactory: '[store] resource factory must be a function or an object with a load function'
} as const

/** Stable public diagnostics owned by `@migaia/store-indexed`. */
export const StoreIndexedErrorText = {
  optionsObject: '[store] observable collection options must be an object',
  debugName: '[store] observable collection debugName must be a string',
  collectionInput: '[store] observable collection input must be a non-null object or iterable',
  objectKey: '[store] ObservableObject key must be a string',
  crossRuntime:
    '[store] cross-runtime dependency is not allowed: collection read belongs to another Runtime',
  disposed: (name: string): string => `[store] ${name} is disposed`,
  arrayIndex: '[store] ObservableArray index out of range',
  arrayInteger: '[store] ObservableArray index must be an integer'
} as const

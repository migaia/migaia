/** Stable public diagnostics owned by `@migaia/store-indexed`. */
export const StoreIndexedErrorText = {
  /**
   * Fallback for guard/updater failures that cannot carry identity; ordinary native messages stay
   * intact.
   */
  callbackFailed: '[store] collection callback failed',
  /** Collection options were not an object; thrown by collection constructors. */
  optionsObject: '[store] observable collection options must be an object',
  /** `debugName` option was not a string. */
  debugName: '[store] observable collection debugName must be a string',
  /** Initial collection input was neither a non-null object nor an iterable. */
  collectionInput: '[store] observable collection input must be a non-null object or iterable',
  /** ObservableObject accessed with a non-string key. */
  objectKey: '[store] ObservableObject key must be a string',
  /** A collection read from another reactive Runtime than the one that owns it. */
  crossRuntime:
    '[store] cross-runtime dependency is not allowed: collection read belongs to another Runtime',
  /** Any use of a collection after dispose; `name` is the collection kind. */
  disposed: (name: string): string => `[store] ${name} is disposed`,
  /** ObservableArray index outside the current length. */
  arrayIndex: '[store] ObservableArray index out of range',
  /** ObservableArray index that is not an integer. */
  arrayInteger: '[store] ObservableArray index must be an integer'
} as const

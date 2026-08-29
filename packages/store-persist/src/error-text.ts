/** Stable public diagnostics owned by `@migaia/store-persist`. */
export const StorePersistErrorText = {
  optionsObject: '[store] persist options must be an object',
  stringOption: (label: string): string => `[store] persist ${label} must be a string`,
  jsonSerialize: '[store] json codec cannot serialize this value',
  jsonPayload: '[store] json codec expects a string payload',
  binaryBackend:
    '[store] binary codec output requires a storage-web store with getBytes/setBytes (an IRecordStore-capable backend)',
  structuredOutput: (name: string): string =>
    `[store] codec "${name}" produces structured output, which this storage adapter shape does not support`,
  binaryUint8: (name: string): string =>
    `[store] binary codec "${name}" must encode to a Uint8Array`,
  stringOutput: (name: string): string =>
    `[store] codec "${name}" must encode to a string when the backend has no binary channel`,
  binaryRead: (name: string): string =>
    `[store] binary codec "${name}" requires a storage backend with binary read support`,
  archiveEnvelope: (key: string): string => `[store] persist archive "${key}" is not an envelope`,
  archiveVersion: (key: string): string => `[store] persist archive "${key}" has no usable version`,
  archiveState: (key: string): string => `[store] persist archive "${key}" carries no state`,
  aborted: '[store] persist operation was aborted by dispose',
  noCodec: (key: string): string => `[store] persist "${key}" resolved no codec`,
  invalidVersion: (key: string): string =>
    `[store] persist "${key}" version must be a safe, non-negative integer`,
  debounce: (key: string): string =>
    `[store] persist "${key}" debounceMs must be a finite, non-negative number`,
  callback: (key: string, name: string): string =>
    `[store] persist "${key}" ${name} must be a function`,
  callbackAsync: (key: string, name: string): string =>
    `[store] persist "${key}" ${name} must return synchronously`,
  codecInvalid: (key: string): string => `[store] persist "${key}" codec is invalid`,
  storageInvalid: (key: string): string => `[store] persist "${key}" storage adapter is invalid`,
  hydrationWriteFailed: '[store] persist hydration and write both failed',
  versionMismatch: (key: string, archive: number, current: number): string =>
    `[store] persist archive "${key}" is version ${archive}, but this store is version ${current}; provide migrate() to convert it`
} as const

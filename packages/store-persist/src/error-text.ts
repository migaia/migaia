/** Stable public diagnostics owned by `@migaia/store-persist`. */
export const StorePersistErrorText = {
  optionsObject: '[store] persist options must be an object',
  stringOption: (label: string): string => `[store] persist ${label} must be a string`,
  jsonSerialize: '[store] json codec cannot serialize this value',
  jsonPayload: '[store] json codec expects a string payload',
  binaryBackend:
    '[store] binary codec output requires a storage-plugin-browser store with getBytes/setBytes (an IRecordStore-capable backend)',
  /** Clear must reject incomplete byte adapters instead of silently deleting the text channel. */
  binaryRemoval: '[store] binary archive removal requires a storage backend with removeBytes',
  structuredOutput: (name: string): string =>
    `[store] codec "${name}" produces structured output, which this storage adapter shape does not support`,
  binaryUint8: (name: string): string =>
    `[store] binary codec "${name}" must encode to a Uint8Array`,
  stringOutput: (name: string): string =>
    `[store] codec "${name}" must encode to a string when the backend has no binary channel`,
  binaryRead: (name: string): string =>
    `[store] binary codec "${name}" requires a storage backend with binary read support`,
  /** Invalid plans fail attachment before any subscription or storage operation. */
  migrationsInvalid: (key: string): string => `[store] persist "${key}" migrations are invalid`,
  /** Codec observers must belong to the codec stage family before attachment begins. */
  codecStagesInvalid: '[store] persist codecStages must be a codec observer',
  /** Transactional attachments reject wrong-kind observers before subscription or I/O. */
  transactionStagesInvalid: '[store] persist transactionStages must be a transaction observer',
  /** Atomic participation needs the original complete transaction-capable store. */
  transactionBackend: '[store] persistTransaction requires a complete transaction-capable store',
  /** Only privately registered active handles of one exact store may enlist or flush its scope. */
  transactionParticipation:
    '[store] persistTransaction requires active handles from the same store',
  /** Direct operations cannot overtake an enlisted snapshot or wait behind its own transaction. */
  transactionDirectOperation:
    '[store] persistence is participating in a transaction; use flush(tx)',
  /** Snapshot and partialize failures enter the existing encoding boundary before any tx request. */
  transactionSnapshot: '[store] persist transaction snapshot cannot be encoded',
  aborted: '[store] persist operation was aborted by dispose',
  noCodec: (key: string): string => `[store] persist "${key}" resolved no codec`,
  invalidVersion: (key: string): string =>
    `[store] persist "${key}" version must be a safe, non-negative integer`,
  debounce: (key: string): string =>
    `[store] persist "${key}" debounceMs must be a finite, non-negative number`,
  /** Invalid maximum debounce window is rejected before subscribing or allocating status nodes. */
  maxWait: (key: string): string =>
    `[store] persist "${key}" maxWaitMs must be a finite, non-negative number within the timer range`,
  callback: (key: string, name: string): string =>
    `[store] persist "${key}" ${name} must be a function`,
  callbackAsync: (key: string, name: string): string =>
    `[store] persist "${key}" ${name} must return synchronously`,
  codecInvalid: (key: string): string => `[store] persist "${key}" codec is invalid`,
  storageInvalid: (key: string): string => `[store] persist "${key}" storage adapter is invalid`,
  hydrationWriteFailed: '[store] persist hydration and write both failed'
} as const

/** Stable public diagnostics owned by `@migaia/store-wasm`. */
export const StoreWasmErrorText = {
  /** Shared cancellation message for all field builders. */
  initAborted: '[store] field init aborted',
  /** Shared post-dispose access message for field values. */
  fieldDisposed: '[store] cannot use a disposed wasm field',
  /** Shared initialization precondition message. */
  notInitialized: '[store] WASM is not initialized; await ensureWasm() or use StoreProvider',
  allocationAlignment: (ptr: number): string =>
    `wasm.array: allocation not 8-byte aligned (ptr=${ptr})`,
  invalidIndex: (index: number): string => `wasm.array: index out of bounds (${index})`,
  invalidRange: (lo: number, hi: number): string => `wasm.array: invalid range [${lo}, ${hi})`,
  /** Stable diagnostic for a range payload whose length does not match its target. */
  rangeValueLength: 'wasm.array: values length must match the target range',
  /** Stable diagnostic for a non-array-like range payload at the JavaScript boundary. */
  rangeValuesInvalid: 'wasm.array: values must be array-like',
  valueType: (field: string, expected: string): string =>
    `wasm.${field}: value must be a ${expected}`,
  valueTooLarge: (length: number, maxBytes: number): string =>
    `wasm.string: value exceeds maxBytes (${length} > ${maxBytes})`,
  corruptedLength: 'wasm.string: corrupted byte length',
  allocationLimit: 'wasm.allocate: byteLen must fit an unsigned 32-bit integer',
  stringLimit: 'wasm.string: maxBytes exceeds the Wasm32 allocation limit',
  arrayLengthLimit: 'wasm.array: length exceeds the Wasm32 allocation limit',
  granularityInvalid: 'wasm.array: granularity must be a positive safe integer',
  recordShapeInvalid: 'wasm.record: shape must be an object of field builders',
  /** Stable aggregate message used when more than one WASM-owned resource fails cleanup. */
  cleanupFailed: '[store] WASM cleanup failed',
  reservedField: (key: string): string => `[store] wasm.record field name is reserved: ${key}`
} as const

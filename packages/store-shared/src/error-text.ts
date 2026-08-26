/** Stable public diagnostics owned by `@migaia/store-shared`. */
export const StoreSharedErrorText = {
  cellUnsettled:
    '[store] shared cell did not settle before the contention limit; a writer may still be active or may have abandoned the seqlock',
  lockUnacquired:
    '[store] shared cell lock was not acquired before the contention limit; another writer may still be active or may have abandoned it',
  int32: (what: string, value: unknown): string =>
    `[store] ${what} must be an int32, received ${String(value)}`,
  waitAsyncUnavailable:
    '[store] Atomics.waitAsync is unavailable; pump sync() from your own message loop instead',
  signalBufferSmall: '[store] shared signal buffer is too small',
  signalDisposed: '[store] shared signal is disposed',
  arrayLength: '[store] shared array length must be a non-negative integer',
  arrayLengthTooLarge: '[store] shared array length exceeds the Int32Array capacity',
  arrayBufferSmall: '[store] shared array buffer is too small',
  bufferType: '[store] shared buffer must be a SharedArrayBuffer',
  optionsObject: '[store] shared array options must be an object',
  optionsRead: '[store] shared array options could not be read safely',
  initialValuesInvalid: '[store] shared array initialValues could not be materialized safely',
  updateFunction: '[store] shared array update callback must be a function',
  arrayRace: (index: number): string =>
    `[store] shared array update at ${String(index)} kept losing the race; another writer never settled`,
  arrayDisposed: '[store] shared array is disposed',
  arrayIndex: (index: number): string => `[store] shared array index out of range: ${String(index)}`
} as const

/** Stable public diagnostics owned by `@migaia/store-worker`. */
export const StoreWorkerErrorText = {
  optionsObject: '[store] worker options must be an object',
  workerComputedAdapter: '[store] workerComputed adapter must be a WorkerAdapter',
  workerComputedCallback: (name: string): string =>
    `[store] workerComputed ${name} must be a function`,
  workerHandlerCallback: (name: string): string =>
    `[store] createWorkerHandler ${name} must be a function`,
  handlerInvalid:
    '[store] serialize worker handler requires encode/decode parser functions and a post function',
  worker: '[store] worker options.worker must be an object',
  ownership: '[store] worker options.ownership must be copy or transfer',
  terminateOnDispose: '[store] worker options.terminateOnDispose must be boolean',
  stringOption: (name: string): string => `[store] worker options.${name} must be a string`,
  disposed: '[store] worker adapter is disposed',
  invalidChunk: '[store] serialize worker returned an invalid chunk',
  aborted: (transferred: boolean): string =>
    `[store] serialize worker request aborted${transferred ? '; transferred input is detached and cannot be retried' : ''}`,
  cleanupFailed: '[store] serialize worker cleanup failed',
  invalidRequestChunk: '[store] invalid serialize worker request chunk',
  invalidPhase: '[store] invalid serialize worker phase',
  emptyChunks: '[store] cannot merge an empty chunk list',
  valueChunks: '[store] cannot merge value chunks into bytes'
} as const
